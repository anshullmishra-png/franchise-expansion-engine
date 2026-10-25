import type { Assumptions } from "./assumptions";
import { cityOfPin, pinLabel } from "./reference";
import type { Application, Decision, EngineResult, FlagCode, Overrides, Status } from "./types";

// "What would change it" (SPEC §6): for applicants who aren't moving forward, re-run the engine with the
// obvious fix and report what the decision would become. Nothing here decides anything: every number in
// the text comes from a full engine run.

export interface SimBase {
  status: Status;
  score: number | null;
  pin: string | null;
}

export interface SimContext {
  /** Re-runs the engine with these changes on top of the current overrides. Nothing is committed. */
  run: (delta: Overrides) => EngineResult;
  /** Everyone's current outcome, to spot knock-on effects. */
  base: Record<string, SimBase>;
  A: Assumptions;
  /** A free, legal pin in the applicant's own city nearest to the pin they applied for, or null. */
  altPin: (id: string) => string | null;
}

export type SimSubject = Pick<
  Decision,
  "id" | "status" | "score" | "flags" | "trace" | "waitlistRank" | "withdrawn" | "signals" | "city" | "pin" | "tier" | "ownTerritoryId"
>;

const moving = (s: Status) => s === "APPROVED" || s === "CONDITIONAL" || s === "REDIRECT";

export function mergeOverrides(a: Overrides, b: Overrides): Overrides {
  const out: Overrides = {
    applications: { ...(a.applications ?? {}) },
    territories: { ...(a.territories ?? {}) },
    withdrawn: { ...(a.withdrawn ?? {}), ...(b.withdrawn ?? {}) },
    addedSignals: { ...(a.addedSignals ?? {}) },
    resolved: { ...(a.resolved ?? {}) },
  };
  for (const [id, e] of Object.entries(b.applications ?? {})) out.applications![id] = { ...(out.applications![id] ?? {}), ...e };
  for (const [id, e] of Object.entries(b.territories ?? {})) out.territories![id] = { ...(out.territories![id] ?? {}), ...e };
  for (const [id, s] of Object.entries(b.addedSignals ?? {})) out.addedSignals![id] = [...(out.addedSignals![id] ?? []), ...s];
  for (const [id, c] of Object.entries(b.resolved ?? {})) out.resolved![id] = [...new Set([...(out.resolved![id] ?? []), ...c])];
  return out;
}

const L = (n: number) => `₹${Math.round(n * 100) / 100} lakh`;

function where(d: Decision): string {
  return d.allocation ? `${pinLabel(d.allocation.pin)}, ${d.allocation.territoryId}` : "";
}

function phrase(d: Decision): string {
  switch (d.status) {
    case "APPROVED":
      return `approved at ${where(d)}`;
    case "CONDITIONAL":
      return `conditionally approved at ${where(d)}`;
    case "REDIRECT":
      return `redirected to ${where(d)}`;
    case "WAITLIST":
      return d.waitlistRank ? `waitlisted #${d.waitlistRank.rank} for ${d.waitlistRank.territoryId}` : "waitlisted, with no slot available for them";
    case "HOLD":
      return "still on hold";
    case "REJECTED":
      return "still rejected";
  }
}

function bumped(r: EngineResult, base: Record<string, SimBase>, self: string, exclude: string[] = []): string {
  const out = r.decisions.filter((x) => x.id !== self && !exclude.includes(x.id) && base[x.id] && moving(base[x.id].status) && !moving(x.status));
  if (!out.length) return "";
  const names = out.slice(0, 2).map((x) => `${x.id} to ${x.waitlistRank ? `waitlist #${x.waitlistRank.rank}` : "the waitlist"}`);
  return `, moving ${names.join(" and ")}${out.length > 2 ? ` and ${out.length - 2} more` : ""}`;
}

interface Fix {
  label: string;
  delta: Overrides;
}

const app = (id: string, fields: NonNullable<Overrides["applications"]>[string]): Overrides => ({ applications: { [id]: fields } });

export function whatWouldChange(d: SimSubject, a: Application, ctx: SimContext): string | undefined {
  if (d.withdrawn !== undefined) return undefined;
  const codes = new Set<FlagCode>(d.flags.map((f) => f.code));
  const need = d.tier ? ctx.A.investmentNeedLakh[d.tier] : null;

  // ---- Rejected on investment
  if (d.status === "REJECTED" && need !== null) {
    const min60 = Math.ceil(need * 0.6 * 2) / 2;
    const rLow = ctx.run(app(d.id, { investmentLakh: min60 }));
    const low = rLow.decisionById[d.id];
    const full = ctx.run(app(d.id, { investmentLakh: need })).decisionById[d.id];
    const had = a.investmentLakh ?? 0;
    const part = (label: string, x: Decision) => `${label} the score would be ${x.score ?? "n/a"} and ${d.id} would be ${phrase(x)}`;
    return `At ${L(min60)} (60% of the ${L(need)} need, ${L(min60 - had)} more, for example from a co-investor) ${part("", low).trim()}${bumped(rLow, ctx.base, d.id)}; at the full ${L(need)} ${part("", full).trim()}.`;
  }

  // ---- On hold
  if (d.status === "HOLD") {
    const phrases: string[] = [];
    const delta: Overrides = {};
    let simulatable = true;
    const blockers = d.flags.filter((f) => f.severity === "blocker");
    for (const b of blockers) {
      if (b.code === "INVESTMENT_OUTLIER" || b.code === "INVESTMENT_CONTRADICTION") {
        const sig = d.signals.find((s) => s.type === "contradiction" && s.field === "investment" && typeof s.value === "number");
        if (!sig) {
          simulatable = false;
          continue;
        }
        const v = sig.value as number;
        Object.assign(delta, mergeOverrides(delta, app(d.id, { investmentLakh: v })));
        const text = `the investment is confirmed as ${L(v)}`;
        if (!phrases.includes(text)) phrases.push(text);
      } else if (b.code === "CITY_PIN_MISMATCH") {
        const pinCity = cityOfPin(d.pin)?.city;
        if (!pinCity) {
          simulatable = false;
          continue;
        }
        Object.assign(delta, mergeOverrides(delta, app(d.id, { city: pinCity })));
        phrases.push(`pin ${d.pin} is confirmed, which puts the store in ${pinCity}`);
      } else if (b.code === "PROBABLE_DUPLICATE" || b.code === "DUPLICATE_ID") {
        Object.assign(delta, mergeOverrides(delta, { resolved: { [d.id]: [b.code] } }));
        phrases.push(b.code === "PROBABLE_DUPLICATE" ? "the applicant confirms this is a separate application" : "the correct ID is confirmed");
      } else simulatable = false;
    }
    if (!simulatable || phrases.length === 0) {
      const qs = blockers.filter((b) => b.question).map((b) => b.question);
      return qs.length
        ? `Needs answers first: ${qs.join(" ")} Once confirmed it is scored and ranked like any other application.`
        : "Needs the missing details confirmed first; then it is scored and ranked like any other application.";
    }
    const r = ctx.run(delta);
    const s = r.decisionById[d.id];
    const extra = d.flags.some((f) => f.code === "CITY_PIN_MISMATCH") ? " If the city is right instead, a correct pin in that city is needed." : "";
    const samePerson = s.trace.find((t) => t.kind === "same-person");
    const note = samePerson && samePerson.kind === "same-person" ? ` (one partner can hold only one store, so it would sit behind ${samePerson.other})` : "";
    return `If ${phrases.join(" and ")}, ${d.id} would score ${s.score ?? "n/a"} and be ${phrase(s)}${note}${bumped(r, ctx.base, d.id)}.${extra}`;
  }

  // ---- Waitlisted
  if (d.status === "WAITLIST") {
    const fixes: Fix[] = [];
    const sameP = d.trace.find((t) => t.kind === "same-person");
    if (sameP && sameP.kind === "same-person") {
      fixes.push({ label: `${sameP.other}, the same person's other application, is withdrawn`, delta: { withdrawn: { [sameP.other]: "simulation" } } });
    }
    const spaceCodes: FlagCode[] = ["FIND_SPACE", "NEED_GROUND_FLOOR", "CONFIRM_FLOOR", "SPACE_TOO_SMALL", "SPACE_CONTRADICTION"];
    let spaceFix: Fix | null = null;
    if (spaceCodes.some((c) => codes.has(c))) {
      const fields: NonNullable<Overrides["applications"]>[string] = { floor: "Ground" };
      if (a.spaceAvailable === "Not yet identified" || a.spaceAvailable === null) fields.spaceAvailable = "Identified (ownership unconfirmed)";
      if (codes.has("SPACE_TOO_SMALL")) fields.spaceSize = ctx.A.minSpaceSqft;
      const label = codes.has("FIND_SPACE")
        ? `they find a ground-floor space (${ctx.A.minSpaceSqft}+ sq ft)`
        : codes.has("SPACE_TOO_SMALL")
          ? `they move to a ground-floor space of at least ${ctx.A.minSpaceSqft} sq ft`
          : codes.has("NEED_GROUND_FLOOR")
            ? "they move to a ground-floor space"
            : "the space is confirmed as ground floor";
      spaceFix = { label, delta: app(d.id, fields) };
      fixes.push(spaceFix);
    }
    let financeFix: Fix | null = null;
    if ((codes.has("FIN_GAP") || codes.has("FIN_GAP_LARGE")) && need !== null) {
      financeFix = {
        label: `they close the ${L(need - (a.investmentLakh ?? 0))} funding gap (investment of ${L(need)})`,
        delta: app(d.id, { investmentLakh: need }),
      };
      fixes.push(financeFix);
    }
    const pinBlocked = d.trace.some((t) => ["own-pin-store", "own-pin-overlap", "own-pin-overlap-new", "no-territory"].includes(t.kind));
    const alt = pinBlocked ? ctx.altPin(d.id) : null;
    if (alt) fixes.push({ label: `they apply for pin ${pinLabel(alt)} instead`, delta: app(d.id, { pin: alt }) });

    const results = fixes.slice(0, 4).map((f) => ({ f, r: ctx.run(f.delta) }));
    const promoted = results.filter((x) => moving(x.r.decisionById[d.id].status));
    const parts: string[] = [];
    for (const { f, r } of promoted.slice(0, 2)) {
      const s = r.decisionById[d.id];
      const scoreText = s.score !== null && d.score !== null && s.score !== d.score ? `the score rises from ${d.score} to ${s.score} and ` : "";
      parts.push(`If ${f.label}, ${scoreText}${d.id} would be ${phrase(s)}${bumped(r, ctx.base, d.id, Object.keys(f.delta.withdrawn ?? {}))}.`);
    }
    if (!promoted.length && spaceFix && financeFix) {
      const r = ctx.run({ ...mergeOverrides(spaceFix.delta, financeFix.delta) });
      const s = r.decisionById[d.id];
      if (moving(s.status)) {
        parts.push(`If ${spaceFix.label} and ${financeFix.label}, the score rises from ${d.score} to ${s.score} and ${d.id} would be ${phrase(s)}${bumped(r, ctx.base, d.id)}.`);
      }
    }
    if (!parts.length) {
      const better = results.map((x) => ({ f: x.f, s: x.r.decisionById[d.id] })).filter((x) => x.s.score !== null && d.score !== null && (x.s.score as number) > d.score)
        .sort((x, y) => (y.s.score as number) - (x.s.score as number))[0];
      if (better) {
        const enough = (better.s.score as number) >= ctx.A.slotMinScore;
        parts.push(
          `If ${better.f.label}, the score would rise from ${d.score} to ${better.s.score}${enough ? ` (enough to hold a slot) and ${d.id} would be ${phrase(better.s)}, but the slots are taken` : `, still below the ${ctx.A.slotMinScore} needed to hold a slot`}.`
        );
      }
      else parts.push("Nothing the applicant can change quickly would win a slot.");
    }
    return parts.join(" ");
  }

  return undefined;
}
