"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, CalendarDays, Check, ClipboardCopy, Lightbulb, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { IdText } from "@/components/id-text";
import { ConfidenceChip, StatusChip } from "@/components/status";
import { TerritoryCard } from "@/components/tabs/territories";
import { runEngine } from "@/lib/engine";
import { postJson } from "@/lib/state/api";
import { coerceValue, FIELD_LABEL, type Change } from "@/lib/engine/changes";
import { draftMessage, type MessageDraft } from "@/lib/engine/message";
import { applyOverrides } from "@/lib/engine/overrides";
import { formatDate, getPin, pinLabel } from "@/lib/engine/reference";
import type { Application, Decision, EditableAppField, Language } from "@/lib/engine/types";
import { useStore } from "@/lib/state/store";

type DrawerTab = "decision" | "plan" | "edit";

const H = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mt-5 mb-2 text-xs font-semibold tracky text-muted-foreground uppercase first:mt-0">{children}</h3>
);

export function DrawerRoot() {
  const s = useStore();
  const open = !!s.drawer;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) s.closeDrawer(); }}>
      <SheetContent className="w-full! max-w-2xl! gap-0 p-0">
        {s.drawer?.kind === "application" && s.result?.decisionById[s.drawer.id] ? <ApplicantPanel key={s.drawer.id} id={s.drawer.id} /> : null}
        {s.drawer?.kind === "territory" ? <TerritoryPanel id={s.drawer.id} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function TerritoryPanel({ id }: { id: string }) {
  const s = useStore();
  const t = s.result?.territories.find((x) => x.id === id);
  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>Territory {id}</SheetTitle>
        <SheetDescription>Slots, who holds them, who is waiting, and which pins are left.</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{t ? <TerritoryCard t={t} /> : <p className="text-sm text-muted-foreground">That territory isn&apos;t in the current file.</p>}</div>
    </>
  );
}

function ApplicantPanel({ id }: { id: string }) {
  const s = useStore();
  const [tab, setTab] = useState<DrawerTab>("decision");
  const base = s.result!.decisionById[id];

  // The table is computed without "what would change it"; for the one applicant on screen we run it.
  const d: Decision = useMemo(() => {
    if (!s.input) return base;
    try {
      return runEngine(s.input, s.assumptions, s.overrides, { today: s.today, simulate: true, simulateFor: [id], throwOnViolation: false }).decisionById[id] ?? base;
    } catch {
      return base;
    }
  }, [s.input, s.assumptions, s.overrides, s.today, id, base]);

  const area = d.pin ? getPin(d.pin)?.area : null;
  const tabs: [DrawerTab, string][] = [["decision", "Decision"], ["plan", "Plan & message"], ["edit", "Edit & history"]];

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle className="text-base">{d.id}</SheetTitle>
          <span className="text-base">{d.name ?? "(no name given)"}</span>
          <StatusChip status={d.status} />
        </div>
        <SheetDescription className="text-sm text-foreground">{d.headline}</SheetDescription>
        <p className="text-xs text-muted-foreground">
          {d.city ?? "?"} · applied for {d.pin ?? "no pin"}
          {area ? ` (${area})` : ""} · {d.tier ? `Tier ${d.tier}` : "tier unknown"} · <ConfidenceChip confidence={d.confidence} />
        </p>
        <div className="-mb-px mt-1 flex gap-1" role="tablist">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`rounded-t-md border-b-2 px-3 py-1.5 text-sm font-medium ${tab === k ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "decision" ? <DecisionTab d={d} /> : null}
        {tab === "plan" ? <PlanTab d={d} /> : null}
        {tab === "edit" ? <EditTab d={d} /> : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Decision tab

function DecisionTab({ d }: { d: Decision }) {
  const s = useStore();
  const [simple, setSimple] = useState<{ text: string; usedFallback: boolean; reason?: string } | null>(null);
  const [simpleBusy, setSimpleBusy] = useState(false);
  const warnings = d.flags.filter((f) => f.severity === "warning" || f.severity === "info");
  return (
    <div>
      <H>Why</H>
      <p className="leading-relaxed"><IdText text={d.whatWouldChange ? d.why.replace(d.whatWouldChange, "").replace(/\s+/g, " ").trim() : d.why} /></p>
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={simpleBusy}
          onClick={async () => {
            setSimpleBusy(true);
            const r = await postJson<{ text: string; usedFallback: boolean; reason?: string }>("/api/chat", {
              mode: "explain",
              explanation: d.why,
              decision: { id: d.id, status: d.status, score: d.score, headline: d.headline },
            });
            setSimple(r.ok ? r.data : { text: d.why, usedFallback: true, reason: r.error });
            setSimpleBusy(false);
          }}
        >
          <Bot /> {simpleBusy ? "Rewriting…" : "Explain simply"}
        </Button>
      </div>
      {simple ? (
        <div className="mt-3 rounded-lg border bg-muted/40 p-3 text-sm" role="status">
          <IdText text={simple.text} />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {simple.usedFallback ? `The AI isn't available, so this is the same explanation as above. ${simple.reason ?? ""}` : "Rewritten by the AI from the explanation above; every number is the engine's."}
          </p>
        </div>
      ) : null}

      {d.whatWouldChange && d.status !== "HOLD" ? (
        <div className="mt-4 flex gap-2 rounded-lg bg-brand-soft p-3 text-sm">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <div><strong>What would change it.</strong> <IdText text={d.whatWouldChange} /></div>
        </div>
      ) : null}

      {d.questionsForApplicant?.length ? (
        <>
          <H>Questions for the applicant</H>
          <ul className="list-disc space-y-1 pl-5">{d.questionsForApplicant.map((q, i) => <li key={i}>{q}</li>)}</ul>
          {d.whatWouldChange ? (
            <div className="mt-3 flex gap-2 rounded-lg bg-brand-soft p-3 text-sm">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              <div><strong>What would change it.</strong> <IdText text={d.whatWouldChange} /></div>
            </div>
          ) : null}
        </>
      ) : null}

      {d.conditions?.length ? (
        <>
          <H>Conditions to close</H>
          <ul className="space-y-1.5">
            {d.conditions.map((c, i) => (
              <li key={i} className="flex gap-2">
                <CalendarDays className="mt-0.5 size-4 shrink-0 text-conditional" aria-hidden />
                <span><strong>by {formatDate(c.deadline)}</strong> ({c.owner}): {c.text}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {d.breakdown.length ? (
        <>
          <H>Score breakdown{d.score !== null ? ` · ${d.score}/100` : ""}</H>
          <ul className="space-y-3">
            {d.breakdown.map((c) => {
              const neg = c.points < 0;
              const pct = Math.min(100, (Math.abs(c.points) / c.max) * 100);
              return (
                <li key={c.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="tabular-nums text-sm">{c.points > 0 && c.key === "signals" ? "+" : ""}{c.points}<span className="text-muted-foreground">/{c.max}</span></span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className={`h-full rounded-full ${neg ? "bg-rejected" : "bg-brand"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{c.reason}</p>
                  {c.signals?.length ? (
                    <ul className="mt-1.5 space-y-1">
                      {c.signals.map((sg, i) => (
                        <li key={i} className="rounded-md bg-muted/60 px-2 py-1 text-xs">
                          <span className="mr-1.5 inline-block rounded bg-brand-soft px-1.5 py-0.5 font-medium text-brand" title={`From the applicant's own words: “${sg.quote}”`}>AI-read</span>
                          {sg.text} <span className="tabular-nums">({sg.impact > 0 ? "+" : ""}{sg.impact})</span>
                          <span className="block text-muted-foreground">“{sg.quote}”</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {d.competitors?.length ? (
        <>
          <H>Competitors and why they won</H>
          <ul className="space-y-1.5">
            {d.competitors.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => s.openApplicant(c.id)} className="font-medium text-brand hover:underline">{c.id}</button>
                <StatusChip status={c.outcome} />
                <span className="text-sm text-muted-foreground">scored {c.whyTheyWon}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {d.cannibalisation.length ? (
        <>
          <H>Nearby stores (cannibalisation)</H>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="px-2 py-1.5 font-medium">Store</th><th className="px-2 py-1.5 font-medium">Distance</th><th className="px-2 py-1.5 font-medium">Catchment overlap</th><th className="px-2 py-1.5 font-medium">Band</th></tr>
              </thead>
              <tbody>
                {d.cannibalisation.map((c, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1.5">{c.storeId}{c.kind === "new" ? " (new)" : ""}</td>
                    <td className="px-2 py-1.5 tabular-nums">{c.km} km</td>
                    <td className="px-2 py-1.5 tabular-nums">{Math.round(c.overlapPct)}%</td>
                    <td className="px-2 py-1.5">{c.band}{c.band === "Blocked" ? " (45% or more)" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Measured from the {d.allocation ? "allocated" : "applied-for"} pin, {d.allocation ? pinLabel(d.allocation.pin) : d.pin}. A mini map arrives with the map view.</p>
        </>
      ) : null}

      {d.payback ? (
        <>
          <H>Payback</H>
          <p>
            About <strong>{Number.isFinite(d.payback.months) ? Math.round(d.payback.months) : "no"}</strong> months.{" "}
            <span className="text-muted-foreground">
              ₹{d.payback.inputs.investmentLakh} lakh set-up ÷ monthly profit of ₹{d.payback.inputs.monthlyProfitLakh.toFixed(2)} lakh (₹{d.payback.inputs.tierRevenueLakh} lakh revenue × floor {d.payback.inputs.floorFactor} × size {d.payback.inputs.sizeFactor} × overlap {d.payback.inputs.overlapFactor.toFixed(2)} × {d.payback.inputs.profitPct}% profit).
            </span>
          </p>
        </>
      ) : null}

      {warnings.length ? (
        <>
          <H>Data notes</H>
          <ul className="space-y-1">
            {warnings.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${f.severity === "warning" ? "bg-waitlist" : "bg-redirect"}`} aria-hidden />
                <IdText text={f.message} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Plan tab

function Gantt({ d }: { d: Decision }) {
  const bars = d.readinessPlan!.timeline;
  const t0 = Date.parse(bars[0].start);
  const t1 = Math.max(...bars.map((b) => Date.parse(b.end)));
  const span = Math.max(1, t1 - t0);
  const pos = (iso: string) => ((Date.parse(iso) - t0) / span) * 100;
  return (
    <div className="space-y-1.5" role="list" aria-label="Timeline to opening">
      {bars.map((b) => {
        const milestone = b.start === b.end;
        const left = pos(b.start);
        const width = Math.max(1.2, pos(b.end) - left);
        const isOpen = b.key === "opening";
        return (
          <div key={b.key} role="listitem" className="grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-2 text-xs sm:grid-cols-[minmax(0,15rem)_1fr]">
            <span className={`truncate ${isOpen ? "font-semibold" : ""}`} title={b.label}>{b.label}</span>
            <div className="relative h-5 rounded bg-muted/50">
              {milestone ? (
                <span className={`absolute top-0.5 size-4 -translate-x-1/2 rotate-45 rounded-[3px] ${isOpen ? "bg-approved" : "bg-brand"}`} style={{ left: `${left}%` }} title={formatDate(b.start)} />
              ) : (
                <span className="absolute top-0.5 h-4 rounded bg-brand/80" style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} title={`${formatDate(b.start)} to ${formatDate(b.end)}`} />
              )}
            </div>
            <span className="sr-only">{formatDate(b.start)}{milestone ? "" : ` to ${formatDate(b.end)}`}</span>
          </div>
        );
      })}
      <div className="grid grid-cols-[minmax(0,11rem)_1fr] gap-2 text-[11px] text-muted-foreground sm:grid-cols-[minmax(0,15rem)_1fr]">
        <span />
        <div className="flex justify-between"><span>{formatDate(bars[0].start)}</span><span>{formatDate(bars[bars.length - 1].end)}</span></div>
      </div>
    </div>
  );
}

function PlanTab({ d }: { d: Decision }) {
  const s = useStore();
  const app = s.result?.input.applications.find((a) => a.id === d.id);
  const [lang, setLang] = useState<Language>(app?.language ?? "English");
  const [copied, setCopied] = useState(false);
  const plan = d.readinessPlan;
  const local = useMemo(() => draftMessage(d, lang), [d, lang]);
  const key = `${d.id}|${lang}|${d.status}|${d.score}|${d.allocation?.pin ?? ""}`;
  const [ai, setAi] = useState<{ key: string; draft: MessageDraft } | null>(null);

  // Kannada and Hindi are written by the AI from the engine's facts; English is built locally. If the AI can't, we show English with a note.
  useEffect(() => {
    if (lang === "English" || ai?.key === key) return;
    let alive = true;
    void postJson<MessageDraft & { usedFallback?: boolean; reason?: string }>("/api/message", { decision: JSON.parse(JSON.stringify(d)), language: lang }).then((r) => {
      if (!alive) return;
      setAi({ key, draft: r.ok ? r.data : { ...draftMessage(d, lang), note: `Translation unavailable right now, so this is the English version. ${r.error}` } });
    });
    return () => {
      alive = false;
    };
  }, [d, key, lang, ai]);

  const loading = lang !== "English" && ai?.key !== key;
  const draft: MessageDraft = lang === "English" ? local : ai?.key === key ? ai.draft : local;

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      {d.nextSteps?.length ? (
        <>
          <H>Next steps (first two weeks)</H>
          <ol className="space-y-2">
            {d.nextSteps.map((st, i) => (
              <li key={i} className="grid grid-cols-[5.5rem_4.5rem_1fr] gap-2 text-sm">
                <span className="font-medium tabular-nums">{formatDate(st.due)}</span>
                <span className={`h-fit w-fit rounded-full px-2 py-0.5 text-xs ${st.owner === "Brand" ? "bg-redirect-soft text-redirect-ink" : "bg-approved-soft text-approved-ink"}`}>{st.owner}</span>
                <span>{st.text}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {plan && !plan.indicative && plan.timeline.length ? (
        <>
          <H>Timeline to opening · {d.plannedOpenDate ? formatDate(d.plannedOpenDate) : ""}</H>
          <Gantt d={d} />
        </>
      ) : null}

      {plan ? (
        <>
          <H>Training plan{plan.indicative ? " (indicative, once a slot is confirmed)" : ""}</H>
          <p className="text-sm">
            <strong>{plan.training.language}</strong> · {plan.training.track} track · {plan.training.totalDays} days. <span className="text-muted-foreground">{plan.training.trackReason}</span>
          </p>
          {plan.training.languageNote ? <p className="text-xs text-muted-foreground">{plan.training.languageNote}</p> : null}
          <ul className="mt-2 divide-y rounded-lg border text-sm">
            {plan.training.modules.map((m, i) => (
              <li key={i} className="flex justify-between gap-3 px-3 py-1.5"><span>{m.name}</span><span className="tabular-nums text-muted-foreground">{m.days} day{m.days === 1 ? "" : "s"}</span></li>
            ))}
          </ul>
          {plan.training.shadowing ? <p className="mt-2 text-sm"><strong>Shadowing:</strong> {plan.training.shadowing.text}</p> : null}
          {plan.training.buddy ? <p className="text-sm"><strong>Buddy partner:</strong> {plan.training.buddy.text}</p> : null}
          <p className="text-sm"><strong>Staff training:</strong> {plan.training.staffTraining.text}{plan.training.staffTraining.start ? ` Starts ${formatDate(plan.training.staffTraining.start)}.` : ""}</p>
          <p className="text-sm text-muted-foreground">{plan.training.materials}</p>
        </>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {d.status === "HOLD" ? "There's no plan until the questions are answered and the application can be decided." : "There's no plan for this applicant as things stand."}
        </p>
      )}

      <H>Message to the applicant</H>
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Message language">
        {(["Kannada", "English", "Hindi"] as Language[]).map((l) => (
          <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${lang === l ? "border-transparent bg-brand text-white" : "text-muted-foreground hover:bg-muted"}`}>
            {l}
          </button>
        ))}
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void copy()}>
          {copied ? <Check /> : <ClipboardCopy />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {loading ? <p className="mb-2 text-xs text-muted-foreground" role="status">Writing it in {lang}…</p> : null}
      {draft.note && !loading ? <p className="mb-2 rounded-md bg-waitlist-soft px-2 py-1 text-xs text-waitlist-ink">{draft.note}</p> : null}
      <pre lang={lang === "Kannada" ? "kn" : lang === "Hindi" ? "hi" : "en"} className="rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap font-sans">{loading ? "" : draft.message}</pre>
      {draft.translated && lang !== "English" && !loading ? (
        <>
          <p className="mt-3 mb-1 text-xs font-semibold tracky text-muted-foreground uppercase">English version, for you to check</p>
          <pre className="rounded-lg border bg-muted/20 p-3 text-sm leading-relaxed whitespace-pre-wrap font-sans">{draft.englishVersion}</pre>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Edit tab

const FIELDS: { key: EditableAppField; kind: "text" | "number" | "select"; options?: string[]; wide?: boolean }[] = [
  { key: "name", kind: "text" },
  { key: "city", kind: "select", options: ["", "Bengaluru", "Mysuru", "Mangaluru", "Hubballi-Dharwad", "Belagavi", "Tumakuru", "Davanagere"] },
  { key: "pin", kind: "text" },
  { key: "investmentLakh", kind: "number" },
  { key: "experienceYears", kind: "number" },
  { key: "spaceAvailable", kind: "select", options: ["", "Owned", "Rented", "Not yet identified", "Identified (ownership unconfirmed)"] },
  { key: "spaceSize", kind: "number" },
  { key: "floor", kind: "select", options: ["", "Ground", "Upper", "Mall unit", "Not known"] },
  { key: "targetLaunchMonths", kind: "number" },
  { key: "language", kind: "select", options: ["", "Kannada", "English", "Hindi"] },
  { key: "business", kind: "text", wide: true },
  { key: "notes", kind: "text", wide: true },
];

function FieldEditor({ app, f, edited }: { app: Application; f: (typeof FIELDS)[number]; edited: boolean }) {
  const s = useStore();
  const current = app[f.key];
  const text = current === null || current === undefined ? "" : String(current);
  const [val, setVal] = useState(text);
  const [err, setErr] = useState<string | null>(null);
  const last = useRef(text);

  function save(raw: string) {
    if (raw.trim() === last.current.trim()) return;
    const r = coerceValue(f.key, raw);
    if (!r.ok) {
      setErr(r.message);
      return;
    }
    setErr(null);
    const entry = s.commit([{ target: "application", id: app.id, field: f.key, value: r.value } as Change], `Edited ${FIELD_LABEL[f.key]} for ${app.id}: ${last.current || "blank"} → ${raw.trim() || "blank"}`, "Inline edit");
    if (entry) last.current = raw.trim();
  }

  const id = `f-${app.id}-${f.key}`;
  const cls = "h-8 w-full rounded-lg border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className={f.wide ? "sm:col-span-2" : ""}>
      <label htmlFor={id} className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {FIELD_LABEL[f.key]} {edited ? <span className="rounded bg-brand-soft px-1 text-[10px] text-brand">edited</span> : null}
      </label>
      {f.kind === "select" ? (
        <select id={id} className={cls} value={val} onChange={(e) => { setVal(e.target.value); save(e.target.value); }}>
          {(f.options ?? []).map((o) => <option key={o} value={o}>{o || "(blank)"}</option>)}
        </select>
      ) : (
        <input
          id={id}
          className={cls}
          inputMode={f.kind === "number" ? "decimal" : undefined}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={(e) => save(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save((e.target as HTMLInputElement).value); } }}
        />
      )}
      {err ? <p className="mt-0.5 text-xs text-rejected-ink" role="alert">{err}</p> : null}
    </div>
  );
}

function EditTab({ d }: { d: Decision }) {
  const s = useStore();
  const [reason, setReason] = useState("");
  const app = useMemo(() => (s.input ? applyOverrides(s.input, s.overrides).applications.find((a) => a.id === d.id) : undefined), [s.input, s.overrides, d.id]);
  if (!app) return null;
  const edits = s.overrides.applications?.[d.id] ?? {};
  const history = s.log.filter((e) => e.fieldDiffs.some((x) => x.id === d.id) || e.statusDiffs.some((x) => x.id === d.id));
  const withdrawn = s.overrides.withdrawn?.[d.id] !== undefined;

  return (
    <div>
      <H>Edit details</H>
      <p className="mb-3 text-sm text-muted-foreground">Changes re-run every decision straight away and are logged, with an Undo. Press Enter or leave the box to save.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => <FieldEditor key={`${d.id}:${f.key}:${String(app[f.key] ?? "")}`} app={app} f={f} edited={f.key in edits} />)}
      </div>

      <H>Withdraw</H>
      {withdrawn ? (
        <p className="text-sm text-muted-foreground">Marked as withdrawn{s.overrides.withdrawn?.[d.id] ? `: ${s.overrides.withdrawn?.[d.id]}` : ""}. Use Undo in the Change log to reverse it.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" aria-label="Reason for withdrawal" className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <Button variant="destructive" size="sm" onClick={() => { s.withdraw(d.id, reason.trim()); setReason(""); }}>
            <UserX /> Mark as withdrawn
          </Button>
        </div>
      )}

      <H>History for {d.id}</H>
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes yet.</p>
      ) : (
        <ul className="space-y-2">
          {history.map((e) => {
            const sd = e.statusDiffs.find((x) => x.id === d.id);
            return (
              <li key={e.id} className={`rounded-lg border p-2.5 text-sm ${e.undone ? "opacity-60" : ""}`}>
                <div className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {e.source}{e.undone ? " · undone" : ""}</div>
                <div className={e.undone ? "line-through" : ""}><IdText text={e.sourceText} /></div>
                {sd ? <div className="mt-1 text-xs">Was: {sd.from.status.toLowerCase()} → Now: {sd.to.status.toLowerCase()}{sd.to.where ? ` (${sd.to.where})` : ""}</div> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
