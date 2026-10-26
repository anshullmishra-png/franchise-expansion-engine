"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Download, FileDown, FileSpreadsheet, FlaskConical, MapPinned, RotateCcw, SlidersHorizontal, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RulesBadge } from "@/components/rules-badge";
import { downloadExport, EXPORT_FILE_NAME } from "@/lib/export";
import { runEngine } from "@/lib/engine";
import { useStore } from "@/lib/state/store";

export function TopBar() {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const hasData = !!s.result;

  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  useEffect(() => () => { if (exportUrl) URL.revokeObjectURL(exportUrl); }, [exportUrl]);

  // Runs straight from the click (no await before the download) so browsers don't treat it as a pop-up and block it.
  function doExport() {
    if (!s.result || !s.input) return;
    setExporting(true);
    setExportError(null);
    try {
      let full = s.result;
      try {
        // The full run adds "what would change it" for everyone.
        full = runEngine(s.input, s.assumptions, s.overrides, { today: s.today, simulate: true, throwOnViolation: false, ...(s.readings ? { readings: s.readings } : {}) });
      } catch {
        /* fall back to the on-screen results */
      }
      setExportUrl(downloadExport(full));
    } catch (e) {
      setExportError(e instanceof Error && e.message ? e.message : "Something went wrong while building the file.");
    } finally {
      setExporting(false);
    }
  }

  const outline = "border-ink-200 bg-white text-ink-700 shadow-card hover:bg-teal-50 hover:text-ink-900";
  return (
    <header className="sticky top-0 z-40 border-b border-ink-200/80 bg-paper/85 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-teal-700 text-white shadow-card" aria-hidden>
            <MapPinned className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[17px] leading-tight font-extrabold tracking-tight text-ink-900">
              Franchise Expansion <span className="text-teal-700">Engine</span>
            </h1>
            <p className="truncate text-xs text-ink-500">{s.fileName ? s.fileName : "Rules decide, AI explains"}</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" className={outline} onClick={() => void s.loadSample()} disabled={s.busy}>
            <FlaskConical /> <span className="max-sm:sr-only">Load sample data</span>
          </Button>
          <a
            href="/Case1_Franchise_Test_Data_Format.xlsx"
            download
            className={`inline-flex h-7 items-center gap-1 rounded-[min(var(--radius-md),12px)] border px-2.5 text-[0.8rem] font-medium ${outline}`}
          >
            <FileDown className="size-3.5" /> <span className="max-sm:sr-only">Download template</span>
          </a>
          <Button variant="outline" size="sm" className={outline} onClick={() => s.setAssumptionsOpen(true)}>
            <SlidersHorizontal /> <span className="max-sm:sr-only">Assumptions</span>
          </Button>
          <Button variant="outline" size="sm" className={outline} onClick={doExport} disabled={!hasData || exporting}>
            {exporting ? <FileSpreadsheet className="animate-pulse" /> : <Download />} <span className="max-sm:sr-only">{exporting ? "Preparing…" : "Export (.xlsx)"}</span>
          </Button>
          <Button variant="ghost" size="sm" className="text-ink-600" onClick={() => setConfirmOpen(true)} disabled={!s.input && s.log.length === 0}>
            <RotateCcw /> <span className="max-sm:sr-only">Start over</span>
          </Button>
          <Button size="sm" className="bg-ink-900 font-semibold text-white shadow-card hover:bg-ink-800" onClick={() => fileRef.current?.click()} disabled={s.busy}>
            <Upload /> <span className="max-sm:sr-only">Upload Excel</span> <ArrowRight className="max-sm:hidden" />
          </Button>
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

      <div className="flex flex-wrap items-center gap-2 border-t border-ink-200/70 bg-white/60 px-4 py-1.5 lg:px-6">
        <RulesBadge />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2 py-0.5 text-xs text-ink-600" title={s.aiAvailable ? "The AI is reading notes, answering questions and translating messages. Every decision still comes from the rules." : (s.aiNote ?? "The AI isn't available, so everything is answered by the rules engine directly.")}>
          <span className={`size-1.5 rounded-full ${s.aiAvailable ? "bg-approved" : "bg-waitlist"}`} aria-hidden />
          {s.aiAvailable ? "AI on" : "Rules-only mode"}
        </span>
        <button
          type="button"
          onClick={() => s.setAssumptionsOpen(true)}
          className="nav-link inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white px-2 py-0.5 text-xs text-ink-600 hover:text-ink-900 max-sm:hidden"
        >
          <SlidersHorizontal className="size-3" aria-hidden /> Assumptions
        </button>
        {exportUrl ? (
          <a href={exportUrl} download={EXPORT_FILE_NAME} className="text-xs font-medium text-teal-700 underline underline-offset-2">
            Export ready. If it didn&rsquo;t download, click here.
          </a>
        ) : null}
        {exportError ? (
          <span role="alert" className="text-xs text-rejected-ink">
            Couldn&rsquo;t build the export: {exportError}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-ink-500 max-sm:hidden">Saved in this browser only</span>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start over?</DialogTitle>
            <DialogDescription>
              This clears the loaded file, your edits, the change log, the chat and any assumption changes saved in this browser.
            </DialogDescription>
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
