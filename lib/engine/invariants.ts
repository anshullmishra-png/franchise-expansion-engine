import type { Assumptions } from "./assumptions";
import { catchmentRadiusKm, overlapBetweenPins } from "./geo";
import { normaliseName } from "./normalise";
import { applicationTier } from "./validate";
import type { Application, ExistingStore, InvariantResult, InvariantViolation, Territory } from "./types";

// Independent re-check of the six placement rules on the FINAL allocation (SPEC §5.3).
// This deliberately shares no allocation code, so a bug there cannot hide here.

export const RULE_TEXT: Record<InvariantViolation["rule"], string> = {
  H1: "No new store in a pin code that already has an existing store.",
  H2: "At most one new store per pin code.",
  H3: "New stores per territory never exceed its open slots.",
  H4: "A new store sits in a territory that has open slots and lists its pin.",
  H5: "No new store's catchment overlaps an existing or another new store's by 45% or more.",
  H6: "At most one store per applicant.",
};

export interface PlacedStore {
  applicationId: string;
  territoryId: string;
  pin: string;
}

export interface InvariantInput {
  allocations: PlacedStore[];
  territories: Territory[];
  existingStores: ExistingStore[];
  applications: Application[];
  assumptions: Assumptions;
}

const slotsOf = (t: Territory) => Math.max(0, t.openSlots ?? 0);

export function checkInvariants(x: InvariantInput): InvariantResult {
  const violations: InvariantViolation[] = [];
  const add = (rule: InvariantViolation["rule"], message: string, ids: string[]) =>
    violations.push({ rule, message, ids });
  const appById = new Map(x.applications.map((a) => [a.id, a]));
  const terById = new Map(x.territories.map((t) => [t.id, t]));
  const blockAt = x.assumptions.overlapBlockAtPct;

  // H1
  const storeAtPin = new Map(x.existingStores.map((s) => [s.pin, s.id]));
  for (const al of x.allocations) {
    const st = storeAtPin.get(al.pin);
    if (st) add("H1", `${al.applicationId} is placed at ${al.pin}, which already has ${st}.`, [al.applicationId]);
  }

  // H2
  const byPin = new Map<string, string[]>();
  for (const al of x.allocations) byPin.set(al.pin, [...(byPin.get(al.pin) ?? []), al.applicationId]);
  for (const [pin, ids] of byPin) {
    if (ids.length > 1) add("H2", `Pin ${pin} is given to more than one applicant: ${ids.join(", ")}.`, ids);
  }

  // H3 and H4
  const byTer = new Map<string, PlacedStore[]>();
  for (const al of x.allocations) byTer.set(al.territoryId, [...(byTer.get(al.territoryId) ?? []), al]);
  for (const [tid, list] of byTer) {
    const t = terById.get(tid);
    if (!t) {
      add("H4", `${list.map((l) => l.applicationId).join(", ")} placed in ${tid}, which doesn't exist.`, list.map((l) => l.applicationId));
      continue;
    }
    if (list.length > slotsOf(t)) {
      add("H3", `${tid} has ${slotsOf(t)} open slot(s) but ${list.length} stores are placed: ${list.map((l) => l.applicationId).join(", ")}.`, list.map((l) => l.applicationId));
    }
    if (slotsOf(t) <= 0) {
      add("H4", `${tid} has no open slots but ${list.map((l) => l.applicationId).join(", ")} is placed there.`, list.map((l) => l.applicationId));
    }
    for (const al of list) {
      if (!t.pins.includes(al.pin)) add("H4", `${al.applicationId} is placed at ${al.pin}, which ${tid} does not list.`, [al.applicationId]);
    }
  }

  // H5: against existing stores (applicant's tier radius), and between new stores (larger of the two radii)
  const radiusOf = (id: string) => {
    const app = appById.get(id);
    const ter = terById.get(x.allocations.find((a) => a.applicationId === id)?.territoryId ?? "");
    return catchmentRadiusKm(app ? applicationTier(app) : (ter?.tier ?? null), x.assumptions);
  };
  for (const al of x.allocations) {
    const r = radiusOf(al.applicationId);
    for (const st of x.existingStores) {
      const pct = overlapBetweenPins(al.pin, st.pin, r);
      if (pct >= blockAt) add("H5", `${al.applicationId} at ${al.pin} overlaps ${st.id} by ${Math.round(pct)}%.`, [al.applicationId, st.id]);
    }
  }
  for (let i = 0; i < x.allocations.length; i++) {
    for (let j = i + 1; j < x.allocations.length; j++) {
      const a = x.allocations[i];
      const b = x.allocations[j];
      if (a.pin === b.pin) continue; // already reported as H2
      const r = Math.max(radiusOf(a.applicationId), radiusOf(b.applicationId));
      const pct = overlapBetweenPins(a.pin, b.pin, r);
      if (pct >= blockAt) add("H5", `New stores ${a.applicationId} (${a.pin}) and ${b.applicationId} (${b.pin}) overlap by ${Math.round(pct)}%.`, [a.applicationId, b.applicationId]);
    }
  }

  // H6
  const byPerson = new Map<string, string[]>();
  for (const al of x.allocations) {
    const name = normaliseName(appById.get(al.applicationId)?.name);
    if (!name) continue;
    byPerson.set(name, [...(byPerson.get(name) ?? []), al.applicationId]);
  }
  for (const [name, ids] of byPerson) {
    if (ids.length > 1) add("H6", `${name} holds more than one store: ${ids.join(", ")}.`, ids);
  }

  return { ok: violations.length === 0, violations, checked: x.allocations.length };
}

export class InvariantError extends Error {
  constructor(public result: InvariantResult) {
    super(`Placement rules violated: ${result.violations.map((v) => `${v.rule}: ${v.message}`).join(" | ")}`);
  }
}
