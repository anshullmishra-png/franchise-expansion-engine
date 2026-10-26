"use client";

import { AlertTriangle, CalendarClock, HelpCircle, Info, Layers, Lightbulb } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleCard } from "@/components/collapsible";
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
    <div className="space-y-6">
      <div className="rise-in">
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Overview</h2>
        <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-ink-600">
          <strong className="font-semibold text-ink-900">{total}</strong> applicants: <strong className="font-semibold text-ink-900">{moving}</strong> moving forward, {total - moving} not yet.{" "}
          <strong className="font-semibold text-ink-900">{filled}</strong> of <strong className="font-semibold text-ink-900">{slots}</strong> open slots filled across {r.territories.length} territories.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {STATUSES.map((st, i) => {
          const m = STATUS_META[st];
          const Icon = m.icon;
          return (
            <button
              key={st}
              type="button"
              onClick={() => filterBy(st)}
              style={{ animationDelay: `${i * 40}ms` }}
              className={`spotlight rise-in rounded-2xl border border-l-4 border-ink-200 bg-card p-4 text-left shadow-card ${m.tile}`}
              aria-label={`${r.counts[st]} ${m.label}. Show them in the table`}
            >
              <span className={`relative inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${m.chip}`}>
                <Icon className="size-3.5" aria-hidden /> {m.label}
              </span>
              <span className="relative mt-3 block text-4xl font-semibold tabular-nums">{r.counts[st]}</span>
              <span className="relative mt-1 block text-xs text-ink-500">View in table &rarr;</span>
            </button>
          );
        })}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[15px]"><AlertTriangle className="size-4 text-hold" aria-hidden /> Needs your attention</CardTitle>
            <CardDescription>Applications that can&apos;t be decided yet, and conditions due in the next 14 days.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[26rem] space-y-4 overflow-y-auto">
            {holds.length === 0 && dueSoon.length === 0 ? <p className="text-sm text-muted-foreground">Nothing needs chasing right now.</p> : null}
            {holds.map((d) => (
              <div key={d.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <HelpCircle className="size-4 text-hold" aria-hidden />
                  <button type="button" onClick={() => s.openApplicant(d.id)} className="font-semibold text-brand hover:underline">
                    {d.id} {d.name ?? ""}
                  </button>
                  <span className="text-xs text-muted-foreground">on hold</span>
                </div>
                <ul className="mt-1 ml-6 list-disc space-y-0.5 leading-relaxed text-muted-foreground">
                  {(d.questionsForApplicant ?? []).slice(0, 2).map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            ))}
            {dueSoon.map(({ d, c }, i) => (
              <div key={`${d.id}-${i}`} className="flex gap-2 text-sm leading-relaxed">
                <CalendarClock className="mt-0.5 size-4 shrink-0 text-conditional" aria-hidden />
                <span>
                  <button type="button" onClick={() => s.openApplicant(d.id)} className="font-semibold text-brand hover:underline">
                    {d.id}
                  </button>{" "}
                  <span className="text-muted-foreground">by {formatDate(c.deadline)}:</span> {c.text}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[15px]"><Layers className="size-4 text-teal-700" aria-hidden /> Slots filled per territory</CardTitle>
            <CardDescription>New stores allocated against the open slots the brand set for each territory.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[26rem] space-y-1 overflow-y-auto">
            {r.territories.length === 0 ? <p className="text-sm text-muted-foreground">No territories in the file.</p> : null}
            {r.territories.map((t) => {
              const pct = t.openSlots > 0 ? (t.allocated.length / t.openSlots) * 100 : 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => s.openTerritory(t.id)}
                  title={`Open ${t.id}`}
                  className="group grid w-full grid-cols-[5.5rem_1fr_auto] items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-teal-50"
                >
                  <span className="font-semibold text-brand group-hover:underline">{t.id}</span>
                  <span>
                    <span className="block h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={t.allocated.length} aria-valuemax={t.openSlots} aria-label={`${t.id} slots filled`}>
                      <span className={`block h-full rounded-full transition-[width] duration-500 ${t.freeSlots > 0 && t.openSlots > 0 ? "bg-waitlist" : "bg-approved"}`} style={{ width: `${pct}%` }} />
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t.city ?? "?"}
                      {t.tier ? ` · Tier ${t.tier}` : ""}
                      {t.priority ? ` · ${t.priority}` : ""}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t.allocated.length}/{t.openSlots}
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <CollapsibleCard icon={Info} title="Data-quality alerts" count={r.alerts.length} description="Things in the file the engine had to interpret. Each one is also flagged on the applicant or territory.">
          <div className="space-y-2">
            {r.alerts.length === 0 ? <p className="text-sm text-muted-foreground">No data problems found.</p> : null}
            {r.alerts.map((a, i) => (
              <div key={i} className="flex gap-2.5 text-sm leading-relaxed">
                <span
                  className={`mt-2 size-2 shrink-0 rounded-full ${a.severity === "blocker" ? "bg-hold" : a.severity === "warning" ? "bg-waitlist" : "bg-redirect"}`}
                  aria-label={a.severity}
                />
                <IdText text={a.message} />
              </div>
            ))}
          </div>
        </CollapsibleCard>

        <CollapsibleCard icon={Lightbulb} title="Unfilled-slot insights" count={unfilled.length} description="Slots the brand wanted to fill but couldn't, and why. A free slot is never forced onto a weak application.">
          <div className="space-y-4">
            {unfilled.length === 0 ? <p className="text-sm text-muted-foreground">Every open slot is filled.</p> : null}
            {unfilled.map((t) => (
              <div key={t.id} className="text-sm">
                <div className="font-medium">
                  <button type="button" onClick={() => s.openTerritory(t.id)} className="font-semibold text-brand hover:underline">{t.id}</button>{" "}
                  <span className="font-normal text-muted-foreground">
                    {t.city}: {t.insight!.freeSlots} of {t.openSlots} slot{t.openSlots === 1 ? "" : "s"} unfilled
                  </span>
                </div>
                <ul className="mt-1 ml-5 list-disc space-y-1 leading-relaxed text-muted-foreground">
                  {t.insight!.reasons.map((x, i) => (
                    <li key={i}><IdText text={x} /></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      </div>
    </div>
  );
}
