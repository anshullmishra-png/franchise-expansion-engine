"use client";

import { ArrowRight, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IdText } from "@/components/id-text";
import { StatusChip } from "@/components/status";
import type { ChangeLogEntry } from "@/lib/state/persist";
import { useStore } from "@/lib/state/store";

export function StatusDiffList({ diffs }: { diffs: ChangeLogEntry["statusDiffs"] }) {
  const s = useStore();
  if (!diffs.length) return <p className="text-sm text-muted-foreground">No other applicant&apos;s status or placement changed.</p>;
  return (
    <ul className="space-y-1.5">
      {diffs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <button type="button" onClick={() => s.openApplicant(d.id)} className="font-medium text-brand hover:underline">{d.id}</button>
          <span className="text-muted-foreground">{d.name}</span>
          <StatusChip status={d.from.status} />
          <span className="text-xs text-muted-foreground">{d.from.where}</span>
          <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
          <StatusChip status={d.to.status} />
          <span className="text-xs text-muted-foreground">{d.to.where}</span>
          {d.from.score !== d.to.score ? <span className="text-xs tabular-nums text-muted-foreground">score {d.from.score ?? "-"} → {d.to.score ?? "-"}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function ChangeLogTab() {
  const s = useStore();
  const latestActive = s.log.find((e) => !e.undone)?.id;

  if (s.log.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        No changes yet. When you edit an applicant, change an assumption or tell the chat something new, each change appears here with what moved, and an Undo.
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {s.log.map((e) => (
        <li key={e.id} className={`rounded-xl border bg-card p-4 ${e.undone ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">{e.source}</span>
            <time className="text-xs text-muted-foreground" dateTime={e.at}>{new Date(e.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time>
            {e.undone ? <span className="text-xs font-medium text-muted-foreground">Undone</span> : null}
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              disabled={e.id !== latestActive}
              title={e.undone ? "Already undone" : e.id === latestActive ? "Undo this change" : "Undo the later changes first"}
              onClick={() => s.undo()}
            >
              <Undo2 /> Undo
            </Button>
          </div>
          <p className={`mt-2 text-sm ${e.undone ? "line-through" : ""}`}>
            <IdText text={e.sourceText} />
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="pr-3 font-medium">What changed</th><th className="pr-3 font-medium">From</th><th className="font-medium">To</th></tr>
              </thead>
              <tbody>
                {e.fieldDiffs.map((d, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1 pr-3">{d.id ? `${d.id}: ` : ""}{d.label}</td>
                    <td className="py-1 pr-3 text-muted-foreground">{d.from}</td>
                    <td className="py-1">{d.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4 className="mt-3 mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Knock-on effects</h4>
          <StatusDiffList diffs={e.statusDiffs} />
        </li>
      ))}
    </ol>
  );
}
