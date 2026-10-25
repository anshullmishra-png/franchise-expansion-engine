import { describe, expect, it } from "vitest";
import {
  normaliseHeader, normaliseName, parseCity, parseFloor, parseLanguage, parseNumber, parsePin,
  parsePinList, parsePriority, parseSpaceAvailable, parseState, parseTier,
} from "../../lib/engine/normalise";

describe("parseNumber", () => {
  it("reads plain numbers and numeric strings", () => {
    expect(parseNumber(25).value).toBe(25);
    expect(parseNumber("25").value).toBe(25);
    expect(parseNumber(" 4.5 ").value).toBe(4.5);
    expect(parseNumber("5 years").value).toBe(5);
    expect(parseNumber("450 sq ft").value).toBe(450);
  });
  it("treats blank as empty, not invalid", () => {
    expect(parseNumber(null)).toEqual({ value: null, invalid: false });
    expect(parseNumber("  ")).toEqual({ value: null, invalid: false });
  });
  it("flags text without a number and negatives", () => {
    expect(parseNumber("lots")).toEqual({ value: null, invalid: true });
    expect(parseNumber(-3).invalid).toBe(true);
    expect(parseNumber("-3").invalid).toBe(true);
  });
  it("reads lakh/crore units for investment", () => {
    expect(parseNumber("25 lakh", { lakh: true }).value).toBe(25);
    expect(parseNumber("₹25L", { lakh: true }).value).toBe(25);
    expect(parseNumber("1.2 cr", { lakh: true })).toMatchObject({ value: 120, converted: "crore" });
  });
  it("converts rupees above 1000 to lakh and says so", () => {
    expect(parseNumber("25,00,000", { lakh: true })).toMatchObject({ value: 25, converted: "rupees" });
    expect(parseNumber(2500000, { lakh: true })).toMatchObject({ value: 25, converted: "rupees" });
    expect(parseNumber(300, { lakh: true })).toEqual({ value: 300, invalid: false });
  });
  it("does not convert rupees for non-lakh fields", () => {
    expect(parseNumber(5000).value).toBe(5000);
  });
});

describe("pins", () => {
  it("normalises single pins", () => {
    expect(parsePin(570001)).toBe("570001");
    expect(parsePin("570001.0")).toBe("570001");
    expect(parsePin(" 570 001 ")).toBe("570001");
    expect(parsePin("5700")).toBe("5700");
    expect(parsePin(null)).toBeNull();
  });
  it("splits pin lists on commas, semicolons, spaces and newlines", () => {
    expect(parsePinList("570001, 570002; 570008").pins).toEqual(["570001", "570002", "570008"]);
    expect(parsePinList("570001 570002\n570008").pins).toEqual(["570001", "570002", "570008"]);
    expect(parsePinList(570001).pins).toEqual(["570001"]);
  });
  it("keeps bad tokens separate and drops duplicates", () => {
    const r = parsePinList("570001, 57000, abc, 570001");
    expect(r.pins).toEqual(["570001"]);
    expect(r.invalid).toEqual(["57000", "abc"]);
  });
});

describe("fixed lists", () => {
  it("matches case-insensitively with aliases", () => {
    expect(parseSpaceAvailable("owned").value).toBe("Owned");
    expect(parseSpaceAvailable("NOT YET").value).toBe("Not yet identified");
    expect(parseSpaceAvailable("banana")).toEqual({ value: null, unknown: true });
    expect(parseSpaceAvailable("")).toEqual({ value: null, unknown: false });
    expect(parseFloor("ground floor").value).toBe("Ground");
    expect(parseFloor("First floor").value).toBe("Upper");
    expect(parseFloor("mall").value).toBe("Mall unit");
    expect(parseFloor("Not known").value).toBe("Not known");
    expect(parseFloor("rooftop").unknown).toBe(true);
    expect(parseLanguage("hindi").value).toBe("Hindi");
    expect(parseLanguage("Tamil").unknown).toBe(true);
    expect(parsePriority("med").value).toBe("Medium");
    expect(parseTier("Tier 2").value).toBe(2);
    expect(parseTier("3").value).toBe(3);
    expect(parseTier("Tier 9").unknown).toBe(true);
  });
  it("recognises cities and common alternate spellings", () => {
    expect(parseCity("bangalore")).toEqual({ city: "Bengaluru", known: true });
    expect(parseCity("MYSORE")).toEqual({ city: "Mysuru", known: true });
    expect(parseCity("Hubli")).toEqual({ city: "Hubballi-Dharwad", known: true });
    expect(parseCity("Hubballi Dharwad")).toEqual({ city: "Hubballi-Dharwad", known: true });
    expect(parseCity("Pune")).toEqual({ city: "Pune", known: false });
    expect(parseCity("")).toEqual({ city: null, known: false });
    expect(parseState("ka")).toBe("Karnataka");
  });
  it("normalises headers and names", () => {
    expect(normaliseHeader("Investment capacity (₹ lakh)")).toBe("investment capacity lakh");
    expect(normaliseName("  Pooja  Menon. ")).toBe("pooja menon");
  });
});
