import type { Assumptions } from "./assumptions";
import { BASE_TIMELINE_MONTHS, addDaysISO, addMonthsISO } from "./reference";
import type { BusinessCategory, Condition, Flag, FlagCode, Floor, PaybackResult, SpaceAvailable, Tier } from "./types";

// Timeline, payback and condition deadlines (SPEC §5.6, §5.7). Onboarding steps and the training plan
// are added in the next phase.

// ---- Realistic timeline (SPEC §5.6) ----

export interface TimelineInput {
  floor: Floor | null;
  spaceAvailable: SpaceAvailable | null;
  flagCodes: Set<FlagCode>;
  experienceYears: number | null;
  businessCategory: BusinessCategory;
  redirected: boolean;
}

export interface TimelinePart {
  label: string;
  months: number;
}

/** Months from today to open: base 2.5 plus add-ons. Returns the parts so explanations can show them. */
export function realisticMonths(i: TimelineInput): { months: number; parts: TimelinePart[] } {
  const parts: TimelinePart[] = [{ label: "agreement, fit-out and training", months: BASE_TIMELINE_MONTHS }];
  if (i.floor === "Mall unit") parts.push({ label: "mall unit approvals", months: 0.5 });
  if (i.flagCodes.has("FIND_SPACE")) parts.push({ label: "finding a space", months: 1.5 });
  if (i.floor === "Upper" || i.flagCodes.has("SPACE_TOO_SMALL"))
    parts.push({ label: "moving to a suitable space", months: 1.5 });
  if (i.flagCodes.has("FIN_GAP") || i.flagCodes.has("FIN_GAP_LARGE") || i.flagCodes.has("LOAN_DEPENDENT"))
    parts.push({ label: "closing the funding gap", months: 1 });
  const nonRetail = i.businessCategory === "salaried_non_retail" || i.businessCategory === "non_retail_business";
  if (i.experienceYears === 0 || nonRetail) parts.push({ label: "extra retail training", months: 0.5 });
  if (i.redirected) parts.push({ label: "sourcing a site at the new pin", months: 1.5 });
  return { months: parts.reduce((s, p) => s + p.months, 0), parts };
}

/** Planned opening date = today + max(target, realistic) months. */
export function plannedOpenDate(today: string, targetMonths: number | null, realistic: number): string {
  return addMonthsISO(today, Math.max(targetMonths ?? 0, realistic));
}

// ---- Payback (SPEC §5.7) ----

/** Revenue factor for a space below the minimum size. */
export const SMALL_SPACE_REVENUE_FACTOR = 0.8;

export function computePayback(
  tier: Tier,
  floor: Floor | null,
  spaceSize: number | null,
  maxOverlapPct: number,
  a: Assumptions
): PaybackResult {
  const tierRevenueLakh = a.monthlyRevenueLakh[tier];
  const floorFactor = floor === "Upper" ? 1 - a.upperFloorRevenuePenaltyPct / 100 : 1;
  const sizeFactor = spaceSize !== null && spaceSize < a.minSpaceSqft ? SMALL_SPACE_REVENUE_FACTOR : 1;
  const overlapFactor = 1 - a.overlapRevenueLossFactor * (maxOverlapPct / 100);
  const monthlyRevenueLakh = tierRevenueLakh * floorFactor * sizeFactor * overlapFactor;
  const monthlyProfitLakh = monthlyRevenueLakh * (a.partnerProfitPct / 100);
  const investmentLakh = a.investmentNeedLakh[tier];
  return {
    months: monthlyProfitLakh > 0 ? investmentLakh / monthlyProfitLakh : Infinity,
    inputs: {
      investmentLakh,
      tierRevenueLakh,
      floorFactor,
      sizeFactor,
      overlapPct: maxOverlapPct,
      overlapFactor,
      monthlyRevenueLakh,
      profitPct: a.partnerProfitPct,
      monthlyProfitLakh,
    },
  };
}

// ---- Conditions with deadlines (SPEC §4: 30 days site/floor/finance, 14 days data confirmations) ----

const DATA_CONFIRMATIONS: FlagCode[] = ["CONFIRM_SIZE", "CONFIRM_FLOOR"];
const FINANCE: FlagCode[] = ["FIN_GAP", "FIN_GAP_LARGE", "LOAN_DEPENDENT", "PAYBACK_LONG"];

export function conditionsFromFlags(flags: Flag[], today: string, a: Assumptions): Condition[] {
  return flags
    .filter((f) => f.severity === "condition")
    .map((f) => {
      const days = DATA_CONFIRMATIONS.includes(f.code)
        ? a.conditionDays.data
        : FINANCE.includes(f.code)
          ? a.conditionDays.finance
          : a.conditionDays.site;
      return { code: f.code, text: f.message, deadline: addDaysISO(today, days), owner: "Partner" as const };
    });
}
