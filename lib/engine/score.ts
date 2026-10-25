import type { Assumptions } from "./assumptions";
import { overlapBand, roundKm, safetyPoints } from "./geo";
import type {
  Application,
  BusinessCategory,
  FlagCode,
  NoteSignal,
  ScoreComponent,
  Territory,
  Tier,
} from "./types";

// The 100-point score (SPEC §5.4). Computed once per applicant from their own situation.

const EPS = 1e-9;
const TIER_NAME: Record<Tier, string> = { 1: "Tier 1", 2: "Tier 2", 3: "Tier 3" };

export const CATEGORY_LABEL: Record<BusinessCategory, string> = {
  eyewear_optical_watches: "eyewear, optical or watches",
  specialty_retail: "specialty retail",
  general_or_food_retail: "general or food retail",
  retail_manager: "salaried retail manager",
  non_retail_business: "non-retail business",
  salaried_non_retail: "salaried, non-retail",
  unknown: "no relevant business given",
};

const RELEVANCE: Record<BusinessCategory, number> = {
  eyewear_optical_watches: 5,
  specialty_retail: 4,
  general_or_food_retail: 3,
  retail_manager: 3,
  non_retail_business: 2,
  salaried_non_retail: 0,
  unknown: 0,
};

export interface ScoreInputs {
  app: Application;
  tier: Tier;
  category: BusinessCategory;
  priorFranchise: boolean;
  signals: NoteSignal[];
  flagCodes: Set<FlagCode>;
  /** Territory that lists the applicant's own pin (null when no territory does). */
  territory: Territory | null;
  /** Highest catchment overlap of the applicant's own pin with any existing store, and which store. */
  ownPinWorst: { storeId: string; km: number; overlapPct: number } | null;
  /** Realistic months to open, excluding any redirect (SPEC §5.6). */
  realisticMonths: number;
  a: Assumptions;
}

export interface ScoreResult {
  /** Investment is below 60% of the tier need: a hard minimum. */
  rejected: boolean;
  /** investment ÷ tier need */
  ratio: number;
  components: ScoreComponent[];
  /** null when rejected */
  total: number | null;
  financialPoints: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const pct = (r: number) => `${Math.round(r * 100)}%`;
const lakh = (n: number) => `₹${Math.round(n * 100) / 100} lakh`;

export function financialPoints(ratio: number): number | null {
  if (ratio >= 1.25 - EPS) return 25;
  if (ratio >= 1.1 - EPS) return 22;
  if (ratio >= 1.0 - EPS) return 19;
  if (ratio >= 0.85 - EPS) return 12;
  if (ratio >= 0.6 - EPS) return 5;
  return null;
}

function financial(i: ScoreInputs): { c: ScoreComponent; ratio: number; reject: boolean } {
  const need = i.a.investmentNeedLakh[i.tier];
  const inv = i.app.investmentLakh ?? 0;
  const ratio = inv / need;
  const pts = financialPoints(ratio);
  const base = `${lakh(inv)} is ${pct(ratio)} of the ${lakh(need)} a ${TIER_NAME[i.tier]} store needs`;
  if (pts === null) {
    return {
      ratio,
      reject: true,
      c: {
        key: "financial",
        name: "Financial readiness",
        points: 0,
        max: 25,
        reason: `${base}. Below the 60% minimum, so the application can't go ahead as it stands (gap of ${lakh(need * 0.6 - inv)} to reach 60%).`,
      },
    };
  }
  const note = ratio >= 1 ? "covers the need" : `${lakh(need - inv)} short`;
  return {
    ratio,
    reject: false,
    c: { key: "financial", name: "Financial readiness", points: pts, max: 25, reason: `${base} (${note}).` },
  };
}

function experience(i: ScoreInputs): ScoreComponent {
  const years = Math.floor(i.app.experienceYears ?? 0);
  const yearPts = years >= 8 ? 15 : years >= 5 ? 14 : years >= 3 ? 12 : years >= 2 ? 9 : years >= 1 ? 7 : 3;
  const relevance = RELEVANCE[i.category];
  const bonus = i.priorFranchise && relevance < 5 ? 1 : 0;
  const relTotal = Math.min(5, relevance + bonus);
  const parts = [
    `${years} year${years === 1 ? "" : "s"} of retail experience (${yearPts})`,
    `background: ${CATEGORY_LABEL[i.category]} (${relevance})`,
  ];
  if (bonus) parts.push("prior franchise experience (+1)");
  return {
    key: "experience",
    name: "Operator experience",
    points: yearPts + relTotal,
    max: 20,
    reason: `${parts.join("; ")}.`,
  };
}

function site(i: ScoreInputs): ScoreComponent {
  const { app, flagCodes: f, a } = i;
  const size = app.spaceSize;
  let pts: number;
  let why: string;

  if (f.has("FIND_SPACE") || app.spaceAvailable === "Not yet identified" || app.spaceAvailable === null) {
    pts = 6;
    why = "No space identified yet";
    if (f.has("SPACE_CONTRADICTION")) why += " (the size and floor given are ignored until a space is confirmed)";
  } else {
    const owned = app.spaceAvailable === "Owned";
    const ownerPts = owned ? 20 : 18;
    const ownerWord = owned ? "owned" : app.spaceAvailable === "Rented" ? "rented" : "identified, ownership unconfirmed";
    if (app.floor === "Upper") {
      pts = 6;
      why = `${ownerWord} space, but on an upper floor (the format needs ground floor or a mall unit)`;
    } else if (app.floor === null || app.floor === "Not known") {
      pts = Math.min(12, ownerPts);
      why = `${ownerWord} space, but the floor isn't known`;
    } else {
      pts = ownerPts;
      why = `${ownerWord}, ${app.floor === "Mall unit" ? "mall unit" : "ground floor"}`;
    }
    if (size === null) {
      pts -= 4;
      why += "; size not given (-4)";
    } else if (size < a.minSpaceSqft) {
      pts = Math.min(pts, 6);
      why += `; ${size} sq ft is below the ${a.minSpaceSqft} sq ft minimum (capped at 6)`;
    } else {
      why += `; ${size} sq ft`;
      if (size > a.oversizedSpaceSqft) {
        pts -= 2;
        why += ` is oversized (-2)`;
      }
    }
  }
  return { key: "site", name: "Site readiness", points: clamp(pts, 0, 20), max: 20, reason: `${why}.` };
}

function location(i: ScoreInputs): ScoreComponent {
  const { territory, ownPinWorst, a } = i;
  let priorityPts = 0;
  let priorityText: string;
  if (!territory) {
    priorityText = `pin ${i.app.pin} is in no territory (0 for now; the priority of any territory they are redirected to is added later)`;
  } else if (territory.priority === "High") {
    priorityPts = 10;
    priorityText = `${territory.id} is High priority (10)`;
  } else if (territory.priority === "Medium") {
    priorityPts = 7;
    priorityText = `${territory.id} is Medium priority (7)`;
  } else if (territory.priority === "Low") {
    priorityPts = 4;
    priorityText = `${territory.id} is Low priority (4)`;
  } else {
    priorityPts = 4;
    priorityText = `${territory.id} has no priority given, counted as Low (4)`;
  }

  const worstPct = ownPinWorst?.overlapPct ?? 0;
  const safety = safetyPoints(worstPct, a);
  const band = overlapBand(worstPct, a);
  let safetyText: string;
  if (!ownPinWorst || worstPct <= 0) safetyText = "no existing store's catchment reaches this pin (10)";
  else if (band === "Blocked" && ownPinWorst.km === 0)
    safetyText = `pin ${i.app.pin} already has ${ownPinWorst.storeId}, so it is blocked (0)`;
  else if (band === "Blocked")
    safetyText = `${Math.round(worstPct)}% catchment overlap with ${ownPinWorst.storeId}, ${roundKm(ownPinWorst.km)} km away, is at or above the ${a.overlapBlockAtPct}% limit, so this pin is blocked (0)`;
  else
    safetyText = `${Math.round(worstPct)}% overlap with ${ownPinWorst.storeId} (${roundKm(ownPinWorst.km)} km away) is ${band.toLowerCase()} (${safety})`;

  return {
    key: "location",
    name: "Location fit",
    points: priorityPts + safety,
    max: 20,
    reason: `${priorityText}; ${safetyText}.`,
  };
}

function launch(i: ScoreInputs): ScoreComponent {
  const T = i.app.targetLaunchMonths;
  const R = i.realisticMonths;
  const r = Math.round(R * 10) / 10;
  let pts: number;
  let why: string;
  if (T === null) {
    pts = 8;
    why = `No target given; realistic time to open is about ${r} months`;
  } else if (T > 12) {
    pts = 6;
    why = `Target of ${T} months is a long way off (low urgency); realistic is about ${r}`;
  } else if (T >= R - EPS) {
    pts = 10;
    why = `Target of ${T} months is achievable; realistic is about ${r}`;
  } else if (T >= R - 1 - EPS) {
    pts = 7;
    why = `Target of ${T} months is tight; realistic is about ${r}`;
  } else {
    pts = 4;
    why = `Target of ${T} months is unrealistic; realistic is about ${r}`;
  }
  return { key: "launch", name: "Launch readiness", points: pts, max: 10, reason: `${why}.` };
}

function aiSignals(i: ScoreInputs): ScoreComponent {
  const counted = i.signals.filter((s) => Math.round(s.impact) !== 0);
  const sum = counted.reduce((t, s) => t + clamp(Math.round(s.impact), -3, 3), 0);
  const pts = clamp(sum, -5, 5);
  let reason: string;
  if (counted.length === 0) reason = "Nothing in the applicant's text moved the score.";
  else {
    const bits = counted.map((s) => `${s.text} (${s.impact > 0 ? "+" : ""}${Math.round(s.impact)})`);
    reason = `${bits.join("; ")}.`;
    if (pts !== sum) reason += ` Capped at ${pts > 0 ? "+" : ""}${pts}.`;
  }
  return { key: "signals", name: "AI-read signals", points: pts, max: 5, reason, signals: counted };
}

export function scoreApplication(i: ScoreInputs): ScoreResult {
  const fin = financial(i);
  const exp = experience(i);
  const st = site(i);
  const loc = location(i);
  const lau = launch(i);
  const sig = aiSignals(i);
  const components = [fin.c, exp, st, loc, lau, sig];
  const total = fin.reject ? null : clamp(components.reduce((t, c) => t + c.points, 0), 0, 100);
  return { rejected: fin.reject, ratio: fin.ratio, components, total, financialPoints: fin.c.points };
}

/** Add the priority points of a territory the applicant was redirected into, when their own pin had none. */
export function withDestinationPriority(components: ScoreComponent[], territory: Territory): ScoreComponent[] {
  const pts = territory.priority === "High" ? 10 : territory.priority === "Medium" ? 7 : 4;
  return components.map((c) =>
    c.key === "location"
      ? {
          ...c,
          points: Math.min(c.max, c.points + pts),
          reason: `${c.reason} After redirect to ${territory.id} (${territory.priority ?? "no priority"}): +${pts}.`,
        }
      : c
  );
}
