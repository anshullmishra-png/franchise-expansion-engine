"use client";

import { useRef, useState } from "react";
import { FileDown, FlaskConical, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/state/store";

export function EmptyState() {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10 sm:py-16">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Decide every franchise applicant, and show why.</h2>
        <ul className="mx-auto mt-4 max-w-lg space-y-1.5 text-left text-sm text-muted-foreground">
          <li>1. Upload your Excel file: Applications, Territories and the brand&apos;s existing stores.</li>
          <li>2. Every applicant gets a decision, a plain-language reason, next steps and a training plan.</li>
          <li>3. Ask questions or give new information in the chat, and see every knock-on change.</li>
        </ul>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void s.loadFile(f);
        }}
        className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition ${over ? "border-brand bg-brand-soft" : "border-border bg-card"}`}
        data-testid="dropzone"
      >
        <Upload className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Drag and drop your Excel file here</p>
        <p className="text-xs text-muted-foreground">.xlsx in the brand template format. Nothing is uploaded to a server; the file is read in your browser.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => fileRef.current?.click()} disabled={s.busy}>
            <Upload /> Choose a file
          </Button>
          <Button variant="outline" onClick={() => void s.loadSample()} disabled={s.busy}>
            <FlaskConical /> Try with sample data
          </Button>
          <a
            href="/Case1_Franchise_Test_Data_Format.xlsx"
            download
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
          >
            <FileDown className="size-4" /> Download template
          </a>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void s.loadFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <p className="text-center text-xs text-muted-foreground">
        The decisions are made by transparent rules and a 100-point score. The store format is benchmarked on a Lenskart-style specialty retail store (300 to 800 sq ft, ground floor or mall).
      </p>
    </div>
  );
}
