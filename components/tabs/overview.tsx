"use client";

import { AlertTriangle, CalendarClock, HelpCircle, Info, Layers, Lightbulb } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IdText } from "@/components/id-text";
import { STATUS_META } from "@/components/status";
import { addDaysISO, formatDate } from "@/lib/engine/reference";
import { STATUSES, type Status } from "@/lib/engine/types";
import { useStore } from "@/lib/state/store";

export function OverviewTab() {
  const s = useStore();
  const r = s.result;
  if (!r) return null;

  const total = r.decisions.length;
  const moving = r.counts.APPROVED + r.counts.CONDITIONAL + r.counts.REDIRECT;
  const slots = r.territories.reduce((n, t) => n + t.openSlots, 0);
  const filled = r.territories.reduce((n, t) => n + t.allocated.length, 0);
  const soon = addDaysISO(s.today, 14);

  const holds = r.decisions.filter((d) => d.status === "HOLD");
  const dueSoon = r.decisions
    .flatMap((d) => (d.conditions ?? []).filter((c) => c.deadline <= soon).map((c) => ({ d, c })))
    .sort((a, b) => a.c.deadline.localeCompare(b.c.deadline));
  const unfilled = r.territories.filter((t) => t.insight);

  function filterBy(status: Status) {
    s.setStatusFilter([status]);
    s.setTab("applications");
  }

  if (total === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Your file has no applicants yet. Add them from row 4 of the Applications sheet and upload it again, or try the sample data.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground">{total}</strong> applicants: <strong className="text-foreground">{moving}</strong> moving forward, {total - moving} not yet. <strong className="text-foreground">{filled}</strong> of{" "}
        <strong className="text-foreground">{slots}</strong> open slots filled across {r.territories.length} territories.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {STATUSES.map((st) => {
          const m = STATUS_META[st];
          const Icon = m.icon;
          return (
            <button
              key={st}
              type="button"
              onClick={() => filterBy(st)}
              className={`rounded-xl border-l-4 bg-card p-3 text-left ring-1 ring-foreground/10 transition hover:ring-foreground/30 ${m.tile}`}
              aria-label={`${r.counts[st]} ${m.label}. Show them in the table`}
            >
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${m.chip}`}>
                <Icon className="size-3.5" aria-hidden /> {m.label}
              </span>
              <span className="mt-2 block text-3xl font-semibold tabular-nums">{r.counts[st]}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Layers className="size-4" aria-hidden /> Slots filled per territory</CardTitle>
            <CardDescription>New stores allocated against the open slots the brand set for each territory.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {r.territories.length === 0 ? <p className="text-sm text-muted-foreground">No territories in the file.</p> : null}
            {r.territories.map((t) => {
              const pct = t.openSlots > 0 ? (t.allocated.length / t.openSlots) * 100 : 0;
              return (
                <div key={t.id} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-sm">
                  <button type="button" className="text-left font-medium text-brand hover:underline" onClick={() => s.openTerritory(t.id)}>
                    {t.id}
                  </button>
                  <div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={t.allocated.length} aria-valuemax={t.openSlots} aria-label={`${t.id} slots filled`}>
                      <div className={`h-full rounded-full ${t.freeSlots > 0 && t.openSlots > 0 ? "bg-waitlist" : "bg-approved"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t.city ?? "?"}
                      {t.tier ? ` · Tier ${t.tier}` : ""}
                      {t.priority ? ` · ${t.priority}` : ""}
                    </div>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t.allocated.length}/{t.openSlots}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4" aria-hidden /> Needs your attention</CardTitle>
            <CardDescription>Applications that can&apos;t be decided yet, and conditions due in the next 14 days.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-80 space-y-3 overflow-y-auto">
            {holds.length === 0 && dueSoon.length === 0 ? <p className="text-sm text-muted-foreground">Nothing needs chasing right now.</p> : null}
            {holds.map((d) => (
              <div key={d.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <HelpCircle className="size-4 text-hold" aria-hidden />
                  <button type="button" onClick={() => s.openApplicant(d.id)} className="font-medium text-brand hover:underline">
                    {d.id} {d.name ?? ""}
                  </button>
                  <span className="text-xs text-muted-foreground">on hold</span>
                </div>
                <ul className="mt-0.5 ml-6 list-disc text-muted-foreground">
                  {(d.questionsForApplicant ?? []).slice(0, 2).map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            ))}
            {dueSoon.map(({ d, c }, i) => (
              <div key={`${d.id}-${i}`} className="flex gap-2 text-sm">
                <CalendarClock className="mt-0.5 size-4 shrink-0 text-conditional" aria-hidden />
                <span>
                  <button type="button" onClick={() => s.openApplicant(d.id)} className="font-medium text-brand hover:underline">
                    {d.id}
                  </button>{" "}
                  <span className="text-muted-foreground">by {formatDate(c.deadline)}:</span> {c.text}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Info className="size-4" aria-hidden /> Data-quality alerts</CardTitle>
          <CardDescription>Things in the file the engine had to interpret. Each one is also flagged on the applicant or territory.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {r.alerts.length === 0 ? <p className="text-sm text-muted-foreground">No data problems found.</p> : null}
          {r.alerts.map((a, i) => (
            <div key={i} className="flex gap-2 text-sm">
              <span
                className={`mt-1.5 size-2 shrink-0 rounded-full ${a.severity === "blocker" ? "bg-hold" : a.severity === "warning" ? "bg-waitlist" : "bg-redirect"}`}
                aria-label={a.severity}
              />
              <IdText text={a.message} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Lightbulb className="size-4" aria-hidden /> Unfilled-slot insights</CardTitle>
          <CardDescription>Slots the brand wanted to fill but couldn&apos;t, and why. A free slot is never forced onto a weak application.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {unfilled.length === 0 ? <p className="text-sm text-muted-foreground">Every open slot is filled.</p> : null}
          {unfilled.map((t) => (
            <div key={t.id} className="text-sm">
              <div className="font-medium">
                <button type="button" onClick={() => s.openTerritory(t.id)} className="text-brand hover:underline">{t.id}</button>{" "}
                <span className="font-normal text-muted-foreground">
                  {t.city}: {t.insight!.freeSlots} of {t.openSlots} slot{t.openSlots === 1 ? "" : "s"} unfilled
                </span>
              </div>
              <ul className="mt-0.5 ml-5 list-disc text-muted-foreground">
                {t.insight!.reasons.map((x, i) => (
                  <li key={i}><IdText text={x} /></li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
