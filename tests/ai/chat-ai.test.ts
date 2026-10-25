import { describe, expect, it } from "vitest";
import { AiError, type AiClient, type GenRequest, type GenResult } from "../../lib/ai/client";
import { replyUpdate, replyWhy } from "../../lib/ai/replies";
import { MAX_TOOL_ROUNDS } from "../../lib/ai/chat";
import { ChatSession, stressInput, withClient } from "../helpers/chat-harness";

// The AI path of /api/chat, with a scripted stand-in for Gemini: the model asks for tools, the engine answers,
// the model phrases the result. These tests check the plumbing and every failure mode, not Gemini itself.

type Script = (req: GenRequest, round: number) => GenResult | Promise<GenResult>;

class FakeAi implements AiClient {
  requests: GenRequest[] = [];
  constructor(private script: Script) {}
  async generate(req: GenRequest): Promise<GenResult> {
    this.requests.push(req);
    return this.script(req, this.requests.length);
  }
}

const call = (name: string, args: Record<string, unknown>): GenResult => ({
  text: "",
  functionCalls: [{ name, args }],
  modelContent: { role: "model", parts: [{ functionCall: { name, args }, thoughtSignature: "sig-123" } as never] },
});
const say = (text: string): GenResult => ({ text, functionCalls: [], modelContent: { role: "model", parts: [{ text }] } });

/** The tool output the engine gave back in the latest functionResponse. */
function lastToolOutput(req: GenRequest): unknown {
  const last = req.contents[req.contents.length - 1];
  const part = (last.parts ?? []).find((p) => "functionResponse" in p) as { functionResponse: { response: { output: unknown } } } | undefined;
  return part?.functionResponse.response.output;
}
const lastUserText = (req: GenRequest) => {
  for (let i = req.contents.length - 1; i >= 0; i--) {
    const t = req.contents[i].parts?.find((p) => "text" in p && req.contents[i].role === "user") as { text: string } | undefined;
    if (t) return t.text;
  }
  return "";
};

const smart: Script = (req) => {
  const out = lastToolOutput(req);
  const q = lastUserText(req);
  if (out !== undefined) return say((q.includes("found") ? replyUpdate(out) : replyWhy(out)) + " [ai]");
  if (/found a ground-floor/.test(q)) {
    return call("apply_update", {
      changes: [
        { target: "application", id: "APP-012", field: "floor", value: "Ground" },
        { target: "application", id: "APP-012", field: "spaceAvailable", value: "Identified (ownership unconfirmed)" },
      ],
    });
  }
  return call("get_application", { id: "APP-007" });
};

describe("chat with the AI on", () => {
  it("answers a why-question from a tool result, with no change made", async () => {
    const ai = new FakeAi(smart);
    const s = new ChatSession(stressInput(), withClient(ai));
    const r = await s.say("Why is APP-007 on hold?");
    expect(s.last.usedFallback).toBe(false);
    expect(r).toMatch(/APP-007/);
    expect(r).toMatch(/\[ai\]$/);
    expect(s.last.entries).toBeUndefined();
    expect(ai.requests).toHaveLength(2);
    expect(ai.requests[0].functionDeclarations?.map((d) => d.name)).toEqual(
      expect.arrayContaining(["get_overview", "get_application", "compare", "get_territory", "list_applications", "what_if", "apply_update", "withdraw", "update_territory", "set_assumption", "undo"])
    );
    expect(ai.requests[0].systemInstruction).toContain("2026-10-25");
    expect(ai.requests[0].model).toBe("chat-model");
  });

  it("applies an update through apply_update and reports the knock-on changes", async () => {
    const ai = new FakeAi(smart);
    const s = new ChatSession(stressInput(), withClient(ai));
    const r = await s.say("APP-012 has now found a ground-floor space");
    expect(s.last.usedFallback).toBe(false);
    expect(r).toMatch(/\*\*New decision for APP-012:\*\*.*Score 66 → 74/);
    expect(r).toMatch(/\*\*Knock-on effects:\*\* APP-013/);
    expect(s.last.entries).toHaveLength(1);
    expect(s.last.entries?.[0].sourceText).toBe("APP-012 has now found a ground-floor space");
    expect(s.overrides.applications?.["APP-012"]).toEqual({ floor: "Ground", spaceAvailable: "Identified (ownership unconfirmed)" });
  });

  it("hands the model's own turn (with its thought signature) back, then the tool results", async () => {
    const ai = new FakeAi(smart);
    await new ChatSession(stressInput(), withClient(ai)).say("Why is APP-007 on hold?");
    const second = ai.requests[1].contents;
    expect(second.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(JSON.stringify(second[1])).toContain("sig-123");
    expect(JSON.stringify(second[2])).toContain("functionResponse");
  });

  it("a what_if call changes nothing", async () => {
    const ai = new FakeAi((req) => {
      const out = lastToolOutput(req);
      if (out !== undefined) return say(replyUpdate(out, { whatIf: true }));
      return call("what_if", { changes: [{ target: "application", id: "APP-014", field: "investmentLakh", value: "30" }] });
    });
    const s = new ChatSession(stressInput(), withClient(ai));
    const r = await s.say("What if APP-014 can invest 30 lakh?");
    expect(r).toMatch(/nothing has been changed/);
    expect(s.last.entries).toBeUndefined();
    expect(s.last.newOverrides).toBeUndefined();
  });

  it("bad tool arguments come back to the model as an error, and it can still answer", async () => {
    const ai = new FakeAi((req) => {
      const out = lastToolOutput(req) as { error?: string } | undefined;
      if (out !== undefined) return say(`I couldn't do that: ${out.error}`);
      return call("apply_update", { changes: [{ target: "application", id: "APP-999", field: "floor", value: "Ground" }, { nonsense: true }] });
    });
    const s = new ChatSession(stressInput(), withClient(ai));
    const r = await s.say("APP-999 found a ground floor space");
    expect(r).toMatch(/I couldn't do that/);
    expect(s.last.entries).toBeUndefined();
  });

  it("values the model invents for a field are validated by the engine, not trusted", async () => {
    const ai = new FakeAi((req) => {
      const out = lastToolOutput(req) as { skipped?: string[] } | undefined;
      if (out !== undefined) return say(`skipped: ${(out.skipped ?? []).join(" ")}`);
      return call("apply_update", { changes: [{ target: "application", id: "APP-012", field: "floor", value: "Rooftop" }] });
    });
    const s = new ChatSession(stressInput(), withClient(ai));
    const r = await s.say("APP-012 found a rooftop");
    expect(r).toMatch(/Choose Ground, Upper, Mall unit or Not known/);
    expect(s.overrides).toEqual({});
  });
});

describe("chat when the AI fails", () => {
  it("falls back to the rules when the AI throws, and says so", async () => {
    const ai = new FakeAi(() => {
      throw new AiError("timeout", "The AI took too long to answer.");
    });
    const s = new ChatSession(stressInput(), withClient(ai));
    const r = await s.say("Why is APP-007 on hold?");
    expect(s.last.usedFallback).toBe(true);
    expect(s.last.reason).toMatch(/too long/);
    expect(r).toMatch(/APP-007/);
  });
  it("applies a rules-only update when the AI fails before touching anything", async () => {
    const ai = new FakeAi(() => {
      throw new AiError("throttled", "The AI is busy right now (rate limit).");
    });
    const s = new ChatSession(stressInput(), withClient(ai));
    await s.say("APP-012 has now found a ground-floor space");
    expect(s.last.usedFallback).toBe(true);
    expect(s.last.entries).toHaveLength(1);
    expect(s.overrides.applications?.["APP-012"]).toBeDefined();
  });
  it("falls back when the AI answers with nothing", async () => {
    const s = new ChatSession(stressInput(), withClient(new FakeAi(() => say("   "))));
    const r = await s.say("Why is APP-007 on hold?");
    expect(s.last.usedFallback).toBe(true);
    expect(r).toMatch(/APP-007/);
  });
  it("gives up after the maximum number of tool rounds and falls back", async () => {
    const ai = new FakeAi(() => call("get_overview", {}));
    const s = new ChatSession(stressInput(), withClient(ai));
    const r = await s.say("Why is APP-007 on hold?");
    expect(ai.requests).toHaveLength(MAX_TOOL_ROUNDS);
    expect(s.last.usedFallback).toBe(true);
    expect(r).toMatch(/APP-007/);
  });
  it("never applies a change twice: if the AI fails after committing, it reports what was applied", async () => {
    let n = 0;
    const ai = new FakeAi(() => {
      n++;
      if (n === 1)
        return call("apply_update", { changes: [{ target: "application", id: "APP-012", field: "floor", value: "Ground" }], sourceText: "APP-012 found a ground-floor space" });
      throw new AiError("unavailable", "The AI isn't available right now.");
    });
    const s = new ChatSession(stressInput(), withClient(ai));
    const r = await s.say("APP-012 found a ground-floor space");
    expect(s.last.usedFallback).toBe(true);
    expect(s.last.entries).toHaveLength(1);
    expect(r).toMatch(/^Done: APP-012 found a ground-floor space/);
    expect(s.overrides.applications?.["APP-012"]).toEqual({ floor: "Ground" });
  });
  it("doesn't call the AI at all when throttled or forced to rules-only", async () => {
    const ai = new FakeAi(() => say("should not be used"));
    for (const flags of [{ throttled: true }, { forceFallback: true }]) {
      const s = new ChatSession(stressInput(), { ...withClient(ai), ...flags });
      const r = await s.say("Why is APP-007 on hold?");
      expect(r).toMatch(/APP-007/);
      expect(s.last.usedFallback).toBe(true);
      expect(s.last.reason).toBeTruthy();
    }
    expect(ai.requests).toHaveLength(0);
  });
});

describe("chat tools", () => {
  it("only the history's last 10 turns go to the model, starting with a user turn", async () => {
    const ai = new FakeAi(() => say("ok"));
    const s = new ChatSession(stressInput(), withClient(ai));
    for (let i = 0; i < 8; i++) await s.say(`question ${i}`);
    const contents = ai.requests[ai.requests.length - 1].contents;
    expect(contents.length).toBeLessThanOrEqual(10);
    expect(contents[0].role).toBe("user");
  });
});
