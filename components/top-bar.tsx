"use client";

import { useRef, useState } from "react";
import { Download, FileDown, FileSpreadsheet, FlaskConical, RotateCcw, SlidersHorizontal, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RulesBadge } from "@/components/rules-badge";
import { downloadExport } from "@/lib/export";
import { runEngine } from "@/lib/engine";
import { useStore } from "@/lib/state/store";

export function TopBar() {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const hasData = !!s.result;

  async function doExport() {
    if (!s.result || !s.input) return;
    setExporting(true);
    // Let the button repaint before the (slightly heavier) full run with "what would change it" for everyone.
    await new Promise((r) => setTimeout(r, 30));
    try {
      let full = s.result;
      try {
        full = runEngine(s.input, s.assumptions, s.overrides, { today: s.today, simulate: true, throwOnViolation: false });
      } catch {
        /* fall back to the on-screen results */
      }
      downloadExport(full);
    } finally {
      setExporting(false);
    }
  }

  return (
    <header className="border-b bg-background">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold text-white" aria-hidden>
            FE
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base leading-tight font-semibold">Franchise Expansion Engine</h1>
            <p className="truncate text-xs text-muted-foreground">{s.fileName ? s.fileName : "Rules decide, AI explains"}</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => void s.loadSample()} disabled={s.busy}>
            <FlaskConical /> <span className="max-sm:sr-only">Load sample data</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={s.busy}>
            <Upload /> <span className="max-sm:sr-only">Upload Excel</span>
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
          <a
            href="/Case1_Franchise_Test_Data_Format.xlsx"
            download
            className="inline-flex h-7 items-center gap-1 rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted"
          >
            <FileDown className="size-3.5" /> <span className="max-sm:sr-only">Download template</span>
          </a>
          <Button variant="outline" size="sm" onClick={() => s.setAssumptionsOpen(true)}>
            <SlidersHorizontal /> <span className="max-sm:sr-only">Assumptions</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void doExport()} disabled={!hasData || exporting}>
            {exporting ? <FileSpreadsheet className="animate-pulse" /> : <Download />} <span className="max-sm:sr-only">{exporting ? "Preparing…" : "Export (.xlsx)"}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(true)} disabled={!s.input && s.log.length === 0}>
            <RotateCcw /> <span className="max-sm:sr-only">Start over</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-1.5">
        <RulesBadge />
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground" title={s.aiAvailable ? "The AI is reading notes, answering questions and translating messages. Every decision still comes from the rules." : (s.aiNote ?? "The AI isn't available, so everything is answered by the rules engine directly.")}>
          <span className={`size-1.5 rounded-full ${s.aiAvailable ? "bg-approved" : "bg-waitlist"}`} aria-hidden />
          {s.aiAvailable ? "AI on" : "Rules-only mode"}
        </span>
        <button
          type="button"
          onClick={() => s.setAssumptionsOpen(true)}
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
        >
          <SlidersHorizontal className="size-3" aria-hidden /> Assumptions
        </button>
        <span className="ml-auto text-xs text-muted-foreground">Saved in this browser only</span>
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
