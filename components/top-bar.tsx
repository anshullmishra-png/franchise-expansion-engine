"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, MapPinned, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoreMenu } from "@/components/more-menu";
import { RulesBadge } from "@/components/rules-badge";
import { downloadExport, EXPORT_FILE_NAME, EXPORT_SIMULATE_MAX, WHAT_WOULD_CHANGE_SKIPPED } from "@/lib/export";
import { runEngine } from "@/lib/engine";
import { useStore } from "@/lib/state/store";

/** One calm row: who we are and which file, the health of the run, then the three things people actually do. */
export function TopBar() {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const hasData = !!s.result;

  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  useEffect(() => () => { if (exportUrl) URL.revokeObjectURL(exportUrl); }, [exportUrl]);

  // Runs straight from the click (no await before the download) so browsers don't treat it as a pop-up and block it.
  function doExport() {
    if (!s.result || !s.input) return;
    setExporting(true);
    setExportError(null);
    try {
      let full = s.result;
      // The full run adds "what would change it" for everyone, which is only quick for smaller files.
      const skipWhatWouldChange = s.input.applications.length > EXPORT_SIMULATE_MAX;
      if (!skipWhatWouldChange) {
        try {
          full = runEngine(s.input, s.assumptions, s.overrides, { today: s.today, simulate: true, throwOnViolation: false, ...(s.readings ? { readings: s.readings } : {}) });
        } catch {
          /* fall back to the on-screen results */
        }
      }
      setExportNote(skipWhatWouldChange ? WHAT_WOULD_CHANGE_SKIPPED : null);
      setExportUrl(downloadExport(full, { whatWouldChangeSkipped: skipWhatWouldChange }));
    } catch (e) {
      setExportError(e instanceof Error && e.message ? e.message : "Something went wrong while building the file.");
    } finally {
      setExporting(false);
    }
  }

  const outline = "press inline-flex h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 text-[13.5px] font-medium text-ink-700 shadow-card outline-none hover:bg-teal-50 hover:text-ink-900 disabled:opacity-50";
  return (
    <header className="sticky top-0 z-40 border-b border-ink-200/80 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => s.setTab("overview")}
          title="Back to the overview"
          className="group flex min-w-0 items-center gap-3 rounded-lg py-1 pr-2 text-left outline-none"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-teal-700 text-white shadow-card transition-transform duration-200 group-hover:scale-105 group-hover:rotate-[-4deg]" aria-hidden>
            <MapPinned className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[16px] leading-tight font-extrabold tracking-tight text-ink-900 max-sm:hidden">
              Franchise Expansion <span className="text-teal-700">Engine</span>
            </span>
            <span className="block truncate text-xs text-ink-500">{s.fileName ?? "Rules decide, AI explains"}</span>
          </span>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <RulesBadge />
          <span
            className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-600 max-md:px-1.5"
            title={s.aiAvailable ? "The AI is reading notes, answering questions and translating messages. Every decision still comes from the rules." : (s.aiNote ?? "The AI isn't available, so everything is answered by the rules engine directly.")}
          >
            <span className={`size-2 rounded-full ${s.aiAvailable ? "bg-approved" : "bg-waitlist"}`} aria-hidden />
            <span className="max-md:sr-only">{s.aiAvailable ? "AI on" : "Rules-only mode"}</span>
          </span>

          <button type="button" className={outline} onClick={doExport} disabled={!hasData || exporting} aria-busy={exporting}>
            {exporting ? <FileSpreadsheet className="size-4 animate-pulse" aria-hidden /> : <Download className="size-4" aria-hidden />}
            <span className="max-sm:sr-only">{exporting ? "Preparing…" : "Export"}</span>
          </button>
          <button
            type="button"
            className="press inline-flex h-9 items-center gap-2 rounded-lg bg-ink-900 px-3.5 text-[13.5px] font-semibold text-white shadow-card outline-none hover:bg-ink-800 disabled:opacity-50"
            onClick={() => fileRef.current?.click()}
            disabled={s.busy}
            aria-busy={s.busy}
          >
            <Upload className="size-4" aria-hidden /> <span className="max-sm:sr-only">{s.busy ? "Reading…" : "Upload Excel"}</span>
          </button>
          <MoreMenu busy={s.busy} canReset={!!s.input || s.log.length > 0} onLoadSample={() => void s.loadSample()} onAssumptions={() => s.setAssumptionsOpen(true)} onStartOver={() => setConfirmOpen(true)} />
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            data-testid="file-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void s.loadFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {exportUrl || exportError || exportNote ? (
        <div className="border-t border-ink-200/70 bg-white/70">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-xs sm:px-6 lg:px-8">
            {exportUrl ? (
              <a href={exportUrl} download={EXPORT_FILE_NAME} className="font-medium text-teal-700 underline underline-offset-2">
                Export ready. If it didn&rsquo;t download, click here.
              </a>
            ) : null}
            {exportNote ? <span className="text-ink-500">{exportNote}</span> : null}
            {exportError ? (
              <span role="alert" className="text-rejected-ink">
                Couldn&rsquo;t build the export: {exportError}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start over?</DialogTitle>
            <DialogDescription>This clears the loaded file, your edits, the change log, the chat and any assumption changes saved in this browser.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Keep my work
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                s.startOver();
                setConfirmOpen(false);
              }}
            >
              Clear everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
