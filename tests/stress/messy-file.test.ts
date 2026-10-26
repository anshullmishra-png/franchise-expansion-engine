import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { runEngine } from "../../lib/engine";
import { parseWorkbook } from "../../lib/engine/parse";
import { validate } from "../../lib/engine/validate";
import { exportToBytes } from "../../lib/export";

// A judge's "messy" file: the right sheets and columns, but with every quirk a person produces in Excel.
// The whole pipeline (parse, validate, decide, explain, export) must run, and say what it couldn't read.

function messy(): Uint8Array {
  const wb = XLSX.utils.book_new();
  // No title row: the header is on row 1. Extra columns, odd header spellings, trailing spaces.
  const apps = [
    ["Application ID ", "Applicant name", "Extra column nobody asked for", "City ", "State", "PIN", "Investment capacity (Rs lakh)", "Retail experience (yrs)", "Current / past business", "Space available", "Space size (sq ft)", "Floor", "Target launch (months)", "Preferred language", "Notes from applicant", "Remarks"],
    ["APP-101", "  Asha  Rao ", "x", "bangalore", "KA", "560095.0", "₹45 L", "5 years", "Runs a FOOTWEAR shop", "rented", "500 sq ft", "ground floor", "4", "kannada", "", ""],
    ["APP-102", "Bela Shah", "", "Mysore", "Karnataka", " 570001 ", "25,00,000", "4", "optical store", "OWNED", 450, "Mall", "3 months", "Hindi", "Wants to open before Diwali; may need a loan", "call after 5"],
    ["APP-103", "Chitra 😀 Nair", "", "Hubli", "Karnataka", 580021, "1.2 cr", "n/a", "", "not yet", "", "", "", "", "I have 30 lakh only", ""],
    ["", "No ID Person", "", "Mangalore", "Karnataka", "575002", 30, 2, "bakery", "Rented", 350, "first floor", 3, "English", "", ""],
    ["APP-101", "Duplicate Id", "", "Tumkur", "Karnataka", "572101", 22, 3, "mobile shop", "Rented", 380, "Ground", 3, "Hindi", "", ""],
    ["APP-106", "Faint Heart", "", "Pune", "Maharashtra", "411001", 40, 3, "", "Rented", 400, "Ground", 3, "Marathi", "", ""],
    ["APP-107", "=1+1", "", "Davangere", "Karnataka", "577001", 18, "", "hardware", "Owned", 500, "Ground", 99, "Kannada", "x".repeat(3000), ""],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    ["APP-109", "Late Row", "", "Belgaum", "Karnataka", 590003, 28, 6, "pharmacy", "Rented", 420, "Ground", 4, "Kannada", "", ""],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(apps);
  sheet["!merges"] = [{ s: { r: 3, c: 14 }, e: { r: 3, c: 15 } }];
  sheet["!rows"] = [{}, {}, { hidden: true }];
  XLSX.utils.book_append_sheet(wb, sheet, "  APPLICATIONS (final v3) ");
  const ters = [
    ["Territory ID", "City", "State", "Pin codes covered", "City tier", "Open slots", "Priority"],
    ["T-1", "Bengaluru", "Karnataka", "560095;560008\n560071", "tier 1", "2", "high"],
    ["T-2", "Mysuru", "Karnataka", "570001, 570002", "Tier 3", 1, "Medium"],
    ["T-3", "Hubballi-Dharwad", "Karnataka", "580021 580029", "", "one", "Low"],
    ["T-4", "Mangaluru", "Karnataka", "575002", "Tier 2", -2, "urgent"],
    ["T-5", "Tumakuru", "Karnataka", "", "Tier 3", 1, "High"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ters), "territories");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Notes to self"], ["remember to chase APP-103"]]), "Scratch");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("a messy judge file", () => {
  const parsed = parseWorkbook(messy());
  const today = "2026-10-26";

  it("is read, with sensible interpretations and friendly notices", () => {
    expect(parsed.ok).toBe(true);
    const a = Object.fromEntries(parsed.input.applications.map((x) => [x.id, x]));
    expect(a["APP-101"]).toMatchObject({ city: "Bengaluru", state: "Karnataka", pin: "560095", investmentLakh: 45, experienceYears: 5, spaceAvailable: "Rented", spaceSize: 500, floor: "Ground", language: "Kannada" });
    expect(a["APP-101"].name).toBe("Asha Rao");
    expect(a["APP-102"]).toMatchObject({ city: "Mysuru", pin: "570001", investmentLakh: 25, spaceAvailable: "Owned", floor: "Mall unit", targetLaunchMonths: 3 });
    expect(a["APP-103"]).toMatchObject({ city: "Hubballi-Dharwad", investmentLakh: 120, spaceAvailable: "Not yet identified" });
    expect(parsed.input.applications.map((x) => x.id)).toEqual(["APP-101", "APP-102", "APP-103", "ROW-5", "APP-101#2", "APP-106", "APP-107", "APP-109"]);
    expect(parsed.input.territories.map((t) => t.id)).toEqual(["T-1", "T-2", "T-3", "T-4", "T-5"]);
  });

  it("flags what it could not trust instead of guessing", () => {
    const v = validate(parsed.input, undefined, { today });
    const codes = (id: string) => v.applications[id].map((f) => f.code);
    expect(codes("ROW-5")).toEqual(expect.arrayContaining(["MISSING_ID"]));
    expect(codes("APP-101")).toContain("DUPLICATE_ID");
    expect(codes("APP-101#2")).toContain("DUPLICATE_ID");
    expect(codes("APP-106")).toEqual(expect.arrayContaining(["CITY_NOT_ALLOWED", "STATE_MISMATCH"]));
    expect(codes("APP-107")).toEqual(expect.arrayContaining(["MISSING_REQUIRED"]));
    const ter = v.territories;
    expect(ter["T-2"].map((f) => f.code)).toContain("TIER_MISMATCH");
    expect(ter["T-3"].map((f) => f.code)).toEqual(expect.arrayContaining(["TER_BAD_SLOTS"]));
    expect(ter["T-4"].map((f) => f.code)).toEqual(expect.arrayContaining(["TER_BAD_SLOTS"]));
    expect(ter["T-5"].map((f) => f.code)).toContain("TER_NO_PINS");
  });

  it("decides everyone, explains everyone, keeps the placement rules, and exports", () => {
    const res = runEngine(parsed.input, undefined, undefined, { today, simulate: true });
    expect(res.invariants.ok).toBe(true);
    expect(res.decisions).toHaveLength(parsed.input.applications.length);
    for (const d of res.decisions) {
      expect(d.status).toBeTruthy();
      expect(d.headline.length).toBeGreaterThan(5);
      expect(d.why.length).toBeGreaterThan(20);
    }
    expect(res.decisionById["APP-106"].status).toBe("HOLD");
    expect(res.decisionById["ROW-5"].status).toBe("HOLD");
    expect(res.decisionById["APP-101"].status).toBe("HOLD");
    expect(res.decisionById["APP-109"].status).not.toBe("HOLD");
    expect(() => exportToBytes(res)).not.toThrow();
  });
});

describe("hostile and degenerate uploads", () => {
  it("a workbook with only an Applications header is fine", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Application ID", "Applicant name"]]), "Applications");
    const r = parseWorkbook(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer));
    expect(r.ok).toBe(true);
    expect(runEngine(r.input, undefined, undefined, { today: "2026-10-26" }).decisions).toEqual([]);
  });
  it("1000 rows of applicants parse and decide in a reasonable time", () => {
    const rows: (string | number)[][] = [["Application ID", "Applicant name", "City", "State", "Pin code", "Investment capacity", "Retail experience", "Space available"]];
    for (let i = 1; i <= 1000; i++) rows.push([`APP-${i}`, `Person ${i}`, "Bengaluru", "Karnataka", 560000 + (i % 100) + 1, 30 + (i % 30), i % 10, i % 3 ? "Rented" : "Owned"]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Applications");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Territory ID", "City", "State", "Pin codes covered", "City tier", "Open slots", "Priority"], ["TER-1", "Bengaluru", "Karnataka", "560095, 560008, 560071, 560017, 560048, 560067", "Tier 1", 3, "High"]]), "Territories");
    const t0 = performance.now();
    const r = parseWorkbook(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer));
    const res = runEngine(r.input, undefined, undefined, { today: "2026-10-26", simulate: false });
    expect(res.decisions).toHaveLength(1000);
    expect(res.invariants.ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(15_000);
  });
});
