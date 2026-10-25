"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "@/lib/engine/assumptions";
import type { FieldDiff } from "@/lib/engine/changes";
import type { Tier } from "@/lib/engine/types";
import { useStore } from "@/lib/state/store";

interface Def {
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
const perTier = (group: string, key: "investmentNeedLakh" | "monthlyRevenueLakh" | "catchmentKm", label: string, unit: string, max: number, step: number): Def[] =>
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
const top = (group: string, id: keyof Assumptions, label: string, unit: string, min: number, max?: number, step = 1): Def => ({
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
const days = (key: "site" | "finance" | "data", label: string): Def => ({
  id: `conditionDays.${key}`,
  group: "Thresholds",
  label,
  unit: "days",
  min: 1,
  max: 365,
  get: (a) => a.conditionDays[key],
  set: (a, v) => ({ ...a, conditionDays: { ...a.conditionDays, [key]: v } }),
});

const DEFS: Def[] = [
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
const GROUPS = ["Investment & revenue", "Catchment & cannibalisation", "Space", "Thresholds"];

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

function validateOrder(a: Assumptions): string | null {
  if (!(a.overlapLowBelowPct < a.overlapModerateBelowPct && a.overlapModerateBelowPct < a.overlapBlockAtPct)) return "Overlap bands must rise: Low < Moderate < Blocked.";
  if (a.idealSpaceMinSqft > a.idealSpaceMaxSqft) return "The ideal range must start below where it ends.";
  if (a.slotMinScore > a.approveScore) return "The minimum score to hold a slot can't be above the approval score.";
  if (a.paybackFlagMonths > a.paybackConditionMonths) return "Payback is flagged first, then becomes a condition, so the flag level must be lower.";
  return null;
}

function Row({ def, a }: { def: Def; a: Assumptions }) {
  const s = useStore();
  const value = def.get(a);
  const [text, setText] = useState(fmt(value));
  const [err, setErr] = useState<string | null>(null);
  const changed = value !== def.get(DEFAULT_ASSUMPTIONS);

  function commit() {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) {
      setErr("Enter a number.");
      return;
    }
    if (n < def.min || (def.max !== undefined && n > def.max)) {
      setErr(`Between ${def.min} and ${def.max ?? "any"}.`);
      return;
    }
    if (n === value) {
      setErr(null);
      return;
    }
    const next = def.set(a, n);
    const bad = validateOrder(next);
    if (bad) {
      setErr(bad);
      return;
    }
    setErr(null);
    const diff: FieldDiff = { target: "assumption", id: "", field: def.id, label: def.label, from: `${fmt(value)} ${def.unit}`, to: `${fmt(n)} ${def.unit}` };
    s.changeAssumptions(next, [diff], `Changed assumption “${def.label}” from ${fmt(value)} to ${fmt(n)} ${def.unit}`);
  }

  return (
    <div className="grid grid-cols-[1fr_7rem] items-center gap-3 py-1.5 text-sm">
      <label htmlFor={`as-${def.id}`} className="leading-snug">
        {def.label} {changed ? <span className="rounded bg-brand-soft px-1 text-[10px] text-brand">changed</span> : null}
      </label>
      <div>
        <div className="flex items-center gap-1">
          <input
            id={`as-${def.id}`}
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
            className="h-8 w-full rounded-lg border bg-background px-2 text-right text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="w-9 text-xs text-muted-foreground">{def.unit}</span>
        </div>
      </div>
      {err ? <p className="col-span-2 text-xs text-rejected-ink" role="alert">{err}</p> : null}
    </div>
  );
}

export function AssumptionsDrawer() {
  const s = useStore();
  const last = s.log.find((e) => e.source === "Assumption" && !e.undone);
  const isDefault = DEFS.every((d) => d.get(s.assumptions) === d.get(DEFAULT_ASSUMPTIONS));

  function reset() {
    const diffs: FieldDiff[] = DEFS.filter((d) => d.get(s.assumptions) !== d.get(DEFAULT_ASSUMPTIONS)).map((d) => ({
      target: "assumption", id: "", field: d.id, label: d.label,
      from: `${fmt(d.get(s.assumptions))} ${d.unit}`, to: `${fmt(d.get(DEFAULT_ASSUMPTIONS))} ${d.unit}`,
    }));
    s.changeAssumptions({ ...DEFAULT_ASSUMPTIONS }, diffs, "Reset all assumptions to the defaults");
  }

  return (
    <Sheet open={s.assumptionsOpen} onOpenChange={s.setAssumptionsOpen}>
      <SheetContent className="w-full! max-w-xl! gap-0 p-0">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Assumptions</SheetTitle>
          <SheetDescription>
            Every number the engine uses to score and place applicants. Edit any value and all decisions re-run straight away.
          </SheetDescription>
          <p className="text-xs text-muted-foreground">Store format benchmarked on a Lenskart-style specialty retail store: small format, 300 to 800 sq ft, ground floor or mall, high-street visibility.</p>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {last && s.result ? (
            <p className="mt-3 rounded-lg bg-brand-soft p-2.5 text-sm" role="status">
              Last change moved <strong>{last.statusDiffs.length}</strong> decision{last.statusDiffs.length === 1 ? "" : "s"}.{" "}
              {last.statusDiffs.length ? "See the Change log for which ones." : "No applicant's status or placement changed."}
            </p>
          ) : null}
          {GROUPS.map((g) => (
            <section key={g} className="mt-4">
              <h3 className="mb-1 border-b pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g}</h3>
              {DEFS.filter((d) => d.group === g).map((d) => <Row key={`${d.id}:${d.get(s.assumptions)}`} def={d} a={s.assumptions} />)}
            </section>
          ))}
          <p className="mt-4 text-xs text-muted-foreground">
            Coordinates are pin-code centroids, not exact shop addresses, so distances and overlaps are estimates. The tier of each city always comes from the brand&apos;s city list.
          </p>
          <Button variant="outline" className="mt-3" onClick={reset} disabled={isDefault}>
            <RotateCcw /> Reset to defaults
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
