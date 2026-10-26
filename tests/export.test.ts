import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { runEngine } from "../lib/engine";
import { parseWorkbook } from "../lib/engine/parse";
import { decisionRows, exportToBytes, territoryRows } from "../lib/export";

const parsed = parseWorkbook(readFileSync(path.join(process.cwd(), "test-data/Stress_Test_Case1.xlsx")));
const result = runEngine(parsed.input, undefined, undefined, { today: "2026-10-25", simulate: false });

describe("Excel export", () => {
  it("has one decisions row per applicant, with status, allocation, score components and explanation", () => {
    const rows = decisionRows(result);
    expect(rows).toHaveLength(34);
    const r012 = rows.find((r) => r["Application ID"] === "APP-012")!;
    expect(r012).toMatchObject({ Status: "Waitlist", "Score (of 100)": 66, "Site readiness (of 20)": 6, "Waitlist position": "#1 of 1 for TER-07" });
    expect(r012["What would change it"]).toBe("");
    const r002 = rows.find((r) => r["Application ID"] === "APP-002")!;
    expect(r002).toMatchObject({ Status: "Approved", "Allocated pin": "560095", Territory: "TER-01" });
    expect(String(r002["Next steps"])).toMatch(/letter of intent/);
    expect(String(r002.Why)).toMatch(/score of 86\/100/);
    const hold = rows.find((r) => r["Application ID"] === "APP-007")!;
    expect(hold).toMatchObject({ Status: "Hold", "Score (of 100)": "" });
    expect(String(hold["Questions for applicant"])).toMatch(/Mysuru or Bengaluru/);
  });
  it("includes 'what would change it' when the run had simulations on", () => {
    const full = runEngine(parsed.input, undefined, undefined, { today: "2026-10-25", simulate: true });
    const r = decisionRows(full).find((x) => x["Application ID"] === "APP-012")!;
    expect(r["What would change it"]).toMatch(/rises from 66 to 74/);
  });
  it("has one territories row per territory with slots and waitlists", () => {
    const rows = territoryRows(result);
    expect(rows).toHaveLength(12);
    expect(rows.find((r) => r["Territory ID"] === "TER-07")).toMatchObject({ "Open slots": 1, Filled: 1, "Waitlist (in order)": "APP-012" });
    expect(String(rows.find((r) => r["Territory ID"] === "TER-05")!["Why slots are unfilled"])).toMatch(/No viable pin/);
  });
  it("writes a real .xlsx that reads back with both sheets", () => {
    const bytes = exportToBytes(result);
    const wb = XLSX.read(bytes, { type: "array" });
    expect(wb.SheetNames).toEqual(["Decisions", "Territories"]);
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Decisions)).toHaveLength(34);
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Territories)).toHaveLength(12);
  });
  it("adds a Notes sheet when the slow what-would-change column was left out", () => {
    const wb = XLSX.read(exportToBytes(result, { whatWouldChangeSkipped: true }), { type: "array" });
    expect(wb.SheetNames).toEqual(["Decisions", "Territories", "Notes"]);
    expect(JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets.Notes))).toMatch(/left blank/);
  });
  it("exports an empty result without crashing", () => {
    const empty = runEngine({ ...parsed.input, applications: [], territories: [] }, undefined, undefined, { today: "2026-10-25" });
    expect(() => exportToBytes(empty)).not.toThrow();
  });
});
