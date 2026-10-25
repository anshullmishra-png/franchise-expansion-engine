import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS as A } from "../../lib/engine/assumptions";
import { computePayback, conditionsFromFlags, plannedOpenDate, realisticMonths } from "../../lib/engine/plan";
import { financialPoints, scoreApplication, withDestinationPriority, type ScoreInputs } from "../../lib/engine/score";
import type { Application, BusinessCategory, FlagCode, NoteSignal } from "../../lib/engine/types";
import { mkApp, mkTer } from "../helpers/fixtures";

function score(over: Partial<Application> = {}, extra: Partial<ScoreInputs> = {}) {
  const app = mkApp({ id: "APP-S", ...over });
  const inputs: ScoreInputs = {
    app,
    tier: 1,
    category: "specialty_retail",
    priorFranchise: false,
    signals: [],
    flagCodes: new Set<FlagCode>(),
    territory: mkTer({ priority: "High" }),
    ownPinWorst: null,
    realisticMonths: 2.5,
    a: A,
    ...extra,
  };
  const r = scoreApplication(inputs);
  const pts = (k: string) => r.components.find((c) => c.key === k)!.points;
  return { r, pts };
}

describe("financial readiness bands (SPEC §5.4)", () => {
  it("has the exact boundaries at 0.60, 0.85, 1.00, 1.10 and 1.25", () => {
    expect(financialPoints(0.5999)).toBeNull();
    expect(financialPoints(0.6)).toBe(5);
    expect(financialPoints(0.8499)).toBe(5);
    expect(financialPoints(0.85)).toBe(12);
    expect(financialPoints(0.9999)).toBe(12);
    expect(financialPoints(1.0)).toBe(19);
    expect(financialPoints(1.0999)).toBe(19);
    expect(financialPoints(1.1)).toBe(22);
    expect(financialPoints(1.2499)).toBe(22);
    expect(financialPoints(1.25)).toBe(25);
    expect(financialPoints(3)).toBe(25);
  });
  it("rejects below 60% of the tier need and gives no total", () => {
    const { r } = score({ investmentLakh: 20 }); // 20/35 = 57%
    expect(r.rejected).toBe(true);
    expect(r.total).toBeNull();
    expect(r.components[0].reason).toContain("60%");
  });
  it("uses the tier need given (Tier 3: 18 lakh against 22 is 82%)", () => {
    const { r } = score({ investmentLakh: 18 }, { tier: 3 });
    expect(r.ratio).toBeCloseTo(18 / 22);
    expect(r.financialPoints).toBe(5);
  });
});

describe("operator experience", () => {
  const exp = (years: number, category: BusinessCategory = "unknown", franchise = false) =>
    score({ experienceYears: years }, { category, priorFranchise: franchise }).pts("experience");
  it("years bands", () => {
    expect([0, 1, 2, 3, 4, 5, 7, 8, 20].map((y) => exp(y))).toEqual([3, 7, 9, 12, 12, 14, 14, 15, 15]);
  });
  it("relevance by category", () => {
    const rel = (c: BusinessCategory) => exp(5, c) - 14;
    expect(rel("eyewear_optical_watches")).toBe(5);
    expect(rel("specialty_retail")).toBe(4);
    expect(rel("general_or_food_retail")).toBe(3);
    expect(rel("retail_manager")).toBe(3);
    expect(rel("non_retail_business")).toBe(2);
    expect(rel("salaried_non_retail")).toBe(0);
    expect(rel("unknown")).toBe(0);
  });
  it("prior franchise adds 1, capped at 5 relevance", () => {
    expect(exp(5, "specialty_retail", true)).toBe(14 + 5);
    expect(exp(5, "eyewear_optical_watches", true)).toBe(14 + 5);
    expect(exp(5, "salaried_non_retail", true)).toBe(14 + 1);
  });
  it("tops out at 20", () => {
    expect(exp(15, "eyewear_optical_watches", true)).toBe(20);
  });
});

describe("site readiness", () => {
  const site = (over: Partial<Application>, flags: FlagCode[] = []) =>
    score(over, { flagCodes: new Set(flags) }).pts("site");
  it("owned or rented, ground or mall, 300-1500 sq ft", () => {
    expect(site({ spaceAvailable: "Owned", floor: "Ground", spaceSize: 500 })).toBe(20);
    expect(site({ spaceAvailable: "Owned", floor: "Mall unit", spaceSize: 300 })).toBe(20);
    expect(site({ spaceAvailable: "Rented", floor: "Ground", spaceSize: 1500 })).toBe(18);
    expect(site({ spaceAvailable: "Identified (ownership unconfirmed)", floor: "Ground", spaceSize: 500 })).toBe(18);
  });
  it("size blank is -4; floor unknown caps at 12; upper floor is 6", () => {
    expect(site({ spaceAvailable: "Rented", floor: "Ground", spaceSize: null })).toBe(14);
    expect(site({ spaceAvailable: "Owned", floor: "Not known", spaceSize: 500 })).toBe(12);
    expect(site({ spaceAvailable: "Owned", floor: null, spaceSize: 500 })).toBe(12);
    expect(site({ spaceAvailable: "Rented", floor: "Upper", spaceSize: 500 })).toBe(6);
    expect(site({ spaceAvailable: "Rented", floor: "Upper", spaceSize: null })).toBe(2);
  });
  it("below 300 sq ft caps at 6; above 1500 is -2", () => {
    expect(site({ spaceAvailable: "Owned", floor: "Ground", spaceSize: 299 })).toBe(6);
    expect(site({ spaceAvailable: "Owned", floor: "Ground", spaceSize: 1501 })).toBe(18);
    expect(site({ spaceAvailable: "Rented", floor: "Ground", spaceSize: 1501 })).toBe(16);
  });
  it("no space identified is 6, even if a size and floor were filled in", () => {
    expect(site({ spaceAvailable: "Not yet identified", floor: "Ground", spaceSize: 500 }, ["FIND_SPACE", "SPACE_CONTRADICTION"])).toBe(6);
  });
});

describe("location fit", () => {
  const loc = (priority: "High" | "Medium" | "Low" | null, overlapPct: number, withTerritory = true) =>
    score({}, {
      territory: withTerritory ? mkTer({ priority }) : null,
      ownPinWorst: overlapPct > 0 ? { storeId: "ST-02", km: 2, overlapPct } : null,
    }).pts("location");
  it("priority 10/7/4 plus safety 10/7/3/0", () => {
    expect(loc("High", 0)).toBe(20);
    expect(loc("Medium", 5)).toBe(17);
    expect(loc("Low", 15)).toBe(11);
    expect(loc("High", 30)).toBe(13);
    expect(loc("High", 45)).toBe(10);
    expect(loc("High", 100)).toBe(10);
  });
  it("a territory without a stated priority counts as Low", () => {
    expect(loc(null, 0)).toBe(14);
  });
  it("no territory gives 0 for priority but still scores safety", () => {
    expect(loc("High", 0, false)).toBe(10);
  });
  it("says the pin is blocked when an existing store sits on it", () => {
    const r = score({}, { ownPinWorst: { storeId: "ST-03", km: 0, overlapPct: 100 } }).r;
    expect(r.components.find((c) => c.key === "location")!.reason).toContain("already has ST-03");
  });
  it("can add the destination priority after a redirect", () => {
    const base = score({}, { territory: null }).r.components;
    const after = withDestinationPriority(base, mkTer({ priority: "High" }));
    expect(after.find((c) => c.key === "location")!.points).toBe(20);
  });
});

describe("launch readiness", () => {
  const launch = (target: number | null, R: number) => score({ targetLaunchMonths: target }, { realisticMonths: R }).pts("launch");
  it("T >= R is 10; T >= R-1 is 7; below is 4", () => {
    expect(launch(4, 4)).toBe(10);
    expect(launch(5, 4)).toBe(10);
    expect(launch(3, 4)).toBe(7);
    expect(launch(2.9, 4)).toBe(4);
    expect(launch(0, 2.5)).toBe(4);
  });
  it("blank target is 8; more than 12 months is 6", () => {
    expect(launch(null, 4)).toBe(8);
    expect(launch(13, 4)).toBe(6);
    expect(launch(12, 4)).toBe(10);
  });
});

describe("AI-read signals", () => {
  const sig = (impact: number, text = "x"): NoteSignal => ({ type: "green", impact, text, quote: "q" });
  const pts = (signals: NoteSignal[]) => score({}, { signals }).pts("signals");
  it("sums impacts, caps the total at +/-5 and each signal at +/-3", () => {
    expect(pts([sig(2), sig(1)])).toBe(3);
    expect(pts([sig(3), sig(3), sig(3)])).toBe(5);
    expect(pts([sig(-3), sig(-3), sig(-3)])).toBe(-5);
    expect(pts([sig(10)])).toBe(3);
    expect(pts([])).toBe(0);
  });
  it("shows the signals that counted, with their quotes", () => {
    const c = score({}, { signals: [sig(2, "has a trained optometrist"), sig(0, "neutral")] }).r.components.find((x) => x.key === "signals")!;
    expect(c.signals).toHaveLength(1);
    expect(c.reason).toContain("trained optometrist");
  });
  it("total is the sum of the six components and never above 100", () => {
    const { r } = score({ investmentLakh: 100, experienceYears: 20, spaceAvailable: "Owned", spaceSize: 500, floor: "Ground", targetLaunchMonths: 5 }, {
      category: "eyewear_optical_watches", priorFranchise: true, signals: [sig(3), sig(3)],
    });
    expect(r.total).toBe(r.components.reduce((s, c) => s + c.points, 0));
    expect(r.total!).toBeLessThanOrEqual(100);
    expect(r.total).toBe(25 + 20 + 20 + 20 + 10 + 5);
  });
});

describe("realistic timeline", () => {
  const R = (over: Partial<Parameters<typeof realisticMonths>[0]> = {}, flags: FlagCode[] = []) =>
    realisticMonths({
      floor: "Ground", spaceAvailable: "Rented", flagCodes: new Set(flags), experienceYears: 5,
      businessCategory: "specialty_retail", redirected: false, ...over,
    }).months;
  it("base is 2.5 months", () => {
    expect(R()).toBe(2.5);
  });
  it("adds the SPEC §5.6 increments", () => {
    expect(R({ floor: "Mall unit" })).toBe(3);
    expect(R({}, ["FIND_SPACE"])).toBe(4);
    expect(R({ floor: "Upper" })).toBe(4);
    expect(R({}, ["SPACE_TOO_SMALL"])).toBe(4);
    expect(R({ floor: "Upper" }, ["SPACE_TOO_SMALL"])).toBe(4);
    expect(R({}, ["FIN_GAP"])).toBe(3.5);
    expect(R({}, ["FIN_GAP", "LOAN_DEPENDENT"])).toBe(3.5);
    expect(R({ experienceYears: 0 })).toBe(3);
    expect(R({ businessCategory: "salaried_non_retail", experienceYears: 6 })).toBe(3);
    expect(R({ redirected: true })).toBe(4);
    expect(R({ floor: "Upper", experienceYears: 0, redirected: true }, ["FIND_SPACE", "FIN_GAP"])).toBe(2.5 + 1.5 + 1.5 + 1 + 0.5 + 1.5);
  });
  it("planned open date is today + max(target, realistic) months", () => {
    expect(plannedOpenDate("2026-10-25", 3, 4)).toBe(plannedOpenDate("2026-10-25", 0, 4));
    expect(plannedOpenDate("2026-10-25", 10, 4)).not.toBe(plannedOpenDate("2026-10-25", 4, 4));
  });
});

describe("payback (SPEC §5.7)", () => {
  it("clean stores take about 25 / 28 / 31 months", () => {
    expect(computePayback(1, "Ground", 500, 0, A).months).toBeCloseTo(25, 5);
    expect(computePayback(2, "Ground", 500, 0, A).months).toBeCloseTo(28, 5);
    expect(computePayback(3, "Ground", 500, 0, A).months).toBeCloseTo(31.43, 1);
  });
  it("upper floor, small space and overlap each lengthen it", () => {
    const base = computePayback(1, "Ground", 500, 0, A).months;
    expect(computePayback(1, "Upper", 500, 0, A).months).toBeCloseTo(base / 0.65, 5);
    expect(computePayback(1, "Ground", 299, 0, A).months).toBeCloseTo(base / 0.8, 5);
    expect(computePayback(1, "Ground", 500, 40, A).months).toBeCloseTo(base / 0.8, 5);
  });
  it("shows its inputs", () => {
    const p = computePayback(2, "Ground", 500, 20, A);
    expect(p.inputs.monthlyRevenueLakh).toBeCloseTo(5 * 0.9, 5);
    expect(p.inputs.monthlyProfitLakh).toBeCloseTo(5 * 0.9 * 0.2, 5);
    expect(p.inputs.investmentLakh).toBe(28);
  });
});

describe("conditions with deadlines", () => {
  it("30 days for site and finance, 14 for data confirmations", () => {
    const flags = (["FIND_SPACE", "FIN_GAP", "CONFIRM_SIZE"] as FlagCode[]).map((code) => ({ code, severity: "condition" as const, message: code }));
    const c = conditionsFromFlags(flags, "2026-10-25", A);
    expect(c.map((x) => x.deadline)).toEqual(["2026-11-24", "2026-11-24", "2026-11-08"]);
  });
});
