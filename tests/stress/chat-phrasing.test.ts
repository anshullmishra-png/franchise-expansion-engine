import { describe, expect, it } from "vitest";
import { ChatSession, rulesOnly, stressInput } from "../helpers/chat-harness";

// The same questions and updates, phrased the ways people actually type them. Rules-only mode must cope.

const ask = async (q: string) => {
  const s = new ChatSession(stressInput(), rulesOnly());
  const reply = await s.say(q);
  return { reply, s };
};

describe("rules-only chat understands varied phrasing", () => {
  it.each([
    ["why is app 7 on hold", /APP-007/],
    ["Why is APP007 on hold??", /APP-007/],
    ["explain APP-9", /APP-009/],
    ["why was APP-014 rejected", /60%/],
    ["What would it take for APP-006 to be approved?", /ground-floor space/],
    ["Is APP-003 better than APP-002?", /APP-002 scores higher/],
    ["compare app 2 and app 3", /APP-002 scores higher/],
    ["How many applicants are approved?", /applicants:/],
    ["List all waitlisted applicants", /applicant/],
    ["Who is competing for TER 1", /TER-01/],
    ["tell me about ter-7", /TER-07/],
  ])("%s", async (q, expected) => {
    expect((await ask(q)).reply).toMatch(expected);
  });

  it.each([
    ["APP-012 found a ground floor shop, 450 sq ft, rented", { floor: "Ground", spaceAvailable: "Rented", spaceSize: 450 }],
    ["APP-012 now owns a 450 sq ft ground-floor shop", { floor: "Ground", spaceAvailable: "Owned", spaceSize: 450 }],
    ["app 12 has secured a mall unit", { floor: "Mall unit", spaceAvailable: "Identified (ownership unconfirmed)" }],
    ["APP-005 can now invest 35 lakh", { investmentLakh: 35 }],
    ["APP-006's experience is actually 3 years", { experienceYears: 3 }],
    ["APP-015 target is now 6 months", { targetLaunchMonths: 6 }],
  ])("applies: %s", async (q, expected) => {
    const { s } = await ask(q);
    const id = /\d+/.exec(q.replace(/^.*?(\d+).*$/, "$1"))![0].padStart(3, "0");
    expect(s.overrides.applications?.[`APP-${id}`]).toMatchObject(expected);
  });

  it("territory edits: slots, priority and an added pin", async () => {
    expect((await ask("set TER-03 open slots to 3")).s.overrides.territories?.["TER-03"]).toEqual({ openSlots: 3 });
    expect((await ask("TER 5 has 3 slots now")).s.overrides.territories?.["TER-05"]).toEqual({ openSlots: 3 });
    expect((await ask("make TER-08 priority High")).s.overrides.territories?.["TER-08"]).toEqual({ priority: "High" });
    const pins = (await ask("add pin 560100 to TER-04")).s.overrides.territories?.["TER-04"]?.pins;
    expect(pins).toContain("560100");
    expect(pins).toContain("560037");
  });

  it("withdrawals: said plainly they commit; asked about hypothetically they do not", async () => {
    for (const q of ["APP-002 has withdrawn", "withdraw APP-002", "APP-002 dropped out", "APP 2 backed out because of family reasons"]) {
      const { s, reply } = await ask(q);
      expect(s.overrides.withdrawn).toHaveProperty("APP-002");
      expect(reply).toMatch(/withdrawn/);
    }
    const hypo = await ask("What happens if APP-002 withdraws?");
    expect(hypo.s.overrides).toEqual({});
    expect(hypo.s.last.entries).toBeUndefined();
    expect(hypo.reply).toMatch(/nothing has been changed/);
    expect(hypo.reply).toMatch(/APP-004|APP-025/);
    const reason = await ask("APP-002 withdrew because of family reasons");
    expect(reason.s.overrides.withdrawn?.["APP-002"]).toBe("family reasons");
  });

  it("any 'if' question is a what-if and never commits", async () => {
    for (const q of ["If TER-03 had 2 open slots, what changes?", "what if APP-012 found a ground-floor space", "Suppose APP-030's investment is 30 lakh"]) {
      const { s } = await ask(q);
      expect(s.overrides, q).toEqual({});
      expect(s.last.entries, q).toBeUndefined();
    }
  });

  it("an unrecognised request gets the help text, never an error", async () => {
    for (const q of ["hello", "???", "tell me a joke", "APP-012", "x".repeat(2000)]) {
      const r = (await ask(q)).reply;
      expect(typeof r).toBe("string");
      expect(r.length).toBeGreaterThan(10);
    }
  });
});
