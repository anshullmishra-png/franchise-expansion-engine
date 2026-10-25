import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS, runEngine } from "../../lib/engine";
import { parseWorkbook } from "../../lib/engine/parse";
import { DEFAULT_EXISTING_STORES } from "../../lib/engine/reference";
import type { Overrides } from "../../lib/engine/types";

// Stress-file assertions from docs/TEST_PLAN.md §2, plus the judge's "new information" updates (§3).

const TODAY = "2026-10-25";
const parsed = parseWorkbook(readFileSync(path.join(process.cwd(), "test-data/Stress_Test_Case1.xlsx")));
const run = (overrides: Overrides = {}, assumptions = DEFAULT_ASSUMPTIONS) =>
  runEngine(parsed.input, assumptions, overrides, { today: TODAY });
const base = run();
const d = (id: string, r = base) => r.decisionById[id];
const placedAt = (r = base) => r.decisions.filter((x) => x.allocation).map((x) => x.allocation!.pin);

describe("stress file: statuses", () => {
  it("APP-001 (the template example) is ignored by default", () => {
    expect(base.decisionById["APP-001"]).toBeUndefined();
    expect(base.decisions).toHaveLength(34);
  });
  it.each([
    ["APP-007", "CITY_PIN_MISMATCH"],
    ["APP-024", "PROBABLE_DUPLICATE"],
    ["APP-029", "MISSING_REQUIRED"],
    ["APP-030", "INVESTMENT_OUTLIER"],
  ])("%s is on HOLD (%s) with questions and no allocation", (id, code) => {
    expect(d(id).status).toBe("HOLD");
    expect(d(id).flags.map((f) => f.code)).toContain(code);
    expect(d(id).questionsForApplicant!.length).toBeGreaterThan(0);
    expect(d(id).allocation).toBeUndefined();
    expect(d(id).score).toBeNull();
  });
  it("APP-014 is REJECTED on investment, saying what would change it", () => {
    expect(d("APP-014").status).toBe("REJECTED");
    expect(d("APP-014").why).toMatch(/60%/);
    expect(d("APP-014").why).toMatch(/co-investor/);
  });
  it("nothing is placed at any existing store's pin", () => {
    const stores = new Set(DEFAULT_EXISTING_STORES.map((s) => s.pin));
    for (const pin of placedAt()) expect(stores.has(pin)).toBe(false);
    for (const pin of ["560001", "560034", "560038", "560066", "560076", "570009", "570017", "575001", "580020", "590001"]) {
      expect(placedAt()).not.toContain(pin);
    }
  });
  it("APP-005 (pin 560038 has ST-03) and APP-025 (pin 560076 has ST-05) are never approved at their own pin", () => {
    expect(d("APP-005").allocation?.pin).not.toBe("560038");
    expect(d("APP-025").allocation?.pin).not.toBe("560076");
    expect(d("APP-005").breakdown.find((c) => c.key === "location")!.reason).toMatch(/blocked/);
  });
  it("APP-004's pin is blocked by cannibalisation but the strong applicant is redirected, not lost", () => {
    expect(d("APP-004").status).toBe("REDIRECT");
    expect(d("APP-004").allocation?.redirectedFrom?.pin).toBe("560008");
    expect(d("APP-004").redirectPenaltyApplied).toBe(true);
    expect(d("APP-004").why).toMatch(/48% .*ST-03|ST-03.*48%/);
  });
  it("APP-025 has no site to lose, so no penalty would apply", () => {
    expect(d("APP-025").redirectPenaltyApplied).toBe(false);
    expect(d("APP-025").effectiveScore).toBe(d("APP-025").score);
  });
  it("TER-10 is Tier 3: APP-018 is scored at 18/22 = 82%, not 18/28", () => {
    expect(d("APP-018").tier).toBe(3);
    const fin = d("APP-018").breakdown.find((c) => c.key === "financial")!;
    expect(fin.points).toBe(5);
    expect(fin.reason).toContain("82%");
  });
  it("570002 is flagged as being in two territories", () => {
    expect(base.alerts.some((a) => a.code === "PIN_IN_MULTIPLE_TERRITORIES")).toBe(true);
    expect(d("APP-034").flags.map((f) => f.code)).toContain("PIN_IN_MULTIPLE_TERRITORIES");
    expect(d("APP-034").allocation?.pin).not.toBe("570002"); // 48% overlap with ST-07
  });
  it("APP-003 and APP-035 (same person) are never both allocated; the other row says why", () => {
    const placed = [d("APP-003"), d("APP-035")].filter((x) => x.allocation);
    expect(placed).toHaveLength(1);
    const other = [d("APP-003"), d("APP-035")].find((x) => !x.allocation)!;
    expect(other.why).toMatch(/one partner can hold only one store/);
  });
  it("TER-12 (0 slots) gets nothing; APP-027 is redirected elsewhere or waitlisted", () => {
    expect(base.territories.find((t) => t.id === "TER-12")!.allocated).toEqual([]);
    expect(["REDIRECT", "WAITLIST"]).toContain(d("APP-027").status);
    expect(d("APP-027").allocation?.territoryId).not.toBe("TER-12");
  });
  it("APP-008 and APP-009 are not both placed at their own pins (2.5 km apart in Mysuru)", () => {
    const own = ["APP-008", "APP-009"].filter((id) => d(id).allocation && !d(id).allocation!.redirectedFrom);
    expect(own).toHaveLength(1);
    expect(d("APP-008").status).toBe("APPROVED");
    expect(d("APP-009").status).toBe("WAITLIST");
    expect(d("APP-009").why).toMatch(/49%|48%/);
  });
  it("APP-016 and APP-017 are not both allocated (TER-09 has one slot)", () => {
    expect([d("APP-016"), d("APP-017")].filter((x) => x.allocation)).toHaveLength(1);
    expect(d("APP-017").status).toBe("APPROVED");
    expect(d("APP-016").waitlistRank).toMatchObject({ territoryId: "TER-09", rank: 1 });
  });
  it("APP-026 is not allocated (score below 55); TER-03 is unfilled or filled by a redirect", () => {
    expect(d("APP-026").allocation).toBeUndefined();
    expect(d("APP-026").score).toBeLessThan(55);
    const ter03 = base.territories.find((t) => t.id === "TER-03")!;
    for (const id of ter03.allocated) expect(d(id).status).toBe("REDIRECT");
  });
  it("APP-006 (no experience, no space) does not beat the stronger redirected applicants", () => {
    expect(d("APP-006").allocation).toBeUndefined();
    expect(d("APP-006").flags.map((f) => f.code)).toContain("UNREALISTIC_TARGET");
  });
  it("APP-028 (pin in no territory) is redirected within Bengaluru and flagged", () => {
    expect(d("APP-028").status).toBe("REDIRECT");
    expect(d("APP-028").flags.map((f) => f.code)).toContain("NO_TERRITORY");
    expect(d("APP-028").allocation?.redirectedFrom).toMatchObject({ territoryId: null, pin: "560100" });
  });
  it("APP-033's loan dependence is a condition and a red signal", () => {
    expect(d("APP-033").flags.map((f) => f.code)).toContain("LOAN_DEPENDENT");
    expect(d("APP-033").status).toBe("CONDITIONAL");
  });
  it("APP-032 asks for 0 months: flagged unrealistic, planned open date is realistic", () => {
    expect(d("APP-032").flags.map((f) => f.code)).toContain("UNREALISTIC_TARGET");
    expect(d("APP-032").plannedOpenDate! > "2027-01-01").toBe(true);
  });
  it("every applicant has a status, headline and non-empty why", () => {
    for (const x of base.decisions) {
      expect(x.status).toBeTruthy();
      expect(x.headline.length).toBeGreaterThan(5);
      expect(x.why.length).toBeGreaterThan(20);
      expect(x.reasons.length).toBeGreaterThan(0);
    }
  });
  it("placement rules H1-H6 hold, and independently: no shared pin, no territory over its slots", () => {
    expect(base.invariants).toMatchObject({ ok: true, violations: [] });
    expect(new Set(placedAt()).size).toBe(placedAt().length);
    for (const t of base.territories) expect(t.allocated.length).toBeLessThanOrEqual(t.openSlots);
    expect(Object.values(base.counts).reduce((s, n) => s + n, 0)).toBe(34);
  });
  it("unfilled-slot insights explain why a slot is still open", () => {
    const t = base.territories.find((x) => x.id === "TER-05")!;
    expect(t.freeSlots).toBe(1);
    expect(t.insight?.reasons.join(" ")).toMatch(/No viable pin is left/);
    expect(t.insight?.blockedPins.length).toBeGreaterThan(0);
  });
});

describe("stress file: APP-012 vs APP-013 (TER-07), and the judge's update", () => {
  it("initially APP-013 holds the only slot, 68 against 66", () => {
    expect(d("APP-013")).toMatchObject({ status: "CONDITIONAL", score: 68 });
    expect(d("APP-012")).toMatchObject({ status: "WAITLIST", score: 66 });
    expect(d("APP-012").waitlistRank).toMatchObject({ territoryId: "TER-07", rank: 1 });
    expect(d("APP-012").competitors?.[0].id).toBe("APP-013");
  });
  const found: Overrides = { applications: { "APP-012": { floor: "Ground", spaceAvailable: "Identified (ownership unconfirmed)" } } };
  it("after 'APP-012 found a ground-floor space', APP-012 holds TER-07 at about 74 and APP-013 is waitlist #1", () => {
    const r = run(found);
    expect(d("APP-012", r).status).toBe("CONDITIONAL");
    expect(d("APP-012", r).score).toBe(74);
    expect(d("APP-012", r).allocation?.pin).toBe("580021");
    expect(d("APP-012", r).flags.map((f) => f.code)).toContain("CONFIRM_SIZE"); // size was not stated: a condition, not an invention
    expect(d("APP-013", r).status).toBe("WAITLIST");
    expect(d("APP-013", r).waitlistRank).toMatchObject({ territoryId: "TER-07", rank: 1 });
    expect(r.invariants.ok).toBe(true);
  });
});

describe("stress file: other updates from the judge script", () => {
  const changed = (r: ReturnType<typeof run>) =>
    r.decisions.filter((x) => x.status !== d(x.id).status || x.allocation?.pin !== d(x.id).allocation?.pin).map((x) => x.id);

  it("APP-030's investment is actually 30 lakh: the hold clears and APP-030 is re-ranked", () => {
    const r = run({ applications: { "APP-030": { investmentLakh: 30 } } });
    expect(d("APP-030", r).status).not.toBe("HOLD");
    expect(d("APP-030", r).score).not.toBeNull();
    expect(changed(r)).toContain("APP-030");
    expect(r.invariants.ok).toBe(true);
  });
  it("APP-010 moves to a 400 sq ft ground-floor unit and competes with APP-011 for TER-06", () => {
    const r = run({ applications: { "APP-010": { floor: "Ground", spaceSize: 400 } } });
    expect(d("APP-010", r).score!).toBeGreaterThan(d("APP-010").score!);
    expect(d("APP-010", r).competitors?.map((c) => c.id)).toContain("APP-011");
    expect(d("APP-011", r).status).toBe("APPROVED");
  });
  it("APP-002 withdraws: the freed slot goes to the next in line and TER-01 stays full", () => {
    const r = run({ withdrawn: { "APP-002": "withdrew" } });
    expect(d("APP-002", r).status).toBe("REJECTED");
    expect(d("APP-002", r).headline).toMatch(/Withdrawn/);
    expect(r.territories.find((t) => t.id === "TER-01")!.allocated).toHaveLength(2);
    expect(changed(r).length).toBeGreaterThan(1);
  });
  it("TER-03 now has 2 open slots: the allocation is re-run", () => {
    const r = run({ territories: { "TER-03": { openSlots: 2 } } });
    expect(r.territories.find((t) => t.id === "TER-03")!.allocated.length).toBeGreaterThan(base.territories.find((t) => t.id === "TER-03")!.allocated.length);
    expect(r.invariants.ok).toBe(true);
  });
  it("APP-033's loan is sanctioned: the condition clears and the application becomes Approved", () => {
    const r = run({ resolved: { "APP-033": ["LOAN_DEPENDENT"] } });
    expect(d("APP-033", r).flags.map((f) => f.code)).not.toContain("LOAN_DEPENDENT");
    expect(d("APP-033", r).status).toBe("APPROVED");
  });
  it("what-if: APP-014 with a co-investor at 30 lakh moves forward", () => {
    const r = run({ applications: { "APP-014": { investmentLakh: 30 } } });
    expect(d("APP-014", r).status).toBe("APPROVED");
    expect(d("APP-014").status).toBe("REJECTED"); // the base run is untouched
  });
  it("changing the Tier 2 catchment from 3 km to 2 km re-evaluates the Mysuru cluster", () => {
    const r = run({}, { ...DEFAULT_ASSUMPTIONS, catchmentKm: { ...DEFAULT_ASSUMPTIONS.catchmentKm, 2: 2 } });
    expect(d("APP-009", r).status).toBe("APPROVED");
    expect(d("APP-009").status).toBe("WAITLIST");
    expect(r.invariants.ok).toBe(true);
  });
});
