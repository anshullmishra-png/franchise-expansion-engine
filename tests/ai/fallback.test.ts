import { describe, expect, it } from "vitest";
import { classifyBusiness, extractNotesFallback } from "../../lib/ai/fallback";
import type { Application } from "../../lib/engine/types";

type Reading = Pick<Application, "id" | "city" | "investmentLakh" | "floor" | "business" | "notes">;
const base: Reading = { id: "APP-1", city: "Mysuru", investmentLakh: 30, floor: "Ground", business: null, notes: null };
const read = (over: Partial<Reading>) => extractNotesFallback([{ ...base, ...over }], "2026-10-25")[0];

describe("classifyBusiness", () => {
  it("applies the keyword rules from AI_PROMPTS §1", () => {
    expect(classifyBusiness("Runs two optical stores in Jayanagar")).toBe("eyewear_optical_watches");
    expect(classifyBusiness("Runs a watch and eyewear store")).toBe("eyewear_optical_watches");
    expect(classifyBusiness("Owns a jewellery store and a footwear franchise")).toBe("specialty_retail");
    expect(classifyBusiness("Family runs a bakery")).toBe("general_or_food_retail");
    expect(classifyBusiness("Worked as a store manager at a large apparel chain for 1 year")).toBe("retail_manager");
    expect(classifyBusiness("IT professional, wants to start own business")).toBe("salaried_non_retail");
    expect(classifyBusiness("Former regional manager at a national optical chain")).toBe("eyewear_optical_watches");
    expect(classifyBusiness("")).toBe("unknown");
    expect(classifyBusiness(null)).toBe("unknown");
  });
});

describe("extractNotesFallback", () => {
  it("quotes the exact sentence for an investment contradiction", () => {
    const r = read({ investmentLakh: 300, notes: "Investment of about 30 lakh from my savings" });
    const s = r.signals.find((x) => x.type === "contradiction")!;
    expect(s).toMatchObject({ field: "investment", value: 30, quote: "Investment of about 30 lakh from my savings" });
  });
  it("ignores a lakh figure that matches the column or isn't about investment", () => {
    expect(read({ notes: "Investment of about 30 lakh" }).signals).toEqual([]);
    expect(read({ notes: "Rent is 2 lakh a year" }).signals).toEqual([]);
  });
  it("finds loan dependence and withdrawal risk, quoting the sentence", () => {
    const r = read({ notes: "My husband is unsure; we may withdraw if our bank loan is not approved by December" });
    expect(r.signals.find((s) => s.type === "finance")).toMatchObject({ impact: -2 });
    expect(r.signals.find((s) => s.type === "red")?.quote).toContain("may withdraw");
  });
  it("turns a festival into a dated deadline", () => {
    const s = read({ notes: "Please help us open before Diwali" }).signals.find((x) => x.type === "deadline")!;
    expect(s.date).toBe("2026-11-08");
  });
  it("picks the next Diwali once this year's has passed", () => {
    const s = extractNotesFallback([{ ...base, notes: "before Diwali" }], "2026-12-01")[0].signals.find((x) => x.type === "deadline")!;
    expect(s.date).toBe("2027-10-29");
  });
  it("points at a city when the notes mention a landmark", () => {
    const s = read({ notes: "Prime location near Devaraja Market" }).signals.find((x) => x.field === "city")!;
    expect(s.value).toBe("Mysuru");
  });
  it("detects prior franchise experience and keeps total impact small", () => {
    const r = read({ business: "Owns a footwear franchise", notes: "Have run a franchise before, know the process" });
    expect(r.priorFranchise).toBe(true);
    expect(r.signals.every((s) => Math.abs(s.impact) <= 3)).toBe(true);
  });
  it("never throws on odd text", () => {
    expect(() => read({ notes: "💥\n\n;;;..." })).not.toThrow();
  });
});
