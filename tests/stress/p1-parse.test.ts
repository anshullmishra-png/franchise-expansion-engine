import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractNotesFallback } from "../../lib/ai/fallback";
import { parseWorkbook } from "../../lib/engine/parse";
import { validate } from "../../lib/engine/validate";

// P1 "Done when" checks against the 34-trap stress file (docs/BUILD_PLAN.md, docs/TEST_PLAN.md §2).

const load = (rel: string) => readFileSync(path.join(process.cwd(), rel));
const TODAY = "2026-10-25";

const parsed = parseWorkbook(load("test-data/Stress_Test_Case1.xlsx"));
const readings = extractNotesFallback(parsed.input.applications, TODAY);
const result = validate(parsed.input, undefined, { today: TODAY, readings });
const flagCodes = (id: string) => (result.applications[id] ?? []).map((f) => f.code);
const blockers = (id: string) => (result.applications[id] ?? []).filter((f) => f.severity === "blocker");

describe("stress file: parsing", () => {
  it("reads 34 applications, 12 territories and the 10 fixed stores", () => {
    expect(parsed.ok).toBe(true);
    expect(parsed.input.applications).toHaveLength(34);
    expect(parsed.input.territories).toHaveLength(12);
    expect(parsed.input.existingStores).toHaveLength(10);
  });
  it("ignores the template example row (APP-001) and territory, with notices", () => {
    expect(parsed.input.applications.some((a) => a.id === "APP-001")).toBe(false);
    expect(parsed.notices.some((n) => n.code === "EXAMPLE_ROW_IGNORED" && n.example?.kind === "application" && n.example.id === "APP-001")).toBe(true);
    expect(parsed.input.territories.filter((t) => t.id === "TER-01")).toHaveLength(1);
    expect(parsed.input.territories.find((t) => t.id === "TER-01")?.city).toBe("Bengaluru");
  });
  it("ignores the extra 'Test key (ours)' sheet and other non-data sheets", () => {
    expect(parsed.input.applications.every((a) => /^APP-0\d\d$/.test(a.id))).toBe(true);
  });
  it("matches the public sample file byte for byte", () => {
    expect(load("public/sample/Stress_Test_Case1.xlsx").equals(load("test-data/Stress_Test_Case1.xlsx"))).toBe(true);
  });
});

describe("stress file: validation", () => {
  it.each(["APP-007", "APP-024", "APP-029", "APP-030"])("%s has a blocker (HOLD) with a question", (id) => {
    expect(blockers(id).length).toBeGreaterThan(0);
    expect(blockers(id).some((f) => !!f.question)).toBe(true);
  });
  it("has blockers on those four applicants and no others", () => {
    const held = parsed.input.applications.filter((a) => blockers(a.id).length > 0).map((a) => a.id);
    expect(held).toEqual(["APP-007", "APP-024", "APP-029", "APP-030"]);
  });
  it("APP-007: city says Mysuru but the pin is Bengaluru's", () => {
    expect(flagCodes("APP-007")).toContain("CITY_PIN_MISMATCH");
  });
  it("APP-024: probable duplicate of APP-023", () => {
    const f = result.applications["APP-024"].find((x) => x.code === "PROBABLE_DUPLICATE")!;
    expect(f.related).toEqual(["APP-023"]);
    expect(flagCodes("APP-023")).toContain("HAS_PROBABLE_DUPLICATE");
  });
  it("APP-029: missing fields and an invalid pin, listed precisely", () => {
    expect(flagCodes("APP-029")).toEqual(expect.arrayContaining(["MISSING_REQUIRED", "INVALID_PIN"]));
    const m = result.applications["APP-029"].find((x) => x.code === "MISSING_REQUIRED")!.message;
    expect(m).toContain("applicant name");
    expect(m).toContain("retail experience");
    expect(m).toContain("space available");
  });
  it("APP-030: 300 lakh vs 30 lakh in the notes", () => {
    expect(flagCodes("APP-030")).toEqual(expect.arrayContaining(["INVESTMENT_OUTLIER", "INVESTMENT_CONTRADICTION"]));
  });
  it("TER-10 gets a tier-mismatch flag and is Tier 3", () => {
    const t = parsed.input.territories.find((x) => x.id === "TER-10")!;
    expect(t.tier).toBe(3);
    expect((result.territories["TER-10"] ?? []).map((f) => f.code)).toContain("TIER_MISMATCH");
  });
  it("APP-018 is judged against the Tier 3 need (18/22), not Tier 2", () => {
    expect(result.applications["APP-018"].find((f) => f.code === "FIN_GAP_LARGE")?.message).toContain("82%");
  });
  it("570002 is flagged as being in two territories (TER-05 and TER-11)", () => {
    expect(flagCodes("APP-034")).toContain("PIN_IN_MULTIPLE_TERRITORIES");
    expect(result.alerts.some((a) => a.code === "PIN_IN_MULTIPLE_TERRITORIES" && a.message.includes("570002"))).toBe(true);
  });
  it("flags the same person (APP-003 and APP-035)", () => {
    expect(flagCodes("APP-003")).toContain("SAME_APPLICANT_MULTIPLE");
    expect(flagCodes("APP-035")).toContain("SAME_APPLICANT_MULTIPLE");
  });
  it("flags the other planted traps", () => {
    expect(flagCodes("APP-031")).toEqual(expect.arrayContaining(["STATE_MISMATCH", "SPACE_CONTRADICTION", "FIND_SPACE"]));
    expect(flagCodes("APP-028")).toContain("NO_TERRITORY");
    expect(flagCodes("APP-033")).toContain("LOAN_DEPENDENT");
    expect(flagCodes("APP-008")).toContain("DEADLINE_UNREACHABLE");
    expect(flagCodes("APP-015")).toContain("CONFIRM_SIZE");
    expect(flagCodes("APP-026")).toContain("SPACE_TOO_SMALL");
    expect(flagCodes("APP-006")).toEqual(expect.arrayContaining(["FIND_SPACE", "ZERO_EXPERIENCE"]));
    expect(flagCodes("APP-010")).toEqual(expect.arrayContaining(["FIN_GAP", "NEED_GROUND_FLOOR"]));
  });
  it("TER-12 has zero slots and territories with existing-store pins say so", () => {
    expect((result.territories["TER-12"] ?? []).map((f) => f.code)).toEqual(expect.arrayContaining(["TER_ZERO_SLOTS", "TER_PIN_HAS_STORE"]));
    expect((result.territories["TER-01"] ?? []).map((f) => f.code)).toContain("TER_PIN_HAS_STORE");
  });
  it("every application gets a flag list (possibly empty) and every flag has a plain-language message", () => {
    for (const a of parsed.input.applications) {
      expect(result.applications[a.id]).toBeDefined();
      for (const f of result.applications[a.id]) expect(f.message.length).toBeGreaterThan(5);
    }
  });
});

describe("blank judge template", () => {
  it("parses to 0 applicants without error", () => {
    const r = parseWorkbook(load("test-data/Case1_Franchise_Test_Data_Format.xlsx"));
    expect(r.ok).toBe(true);
    expect(r.input.applications).toHaveLength(0);
    expect(r.input.existingStores).toHaveLength(10);
    expect(r.notices.some((n) => n.code === "EXAMPLE_ROW_IGNORED")).toBe(true);
    expect(r.notices.some((n) => n.level === "error")).toBe(false);
    expect(validate(r.input, undefined, { today: TODAY }).applications).toEqual({});
  });
  it("the public template download is the same file", () => {
    expect(load("public/Case1_Franchise_Test_Data_Format.xlsx").equals(load("test-data/Case1_Franchise_Test_Data_Format.xlsx"))).toBe(true);
  });
});
