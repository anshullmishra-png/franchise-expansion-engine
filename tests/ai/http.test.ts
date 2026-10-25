import { describe, expect, it, vi } from "vitest";
import { getAiConfig, scrub, wantsForcedFallback } from "../../lib/ai/config";
import { Throttle, visitorKey } from "../../lib/ai/throttle";
import { POST as chat } from "../../app/api/chat/route";
import { POST as extract } from "../../app/api/extract/route";
import { POST as message } from "../../app/api/message/route";
import { GET as status } from "../../app/api/status/route";
import { runEngine } from "../../lib/engine";
import { mkApp, mkInput, mkTer } from "../helpers/fixtures";
import { stressInput } from "../helpers/chat-harness";

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

describe("config", () => {
  it("treats a missing or placeholder key as rules-only, and applies model defaults", () => {
    for (const k of [undefined, "", "your-key-here", "  "]) expect(getAiConfig({ GEMINI_API_KEY: k }).apiKey).toBeNull();
    const c = getAiConfig({ GEMINI_API_KEY: "abc123" });
    expect(c).toEqual({ apiKey: "abc123", chatModel: "gemini-3.8-flash", fastModel: "gemini-3.5-flash-lite" });
    expect(getAiConfig({ GEMINI_API_KEY: "k", GEMINI_CHAT_MODEL: "my-chat", GEMINI_FAST_MODEL: "my-fast" })).toMatchObject({ chatModel: "my-chat", fastModel: "my-fast" });
  });
  it("honours x-force-fallback outside production only", () => {
    const h = new Headers({ "x-force-fallback": "1" });
    expect(wantsForcedFallback(h, { NODE_ENV: "development" })).toBe(true);
    expect(wantsForcedFallback(h, { NODE_ENV: "test" })).toBe(true);
    expect(wantsForcedFallback(h, { NODE_ENV: "production" })).toBe(false);
    expect(wantsForcedFallback(new Headers(), { NODE_ENV: "development" })).toBe(false);
  });
  it("scrubs the key out of text", () => {
    expect(scrub("failed with key SECRET-123 in url", { apiKey: "SECRET-123", chatModel: "a", fastModel: "b" })).toBe("failed with key [key] in url");
    expect(scrub("nothing to hide", { apiKey: null, chatModel: "a", fastModel: "b" })).toBe("nothing to hide");
  });
});

describe("throttle (30 AI calls a minute per visitor)", () => {
  it("allows 30 calls in a minute, then says no, then recovers", () => {
    const t = new Throttle(30, 60_000);
    for (let i = 0; i < 30; i++) expect(t.allow("a", 1000 + i)).toBe(true);
    expect(t.allow("a", 2000)).toBe(false);
    expect(t.allow("b", 2000)).toBe(true);
    expect(t.allow("a", 1000 + 60_001)).toBe(true);
  });
  it("reads the visitor from the proxy headers", () => {
    expect(visitorKey(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(visitorKey(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(visitorKey(new Headers())).toBe("local");
  });
});

describe("API routes (no key in the test environment, so rules-only)", () => {
  const state = () => {
    const input = stressInput();
    return { input, overrides: {}, assumptions: {}, readings: [], today: "2026-10-25" };
  };

  it("GET /api/status reports whether AI is configured, and nothing else", async () => {
    const body = await (await status()).json();
    expect(Object.keys(body)).toEqual(["aiConfigured"]);
    expect(body.aiConfigured).toBe(false);
  });
  it("POST /api/chat answers a why-question and says it used the rules", async () => {
    const res = await chat(post("/api/chat", { messages: [{ role: "user", text: "Why is APP-007 on hold?" }], state: state() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usedFallback).toBe(true);
    expect(body.reply).toMatch(/APP-007/);
  });
  it("POST /api/chat applies an update and returns the new state with the log entry", async () => {
    const res = await chat(post("/api/chat", { messages: [{ role: "user", text: "APP-012 has now found a ground-floor space" }], state: state() }, { "x-force-fallback": "1" }));
    const body = await res.json();
    expect(body.newOverrides.applications["APP-012"]).toEqual({ floor: "Ground", spaceAvailable: "Identified (ownership unconfirmed)" });
    expect(body.entries[0].fieldDiffs).toHaveLength(2);
    expect(body.entries[0].statusDiffs.map((d: { id: string }) => d.id)).toEqual(expect.arrayContaining(["APP-012", "APP-013"]));
    expect(body.entries[0].prev.overrides).toEqual({});
  });
  it("POST /api/chat accepts the slimmed state the browser sends (no excluded example rows)", async () => {
    const full = stressInput();
    const slim = { input: { applications: full.applications, territories: full.territories, existingStores: full.existingStores }, overrides: {}, assumptions: {}, readings: [], undoTo: null, today: "2026-10-25" };
    const res = await chat(post("/api/chat", { messages: [{ role: "user", text: "APP-012 has now found a ground-floor space" }], state: slim }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toMatch(/\*\*What I changed:\*\*/);
    expect(body.newOverrides.applications["APP-012"].floor).toBe("Ground");
  });
  it("POST /api/chat explain mode returns the original text when AI is off", async () => {
    const res = await chat(post("/api/chat", { mode: "explain", explanation: "Approved with a score of 86/100." }));
    expect(await res.json()).toMatchObject({ text: "Approved with a score of 86/100.", usedFallback: true });
  });
  it("POST /api/extract reads notes with the rules", async () => {
    const res = await extract(post("/api/extract", { applications: [{ id: "APP-1", business: "optical shop", notes: "need a bank loan" }] }));
    const body = await res.json();
    expect(body.readings[0].businessCategory).toBe("eyewear_optical_watches");
    expect(body.readings[0].signals.some((s: { type: string }) => s.type === "finance")).toBe(true);
  });
  it("POST /api/message returns an English draft with a note for other languages", async () => {
    const r = runEngine(mkInput([mkApp({ id: "APP-1", name: "Asha Rao" })], [mkTer()]), undefined, undefined, { today: "2026-10-25" });
    const decision = JSON.parse(JSON.stringify(r.decisionById["APP-1"]));
    const en = await (await message(post("/api/message", { decision, language: "English" }))).json();
    expect(en.message).toMatch(/Dear Asha/);
    const kn = await (await message(post("/api/message", { decision, language: "Kannada" }))).json();
    expect(kn).toMatchObject({ translated: false, usedFallback: true });
    expect(kn.note).toMatch(/Translation unavailable/);
  });
  it("answers bad requests with a friendly 4xx, never a crash", async () => {
    expect((await chat(post("/api/chat", "{not json"))).status).toBe(400);
    expect((await chat(post("/api/chat", { messages: [] }))).status).toBe(400);
    expect((await chat(post("/api/chat", { messages: [{ role: "user", text: "hi" }], state: { input: { applications: "x" } } }))).status).toBe(400);
    expect((await extract(post("/api/extract", { applications: "nope" }))).status).toBe(400);
    expect((await message(post("/api/message", { decision: {}, language: "Tamil" }))).status).toBe(400);
    const huge = await chat(post("/api/chat", "x".repeat(4 * 1024 * 1024 + 10)));
    expect(huge.status).toBe(413);
  });
  it("a corrupt state is a 400 with a message, not a 500", async () => {
    const bad = { input: { applications: [{ nonsense: true }], territories: [], existingStores: [] }, overrides: {}, assumptions: {}, readings: [] };
    const res = await chat(post("/api/chat", { messages: [{ role: "user", text: "Why is APP-1 on hold?" }], state: bad }));
    expect([200, 400]).toContain(res.status);
    expect(typeof (await res.json())).toBe("object");
  });
  it("never puts the API key in a response", async () => {
    vi.stubEnv("GEMINI_API_KEY", "SUPER-SECRET-KEY-VALUE");
    vi.stubEnv("GEMINI_CHAT_MODEL", "no-such-model");
    try {
      const res = await chat(post("/api/chat", { messages: [{ role: "user", text: "Why is APP-007 on hold?" }], state: state() }, { "x-force-fallback": "1" }));
      expect(JSON.stringify(await res.json())).not.toContain("SUPER-SECRET-KEY-VALUE");
      const st = await (await status()).text();
      expect(st).not.toContain("SUPER-SECRET");
      expect(JSON.parse(st)).toEqual({ aiConfigured: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
