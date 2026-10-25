import { describe, expect, it } from "vitest";
import { applyExampleChoice } from "../../lib/engine/parse";
import {
  applicationTier, investmentRatio, resolveTerritory, territoriesForPin, validate,
} from "../../lib/engine/validate";
import type { Application, Flag, FlagCode, Territory } from "../../lib/engine/types";
import { TODAY, mkApp, mkInput, mkTer, reading } from "../helpers/fixtures";
import { appRow, APP_HEADERS, TER_HEADERS, makeWorkbook } from "../helpers/workbook";
import { parseWorkbookObject } from "../../lib/engine/parse";

function flagsFor(app: Application, extra: Application[] = [], territories: Territory[] = [mkTer()], readings: ReturnType<typeof reading>[] = []) {
  const res = validate(mkInput([app, ...extra], territories), undefined, { today: TODAY, readings });
  return res.applications[app.id];
}
const codes = (flags: Flag[]) => flags.map((f) => f.code);
const find = (flags: Flag[], code: FlagCode) => flags.find((f) => f.code === code);

describe("clean applicant", () => {
  it("has no flags", () => {
    expect(flagsFor(mkApp({ id: "APP-1" }))).toEqual([]);
  });
});

describe("blockers (HOLD)", () => {
  it("MISSING_ID", () => {
    const a = mkApp({ id: "ROW-7", sourceId: "" });
    expect(codes(flagsFor(a))).toContain("MISSING_ID");
  });
  it("DUPLICATE_ID flags every row sharing the ID", () => {
    const a = mkApp({ id: "APP-2", name: "A One" });
    const b = mkApp({ id: "APP-2#2", sourceId: "APP-2", name: "B Two", pin: "560008" });
    const res = validate(mkInput([a, b]), undefined, { today: TODAY });
    expect(codes(res.applications["APP-2"])).toContain("DUPLICATE_ID");
    expect(codes(res.applications["APP-2#2"])).toContain("DUPLICATE_ID");
    expect(res.alerts.some((x) => x.code === "DUPLICATE_ID")).toBe(true);
  });
  it("MISSING_REQUIRED lists every missing field with a question", () => {
    const f = find(flagsFor(mkApp({ id: "APP-3", name: null, experienceYears: null, spaceAvailable: null })), "MISSING_REQUIRED")!;
    expect(f.severity).toBe("blocker");
    expect(f.message).toContain("applicant name");
    expect(f.message).toContain("retail experience");
    expect(f.message).toContain("space available");
    expect(f.question).toMatch(/Please provide/);
  });
  it("MISSING_REQUIRED mentions text that could not be read", () => {
    const a = mkApp({ id: "APP-3b", investmentLakh: null, raw: { investmentLakh: "lots" }, parseIssues: [{ code: "UNPARSEABLE_VALUE", field: "investmentLakh", raw: "lots", message: "x" }] });
    expect(find(flagsFor(a), "MISSING_REQUIRED")!.message).toContain("lots");
  });
  it("INVALID_PIN for a short pin, but not when the pin is just blank", () => {
    expect(codes(flagsFor(mkApp({ id: "APP-4", pin: "5700" })))).toContain("INVALID_PIN");
    const blank = flagsFor(mkApp({ id: "APP-4b", pin: null }));
    expect(codes(blank)).not.toContain("INVALID_PIN");
    expect(codes(blank)).toContain("MISSING_REQUIRED");
  });
  it("CITY_NOT_ALLOWED", () => {
    const f = find(flagsFor(mkApp({ id: "APP-5", city: "Pune", pin: "411001" })), "CITY_NOT_ALLOWED")!;
    expect(f.severity).toBe("blocker");
    expect(f.message).toContain("Pune");
  });
  it("CITY_PIN_MISMATCH names the pin's real city and area, and uses note signals", () => {
    const a = mkApp({ id: "APP-6", city: "Mysuru", pin: "560034" });
    const flags = flagsFor(a, [], [mkTer()], [
      reading("APP-6", [{ type: "info", field: "city", value: "Mysuru", impact: 0, quote: "near Devaraja Market", text: "x" }]),
    ]);
    const f = find(flags, "CITY_PIN_MISMATCH")!;
    expect(f.severity).toBe("blocker");
    expect(f.message).toContain("Mysuru");
    expect(f.message).toContain("Bengaluru");
    expect(f.message).toContain("near Devaraja Market");
    expect(f.message).toContain("supports the city");
    expect(f.question).toMatch(/Mysuru or Bengaluru/);
  });
  it("CITY_PIN_MISMATCH also fires for a pin outside every brand city", () => {
    expect(codes(flagsFor(mkApp({ id: "APP-6b", pin: "400001" })))).toContain("CITY_PIN_MISMATCH");
  });
  it("INVESTMENT_OUTLIER above 150 lakh", () => {
    expect(find(flagsFor(mkApp({ id: "APP-7", investmentLakh: 151 })), "INVESTMENT_OUTLIER")?.severity).toBe("blocker");
    expect(codes(flagsFor(mkApp({ id: "APP-7b", investmentLakh: 140 })))).not.toContain("INVESTMENT_OUTLIER");
  });
  it("INVESTMENT_OUTLIER above 4x the tier need (Tier 3: 88 lakh)", () => {
    const t3 = (inv: number) => mkApp({ id: `APP-8-${inv}`, city: "Tumakuru", pin: "572101", investmentLakh: inv });
    const ter = [mkTer({ id: "TER-T", city: "Tumakuru", pins: ["572101"], tier: 3, statedTier: 3 })];
    expect(codes(flagsFor(t3(89), [], ter))).toContain("INVESTMENT_OUTLIER");
    expect(codes(flagsFor(t3(88), [], ter))).not.toContain("INVESTMENT_OUTLIER");
  });
  it("INVESTMENT_CONTRADICTION when the notes disagree and the figure is not an outlier", () => {
    const flags = flagsFor(mkApp({ id: "APP-9", investmentLakh: 45 }), [], [mkTer()], [
      reading("APP-9", [{ type: "contradiction", field: "investment", value: 30, impact: 0, quote: "about 30 lakh", text: "x" }]),
    ]);
    const f = find(flags, "INVESTMENT_CONTRADICTION")!;
    expect(f.severity).toBe("blocker");
    expect(f.question).toContain("30 lakh");
  });
  it("outlier plus contradiction quotes the notes in the question", () => {
    const flags = flagsFor(mkApp({ id: "APP-9b", investmentLakh: 300 }), [], [mkTer()], [
      reading("APP-9b", [{ type: "contradiction", field: "investment", value: 30, impact: 0, quote: "about 30 lakh", text: "x" }]),
    ]);
    expect(find(flags, "INVESTMENT_OUTLIER")!.question).toContain("30 lakh");
    expect(codes(flags)).toContain("INVESTMENT_CONTRADICTION");
  });
  it("PROBABLE_DUPLICATE holds the later row and lists differing fields on both", () => {
    const first = mkApp({ id: "APP-10", name: "Pooja Menon", investmentLakh: 35 });
    const second = mkApp({ id: "APP-11", name: "pooja  menon", investmentLakh: 38 });
    const res = validate(mkInput([first, second]), undefined, { today: TODAY });
    const dup = find(res.applications["APP-11"], "PROBABLE_DUPLICATE")!;
    expect(dup.severity).toBe("blocker");
    expect(dup.related).toEqual(["APP-10"]);
    expect(dup.message).toContain("35 vs 38");
    const early = find(res.applications["APP-10"], "HAS_PROBABLE_DUPLICATE")!;
    expect(early.severity).toBe("warning");
    expect(early.message).toContain("APP-11");
    expect(codes(res.applications["APP-10"])).not.toContain("PROBABLE_DUPLICATE");
  });
});

describe("conditions", () => {
  const ratio = (inv: number, tier1 = true) => {
    const need = 35;
    return flagsFor(mkApp({ id: `APP-${inv}`, investmentLakh: inv * (tier1 ? need : need) }));
  };
  it("FIN_GAP between 85% and 100% of need, none at exactly 100%", () => {
    expect(codes(ratio(0.85))).toContain("FIN_GAP");
    expect(codes(ratio(0.99))).toContain("FIN_GAP");
    expect(codes(ratio(1))).not.toContain("FIN_GAP");
  });
  it("FIN_GAP_LARGE between 60% and 85%, nothing below 60% (that's a rejection, decided by the score)", () => {
    expect(codes(ratio(0.6))).toContain("FIN_GAP_LARGE");
    expect(codes(ratio(0.84))).toContain("FIN_GAP_LARGE");
    expect(codes(ratio(0.85))).not.toContain("FIN_GAP_LARGE");
    const low = codes(ratio(0.59));
    expect(low).not.toContain("FIN_GAP");
    expect(low).not.toContain("FIN_GAP_LARGE");
  });
  it("finance bands use the city table tier, not the territory's stated tier (D9)", () => {
    const a = mkApp({ id: "APP-D", city: "Davanagere", pin: "577001", investmentLakh: 18 });
    const ter = [mkTer({ id: "TER-10", city: "Davanagere", pins: ["577001"], statedTier: 2, tier: 3 })];
    const f = find(flagsFor(a, [], ter), "FIN_GAP_LARGE")!;
    expect(f.message).toContain("82%");
    expect(investmentRatio(a)).toBeCloseTo(18 / 22);
  });
  it("FIND_SPACE", () => {
    const flags = flagsFor(mkApp({ id: "APP-12", spaceAvailable: "Not yet identified", spaceSize: null, floor: "Not known" }));
    expect(codes(flags)).toContain("FIND_SPACE");
    expect(codes(flags)).not.toContain("SPACE_CONTRADICTION");
    expect(codes(flags)).not.toContain("CONFIRM_SIZE");
  });
  it("SPACE_CONTRADICTION when 'not identified' but size or floor is filled", () => {
    const flags = flagsFor(mkApp({ id: "APP-13", spaceAvailable: "Not yet identified", spaceSize: 400, floor: "Ground" }));
    expect(codes(flags)).toEqual(expect.arrayContaining(["FIND_SPACE", "SPACE_CONTRADICTION"]));
    expect(find(flags, "SPACE_CONTRADICTION")!.message).toContain("400 sq ft");
  });
  it("NEED_GROUND_FLOOR", () => {
    expect(codes(flagsFor(mkApp({ id: "APP-14", floor: "Upper" })))).toContain("NEED_GROUND_FLOOR");
    expect(codes(flagsFor(mkApp({ id: "APP-14b", floor: "Mall unit" })))).not.toContain("NEED_GROUND_FLOOR");
  });
  it("SPACE_TOO_SMALL below 300, fine at exactly 300", () => {
    expect(codes(flagsFor(mkApp({ id: "APP-15", spaceSize: 299 })))).toContain("SPACE_TOO_SMALL");
    expect(codes(flagsFor(mkApp({ id: "APP-15b", spaceSize: 300 })))).not.toContain("SPACE_TOO_SMALL");
  });
  it("CONFIRM_SIZE and CONFIRM_FLOOR", () => {
    const flags = flagsFor(mkApp({ id: "APP-16", spaceSize: null, floor: null }));
    expect(codes(flags)).toEqual(expect.arrayContaining(["CONFIRM_SIZE", "CONFIRM_FLOOR"]));
    expect(codes(flagsFor(mkApp({ id: "APP-16b", floor: "Not known" })))).toContain("CONFIRM_FLOOR");
  });
  it("'Identified (ownership unconfirmed)' is treated like a space (no FIND_SPACE)", () => {
    const flags = flagsFor(mkApp({ id: "APP-17", spaceAvailable: "Identified (ownership unconfirmed)", spaceSize: null, floor: "Ground" }));
    expect(codes(flags)).toContain("CONFIRM_SIZE");
    expect(codes(flags)).not.toContain("FIND_SPACE");
  });
  it("LOAN_DEPENDENT from a finance signal", () => {
    const flags = flagsFor(mkApp({ id: "APP-18" }), [], [mkTer()], [
      reading("APP-18", [{ type: "finance", impact: -2, quote: "if our bank loan is not approved", text: "x" }]),
    ]);
    const f = find(flags, "LOAN_DEPENDENT")!;
    expect(f.severity).toBe("condition");
    expect(f.message).toContain("bank loan");
  });
});

describe("warnings and info", () => {
  it("STATE_MISMATCH", () => {
    expect(codes(flagsFor(mkApp({ id: "APP-20", state: "Kerala" })))).toContain("STATE_MISMATCH");
    expect(codes(flagsFor(mkApp({ id: "APP-20b", state: null })))).not.toContain("STATE_MISMATCH");
  });
  it("ZERO_EXPERIENCE", () => {
    expect(codes(flagsFor(mkApp({ id: "APP-21", experienceYears: 0 })))).toContain("ZERO_EXPERIENCE");
  });
  it("OVERSIZED_SPACE above 1500 sq ft", () => {
    expect(codes(flagsFor(mkApp({ id: "APP-22", spaceSize: 1501 })))).toContain("OVERSIZED_SPACE");
    expect(codes(flagsFor(mkApp({ id: "APP-22b", spaceSize: 1500 })))).not.toContain("OVERSIZED_SPACE");
  });
  it("DEADLINE_UNREACHABLE when a deadline falls inside the minimum timeline", () => {
    const sig = (date: string) => reading("APP-23", [{ type: "deadline", impact: 0, date, quote: "before Diwali", text: "x" }]);
    const a = mkApp({ id: "APP-23" });
    expect(codes(flagsFor(a, [], [mkTer()], [sig("2026-11-08")]))).toContain("DEADLINE_UNREACHABLE");
    expect(codes(flagsFor(a, [], [mkTer()], [sig("2027-10-29")]))).not.toContain("DEADLINE_UNREACHABLE");
  });
  it("OUTSIDE_CITY_CORE for a pin far from the centre", () => {
    expect(codes(flagsFor(mkApp({ id: "APP-24", pin: "560112" }), [], [mkTer({ pins: ["560112"] })]))).toContain("OUTSIDE_CITY_CORE");
  });
  it("APPROX_COORDS for a valid pin with no coordinates on file", () => {
    expect(codes(flagsFor(mkApp({ id: "APP-25", pin: "560999" }), [], [mkTer({ pins: ["560999"] })]))).toContain("APPROX_COORDS");
  });
  it("NO_TERRITORY when no territory lists the pin", () => {
    const f = find(flagsFor(mkApp({ id: "APP-26", pin: "560100" })), "NO_TERRITORY")!;
    expect(f.severity).toBe("warning");
    expect(f.message).toContain("560100");
  });
  it("NO_TERRITORY is not added on top of a city/pin mismatch", () => {
    expect(codes(flagsFor(mkApp({ id: "APP-26b", city: "Mysuru", pin: "560100" })))).not.toContain("NO_TERRITORY");
  });
  it("PIN_IN_MULTIPLE_TERRITORIES picks higher priority, then lower ID", () => {
    const a = mkApp({ id: "APP-27", city: "Mysuru", pin: "570002" });
    const t5 = mkTer({ id: "TER-05", city: "Mysuru", pins: ["570002"], priority: "High" });
    const t11 = mkTer({ id: "TER-11", city: "Mysuru", pins: ["570002"], priority: "Medium" });
    const f = find(flagsFor(a, [], [t11, t5]), "PIN_IN_MULTIPLE_TERRITORIES")!;
    expect(f.message).toContain("Using TER-05");
    expect(resolveTerritory("570002", [t11, t5])?.id).toBe("TER-05");
    const tie = [mkTer({ id: "TER-09", pins: ["570002"], priority: "Low" }), mkTer({ id: "TER-02", pins: ["570002"], priority: "Low" })];
    expect(territoriesForPin("570002", tie).map((t) => t.id)).toEqual(["TER-02", "TER-09"]);
    expect(resolveTerritory("111111", tie)).toBeNull();
  });
  it("SAME_APPLICANT_MULTIPLE for the same name at different pins", () => {
    const a = mkApp({ id: "APP-28", name: "Arjun Reddy", pin: "560095" });
    const b = mkApp({ id: "APP-29", name: "Arjun Reddy", pin: "560008" });
    const res = validate(mkInput([a, b]), undefined, { today: TODAY });
    expect(find(res.applications["APP-28"], "SAME_APPLICANT_MULTIPLE")!.related).toEqual(["APP-29"]);
    expect(codes(res.applications["APP-29"])).toContain("SAME_APPLICANT_MULTIPLE");
    expect(codes(res.applications["APP-29"])).not.toContain("PROBABLE_DUPLICATE");
  });
  it("turns parser issues into flags", () => {
    const wb = makeWorkbook({
      applications: { headers: APP_HEADERS, rows: [appRow({ id: "APP-30", inv: "25,00,000", floor: "rooftop", exp: "lots" })] },
      territories: { headers: TER_HEADERS, rows: [["TER-02", "Bengaluru", "Karnataka", "560095, 12345", "Tier 1", 2, "High"]] },
    });
    const { input } = parseWorkbookObject(wb);
    const res = validate(input, undefined, { today: TODAY });
    expect(codes(res.applications["APP-30"])).toEqual(expect.arrayContaining(["CONVERTED_UNITS", "UNKNOWN_VALUE", "UNPARSEABLE_VALUE"]));
    expect(codes(res.territories["TER-02"])).toContain("INVALID_PIN_TOKEN");
  });
});

describe("territory validation", () => {
  const run = (t: Territory[], extra: Application[] = []) => validate(mkInput(extra, t), undefined, { today: TODAY }).territories;

  it("TIER_MISMATCH: the city table wins and the flag says so", () => {
    const res = run([mkTer({ id: "TER-10", city: "Davanagere", pins: ["577001"], statedTier: 2, tier: 3 })]);
    const f = find(res["TER-10"], "TIER_MISMATCH")!;
    expect(f.message).toBe("TER-10 says Tier 2, but Davanagere is Tier 3 per the brand's city list. Using Tier 3.");
  });
  it("TER_MISSING_ID and DUPLICATE_TERRITORY_ID", () => {
    const a = mkTer({ id: "TER-01", pins: ["560095"] });
    const b = mkTer({ id: "TER-01#2", sourceId: "TER-01", pins: ["560008"] });
    const c = mkTer({ id: "ROW-9", sourceId: "", pins: ["560041"] });
    const res = run([a, b, c]);
    expect(codes(res["TER-01"])).toContain("DUPLICATE_TERRITORY_ID");
    expect(codes(res["TER-01#2"])).toContain("DUPLICATE_TERRITORY_ID");
    expect(codes(res["ROW-9"])).toContain("TER_MISSING_ID");
  });
  it("TER_NO_PINS", () => {
    expect(codes(run([mkTer({ pins: [] })])["TER-A"])).toContain("TER_NO_PINS");
  });
  it("TER_BAD_SLOTS for missing and negative, TER_ZERO_SLOTS for zero", () => {
    expect(codes(run([mkTer({ openSlots: null })])["TER-A"])).toContain("TER_BAD_SLOTS");
    expect(codes(run([mkTer({ openSlots: -2 })])["TER-A"])).toContain("TER_BAD_SLOTS");
    const zero = codes(run([mkTer({ openSlots: 0 })])["TER-A"]);
    expect(zero).toContain("TER_ZERO_SLOTS");
    expect(zero).not.toContain("TER_BAD_SLOTS");
  });
  it("TER_CITY_NOT_ALLOWED", () => {
    expect(codes(run([mkTer({ city: "Pune", tier: null, statedTier: null })])["TER-A"])).toContain("TER_CITY_NOT_ALLOWED");
  });
  it("TER_PIN_HAS_STORE names the store", () => {
    const f = find(run([mkTer({ pins: ["560038", "560095"] })])["TER-A"], "TER_PIN_HAS_STORE")!;
    expect(f.severity).toBe("info");
    expect(f.message).toContain("ST-03");
    expect(f.message).toContain("Indiranagar");
  });
  it("TER_PIN_OUT_OF_CITY", () => {
    const f = find(run([mkTer({ pins: ["560095", "570001"] })])["TER-A"], "TER_PIN_OUT_OF_CITY")!;
    expect(f.message).toContain("570001");
  });
  it("TER_PRIORITY_UNKNOWN", () => {
    expect(codes(run([mkTer({ priority: null })])["TER-A"])).toContain("TER_PRIORITY_UNKNOWN");
  });
  it("flags a pin shared by two territories on both and raises one alert", () => {
    const a = mkTer({ id: "TER-05", city: "Mysuru", pins: ["570002"], tier: 2, statedTier: 2 });
    const b = mkTer({ id: "TER-11", city: "Mysuru", pins: ["570002"], tier: 2, statedTier: 2 });
    const res = validate(mkInput([], [a, b]), undefined, { today: TODAY });
    expect(codes(res.territories["TER-05"])).toContain("PIN_IN_MULTIPLE_TERRITORIES");
    expect(codes(res.territories["TER-11"])).toContain("PIN_IN_MULTIPLE_TERRITORIES");
    expect(res.alerts.filter((x) => x.code === "PIN_IN_MULTIPLE_TERRITORIES")).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("applicationTier uses the city table, then the pin's city", () => {
    expect(applicationTier({ city: "Davanagere", pin: "577001" })).toBe(3);
    expect(applicationTier({ city: "Unknown", pin: "560001" })).toBe(1);
    expect(applicationTier({ city: null, pin: null })).toBeNull();
  });
  it("is deterministic", () => {
    const input = mkInput([mkApp({ id: "APP-40", state: "Kerala" })]);
    expect(validate(input, undefined, { today: TODAY })).toEqual(validate(input, undefined, { today: TODAY }));
  });
  it("re-validates after including the example row", () => {
    const wb = makeWorkbook({
      applications: { headers: APP_HEADERS, rows: [["APP-001", "Ravi Kumar", "Mysuru", "Karnataka", 570001, 25, 4, "Runs a footwear store", "Rented", 450, "Ground", 3, "Kannada", "Wants to open before Diwali"]] },
    });
    const r = parseWorkbookObject(wb);
    const withExample = applyExampleChoice(r.input, { includeExampleApplication: true });
    const res = validate(withExample, undefined, { today: TODAY });
    expect(res.applications["APP-001"]).toBeDefined();
  });
});
