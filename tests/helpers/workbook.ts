import * as XLSX from "xlsx";

export const APP_HEADERS = [
  "Application ID", "Applicant name", "City", "State", "Pin code", "Investment capacity (₹ lakh)",
  "Retail experience (years)", "Current / past business", "Space available", "Space size (sq ft)",
  "Floor", "Target launch (months)", "Preferred language", "Notes from applicant",
];
export const TER_HEADERS = ["Territory ID", "City", "State", "Pin codes covered", "City tier", "Open slots", "Priority"];
export const STORE_HEADERS = ["Store ID", "City", "Pin code", "Opened (year)"];

export type Cell = string | number | null;

export const EXAMPLE_APP_ROW: Cell[] = [
  "APP-001", "Ravi Kumar", "Mysuru", "Karnataka", 570001, 25, 4, "Runs a footwear store", "Rented", 450,
  "Ground", 3, "Kannada", "Wants to open before Diwali",
];
export const EXAMPLE_TER_ROW: Cell[] = ["TER-01", "Mysuru", "Karnataka", "570001, 570002, 570008", "Tier 2", 3, "High"];

export interface SheetSpec {
  headers: Cell[];
  rows: Cell[][];
  /** Rows above the header (the real template has one title row). */
  titleRows?: number;
}

function sheet({ headers, rows, titleRows = 1 }: SheetSpec): XLSX.WorkSheet {
  const aoa: Cell[][] = [];
  for (let i = 0; i < titleRows; i++) aoa.push(i === 0 ? ["Title row"] : []);
  aoa.push(headers);
  aoa.push(...rows);
  return XLSX.utils.aoa_to_sheet(aoa);
}

export function makeWorkbook(opts: {
  applications?: SheetSpec | null;
  territories?: SheetSpec | null;
  stores?: SheetSpec | null;
  names?: { applications?: string; territories?: string; stores?: string };
  extra?: Record<string, Cell[][]>;
}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const n = opts.names ?? {};
  if (opts.applications) XLSX.utils.book_append_sheet(wb, sheet(opts.applications), n.applications ?? "Applications");
  if (opts.territories) XLSX.utils.book_append_sheet(wb, sheet(opts.territories), n.territories ?? "Territories");
  if (opts.stores) XLSX.utils.book_append_sheet(wb, sheet(opts.stores), n.stores ?? "Existing stores");
  for (const [name, aoa] of Object.entries(opts.extra ?? {})) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return wb;
}

export function toBytes(wb: XLSX.WorkBook): Uint8Array {
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

/** A valid application row; override fields by name. */
export function appRow(over: Partial<Record<string, Cell>> = {}): Cell[] {
  const base: Record<string, Cell> = {
    id: "APP-100", name: "Test Person", city: "Bengaluru", state: "Karnataka", pin: 560095, inv: 45, exp: 5,
    business: "Runs a footwear store", space: "Rented", size: 500, floor: "Ground", target: 4,
    language: "English", notes: "",
  };
  const m = { ...base, ...over } as Record<string, Cell>;
  return [m.id, m.name, m.city, m.state, m.pin, m.inv, m.exp, m.business, m.space, m.size, m.floor, m.target, m.language, m.notes];
}
