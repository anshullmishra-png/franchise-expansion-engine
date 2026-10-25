import type { Outcome } from "../engine/changes";
import { STATUS_LABEL } from "./status-labels";

// Plain-language replies composed straight from tool results, so rules-only mode answers with the same numbers the AI would.

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = any;

export const says = (o: Outcome): string => {
  const label = STATUS_LABEL[o.status];
  if (o.status === "REJECTED" && o.where === "withdrawn") return "withdrawn";
  if (o.status === "WAITLIST") return o.where ? `waitlisted (${o.where})` : "waitlisted";
  if (o.where) return `${label.toLowerCase()} at ${o.where}`;
  return label.toLowerCase();
};

const firstSentence = (s: string) => (s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s).trim();
const join = (xs: string[]) => xs.filter(Boolean).join(" ");

export function replyUnknown(x: R): string {
  const near = (x.didYouMean ?? []).join(", ");
  return `${x.error}${near ? ` Did you mean ${near}?` : ""}`;
}

export function replyWhy(x: R): string {
  if (x.error) return replyUnknown(x);
  const why: string = x.whatWouldChange ? String(x.why).replace(x.whatWouldChange, "").replace(/\s+/g, " ").trim() : x.why;
  return join([`**${x.id} ${x.name ?? ""}: ${STATUS_LABEL[x.status as keyof typeof STATUS_LABEL]}.** ${why}`, x.whatWouldChange ? `\n**What would change it:** ${x.whatWouldChange}` : ""]);
}

export function replyNextSteps(x: R): string {
  if (x.error) return replyUnknown(x);
  if (!x.nextSteps?.length) {
    return `${x.id} isn't moving forward yet (${STATUS_LABEL[x.status as keyof typeof STATUS_LABEL].toLowerCase()}), so there is no onboarding plan. ${x.whatWouldChange ?? ""}`.trim();
  }
  const steps = x.nextSteps.map((s: R) => `- ${s.due} (${s.owner}): ${s.text}`).join("\n");
  const conds = x.conditions?.length ? `\n**Conditions to close:**\n${x.conditions.map((c: R) => `- by ${c.deadline}: ${c.text}`).join("\n")}` : "";
  return `**${x.id} ${x.name ?? ""}, next steps:**\n${steps}${conds}${x.plannedOpening ? `\nPlanned opening: ${x.plannedOpening}.` : ""}`;
}

export function replyTraining(x: R): string {
  if (x.error) return replyUnknown(x);
  const t = x.training;
  if (!t) return `${x.id} has no training plan as things stand (${STATUS_LABEL[x.status as keyof typeof STATUS_LABEL].toLowerCase()}).`;
  return join([
    `**${x.id} ${x.name ?? ""}: ${t.track} training in ${t.language}, ${t.totalDays} days${t.indicativeOnly ? " (indicative: they're not confirmed yet)" : ""}.** ${t.why}`,
    `\n${t.modules.map((m: string) => `- ${m}`).join("\n")}`,
    t.shadowing ? `\n**Shadowing:** ${t.shadowing}` : "",
    t.buddy ? `\n**Buddy partner:** ${t.buddy}` : "",
    `\n**Staff training:** ${t.staffTraining}`,
  ]);
}

export function replyPayback(x: R): string {
  if (x.error) return replyUnknown(x);
  if (!x.payback) return `There's no payback estimate for ${x.id} (${STATUS_LABEL[x.status as keyof typeof STATUS_LABEL].toLowerCase()}): it needs a usable pin first.`;
  const i = x.payback.inputs;
  return `**${x.id}: payback about ${x.payback.months} months.** ₹${i.investmentLakh} lakh set-up ÷ monthly profit of ₹${i.monthlyProfitLakh.toFixed(2)} lakh (₹${i.tierRevenueLakh} lakh revenue × floor ${i.floorFactor} × size ${i.sizeFactor} × overlap ${i.overlapFactor.toFixed(2)} × ${i.profitPct}% profit). Overlap used: ${Math.round(i.overlapPct)}%.`;
}

export function replyCompare(x: R): string {
  if (x.error) return replyUnknown(x);
  const a = x.a;
  const b = x.b;
  const line = (d: R) => `${d.id} ${d.name ?? ""}: ${says({ status: d.status, score: d.score, where: d.where })}, score ${d.score ?? "n/a"}`;
  return join([
    `**${x.higherScore} scores higher.** ${line(a)}. ${line(b)}.`,
    `\n${x.componentDifference}.`,
    x.competitorNotes?.length ? `\n${x.competitorNotes.join(" ")}` : "",
  ]);
}

export function replyTerritory(x: R): string {
  if (x.error) return replyUnknown(x);
  const alloc = x.allocated.map((d: R) => `${d.id} (${d.score}, ${d.where})`).join(", ") || "nobody yet";
  const wait = x.waitlist.map((d: R, i: number) => `#${i + 1} ${d.id} (${d.score})`).join(", ") || "nobody waiting";
  const applied = x.applicantsWhoAppliedHere.map((d: R) => `${d.id} (${d.status.toLowerCase()}, ${d.score ?? "no score"})`).join(", ");
  return join([
    `**${x.id}, ${x.city}${x.tier ? `, Tier ${x.tier}` : ""}${x.priority ? `, ${x.priority} priority` : ""}: ${x.filled} of ${x.openSlots} slots filled.**`,
    `\nHolding slots: ${alloc}.`,
    `\nWaitlist: ${wait}.`,
    applied ? `\nWho applied here: ${applied}.` : "",
    x.whyUnfilled?.length ? `\nWhy slots are unfilled: ${x.whyUnfilled.join(" ")}` : "",
    x.viablePinsLeft?.length ? `\nPins still viable: ${x.viablePinsLeft.join(", ")}.` : "",
  ]);
}

export function replyOverview(x: R): string {
  const c = x.counts;
  const unfilled = x.territories.filter((t: R) => t.free > 0 && t.openSlots > 0);
  return join([
    `**${x.applicants} applicants:** ${c.APPROVED} approved, ${c.CONDITIONAL} conditional, ${c.REDIRECT} redirect, ${c.WAITLIST} waitlist, ${c.HOLD} hold, ${c.REJECTED} rejected. ${x.placementRules}.`,
    unfilled.length
      ? `\n**Unfilled slots:**\n${unfilled.map((t: R) => `- ${t.id} (${t.city}): ${t.free} of ${t.openSlots} unfilled. ${(t.whyUnfilled ?? []).join(" ")}`).join("\n")}`
      : "\nEvery open slot is filled.",
    x.needsAttention.length ? `\n**On hold:** ${x.needsAttention.map((h: R) => h.id).join(", ")}.` : "",
  ]);
}

export function replyList(x: R): string {
  if (!x.count) return "No applicants match that.";
  return `**${x.count} applicant${x.count === 1 ? "" : "s"}:**\n${x.applicants.map((d: R) => `- ${d.id} ${d.name ?? ""}: ${d.status.toLowerCase()}, score ${d.score ?? "n/a"}${d.where ? `, ${d.where}` : ""}`).join("\n")}`;
}

export function replyStoreConflicts(conflicts: { id: string; pin: string; store: string | undefined }[]): string {
  return conflicts.length
    ? `**Yes, and it shouldn't happen:** ${conflicts.map((c) => `${c.id} at ${c.pin} (${c.store})`).join(", ")}.`
    : "**No.** No new store is planned in a pin that already has a store. The engine blocks those pins outright and re-checks all six placement rules after every run.";
}

export function replyUpdate(x: R, opts: { whatIf?: boolean } = {}): string {
  if (x.error && !x.applied?.length) return `${x.error}${x.skipped?.length > 1 ? ` ${x.skipped.slice(1).join(" ")}` : ""}`;
  if (x.note && !x.applied?.length) return x.note;
  const lines: string[] = [];
  const head = opts.whatIf ? "**If that changed (nothing has been changed):**" : "**What I changed:**";
  lines.push(`${head} ${x.applied.map((a: R) => `${a.id ? `${a.id} ` : ""}${a.field}: ${a.from} → ${a.to}`).join("; ")}.`);
  if (x.assumptions?.length) lines.push(`**What I assumed:** ${x.assumptions.join(" ")}`);
  if (x.skipped?.length) lines.push(`**Not applied:** ${x.skipped.join(" ")}`);
  if (x.primary) {
    const p = x.primary;
    const moved = p.scoreByComponent
      .filter((c: R) => c.before !== null && c.after !== c.before)
      .map((c: R) => `${c.component.toLowerCase()} ${c.before} → ${c.after}`)
      .join(", ");
    const scoreText = p.after.score === null ? "" : p.before.score !== p.after.score ? `Score ${p.before.score ?? "n/a"} → ${p.after.score ?? "n/a"}${moved ? ` (${moved})` : ""}.` : `Score stays ${p.after.score ?? "n/a"}.`;
    lines.push(`**New decision for ${p.id}:** was ${says(p.before)}; now ${says(p.after)}. ${scoreText} ${firstSentence(p.headlineAfter)}`);
  }
  if (x.knockOn) {
    lines.push(
      `**Knock-on effects:** ${
        x.knockOn.length
          ? x.knockOn.map((k: R) => `${k.id} ${k.name ?? ""}: ${says(k.from)} → ${says(k.to)}`).join("; ") + "."
          : "None."
      }`
    );
  }
  if (x.primary) lines.push(`**Still needed:** ${x.stillNeeded?.length ? x.stillNeeded.join(" ") : "Nothing."}`);
  return lines.join("\n");
}

export function replyAssumption(x: R): string {
  if (x.error) return x.error;
  if (x.note) return x.note;
  return join([
    `**What I changed:** ${x.applied.map((a: R) => `${a.field}: ${a.from} → ${a.to}`).join("; ")}.`,
    `\n**Decisions affected:** ${x.decisionsChanged}.${x.knockOn.length ? ` ${x.knockOn.map((k: R) => `${k.id}: ${says(k.from)} → ${says(k.to)}`).join("; ")}.` : ""}`,
  ]);
}

export function replyUndo(x: R): string {
  if (x.error) return x.error;
  return `**Undone.** ${x.knockOn.length ? `Restored: ${x.knockOn.map((k: R) => `${k.id}: ${says(k.from)} → ${says(k.to)}`).join("; ")}.` : "No applicant's status changed."}`;
}
