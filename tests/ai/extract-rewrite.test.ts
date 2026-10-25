import { beforeEach, describe, expect, it } from "vitest";
import { AiError, type AiClient, type GenRequest, type GenResult } from "../../lib/ai/client";
import { EXTRACT_CHUNK, cleanSignal, clearExtractCache, extractReadings, hashApplicants, mergeSignals } from "../../lib/ai/extract";
import { keepsNumbers } from "../../lib/ai/rewrite";
import { handleExplain, handleExtract, handleMessage } from "../../lib/ai/service";
import { getAiConfig } from "../../lib/ai/config";
import { draftMessage } from "../../lib/engine/message";
import { runEngine } from "../../lib/engine";
import { mkApp, mkInput, mkTer } from "../helpers/fixtures";
import { withClient } from "../helpers/chat-harness";

const TODAY = "2026-10-25";
const text = (t: string): GenResult => ({ text: t, functionCalls: [], modelContent: undefined });

class Fake implements AiClient {
  requests: GenRequest[] = [];
  constructor(private reply: (req: GenRequest) => string | Error) {}
  async generate(req: GenRequest): Promise<GenResult> {
    this.requests.push(req);
    const r = this.reply(req);
    if (r instanceof Error) throw r;
    return text(r);
  }
}

const app = (over: Parameters<typeof mkApp>[0] = {}) => mkApp({ business: "Runs a footwear store", notes: "Investment of about 30 lakh from my savings. Need a bank loan for the rest.", ...over });
const src = (a = app()) => a;

beforeEach(() => clearExtractCache());

describe("cleanSignal (what the AI is allowed to claim)", () => {
  it("keeps a signal whose quote is in the applicant's own words, and bounds the impact", () => {
    const s = cleanSignal({ type: "red", text: "Needs a loan", quote: "Need a bank loan for the rest", impact: -9 }, src());
    expect(s).toMatchObject({ type: "red", impact: -3, quote: "Need a bank loan for the rest" });
  });
  it("drops a signal whose quote isn't in the applicant's text (a hallucination)", () => {
    expect(cleanSignal({ type: "green", text: "Has run a franchise", quote: "I ran a franchise for ten years", impact: 3 }, src())).toBeNull();
  });
  it("matches quotes loosely on case, spacing and quote marks", () => {
    expect(cleanSignal({ type: "info", text: "x", quote: "  runs a FOOTWEAR   store ", impact: 0 }, src())).not.toBeNull();
  });
  it("needs a number for an investment contradiction, and an ISO date for a deadline", () => {
    const base = { type: "contradiction", text: "x", quote: "Investment of about 30 lakh", impact: 2, field: "investment" };
    expect(cleanSignal({ ...base, value: "30 lakh" }, src())).toMatchObject({ value: 30, impact: 0 });
    expect(cleanSignal({ ...base, value: "a lot" }, src())).toBeNull();
    expect(cleanSignal({ ...base, value: undefined }, src())).toBeNull();
    expect(cleanSignal({ type: "deadline", text: "x", quote: "my savings", impact: 0, date: "soon" }, src())).toBeNull();
    expect(cleanSignal({ type: "deadline", text: "x", quote: "my savings", impact: 1, date: "2026-11-08" }, src())).toMatchObject({ date: "2026-11-08", impact: 0 });
  });
  it("rejects malformed signals", () => {
    expect(cleanSignal({ type: "nonsense", text: "x", quote: "my savings", impact: 1 }, src())).toBeNull();
    expect(cleanSignal("not an object", src())).toBeNull();
    expect(cleanSignal({ type: "green", text: "x", quote: "", impact: 1 }, src())).toBeNull();
  });
});

describe("extractReadings", () => {
  const good = (a = app()) =>
    JSON.stringify({
      results: [
        {
          id: a.id,
          businessCategory: "specialty_retail",
          priorFranchise: false,
          signals: [
            { type: "green", text: "Runs a footwear store", quote: "Runs a footwear store", impact: 1 },
            { type: "green", text: "Invented praise", quote: "world class operator", impact: 3 },
          ],
        },
      ],
    });

  it("uses the AI's reading, drops what it can't back up, and keeps the loan and the figure the rules found", async () => {
    const a = app({ id: "APP-1", investmentLakh: 300 });
    const ai = new Fake(() => good(a));
    const out = await extractReadings([src(a)], TODAY, ai, "fast-model");
    expect(out.usedFallback).toBe(false);
    expect(out.aiCount).toBe(1);
    const sig = out.readings[0].signals;
    expect(sig.map((s) => s.text)).toContain("Runs a footwear store");
    expect(sig.map((s) => s.text)).not.toContain("Invented praise");
    expect(sig.some((s) => s.type === "finance")).toBe(true);
    expect(sig.some((s) => s.type === "contradiction" && s.field === "investment" && s.value === 30)).toBe(true);
    expect(ai.requests[0].model).toBe("fast-model");
    expect(ai.requests[0].responseJsonSchema).toBeTruthy();
    expect(ai.requests[0].systemInstruction).toContain("2026-10-25");
    expect(ai.requests[0].systemInstruction).toContain("Diwali");
  });
  it("falls back to the rules for everyone when the AI returns junk or fails", async () => {
    const a = app({ id: "APP-1", investmentLakh: 300 });
    for (const reply of ["not json", JSON.stringify({ results: "nope" }), new AiError("timeout", "The AI took too long to answer.")]) {
      clearExtractCache();
      const out = await extractReadings([src(a)], TODAY, new Fake(() => reply), "fast-model");
      expect(out.usedFallback).toBe(true);
      expect(out.reason).toBeTruthy();
      expect(out.readings[0].signals.some((s) => s.type === "finance")).toBe(true);
    }
  });
  it("fills in applicants the AI left out", async () => {
    const a = app({ id: "APP-1" });
    const b = app({ id: "APP-2", notes: "Need a bank loan" });
    const out = await extractReadings([src(a), src(b)], TODAY, new Fake(() => good(a)), "fast-model");
    expect(out.readings.map((r) => r.id)).toEqual(["APP-1", "APP-2"]);
    expect(out.usedFallback).toBe(true);
    expect(out.readings[1].signals.some((s) => s.type === "finance")).toBe(true);
  });
  it("sends large files in chunks of 40", async () => {
    const apps = Array.from({ length: EXTRACT_CHUNK + 5 }, (_, i) => app({ id: `APP-${i + 1}` }));
    const ai = new Fake((req) => {
      const ids = (JSON.parse((req.contents[0].parts?.[0] as { text: string }).text) as { id: string }[]).map((x) => x.id);
      return JSON.stringify({ results: ids.map((id) => ({ id, businessCategory: "specialty_retail", priorFranchise: false, signals: [] })) });
    });
    const out = await extractReadings(apps.map(src), TODAY, ai, "fast-model");
    expect(ai.requests).toHaveLength(2);
    expect(out.readings).toHaveLength(EXTRACT_CHUNK + 5);
    expect(out.usedFallback).toBe(false);
  });
  it("caches by content: the same file isn't read twice", async () => {
    const a = app({ id: "APP-1" });
    const ai = new Fake(() => good(a));
    await extractReadings([src(a)], TODAY, ai, "fast-model");
    const second = await extractReadings([src(a)], TODAY, ai, "fast-model");
    expect(ai.requests).toHaveLength(1);
    expect(second.cached).toBe(true);
    expect(hashApplicants([src(a)], TODAY)).toBe(hashApplicants([src(a)], TODAY));
    expect(hashApplicants([src(a)], TODAY)).not.toBe(hashApplicants([src(app({ id: "APP-1", notes: "changed" }))], TODAY));
  });
  it("never calls the AI with no client, when forced, or when nobody wrote any text", async () => {
    const a = app({ id: "APP-1" });
    const ai = new Fake(() => good(a));
    expect((await extractReadings([src(a)], TODAY, null, "f")).usedFallback).toBe(true);
    expect((await extractReadings([src(a)], TODAY, ai, "f", { force: true })).usedFallback).toBe(true);
    const blank = await extractReadings([src(app({ id: "APP-2", business: null, notes: null }))], TODAY, ai, "f");
    expect(blank.usedFallback).toBe(false);
    expect(ai.requests).toHaveLength(0);
  });
  it("mergeSignals only adds the rules' loan, contradiction and deadline signals when the AI missed that kind", () => {
    const ai = [{ type: "finance" as const, text: "loan", quote: "q", impact: -2 }];
    const fb = [
      { type: "finance" as const, text: "loan again", quote: "q2", impact: -2 },
      { type: "deadline" as const, text: "diwali", quote: "d", impact: 0, date: "2026-11-08" },
      { type: "green" as const, text: "nice", quote: "n", impact: 1 },
    ];
    expect(mergeSignals(ai, fb).map((s) => s.text)).toEqual(["loan", "diwali"]);
  });
  it("the AI's readings flow into decisions: a loan signal becomes a condition", async () => {
    const a = app({ id: "APP-1", notes: "Need a bank loan for the rest" });
    const out = await extractReadings([src(a)], TODAY, new Fake(() => JSON.stringify({ results: [{ id: "APP-1", businessCategory: "specialty_retail", priorFranchise: false, signals: [] }] })), "fast");
    const r = runEngine(mkInput([a], [mkTer()]), undefined, undefined, { today: TODAY, readings: out.readings, simulate: false });
    expect(r.decisionById["APP-1"].flags.map((f) => f.code)).toContain("LOAN_DEPENDENT");
  });
});

describe("explain simply and messages", () => {
  const decision = (() => {
    const r = runEngine(mkInput([mkApp({ id: "APP-1", name: "Asha Rao" })], [mkTer()]), undefined, undefined, { today: TODAY });
    return r.decisionById["APP-1"];
  })();

  it("keepsNumbers: accepts a rewrite that keeps the figures, rejects one that drops or changes them", () => {
    const original = "Score 74/100 at 580021, 38% overlap with ST-09, payback 35 months.";
    expect(keepsNumbers(original, "They scored 74/100 at 580021; overlap is 38% and payback is 35 months.")).toBe(true);
    expect(keepsNumbers(original, "They scored 80/100 at 580021; overlap is 20%.")).toBe(false);
    expect(keepsNumbers("No numbers here at all.", "Anything")).toBe(true);
  });
  it("explain: uses the rewrite when it keeps the numbers; otherwise shows the original", async () => {
    const expl = "Approved with a score of 86/100 and 30% overlap.";
    const ok = await handleExplain({ explanation: expl }, withClient(new Fake(() => "Simply put: approved, 86/100, with 30% overlap.")));
    expect(ok).toMatchObject({ text: "Simply put: approved, 86/100, with 30% overlap.", usedFallback: false });
    const bad = await handleExplain({ explanation: expl }, withClient(new Fake(() => "Approved with a strong score.")));
    expect(bad).toMatchObject({ text: expl, usedFallback: true });
    const down = await handleExplain({ explanation: expl }, withClient(new Fake(() => new AiError("unavailable", "down"))));
    expect(down).toMatchObject({ text: expl, usedFallback: true });
    const none = await handleExplain({ explanation: expl }, { client: null, config: getAiConfig({}) });
    expect(none).toMatchObject({ text: expl, usedFallback: true });
  });
  it("message: English never needs the AI", async () => {
    const ai = new Fake(() => "unused");
    const r = await handleMessage({ decision: decision as never, language: "English" }, withClient(ai));
    expect(r).toMatchObject({ language: "English", translated: true, usedFallback: false });
    expect(r.message).toBe(draftMessage(decision, "English").message);
    expect(ai.requests).toHaveLength(0);
  });
  it("message: Kannada uses the AI's text when it keeps the facts", async () => {
    const english = draftMessage(decision, "English").message;
    const ai = new Fake(() => JSON.stringify({ language: "Kannada", message: "ಅಭಿನಂದನೆಗಳು! ನಿಮ್ಮ ಅರ್ಜಿ ಅನುಮೋದಿಸಲಾಗಿದೆ. ".repeat(3), englishVersion: english }));
    const r = await handleMessage({ decision: decision as never, language: "Kannada" }, withClient(ai));
    expect(r).toMatchObject({ language: "Kannada", translated: true, usedFallback: false });
    expect(r.message).toMatch(/ಅಭಿನಂದನೆಗಳು/);
    expect(r.englishVersion).toBe(english);
  });
  it("message: falls back to English with a note when the AI fails or changes the facts", async () => {
    for (const reply of [new AiError("timeout", "slow"), "not json", JSON.stringify({ language: "Hindi", message: "नमस्ते ".repeat(5), englishVersion: "Congratulations, everything is different: 99 days, 12345." })]) {
      const r = await handleMessage({ decision: decision as never, language: "Hindi" }, withClient(new Fake(() => reply)));
      expect(r).toMatchObject({ language: "Hindi", translated: false, usedFallback: true });
      expect(r.note).toMatch(/Translation unavailable/);
      expect(r.message).toBe(r.englishVersion);
    }
  });
  it("extract endpoint logic: rules-only when forced or throttled, with a reason", async () => {
    const body = { applications: [{ id: "APP-1", notes: "need a bank loan", business: "shop" }] };
    const forced = await handleExtract(body, { client: new Fake(() => "x"), config: getAiConfig({}), forceFallback: true });
    expect(forced.usedFallback).toBe(true);
    expect(forced.readings[0].signals.some((s) => s.type === "finance")).toBe(true);
    const throttled = await handleExtract(body, { client: new Fake(() => "x"), config: getAiConfig({}), throttled: true });
    expect(throttled.usedFallback).toBe(true);
    expect(throttled.reason).toBeTruthy();
  });
});
