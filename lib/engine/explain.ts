import type { Assumptions } from "./assumptions";
import { roundKm } from "./geo";
import { pinLabel } from "./reference";
import type { Application, Decision, Reason, ScoreComponent, Status, TraceStep } from "./types";

// Deterministic explanations built from the decision's own numbers (SPEC §6). First version:
// every applicant gets a headline, a plain-language "why" and ordered reasons. The next phase
// adds richer competitor comparisons and the "what would change it" simulations.

export type ExplainInput = Omit<Decision, "headline" | "why" | "reasons"> & {
  app: Application;
  a: Assumptions;
  hasSite: boolean;
  investmentGapTo60?: number;
};

const L = (n: number) => `₹${Math.round(n * 100) / 100} lakh`;
const score = (n: number | null) => (n === null ? "no score" : `${n}/100`);

/** "+7 site readiness, +5 experience" — where `winner` out-scored `loser`. */
export function componentDiff(winner: ScoreComponent[], loser: ScoreComponent[]): string {
  const diffs = winner
    .map((w) => ({ name: w.name.toLowerCase(), d: w.points - (loser.find((l) => l.key === w.key)?.points ?? 0) }))
    .filter((x) => x.d !== 0);
  const ahead = diffs.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 3);
  const behind = diffs.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 2);
  const parts: string[] = [];
  if (ahead.length) parts.push(ahead.map((x) => `+${x.d} ${x.name}`).join(", "));
  if (behind.length) parts.push(`but ${behind.map((x) => `${x.d} ${x.name}`).join(", ")}`);
  return parts.join(" ") || "level on every component";
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
  const strengths = [...d.breakdown].filter((c) => c.key !== "signals").sort((a, b) => b.points / b.max - a.points / a.max);
  const weakest = strengths[strengths.length - 1];
  const worst = d.cannibalisation.filter((c) => c.kind === "existing")[0];
  const overlapLine = worst
    ? `Closest existing store is ${worst.storeId}, ${roundKm(worst.km)} km away, with ${Math.round(worst.overlapPct)}% catchment overlap (${worst.band.toLowerCase()}; the limit is ${d.a.overlapBlockAtPct}%).`
    : "No existing store's catchment reaches the pin.";
  const conditionText = conditionFlags.length ? ` Conditions to close before opening: ${conditionFlags.map((f) => f.message).join(" ")}` : "";

  let headline: string;
  let why: string;

  switch (d.status as Status) {
    case "APPROVED": {
      headline = `Approved for ${where}`;
      why = `Approved at ${where} with a score of ${score(d.score)}. ${overlapLine} Strongest on ${strengths[0]?.name.toLowerCase()}; weakest on ${weakest?.name.toLowerCase()} (${weakest?.points}/${weakest?.max}). No open conditions, so the next step is the agreement.`;
      add("ALLOCATED_OWN_PIN", `Gets the pin applied for (${where}) with a score of ${d.score}, above the ${d.a.approveScore} needed for approval.`, "decisive");
      break;
    }
    case "CONDITIONAL": {
      const short = conditionFlags.length ? conditionFlags.map((f) => f.code.toLowerCase().replace(/_/g, " ")).join(", ") : `score ${d.score} is below ${d.a.approveScore}`;
      headline = `Conditionally approved for ${where}: ${short}`;
      why = `Conditionally approved at ${where} with a score of ${score(d.score)}. ${overlapLine}${conditionText}`;
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
      const penalty = d.redirectPenaltyApplied ? ` Because they would lose a site they already have, ${d.a.redirectPenalty} points were deducted when ranking (${d.score} → ${d.effectiveScore}).` : " They have no site to lose, so no penalty applies.";
      why = `Redirected to ${where}. ${trace.join(" ")} Score ${score(d.score)}.${penalty} The slot is held until ${d.allocation?.slotReservedUntil ?? "30 days from today"} while a site is secured at the new pin.${conditionText}`;
      add("REDIRECTED", `Could not take the pin applied for, so the best free pin was offered: ${where}.`, "decisive");
      break;
    }
    case "WAITLIST": {
      const rank = d.waitlistRank;
      const lost = d.competitors?.[0];
      const samePerson = d.trace.find((t) => t.kind === "same-person");
      if (samePerson && samePerson.kind === "same-person") {
        const other = d.competitors?.[0];
        headline = `Waitlisted: the same applicant is already placed through ${samePerson.other}`;
        why = `${name} applied more than once and one partner can hold only one store. ${samePerson.other}${other?.score != null ? ` scored ${other.score} against ${d.score} here, so it` : " ranked higher, so it"} gets the placement. This application only matters if ${samePerson.other} lapses.${conditionText}`;
        add("SAME_PERSON", `One store per applicant: ${samePerson.other} was placed instead.`, "decisive");
      } else if (d.trace.some((t) => t.kind === "below-min-score")) {
        headline = `Waitlisted: not ready yet (score ${d.score}, needs ${d.a.slotMinScore})`;
        why = `Waitlisted as not ready yet: a score of ${score(d.score)} is below the ${d.a.slotMinScore} needed to hold a slot, so the slot isn't forced on a weak application. Weakest areas: ${[...d.breakdown].filter((c) => c.key !== "signals").sort((a, b) => a.points / a.max - b.points / b.max).slice(0, 2).map((c) => `${c.name.toLowerCase()} (${c.points}/${c.max})`).join(" and ")}.${conditionText}`;
        add("BELOW_MIN_SCORE", `Score ${d.score} is below the ${d.a.slotMinScore} minimum to hold a slot.`, "decisive");
      } else {
        headline = rank ? `Waitlisted for ${rank.territoryId}, #${rank.rank} in line` : "Waitlisted: no free slot or pin";
        why = `Waitlisted${rank ? ` for ${rank.territoryId} (#${rank.rank} of ${rank.of})` : ""}. ${trace.join(" ")}${lost ? ` ${lost.id} (${lost.score}) ranked ahead of this application (${d.score}): ${lost.whyTheyWon}.` : ""} They move up if a place opens or a conditional approval lapses.${conditionText}`;
        add("LOST_SLOT", `Eligible with a score of ${d.score}, but ${trace[0] ?? "no slot or pin was left for them"}`, "decisive");
      }
      break;
    }
    case "HOLD": {
      headline = `On hold: ${blockers.map((b) => b.code.toLowerCase().replace(/_/g, " ")).slice(0, 2).join(" and ")}`;
      why = `On hold: the application can't be decided yet. ${blockers.map((b) => b.message).join(" ")} Once these are confirmed it is scored and ranked like any other application.`;
      for (const b of blockers) add(b.code, b.message, "decisive");
      break;
    }
    case "REJECTED": {
      if (d.withdrawn !== undefined) {
        headline = "Withdrawn by the applicant";
        why = `${name} withdrew${d.withdrawn ? `: ${d.withdrawn}` : ""}. Any slot or pin held for this application has been released.`;
        add("WITHDRAWN", "Applicant withdrew.", "decisive");
      } else {
        headline = `Can't proceed: investment is below the 60% minimum`;
        const comp = d.breakdown.find((c) => c.key === "financial");
        why = `Rejected on investment. ${comp?.reason ?? ""}${d.investmentGapTo60 ? ` Closing a gap of ${L(d.investmentGapTo60)} (for example with a co-investor) would bring it back into consideration.` : ""}`;
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
