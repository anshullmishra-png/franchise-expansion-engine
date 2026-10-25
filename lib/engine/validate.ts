import { DEFAULT_ASSUMPTIONS, type Assumptions } from "./assumptions";
import { isValidPin, normaliseName } from "./normalise";
import {
  BASE_TIMELINE_MONTHS,
  CITY_NAMES,
  INVESTMENT_OUTLIER_MAX_LAKH,
  INVESTMENT_OUTLIER_MULTIPLE,
  OUTSIDE_CITY_CORE_KM,
  PRIORITY_RANK,
  STATE,
  addMonthsISO,
  cityOfPin,
  findCity,
  formatDate,
  getPin,
  pinLabel,
  tierOfCity,
  todayIST,
} from "./reference";
import type {
  Application,
  DataAlert,
  EngineInput,
  Flag,
  FlagCode,
  FlagSeverity,
  NoteReading,
  ParseIssue,
  Territory,
  Tier,
  ValidationResult,
} from "./types";

// Input-only validation (SPEC §5.1). Everything here can be decided from the uploaded file plus any
// AI-read note signals. Flags that depend on the allocation or the realistic timeline
// (UNREALISTIC_TARGET, PAYBACK_LONG) are added later by the engine, not here.

export interface ValidateOptions {
  /** ISO date (IST). Defaults to today; pass it in tests for determinism. */
  today?: string;
  /** AI-read (or fallback) note signals, by applicant ID. */
  readings?: NoteReading[] | Record<string, NoteReading>;
}

const SEVERITY_RANK: Record<FlagSeverity, number> = { blocker: 0, condition: 1, warning: 2, info: 3 };

// ---------------------------------------------------------------- shared helpers (also used by later phases)

/** Territories that list this pin, best first: higher priority, then lower ID. */
export function territoriesForPin(pin: string | null | undefined, territories: Territory[]): Territory[] {
  if (!pin) return [];
  return territories
    .filter((t) => t.pins.includes(pin))
    .sort(
      (a, b) =>
        (b.priority ? PRIORITY_RANK[b.priority] : 0) - (a.priority ? PRIORITY_RANK[a.priority] : 0) ||
        a.id.localeCompare(b.id, undefined, { numeric: true })
    );
}

/** The territory a pin belongs to when several list it (SPEC §5.1 PIN_IN_MULTIPLE_TERRITORIES). */
export function resolveTerritory(pin: string | null | undefined, territories: Territory[]): Territory | null {
  return territoriesForPin(pin, territories)[0] ?? null;
}

/** Tier of the applicant's city (D9), falling back to the tier of the pin's city. */
export function applicationTier(app: Pick<Application, "city" | "pin">): Tier | null {
  return tierOfCity(app.city) ?? cityOfPin(app.pin)?.tier ?? null;
}

/** investment ÷ tier set-up need; null when either is unknown. */
export function investmentRatio(app: Application, a: Assumptions = DEFAULT_ASSUMPTIONS): number | null {
  const tier = applicationTier(app);
  if (tier === null || app.investmentLakh === null) return null;
  return app.investmentLakh / a.investmentNeedLakh[tier];
}

export function toReadingMap(r: ValidateOptions["readings"]): Record<string, NoteReading> {
  if (!r) return {};
  if (!Array.isArray(r)) return r;
  const map: Record<string, NoteReading> = {};
  for (const x of r) map[x.id] = x;
  return map;
}

const EPS = 1e-9;

function flag(
  code: FlagCode,
  severity: FlagSeverity,
  message: string,
  extra: { field?: string; question?: string; related?: string[] } = {}
): Flag {
  return { code, severity, message, ...extra };
}

const listAnd = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const num = (n: number) => String(Math.round(n * 100) / 100);

// ---------------------------------------------------------------- main entry

export function validate(
  input: EngineInput,
  assumptions: Assumptions = DEFAULT_ASSUMPTIONS,
  options: ValidateOptions = {}
): ValidationResult {
  const today = options.today ?? todayIST();
  const readings = toReadingMap(options.readings);
  const out: ValidationResult = { applications: {}, territories: {}, alerts: [] };

  const apps = input.applications;
  const storePins = new Map(input.existingStores.map((s) => [s.pin, s]));

  // Cross-row facts
  const idGroups = new Map<string, Application[]>();
  for (const a of apps) {
    if (!a.sourceId) continue;
    const k = a.sourceId.toLowerCase();
    idGroups.set(k, [...(idGroups.get(k) ?? []), a]);
  }

  for (const a of apps) {
    const flags: Flag[] = [];
    validateApplication(a, apps, idGroups, input, assumptions, readings[a.id], today, flags);
    out.applications[a.id] = flags.sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]);
  }

  const territoryIdGroups = new Map<string, Territory[]>();
  for (const t of input.territories) {
    if (!t.sourceId) continue;
    const k = t.sourceId.toLowerCase();
    territoryIdGroups.set(k, [...(territoryIdGroups.get(k) ?? []), t]);
  }
  for (const t of input.territories) {
    const flags: Flag[] = [];
    validateTerritory(t, input, territoryIdGroups, storePins, flags);
    out.territories[t.id] = flags.sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]);
  }

  out.alerts = buildAlerts(input, out);
  return out;
}

// ---------------------------------------------------------------- applications

function validateApplication(
  a: Application,
  all: Application[],
  idGroups: Map<string, Application[]>,
  input: EngineInput,
  A: Assumptions,
  reading: NoteReading | undefined,
  today: string,
  flags: Flag[]
): void {
  const signals = reading?.signals ?? [];
  const pinOk = isValidPin(a.pin);
  const cityInfo = findCity(a.city);
  const tier = applicationTier(a);

  // --- identity
  if (!a.sourceId) {
    flags.push(
      flag("MISSING_ID", "blocker", `Row ${a.rowNumber} has no Application ID, so it is shown as ${a.id}.`, {
        field: "id",
        question: "What is this applicant's Application ID?",
      })
    );
  }
  const sameId = a.sourceId ? (idGroups.get(a.sourceId.toLowerCase()) ?? []) : [];
  if (sameId.length > 1) {
    const others = sameId.filter((x) => x !== a);
    const rows = sameId.map((x) => x.rowNumber).join(" and ");
    flags.push(
      flag(
        "DUPLICATE_ID",
        "blocker",
        `Application ID ${a.sourceId} is used on rows ${rows}${a.id !== a.sourceId ? `; this row is shown as ${a.id}` : ""}.`,
        {
          field: "id",
          related: others.map((x) => x.id),
          question: `${a.sourceId} appears on more than one row. Which row is the real ${a.sourceId}, and what ID should the other have?`,
        }
      )
    );
  }

  // --- required fields
  const missing: string[] = [];
  const hint = (f: string, raw: string | undefined, text: string) => {
    const bad = a.parseIssues.find((i) => i.field === f && i.code === "UNPARSEABLE_VALUE");
    missing.push(bad ? `${text} (couldn't read “${raw ?? bad.raw}”)` : text);
  };
  if (!a.name) missing.push("applicant name");
  if (!a.city) missing.push("city");
  if (!a.pin) missing.push("pin code");
  if (a.investmentLakh === null) hint("investmentLakh", a.raw.investmentLakh, "investment capacity");
  if (a.experienceYears === null) hint("experienceYears", a.raw.experienceYears, "retail experience (years)");
  if (a.spaceAvailable === null) {
    const bad = a.parseIssues.find((i) => i.field === "spaceAvailable");
    missing.push(bad ? `space available (“${bad.raw}” isn't Owned, Rented or Not yet identified)` : "space available");
  }
  if (missing.length) {
    flags.push(
      flag("MISSING_REQUIRED", "blocker", `Missing: ${listAnd(missing)}.`, {
        field: "required",
        question: `Please provide: ${listAnd(missing)}.`,
      })
    );
  }

  // --- pin and city
  if (a.pin && !pinOk) {
    flags.push(
      flag("INVALID_PIN", "blocker", `Pin code “${a.pin}” isn't a valid 6-digit pin code.`, {
        field: "pin",
        question: "What is the correct 6-digit pin code for the proposed store?",
      })
    );
  }
  if (a.city && !cityInfo) {
    flags.push(
      flag(
        "CITY_NOT_ALLOWED",
        "blocker",
        `“${a.city}” isn't one of the brand's cities (${CITY_NAMES.join(", ")}).`,
        { field: "city", question: `Which of our cities is the store in: ${CITY_NAMES.join(", ")}?` }
      )
    );
  }
  if (a.pin && pinOk && cityInfo) {
    const pinCity = cityOfPin(a.pin);
    if (pinCity?.city !== cityInfo.city) {
      const area = getPin(a.pin)?.area;
      const pinWhere = pinCity ? `belongs to ${pinCity.city}${area ? ` (${area})` : ""}` : "isn't in any of the brand's cities";
      let message = `The city says ${cityInfo.city}, but pin ${a.pin} ${pinWhere}.`;
      const cityHint = signals.find((s) => s.field === "city" && typeof s.value === "string");
      if (cityHint) {
        const side = cityHint.value === cityInfo.city ? "the city" : cityHint.value === pinCity?.city ? "the pin code" : null;
        message += side
          ? ` The notes point to ${cityHint.value} (“${cityHint.quote}”), which supports ${side}.`
          : ` The notes mention ${cityHint.value} (“${cityHint.quote}”).`;
      }
      flags.push(
        flag("CITY_PIN_MISMATCH", "blocker", message, {
          field: "pin",
          question: pinCity
            ? `Is the store in ${cityInfo.city} or ${pinCity.city}? Please confirm the correct city and 6-digit pin code.`
            : `Please confirm the correct pin code for ${cityInfo.city}; ${a.pin} isn't one of our cities' pin codes.`,
        })
      );
    }
  }

  // --- investment
  if (a.investmentLakh !== null) {
    const need = tier ? A.investmentNeedLakh[tier] : null;
    const tooBig = a.investmentLakh > INVESTMENT_OUTLIER_MAX_LAKH || (need !== null && a.investmentLakh > INVESTMENT_OUTLIER_MULTIPLE * need);
    const contra = signals.find(
      (s) => s.type === "contradiction" && s.field === "investment" && typeof s.value === "number" && s.value !== a.investmentLakh
    );
    if (tooBig) {
      let message = `Investment of ₹${num(a.investmentLakh)} lakh is far above the ₹${need ?? "?"} lakh a store here needs, so it may be a typing error.`;
      if (contra) message += ` The notes say ${contra.value} lakh (“${contra.quote}”).`;
      flags.push(
        flag("INVESTMENT_OUTLIER", "blocker", message, {
          field: "investmentLakh",
          question: contra
            ? `The form says ₹${num(a.investmentLakh)} lakh but your notes say ${contra.value} lakh. Which is your investment capacity?`
            : `Please confirm your investment capacity: is ₹${num(a.investmentLakh)} lakh correct?`,
        })
      );
    }
    if (contra && !tooBig) {
      flags.push(
        flag(
          "INVESTMENT_CONTRADICTION",
          "blocker",
          `The Investment column says ₹${num(a.investmentLakh)} lakh but the notes say ${contra.value} lakh (“${contra.quote}”).`,
          {
            field: "investmentLakh",
            question: `The form says ₹${num(a.investmentLakh)} lakh but your notes say ${contra.value} lakh. Which is your investment capacity?`,
          }
        )
      );
    } else if (contra && tooBig) {
      flags.push(
        flag(
          "INVESTMENT_CONTRADICTION",
          "blocker",
          `The Investment column says ₹${num(a.investmentLakh)} lakh but the notes say ${contra.value} lakh.`,
          { field: "investmentLakh" }
        )
      );
    }

    const ratio = investmentRatio(a, A);
    if (ratio !== null && need !== null) {
      const gap = `₹${num(a.investmentLakh)} lakh is ${Math.round(ratio * 100)}% of the ₹${need} lakh a ${tier === 1 ? "Tier 1" : tier === 2 ? "Tier 2" : "Tier 3"} store needs`;
      if (ratio >= 0.85 - EPS && ratio < 1 - EPS) {
        flags.push(
          flag("FIN_GAP", "condition", `${gap}. Needs a plan to close the gap of ₹${num(need - a.investmentLakh)} lakh.`, {
            field: "investmentLakh",
          })
        );
      } else if (ratio >= 0.6 - EPS && ratio < 0.85 - EPS) {
        flags.push(
          flag("FIN_GAP_LARGE", "condition", `${gap}. The gap of ₹${num(need - a.investmentLakh)} lakh is large and needs a funding plan (e.g. a co-investor).`, {
            field: "investmentLakh",
          })
        );
      }
    }
  }

  // --- duplicates and same person
  const myName = normaliseName(a.name);
  if (myName) {
    const idx = all.indexOf(a);
    const earlier = all.slice(0, idx).find((o) => normaliseName(o.name) === myName && o.pin && o.pin === a.pin);
    const later = all.slice(idx + 1).find((o) => normaliseName(o.name) === myName && o.pin && o.pin === a.pin);
    if (earlier) {
      const diffs = differingFields(earlier, a);
      flags.push(
        flag(
          "PROBABLE_DUPLICATE",
          "blocker",
          `Looks like a repeat of ${earlier.id}: same name and pin ${a.pin}.${diffs.length ? ` Differences: ${diffs.join("; ")}.` : " Everything else matches."}`,
          {
            field: "id",
            related: [earlier.id],
            question: `${a.id} looks like a repeat of ${earlier.id} (same name and pin).${diffs.length ? ` Which details are correct? ${diffs.join("; ")}.` : ""}`,
          }
        )
      );
    }
    if (later) {
      const diffs = differingFields(a, later);
      flags.push(
        flag(
          "HAS_PROBABLE_DUPLICATE",
          "warning",
          `${later.id} has the same name and pin ${a.pin} and is held as a probable duplicate.${diffs.length ? ` Differences: ${diffs.join("; ")}.` : ""}`,
          { field: "id", related: [later.id] }
        )
      );
    }
    const samePerson = all.filter((o) => o !== a && normaliseName(o.name) === myName && o.pin && a.pin && o.pin !== a.pin);
    if (samePerson.length) {
      flags.push(
        flag(
          "SAME_APPLICANT_MULTIPLE",
          "warning",
          `${a.name} also applied as ${listAnd(samePerson.map((o) => `${o.id} (pin ${o.pin})`))}. At most one store can go to the same person.`,
          { field: "name", related: samePerson.map((o) => o.id) }
        )
      );
    }
  }

  // --- state, experience
  if (a.state && a.state !== STATE) {
    flags.push(
      flag("STATE_MISMATCH", "warning", `State says ${a.state}, but all of the brand's cities are in ${STATE}.`, {
        field: "state",
        question: `Your state is ${a.state}. Is the store going to be in ${STATE}?`,
      })
    );
  }
  if (a.experienceYears === 0) {
    flags.push(
      flag("ZERO_EXPERIENCE", "warning", "No retail experience. Needs the extended retail-fundamentals training.", {
        field: "experienceYears",
      })
    );
  }

  // --- space
  validateSpace(a, A, flags);

  // --- territory and geo
  if (a.pin && pinOk) {
    const pinData = getPin(a.pin);
    if (!pinData) {
      flags.push(
        flag("APPROX_COORDS", "info", `No coordinates on file for pin ${a.pin}; distances use the city centre and are approximate.`, {
          field: "pin",
        })
      );
    } else if (pinData.kmFromCityCentre !== null && pinData.kmFromCityCentre > OUTSIDE_CITY_CORE_KM) {
      flags.push(
        flag(
          "OUTSIDE_CITY_CORE",
          "info",
          `Pin ${pinLabel(a.pin)} is outside the city proper (about ${Math.round(pinData.kmFromCityCentre)} km from the centre).`,
          { field: "pin" }
        )
      );
    }

    const cityMatchesPin = !cityInfo || cityOfPin(a.pin)?.city === cityInfo.city;
    if (cityMatchesPin) {
      const matches = territoriesForPin(a.pin, input.territories);
      if (matches.length === 0 && cityOfPin(a.pin)) {
        flags.push(
          flag(
            "NO_TERRITORY",
            "warning",
            `Pin ${pinLabel(a.pin)} isn't in any territory the brand listed, so a store can't be approved there. This is demand outside the target areas.`,
            { field: "pin" }
          )
        );
      } else if (matches.length > 1) {
        const [best, ...rest] = matches;
        const why =
          best.priority !== rest[0].priority
            ? `it has the higher priority (${best.priority ?? "none"} vs ${rest[0].priority ?? "none"})`
            : "priorities are equal, so the lower ID wins";
        flags.push(
          flag(
            "PIN_IN_MULTIPLE_TERRITORIES",
            "warning",
            `Pin ${a.pin} is listed in ${listAnd(matches.map((m) => m.id))}. Using ${best.id}: ${why}.`,
            { field: "pin", related: matches.map((m) => m.id) }
          )
        );
      }
    }
  }

  // --- AI-read signals
  const finance = signals.find((s) => s.type === "finance");
  if (finance) {
    flags.push(
      flag("LOAN_DEPENDENT", "condition", `Funding depends on outside finance (“${finance.quote}”). Needs a loan sanction letter.`, {
        field: "investmentLakh",
        question: "Has your bank loan been sanctioned? Please share the sanction letter.",
      })
    );
  }
  const minOpen = addMonthsISO(today, BASE_TIMELINE_MONTHS);
  for (const s of signals.filter((x) => x.type === "deadline" && x.date)) {
    if ((s.date as string) < minOpen) {
      flags.push(
        flag(
          "DEADLINE_UNREACHABLE",
          "warning",
          `Wants to open by ${formatDate(s.date as string)} (“${s.quote}”), but even the fastest realistic path (about ${BASE_TIMELINE_MONTHS} months) lands around ${formatDate(minOpen)}.`,
          { field: "targetLaunchMonths" }
        )
      );
      break;
    }
  }

  // --- parser issues
  for (const issue of a.parseIssues) flags.push(issueToFlag(issue));
}

function validateSpace(a: Application, A: Assumptions, flags: Flag[]): void {
  const space = a.spaceAvailable;
  if (space === null) return;
  const hasSize = a.spaceSize !== null;
  const hasFloor = a.floor !== null && a.floor !== "Not known";

  if (space === "Not yet identified") {
    flags.push(
      flag("FIND_SPACE", "condition", "No shop space identified yet. A space must be found before the store can open.", {
        field: "spaceAvailable",
        question: "Have you found a shop space yet? If so, who owns it, how big is it and which floor is it on?",
      })
    );
    if (hasSize || hasFloor) {
      const bits = [hasSize ? `a size (${a.spaceSize} sq ft)` : null, hasFloor ? `a floor (${a.floor})` : null].filter(Boolean) as string[];
      flags.push(
        flag(
          "SPACE_CONTRADICTION",
          "condition",
          `Space is marked “Not yet identified” but ${listAnd(bits)} is filled in. Treating it as not identified until confirmed.`,
          { field: "spaceAvailable", question: "Do you already have a space? If so, please confirm whether it is owned or rented." }
        )
      );
    }
    return;
  }

  if (!hasSize) {
    flags.push(
      flag("CONFIRM_SIZE", "condition", "The space size isn't given. Needs confirming.", {
        field: "spaceSize",
        question: "What is the size of the space, in square feet?",
      })
    );
  } else if ((a.spaceSize as number) < A.minSpaceSqft) {
    flags.push(
      flag("SPACE_TOO_SMALL", "condition", `${a.spaceSize} sq ft is below the ${A.minSpaceSqft} sq ft minimum for a store.`, {
        field: "spaceSize",
      })
    );
  } else if ((a.spaceSize as number) > A.oversizedSpaceSqft) {
    flags.push(
      flag("OVERSIZED_SPACE", "warning", `${a.spaceSize} sq ft is much larger than the ${A.idealSpaceMinSqft}-${A.idealSpaceMaxSqft} sq ft the format needs.`, {
        field: "spaceSize",
      })
    );
  }
  if (a.floor === null || a.floor === "Not known") {
    flags.push(
      flag("CONFIRM_FLOOR", "condition", "Which floor the space is on isn't known. Needs confirming.", {
        field: "floor",
        question: "Which floor is the space on: ground, upper or a mall unit?",
      })
    );
  } else if (a.floor === "Upper") {
    flags.push(
      flag("NEED_GROUND_FLOOR", "condition", "The space is on an upper floor. The format needs a ground-floor or mall unit.", {
        field: "floor",
      })
    );
  }
}

function differingFields(x: Application, y: Application): string[] {
  const diffs: string[] = [];
  const show = (v: unknown) => {
    if (v === null || v === undefined) return "blank";
    const t = String(v);
    return typeof v === "string" ? `“${t.length > 50 ? `${t.slice(0, 50)}…` : t}”` : t;
  };
  const cmp = (label: string, p: unknown, q: unknown) => {
    if ((p ?? null) !== (q ?? null)) diffs.push(`${label}: ${show(p)} vs ${show(q)}`);
  };
  cmp("city", x.city, y.city);
  cmp("investment (lakh)", x.investmentLakh, y.investmentLakh);
  cmp("experience (years)", x.experienceYears, y.experienceYears);
  cmp("business", x.business, y.business);
  cmp("space", x.spaceAvailable, y.spaceAvailable);
  cmp("size", x.spaceSize, y.spaceSize);
  cmp("floor", x.floor, y.floor);
  cmp("target (months)", x.targetLaunchMonths, y.targetLaunchMonths);
  cmp("language", x.language, y.language);
  cmp("notes", x.notes, y.notes);
  return diffs;
}

function issueToFlag(issue: ParseIssue): Flag {
  const severity: FlagSeverity = issue.code === "CONVERTED_UNITS" ? "info" : "warning";
  return flag(issue.code, severity, issue.message, { field: issue.field });
}

// ---------------------------------------------------------------- territories

function validateTerritory(
  t: Territory,
  input: EngineInput,
  idGroups: Map<string, Territory[]>,
  storePins: Map<string, { id: string }>,
  flags: Flag[]
): void {
  const cityInfo = findCity(t.city);

  if (!t.sourceId) {
    flags.push(flag("TER_MISSING_ID", "warning", `Row ${t.rowNumber} has no Territory ID, so it is shown as ${t.id}.`, { field: "id" }));
  }
  const same = t.sourceId ? (idGroups.get(t.sourceId.toLowerCase()) ?? []) : [];
  if (same.length > 1) {
    flags.push(
      flag(
        "DUPLICATE_TERRITORY_ID",
        "warning",
        `Territory ID ${t.sourceId} is used on rows ${same.map((x) => x.rowNumber).join(" and ")}${t.id !== t.sourceId ? `; this row is shown as ${t.id}` : ""}.`,
        { field: "id", related: same.filter((x) => x !== t).map((x) => x.id) }
      )
    );
  }

  if (!t.city || !cityInfo) {
    flags.push(
      flag("TER_CITY_NOT_ALLOWED", "warning", t.city ? `“${t.city}” isn't one of the brand's cities.` : "No city given for this territory.", {
        field: "city",
      })
    );
  }

  if (cityInfo && t.statedTier !== null && t.statedTier !== cityInfo.tier) {
    flags.push(
      flag(
        "TIER_MISMATCH",
        "warning",
        `${t.id} says Tier ${t.statedTier}, but ${cityInfo.city} is Tier ${cityInfo.tier} per the brand's city list. Using Tier ${cityInfo.tier}.`,
        { field: "tier" }
      )
    );
  }

  if (t.pins.length === 0) {
    flags.push(flag("TER_NO_PINS", "warning", `${t.id} lists no valid pin codes, so no applicant can be placed in it.`, { field: "pins" }));
  }

  if (t.openSlots === null) {
    flags.push(flag("TER_BAD_SLOTS", "warning", `${t.id} has no usable number of open slots, so it is treated as 0.`, { field: "openSlots" }));
  } else if (t.openSlots < 0) {
    flags.push(flag("TER_BAD_SLOTS", "warning", `${t.id} has ${t.openSlots} open slots; treated as 0.`, { field: "openSlots" }));
  } else if (t.openSlots === 0) {
    flags.push(flag("TER_ZERO_SLOTS", "info", `${t.id} has 0 open slots, so nothing can be approved here.`, { field: "openSlots" }));
  }

  if (t.priority === null) {
    flags.push(flag("TER_PRIORITY_UNKNOWN", "info", `${t.id} has no recognised priority (High, Medium or Low).`, { field: "priority" }));
  }

  const withStore = t.pins.filter((p) => storePins.has(p));
  if (withStore.length) {
    flags.push(
      flag(
        "TER_PIN_HAS_STORE",
        "info",
        withStore.map((p) => `${pinLabel(p)} in ${t.id} already has ${storePins.get(p)!.id}`).join("; ") + ": not available for a new store.",
        { field: "pins", related: withStore.map((p) => storePins.get(p)!.id) }
      )
    );
  }

  if (cityInfo) {
    const outside = t.pins.filter((p) => p.slice(0, 3) !== cityInfo.prefix);
    if (outside.length) {
      flags.push(
        flag("TER_PIN_OUT_OF_CITY", "warning", `${listAnd(outside)} ${outside.length > 1 ? "don't" : "doesn't"} belong to ${cityInfo.city} (pins start with ${cityInfo.prefix}).`, {
          field: "pins",
        })
      );
    }
  }

  const shared = t.pins
    .map((p) => ({ p, others: territoriesForPin(p, input.territories).filter((x) => x !== t) }))
    .filter((x) => x.others.length);
  if (shared.length) {
    flags.push(
      flag(
        "PIN_IN_MULTIPLE_TERRITORIES",
        "warning",
        shared.map((s) => `Pin ${s.p} is also in ${listAnd(s.others.map((o) => o.id))}`).join("; ") + ". Applicants at that pin go to the higher-priority territory.",
        { field: "pins", related: [...new Set(shared.flatMap((s) => s.others.map((o) => o.id)))] }
      )
    );
  }

  for (const issue of t.parseIssues) flags.push(issueToFlag(issue));
}

// ---------------------------------------------------------------- workbook-level alerts

function buildAlerts(input: EngineInput, r: ValidationResult): DataAlert[] {
  const alerts: DataAlert[] = [];
  const appIdsWith = (code: FlagCode) => Object.entries(r.applications).filter(([, f]) => f.some((x) => x.code === code)).map(([id]) => id);
  const terIdsWith = (code: FlagCode) => Object.entries(r.territories).filter(([, f]) => f.some((x) => x.code === code)).map(([id]) => id);

  for (const ex of input.excludedExamples?.applications ?? []) {
    alerts.push({
      code: "EXAMPLE_ROW_IGNORED",
      severity: "info",
      message: `Ignored the template's example row (${ex.row.sourceId} ${ex.row.name}).`,
      ids: [ex.row.sourceId],
    });
  }
  for (const ex of input.excludedExamples?.territories ?? []) {
    alerts.push({
      code: "EXAMPLE_ROW_IGNORED",
      severity: "info",
      message: `Ignored the template's example territory (${ex.row.sourceId} ${ex.row.city}).`,
      ids: [ex.row.sourceId],
    });
  }

  const tier = terIdsWith("TIER_MISMATCH");
  if (tier.length) {
    alerts.push({
      code: "TIER_MISMATCH",
      severity: "warning",
      message: r.territories[tier[0]].find((f) => f.code === "TIER_MISMATCH")!.message + (tier.length > 1 ? ` (and ${tier.length - 1} more)` : ""),
      ids: tier,
    });
  }

  const multi = terIdsWith("PIN_IN_MULTIPLE_TERRITORIES");
  if (multi.length) {
    const pins = new Set<string>();
    for (const t of input.territories) for (const p of t.pins) if (territoriesForPin(p, input.territories).length > 1) pins.add(p);
    alerts.push({
      code: "PIN_IN_MULTIPLE_TERRITORIES",
      severity: "warning",
      message: `Pin ${[...pins].join(", ")} ${pins.size > 1 ? "are" : "is"} listed in more than one territory (${multi.join(", ")}). The higher-priority territory is used.`,
      ids: multi,
    });
  }

  const dupIds = appIdsWith("DUPLICATE_ID");
  if (dupIds.length) {
    alerts.push({ code: "DUPLICATE_ID", severity: "blocker", message: `Application IDs reused: ${dupIds.join(", ")}. These are on hold until clarified.`, ids: dupIds });
  }
  const dupApps = appIdsWith("PROBABLE_DUPLICATE");
  if (dupApps.length) {
    alerts.push({ code: "PROBABLE_DUPLICATE", severity: "blocker", message: `Probable duplicate applications: ${dupApps.join(", ")}. Held until the applicant confirms which details are correct.`, ids: dupApps });
  }
  const same = appIdsWith("SAME_APPLICANT_MULTIPLE");
  if (same.length) {
    alerts.push({ code: "SAME_APPLICANT_MULTIPLE", severity: "warning", message: `The same person applied more than once (${same.join(", ")}). At most one store each.`, ids: same });
  }
  const noTer = appIdsWith("NO_TERRITORY");
  if (noTer.length) {
    alerts.push({ code: "NO_TERRITORY", severity: "warning", message: `${noTer.join(", ")} ${noTer.length > 1 ? "have" : "has"} a pin that is in no territory (demand outside the target areas).`, ids: noTer });
  }
  const zero = terIdsWith("TER_ZERO_SLOTS");
  if (zero.length) {
    alerts.push({ code: "TER_ZERO_SLOTS", severity: "info", message: `${zero.join(", ")} ${zero.length > 1 ? "have" : "has"} no open slots.`, ids: zero });
  }
  const hasStore = terIdsWith("TER_PIN_HAS_STORE");
  if (hasStore.length) {
    alerts.push({ code: "TER_PIN_HAS_STORE", severity: "info", message: `Some territory pins already have a store (${hasStore.join(", ")}); those pins are not available.`, ids: hasStore });
  }
  const badSlots = terIdsWith("TER_BAD_SLOTS");
  if (badSlots.length) {
    alerts.push({ code: "TER_BAD_SLOTS", severity: "warning", message: `${badSlots.join(", ")} ${badSlots.length > 1 ? "have" : "has"} missing or invalid open slots (treated as 0).`, ids: badSlots });
  }
  return alerts;
}
