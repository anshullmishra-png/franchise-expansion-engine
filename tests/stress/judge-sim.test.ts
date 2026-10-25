import { describe, expect, it } from "vitest";
import { ChatSession, rulesOnly, stressInput } from "../helpers/chat-harness";

// docs/TEST_PLAN.md §3, run through the chat endpoint's logic in rules-only mode (no AI at all).
// Each step carries the state forward exactly as the browser does.

describe("judge simulation, rules-only mode", () => {
  const s = new ChatSession(stressInput(), rulesOnly());

  it("1. Why is APP-007 on hold?", async () => {
    const r = await s.say("Why is APP-007 on hold?");
    expect(s.last.usedFallback).toBe(true);
    expect(r).toMatch(/APP-007/);
    expect(r).toMatch(/Mysuru/);
    expect(r).toMatch(/Bengaluru/);
    expect(r).toMatch(/hold/i);
  });
  it("2. Why is APP-009 not approved?", async () => {
    const r = await s.say("Why is APP-009 not approved?");
    expect(r).toMatch(/APP-009/);
    expect(r).toMatch(/APP-008/);
    expect(r).toMatch(/4[89]%/);
  });
  it("3. Why did APP-002 get 560095 and not APP-003?", async () => {
    const r = await s.say("Why did APP-002 get 560095 and not APP-003?");
    expect(r).toMatch(/APP-002 scores higher/);
    expect(r).toMatch(/APP-003/);
    expect(r).toMatch(/ahead on|behind on/);
  });
  it("4. What does APP-008 need to do next?", async () => {
    const r = await s.say("What does APP-008 need to do next?");
    expect(r).toMatch(/letter of intent/);
    expect(r).toMatch(/KYC/);
    expect(r).toMatch(/Site audit/);
  });
  it("5. How will APP-006 be trained?", async () => {
    const r = await s.say("How will APP-006 be trained?");
    expect(r).toMatch(/extended training in English/);
    expect(r).toMatch(/bootcamp/i);
    expect(r).toMatch(/ST-02/);
  });
  it("6. Which territories have unfilled slots, and why?", async () => {
    const r = await s.say("Which territories have unfilled slots, and why?");
    expect(r).toMatch(/TER-05/);
    expect(r).toMatch(/No viable pin/);
  });
  it("7. Is any new store planned in a pin that already has a store?", async () => {
    const r = await s.say("Is any new store planned in a pin that already has a store?");
    expect(r).toMatch(/^\*\*No\.\*\*/);
  });
  it("8. What's APP-017's payback period?", async () => {
    const r = await s.say("What's APP-017's payback period?");
    expect(r).toMatch(/APP-017: payback about 31 months/);
  });
  it("9. APP-012 has now found a ground-floor space", async () => {
    const r = await s.say("APP-012 has now found a ground-floor space");
    expect(r).toMatch(/\*\*What I changed:\*\*.*Floor: Not known → Ground/);
    expect(r).toMatch(/Space available: Not yet identified → Identified \(ownership unconfirmed\)/);
    expect(r).toMatch(/\*\*What I assumed:\*\*/);
    expect(r).toMatch(/\*\*New decision for APP-012:\*\* was waitlisted.*now conditional at 580021/);
    expect(r).toMatch(/Score 66 → 74/);
    expect(r).toMatch(/\*\*Knock-on effects:\*\* APP-013.*conditional at 580031.*→ waitlisted \(waitlist #1 for TER-07\)/);
    expect(r).toMatch(/\*\*Still needed:\*\*.*size/i);
    expect(s.last.newOverrides?.applications?.["APP-012"]).toEqual({ floor: "Ground", spaceAvailable: "Identified (ownership unconfirmed)" });
    expect(s.last.entries).toHaveLength(1);
  });
  it("10. APP-030's investment is actually 30 lakh", async () => {
    const r = await s.say("APP-030's investment is actually 30 lakh");
    expect(r).toMatch(/Investment \(₹ lakh\): 300 → 30/);
    expect(r).toMatch(/was hold; now (conditional|approved)/);
    expect(s.last.newOverrides?.applications?.["APP-030"]).toEqual({ investmentLakh: 30 });
  });
  it("11. APP-010 has moved to a ground-floor unit of 400 sq ft", async () => {
    const r = await s.say("APP-010 has moved to a ground-floor unit of 400 sq ft");
    expect(r).toMatch(/Floor: Upper → Ground/);
    expect(r).toMatch(/Space size \(sq ft\): 350 → 400/);
    expect(r).toMatch(/APP-010/);
  });
  it("12. APP-002 has withdrawn", async () => {
    const r = await s.say("APP-002 has withdrawn");
    expect(r).toMatch(/Status: active → withdrawn/);
    expect(r).toMatch(/\*\*Knock-on effects:\*\*/);
    expect(s.last.newOverrides?.withdrawn).toHaveProperty("APP-002");
  });
  it("13. TER-03 now has 2 open slots", async () => {
    const r = await s.say("TER-03 now has 2 open slots");
    expect(r).toMatch(/Open slots: 1 → 2/);
    expect(s.last.newOverrides?.territories?.["TER-03"]).toEqual({ openSlots: 2 });
  });
  it("14. APP-033's bank loan was sanctioned", async () => {
    const r = await s.say("APP-033's bank loan was sanctioned");
    expect(r).toMatch(/Condition closed: open → closed/);
    expect(r).toMatch(/now approved/);
  });
  it("15. What if APP-014 found a co-investor and can invest 30 lakh?", async () => {
    const before = JSON.stringify(s.overrides);
    const r = await s.say("What if APP-014 found a co-investor and can invest 30 lakh?");
    expect(r).toMatch(/nothing has been changed/);
    expect(r).toMatch(/APP-014/);
    expect(JSON.stringify(s.overrides)).toBe(before);
    expect(s.last.entries).toBeUndefined();
  });
  it("16. Tell me about APP-999", async () => {
    const r = await s.say("Tell me about APP-999");
    expect(r).toMatch(/There is no applicant APP-999/);
    expect(r).toMatch(/Did you mean/);
    expect(s.last.entries).toBeUndefined();
  });
  it("17. Undo the last change", async () => {
    const before = s.overrides;
    const r = await s.say("Undo the last change");
    expect(r).toMatch(/^\*\*Undone\.\*\*/);
    expect(s.overrides).not.toEqual(before);
    expect(s.overrides.resolved?.["APP-033"]).toBeUndefined(); // the loan change was the latest
  });
  it("also changes assumptions: Tier 2 catchment to 2 km", async () => {
    const r = await s.say("Change the Tier 2 catchment radius to 2 km");
    expect(r).toMatch(/Catchment radius, Tier 2: 3 km → 2 km/);
    expect(s.assumptions.catchmentKm[2]).toBe(2);
  });
  it("unknown territory and gibberish get a friendly answer, never a crash", async () => {
    expect(await s.say("Tell me about TER-99")).toMatch(/There is no territory TER-99/);
    expect(await s.say("asdf qwer")).toMatch(/I can answer/);
    expect(await s.say("")).toMatch(/I can answer/);
  });
});
