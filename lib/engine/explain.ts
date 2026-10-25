import type { Assumptions } from "./assumptions";
import { roundKm } from "./geo";
import { formatDate, pinLabel } from "./reference";
import type { Application, Decision, Reason, ScoreComponent, Status, TraceStep } from "./types";

// Deterministic explanations built from the decision's own numbers (SPEC §6). They exist even when AI is
// down; the AI only rephrases them on request. Every explanation leads with the decision, names the deciding
// rule and numbers, and ends with what happens next or what would change it.

export type ExplainInput = Omit<Decision, "headline" | "why" | "reasons"> & {
  app: Application;
  a: Assumptions;
  hasSite: boolean;
  investmentGapTo60?: number;
};

const L = (n: number) => `₹${Math.round(n * 100) / 100} lakh`;
const score = (n: number | null) => (n === null ? "no score" : `${n}/100`);
const niceName = (n: string) => (n === "ai-read signals" ? "AI-read signals" : n);
const joinAnd = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "ahead on location fit (+7) and financial readiness (+3), behind on operator experience (-5)". */
export function componentDiff(winner: ScoreComponent[], loser: ScoreComponent[]): string {
  const diffs = winner
    .map((w) => ({ name: niceName(w.name.toLowerCase()), d: w.points - (loser.find((l) => l.key === w.key)?.points ?? 0) }))
    .filter((x) => x.d !== 0);
  const ahead = diffs.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 3);
  const behind = diffs.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 2);
  const parts: string[] = [];
  if (ahead.length) parts.push(`ahead on ${joinAnd(ahead.map((x) => `${x.name} (+${x.d})`))}`);
  if (behind.length) parts.push(`behind on ${joinAnd(behind.map((x) => `${x.name} (${x.d})`))}`);
  return parts.join(", ") || "level on every component";
}

function traceSentence(step: TraceStep): string | null {
  switch (step.kind) {
    case "no-territory":
      return `Pin ${pinLabel(step.pin)} isn't in any territory the brand listed.`;
    case "own-pin-store":
      return `Pin ${pinLabel(step.pin)} already has ${step.storeId}, and the brand never opens two stores in one pin code.`;
    case "own-pin-overlap":
      return `Pin ${pinLabel(step.pin)} is only ${roundKm(step.km)} km from ${step.storeId}: their catchments overlap by ${Math.round(step.overlapPct)}%, at or above the 45% limit.`;
    case "own-pin-taken":
      return `${step.by} was placed at pin ${pinLabel(step.pin)} first.`;
    case "own-pin-overlap-new":
      return `The new ${step.with} store at ${pinLabel(step.withPin)} is ${roundKm(step.km)} km away: catchments would overlap by ${Math.round(step.overlapPct)}%, at or above the 45% limit.`;
    case "territory-full":
      return step.heldBy.length
        ? `${step.territoryId}'s open slots are already taken by ${step.heldBy.join(", ")}.`
        : `${step.territoryId} has no open slots.`;
    case "same-person":
      return `The same person is already placed through ${step.other}, and one partner can hold only one store.`;
    case "no-viable-pin":
      return `No other pin in ${step.territoryId} is free of existing or new stores' catchments.`;
    case "no-free-slot-in-city":
      return `No territory in ${step.city ?? "the same city"} has a free slot.`;
    case "below-min-score":
      return `The score of ${step.score} is below the ${step.min} needed to hold a slot.`;
    case "no-coords":
      return `Pin ${step.pin} has no map position on file.`;
    default:
      return null;
  }
}

export function explain(d: ExplainInput): { headline: string; why: string; reasons: Reason[] } {
  const reasons: Reason[] = [];
  const add = (code: string, text: string, impact: Reason["impact"]) => reasons.push({ code, text, impact });
  const name = d.app.name ?? d.id;
  const where = d.allocation ? `${pinLabel(d.allocation.pin)}, ${d.allocation.territoryId}` : "";
  const conditionFlags = d.flags.filter((f) => f.severity === "condition");
  const blockers = d.flags.filter((f) => f.severity === "blocker");
  const trace = d.trace.map(traceSentence).filter((s): s is string => !!s);
  const ranked = [...d.breakdown].filter((c) => c.key !== "signals").sort((a, b) => b.points / b.max - a.points / a.max);
  const best = ranked[0];
  const weakest = ranked[ranked.length - 1];
  const worst = d.cannibalisation.find((c) => c.kind === "existing");
  const overlapLine = worst
    ? worst.overlapPct > 0
      ? `The closest existing store is ${worst.storeId}, ${worst.km} km away, with ${Math.round(worst.overlapPct)}% catchment overlap (${worst.band.toLowerCase()}; the limit is ${d.a.overlapBlockAtPct}%).`
      : `The closest existing store, ${worst.storeId}, is ${worst.km} km away and its catchment doesn't reach this pin.`
    : "";
  const payback =
    d.payback && Number.isFinite(d.payback.months) ? ` Estimated payback is about ${Math.round(d.payback.months)} months.` : "";
  const deadline = d.flags.find((f) => f.code === "DEADLINE_UNREACHABLE");
  const target = d.app.targetLaunchMonths;
  const tooTight = target !== null && d.realisticMonths !== null && target < d.realisticMonths - 1;
  const open = d.plannedOpenDate
    ? ` Planned opening is around ${formatDate(d.plannedOpenDate)}${tooTight ? ` (they asked for ${target} month${target === 1 ? "" : "s"}; about ${Math.round((d.realisticMonths as number) * 10) / 10} is realistic)` : ""}.${deadline ? ` ${deadline.message}` : ""}`
    : "";
  const dueConditions = (d.conditions ?? []).length
    ? ` To close before opening: ${(d.conditions ?? []).map((c) => `${c.text} (by ${formatDate(c.deadline)})`).join(" ")}`
    : "";
  const change = d.whatWouldChange ? ` ${d.whatWouldChange}` : "";

  let headline: string;
  let why: string;

  switch (d.status as Status) {
    case "APPROVED": {
      headline = `Approved for ${where}`;
      why = `Approved at ${where} with a score of ${score(d.score)}, above the ${d.a.approveScore} needed. ${overlapLine} Strongest on ${best?.name.toLowerCase()} (${best?.points}/${best?.max}); weakest on ${weakest?.name.toLowerCase()} (${weakest?.points}/${weakest?.max}).${payback}${open} No open conditions, so the next step is signing the letter of intent.`;
      add("ALLOCATED_OWN_PIN", `Gets the pin applied for (${where}) with a score of ${d.score}, above the ${d.a.approveScore} needed for approval.`, "decisive");
      break;
    }
    case "CONDITIONAL": {
      const short = conditionFlags.length
        ? conditionFlags.map((f) => f.code.toLowerCase().replace(/_/g, " ")).slice(0, 3).join(", ")
        : `score ${d.score} is below ${d.a.approveScore}`;
      headline = `Conditionally approved for ${where}: ${short}`;
      const lead = conditionFlags.length
        ? ""
        : ` The score is below the ${d.a.approveScore} needed for a clean approval, though above the ${d.a.slotMinScore} needed to hold a slot.`;
      why = `Conditionally approved at ${where} with a score of ${score(d.score)}. ${overlapLine}${lead}${payback}${open}${dueConditions}`;
      add(
        "ALLOCATED_CONDITIONAL",
        conditionFlags.length
          ? `Holds a slot at ${where}, but ${conditionFlags.length} condition(s) must close first.`
          : `Holds a slot at ${where}, but a score of ${d.score} is below the ${d.a.approveScore} needed for a clean approval.`,
        "decisive"
      );
      break;
    }
    case "REDIRECT": {
      const from = d.allocation?.redirectedFrom;
      headline = `Redirected to ${where}${from ? ` (applied for ${pinLabel(from.pin)})` : ""}`;
      const penalty = d.redirectPenaltyApplied
        ? ` They would lose a site they already have, so ${d.a.redirectPenalty} points were deducted when ranking (${d.score} to ${d.effectiveScore}).`
        : " They have no site to lose, so no ranking penalty applies.";
      const rivals = d.competitors?.length
        ? ` ${d.competitors.map((c) => `${c.id} (${c.score}) ranked ahead: ${c.whyTheyWon.replace(/^\d+ vs \d+: /, "")}.`).join(" ")}`
        : "";
      why = `Redirected to ${where}. ${trace.slice(0, 2).join(" ")}${rivals} Score ${score(d.score)}.${penalty} The slot is held until ${d.allocation?.slotReservedUntil ? formatDate(d.allocation.slotReservedUntil) : "30 days from today"} while a site is secured at the new pin.${payback}${open}${dueConditions}`;
      add("REDIRECTED", `Could not take the pin applied for, so the best free pin was offered: ${where}.`, "decisive");
      break;
    }
    case "WAITLIST": {
      const rank = d.waitlistRank;
      const rival = d.competitors?.[0];
      const samePerson = d.trace.find((t) => t.kind === "same-person");
      if (samePerson && samePerson.kind === "same-person") {
        headline = `Waitlisted: the same applicant is already placed through ${samePerson.other}`;
        why = `${name} applied more than once and one partner can hold only one store. ${samePerson.other}${rival?.score != null ? ` scored ${rival.score} against ${d.score} here, so it` : " ranked higher, so it"} gets the placement. This application only matters if ${samePerson.other} lapses.${change}`;
        add("SAME_PERSON", `One store per applicant: ${samePerson.other} was placed instead.`, "decisive");
      } else if (d.trace.some((t) => t.kind === "below-min-score")) {
        const weak = [...d.breakdown].filter((c) => c.key !== "signals").sort((a, b) => a.points / a.max - b.points / b.max).slice(0, 2);
        headline = `Waitlisted: not ready yet (score ${d.score}, needs ${d.a.slotMinScore})`;
        why = `Waitlisted as not ready yet: a score of ${score(d.score)} is below the ${d.a.slotMinScore} needed to hold a slot, so a slot isn't forced on a weak application. Weakest areas: ${weak.map((c) => `${c.name.toLowerCase()} (${c.points}/${c.max}): ${c.reason}`).join(" ")}${change}`;
        add("BELOW_MIN_SCORE", `Score ${d.score} is below the ${d.a.slotMinScore} minimum to hold a slot.`, "decisive");
      } else {
        headline = rank ? `Waitlisted for ${rank.territoryId}, #${rank.rank} in line` : "Waitlisted: no free slot or pin available";
        const lead = rank ? `Waitlisted for ${rank.territoryId} (#${rank.rank} of ${rank.of}).` : "Waitlisted: no slot is available for this applicant right now.";
        const versus = rival ? ` ${rival.id} scored ${rival.score} against ${d.score}: ${rival.whyTheyWon.replace(/^\d+ vs \d+: /, "")}.` : "";
        why = `${lead} ${trace.slice(0, 2).join(" ")}${versus}${change} They move up if a place opens, for example through a withdrawal or a conditional approval that lapses.`;
        add("LOST_SLOT", `Eligible with a score of ${d.score}, but ${trace[0] ? lower1(trace[0]) : "no slot or pin was left for them"}`, "decisive");
      }
      break;
    }
    case "HOLD": {
      headline = `On hold: ${blockers.map((b) => b.code.toLowerCase().replace(/_/g, " ")).slice(0, 2).join(" and ")}`;
      const shown = blockers.filter((b) => !(b.code === "INVESTMENT_CONTRADICTION" && blockers.some((x) => x.code === "INVESTMENT_OUTLIER")));
      why = `On hold: the application can't be decided yet. ${shown.map((b) => b.message).join(" ")}${change || " Once these are confirmed it is scored and ranked like any other application."}`;
      for (const b of blockers) add(b.code, b.message, "decisive");
      break;
    }
    case "REJECTED": {
      if (d.withdrawn !== undefined) {
        headline = "Withdrawn by the applicant";
        why = `${name} withdrew${d.withdrawn ? `: ${d.withdrawn}` : ""}. Any slot or pin held for this application has been released.`;
        add("WITHDRAWN", "Applicant withdrew.", "decisive");
      } else {
        headline = "Can't proceed: investment is below the 60% minimum";
        const comp = d.breakdown.find((c) => c.key === "financial");
        why = `Rejected on investment. ${comp?.reason ?? ""}${change || (d.investmentGapTo60 ? ` Closing a gap of ${L(d.investmentGapTo60)} (for example with a co-investor) would bring it back into consideration.` : "")}`;
        add("BELOW_INVESTMENT_MINIMUM", comp?.reason ?? "Investment is below 60% of the tier need.", "decisive");
      }
      break;
    }
  }

  // Supporting reasons: conditions and the score components that mattered.
  if (d.status !== "HOLD" && d.status !== "REJECTED") {
    for (const f of conditionFlags) add(f.code, f.message, "major");
    for (const c of d.breakdown) {
      if (c.key === "signals" && c.points === 0) continue;
      add(`SCORE_${c.key.toUpperCase()}`, `${c.name} ${c.points}/${c.max}: ${c.reason}`, c.points / c.max < 0.5 ? "major" : "minor");
    }
  }
  for (const f of d.flags.filter((x) => x.severity === "warning")) add(f.code, f.message, "minor");

  return { headline, why: why.replace(/\s+/g, " ").trim(), reasons };
}
