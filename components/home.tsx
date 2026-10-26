"use client";

import { useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Clock, FileDown, FileSpreadsheet, FlaskConical, LocateFixed, MapPin, MapPinned, MessageSquareDot, PauseCircle, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { Banners } from "@/components/banners";
import { useStore } from "@/lib/state/store";

const STEPS = [
  { icon: FileSpreadsheet, title: "Upload your Excel file", text: "Applications, Territories and the brand's existing stores, in the template format." },
  { icon: Sparkles, title: "Every applicant gets a decision", text: "A status, a plain-language reason, next steps and a training plan in their language." },
  { icon: MessageSquareDot, title: "Ask, or tell it something new", text: "The chat explains any decision and shows every knock-on change when things move." },
];

const FEATURES = [
  {
    icon: Sparkles,
    title: "Every decision, explained",
    text: "Not just approved or rejected. Each applicant gets the reason in plain words, the numbers behind it, what would change it, and what happens next.",
  },
  {
    icon: ShieldCheck,
    title: "Placement rules that can't break",
    text: "No two stores share a pin, none lands on an existing store, and no catchments overlap by 45% or more. Six rules are re-checked independently after every run.",
  },
  {
    icon: MessageSquareDot,
    title: "Tell it what changed",
    text: "Say “APP-012 found a ground-floor space”. The engine re-runs everything and reports every applicant whose decision moved, with an undo.",
  },
];

const PROOF = ["No sign-in", "Your file stays in your browser", "Same file, same answer", "Works even if the AI is off"];

function DecisionPreview({ tone, icon: Icon, id, name, label, line, score, className = "" }: { tone: string; icon: typeof CheckCircle2; id: string; name: string; label: string; line: string; score: number | null; className?: string }) {
  return (
    <div className={`spotlight rounded-2xl border border-ink-200 bg-white p-4 shadow-pop ${className}`}>
      <div className="relative flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
          <Icon className="size-3.5" aria-hidden /> {label}
        </span>
        <span className="text-[13px] font-semibold text-ink-900">
          {id} <span className="font-normal text-ink-500">{name}</span>
        </span>
        {score !== null ? <span className="ml-auto text-lg font-semibold text-ink-900 tabular-nums">{score}</span> : null}
      </div>
      <p className="relative mt-2 text-[13px] leading-relaxed text-ink-600">{line}</p>
    </div>
  );
}

/** The first screen: what this is, why you can trust it, and a way in. Shown until a file is loaded. */
export function Home() {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = () => fileRef.current?.click();

  const primary = "submit-btn press inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-[15px] font-bold";
  const secondary =
    "press inline-flex items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-5 py-3 text-[15px] font-semibold text-ink-800 shadow-card hover:border-teal-500/50 hover:bg-teal-50 disabled:opacity-50";

  return (
    <div className="h-dvh scroll-smooth overflow-y-auto bg-paper">
      <header className="sticky top-0 z-40 border-b border-ink-200/70 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
          <a href="#top" className="group flex items-center gap-3 outline-none">
            <span className="grid size-9 place-items-center rounded-lg bg-teal-700 text-white shadow-card transition-transform duration-200 group-hover:scale-105 group-hover:rotate-[-4deg]" aria-hidden>
              <MapPinned className="size-5" />
            </span>
            <span className="text-[16px] font-extrabold tracking-tight text-ink-900 max-sm:hidden">
              Franchise Expansion <span className="text-teal-700">Engine</span>
            </span>
          </a>
          <nav className="ml-4 flex items-center gap-6 text-[14px] font-medium text-ink-600 max-md:hidden" aria-label="Page sections">
            <a href="#why" className="nav-link hover:text-ink-900">Why it&rsquo;s different</a>
            <a href="#start" className="nav-link hover:text-ink-900">Get started</a>
            <a href="#how" className="nav-link hover:text-ink-900">How it works</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => void s.loadSample()} disabled={s.busy} aria-busy={s.busy} className="press inline-flex h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 text-[13.5px] font-medium text-ink-700 shadow-card hover:bg-teal-50 disabled:opacity-50">
              <FlaskConical className="size-4 text-teal-700" aria-hidden /> <span className="max-sm:sr-only">Try sample data</span>
            </button>
            <button type="button" onClick={pick} disabled={s.busy} className="press inline-flex h-9 items-center gap-2 rounded-lg bg-ink-900 px-3.5 text-[13.5px] font-semibold text-white shadow-card hover:bg-ink-800 disabled:opacity-50">
              <Upload className="size-4" aria-hidden /> <span className="max-sm:sr-only">Upload Excel</span>
            </button>
          </div>
        </div>
      </header>
      <Banners />

      <main id="top">
        {/* Hero */}
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 pt-14 pb-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-8 lg:pt-24 lg:pb-24">
          <div className="rise-in">
            <span className="tracky inline-flex items-center gap-2 rounded-full border border-teal-700/20 bg-teal-50 px-3 py-1 text-[12px] font-semibold text-teal-700 uppercase">
              <MessageSquareDot className="size-3.5" aria-hidden /> Expansion decisions
            </span>
            <h1 className="mt-6 text-4xl leading-[1.05] font-extrabold tracking-tight text-ink-900 sm:text-5xl lg:text-6xl">
              Decide every applicant,
              <br />
              <span className="text-teal-700">and show exactly why.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-600">
              Drop in one Excel file. Every applicant gets a clear decision, the reasoning in plain words, and what happens next. Rules make the call, so the same file always gives the same answer.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button type="button" onClick={() => void s.loadSample()} disabled={s.busy} aria-busy={s.busy} className={primary}>
                <FlaskConical className="size-[18px]" aria-hidden /> {s.busy ? "Reading the file…" : "Try with sample data"} <ArrowRight className="size-4" aria-hidden />
              </button>
              <button type="button" onClick={pick} disabled={s.busy} className={secondary}>
                <Upload className="size-[18px] text-teal-700" aria-hidden /> Upload your Excel
              </button>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-600">
              {PROOF.map((p) => (
                <li key={p} className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-approved" aria-hidden /> {p}
                </li>
              ))}
            </ul>
          </div>

          <div className="hero-surface map-grid relative overflow-hidden rounded-3xl border border-ink-200 p-5 shadow-pop sm:p-8" aria-label="Examples of decisions from the sample data">
            <span className="blob" style={{ left: "-8%", top: "6%", width: "50%", height: "46%" }} />
            <span className="blob" style={{ right: "-10%", top: "40%", width: "46%", height: "52%", background: "rgba(15,118,110,.1)" }} />
            <span className="road" style={{ left: "-5%", top: "30%", width: "112%", height: 14, transform: "rotate(-5deg)" }} />
            <span className="road" style={{ left: "-5%", top: "76%", width: "112%", height: 12, transform: "rotate(3deg)" }} />
            <span className="road-soft" style={{ left: "62%", top: "-5%", width: 11, height: "112%", transform: "rotate(7deg)" }} />
            <span className="hero-glow" aria-hidden />

            <span className="tracky relative inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-bold text-teal-800 uppercase shadow-card ring-1 ring-ink-200">
              <LocateFixed className="size-3.5 text-teal-700" aria-hidden /> From the sample data
            </span>
            <div className="relative mt-5 space-y-4">
              <DecisionPreview
                tone="bg-approved-soft text-approved-ink"
                icon={CheckCircle2}
                id="APP-008"
                name="Lakshmi Devi"
                label="Approved"
                score={85}
                line="Approved for 570001 (Mandimohalla), Mysuru. Strong site and finances, 4.3 km from the nearest store."
                className="lg:-translate-x-3"
              />
              <DecisionPreview
                tone="bg-waitlist-soft text-waitlist-ink"
                icon={Clock}
                id="APP-009"
                name="Suresh Patil"
                label="Waitlist"
                score={81}
                line="Only 2.5 km from APP-008's store: a 49% catchment overlap, over the 45% limit. One of them opens, and APP-008 scored higher."
                className="lg:translate-x-4"
              />
              <DecisionPreview
                tone="bg-hold-soft text-hold-ink"
                icon={PauseCircle}
                id="APP-007"
                name="Ramesh Gowda"
                label="On hold"
                score={null}
                line="The form says Mysuru but pin 560034 is in Bengaluru. Held until the applicant confirms which is right."
                className="lg:-translate-x-1"
              />
            </div>
          </div>
        </section>

        {/* Why it's different */}
        <section id="why" className="scroll-mt-20 border-y border-ink-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
            <div className="max-w-2xl">
              <p className="tracky text-[12px] font-bold text-teal-700 uppercase">Rules decide, AI explains</p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">Decisions you can defend in a meeting</h2>
              <p className="mt-4 text-[16px] leading-relaxed text-ink-600">Every number is computed by fixed rules you can read and change. The AI only phrases the explanation and takes your questions; it never makes the call.</p>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {FEATURES.map((f) => (
                <article key={f.title} className="spotlight rounded-2xl border border-ink-200 bg-paper p-6">
                  <span className="relative grid size-11 place-items-center rounded-xl bg-teal-100 text-teal-800">
                    <f.icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="relative mt-5 text-[17px] font-bold text-ink-900">{f.title}</h3>
                  <p className="relative mt-2 text-[14.5px] leading-relaxed text-ink-600">{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Get started: the upload map */}
        <section id="start" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6 lg:px-8 lg:py-20" aria-label="Get started">
          <div className="max-w-2xl">
            <p className="tracky text-[12px] font-bold text-teal-700 uppercase">Get started</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">Bring your file, or try ours</h2>
          </div>
          <div id="how" className="mt-8 grid scroll-mt-20 grid-cols-1 overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card xl:grid-cols-[1.65fr_1fr]">
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
                className={`hero-surface map-grid h-[400px] overflow-hidden transition-shadow sm:h-[440px] xl:h-auto xl:min-h-[460px] xl:flex-1 ${over ? "ring-4 ring-teal-500/40 ring-inset" : ""}`}
              >
                <span className="blob" style={{ left: "-6%", top: "8%", width: "46%", height: "52%" }} />
                <span className="blob" style={{ right: "-8%", top: "30%", width: "44%", height: "58%", background: "rgba(15,118,110,.1)" }} />
                <span className="road" style={{ left: "-5%", top: "34%", width: "112%", height: 14, transform: "rotate(-4deg)" }} />
                <span className="road" style={{ left: "-5%", top: "72%", width: "112%", height: 12, transform: "rotate(3deg)" }} />
                <span className="road-soft" style={{ left: "30%", top: "-5%", width: 12, height: "112%", transform: "rotate(8deg)" }} />
                <span className="road-soft" style={{ left: "70%", top: "-5%", width: 10, height: "112%", transform: "rotate(-6deg)" }} />
                <span className="hero-glow" aria-hidden />

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
                      <button type="button" onClick={pick} disabled={s.busy} className="submit-btn press inline-flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[14px] font-bold">
                        <Upload className="size-4" aria-hidden /> Choose a file
                      </button>
                      <button
                        type="button"
                        onClick={() => void s.loadSample()}
                        disabled={s.busy}
                        className="press mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-ink-200 bg-white py-2.5 text-[14px] font-semibold text-ink-800 hover:bg-teal-50 disabled:opacity-50"
                      >
                        <FlaskConical className="size-4 text-teal-700" aria-hidden /> Try with sample data
                      </button>
                    </div>
                    <a href="/Case1_Franchise_Test_Data_Format.xlsx" download className="relative flex items-center gap-2 border-t border-ink-100 bg-white px-4 py-2.5 text-[13px] font-semibold text-teal-700 transition-colors hover:bg-teal-50">
                      <FileDown className="size-4" aria-hidden /> Download the template
                    </a>
                  </div>
                </div>
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
          </div>
        </section>
      </main>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        aria-label="Choose an Excel file"
        data-testid="file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void s.loadFile(f);
          e.target.value = "";
        }}
      />

      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 px-4 py-6 text-[13px] text-ink-500 sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-teal-700 text-white" aria-hidden>
              <MapPinned className="size-3.5" />
            </span>
            <span className="font-semibold text-ink-700">Franchise Expansion Engine</span>
            <span className="text-ink-300">·</span>
            <span>Rules decide, AI explains</span>
          </div>
          <p>Coordinates are pin-code centres, so distances are estimates. Your data stays in this browser.</p>
        </div>
      </footer>
    </div>
  );
}
