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
  | "UNREALISTIC_TARGET"
  | "PAYBACK_LONG"
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

// ---- Engine output (SPEC §6) ----

export type Status = "APPROVED" | "CONDITIONAL" | "REDIRECT" | "WAITLIST" | "HOLD" | "REJECTED";

export const STATUSES: Status[] = ["APPROVED", "CONDITIONAL", "REDIRECT", "WAITLIST", "HOLD", "REJECTED"];

export type ScoreKey = "financial" | "experience" | "site" | "location" | "launch" | "signals";

export interface ScoreComponent {
  key: ScoreKey;
  name: string;
  points: number;
  /** Maximum for the component. The AI-signals component can also go down to -max. */
  max: number;
  reason: string;
  /** For the signals component: the AI-read signals counted, each with its quote. */
  signals?: NoteSignal[];
}

export interface Reason {
  code: string;
  text: string;
  impact: "decisive" | "major" | "minor";
}

export interface Allocation {
  territoryId: string;
  pin: string;
  area: string | null;
  /** Set when the applicant did not get the pin they applied for. */
  redirectedFrom?: { territoryId: string | null; pin: string };
  /** Redirects hold the slot for this long while the applicant secures a site there (ISO date). */
  slotReservedUntil?: string;
}

export interface CannibalisationRow {
  /** Existing store ID, or the applicant ID of a newly allocated store. */
  storeId: string;
  kind: "existing" | "new";
  km: number;
  overlapPct: number;
  band: "Low" | "Moderate" | "Elevated" | "Blocked";
}

export interface Competitor {
  id: string;
  score: number | null;
  outcome: Status;
  whyTheyWon: string;
}

export interface PaybackResult {
  months: number;
  inputs: {
    investmentLakh: number;
    tierRevenueLakh: number;
    floorFactor: number;
    sizeFactor: number;
    overlapPct: number;
    overlapFactor: number;
    monthlyRevenueLakh: number;
    profitPct: number;
    monthlyProfitLakh: number;
  };
}

export interface Condition {
  code: FlagCode;
  text: string;
  /** ISO date */
  deadline: string;
  owner: "Partner" | "Brand";
}

/** What happened to the applicant while slots and pins were being allocated. Raw material for explanations. */
export type TraceStep =
  | { kind: "no-territory"; pin: string }
  | { kind: "no-coords"; pin: string }
  | { kind: "own-pin-store"; pin: string; storeId: string }
  | { kind: "own-pin-overlap"; pin: string; storeId: string; overlapPct: number; km: number }
  | { kind: "own-pin-taken"; pin: string; by: string }
  | { kind: "own-pin-overlap-new"; pin: string; with: string; withPin: string; overlapPct: number; km: number }
  | { kind: "territory-full"; territoryId: string; heldBy: string[] }
  | { kind: "same-person"; other: string }
  | { kind: "no-viable-pin"; territoryId: string }
  | { kind: "no-free-slot-in-city"; city: string | null }
  | { kind: "below-min-score"; score: number; min: number }
  | { kind: "allocated"; territoryId: string; pin: string; redirect: boolean };

export interface Decision {
  id: string;
  name: string | null;
  city: string | null;
  /** The pin the applicant applied for. */
  pin: string | null;
  tier: Tier | null;
  status: Status;
  /** One line, e.g. "Approved for 560095 (Koramangala VI Bk), TER-01". */
  headline: string;
  /** A short plain-language paragraph: the decision, the deciding numbers, what happens next. */
  why: string;
  score: number | null;
  /** Score used for ordering: score minus the redirect penalty where it applies. */
  effectiveScore: number | null;
  redirectPenaltyApplied: boolean;
  breakdown: ScoreComponent[];
  reasons: Reason[];
  flags: Flag[];
  allocation?: Allocation;
  /** Territory that lists the applicant's own pin (best match when several do). */
  ownTerritoryId: string | null;
  competitors?: Competitor[];
  cannibalisation: CannibalisationRow[];
  payback?: PaybackResult;
  waitlistRank?: { territoryId: string; rank: number; of: number };
  conditions?: Condition[];
  questionsForApplicant?: string[];
  whatWouldChange?: string;
  confidence: "high" | "medium" | "low";
  realisticMonths: number | null;
  plannedOpenDate: string | null;
  businessCategory: BusinessCategory;
  signals: NoteSignal[];
  withdrawn?: string;
  trace: TraceStep[];
}

export interface UnfilledInsight {
  territoryId: string;
  freeSlots: number;
  /** Plain-language reasons the slots are still open. */
  reasons: string[];
  viablePins: string[];
  blockedPins: { pin: string; reason: string }[];
}

export interface TerritoryResult {
  id: string;
  city: string | null;
  tier: Tier | null;
  priority: Priority | null;
  openSlots: number;
  allocated: string[];
  freeSlots: number;
  waitlist: string[];
  viablePins: string[];
  flags: Flag[];
  insight?: UnfilledInsight;
}

export interface InvariantViolation {
  rule: "H1" | "H2" | "H3" | "H4" | "H5" | "H6";
  message: string;
  ids: string[];
}

export interface InvariantResult {
  ok: boolean;
  violations: InvariantViolation[];
  /** Number of allocations checked. */
  checked: number;
}

export interface EngineResult {
  today: string;
  /** Input after overrides were applied. */
  input: EngineInput;
  decisions: Decision[];
  decisionById: Record<string, Decision>;
  territories: TerritoryResult[];
  alerts: DataAlert[];
  invariants: InvariantResult;
  counts: Record<Status, number>;
  readings: NoteReading[];
}

// ---- Overrides: what the user (inline edit or chat) has changed since the upload ----

export type EditableAppField = Exclude<AppField, "id">;

export interface Overrides {
  applications?: Record<string, Partial<Pick<Application, EditableAppField>>>;
  territories?: Record<string, { openSlots?: number; priority?: Priority; pins?: string[] }>;
  /** applicantId → reason */
  withdrawn?: Record<string, string>;
  /** Facts that aren't a field ("has a trained optometrist"). */
  addedSignals?: Record<string, NoteSignal[]>;
  /** Conditions the user says are now closed, e.g. LOAN_DEPENDENT after the loan was sanctioned. */
  resolved?: Record<string, FlagCode[]>;
}
