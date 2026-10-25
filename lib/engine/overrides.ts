import { isValidPin } from "./normalise";
import { findCity, tierOfCity } from "./reference";
import type { Application, EngineInput, Overrides, Territory } from "./types";

// Overrides are what the user changed after the upload (inline edits or chat updates).
// They are applied on top of the parsed input; the parsed input itself is never mutated.

export const NO_OVERRIDES: Overrides = {};

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function applyOverrides(input: EngineInput, overrides: Overrides = NO_OVERRIDES): EngineInput {
  const appEdits = overrides.applications ?? {};
  const terEdits = overrides.territories ?? {};

  const applications = input.applications.map((a): Application => {
    const edit = appEdits[a.id];
    if (!edit || Object.keys(edit).length === 0) return a;
    const next: Application = { ...a, ...edit, raw: { ...a.raw }, parseIssues: [...a.parseIssues] };
    for (const [field, value] of Object.entries(edit)) {
      next.raw[field as keyof Application["raw"]] = text(value);
      // An edited field no longer has the parsing problem it had in the file.
      next.parseIssues = next.parseIssues.filter((p) => p.field !== field);
    }
    if (edit.city !== undefined && edit.city !== null) next.city = findCity(edit.city)?.city ?? edit.city;
    return next;
  });

  const territories = input.territories.map((t): Territory => {
    const edit = terEdits[t.id];
    if (!edit) return t;
    const next: Territory = { ...t, raw: { ...t.raw }, parseIssues: [...t.parseIssues] };
    if (edit.openSlots !== undefined) {
      next.openSlots = edit.openSlots;
      next.raw.openSlots = String(edit.openSlots);
      next.parseIssues = next.parseIssues.filter((p) => p.field !== "openSlots");
    }
    if (edit.priority !== undefined) {
      next.priority = edit.priority;
      next.raw.priority = edit.priority;
      next.parseIssues = next.parseIssues.filter((p) => p.field !== "priority");
    }
    if (edit.pins !== undefined) {
      next.pins = [...new Set(edit.pins.filter(isValidPin))];
      next.invalidPinTokens = edit.pins.filter((p) => !isValidPin(p));
      next.raw.pins = edit.pins.join(", ");
      next.parseIssues = next.parseIssues.filter((p) => p.field !== "pins");
    }
    next.tier = tierOfCity(next.city) ?? next.statedTier;
    return next;
  });

  return { ...input, applications, territories };
}
