import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS, runEngine } from "../../lib/engine";
import type { Application, EngineInput, Overrides, Territory } from "../../lib/engine/types";
import { TODAY, mkApp, mkInput, mkTer } from "../helpers/fixtures";

const PINS = ["560095", "560017", "560048", "560067", "560041"];
const ter = (over: Partial<Territory> = {}) => mkTer({ id: "TER-A", pins: PINS, openSlots: 2, ...over });

const run = (apps: Application[], territories: Territory[] = [ter()], overrides: Overrides = {}, A = DEFAULT_ASSUMPTIONS) =>
  runEngine(mkInput(apps, territories), A, overrides, { today: TODAY });

const strong = (id: string, over: Partial<Application> = {}) => mkApp({ id, name: `Person ${id}`, ...over });

describe("status rules (SPEC §5.8)", () => {
  it("APPROVED: allocated at the pin they applied for, score >= 70, no open conditions", () => {
    const d = run([strong("APP-1")]).decisionById["APP-1"];
    expect(d.status).toBe("APPROVED");
    expect(d.score).toBeGreaterThanOrEqual(70);
    expect(d.allocation).toMatchObject({ pin: "560095", territoryId: "TER-A" });
    expect(d.allocation?.redirectedFrom).toBeUndefined();
    expect(d.headline).toMatch(/^Approved for 560095/);
    expect(d.conditions).toEqual([]);
  });
  it("CONDITIONAL: allocated at their own pin but with a condition to close", () => {
    const d = run([strong("APP-1", { floor: "Upper" })]).decisionById["APP-1"];
    expect(d.status).toBe("CONDITIONAL");
    expect(d.flags.map((f) => f.code)).toContain("NEED_GROUND_FLOOR");
    expect(d.conditions?.[0].deadline).toBe("2026-11-24");
  });
  it("CONDITIONAL: allocated at their own pin with no conditions but a score between 55 and 70", () => {
    const d = run([strong("APP-1", { investmentLakh: 36.75, experienceYears: 1, business: "IT professional" })]).decisionById["APP-1"];
    expect(d.score).toBeGreaterThanOrEqual(55);
    expect(d.score).toBeLessThan(70);
    expect(d.flags.some((f) => f.severity === "condition")).toBe(false);
    expect(d.status).toBe("CONDITIONAL");
  });
  it("REDIRECT: gets a different pin than applied for, with the slot held for 30 days", () => {
    const r = run([strong("APP-1", { name: "A One" }), strong("APP-2", { name: "B Two" })]);
    const loser = ["APP-1", "APP-2"].map((id) => r.decisionById[id]).find((d) => d.status === "REDIRECT")!;
    expect(loser.allocation?.redirectedFrom).toMatchObject({ pin: "560095", territoryId: "TER-A" });
    expect(loser.allocation?.pin).not.toBe("560095");
    expect(loser.allocation?.slotReservedUntil).toBe("2026-11-24");
    expect(loser.competitors?.length).toBe(1);
  });
  it("WAITLIST: eligible but out of slots; ranked by score", () => {
    const apps = [
      strong("APP-1", { name: "A One", pin: "560095" }),
      strong("APP-2", { name: "B Two", pin: "560017", investmentLakh: 40 }),
      strong("APP-3", { name: "C Three", pin: "560048", investmentLakh: 38 }),
    ];
    const r = run(apps, [ter({ openSlots: 1 })]);
    const wait = r.decisions.filter((d) => d.status === "WAITLIST");
    expect(wait).toHaveLength(2);
    expect(wait.map((d) => d.waitlistRank?.rank).sort()).toEqual([1, 2]);
    expect(wait[0].waitlistRank?.of).toBe(2);
    expect(r.territories[0].waitlist).toHaveLength(2);
    expect(wait.every((d) => d.why.includes("TER-A"))).toBe(true);
  });
  it("WAITLIST (not ready): a score below 55 doesn't take a free slot", () => {
    const weak = strong("APP-1", { investmentLakh: 22, experienceYears: 0, business: "IT job", spaceAvailable: "Not yet identified", spaceSize: null, floor: "Not known", targetLaunchMonths: 1 });
    const r = run([weak]);
    const d = r.decisionById["APP-1"];
    expect(d.score).toBeLessThan(55);
    expect(d.status).toBe("WAITLIST");
    expect(d.allocation).toBeUndefined();
    expect(d.headline).toMatch(/not ready/i);
    expect(r.territories[0].freeSlots).toBe(2);
    expect(r.territories[0].insight?.reasons.join(" ")).toMatch(/aren't ready/);
  });
  it("HOLD: any blocker, never allocated, with the exact questions; no score", () => {
    const d = run([strong("APP-1", { investmentLakh: 300 })]).decisionById["APP-1"];
    expect(d.status).toBe("HOLD");
    expect(d.score).toBeNull();
    expect(d.allocation).toBeUndefined();
    expect(d.questionsForApplicant?.length).toBeGreaterThan(0);
    expect(d.why).toMatch(/on hold/i);
  });
  it("REJECTED: investment below 60% of the tier need, exactly at the boundary", () => {
    expect(run([strong("APP-1", { investmentLakh: 20.9 })]).decisionById["APP-1"].status).toBe("REJECTED");
    const at = run([strong("APP-1", { investmentLakh: 21 })]).decisionById["APP-1"];
    expect(at.status).not.toBe("REJECTED");
    const rej = run([strong("APP-2", { investmentLakh: 15 })]).decisionById["APP-2"];
    expect(rej.why).toMatch(/60%/);
    expect(rej.why).toMatch(/co-investor/);
  });
  it("a held application is held even if its numbers would also reject it", () => {
    expect(run([strong("APP-1", { investmentLakh: 10, pin: "5700" })]).decisionById["APP-1"].status).toBe("HOLD");
  });
});

describe("redirect penalty (D6)", () => {
  const two = (secondSpace: Application["spaceAvailable"]) =>
    run([strong("APP-1", { name: "A One" }), strong("APP-2", { name: "B Two", spaceAvailable: secondSpace, ...(secondSpace === "Not yet identified" ? { spaceSize: null, floor: "Not known" as const } : {}) })]).decisionById["APP-2"];
  it("applies -8 when the applicant would lose a site they already have", () => {
    const d = two("Rented");
    expect(d.status).toBe("REDIRECT");
    expect(d.redirectPenaltyApplied).toBe(true);
    expect(d.effectiveScore).toBe((d.score as number) - 8);
    expect(d.why).toMatch(/8 points were deducted/);
  });
  it("does not apply when they have no site to lose", () => {
    const d = two("Not yet identified");
    expect(d.status).toBe("REDIRECT");
    expect(d.redirectPenaltyApplied).toBe(false);
    expect(d.effectiveScore).toBe(d.score);
  });
  it("the penalty can change who gets the slot", () => {
    // Same raw score, but APP-2's own pin is blocked by the existing store at 560038, so with a site it ranks 8 lower.
    const t = ter({ pins: ["560038", "560095", "560017", "560048"], openSlots: 1 });
    const r = run([strong("APP-1", { name: "A One", pin: "560095" }), strong("APP-2", { name: "B Two", pin: "560038" })], [t]);
    expect(r.decisionById["APP-1"].status).toBe("APPROVED");
    expect(r.decisionById["APP-2"].status).toBe("WAITLIST");
    expect(r.decisionById["APP-2"].effectiveScore).toBeLessThan(r.decisionById["APP-2"].score as number);
  });
});

describe("hard rules in the engine", () => {
  it("never places a store on an existing store's pin or inside a blocked catchment", () => {
    const t = ter({ pins: ["560038", "560008", "560095"], openSlots: 3 });
    const r = run([strong("APP-1", { pin: "560038" }), strong("APP-2", { name: "B Two", pin: "560008" })], [t]);
    for (const d of r.decisions) expect(["560038", "560008"]).not.toContain(d.allocation?.pin);
    expect(r.invariants.ok).toBe(true);
  });
  it("never gives a person two stores", () => {
    const r = run([strong("APP-1", { name: "Arjun Reddy", pin: "560095" }), strong("APP-2", { name: "Arjun  Reddy", pin: "560017" })]);
    expect(r.decisions.filter((d) => d.allocation).length).toBe(1);
    const other = r.decisions.find((d) => !d.allocation)!;
    expect(other.why).toMatch(/one partner can hold only one store/);
  });
  it("never exceeds open slots, and a zero-slot territory takes nobody", () => {
    const r = run([strong("APP-1"), strong("APP-2", { name: "B Two", pin: "560017" })], [ter({ openSlots: 0 })]);
    expect(r.decisions.every((d) => !d.allocation)).toBe(true);
    expect(r.territories[0].insight).toBeUndefined();
  });
});

describe("overrides (inline edits, chat updates)", () => {
  it("an edited field changes the decision and is quoted in the raw cells", () => {
    const base = run([strong("APP-1", { floor: "Upper" })]).decisionById["APP-1"];
    const after = run([strong("APP-1", { floor: "Upper" })], [ter()], { applications: { "APP-1": { floor: "Ground" } } }).decisionById["APP-1"];
    expect(base.status).toBe("CONDITIONAL");
    expect(after.status).toBe("APPROVED");
    expect(after.score as number).toBeGreaterThan(base.score as number);
  });
  it("withdrawing hands the slot to the next in line", () => {
    const apps = [strong("APP-1", { name: "A One", pin: "560017" }), strong("APP-2", { name: "B Two", pin: "560095", investmentLakh: 40 })];
    const t = [ter({ openSlots: 1 })];
    expect(run(apps, t).decisionById["APP-2"].status).toBe("WAITLIST");
    const after = run(apps, t, { withdrawn: { "APP-1": "found another franchise" } });
    expect(after.decisionById["APP-1"].status).toBe("REJECTED");
    expect(after.decisionById["APP-1"].headline).toMatch(/Withdrawn/);
    expect(after.decisionById["APP-2"].status).toBe("APPROVED");
  });
  it("more slots re-run the allocation", () => {
    const apps = [strong("APP-1", { name: "A One", pin: "560017" }), strong("APP-2", { name: "B Two", pin: "560095" })];
    expect(run(apps, [ter({ openSlots: 1 })]).decisionById["APP-2"].status).toBe("WAITLIST");
    const r = run(apps, [ter({ openSlots: 1 })], { territories: { "TER-A": { openSlots: 2 } } });
    expect(r.decisionById["APP-2"].status).toBe("APPROVED");
  });
  it("resolving a condition removes its flag", () => {
    const apps = [strong("APP-1", { notes: "We may need a bank loan to cover part of this" })];
    const d = run(apps).decisionById["APP-1"];
    expect(d.flags.map((f) => f.code)).toContain("LOAN_DEPENDENT");
    const after = run(apps, [ter()], { resolved: { "APP-1": ["LOAN_DEPENDENT"] } }).decisionById["APP-1"];
    expect(after.flags.map((f) => f.code)).not.toContain("LOAN_DEPENDENT");
    expect(after.score as number).toBeGreaterThan(d.score as number);
  });
  it("an added fact counts as a signal with its source text", () => {
    const sig = { type: "green" as const, impact: 2, text: "Has a trained optometrist", quote: "has a trained optometrist" };
    const after = run([strong("APP-1")], [ter()], { addedSignals: { "APP-1": [sig] } }).decisionById["APP-1"];
    const c = after.breakdown.find((x) => x.key === "signals")!;
    expect(c.points).toBe(2);
    expect(c.signals?.[0].quote).toBe("has a trained optometrist");
  });
  it("does not change the input it was given", () => {
    const input = mkInput([strong("APP-1", { floor: "Upper" })], [ter()]);
    const copy = JSON.stringify(input);
    runEngine(input, DEFAULT_ASSUMPTIONS, { applications: { "APP-1": { floor: "Ground" } }, withdrawn: {} }, { today: TODAY });
    expect(JSON.stringify(input)).toBe(copy);
  });
});

describe("assumptions are live", () => {
  it("a smaller Tier 1 catchment lets a blocked pin through", () => {
    const t = ter({ pins: ["560008", "560095"], openSlots: 1 }); // 560008 is 1.7 km from ST-03
    const apps = [strong("APP-1", { pin: "560008" })];
    expect(run(apps, [t]).decisionById["APP-1"].status).toBe("REDIRECT");
    const A = { ...DEFAULT_ASSUMPTIONS, catchmentKm: { ...DEFAULT_ASSUMPTIONS.catchmentKm, 1: 1 } };
    expect(run(apps, [t], {}, A).decisionById["APP-1"].status).toBe("APPROVED");
  });
  it("the approve threshold moves the Approved/Conditional line", () => {
    const apps = [strong("APP-1")];
    expect(run(apps).decisionById["APP-1"].status).toBe("APPROVED");
    expect(run(apps, [ter()], {}, { ...DEFAULT_ASSUMPTIONS, approveScore: 95 }).decisionById["APP-1"].status).toBe("CONDITIONAL");
  });
});

describe("output guarantees", () => {
  it("handles an empty workbook", () => {
    const r = runEngine(mkInput([], []), DEFAULT_ASSUMPTIONS, {}, { today: TODAY });
    expect(r.decisions).toEqual([]);
    expect(r.invariants.ok).toBe(true);
    expect(Object.values(r.counts).every((n) => n === 0)).toBe(true);
  });
  it("every applicant has a status, headline, why and at least one reason", () => {
    const apps = [
      strong("APP-1"), strong("APP-2", { investmentLakh: 10 }), strong("APP-3", { pin: "5700" }),
      strong("APP-4", { name: null }), strong("APP-5", { city: "Pune", pin: "411001" }),
    ];
    for (const d of run(apps).decisions) {
      expect(d.status).toBeTruthy();
      expect(d.headline.length).toBeGreaterThan(5);
      expect(d.why.length).toBeGreaterThan(20);
      expect(d.reasons.length).toBeGreaterThan(0);
    }
  });
  it("is deterministic and independent of row order", () => {
    const apps = [strong("APP-1", { name: "A One" }), strong("APP-2", { name: "B Two", pin: "560017" }), strong("APP-3", { name: "C Three", pin: "560048", floor: "Upper" }), strong("APP-4", { name: "D Four", pin: "560095", investmentLakh: 38 })];
    const summary = (r: ReturnType<typeof run>) => r.decisions.map((d) => [d.id, d.status, d.score, d.allocation?.pin]);
    const a = run(apps, [ter({ openSlots: 3 })]);
    expect(summary(run(apps, [ter({ openSlots: 3 })]))).toEqual(summary(a));
    expect(summary(run([...apps].reverse(), [ter({ openSlots: 3 })]))).toEqual(summary(a));
  });
  it("counts add up", () => {
    const r = run([strong("APP-1"), strong("APP-2", { investmentLakh: 300 }), strong("APP-3", { investmentLakh: 10 })]);
    expect(Object.values(r.counts).reduce((s, n) => s + n, 0)).toBe(3);
    expect(r.counts).toMatchObject({ APPROVED: 1, HOLD: 1, REJECTED: 1 });
  });
  it("cannibalisation rows show nearby stores with km, overlap and band", () => {
    const d = run([strong("APP-1")]).decisionById["APP-1"];
    const row = d.cannibalisation[0];
    expect(row).toMatchObject({ storeId: "ST-02", kind: "existing" });
    expect(row.overlapPct).toBeGreaterThan(25);
    expect(row.band).toBe("Elevated");
  });
  it("payback is computed for a placed applicant and reflects overlap", () => {
    const d = run([strong("APP-1")]).decisionById["APP-1"];
    expect(d.payback?.months).toBeGreaterThan(25);
    expect(d.payback?.inputs.overlapPct).toBeGreaterThan(25);
  });
  it("never leaks the unrelated input type's shape", () => {
    const input: EngineInput = mkInput([strong("APP-1")], [ter()]);
    expect(Object.keys(runEngine(input, DEFAULT_ASSUMPTIONS, {}, { today: TODAY })).sort()).toEqual(
      ["alerts", "counts", "decisionById", "decisions", "input", "invariants", "readings", "territories", "today"]
    );
  });
});
