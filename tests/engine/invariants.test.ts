import { describe, expect, it } from "vitest";
import { DEFAULT_ASSUMPTIONS as A } from "../../lib/engine/assumptions";
import { InvariantError, checkInvariants, type InvariantInput, type PlacedStore } from "../../lib/engine/invariants";
import { DEFAULT_EXISTING_STORES } from "../../lib/engine/reference";
import { mkApp, mkTer } from "../helpers/fixtures";

const terA = mkTer({ id: "TER-A", pins: ["560095", "560008", "560017", "560038", "560071", "560048"], openSlots: 2 });
const terZero = mkTer({ id: "TER-Z", pins: ["560041"], openSlots: 0 });
const apps = [
  mkApp({ id: "APP-1", name: "Asha Rao" }),
  mkApp({ id: "APP-2", name: "Bela Shah" }),
  mkApp({ id: "APP-3", name: "Chitra Nair" }),
  mkApp({ id: "APP-4", name: "Asha  Rao" }),
];

const check = (allocations: PlacedStore[], territories = [terA, terZero]) =>
  checkInvariants({ allocations, territories, existingStores: DEFAULT_EXISTING_STORES, applications: apps, assumptions: A } satisfies InvariantInput);
const rules = (r: ReturnType<typeof check>) => [...new Set(r.violations.map((v) => v.rule))].sort();

describe("placement-rule checker", () => {
  it("passes a clean allocation and an empty one", () => {
    expect(check([]).ok).toBe(true);
    const r = check([{ applicationId: "APP-1", territoryId: "TER-A", pin: "560095" }, { applicationId: "APP-2", territoryId: "TER-A", pin: "560017" }]);
    expect(r).toMatchObject({ ok: true, checked: 2 });
  });
  it("H1: catches a store at a pin that already has one", () => {
    const r = check([{ applicationId: "APP-1", territoryId: "TER-A", pin: "560038" }]);
    expect(rules(r)).toContain("H1");
    expect(r.violations.find((v) => v.rule === "H1")!.message).toContain("ST-03");
  });
  it("H2: catches two stores at one pin", () => {
    const r = check([{ applicationId: "APP-1", territoryId: "TER-A", pin: "560095" }, { applicationId: "APP-2", territoryId: "TER-A", pin: "560095" }]);
    expect(rules(r)).toContain("H2");
  });
  it("H3: catches more stores than open slots", () => {
    const r = check([
      { applicationId: "APP-1", territoryId: "TER-A", pin: "560095" },
      { applicationId: "APP-2", territoryId: "TER-A", pin: "560017" },
      { applicationId: "APP-3", territoryId: "TER-A", pin: "560048" },
    ]);
    expect(rules(r)).toContain("H3");
  });
  it("H4: catches a store in a zero-slot territory, an unknown territory, or a pin the territory doesn't list", () => {
    expect(rules(check([{ applicationId: "APP-1", territoryId: "TER-Z", pin: "560041" }]))).toContain("H4");
    expect(rules(check([{ applicationId: "APP-1", territoryId: "TER-NOPE", pin: "560095" }]))).toContain("H4");
    expect(rules(check([{ applicationId: "APP-1", territoryId: "TER-A", pin: "560041" }]))).toContain("H4");
  });
  it("H5: catches 45%+ overlap with an existing store", () => {
    const r = check([{ applicationId: "APP-1", territoryId: "TER-A", pin: "560008" }]); // 1.7 km from ST-03
    expect(rules(r)).toContain("H5");
    expect(r.violations.find((v) => v.rule === "H5")!.ids).toContain("ST-03");
  });
  it("H5: catches 45%+ overlap between two new stores", () => {
    const r = check([{ applicationId: "APP-1", territoryId: "TER-A", pin: "560095" }, { applicationId: "APP-2", territoryId: "TER-A", pin: "560071" }]);
    expect(r.violations.some((v) => v.rule === "H5" && v.ids.includes("APP-1") && v.ids.includes("APP-2"))).toBe(false); // 44.1%: just under the limit
    const tight = check([{ applicationId: "APP-1", territoryId: "TER-A", pin: "560017" }, { applicationId: "APP-2", territoryId: "TER-A", pin: "560071" }]);
    expect(tight.ok).toBe(true); // 38.7%
    const same = mkTer({ id: "TER-S", pins: ["572101", "572102"], openSlots: 2, city: "Tumakuru", tier: 3 });
    const apps2 = [mkApp({ id: "APP-1", name: "A B", city: "Tumakuru", pin: "572101" }), mkApp({ id: "APP-2", name: "C D", city: "Tumakuru", pin: "572102" })];
    const r2 = checkInvariants({
      allocations: [{ applicationId: "APP-1", territoryId: "TER-S", pin: "572101" }, { applicationId: "APP-2", territoryId: "TER-S", pin: "572102" }],
      territories: [same], existingStores: DEFAULT_EXISTING_STORES, applications: apps2, assumptions: A,
    });
    expect(rules(r2)).toEqual(["H5"]); // 3 km apart at the Tier 3 radius of 5 km: 62%
  });
  it("H6: catches one person holding two stores (names compared after normalising)", () => {
    const r = check([{ applicationId: "APP-1", territoryId: "TER-A", pin: "560095" }, { applicationId: "APP-4", territoryId: "TER-A", pin: "560017" }]);
    expect(rules(r)).toEqual(["H6"]);
  });
  it("InvariantError carries every violation", () => {
    const r = check([{ applicationId: "APP-1", territoryId: "TER-A", pin: "560038" }]);
    expect(new InvariantError(r).message).toMatch(/H1/);
  });
});
