import * as XLSX from "xlsx";
import {
  cellText,
  isBlankCell,
  normaliseHeader,
  parseCity,
  parseFloor,
  parseLanguage,
  parseNumber,
  parsePin,
  parsePinList,
  parsePriority,
  parseSpaceAvailable,
  parseState,
  parseText,
  parseTier,
  isValidPin,
} from "./normalise";
import { DEFAULT_EXISTING_STORES, EXAMPLE_APPLICATION, EXAMPLE_TERRITORY, tierOfCity } from "./reference";
import type {
  AppField,
  Application,
  EngineInput,
  ExcludedExample,
  ExistingStore,
  ParseIssue,
  ParseNotice,
  ParseResult,
  Territory,
  TerritoryField,
} from "./types";

// Excel → typed input (SPEC §2). The parser never throws: bad input becomes notices and per-row issues.

export interface ParseOptions {
  /** Keep the template's grey example row in the applications list. Default false. */
  includeExampleApplication?: boolean;
  includeExampleTerritory?: boolean;
}

const HEADER_SCAN_ROWS = 10;

type Grid = unknown[][];
type ColumnMap<F extends string> = Partial<Record<F, number>>;

// ---------------------------------------------------------------- entry points

export function parseWorkbook(data: ArrayBuffer | Uint8Array, options: ParseOptions = {}): ParseResult {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  try {
    if (!looksLikeExcel(bytes)) {
      const csvLike = looksLikeText(bytes);
      return failure(
        "NOT_EXCEL",
        csvLike
          ? "That looks like a CSV or text file. Please upload the Excel template (.xlsx) so the Applications, Territories and Existing stores sheets are kept together."
          : "That file isn't an Excel workbook. Please upload the .xlsx template (use Download template if you need a fresh copy)."
      );
    }
    const wb = XLSX.read(bytes, { type: "array", cellDates: false });
    return parseWorkbookObject(wb, options);
  } catch {
    return failure("UNREADABLE", "We couldn't open that file. It may be damaged or password-protected. Try re-saving it as .xlsx.");
  }
}

export function parseWorkbookObject(wb: XLSX.WorkBook, options: ParseOptions = {}): ParseResult {
  const notices: ParseNotice[] = [];
  try {
    const appSheet = findSheet(wb, "application", "application id");
    if (!appSheet) {
      return failure(
        "SHEET_MISSING",
        "We couldn't find an Applications sheet. The workbook needs a sheet whose name contains “Applications” with an “Application ID” column."
      );
    }

    const terSheet = findSheet(wb, "territor", "territory id");
    const storeSheet = findSheet(wb, "existing", "store id");

    const apps = readApplications(appSheet.grid, notices);
    const ters = terSheet
      ? readTerritories(terSheet.grid, notices)
      : (notices.push({
          code: "SHEET_MISSING",
          level: "warning",
          message: "No Territories sheet found, so no applicant can be placed in a territory.",
        }),
        { rows: [] as Territory[] });

    const stores = readStores(storeSheet?.grid ?? null, notices);

    const input = buildInput(apps.rows, ters.rows, stores, options, notices);

    if (input.applications.length === 0 && input.excludedExamples.applications.length === 0) {
      notices.push({
        code: "NO_APPLICATIONS",
        level: "info",
        message: "The Applications sheet has no applicants yet. Add rows from row 4, or try the sample data.",
      });
    }
    if (terSheet && input.territories.length === 0 && input.excludedExamples.territories.length === 0) {
      notices.push({
        code: "NO_TERRITORIES",
        level: "info",
        message: "The Territories sheet has no territories yet.",
      });
    }
    return { input, notices, ok: true };
  } catch {
    return failure("UNREADABLE", "We couldn't read that workbook. Please check it follows the template and try again.");
  }
}

/**
 * Re-apply the "Include it" choice for the template example rows without re-reading the file.
 * Pure: returns a new input.
 */
export function applyExampleChoice(input: EngineInput, options: ParseOptions): EngineInput {
  const apps = [...input.applications];
  const keptApps: ExcludedExample<Application>[] = [];
  for (const ex of input.excludedExamples.applications) {
    if (options.includeExampleApplication && !ex.locked) apps.push(ex.row);
    else keptApps.push(ex);
  }
  const ters = [...input.territories];
  const keptTers: ExcludedExample<Territory>[] = [];
  for (const ex of input.excludedExamples.territories) {
    if (options.includeExampleTerritory && !ex.locked) ters.push(ex.row);
    else keptTers.push(ex);
  }
  return {
    ...input,
    applications: uniquifyApplicationIds(apps),
    territories: uniquifyTerritoryIds(ters),
    excludedExamples: { applications: keptApps, territories: keptTers },
  };
}

// ---------------------------------------------------------------- failure / sniffing

function emptyInput(): EngineInput {
  return {
    applications: [],
    territories: [],
    existingStores: DEFAULT_EXISTING_STORES.map((s) => ({ ...s })),
    excludedExamples: { applications: [], territories: [] },
  };
}

function failure(code: ParseNotice["code"], message: string): ParseResult {
  return { input: emptyInput(), notices: [{ code, level: "error", message }], ok: false };
}

function looksLikeExcel(b: Uint8Array): boolean {
  if (b.length < 4) return false;
  const zip = b[0] === 0x50 && b[1] === 0x4b; // .xlsx / .xlsm
  const ole = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0; // legacy .xls
  return zip || ole;
}

function looksLikeText(b: Uint8Array): boolean {
  const n = Math.min(b.length, 512);
  if (n === 0) return false;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0 || (c < 9) || (c > 13 && c < 32)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- sheets and headers

interface FoundSheet {
  name: string;
  grid: Grid;
}

function sheetGrid(ws: XLSX.WorkSheet): Grid {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true, blankrows: true });
}

/**
 * Sheet by fuzzy name (preferring one that also has the header row), else the first sheet whose
 * header row contains `headerNeedle`, else the first name match.
 */
function findSheet(wb: XLSX.WorkBook, nameNeedle: string, headerNeedle: string): FoundSheet | null {
  const names = wb.SheetNames ?? [];
  const byName = names.filter((n) => n.toLowerCase().includes(nameNeedle) && wb.Sheets[n]);
  const grids = new Map<string, Grid>();
  const gridOf = (n: string) => {
    let g = grids.get(n);
    if (!g) {
      g = sheetGrid(wb.Sheets[n]);
      grids.set(n, g);
    }
    return g;
  };
  for (const n of byName) if (findHeaderRow(gridOf(n), headerNeedle) >= 0) return { name: n, grid: gridOf(n) };
  for (const n of names) {
    if (wb.Sheets[n] && findHeaderRow(gridOf(n), headerNeedle) >= 0) return { name: n, grid: gridOf(n) };
  }
  return byName.length ? { name: byName[0], grid: gridOf(byName[0]) } : null;
}

/** Index of the header row within the first rows, or -1. */
function findHeaderRow(grid: Grid, needle: string): number {
  const squashNeedle = needle.replace(/ /g, "");
  for (let r = 0; r < Math.min(grid.length, HEADER_SCAN_ROWS); r++) {
    const row = grid[r] ?? [];
    for (const cell of row) {
      const h = normaliseHeader(cell).replace(/ /g, "");
      if (h === squashNeedle || h === squashNeedle.replace("application", "app")) return r;
    }
  }
  return -1;
}

function mapColumns<F extends string>(
  headers: unknown[],
  rules: { field: F; test: (h: string) => boolean }[]
): ColumnMap<F> {
  const map: ColumnMap<F> = {};
  headers.forEach((cell, col) => {
    const h = normaliseHeader(cell);
    if (!h) return;
    for (const rule of rules) {
      if (map[rule.field] === undefined && rule.test(h)) {
        map[rule.field] = col;
        return;
      }
    }
  });
  return map;
}

const has = (h: string, ...words: string[]) => words.some((w) => h.includes(w));

type AppCol = AppField | "location";

const APP_RULES: { field: AppCol; test: (h: string) => boolean }[] = [
  { field: "location", test: (h) => /\bcity\b/.test(h) && /\bstate\b/.test(h) && has(h, "pin") },
  { field: "id", test: (h) => /^(application|app) ?id$/.test(h) || h === "id" || h === "application no" },
  { field: "pin", test: (h) => has(h, "pin", "postal", "zip") },
  { field: "spaceSize", test: (h) => /space.*(size|sq)|size.*sq|sq ?ft|\barea\b/.test(h) || h === "space size" },
  { field: "spaceAvailable", test: (h) => has(h, "space") },
  { field: "floor", test: (h) => has(h, "floor") },
  { field: "investmentLakh", test: (h) => has(h, "invest", "capital", "budget") },
  { field: "experienceYears", test: (h) => has(h, "experience") },
  { field: "business", test: (h) => has(h, "business", "occupation") },
  { field: "targetLaunchMonths", test: (h) => has(h, "target", "launch") },
  { field: "language", test: (h) => has(h, "language") },
  { field: "notes", test: (h) => has(h, "note", "remark", "comment") },
  { field: "name", test: (h) => has(h, "name") },
  { field: "state", test: (h) => h === "state" || h.startsWith("state ") },
  { field: "city", test: (h) => h === "city" || (h.startsWith("city ") && !has(h, "tier")) },
];

const REQUIRED_APP_COLUMNS: { field: AppField; label: string }[] = [
  { field: "name", label: "Applicant name" },
  { field: "pin", label: "Pin code" },
  { field: "investmentLakh", label: "Investment capacity" },
  { field: "experienceYears", label: "Retail experience" },
  { field: "spaceAvailable", label: "Space available" },
];

type TerCol = TerritoryField;

const TER_RULES: { field: TerCol; test: (h: string) => boolean }[] = [
  { field: "id", test: (h) => /^(territory|ter) ?id$/.test(h) || h === "id" },
  { field: "pins", test: (h) => has(h, "pin", "postal", "zip") },
  { field: "tier", test: (h) => has(h, "tier") },
  { field: "openSlots", test: (h) => has(h, "slot", "open") },
  { field: "priority", test: (h) => has(h, "priority") },
  { field: "state", test: (h) => h === "state" || h.startsWith("state ") },
  { field: "city", test: (h) => h === "city" || h.startsWith("city ") },
];

type StoreCol = "id" | "city" | "pin" | "opened";

const STORE_RULES: { field: StoreCol; test: (h: string) => boolean }[] = [
  { field: "id", test: (h) => /^(store|st) ?id$/.test(h) || h === "id" },
  { field: "pin", test: (h) => has(h, "pin", "postal", "zip") },
  { field: "opened", test: (h) => has(h, "opened", "year") },
  { field: "city", test: (h) => h === "city" || h.startsWith("city ") },
];

// ---------------------------------------------------------------- rows

function rowIsBlank(row: unknown[] | undefined): boolean {
  return !row || row.every(isBlankCell);
}

function get(row: unknown[], col: number | undefined): unknown {
  return col === undefined ? null : (row[col] ?? null);
}

function issue(
  list: ParseIssue[],
  code: ParseIssue["code"],
  field: string,
  raw: string,
  message: string
): void {
  list.push({ code, field, raw, message });
}

function readApplications(grid: Grid, notices: ParseNotice[]): { rows: Application[] } {
  const headerAt = findHeaderRow(grid, "application id");
  if (headerAt < 0) {
    notices.push({
      code: "HEADER_MISSING",
      level: "error",
      message: "The Applications sheet has no “Application ID” header row in its first 10 rows, so no applicants could be read.",
    });
    return { rows: [] };
  }
  const cols = mapColumns<AppCol>(grid[headerAt] ?? [], APP_RULES);
  if (cols.location !== undefined) {
    notices.push({
      code: "COMBINED_LOCATION_COLUMN",
      level: "info",
      message: "Read City, State and Pin code from a single combined column.",
    });
  }
  for (const req of REQUIRED_APP_COLUMNS) {
    const isPinFromCombined = req.field === "pin" && cols.location !== undefined;
    if (cols[req.field] === undefined && !isPinFromCombined) {
      notices.push({
        code: "COLUMN_MISSING",
        level: "warning",
        message: `Couldn't find a “${req.label}” column in Applications. Applicants will be put on hold until that information is provided.`,
      });
    }
  }
  if (cols.id === undefined) {
    notices.push({
      code: "COLUMN_MISSING",
      level: "warning",
      message: "Couldn't find an “Application ID” column; rows are labelled by their row number.",
    });
  }

  const rows: Application[] = [];
  for (let r = headerAt + 1; r < grid.length; r++) {
    const row = grid[r];
    if (rowIsBlank(row)) continue;
    rows.push(readApplicationRow(row, r + 1, cols));
  }
  return { rows };
}

function readApplicationRow(row: unknown[], rowNumber: number, cols: ColumnMap<AppCol>): Application {
  const issues: ParseIssue[] = [];
  const raw: Partial<Record<AppField, string>> = {};
  const rawOf = (f: AppField, v: unknown) => {
    const t = cellText(v);
    if (t !== "") raw[f] = t;
    return t;
  };

  const sourceId = rawOf("id", get(row, cols.id));

  let cityCell = get(row, cols.city);
  let stateCell = get(row, cols.state);
  let pinCell = get(row, cols.pin);
  if (cols.location !== undefined) {
    const split = splitLocation(get(row, cols.location));
    cityCell = split.city ?? cityCell;
    stateCell = split.state ?? stateCell;
    pinCell = split.pin ?? pinCell;
  }

  const city = parseCity(cityCell);
  rawOf("city", cityCell);
  const state = parseState(stateCell);
  rawOf("state", stateCell);
  const pin = parsePin(pinCell);
  rawOf("pin", pinCell);

  const num = (field: AppField, cell: unknown, label: string, lakh = false): number | null => {
    const text = rawOf(field, cell);
    const res = parseNumber(cell, { lakh });
    if (res.invalid) {
      issue(issues, "UNPARSEABLE_VALUE", field, text, `${label}: couldn't read “${text}” as a number.`);
    } else if (res.converted === "rupees") {
      issue(issues, "CONVERTED_UNITS", field, text, `${label}: “${text}” looks like rupees, converted to ${res.value} lakh.`);
    } else if (res.converted === "crore") {
      issue(issues, "CONVERTED_UNITS", field, text, `${label}: “${text}” converted from crore to ${res.value} lakh.`);
    }
    return res.value;
  };

  const investmentLakh = num("investmentLakh", get(row, cols.investmentLakh), "Investment capacity", true);
  const experienceYears = num("experienceYears", get(row, cols.experienceYears), "Retail experience");
  const spaceSize = num("spaceSize", get(row, cols.spaceSize), "Space size");
  const targetLaunchMonths = num("targetLaunchMonths", get(row, cols.targetLaunchMonths), "Target launch");

  const spaceCell = get(row, cols.spaceAvailable);
  const space = parseSpaceAvailable(spaceCell);
  if (space.unknown) {
    const t = rawOf("spaceAvailable", spaceCell);
    issue(issues, "UNKNOWN_VALUE", "spaceAvailable", t, `Space available: “${t}” isn't Owned, Rented or Not yet identified.`);
  } else rawOf("spaceAvailable", spaceCell);

  const floorCell = get(row, cols.floor);
  const floor = parseFloor(floorCell);
  if (floor.unknown) {
    const t = rawOf("floor", floorCell);
    issue(issues, "UNKNOWN_VALUE", "floor", t, `Floor: “${t}” isn't Ground, Upper, Mall unit or Not known.`);
  } else rawOf("floor", floorCell);

  const langCell = get(row, cols.language);
  const language = parseLanguage(langCell);
  if (language.unknown) {
    const t = rawOf("language", langCell);
    issue(issues, "UNKNOWN_VALUE", "language", t, `Preferred language: “${t}” isn't Kannada, English or Hindi.`);
  } else rawOf("language", langCell);

  const nameCell = get(row, cols.name);
  rawOf("name", nameCell);
  rawOf("business", get(row, cols.business));
  rawOf("notes", get(row, cols.notes));

  return {
    id: sourceId || `ROW-${rowNumber}`,
    sourceId,
    rowNumber,
    name: parseText(nameCell),
    city: city.city,
    state,
    pin,
    investmentLakh,
    experienceYears,
    business: parseText(get(row, cols.business)),
    spaceAvailable: space.value,
    spaceSize,
    floor: floor.value,
    targetLaunchMonths,
    language: language.value,
    notes: parseText(get(row, cols.notes)),
    raw,
    parseIssues: issues,
  };
}

/** "Mysuru · Karnataka · 570001" → parts. Tolerates · | , / as separators and missing parts. */
function splitLocation(v: unknown): { city: string | null; state: string | null; pin: string | null } {
  const text = cellText(v);
  if (!text) return { city: null, state: null, pin: null };
  const parts = text.split(/\s*[·|,/•]\s*/).map((p) => p.trim()).filter(Boolean);
  let pin: string | null = null;
  let city: string | null = null;
  let state: string | null = null;
  for (const p of parts) {
    const digits = p.replace(/[\s-]/g, "");
    if (/^\d{4,7}$/.test(digits)) pin = pin ?? digits;
    else if (!city) city = p;
    else if (!state) state = p;
  }
  return { city, state, pin };
}

function readTerritories(grid: Grid, notices: ParseNotice[]): { rows: Territory[] } {
  const headerAt = findHeaderRow(grid, "territory id");
  if (headerAt < 0) {
    notices.push({
      code: "HEADER_MISSING",
      level: "warning",
      message: "The Territories sheet has no “Territory ID” header row in its first 10 rows, so no territories could be read.",
    });
    return { rows: [] };
  }
  const cols = mapColumns<TerCol>(grid[headerAt] ?? [], TER_RULES);
  for (const [field, label] of [
    ["pins", "Pin codes covered"],
    ["openSlots", "Open slots"],
  ] as const) {
    if (cols[field] === undefined) {
      notices.push({
        code: "COLUMN_MISSING",
        level: "warning",
        message: `Couldn't find a “${label}” column in Territories.`,
      });
    }
  }
  const rows: Territory[] = [];
  for (let r = headerAt + 1; r < grid.length; r++) {
    const row = grid[r];
    if (rowIsBlank(row)) continue;
    rows.push(readTerritoryRow(row, r + 1, cols));
  }
  return { rows };
}

function readTerritoryRow(row: unknown[], rowNumber: number, cols: ColumnMap<TerCol>): Territory {
  const issues: ParseIssue[] = [];
  const raw: Partial<Record<TerritoryField, string>> = {};
  const rawOf = (f: TerritoryField, v: unknown) => {
    const t = cellText(v);
    if (t !== "") raw[f] = t;
    return t;
  };

  const sourceId = rawOf("id", get(row, cols.id));
  const cityCell = get(row, cols.city);
  const city = parseCity(cityCell);
  rawOf("city", cityCell);
  const stateCell = get(row, cols.state);
  rawOf("state", stateCell);

  const pinCell = get(row, cols.pins);
  rawOf("pins", pinCell);
  const { pins, invalid } = parsePinList(pinCell);
  for (const token of invalid) {
    issue(issues, "INVALID_PIN_TOKEN", "pins", token, `“${token}” in Pin codes covered isn't a 6-digit pin code and was ignored.`);
  }

  const tierCell = get(row, cols.tier);
  const tier = parseTier(tierCell);
  if (tier.unknown) {
    const t = rawOf("tier", tierCell);
    issue(issues, "UNKNOWN_VALUE", "tier", t, `City tier: “${t}” isn't Tier 1, Tier 2 or Tier 3.`);
  } else rawOf("tier", tierCell);

  const slotsCell = get(row, cols.openSlots);
  const slotText = rawOf("openSlots", slotsCell);
  const slots = parseNumber(slotsCell);
  let openSlots = slots.value === null ? null : Math.floor(slots.value);
  if (typeof slotsCell === "number" && Number.isFinite(slotsCell) && slotsCell < 0) {
    // Keep the negative so validate() can report it.
    openSlots = Math.floor(slotsCell);
  } else if (slots.invalid) {
    issue(issues, "UNPARSEABLE_VALUE", "openSlots", slotText, `Open slots: couldn't read “${slotText}” as a number.`);
    openSlots = null;
  }

  const priorityCell = get(row, cols.priority);
  const priority = parsePriority(priorityCell);
  if (priority.unknown) {
    const t = rawOf("priority", priorityCell);
    issue(issues, "UNKNOWN_VALUE", "priority", t, `Priority: “${t}” isn't High, Medium or Low.`);
  } else rawOf("priority", priorityCell);

  const effectiveTier = tierOfCity(city.city) ?? tier.value;

  return {
    id: sourceId || `ROW-${rowNumber}`,
    sourceId,
    rowNumber,
    city: city.city,
    state: parseState(stateCell),
    pins,
    invalidPinTokens: invalid,
    statedTier: tier.value,
    tier: effectiveTier,
    openSlots,
    priority: priority.value,
    raw,
    parseIssues: issues,
  };
}

function readStores(grid: Grid | null, notices: ParseNotice[]): ExistingStore[] {
  const fallback = () => DEFAULT_EXISTING_STORES.map((s) => ({ ...s }));
  if (!grid) {
    notices.push({
      code: "EXISTING_STORES_DEFAULTED",
      level: "info",
      message: "No Existing stores sheet found. Using the brand's standard list of 10 stores.",
    });
    return fallback();
  }
  const headerAt = findHeaderRow(grid, "store id");
  const stores: ExistingStore[] = [];
  const seen = new Set<string>();
  if (headerAt >= 0) {
    const cols = mapColumns<StoreCol>(grid[headerAt] ?? [], STORE_RULES);
    for (let r = headerAt + 1; r < grid.length; r++) {
      const row = grid[r];
      if (rowIsBlank(row)) continue;
      const id = cellText(get(row, cols.id));
      const pin = parsePin(get(row, cols.pin));
      if (!isValidPin(pin)) {
        notices.push({
          code: "EXISTING_STORE_SKIPPED",
          level: "warning",
          message: `Existing store ${id || `on row ${r + 1}`} was skipped: its pin code “${cellText(get(row, cols.pin))}” isn't a valid 6-digit pin.`,
        });
        continue;
      }
      const sid = id || `ST-ROW${r + 1}`;
      if (seen.has(sid)) {
        notices.push({
          code: "EXISTING_STORE_SKIPPED",
          level: "warning",
          message: `Existing store ${sid} appears twice; the second entry (row ${r + 1}) was ignored.`,
        });
        continue;
      }
      seen.add(sid);
      const opened = parseNumber(get(row, cols.opened));
      const city = parseCity(get(row, cols.city));
      stores.push({ id: sid, city: city.city, pin: pin as string, openedYear: opened.value });
    }
  }
  if (stores.length === 0) {
    notices.push({
      code: "EXISTING_STORES_DEFAULTED",
      level: "info",
      message: "The Existing stores sheet was empty. Using the brand's standard list of 10 stores.",
    });
    return fallback();
  }
  return stores;
}

// ---------------------------------------------------------------- example rows, unique IDs

function applicationSignature(a: Application): string[] {
  const r = a.raw;
  const t = (f: AppField) => (r[f] ?? "").toLowerCase();
  return [
    t("id"), t("name"), t("city"), t("state"), t("pin"), t("investmentLakh"), t("experienceYears"),
    t("business"), t("spaceAvailable"), t("spaceSize"), t("floor"), t("targetLaunchMonths"),
    t("language"), t("notes"),
  ];
}

function territorySignature(tr: Territory): string[] {
  const r = tr.raw;
  const t = (f: TerritoryField) => (r[f] ?? "").toLowerCase();
  const pins = parsePinList(r.pins).pins.join(",");
  return [t("id"), t("city"), t("state"), pins, t("tier"), t("openSlots"), t("priority")];
}

const sameSignature = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function buildInput(
  apps: Application[],
  ters: Territory[],
  stores: ExistingStore[],
  options: ParseOptions,
  notices: ParseNotice[]
): EngineInput {
  const excludedApps: ExcludedExample<Application>[] = [];
  const keptApps: Application[] = [];
  for (const a of apps) {
    const isExample = sameSignature(applicationSignature(a), EXAMPLE_APPLICATION.signature);
    if (!isExample) {
      keptApps.push(a);
      continue;
    }
    const locked = apps.some((o) => o !== a && o.sourceId.toLowerCase() === a.sourceId.toLowerCase());
    if (options.includeExampleApplication && !locked) keptApps.push(a);
    else {
      excludedApps.push({ row: a, locked });
      notices.push({
        code: "EXAMPLE_ROW_IGNORED",
        level: "info",
        message: locked
          ? `Ignored the template's example row (${a.sourceId} ${a.name}) because another row uses the same ID.`
          : `Ignored the template's example row (${a.sourceId} ${a.name}).`,
        example: { kind: "application", id: a.sourceId, locked },
      });
    }
  }

  const excludedTers: ExcludedExample<Territory>[] = [];
  const keptTers: Territory[] = [];
  for (const t of ters) {
    const isExample = sameSignature(territorySignature(t), EXAMPLE_TERRITORY.signature);
    if (!isExample) {
      keptTers.push(t);
      continue;
    }
    const locked = ters.some((o) => o !== t && o.sourceId.toLowerCase() === t.sourceId.toLowerCase());
    if (options.includeExampleTerritory && !locked) keptTers.push(t);
    else {
      excludedTers.push({ row: t, locked });
      notices.push({
        code: "EXAMPLE_ROW_IGNORED",
        level: "info",
        message: locked
          ? `Ignored the template's example territory (${t.sourceId} ${t.city}) because another row uses the same ID.`
          : `Ignored the template's example territory (${t.sourceId} ${t.city}).`,
        example: { kind: "territory", id: t.sourceId, locked },
      });
    }
  }

  return {
    applications: uniquifyApplicationIds(keptApps),
    territories: uniquifyTerritoryIds(keptTers),
    existingStores: stores,
    excludedExamples: { applications: excludedApps, territories: excludedTers },
  };
}

/** Keep the first use of an ID as typed; later uses become "APP-005#2". Missing IDs become "ROW-<n>". */
function uniquifyApplicationIds(apps: Application[]): Application[] {
  return uniquify(apps);
}

function uniquifyTerritoryIds(ters: Territory[]): Territory[] {
  return uniquify(ters);
}

function uniquify<T extends { id: string; sourceId: string; rowNumber: number }>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => a.rowNumber - b.rowNumber);
  const used = new Set<string>();
  const counts = new Map<string, number>();
  return sorted.map((row) => {
    const base = row.sourceId || `ROW-${row.rowNumber}`;
    const k = base.toLowerCase();
    let id = base;
    if (used.has(k)) {
      let n = (counts.get(k) ?? 1) + 1;
      while (used.has(`${k}#${n}`)) n++;
      counts.set(k, n);
      id = `${base}#${n}`;
    }
    used.add(id.toLowerCase());
    return id === row.id ? row : { ...row, id };
  });
}
