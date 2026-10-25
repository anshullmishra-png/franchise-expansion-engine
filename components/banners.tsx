"use client";

import { AlertTriangle, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/state/store";

function Banner({ tone, children, action, onClose }: { tone: "info" | "warn" | "error"; children: React.ReactNode; action?: React.ReactNode; onClose?: () => void }) {
  const cls =
    tone === "error" ? "border-rejected/40 bg-rejected-soft text-rejected-ink" : tone === "warn" ? "border-waitlist/50 bg-waitlist-soft text-waitlist-ink" : "border-teal-700/20 bg-teal-50 text-teal-800";
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
      {onClose ? (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="rounded p-0.5 hover:bg-black/5">
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/** Data-quality banners: upload problems, ignored template rows, and notes about the file. */
export function Banners() {
  const s = useStore();
  const ex = s.input?.excludedExamples;
  const exampleApps = ex?.applications ?? [];
  const exampleTers = ex?.territories ?? [];
  const includedNote = (kind: "application" | "territory") => s.includeExamples[kind];

  const notes = s.notices.filter((n) => n.level !== "error" && n.code !== "EXAMPLE_ROW_IGNORED");

  return (
    <div className="flex flex-col gap-2 px-4 pt-3 empty:hidden">
      {s.uploadError ? (
        <Banner tone="error" onClose={s.dismissUploadError}>
          <strong>That file didn&apos;t load.</strong> {s.uploadError}
        </Banner>
      ) : null}
      {s.engineError ? (
        <Banner tone="error">
          <strong>Something went wrong while deciding.</strong> {s.engineError} You can use Start over and try the file again.
        </Banner>
      ) : null}

      {exampleApps.map((e) => (
        <Banner
          key={`a-${e.row.sourceId}`}
          tone="info"
          action={
            !e.locked ? (
              <Button size="xs" variant="outline" onClick={() => s.setIncludeExample("application", true)}>
                Include it
              </Button>
            ) : undefined
          }
        >
          Ignored the template&apos;s example row ({e.row.sourceId} {e.row.name}).{e.locked ? " Another row uses the same ID, so it stays out." : ""}
        </Banner>
      ))}
      {exampleTers.map((e) => (
        <Banner
          key={`t-${e.row.sourceId}`}
          tone="info"
          action={
            !e.locked ? (
              <Button size="xs" variant="outline" onClick={() => s.setIncludeExample("territory", true)}>
                Include it
              </Button>
            ) : undefined
          }
        >
          Ignored the template&apos;s example territory ({e.row.sourceId} {e.row.city}).{e.locked ? " Another row uses the same ID, so it stays out." : ""}
        </Banner>
      ))}
      {includedNote("application") ? (
        <Banner tone="info" action={<Button size="xs" variant="outline" onClick={() => s.setIncludeExample("application", false)}>Ignore it</Button>}>
          The template&apos;s example applicant row is included in the results.
        </Banner>
      ) : null}
      {includedNote("territory") ? (
        <Banner tone="info" action={<Button size="xs" variant="outline" onClick={() => s.setIncludeExample("territory", false)}>Ignore it</Button>}>
          The template&apos;s example territory row is included in the results.
        </Banner>
      ) : null}

      {notes.length ? (
        <Banner tone={notes.some((n) => n.level === "warning") ? "warn" : "info"}>
          <ul className="space-y-0.5">
            {notes.map((n, i) => (
              <li key={i}>{n.message}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
    </div>
  );
}
