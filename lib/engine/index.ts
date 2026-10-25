import { extractNotesFallback } from "../ai/fallback";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "./assumptions";
import {
  AllocationState,
  allocate,
  buildState,
  slotsOf,
  whyPinUnavailable,
  type Candidate,
  type Placement,
} from "./allocate";
import { componentDiff, explain } from "./explain";
import { catchmentRadiusKm, distanceKm, overlapBand, overlapBetweenPins, roundKm } from "./geo";
import { InvariantError, checkInvariants } from "./invariants";
import { isValidPin, normaliseName } from "./normalise";
import { applyOverrides } from "./overrides";
import {
  buildNextSteps,
  buildTimeline,
  buildTrainingPlan,
  computePayback,
  conditionsFromFlags,
  plannedOpenDate,
  realisticMonths,
} from "./plan";
import { addDaysISO, formatDate, getPin, pinLabel, todayIST } from "./reference";
import { scoreApplication, withDestinationPriority, type ScoreResult } from "./score";
import { mergeOverrides, whatWouldChange } from "./simulate";
import {
  STATUSES,
  type Application,
  type BusinessCategory,
  type CannibalisationRow,
  type Competitor,
  type Decision,
  type EngineInput,
  type EngineResult,
  type Flag,
  type FlagCode,
  type NoteReading,
  type NoteSignal,
  type Overrides,
  type ScoreComponent,
  type Status,
  type Territory,
  type TerritoryResult,
  type Tier,
  type TraceStep,
  type UnfilledInsight,
} from "./types";
import { applicationTier, resolveTerritory, toReadingMap, validate } from "./validate";

export interface EngineOptions {
  /** ISO date (IST). Defaults to today. */
  today?: string;
  /** AI-read (or fallback) note signals by applicant. Applicants without one get the deterministic fallback. */
  readings?: NoteReading[] | Record<string, NoteReading>;
  /** Throw if a placement rule is broken. Defaults to true outside production. */
  throwOnViolation?: boolean;
  /** Work out "what would change it" by re-running the engine for each applicant who isn't moving forward. Default true. */
  simulate?: boolean;
  /** With simulate on, only these applicants get a "what would change it" (the UI asks for one at a time). */
  simulateFor?: string[];
}

export { DEFAULT_ASSUMPTIONS };
export type { Assumptions };

interface Ctx {
  app: Application;
  flags: Flag[];
  reading: NoteReading;
  tier: Tier | null;
  withdrawn?: string;
  hold: boolean;
  rejected: boolean;
  hasSite: boolean;
  ownTerritory: Territory | null;
  radiusKm: number;
  ownWorst: { storeId: string; km: number; overlapPct: number } | null;
  /** Realistic months to open, excluding any redirect (used by the launch score). */
  rBase: number;
  score?: ScoreResult;
  ownViable: boolean;
  notReady: boolean;
  candidate?: Candidate;
}

const numeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

// ---------------------------------------------------------------- readings

function assembleReadings(input: EngineInput, overrides: Overrides, supplied: EngineOptions["readings"], today: string) {
  const map = toReadingMap(supplied);
  const edited = (id: string) => {
    const e = overrides.applications?.[id];
    return !!e && ("business" in e || "notes" in e);
  };
  const needFallback = input.applications.filter((a) => !map[a.id] || edited(a.id));
  const fallback = toReadingMap(extractNotesFallback(needFallback, today));

  return input.applications.map((a): NoteReading => {
    const base = !map[a.id] || edited(a.id) ? fallback[a.id] : map[a.id];
    let signals: NoteSignal[] = [...base.signals, ...(overrides.addedSignals?.[a.id] ?? [])];
    if (overrides.resolved?.[a.id]?.includes("LOAN_DEPENDENT")) {
      const quotes = new Set(signals.filter((s) => s.type === "finance").map((s) => s.quote));
      signals = signals.filter((s) => s.type !== "finance" && !quotes.has(s.quote));
    }
    return { ...base, signals };
  });
}

// ---------------------------------------------------------------- geometry helpers

function worstAgainstStores(pin: string, radius: number, input: EngineInput) {
  let worst: { storeId: string; km: number; overlapPct: number } | null = null;
  for (const s of input.existingStores) {
    const pct = overlapBetweenPins(pin, s.pin, radius);
    if (pct > (worst?.overlapPct ?? -1)) worst = { storeId: s.id, km: distanceKm(pin, s.pin) ?? 0, overlapPct: pct };
  }
  return worst;
}

// ---------------------------------------------------------------- main

export function runEngine(
  rawInput: EngineInput,
  assumptions: Assumptions = DEFAULT_ASSUMPTIONS,
  overrides: Overrides = {},
  options: EngineOptions = {}
): EngineResult {
  const A = assumptions;
  const today = options.today ?? todayIST();
  const input = applyOverrides(rawInput, overrides);
  const readings = assembleReadings(input, overrides, options.readings, today);
  const readingById = new Map(readings.map((r) => [r.id, r]));
  const validation = validate(input, A, { today, readings });

  // ---- 1. Per-applicant facts and scores
  const ctxs: Ctx[] = input.applications.map((app): Ctx => {
    const resolved = new Set<FlagCode>(overrides.resolved?.[app.id] ?? []);
    const flags = (validation.applications[app.id] ?? []).filter((f) => !resolved.has(f.code));
    const reading = readingById.get(app.id)!;
    const tier = applicationTier(app);
    const withdrawn = overrides.withdrawn?.[app.id];
    const hold = flags.some((f) => f.severity === "blocker") || tier === null || !isValidPin(app.pin);
    const flagCodes = new Set(flags.map((f) => f.code));
    const hasSite =
      (app.spaceAvailable === "Owned" || app.spaceAvailable === "Rented" || app.spaceAvailable === "Identified (ownership unconfirmed)") &&
      !flagCodes.has("FIND_SPACE");
    const ownTerritory = isValidPin(app.pin) ? resolveTerritory(app.pin, input.territories) : null;
    const radiusKm = catchmentRadiusKm(tier, A);
    const ownWorst = app.pin && isValidPin(app.pin) ? worstAgainstStores(app.pin, radiusKm, input) : null;
    const rBase = realisticMonths({
      floor: app.floor,
      spaceAvailable: app.spaceAvailable,
      flagCodes,
      experienceYears: app.experienceYears,
      businessCategory: reading.businessCategory,
      redirected: false,
    }).months;

    const ctx: Ctx = {
      app, flags, reading, tier, withdrawn, hold, rejected: false, hasSite, ownTerritory, radiusKm, ownWorst, rBase,
      ownViable: !!ownTerritory && (ownWorst?.overlapPct ?? 0) < A.overlapBlockAtPct,
      notReady: false,
    };
    if (!hold && withdrawn === undefined && tier !== null) {
      ctx.score = scoreApplication({
        app, tier, category: reading.businessCategory, priorFranchise: reading.priorFranchise, signals: reading.signals,
        flagCodes, territory: ownTerritory, ownPinWorst: ownWorst, realisticMonths: rBase, a: A,
      });
      ctx.rejected = ctx.score.rejected;
    }
    return ctx;
  });
  const ctxById = new Map(ctxs.map((c) => [c.app.id, c]));

  // ---- 2. Candidates and allocation
  const candidates: Candidate[] = [];
  for (const c of ctxs) {
    if (c.hold || c.withdrawn !== undefined || c.rejected || !c.score || c.score.total === null || c.tier === null) continue;
    if (c.score.total < A.slotMinScore) {
      c.notReady = true;
      continue;
    }
    const penalty = c.hasSite && !c.ownViable ? A.redirectPenalty : 0;
    c.candidate = {
      id: c.app.id,
      person: normaliseName(c.app.name),
      score: c.score.total,
      effectiveScore: c.score.total - penalty,
      financialPoints: c.score.financialPoints,
      realisticMonths: c.rBase,
      pin: c.app.pin as string,
      city: c.app.city,
      tier: c.tier,
      radiusKm: c.radiusKm,
      ownTerritory: c.ownTerritory,
    };
    candidates.push(c.candidate);
  }

  const alloc = allocate({ candidates, territories: input.territories, stores: input.existingStores, assumptions: A });
  const placementById = new Map<string, Placement>(alloc.placements.map((p) => [p.applicationId, p]));
  const orderIndex = new Map(alloc.order.map((id, i) => [id, i]));

  const personOf = (id: string) => normaliseName(ctxById.get(id)?.app.name);
  const radiusOf = (id: string) => ctxById.get(id)?.radiusKm ?? 0;
  const finalState = buildState(input.existingStores, input.territories, A, alloc.placements, personOf, radiusOf);

  // ---- 3. Waitlist ranks (those who lost a slot or pin to someone else, per own territory)
  const lost = alloc.unplaced.filter((u) => u.reason !== "same-person").map((u) => u.applicationId);
  const rankByApp = new Map<string, { territoryId: string; rank: number; of: number }>();
  const queueByTerritory = new Map<string, string[]>();
  for (const id of lost) {
    const t = ctxById.get(id)!.ownTerritory;
    if (t && slotsOf(t) > 0) queueByTerritory.set(t.id, [...(queueByTerritory.get(t.id) ?? []), id]);
  }
  for (const [tid, ids] of queueByTerritory) {
    ids.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
    ids.forEach((id, i) => rankByApp.set(id, { territoryId: tid, rank: i + 1, of: ids.length }));
  }

  // ---- 4. Decisions (without explanations yet)
  type Draft = Omit<Decision, "headline" | "why" | "reasons">;
  const drafts: Draft[] = ctxs.map((c) => buildDraft(c));

  function overlapRows(pin: string, selfId: string, radiusKm: number, includeNew: boolean): CannibalisationRow[] {
    const rows: CannibalisationRow[] = [];
    for (const s of input.existingStores) {
      const pct = overlapBetweenPins(pin, s.pin, radiusKm);
      if (pct > 0) rows.push({ storeId: s.id, kind: "existing", km: roundKm(distanceKm(pin, s.pin) ?? 0), overlapPct: pct, band: overlapBand(pct, A) });
    }
    for (const p of includeNew ? alloc.placements : []) {
      if (p.applicationId === selfId) continue;
      const r = Math.max(radiusKm, radiusOf(p.applicationId));
      const pct = overlapBetweenPins(pin, p.pin, r);
      if (pct > 0) rows.push({ storeId: p.applicationId, kind: "new", km: roundKm(distanceKm(pin, p.pin) ?? 0), overlapPct: pct, band: overlapBand(pct, A) });
    }
    rows.sort((x, y) => y.overlapPct - x.overlapPct || x.km - y.km);
    if (rows.length === 0) {
      const nearest = input.existingStores
        .map((s) => ({ s, d: distanceKm(pin, s.pin) }))
        .filter((x) => x.d !== null)
        .sort((x, y) => (x.d as number) - (y.d as number))[0];
      if (nearest) rows.push({ storeId: nearest.s.id, kind: "existing", km: roundKm(nearest.d as number), overlapPct: 0, band: "Low" });
    }
    return rows;
  }

  function buildDraft(c: Ctx): Draft {
    const app = c.app;
    const placement = placementById.get(app.id);
    const trace: TraceStep[] = [...(alloc.traces.get(app.id) ?? [])];
    const flags = [...c.flags];
    const eligible = !c.hold && c.withdrawn === undefined && !c.rejected && !!c.score && c.score.total !== null && c.tier !== null;
    let components: ScoreComponent[] = c.score?.components ?? [];
    let total = c.score?.total ?? null;

    if (c.notReady && c.score?.total !== null && c.score) {
      trace.push({ kind: "below-min-score", score: c.score.total as number, min: A.slotMinScore });
    }
    // An applicant whose own pin is in no territory gets the destination territory's priority once redirected.
    if (placement && !c.ownTerritory && c.score) {
      const dest = input.territories.find((t) => t.id === placement.territoryId)!;
      components = withDestinationPriority(components, dest);
      total = Math.max(0, Math.min(100, components.reduce((s, x) => s + x.points, 0)));
    }

    const pinOfInterest = placement?.pin ?? (isValidPin(app.pin) ? (app.pin as string) : null);
    const cannibalisation = eligible && pinOfInterest ? overlapRows(pinOfInterest, app.id, c.radiusKm, !!placement) : [];
    const maxOverlap = cannibalisation.reduce((m, r) => Math.max(m, r.overlapPct), 0);

    const flagCodes = new Set(flags.map((f) => f.code));
    const redirected = placement?.kind === "redirect";
    const rFinal = eligible
      ? realisticMonths({
          floor: app.floor, spaceAvailable: app.spaceAvailable, flagCodes, experienceYears: app.experienceYears,
          businessCategory: c.reading.businessCategory, redirected,
        })
      : null;

    // Flags that need the allocation or the realistic timeline.
    if (eligible && app.targetLaunchMonths !== null && app.targetLaunchMonths < c.rBase - 1) {
      flags.push({
        code: "UNREALISTIC_TARGET",
        severity: "warning",
        field: "targetLaunchMonths",
        message: `Wants to open in ${app.targetLaunchMonths} month${app.targetLaunchMonths === 1 ? "" : "s"}, but about ${Math.round(c.rBase * 10) / 10} months is realistic (agreement, fit-out and training can't be skipped).`,
      });
    }
    const payback = eligible && c.tier !== null && (placement || c.ownViable) ? computePayback(c.tier, app.floor, app.spaceSize, maxOverlap, A) : undefined;
    if (payback && Number.isFinite(payback.months) && payback.months > A.paybackFlagMonths) {
      const m = Math.round(payback.months);
      const needsCondition = payback.months > A.paybackConditionMonths;
      flags.push({
        code: "PAYBACK_LONG",
        severity: needsCondition ? "condition" : "warning",
        message: `Estimated payback is about ${m} months${needsCondition ? `, longer than the ${A.paybackConditionMonths}-month limit, so the economics need to improve (e.g. a ground-floor space or a pin with less overlap)` : `, above the ${A.paybackFlagMonths}-month comfort level`}.`,
      });
    }

    if (redirected && placement) {
      flags.push({
        code: "SITE_AT_NEW_PIN",
        severity: "condition",
        field: "pin",
        message: `Needs a site at the new pin ${pinLabel(placement.pin)}; the slot is held for ${A.conditionDays.site} days while one is found.`,
      });
    }

    // Status
    let status: Status;
    let allocation: Decision["allocation"];
    const conditionCount = flags.filter((f) => f.severity === "condition").length;
    if (c.withdrawn !== undefined) status = "REJECTED";
    else if (c.hold) status = "HOLD";
    else if (c.rejected) status = "REJECTED";
    else if (placement) {
      allocation = {
        territoryId: placement.territoryId,
        pin: placement.pin,
        area: getPin(placement.pin)?.area ?? null,
      };
      if (placement.kind === "redirect") {
        allocation.redirectedFrom = placement.from;
        allocation.slotReservedUntil = addDaysISO(today, A.conditionDays.site);
        status = "REDIRECT";
      } else status = conditionCount === 0 && (total ?? 0) >= A.approveScore ? "APPROVED" : "CONDITIONAL";
    } else status = "WAITLIST";

    const penaltyApplied = !!c.score && c.hasSite && (redirected || (!c.ownViable && !!c.candidate));
    const effectiveScore = total === null ? null : total - (penaltyApplied ? A.redirectPenalty : 0);

    const moving = status === "APPROVED" || status === "CONDITIONAL" || status === "REDIRECT";
    const decisiveSignals = (() => {
      const sig = components.find((x) => x.key === "signals")?.points ?? 0;
      if (!sig || total === null) return false;
      const without = total - sig;
      return (without >= A.approveScore) !== (total >= A.approveScore) || (without >= A.slotMinScore) !== (total >= A.slotMinScore);
    })();
    const contradictory = flags.some((f) => ["INVESTMENT_CONTRADICTION", "SPACE_CONTRADICTION", "DUPLICATE_ID", "PROBABLE_DUPLICATE"].includes(f.code));
    const nearEdge = total !== null && [A.approveScore, A.slotMinScore].some((th) => Math.abs(total! - th) <= 2);
    const confidence: Decision["confidence"] =
      c.hold || flagCodes.has("APPROX_COORDS") || contradictory || decisiveSignals
        ? "low"
        : redirected || conditionCount >= 2 || nearEdge
          ? "medium"
          : "high";

    // Onboarding: next steps and the readiness plan for those moving forward; an indicative training plan
    // (no dates) for waitlisted applicants, so "how would they be trained?" always has an answer.
    const conditions = moving ? conditionsFromFlags(flags, today, A) : undefined;
    const openDate = rFinal ? plannedOpenDate(today, app.targetLaunchMonths, rFinal.months) : null;
    let nextSteps: Decision["nextSteps"];
    let readinessPlan: Decision["readinessPlan"];
    if (moving && allocation && openDate) {
      const training = buildTrainingPlan({
        pin: allocation.pin, language: app.language, experienceYears: app.experienceYears,
        businessCategory: c.reading.businessCategory, stores: input.existingStores, openDate,
      });
      readinessPlan = {
        indicative: false,
        timeline: buildTimeline({ today, open: openDate, floor: app.floor, conditions: conditions ?? [], partnerTrainingDays: training.totalDays }),
        training,
      };
      nextSteps = buildNextSteps({
        today,
        conditions: conditions ?? [],
        shortlist: status === "REDIRECT" ? shortlistFor(app.id, allocation.territoryId, allocation.pin) : null,
        hasSite: c.hasSite,
        slotReservedUntil: allocation.slotReservedUntil ? formatDate(allocation.slotReservedUntil) : undefined,
        siteLabel: pinLabel(allocation.pin),
      });
    } else if (status === "WAITLIST" && eligible && isValidPin(app.pin)) {
      readinessPlan = {
        indicative: true,
        timeline: [],
        training: buildTrainingPlan({
          pin: app.pin as string, language: app.language, experienceYears: app.experienceYears,
          businessCategory: c.reading.businessCategory, stores: input.existingStores, openDate: null,
        }),
      };
    }

    return {
      id: app.id,
      name: app.name,
      city: app.city,
      pin: app.pin,
      tier: c.tier,
      nextSteps,
      readinessPlan,
      status,
      score: total,
      effectiveScore,
      redirectPenaltyApplied: penaltyApplied && redirected,
      breakdown: components,
      flags: flags.sort((a, b) => ["blocker", "condition", "warning", "info"].indexOf(a.severity) - ["blocker", "condition", "warning", "info"].indexOf(b.severity)),
      allocation,
      ownTerritoryId: c.ownTerritory?.id ?? null,
      cannibalisation,
      payback,
      waitlistRank: status === "WAITLIST" ? rankByApp.get(app.id) : undefined,
      conditions,
      questionsForApplicant:
        status === "HOLD" ? flags.filter((f) => f.severity === "blocker" && f.question).map((f) => f.question as string) : undefined,
      confidence,
      realisticMonths: rFinal ? rFinal.months : null,
      plannedOpenDate: openDate,
      businessCategory: c.reading.businessCategory as BusinessCategory,
      signals: c.reading.signals,
      withdrawn: c.withdrawn,
      trace,
    };
  }

  // ---- 5. Competitors (who took the slot or pin, and why they out-scored this applicant)
  const draftById = new Map(drafts.map((d) => [d.id, d]));
  for (const d of drafts) {
    if (d.status !== "WAITLIST" && d.status !== "REDIRECT") continue;
    const rivals: string[] = [];
    for (const t of d.trace) {
      if (t.kind === "territory-full") rivals.push(...t.heldBy);
      else if (t.kind === "own-pin-taken") rivals.push(t.by);
      else if (t.kind === "own-pin-overlap-new") rivals.push(t.with);
      else if (t.kind === "same-person") rivals.push(t.other);
    }
    const unique = [...new Set(rivals)].filter((id) => id !== d.id).slice(0, 3);
    const comps: Competitor[] = [];
    for (const id of unique) {
      const w = draftById.get(id);
      if (!w) continue;
      const samePerson = d.trace.some((t) => t.kind === "same-person" && t.other === id);
      comps.push({
        id,
        score: w.score,
        outcome: w.status,
        whyTheyWon: samePerson
          ? "the same person, already placed through the higher-ranked application"
          : `${w.score} vs ${d.score}: ${componentDiff(w.breakdown, d.breakdown)}`,
      });
    }
    if (comps.length) d.competitors = comps;
  }

  // ---- 6. "What would change it": re-run the engine with the obvious fix for those not moving forward
  if (options.simulate !== false) {
    const base = Object.fromEntries(drafts.map((d) => [d.id, { status: d.status, score: d.score, pin: d.allocation?.pin ?? null }]));
    const simulate = {
      run: (delta: Overrides) =>
        runEngine(rawInput, A, mergeOverrides(overrides, delta), { ...options, today, simulate: false, throwOnViolation: options.throwOnViolation }),
      base,
      A,
      altPin: (id: string) => altPinFor(id),
    };
    for (const d of drafts) {
      if (d.status === "APPROVED" || d.status === "CONDITIONAL" || d.status === "REDIRECT") continue;
      if (options.simulateFor && !options.simulateFor.includes(d.id)) continue;
      d.whatWouldChange = whatWouldChange(d, ctxById.get(d.id)!.app, simulate);
    }
  }

  // ---- 7. Explanations
  const decisions: Decision[] = drafts.map((d) => {
    const c = ctxById.get(d.id)!;
    const gap = c.score?.rejected ? Math.max(0, A.investmentNeedLakh[c.tier ?? 2] * 0.6 - (c.app.investmentLakh ?? 0)) : undefined;
    const out = explain({ ...d, app: c.app, a: A, hasSite: c.hasSite, investmentGapTo60: gap });
    return { ...d, ...out };
  });
  decisions.sort((a, b) => numeric(a.id, b.id));
  const decisionById: Record<string, Decision> = Object.fromEntries(decisions.map((d) => [d.id, d]));

  /** Pins in the same city that are still free and legal, nearest to the applicant's own pin first. */
  function freePins(id: string): { pin: string; territoryId: string; km: number }[] {
    const c = ctxById.get(id)!;
    if (!c.app.pin || !isValidPin(c.app.pin)) return [];
    const out: { pin: string; territoryId: string; km: number }[] = [];
    for (const t of input.territories) {
      if (t.city !== c.app.city || finalState.slotsLeft(t) <= 0) continue;
      for (const pin of t.pins) {
        if (pin === c.app.pin || whyPinUnavailable(pin, c.radiusKm, finalState) !== null) continue;
        out.push({ pin, territoryId: t.id, km: distanceKm(c.app.pin, pin) ?? Infinity });
      }
    }
    return out.sort((a, b) => a.km - b.km || a.pin.localeCompare(b.pin));
  }
  function altPinFor(id: string): string | null {
    return freePins(id)[0]?.pin ?? null;
  }

  /** The allocated pin plus up to two other free pins in the same territory where a site could be found. */
  function shortlistFor(id: string, territoryId: string, allocatedPin: string): string[] {
    const t = input.territories.find((x) => x.id === territoryId);
    const c = ctxById.get(id)!;
    if (!t) return [allocatedPin];
    const without = buildState(input.existingStores, input.territories, A, alloc.placements.filter((p) => p.applicationId !== id), personOf, radiusOf);
    const others = t.pins
      .filter((p) => p !== allocatedPin && whyPinUnavailable(p, c.radiusKm, without) === null)
      .sort((a, b) => (distanceKm(allocatedPin, a) ?? Infinity) - (distanceKm(allocatedPin, b) ?? Infinity) || a.localeCompare(b));
    return [allocatedPin, ...others.slice(0, 2)];
  }

  // ---- 8. Territories, waitlists and unfilled-slot insights
  const territories: TerritoryResult[] = input.territories.map((t) => {
    const placedHere = finalState.placedIn(t.id).map((p) => p.applicationId);
    const free = slotsOf(t) - placedHere.length;
    const radius = catchmentRadiusKm(t.tier, A);
    const viable: string[] = [];
    const blocked: { pin: string; reason: string }[] = [];
    for (const pin of t.pins) {
      const why = whyPinUnavailable(pin, radius, finalState);
      if (why === null) viable.push(pin);
      else blocked.push({ pin, reason: why });
    }
    const queue = (queueByTerritory.get(t.id) ?? []).slice();
    const result: TerritoryResult = {
      id: t.id,
      city: t.city,
      tier: t.tier,
      priority: t.priority,
      openSlots: slotsOf(t),
      allocated: placedHere.sort(numeric),
      freeSlots: free,
      waitlist: queue,
      viablePins: viable,
      flags: validation.territories[t.id] ?? [],
    };
    if (free > 0) result.insight = buildInsight(t, free, viable, blocked);
    return result;
  });

  function buildInsight(t: Territory, free: number, viable: string[], blocked: { pin: string; reason: string }[]): UnfilledInsight {
    const reasons: string[] = [];
    const here = ctxs.filter((c) => c.ownTerritory?.id === t.id);
    const notPlaced = here.filter((c) => !placementById.has(c.app.id));
    if (t.pins.length === 0) reasons.push("The territory lists no valid pin codes.");
    const notReady = notPlaced.filter((c) => c.notReady);
    const held = notPlaced.filter((c) => c.hold);
    const rejected = notPlaced.filter((c) => !c.hold && c.rejected);
    if (here.length === 0) reasons.push("No applicant applied for a pin in this territory.");
    if (notReady.length)
      reasons.push(`Applicants here aren't ready: ${notReady.map((c) => `${c.app.id} (score ${c.score?.total}, needs ${A.slotMinScore})`).join(", ")}. The slot isn't forced on a weak application.`);
    if (held.length) reasons.push(`On hold pending answers: ${held.map((c) => c.app.id).join(", ")}.`);
    if (rejected.length) reasons.push(`Below the investment minimum: ${rejected.map((c) => c.app.id).join(", ")}.`);
    if (viable.length === 0 && t.pins.length > 0) {
      reasons.push(`No viable pin is left: ${blocked.map((b) => `${pinLabel(b.pin)} (${b.reason})`).join("; ")}.`);
    } else if (viable.length > 0) {
      reasons.push(`Pins still open: ${viable.map(pinLabel).join(", ")}.`);
    }
    return { territoryId: t.id, freeSlots: free, reasons, viablePins: viable, blockedPins: blocked };
  }

  // ---- 9. Placement rules, re-verified independently
  const invariants = checkInvariants({
    allocations: alloc.placements.map((p) => ({ applicationId: p.applicationId, territoryId: p.territoryId, pin: p.pin })),
    territories: input.territories,
    existingStores: input.existingStores,
    applications: input.applications,
    assumptions: A,
  });
  const shouldThrow = options.throwOnViolation ?? process.env.NODE_ENV !== "production";
  if (!invariants.ok && shouldThrow) throw new InvariantError(invariants);

  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const d of decisions) counts[d.status]++;

  return {
    today,
    input,
    decisions,
    decisionById,
    territories,
    alerts: validation.alerts,
    invariants,
    counts,
    readings,
  };
}

export { AllocationState };
export { checkInvariants, InvariantError, RULE_TEXT } from "./invariants";
export { applyExampleChoice, parseWorkbook } from "./parse";
export { validate } from "./validate";
