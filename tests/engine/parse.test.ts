import { describe, expect, it } from "vitest";
import { applyExampleChoice, parseWorkbook, parseWorkbookObject } from "../../lib/engine/parse";
import {
  APP_HEADERS, EXAMPLE_APP_ROW, EXAMPLE_TER_ROW, STORE_HEADERS, TER_HEADERS, appRow, makeWorkbook, toBytes,
  type Cell,
} from "../helpers/workbook";

const terRow = (id = "TER-02", pins = "560095, 560008", slots = 2): Cell[] => [
  id, "Bengaluru", "Karnataka", pins, "Tier 1", slots, "High",
];

const basic = (apps: Cell[][], extra = {}) =>
  makeWorkbook({
    applications: { headers: APP_HEADERS, rows: apps },
    territories: { headers: TER_HEADERS, rows: [terRow()] },
    ...extra,
  });

describe("template example row", () => {
  it("is ignored by default with a notice, and can be included without re-reading the file", () => {
    const wb = basic([EXAMPLE_APP_ROW, appRow({ id: "APP-002" })]);
    const r = parseWorkbookObject(wb);
    expect(r.input.applications.map((a) => a.id)).toEqual(["APP-002"]);
    const notice = r.notices.find((n) => n.code === "EXAMPLE_ROW_IGNORED");
    expect(notice?.message).toContain("APP-001 Ravi Kumar");
    expect(notice?.example).toEqual({ kind: "application", id: "APP-001", locked: false });

    const back = applyExampleChoice(r.input, { includeExampleApplication: true });
    expect(back.applications.map((a) => a.id)).toEqual(["APP-001", "APP-002"]);
    expect(back.excludedExamples.applications).toHaveLength(0);
  });
  it("can be included up front via options", () => {
    const r = parseWorkbookObject(basic([EXAMPLE_APP_ROW]), { includeExampleApplication: true });
    expect(r.input.applications.map((a) => a.id)).toEqual(["APP-001"]);
  });
  it("is only ignored when every field matches", () => {
    const edited = [...EXAMPLE_APP_ROW];
    edited[5] = 26;
    const r = parseWorkbookObject(basic([edited]));
    expect(r.input.applications).toHaveLength(1);
  });
  it("stays out for good when another row reuses its ID", () => {
    const r = parseWorkbookObject(basic([EXAMPLE_APP_ROW, appRow({ id: "APP-001", name: "Someone Else" })]), {
      includeExampleApplication: true,
    });
    expect(r.input.applications.map((a) => a.name)).toEqual(["Someone Else"]);
    expect(r.input.excludedExamples.applications[0].locked).toBe(true);
    const forced = applyExampleChoice(r.input, { includeExampleApplication: true });
    expect(forced.applications).toHaveLength(1);
  });
  it("applies to the example territory too", () => {
    const wb = makeWorkbook({
      applications: { headers: APP_HEADERS, rows: [appRow()] },
      territories: { headers: TER_HEADERS, rows: [EXAMPLE_TER_ROW, terRow("TER-02")] },
    });
    const r = parseWorkbookObject(wb);
    expect(r.input.territories.map((t) => t.id)).toEqual(["TER-02"]);
    expect(r.input.excludedExamples.territories[0].locked).toBe(false);
    const back = applyExampleChoice(r.input, { includeExampleTerritory: true });
    expect(back.territories.map((t) => t.id)).toEqual(["TER-01", "TER-02"]);
  });
});

describe("rows and headers", () => {
  it("skips blank rows without stopping at the first one", () => {
    const wb = makeWorkbook({
      applications: {
        headers: APP_HEADERS,
        rows: [appRow({ id: "APP-002" }), [], [null, "  ", null], appRow({ id: "APP-003" }), [], [], appRow({ id: "APP-004" })],
      },
    });
    expect(parseWorkbookObject(wb).input.applications.map((a) => a.id)).toEqual(["APP-002", "APP-003", "APP-004"]);
  });
  it("reads data far down the sheet (template validation runs to row 500)", () => {
    const rows: Cell[][] = [appRow({ id: "APP-002" })];
    for (let i = 0; i < 300; i++) rows.push([]);
    rows.push(appRow({ id: "APP-003" }));
    expect(parseWorkbookObject(basic(rows)).input.applications).toHaveLength(2);
  });
  it("finds the header row within the first 10 rows", () => {
    const wb = makeWorkbook({ applications: { headers: APP_HEADERS, rows: [appRow()], titleRows: 6 } });
    expect(parseWorkbookObject(wb).input.applications).toHaveLength(1);
  });
  it("maps columns by header text, not position", () => {
    const headers = ["NOTES", "pin", "applicant NAME", "application id", "Investment (INR lakh)", "retail experience", "Space Available", "city"];
    const wb = makeWorkbook({
      applications: { headers, rows: [["hello", 560095, "Asha Rao", "APP-002", 45, 3, "owned", "Bangalore"]] },
    });
    const a = parseWorkbookObject(wb).input.applications[0];
    expect(a).toMatchObject({
      id: "APP-002", name: "Asha Rao", pin: "560095", investmentLakh: 45, experienceYears: 3,
      spaceAvailable: "Owned", city: "Bengaluru", notes: "hello",
    });
  });
  it("warns about missing required columns instead of failing", () => {
    const wb = makeWorkbook({ applications: { headers: ["Application ID", "Applicant name"], rows: [["APP-002", "Asha"]] } });
    const r = parseWorkbookObject(wb);
    expect(r.ok).toBe(true);
    expect(r.notices.filter((n) => n.code === "COLUMN_MISSING").length).toBeGreaterThan(0);
  });
  it("reads a combined City, State, Pin code column", () => {
    const headers = [
      "Application ID", "Applicant name", "City · State · Pin code", "Investment capacity (₹ lakh)",
      "Retail experience (years)", "Space available",
    ];
    const wb = makeWorkbook({
      applications: { headers, rows: [["APP-002", "Asha", "Mysuru · Karnataka · 570001", 30, 2, "Rented"]] },
    });
    const r = parseWorkbookObject(wb);
    expect(r.input.applications[0]).toMatchObject({ city: "Mysuru", state: "Karnataka", pin: "570001" });
    expect(r.notices.some((n) => n.code === "COMBINED_LOCATION_COLUMN")).toBe(true);
  });
  it("matches sheet names fuzzily and ignores other sheets", () => {
    const wb = makeWorkbook({
      applications: { headers: APP_HEADERS, rows: [appRow()] },
      territories: { headers: TER_HEADERS, rows: [terRow()] },
      names: { applications: "applications (2026)", territories: "TERRITORIES" },
      extra: { "Test key (ours)": [["ID", "What this row tests"], ["APP-999", "should be ignored"]] },
    });
    const r = parseWorkbookObject(wb);
    expect(r.input.applications.map((a) => a.id)).toEqual(["APP-100"]);
    expect(r.input.territories).toHaveLength(1);
  });
  it("falls back to the header row when the sheet name doesn't say Applications", () => {
    const wb = makeWorkbook({ applications: { headers: APP_HEADERS, rows: [appRow()] }, names: { applications: "Sheet1" } });
    expect(parseWorkbookObject(wb).input.applications).toHaveLength(1);
  });
});

describe("values", () => {
  it("normalises float, string and padded pins", () => {
    const wb = basic([
      appRow({ id: "A1", pin: "560095.0" }), appRow({ id: "A2", pin: " 560 095 " }), appRow({ id: "A3", pin: 560095.0 }),
    ]);
    expect(parseWorkbookObject(wb).input.applications.map((a) => a.pin)).toEqual(["560095", "560095", "560095"]);
  });
  it("converts rupee amounts to lakh and records the issue", () => {
    const a = parseWorkbookObject(basic([appRow({ inv: "25,00,000" })])).input.applications[0];
    expect(a.investmentLakh).toBe(25);
    expect(a.parseIssues.map((i) => i.code)).toContain("CONVERTED_UNITS");
  });
  it("turns unreadable numbers and unknown list values into issues, not crashes", () => {
    const a = parseWorkbookObject(basic([appRow({ inv: "lots", floor: "rooftop", language: "Tamil", space: "maybe" })])).input
      .applications[0];
    expect(a.investmentLakh).toBeNull();
    expect(a.floor).toBeNull();
    expect(a.language).toBeNull();
    expect(a.spaceAvailable).toBeNull();
    expect(a.parseIssues.map((i) => i.code).sort()).toEqual([
      "UNKNOWN_VALUE", "UNKNOWN_VALUE", "UNKNOWN_VALUE", "UNPARSEABLE_VALUE",
    ]);
  });
  it("keeps the raw cell text for quoting", () => {
    const a = parseWorkbookObject(basic([appRow({ notes: "Please help us open before Diwali", floor: "ground" })])).input
      .applications[0];
    expect(a.raw.notes).toBe("Please help us open before Diwali");
    expect(a.raw.floor).toBe("ground");
    expect(a.floor).toBe("Ground");
  });
  it("makes IDs unique: reused IDs get #2, missing IDs get ROW-n", () => {
    const r = parseWorkbookObject(basic([appRow({ id: "APP-002" }), appRow({ id: "APP-002" }), appRow({ id: "" })]));
    expect(r.input.applications.map((a) => a.id)).toEqual(["APP-002", "APP-002#2", "ROW-5"]);
    expect(r.input.applications[1].sourceId).toBe("APP-002");
    expect(r.input.applications[2].sourceId).toBe("");
  });
});

describe("territories and existing stores", () => {
  it("parses pin lists, tier from the city table, slots and priority", () => {
    const wb = makeWorkbook({
      applications: { headers: APP_HEADERS, rows: [appRow()] },
      territories: {
        headers: TER_HEADERS,
        rows: [["TER-10", "Davanagere", "Karnataka", "577001, 577002, 12345", "Tier 2", "1", "high"]],
      },
    });
    const t = parseWorkbookObject(wb).input.territories[0];
    expect(t).toMatchObject({
      pins: ["577001", "577002"], invalidPinTokens: ["12345"], statedTier: 2, tier: 3, openSlots: 1, priority: "High",
    });
    expect(t.parseIssues.map((i) => i.code)).toContain("INVALID_PIN_TOKEN");
  });
  it("keeps a negative slot count so validation can report it", () => {
    const wb = makeWorkbook({
      applications: { headers: APP_HEADERS, rows: [appRow()] },
      territories: { headers: TER_HEADERS, rows: [terRow("TER-02", "560095", -1)] },
    });
    expect(parseWorkbookObject(wb).input.territories[0].openSlots).toBe(-1);
  });
  it("uses the built-in store list with a notice when the sheet is missing or empty", () => {
    const missing = parseWorkbookObject(basic([appRow()]));
    expect(missing.input.existingStores).toHaveLength(10);
    expect(missing.notices.some((n) => n.code === "EXISTING_STORES_DEFAULTED")).toBe(true);
    const empty = parseWorkbookObject(basic([appRow()], { stores: { headers: STORE_HEADERS, rows: [] } }));
    expect(empty.input.existingStores).toHaveLength(10);
  });
  it("reads the stores sheet when present and skips bad rows", () => {
    const r = parseWorkbookObject(
      basic([appRow()], {
        stores: {
          headers: STORE_HEADERS,
          rows: [["ST-01", "Bengaluru", 560001, 2019], ["ST-02", "Bengaluru", "bad", 2020], ["ST-01", "Bengaluru", 560002, 2020]],
        },
      })
    );
    expect(r.input.existingStores).toEqual([{ id: "ST-01", city: "Bengaluru", pin: "560001", openedYear: 2019 }]);
    expect(r.notices.filter((n) => n.code === "EXISTING_STORE_SKIPPED")).toHaveLength(2);
  });
});

describe("unusable files never crash", () => {
  it("rejects text/CSV with a friendly message", () => {
    const r = parseWorkbook(new TextEncoder().encode("Application ID,Applicant name\nAPP-1,Asha\n"));
    expect(r.ok).toBe(false);
    expect(r.notices[0]).toMatchObject({ code: "NOT_EXCEL", level: "error" });
    expect(r.notices[0].message).toMatch(/CSV/);
  });
  it("rejects a PDF-like binary file", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x00, 0x01, 0x02]);
    const r = parseWorkbook(pdf);
    expect(r.ok).toBe(false);
    expect(r.notices[0].code).toBe("NOT_EXCEL");
  });
  it("handles empty and corrupt input", () => {
    expect(parseWorkbook(new Uint8Array()).ok).toBe(false);
    const corrupt = new Uint8Array(200);
    corrupt[0] = 0x50;
    corrupt[1] = 0x4b;
    const r = parseWorkbook(corrupt);
    expect(r.ok).toBe(false);
    expect(r.input.applications).toEqual([]);
  });
  it("says so when there is no Applications sheet", () => {
    const wb = makeWorkbook({ extra: { Random: [["a", "b"], [1, 2]] } });
    const r = parseWorkbook(toBytes(wb));
    expect(r.ok).toBe(false);
    expect(r.notices[0].code).toBe("SHEET_MISSING");
  });
  it("reads a header-only template as zero applicants, ok", () => {
    const wb = makeWorkbook({
      applications: { headers: APP_HEADERS, rows: [] },
      territories: { headers: TER_HEADERS, rows: [] },
    });
    const r = parseWorkbook(toBytes(wb));
    expect(r.ok).toBe(true);
    expect(r.input.applications).toEqual([]);
    expect(r.notices.some((n) => n.code === "NO_APPLICATIONS")).toBe(true);
  });
  it("survives random cell junk", () => {
    const junk: Cell[] = [null, "", 0, -1, "💥", "1e999", NaN, Infinity, "=SUM(A1)", "true"];
    const rows = Array.from({ length: 40 }, (_, i) => APP_HEADERS.map((_h, c) => junk[(i * 7 + c * 3) % junk.length]));
    const wb = makeWorkbook({
      applications: { headers: APP_HEADERS, rows },
      territories: { headers: TER_HEADERS, rows: rows.map((r) => r.slice(0, 7)) },
    });
    const bytes = toBytes(wb);
    expect(() => parseWorkbook(bytes)).not.toThrow();
    expect(parseWorkbook(bytes).ok).toBe(true);
  });
  it("accepts an ArrayBuffer as well as a Uint8Array", () => {
    const bytes = toBytes(basic([appRow({ id: "APP-002" })]));
    expect(parseWorkbook(bytes).input.applications.map((a) => a.id)).toEqual(["APP-002"]);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expect(parseWorkbook(ab).input.applications).toHaveLength(1);
  });
});
