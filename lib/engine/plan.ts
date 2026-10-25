import type { Assumptions } from "./assumptions";
import { distanceKm } from "./geo";
import { BASE_TIMELINE_MONTHS, addDaysISO, addMonthsISO, getPin, pinLabel } from "./reference";
import type {
  BusinessCategory,
  Condition,
  ExistingStore,
  Flag,
  FlagCode,
  Floor,
  Language,
  PaybackResult,
  SpaceAvailable,
  Step,
  Tier,
  TimelineBar,
  TrainingModule,
  TrainingPlan,
} from "./types";

// Timeline, payback, condition deadlines (SPEC §5.6, §5.7) and the onboarding plan (SPEC §7):
// next steps, the timeline to opening and the partner's training plan.

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

// ---------------------------------------------------------------- onboarding (SPEC §7)

/** Nearest existing store to a pin, by straight-line distance. Ties go to the lower store ID. */
export function nearestStore(
  pin: string,
  stores: ExistingStore[]
): { store: ExistingStore; km: number; area: string | null } | null {
  let best: { store: ExistingStore; km: number } | null = null;
  for (const store of stores) {
    const km = distanceKm(pin, store.pin);
    if (km === null) continue;
    if (!best || km < best.km - 1e-9 || (Math.abs(km - best.km) < 1e-9 && store.id < best.store.id)) best = { store, km };
  }
  return best ? { ...best, area: getPin(best.store.pin)?.area ?? null } : null;
}

/** Beyond this distance the partner can't realistically shadow day to day, so a residential stint is suggested. */
export const FAR_STORE_KM = 40;
export const STAFF_TRAINING_DAYS = 5;

const CORE_MODULES: TrainingModule[] = [
  { name: "Brand and product & category training", days: 3, kind: "core" },
  { name: "POS, inventory and ordering", days: 2, kind: "core" },
  { name: "Selling and customer service", days: 2, kind: "core" },
  { name: "Store operations, cash and compliance", days: 1, kind: "core" },
];
const BOOTCAMP: TrainingModule = { name: "Retail fundamentals bootcamp", days: 5, kind: "bootcamp" };

export interface TrainingInput {
  pin: string;
  language: Language | null;
  experienceYears: number | null;
  businessCategory: BusinessCategory;
  stores: ExistingStore[];
  /** ISO opening date, when known (otherwise the staff-training date is left blank). */
  openDate: string | null;
}

export function buildTrainingPlan(i: TrainingInput): TrainingPlan {
  const language: Language = i.language ?? "English";
  const years = i.experienceYears ?? 0;
  const nonRetail = i.businessCategory === "salaried_non_retail" || i.businessCategory === "non_retail_business";
  const extended = years <= 1 || nonRetail;
  const fast = !extended && (years >= 8 || i.businessCategory === "eyewear_optical_watches");
  const track: TrainingPlan["track"] = extended ? "extended" : fast ? "fast-track" : "standard";
  const trackReason = extended
    ? years <= 1
      ? `${years === 0 ? "No" : "Only 1 year of"} retail experience, so the retail fundamentals bootcamp and a longer shadowing period are added.`
      : "Background is outside retail, so the retail fundamentals bootcamp and a longer shadowing period are added."
    : fast
      ? years >= 8
        ? `${years} years of retail experience, so fundamentals are skipped and shadowing is shorter.`
        : "Directly relevant category background, so fundamentals are skipped and shadowing is shorter."
      : "Standard programme.";

  const near = nearestStore(i.pin, i.stores);
  const far = !!near && near.km > FAR_STORE_KM;
  const shadowDays = extended ? 10 : far ? 5 : fast ? 3 : 5;
  const modules: TrainingModule[] = [...CORE_MODULES];
  if (extended) modules.push(BOOTCAMP);
  if (near) {
    modules.push({
      name: `On-the-job shadowing at ${near.store.id}${near.area ? ` (${near.area})` : ""}`,
      days: shadowDays,
      kind: "shadowing",
    });
  }

  const where = near ? `${near.store.id}${near.area ? ` ${near.area}` : ""}` : "";
  const length = shadowDays === 5 ? "1 week" : shadowDays === 10 ? "2 weeks" : `${shadowDays} days`;
  const lengthAdj = shadowDays % 5 === 0 ? `${shadowDays / 5}-week` : `${shadowDays}-day`;
  const shadowing = near
    ? {
        storeId: near.store.id,
        city: near.store.city,
        area: near.area,
        km: Math.round(near.km * 10) / 10,
        days: shadowDays,
        residential: far,
        text: far
          ? `The nearest store is ${where}${near.store.city ? ` in ${near.store.city}` : ""}, about ${Math.round(near.km)} km away, so a ${lengthAdj} residential stint there is suggested instead of daily shadowing.`
          : `${length} at ${where}, ${Math.round(near.km * 10) / 10} km away.`,
      }
    : null;

  const buddy = near
    ? {
        storeId: near.store.id,
        text: `The partner who runs ${near.store.id} is the buddy partner, a first call for questions through the first 90 days.`,
      }
    : null;

  return {
    language,
    languageNote: i.language ? undefined : "No preferred language was given, so English is assumed.",
    track,
    trackReason,
    modules,
    totalDays: modules.reduce((s, m) => s + m.days, 0),
    shadowing,
    buddy,
    staffTraining: {
      days: STAFF_TRAINING_DAYS,
      start: i.openDate ? addDaysISO(i.openDate, -14) : "",
      text: `${STAFF_TRAINING_DAYS} days of staff training at the store, 2 weeks before opening, in ${language}.`,
    },
    materials: `Trainer and training material in ${language}.`,
  };
}

export interface TimelineBuildInput {
  today: string;
  /** ISO planned opening date */
  open: string;
  floor: Floor | null;
  conditions: Condition[];
  /** Working days of partner training, from the training plan. */
  partnerTrainingDays: number;
}

const later = (a: string, b: string) => (a > b ? a : b);

/** Gantt-style bars from today to the 90-day review (SPEC §7). All dates are ISO strings. */
export function buildTimeline(i: TimelineBuildInput): TimelineBar[] {
  const { today, open } = i;
  const mall = i.floor === "Mall unit";
  const fitDays = mall ? 56 : 42;
  const agreementEnd = addDaysISO(today, 14);
  const softStart = addDaysISO(open, -7);
  const fitStart = later(agreementEnd, addDaysISO(softStart, -fitDays));
  const staffStart = addDaysISO(open, -14);
  const partnerEnd = addDaysISO(open, -15);
  const calendarDays = Math.ceil((i.partnerTrainingDays / 5) * 7);
  const partnerStart = later(agreementEnd, addDaysISO(partnerEnd, -calendarDays));

  const bars: TimelineBar[] = [];
  const lastCondition = i.conditions.map((c) => c.deadline).sort().pop();
  if (lastCondition) bars.push({ key: "conditions", label: "Close the open conditions", start: today, end: lastCondition });
  bars.push({ key: "agreement", label: "Letter of intent, token fee and franchise agreement", start: today, end: agreementEnd });
  bars.push({
    key: "licences",
    label: "Licences and permits: Shop & Establishment, GST, trade licence (in parallel)",
    start: addDaysISO(today, 7),
    end: addDaysISO(fitStart, 14),
  });
  bars.push({
    key: "fitout",
    label: mall ? "Store fit-out (8 weeks, mall unit)" : "Store fit-out (6 weeks)",
    start: fitStart,
    end: softStart,
  });
  bars.push({ key: "hiring", label: "Hire 2-3 store staff", start: addDaysISO(open, -35), end: staffStart });
  bars.push({ key: "partner-training", label: "Partner training and shadowing", start: partnerStart, end: partnerEnd });
  bars.push({ key: "staff-training", label: "Staff training at the store (5 days)", start: staffStart, end: addDaysISO(staffStart, 4) });
  bars.push({ key: "soft-launch", label: "Soft launch", start: softStart, end: open });
  bars.push({ key: "opening", label: "Opening day", start: open, end: open });
  for (const d of [30, 60, 90] as const) {
    bars.push({ key: `review-${d}`, label: `${d}-day review`, start: addDaysISO(open, d), end: addDaysISO(open, d) });
  }
  return bars;
}

export interface NextStepsInput {
  today: string;
  conditions: Condition[];
  /** Redirects: the allocated pin first, then other pins where a site could be found. */
  shortlist: string[] | null;
  hasSite: boolean;
  slotReservedUntil?: string;
  siteLabel: string;
}

/** The first two weeks: 3-6 steps, each with an owner and a due date (SPEC §7). Sorted by due date. */
export function buildNextSteps(i: NextStepsInput): Step[] {
  const steps: Step[] = [
    { text: "Sign the letter of intent and pay the token fee.", owner: "Partner", due: addDaysISO(i.today, 3) },
    {
      text: `Submit KYC and proof of funds: PAN, Aadhaar, GST, the last 6 months' bank statement, and ${i.hasSite ? "the property papers or rent agreement" : "the property papers or rent agreement once a space is found"}.`,
      owner: "Partner",
      due: addDaysISO(i.today, 7),
    },
  ];

  if (i.shortlist && i.shortlist.length) {
    steps.push({
      text: `Shortlist sites at the new pin${i.shortlist.length > 1 ? "s" : ""}: ${i.shortlist.map(pinLabel).join(", ")}. The slot is held${i.slotReservedUntil ? ` until ${i.slotReservedUntil}` : ""} while a site is secured.`,
      owner: "Partner",
      due: addDaysISO(i.today, 14),
    });
    steps.push({ text: "Visit the shortlisted sites for a site audit.", owner: "Brand", due: addDaysISO(i.today, 14) });
  } else {
    steps.push({
      text: i.hasSite ? `Site audit visit at ${i.siteLabel}.` : "Site audit visit once a space is identified.",
      owner: "Brand",
      due: addDaysISO(i.today, i.hasSite ? 10 : 14),
    });
  }
  steps.push({ text: "Send the draft franchise agreement.", owner: "Brand", due: addDaysISO(i.today, 14) });

  const room = 6 - steps.length;
  const conds = [...i.conditions].sort((a, b) => a.deadline.localeCompare(b.deadline));
  const asStep = (c: Condition): Step => ({ text: `Close: ${c.text}`, owner: c.owner, due: c.deadline });
  if (conds.length <= room) steps.push(...conds.map(asStep));
  else {
    const keep = Math.max(0, room - 1);
    steps.push(...conds.slice(0, keep).map(asStep));
    const rest = conds.slice(keep);
    steps.push({
      text: `Close the remaining ${rest.length} conditions: ${rest.map((c) => c.text).join(" ")}`,
      owner: "Partner",
      due: rest[rest.length - 1].deadline,
    });
  }
  return steps.sort((a, b) => a.due.localeCompare(b.due));
}
