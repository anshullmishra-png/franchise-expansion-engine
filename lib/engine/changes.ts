import { isValidPin, parseCity, parseFloor, parseLanguage, parseNumber, parsePin, parseSpaceAvailable, parseText } from "./normalise";
import { applyOverrides } from "./overrides";
import { pinLabel } from "./reference";
import type {
  Application,
  Decision,
  EditableAppField,
  EngineInput,
  EngineResult,
  FlagCode,
  NoteSignal,
  Overrides,
  Priority,
  Status,
} from "./types";

// Changes the user makes after the upload (inline edits, chat updates) and how they are reported.
// Pure functions: the UI store and the chat tools both go through here.

export type Change =
  | { target: "application"; id: string; field: EditableAppField; value: Application[EditableAppField]; note?: string }
  | { target: "application"; id: string; field: "addSignal"; value: NoteSignal; note?: string }
  | { target: "application"; id: string; field: "resolve"; value: FlagCode; note?: string }
  | { target: "territory"; id: string; field: "openSlots"; value: number; note?: string }
  | { target: "territory"; id: string; field: "priority"; value: Priority; note?: string }
  | { target: "territory"; id: string; field: "pins"; value: string[]; note?: string };

export const FIELD_LABEL: Record<string, string> = {
  name: "Applicant name",
  city: "City",
  state: "State",
  pin: "Pin code",
  investmentLakh: "Investment (₹ lakh)",
  experienceYears: "Retail experience (years)",
  business: "Current / past business",
  spaceAvailable: "Space available",
  spaceSize: "Space size (sq ft)",
  floor: "Floor",
  targetLaunchMonths: "Target launch (months)",
  language: "Preferred language",
  notes: "Notes",
  addSignal: "Added fact",
  resolve: "Condition closed",
  openSlots: "Open slots",
  priority: "Priority",
  pins: "Pin codes covered",
};

export interface FieldDiff {
  target: "application" | "territory" | "assumption" | "withdrawal";
  id: string;
  field: string;
  label: string;
  from: string;
  to: string;
}

export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "blank";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return (v as NoteSignal).text ?? JSON.stringify(v);
  return String(v);
}

/** Turn what someone typed into the box for `field` into a typed value, or say what is wrong. */
export function coerceValue(
  field: EditableAppField,
  raw: string
): { ok: true; value: Application[EditableAppField] } | { ok: false; message: string } {
  const text = raw.trim();
  switch (field) {
    case "name":
    case "state":
    case "business":
    case "notes":
      return { ok: true, value: parseText(text) };
    case "city":
      return { ok: true, value: text === "" ? null : (parseCity(text).city ?? text) };
    case "pin":
      return { ok: true, value: parsePin(text) };
    case "investmentLakh":
    case "experienceYears":
    case "spaceSize":
    case "targetLaunchMonths": {
      if (text === "") return { ok: true, value: null };
      const n = parseNumber(text, { lakh: field === "investmentLakh" });
      if (n.invalid || n.value === null) return { ok: false, message: "Enter a number." };
      return { ok: true, value: n.value };
    }
    case "spaceAvailable": {
      if (text === "") return { ok: true, value: null };
      const r = parseSpaceAvailable(text);
      return r.value ? { ok: true, value: r.value } : { ok: false, message: "Choose Owned, Rented or Not yet identified." };
    }
    case "floor": {
      if (text === "") return { ok: true, value: null };
      const r = parseFloor(text);
      return r.value ? { ok: true, value: r.value } : { ok: false, message: "Choose Ground, Upper, Mall unit or Not known." };
    }
    case "language": {
      if (text === "") return { ok: true, value: null };
      const r = parseLanguage(text);
      return r.value ? { ok: true, value: r.value } : { ok: false, message: "Choose Kannada, English or Hindi." };
    }
  }
}

/** The value of an application field once overrides are applied. */
export function currentValue(input: EngineInput, overrides: Overrides, id: string, field: EditableAppField): unknown {
  return applyOverrides(input, overrides).applications.find((a) => a.id === id)?.[field];
}

/** Apply one change on top of the overrides. Returns the new overrides and a description, or null if nothing changes. */
export function applyChange(
  input: EngineInput,
  overrides: Overrides,
  change: Change
): { overrides: Overrides; diff: FieldDiff } | null {
  const eff = applyOverrides(input, overrides);
  const label = FIELD_LABEL[change.field] ?? change.field;

  if (change.target === "territory") {
    const t = eff.territories.find((x) => x.id === change.id);
    if (!t) return null;
    const from = change.field === "openSlots" ? t.openSlots : change.field === "priority" ? t.priority : t.pins;
    if (showValue(from) === showValue(change.value)) return null;
    const next: Overrides = {
      ...overrides,
      territories: { ...(overrides.territories ?? {}), [change.id]: { ...(overrides.territories?.[change.id] ?? {}), [change.field]: change.value } },
    };
    return { overrides: next, diff: { target: "territory", id: change.id, field: change.field, label, from: showValue(from), to: showValue(change.value) } };
  }

  const app = eff.applications.find((x) => x.id === change.id);
  if (!app) return null;

  if (change.field === "addSignal") {
    const next: Overrides = {
      ...overrides,
      addedSignals: { ...(overrides.addedSignals ?? {}), [change.id]: [...(overrides.addedSignals?.[change.id] ?? []), change.value] },
    };
    return { overrides: next, diff: { target: "application", id: change.id, field: "addSignal", label, from: "—", to: change.value.text } };
  }
  if (change.field === "resolve") {
    if (overrides.resolved?.[change.id]?.includes(change.value)) return null;
    const next: Overrides = {
      ...overrides,
      resolved: { ...(overrides.resolved ?? {}), [change.id]: [...(overrides.resolved?.[change.id] ?? []), change.value] },
    };
    return { overrides: next, diff: { target: "application", id: change.id, field: "resolve", label, from: "open", to: "closed" } };
  }

  const field = change.field;
  const from = app[field];
  if (showValue(from) === showValue(change.value)) return null;
  const next: Overrides = {
    ...overrides,
    applications: { ...(overrides.applications ?? {}), [change.id]: { ...(overrides.applications?.[change.id] ?? {}), [field]: change.value } },
  };
  return { overrides: next, diff: { target: "application", id: change.id, field, label, from: showValue(from), to: showValue(change.value) } };
}

export function withdrawApplication(input: EngineInput, overrides: Overrides, id: string, reason: string) {
  const app = input.applications.find((a) => a.id === id);
  if (!app || overrides.withdrawn?.[id] !== undefined) return null;
  const next: Overrides = { ...overrides, withdrawn: { ...(overrides.withdrawn ?? {}), [id]: reason } };
  const diff: FieldDiff = { target: "withdrawal", id, field: "withdrawn", label: "Status", from: "active", to: `withdrawn${reason ? `: ${reason}` : ""}` };
  return { overrides: next, diff };
}

// ---- Reporting what moved ----

export interface Outcome {
  status: Status;
  score: number | null;
  /** "560095 (Koramangala VI Bk), TER-01", "waitlist #1 for TER-07", or "". */
  where: string;
}

export interface OutcomeDiff {
  id: string;
  name: string | null;
  from: Outcome;
  to: Outcome;
}

export function outcomeOf(d: Decision): Outcome {
  const where = d.allocation
    ? `${pinLabel(d.allocation.pin)}, ${d.allocation.territoryId}`
    : d.waitlistRank
      ? `waitlist #${d.waitlistRank.rank} for ${d.waitlistRank.territoryId}`
      : d.withdrawn !== undefined
        ? "withdrawn"
        : "";
  return { status: d.status, score: d.score, where };
}

/** Everyone whose status or placement moved between two runs, plus `alwaysInclude` even if only their score moved. */
export function diffResults(before: EngineResult, after: EngineResult, alwaysInclude: string[] = []): OutcomeDiff[] {
  const out: OutcomeDiff[] = [];
  for (const d of after.decisions) {
    const b = before.decisionById[d.id];
    if (!b) continue;
    const from = outcomeOf(b);
    const to = outcomeOf(d);
    const moved = from.status !== to.status || from.where !== to.where;
    if (moved || (alwaysInclude.includes(d.id) && from.score !== to.score)) out.push({ id: d.id, name: d.name, from, to });
  }
  return out;
}

export { isValidPin };
