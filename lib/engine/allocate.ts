import type { Assumptions } from "./assumptions";
import { coordsOf, distanceKm, overlapBetweenPins, roundKm } from "./geo";
import { PRIORITY_RANK } from "./reference";
import type { ExistingStore, Territory, Tier, TraceStep } from "./types";

// Slot and pin allocation (SPEC §5.5). Deterministic: same input, same output.

export interface Candidate {
  id: string;
  /** Normalised name, for the one-store-per-person rule (H6). */
  person: string;
  score: number;
  /** Score used for ordering: score minus the redirect penalty when the own pin is already known to be unusable. */
  effectiveScore: number;
  financialPoints: number;
  realisticMonths: number;
  pin: string;
  city: string | null;
  tier: Tier;
  radiusKm: number;
  ownTerritory: Territory | null;
}

export interface Placement {
  applicationId: string;
  territoryId: string;
  pin: string;
  kind: "own" | "redirect";
  /** Redirect only: where they had applied. */
  from?: { territoryId: string | null; pin: string };
  /** Redirect only: stayed in their own territory (pass 1) or moved to another (pass 2). */
  sameTerritory?: boolean;
}

export type Unplaced = { applicationId: string; reason: "same-person" | "territory-full" | "no-viable-pin" | "no-slot-in-city" };

export interface AllocationOutput {
  placements: Placement[];
  unplaced: Unplaced[];
  traces: Map<string, TraceStep[]>;
  /** Candidates in the order they were considered. */
  order: string[];
}

export const slotsOf = (t: Territory) => Math.max(0, t.openSlots ?? 0);

const numericId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Highest effective score first; then financial points, earlier realistic launch, then ID. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    b.effectiveScore - a.effectiveScore ||
    b.financialPoints - a.financialPoints ||
    a.realisticMonths - b.realisticMonths ||
    numericId(a.id, b.id)
  );
}

// ---------------------------------------------------------------- state and pin checks

export class AllocationState {
  readonly placed: Placement[] = [];
  private byPin = new Map<string, Placement>();
  private byTerritory = new Map<string, Placement[]>();
  private byPerson = new Map<string, string>();
  readonly storeAtPin: Map<string, ExistingStore>;

  constructor(
    readonly stores: ExistingStore[],
    readonly territories: Territory[],
    readonly a: Assumptions,
    private personOf: (id: string) => string,
    private radiusOf: (id: string) => number
  ) {
    this.storeAtPin = new Map(stores.map((s) => [s.pin, s]));
  }

  add(p: Placement): void {
    this.placed.push(p);
    this.byPin.set(p.pin, p);
    this.byTerritory.set(p.territoryId, [...(this.byTerritory.get(p.territoryId) ?? []), p]);
    const person = this.personOf(p.applicationId);
    if (person) this.byPerson.set(person, p.applicationId);
  }

  placedIn(territoryId: string): Placement[] {
    return this.byTerritory.get(territoryId) ?? [];
  }

  slotsLeft(t: Territory): number {
    return slotsOf(t) - this.placedIn(t.id).length;
  }

  personHolder(person: string): string | undefined {
    return person ? this.byPerson.get(person) : undefined;
  }

  placementAt(pin: string): Placement | undefined {
    return this.byPin.get(pin);
  }

  /** Radius to use between a new store and another new store: the larger of the two (same city = equal). */
  pairRadius(applicantId: string, other: Placement, ownRadius: number): number {
    return Math.max(ownRadius, this.radiusOf(other.applicationId));
  }
}

export type PinCheck =
  | { ok: true; maxOverlapPct: number }
  | { ok: false; step: Extract<TraceStep, { kind: "own-pin-store" | "own-pin-overlap" | "own-pin-taken" | "own-pin-overlap-new" | "no-coords" }> };

/** Can this applicant's store go at `pin`? Checks H1, H2 and H5, and reports the worst overlap if so. */
export function checkPin(
  c: { id: string; radiusKm: number },
  pin: string,
  state: AllocationState
): PinCheck {
  const A = state.a;
  const store = state.storeAtPin.get(pin);
  if (store) return { ok: false, step: { kind: "own-pin-store", pin, storeId: store.id } };
  const holder = state.placementAt(pin);
  if (holder) return { ok: false, step: { kind: "own-pin-taken", pin, by: holder.applicationId } };
  if (!coordsOf(pin)) return { ok: false, step: { kind: "no-coords", pin } };

  let worst = 0;
  for (const s of state.stores) {
    const pct = overlapBetweenPins(pin, s.pin, c.radiusKm);
    if (pct >= A.overlapBlockAtPct) {
      return { ok: false, step: { kind: "own-pin-overlap", pin, storeId: s.id, overlapPct: pct, km: distanceKm(pin, s.pin) ?? 0 } };
    }
    worst = Math.max(worst, pct);
  }
  for (const p of state.placed) {
    const pct = overlapBetweenPins(pin, p.pin, state.pairRadius(c.id, p, c.radiusKm));
    if (pct >= A.overlapBlockAtPct) {
      return {
        ok: false,
        step: { kind: "own-pin-overlap-new", pin, with: p.applicationId, withPin: p.pin, overlapPct: pct, km: distanceKm(pin, p.pin) ?? 0 },
      };
    }
    worst = Math.max(worst, pct);
  }
  return { ok: true, maxOverlapPct: worst };
}

interface PinOption {
  territory: Territory;
  pin: string;
  overlap: number;
  dist: number;
}

function options(c: Candidate, t: Territory, state: AllocationState): PinOption[] {
  const out: PinOption[] = [];
  for (const pin of t.pins) {
    const res = checkPin(c, pin, state);
    if (!res.ok) continue;
    out.push({ territory: t, pin, overlap: res.maxOverlapPct, dist: distanceKm(c.pin, pin) ?? Infinity });
  }
  return out;
}

const byOverlapThenDistance = (a: PinOption, b: PinOption) =>
  a.overlap - b.overlap || a.dist - b.dist || a.pin.localeCompare(b.pin);

const byDistanceThenOverlap = (a: PinOption, b: PinOption) =>
  a.dist - b.dist ||
  a.overlap - b.overlap ||
  (b.territory.priority ? PRIORITY_RANK[b.territory.priority] : 0) - (a.territory.priority ? PRIORITY_RANK[a.territory.priority] : 0) ||
  numericId(a.territory.id, b.territory.id) ||
  a.pin.localeCompare(b.pin);

// ---------------------------------------------------------------- the two passes

export function allocate(args: {
  candidates: Candidate[];
  territories: Territory[];
  stores: ExistingStore[];
  assumptions: Assumptions;
}): AllocationOutput {
  const { territories, stores, assumptions } = args;
  const sorted = [...args.candidates].sort(compareCandidates);
  const byId = new Map(sorted.map((c) => [c.id, c]));
  const state = new AllocationState(
    stores,
    territories,
    assumptions,
    (id) => byId.get(id)?.person ?? "",
    (id) => byId.get(id)?.radiusKm ?? 0
  );
  const traces = new Map<string, TraceStep[]>(sorted.map((c) => [c.id, []]));
  const unplaced: Unplaced[] = [];
  const deferred: Candidate[] = [];
  const note = (id: string, step: TraceStep) => traces.get(id)!.push(step);

  // Pass 1: own territory
  for (const c of sorted) {
    const holder = state.personHolder(c.person);
    if (holder) {
      note(c.id, { kind: "same-person", other: holder });
      unplaced.push({ applicationId: c.id, reason: "same-person" });
      continue;
    }
    const t = c.ownTerritory;
    if (!t) {
      note(c.id, { kind: "no-territory", pin: c.pin });
      deferred.push(c);
      continue;
    }
    const free = state.slotsLeft(t);
    const own = checkPin(c, c.pin, state);

    if (own.ok && free > 0) {
      place(state, traces, { applicationId: c.id, territoryId: t.id, pin: c.pin, kind: "own" });
      continue;
    }
    if (!own.ok) note(c.id, own.step);
    if (free <= 0) {
      note(c.id, { kind: "territory-full", territoryId: t.id, heldBy: state.placedIn(t.id).map((p) => p.applicationId) });
      deferred.push(c);
      continue;
    }
    const alt = options(c, t, state).sort(byOverlapThenDistance)[0];
    if (alt) {
      place(state, traces, {
        applicationId: c.id,
        territoryId: t.id,
        pin: alt.pin,
        kind: "redirect",
        from: { territoryId: t.id, pin: c.pin },
        sameTerritory: true,
      });
    } else {
      note(c.id, { kind: "no-viable-pin", territoryId: t.id });
      deferred.push(c);
    }
  }

  // Pass 2: other territories in the same city
  for (const c of deferred) {
    const holder = state.personHolder(c.person);
    if (holder) {
      note(c.id, { kind: "same-person", other: holder });
      unplaced.push({ applicationId: c.id, reason: "same-person" });
      continue;
    }
    const candidates = territories
      .filter((t) => t.city === c.city && t.id !== c.ownTerritory?.id && state.slotsLeft(t) > 0)
      .flatMap((t) => options(c, t, state));
    const best = candidates.sort(byDistanceThenOverlap)[0];
    if (best) {
      place(state, traces, {
        applicationId: c.id,
        territoryId: best.territory.id,
        pin: best.pin,
        kind: "redirect",
        from: { territoryId: c.ownTerritory?.id ?? null, pin: c.pin },
        sameTerritory: false,
      });
      continue;
    }
    const anyFree = territories.some((t) => t.city === c.city && t.id !== c.ownTerritory?.id && state.slotsLeft(t) > 0);
    if (anyFree) {
      const t = territories.find((x) => x.city === c.city && x.id !== c.ownTerritory?.id && state.slotsLeft(x) > 0)!;
      note(c.id, { kind: "no-viable-pin", territoryId: t.id });
      unplaced.push({ applicationId: c.id, reason: "no-viable-pin" });
    } else {
      note(c.id, { kind: "no-free-slot-in-city", city: c.city });
      unplaced.push({ applicationId: c.id, reason: c.ownTerritory ? "territory-full" : "no-slot-in-city" });
    }
  }

  return { placements: state.placed, unplaced, traces, order: sorted.map((c) => c.id) };
}

function place(state: AllocationState, traces: Map<string, TraceStep[]>, p: Placement): void {
  state.add(p);
  traces.get(p.applicationId)!.push({ kind: "allocated", territoryId: p.territoryId, pin: p.pin, redirect: p.kind === "redirect" });
}

// ---------------------------------------------------------------- territory-level viability (for insights)

/** Why a pin can't take another store right now, in plain words; null if it can. */
export function whyPinUnavailable(pin: string, radiusKm: number, state: AllocationState): string | null {
  const probe = { id: "", radiusKm };
  const res = checkPin(probe, pin, state);
  if (res.ok) return null;
  const s = res.step;
  switch (s.kind) {
    case "own-pin-store":
      return `${s.storeId} is already there`;
    case "own-pin-taken":
      return `${s.by} is placed there`;
    case "own-pin-overlap":
      return `${Math.round(s.overlapPct)}% catchment overlap with ${s.storeId} (${roundKm(s.km)} km away)`;
    case "own-pin-overlap-new":
      return `${Math.round(s.overlapPct)}% catchment overlap with the new ${s.with} store at ${s.withPin} (${roundKm(s.km)} km away)`;
    default:
      return "no map position on file";
  }
}

export function buildState(
  stores: ExistingStore[],
  territories: Territory[],
  assumptions: Assumptions,
  placements: Placement[],
  personOf: (id: string) => string,
  radiusOf: (id: string) => number
): AllocationState {
  const state = new AllocationState(stores, territories, assumptions, personOf, radiusOf);
  for (const p of placements) state.add(p);
  return state;
}
