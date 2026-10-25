"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IdText } from "@/components/id-text";
import { StatusChip } from "@/components/status";
import { pinLabel } from "@/lib/engine/reference";
import type { TerritoryResult } from "@/lib/engine/types";
import { useStore } from "@/lib/state/store";

export function TerritoryCard({ t, highlight }: { t: TerritoryResult; highlight?: boolean }) {
  const s = useStore();
  const r = s.result!;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);
  const flags = t.flags.filter((f) => f.severity === "warning" || f.severity === "blocker");
  const infoFlags = t.flags.filter((f) => f.severity === "info");

  return (
    <div ref={ref} id={`territory-${t.id}`}>
      <Card className={highlight ? "ring-2 ring-brand" : ""}>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t.id}</span>
            <span className="text-sm font-normal text-muted-foreground">
              {t.city ?? "city not given"}
              {t.tier ? ` · Tier ${t.tier}` : ""}
              {t.priority ? ` · ${t.priority} priority` : ""}
            </span>
            <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
              {t.allocated.length}/{t.openSlots} slots filled
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Allocated stores</h4>
            {t.allocated.length === 0 ? (
              <p className="text-muted-foreground">None.</p>
            ) : (
              <ul className="space-y-1">
                {t.allocated.map((id) => {
                  const d = r.decisionById[id];
                  return (
                    <li key={id} className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => s.openApplicant(id)} className="font-medium text-brand hover:underline">{id}</button>
                      <span>{d.name}</span>
                      <StatusChip status={d.status} />
                      <span className="text-muted-foreground">at {d.allocation ? pinLabel(d.allocation.pin) : "?"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Waitlist (in order)</h4>
            {t.waitlist.length === 0 ? (
              <p className="text-muted-foreground">Nobody waiting.</p>
            ) : (
              <ol className="list-decimal space-y-0.5 pl-5">
                {t.waitlist.map((id) => {
                  const d = r.decisionById[id];
                  return (
                    <li key={id}>
                      <button type="button" onClick={() => s.openApplicant(id)} className="font-medium text-brand hover:underline">{id}</button> {d.name}{" "}
                      <span className="text-muted-foreground">(score {d.score})</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div>
            <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Viable pins left</h4>
            <p className={t.viablePins.length ? "" : "text-muted-foreground"}>
              {t.viablePins.length ? t.viablePins.map(pinLabel).join(", ") : "None: every listed pin is taken or too close to another store."}
            </p>
          </div>

          {t.insight ? (
            <div className="rounded-lg bg-waitlist-soft p-2.5 text-waitlist-ink">
              <strong>
                {t.insight.freeSlots} slot{t.insight.freeSlots === 1 ? "" : "s"} unfilled.
              </strong>{" "}
              <IdText text={t.insight.reasons.join(" ")} />
            </div>
          ) : null}

          {flags.length || infoFlags.length ? (
            <div>
              <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Flags</h4>
              <ul className="space-y-0.5">
                {flags.map((f, i) => (
                  <li key={`w${i}`} className="flex gap-2"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-waitlist" aria-hidden /><IdText text={f.message} /></li>
                ))}
                {infoFlags.map((f, i) => (
                  <li key={`i${i}`} className="flex gap-2 text-muted-foreground"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-redirect" aria-hidden /><IdText text={f.message} /></li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function TerritoriesTab() {
  const s = useStore();
  if (!s.result) return null;
  if (s.result.territories.length === 0)
    return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No territories in the file, so nobody can be placed. Add rows to the Territories sheet.</div>;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {s.result.territories.map((t) => (
        <TerritoryCard key={t.id} t={t} />
      ))}
    </div>
  );
}
