import type { Assumptions } from "./assumptions";
import { DEFAULT_ASSUMPTIONS } from "./assumptions";
import type { Tier } from "./types";

// The editable assumptions (SPEC §4), described once so the drawer and the chat's set_assumption tool agree.

export interface AssumptionDef {
  id: string;
  group: string;
  label: string;
  unit: string;
  min: number;
  max?: number;
  step?: number;
  get: (a: Assumptions) => number;
  set: (a: Assumptions, v: number) => Assumptions;
}

const tiers: Tier[] = [1, 2, 3];
const perTier = (group: string, key: "investmentNeedLakh" | "monthlyRevenueLakh" | "catchmentKm", label: string, unit: string, max: number, step: number): AssumptionDef[] =>
  tiers.map((t) => ({
    id: `${key}.${t}`,
    group,
    label: `${label}, Tier ${t}`,
    unit,
    min: 0.1,
    max,
    step,
    get: (a) => a[key][t],
    set: (a, v) => ({ ...a, [key]: { ...a[key], [t]: v } }),
  }));
const top = (group: string, id: keyof Assumptions, label: string, unit: string, min: number, max?: number, step = 1): AssumptionDef => ({
  id,
  group,
  label,
  unit,
  min,
  max,
  step,
  get: (a) => a[id] as number,
  set: (a, v) => ({ ...a, [id]: v }),
});
const days = (key: "site" | "finance" | "data", label: string): AssumptionDef => ({
  id: `conditionDays.${key}`,
  group: "Thresholds",
  label,
  unit: "days",
  min: 1,
  max: 365,
  get: (a) => a.conditionDays[key],
  set: (a, v) => ({ ...a, conditionDays: { ...a.conditionDays, [key]: v } }),
});

export const ASSUMPTION_DEFS: AssumptionDef[] = [
  ...perTier("Investment & revenue", "investmentNeedLakh", "Store set-up investment needed", "₹ lakh", 500, 1),
  ...perTier("Investment & revenue", "monthlyRevenueLakh", "Expected monthly revenue, mature store", "₹ lakh", 100, 0.5),
  top("Investment & revenue", "partnerProfitPct", "Partner's operating profit as % of revenue", "%", 1, 100),
  top("Investment & revenue", "upperFloorRevenuePenaltyPct", "Upper-floor revenue penalty", "%", 0, 100),
  ...perTier("Catchment & cannibalisation", "catchmentKm", "Catchment radius", "km", 50, 0.5),
  top("Catchment & cannibalisation", "overlapLowBelowPct", "Overlap counted as Low below", "%", 0, 100),
  top("Catchment & cannibalisation", "overlapModerateBelowPct", "Overlap counted as Moderate below", "%", 0, 100),
  top("Catchment & cannibalisation", "overlapBlockAtPct", "Pin blocked at overlap of", "%", 1, 100),
  top("Catchment & cannibalisation", "overlapRevenueLossFactor", "Revenue lost per 1% of overlap (0.5 = half)", "×", 0, 2, 0.05),
  top("Space", "minSpaceSqft", "Minimum space", "sq ft", 1),
  top("Space", "idealSpaceMinSqft", "Ideal range from", "sq ft", 1),
  top("Space", "idealSpaceMaxSqft", "Ideal range to", "sq ft", 1),
  top("Space", "oversizedSpaceSqft", "Flag as oversized above", "sq ft", 1),
  top("Thresholds", "approveScore", "Score for a clean approval", "points", 1, 100),
  top("Thresholds", "slotMinScore", "Minimum score to hold a slot", "points", 0, 100),
  top("Thresholds", "redirectPenalty", "Redirect penalty (applicant would lose a site)", "points", 0, 50),
  top("Thresholds", "paybackFlagMonths", "Payback flagged above", "months", 1, 240),
  top("Thresholds", "paybackConditionMonths", "Payback becomes a condition above", "months", 1, 240),
  days("site", "Deadline for site, floor and space conditions"),
  days("finance", "Deadline for finance conditions"),
  days("data", "Deadline for data confirmations"),
];
export const ASSUMPTION_GROUPS = ["Investment & revenue", "Catchment & cannibalisation", "Space", "Thresholds"];

export const fmtNum = (n: number) => String(Math.round(n * 1000) / 1000);

export function validateAssumptionOrder(a: Assumptions): string | null {
  if (!(a.overlapLowBelowPct < a.overlapModerateBelowPct && a.overlapModerateBelowPct < a.overlapBlockAtPct)) return "Overlap bands must rise: Low < Moderate < Blocked.";
  if (a.idealSpaceMinSqft > a.idealSpaceMaxSqft) return "The ideal range must start below where it ends.";
  if (a.slotMinScore > a.approveScore) return "The minimum score to hold a slot can't be above the approval score.";
  if (a.paybackFlagMonths > a.paybackConditionMonths) return "Payback is flagged first, then becomes a condition, so the flag level must be lower.";
  return null;
}


export function findAssumptionDef(key: string): AssumptionDef | undefined {
  const k = key.trim().toLowerCase().replace(/\s+/g, "");
  return ASSUMPTION_DEFS.find((d) => d.id.toLowerCase() === k);
}

export function assumptionDefault(def: AssumptionDef): number {
  return def.get(DEFAULT_ASSUMPTIONS);
}

export type { Assumptions };
