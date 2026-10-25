// Shared types for the decision engine. Pure data shapes: no React, no network, no AI.

export type Tier = 1 | 2 | 3;
export type Language = "Kannada" | "English" | "Hindi";
export type Priority = "High" | "Medium" | "Low";
export type Floor = "Ground" | "Upper" | "Mall unit" | "Not known";
export type SpaceAvailable =
  | "Owned"
  | "Rented"
  | "Not yet identified"
  // Internal only: set when someone reports "found a space" without saying who owns it (SPEC §8.3).
  | "Identified (ownership unconfirmed)";

/** Application fields, as keys for the raw-cell map and for update paths. */
export type AppField =
  | "id"
  | "name"
  | "city"
  | "state"
  | "pin"
  | "investmentLakh"
  | "experienceYears"
  | "business"
  | "spaceAvailable"
  | "spaceSize"
  | "floor"
  | "targetLaunchMonths"
  | "language"
  | "notes";

export type TerritoryField = "id" | "city" | "state" | "pins" | "tier" | "openSlots" | "priority";

/** Something the parser could not read cleanly. Turned into a flag by validate(). */
export interface ParseIssue {
  code: "UNPARSEABLE_VALUE" | "UNKNOWN_VALUE" | "CONVERTED_UNITS" | "INVALID_PIN_TOKEN";
  field: string;
  raw: string;
  message: string;
}

export interface Application {
  /** Unique within the input. Equals sourceId unless the ID was missing or reused. */
  id: string;
  /** The ID exactly as typed in the sheet ("" if blank). */
  sourceId: string;
  /** 1-based Excel row number. */
  rowNumber: number;
  name: string | null;
  /** Canonical city when recognised, otherwise the text as typed. */
  city: string | null;
  state: string | null;
  /** Digits as typed. May be invalid (e.g. 4 digits); check with isValidPin(). */
  pin: string | null;
  investmentLakh: number | null;
  experienceYears: number | null;
  business: string | null;
  spaceAvailable: SpaceAvailable | null;
  spaceSize: number | null;
  floor: Floor | null;
  targetLaunchMonths: number | null;
  language: Language | null;
  notes: string | null;
  /** Cell text exactly as the applicant/brand wrote it, for quoting in explanations. */
  raw: Partial<Record<AppField, string>>;
  parseIssues: ParseIssue[];
}

export interface Territory {
  id: string;
  sourceId: string;
  rowNumber: number;
  city: string | null;
  state: string | null;
  /** Valid 6-digit pins only, in sheet order, de-duplicated. */
  pins: string[];
  invalidPinTokens: string[];
  /** Tier written in the sheet. The tier actually used comes from the city table (D9). */
  statedTier: Tier | null;
  /** Tier used by the engine: city table first, stated tier only if the city is unknown. */
  tier: Tier | null;
  openSlots: number | null;
  priority: Priority | null;
  raw: Partial<Record<TerritoryField, string>>;
  parseIssues: ParseIssue[];
}

export interface ExistingStore {
  id: string;
  city: string | null;
  pin: string;
  openedYear: number | null;
}

export interface EngineInput {
  applications: Application[];
  territories: Territory[];
  existingStores: ExistingStore[];
  /** Template example rows removed from the lists above. Kept so the UI can offer "Include it". */
  excludedExamples: {
    applications: ExcludedExample<Application>[];
    territories: ExcludedExample<Territory>[];
  };
}

export interface ExcludedExample<T> {
  row: T;
  /** True when another row has the same ID: the example stays out and cannot be included. */
  locked: boolean;
}

export interface ParseNotice {
  code:
    | "EXAMPLE_ROW_IGNORED"
    | "EXISTING_STORES_DEFAULTED"
    | "EXISTING_STORE_SKIPPED"
    | "SHEET_MISSING"
    | "HEADER_MISSING"
    | "COLUMN_MISSING"
    | "NOT_EXCEL"
    | "UNREADABLE"
    | "NO_APPLICATIONS"
    | "NO_TERRITORIES"
    | "COMBINED_LOCATION_COLUMN";
  level: "info" | "warning" | "error";
  message: string;
  /** For EXAMPLE_ROW_IGNORED: which list the "Include it" toggle applies to. */
  example?: { kind: "application" | "territory"; id: string; locked: boolean };
}

export interface ParseResult {
  input: EngineInput;
  notices: ParseNotice[];
  /** False only when the file could not be used at all (not Excel, no Applications sheet). */
  ok: boolean;
}

// ---- Validation ----

export type FlagSeverity = "blocker" | "condition" | "warning" | "info";

export type FlagCode =
  // Blockers (-> HOLD)
  | "MISSING_ID"
  | "DUPLICATE_ID"
  | "MISSING_REQUIRED"
  | "INVALID_PIN"
  | "CITY_NOT_ALLOWED"
  | "CITY_PIN_MISMATCH"
  | "INVESTMENT_OUTLIER"
  | "INVESTMENT_CONTRADICTION"
  | "PROBABLE_DUPLICATE"
  // Conditions
  | "FIN_GAP"
  | "FIN_GAP_LARGE"
  | "FIND_SPACE"
  | "NEED_GROUND_FLOOR"
  | "SPACE_TOO_SMALL"
  | "CONFIRM_SIZE"
  | "CONFIRM_FLOOR"
  | "SPACE_CONTRADICTION"
  | "LOAN_DEPENDENT"
  // Warnings / info (application)
  | "HAS_PROBABLE_DUPLICATE"
  | "STATE_MISMATCH"
  | "DEADLINE_UNREACHABLE"
  | "OVERSIZED_SPACE"
  | "OUTSIDE_CITY_CORE"
  | "NO_TERRITORY"
  | "PIN_IN_MULTIPLE_TERRITORIES"
  | "SAME_APPLICANT_MULTIPLE"
  | "APPROX_COORDS"
  | "ZERO_EXPERIENCE"
  | "UNPARSEABLE_VALUE"
  | "UNKNOWN_VALUE"
  | "CONVERTED_UNITS"
  | "INVALID_PIN_TOKEN"
  // Territory
  | "TER_MISSING_ID"
  | "DUPLICATE_TERRITORY_ID"
  | "TIER_MISMATCH"
  | "TER_NO_PINS"
  | "TER_BAD_SLOTS"
  | "TER_ZERO_SLOTS"
  | "TER_CITY_NOT_ALLOWED"
  | "TER_PIN_HAS_STORE"
  | "TER_PIN_OUT_OF_CITY"
  | "TER_PRIORITY_UNKNOWN";

export interface Flag {
  code: FlagCode;
  severity: FlagSeverity;
  field?: string;
  message: string;
  /** What we would ask the applicant to resolve this (used for HOLD). */
  question?: string;
  /** IDs of other applications/territories/stores this flag refers to. */
  related?: string[];
}

export interface DataAlert {
  code: FlagCode | "EXAMPLE_ROW_IGNORED";
  severity: FlagSeverity;
  message: string;
  ids: string[];
}

export interface ValidationResult {
  applications: Record<string, Flag[]>;
  territories: Record<string, Flag[]>;
  alerts: DataAlert[];
}

// ---- AI-read signals (produced by Gemini or by the deterministic fallback; validated by zod in /lib/ai) ----

export type BusinessCategory =
  | "eyewear_optical_watches"
  | "specialty_retail"
  | "general_or_food_retail"
  | "retail_manager"
  | "non_retail_business"
  | "salaried_non_retail"
  | "unknown";

export interface NoteSignal {
  /**
   * "finance" means the applicant's funding depends on outside finance such as a bank loan
   * (validate() turns it into the LOAN_DEPENDENT condition).
   */
  type: "green" | "red" | "contradiction" | "deadline" | "site" | "finance" | "info";
  text: string;
  quote: string;
  impact: number;
  field?: "investment" | "floor" | "spaceSize" | "spaceAvailable" | "city" | "pin" | "experience" | "targetLaunch";
  value?: string | number;
  date?: string;
}

export interface NoteReading {
  id: string;
  businessCategory: BusinessCategory;
  priorFranchise: boolean;
  signals: NoteSignal[];
}
