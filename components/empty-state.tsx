"use client";

import { useRef, useState } from "react";
import { FileDown, FileSpreadsheet, FlaskConical, LocateFixed, MapPin, MessageSquareDot, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { useStore } from "@/lib/state/store";

const CITIES = [
  { name: "Bengaluru", note: "Tier 1" },
  { name: "Mysuru", note: "Tier 2" },
  { name: "Mangaluru", note: "Tier 2" },
  { name: "And 4 more", note: "Tier 2 and 3" },
];

const STEPS = [
  { icon: FileSpreadsheet, title: "Upload your Excel file", text: "Applications, Territories and the brand's existing stores, in the template format." },
  { icon: Sparkles, title: "Every applicant gets a decision", text: "A status, a plain-language reason, next steps and a training plan in their language." },
  { icon: MessageSquareDot, title: "Ask, or tell it something new", text: "The chat explains any decision and shows every knock-on change when things move." },
];

/** First screen: the map-beside-rail card. Upload happens on the map; the rail says how it works. */
export function EmptyState() {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="mx-auto max-w-7xl px-4 pt-10 pb-16 sm:px-6 sm:pt-14 lg:px-8">
      <div className="max-w-2xl">
        <span className="tracky inline-flex items-center gap-2 rounded-full border border-teal-700/20 bg-teal-50 px-3 py-1 text-[12px] font-semibold text-teal-700 uppercase">
          <MessageSquareDot className="size-3.5" aria-hidden /> Expansion decisions
        </span>
        <h2 className="mt-5 text-4xl leading-[1.05] font-extrabold tracking-tight text-ink-900 sm:text-5xl">
          Decide every applicant,
          <br className="hidden sm:block" /> and show exactly why.
        </h2>
        <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink-600">
          Drop in one Excel file and every applicant gets a clear decision, the reasoning in plain words, and what happens next. Rules make the call, so the same file always gives the same answer.
        </p>
      </div>

      <section className="mt-10 grid grid-cols-1 overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card xl:grid-cols-[1.65fr_1fr]" aria-label="Get started">
        <div className="relative flex flex-col border-b border-ink-200 xl:border-r xl:border-b-0">
          <div
            data-testid="dropzone"
            role="group"
            aria-label="Drop your Excel file here"
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
            className={`map-grid h-[420px] overflow-hidden sm:h-[460px] xl:h-auto xl:min-h-[520px] xl:flex-1 ${over ? "ring-4 ring-teal-500/40 ring-inset" : ""}`}
          >
            <span className="blob" style={{ left: "-6%", top: "8%", width: "46%", height: "52%" }} />
            <span className="blob" style={{ right: "-8%", top: "30%", width: "44%", height: "58%", background: "rgba(15,118,110,.1)" }} />
            <span className="blob" style={{ left: "22%", bottom: "-14%", width: "40%", height: "40%", background: "rgba(15,118,110,.07)" }} />
            <span className="road" style={{ left: "-5%", top: "34%", width: "112%", height: 14, transform: "rotate(-4deg)" }} />
            <span className="road" style={{ left: "-5%", top: "72%", width: "112%", height: 12, transform: "rotate(3deg)" }} />
            <span className="road-soft" style={{ left: "30%", top: "-5%", width: 12, height: "112%", transform: "rotate(8deg)" }} />
            <span className="road-soft" style={{ left: "70%", top: "-5%", width: 10, height: "112%", transform: "rotate(-6deg)" }} />
            <span className="road-soft" style={{ left: "6%", top: "12%", width: "62%", height: 9, transform: "rotate(18deg)" }} />

            <span className="tracky absolute top-5 left-6 inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-bold text-teal-800 uppercase shadow-card ring-1 ring-ink-200 sm:top-6 sm:left-7">
              <LocateFixed className="size-3.5 text-teal-700" aria-hidden /> {over ? "Drop it here" : "Start here"}
            </span>

            <div className="absolute top-[54%] left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 sm:top-1/2 sm:left-[38%] sm:flex-row sm:items-center sm:gap-0">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white shadow-pop ring-1 ring-ink-200">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-teal-700 ring-4 ring-teal-100" />
              </span>
              <div className="relative w-[272px] max-w-[88vw] overflow-hidden rounded-xl bg-white shadow-pop ring-1 ring-ink-200 sm:ml-3">
                <span className="absolute top-1/2 -left-1.5 hidden h-3 w-3 -translate-y-1/2 rotate-45 bg-white ring-1 ring-ink-200 sm:block" aria-hidden />
                <div className="relative border-b border-ink-100 bg-white px-4 py-3">
                  <h3 className="text-[14px] font-bold text-ink-900">Upload your Excel file</h3>
                  <p className="text-[12px] text-ink-500">Drag it onto the map, or choose it.</p>
                </div>
                <div className="relative bg-white p-3">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={s.busy}
                    className="submit-btn inline-flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[14px] font-bold"
                  >
                    <Upload className="size-4" aria-hidden /> Choose a file
                  </button>
                  <button
                    type="button"
                    onClick={() => void s.loadSample()}
                    disabled={s.busy}
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-ink-200 bg-white py-2.5 text-[14px] font-semibold text-ink-800 hover:bg-teal-50 disabled:opacity-50"
                  >
                    <FlaskConical className="size-4 text-teal-700" aria-hidden /> Try with sample data
                  </button>
                </div>
                <a
                  href="/Case1_Franchise_Test_Data_Format.xlsx"
                  download
                  className="relative flex items-center gap-2 border-t border-ink-100 bg-white px-4 py-2.5 text-[13px] font-semibold text-teal-700 hover:bg-teal-50"
                >
                  <FileDown className="size-4" aria-hidden /> Download the template
                </a>
              </div>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              aria-label="Choose an Excel file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void s.loadFile(f);
                e.target.value = "";
              }}
            />
          </div>

          <div className="grid grid-cols-2 divide-x divide-ink-200 border-t border-ink-200 sm:grid-cols-4">
            {CITIES.map((c, i) => (
              <div key={c.name} className={`relative flex flex-col items-center gap-1 px-3 py-4 ${i === 0 ? "text-ink-900" : "text-ink-700"} ${i >= 2 ? "max-sm:border-t max-sm:border-ink-200" : ""}`}>
                {i === 0 ? <span className="absolute inset-x-0 top-0 h-0.5 bg-teal-700" aria-hidden /> : null}
                <span className="text-[14px] font-bold">{c.name}</span>
                <span className={`text-[11px] font-medium ${i === 0 ? "text-teal-700" : "text-ink-600"}`}>{c.note}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col bg-ink-950 p-7 text-ink-100 sm:p-9">
          <div className="flex items-center justify-between border-b border-white/10 pb-5">
            <span className="tracky text-[12px] font-bold text-ink-400 uppercase">How it works</span>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-ink-300" aria-hidden>
              <MapPin className="size-4" />
            </span>
          </div>

          <ol className="mt-6 space-y-5">
            {STEPS.map((st, i) => (
              <li key={st.title} className="flex gap-3.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-teal-400" aria-hidden>
                  <st.icon className="size-4" />
                </span>
                <div>
                  <h3 className="text-[14px] font-bold text-white">
                    <span className="mr-1.5 text-ink-500 tabular-nums">{i + 1}.</span>
                    {st.title}
                  </h3>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-ink-400">{st.text}</p>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-6 flex items-center gap-1.5 text-[12px] text-ink-400">
            <ShieldCheck className="size-4 shrink-0 text-teal-500" aria-hidden /> Your file is read in your browser. Nothing is uploaded to a server.
          </p>

          <div className="mt-auto pt-7">
            <div className="border-t border-white/10 pt-5">
              <span className="tracky text-[12px] font-bold text-ink-400 uppercase">About the store format</span>
              <p className="mt-2.5 rounded-xl bg-white/[.04] p-4 text-[13px] leading-relaxed text-ink-300 ring-1 ring-white/10">
                Benchmarked on a Lenskart-style specialty retail store: small format, 300 to 800 sq ft, ground floor or mall. Every number behind a decision is shown and can be changed in Assumptions.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
