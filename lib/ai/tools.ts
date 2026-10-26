import { z } from "zod";
import { runEngine } from "../engine";
import type { Assumptions } from "../engine/assumptions";
import { findAssumptionDef, fmtNum, validateAssumptionOrder } from "../engine/assumption-defs";
import {
  applyChange,
  coerceValue,
  diffResults,
  outcomeOf,
  withdrawApplication,
  type Change,
  type FieldDiff,
  type OutcomeDiff,
} from "../engine/changes";
import { componentDiff } from "../engine/explain";
import { parsePinList, parsePriority } from "../engine/normalise";
import { formatDate, pinLabel } from "../engine/reference";
import type { Decision, EditableAppField, EngineInput, EngineResult, NoteReading, NoteSignal, Overrides, Status } from "../engine/types";

// The engine's tools for the chat (AI_PROMPTS §2). The model never decides anything: it asks these tools, which run the
// real engine, and phrases what comes back. The same runtime serves the deterministic fallback, so answers match.

export interface Committed {
  sourceText: string;
  source: "Chat";
  fieldDiffs: FieldDiff[];
  statusDiffs: OutcomeDiff[];
  prev: { overrides: Overrides; assumptions: Assumptions };
}

export interface ToolState {
  input: EngineInput;
  assumptions: Assumptions;
  overrides: Overrides;
  readings: NoteReading[];
  today: string;
  /** State before the latest active change, for "undo". */
  undoTo: { overrides: Overrides; assumptions: Assumptions } | null;
}

const APP_FIELDS: EditableAppField[] = ["investmentLakh", "experienceYears", "business", "spaceAvailable", "spaceSize", "floor", "targetLaunchMonths", "language", "pin", "city", "notes", "name", "state"];

const changeSchema = z.object({
  target: z.enum(["application", "territory"]),
  id: z.string(),
  field: z.string(),
  value: z.union([z.string(), z.number()]).optional(),
  note: z.string().optional(),
});
type RawChange = z.infer<typeof changeSchema>;


function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export function closestIds(id: string, ids: string[], n = 3): string[] {
  return [...ids].sort((a, b) => editDistance(id.toUpperCase(), a) - editDistance(id.toUpperCase(), b)).slice(0, n);
}

const LOAN_SANCTIONED = /loan[^.]*(sanction|approv|clear|disburs|come through)|(sanction|approv)[^.]*loan/i;
const POSITIVE_FACT = /(optometrist|optician|trained|experienced|already (has|have|runs?)|franchise|ready|vacant|available)/i;

/** "APP-12", "app 12" and "APP-012" all mean the same applicant: match exact ID first, then by the number. */
export function looseId(raw: string, ids: string[]): string | undefined {
  const upper = raw.trim().toUpperCase();
  const exact = ids.find((x) => x.toUpperCase() === upper);
  if (exact) return exact;
  const m = upper.match(/^([A-Z]+)[ _-]*0*(\d+)$/);
  if (!m) return undefined;
  return ids.find((x) => x.toUpperCase().startsWith(m[1]) && Number(x.replace(/^[A-Za-z]+[ _-]*0*(\d+).*$/, "$1")) === Number(m[2]) && !x.includes("#"));
}

export class ToolRuntime {
  overrides: Overrides;
  assumptions: Assumptions;
  entries: Committed[] = [];
  private cache: { key: unknown; result: EngineResult } | null = null;

  constructor(public readonly state: ToolState) {
    this.overrides = state.overrides;
    this.assumptions = state.assumptions;
  }

  get changed(): boolean {
    return this.entries.length > 0;
  }

  private compute(overrides: Overrides, assumptions: Assumptions, extra: { simulateFor?: string[] } = {}): EngineResult {
    return runEngine(this.state.input, assumptions, overrides, {
      today: this.state.today,
      readings: this.state.readings,
      simulate: !!extra.simulateFor,
      simulateFor: extra.simulateFor,
      throwOnViolation: false,
    });
  }

  current(): EngineResult {
    const key = `${JSON.stringify(this.overrides)}|${JSON.stringify(this.assumptions)}`;
    if (!this.cache || this.cache.key !== key) this.cache = { key, result: this.compute(this.overrides, this.assumptions) };
    return this.cache.result;
  }

  private unknownApp(id: string) {
    return { error: `There is no applicant ${id}.`, didYouMean: closestIds(id, this.state.input.applications.map((a) => a.id)) };
  }

  /** Run a tool by name. Never throws: a bad call comes back as { error }. */
  run(name: string, args: Record<string, unknown>): unknown {
    try {
      switch (name) {
        case "get_overview": return this.overview();
        case "get_application": return this.getApplication(String(args.id ?? ""));
        case "compare": return this.compare(String(args.idA ?? ""), String(args.idB ?? ""));
        case "get_territory": return this.getTerritory(String(args.id ?? ""));
        case "list_applications": return this.list(args);
        case "what_if": return this.update(args.changes, String(args.sourceText ?? ""), false);
        case "apply_update": return this.update(args.changes, String(args.sourceText ?? ""), true);
        case "withdraw": return this.withdraw(String(args.id ?? ""), String(args.reason ?? ""));
        case "update_territory": return this.updateTerritory(args);
        case "set_assumption": return this.setAssumption(String(args.key ?? ""), Number(args.value));
        case "undo": return this.undo();
        default: return { error: `Unknown tool ${name}.` };
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : "The tool failed." };
    }
  }

  // ---------------------------------------------------------------- read tools

  overview() {
    const r = this.current();
    return {
      applicants: r.decisions.length,
      counts: r.counts,
      placementRules: r.invariants.ok ? "All 6 placement rules verified" : "VIOLATED",
      territories: r.territories.map((t) => ({
        id: t.id, city: t.city, tier: t.tier, priority: t.priority, openSlots: t.openSlots, filled: t.allocated.length, free: t.freeSlots,
        allocated: t.allocated, waitlist: t.waitlist, whyUnfilled: t.insight?.reasons,
      })),
      dataAlerts: r.alerts.map((a) => ({ severity: a.severity, message: a.message })),
      needsAttention: r.decisions.filter((d) => d.status === "HOLD").map((d) => ({ id: d.id, name: d.name, questions: d.questionsForApplicant })),
    };
  }

  private brief(d: Decision) {
    const o = outcomeOf(d);
    return { id: d.id, name: d.name, status: d.status, score: d.score, where: o.where, headline: d.headline };
  }

  getApplication(id: string) {
    const appId = looseId(id, this.state.input.applications.map((a) => a.id));
    const app = this.state.input.applications.find((a) => a.id === appId);
    if (!app) return this.unknownApp(id);
    id = app.id;
    const r = this.compute(this.overrides, this.assumptions, { simulateFor: [id] });
    const d = r.decisionById[id];
    return {
      ...this.brief(d),
      why: d.why,
      confidence: d.confidence,
      whatWouldChange: d.whatWouldChange,
      scoreBreakdown: d.breakdown.map((c) => ({ component: c.name, points: c.points, max: c.max, reason: c.reason })),
      flags: d.flags.filter((f) => f.severity !== "info").map((f) => ({ severity: f.severity, message: f.message })),
      conditions: d.conditions?.map((c) => ({ text: c.text, deadline: formatDate(c.deadline) })),
      questionsForApplicant: d.questionsForApplicant,
      competitors: d.competitors?.map((c) => ({ id: c.id, score: c.score, outcome: c.outcome, whyTheyWon: c.whyTheyWon })),
      nearbyStores: d.cannibalisation.slice(0, 3).map((c) => ({ store: c.storeId, km: c.km, overlapPct: Math.round(c.overlapPct), band: c.band })),
      payback: d.payback && Number.isFinite(d.payback.months) ? { months: Math.round(d.payback.months), inputs: d.payback.inputs } : undefined,
      plannedOpening: d.plannedOpenDate ? formatDate(d.plannedOpenDate) : undefined,
      nextSteps: d.nextSteps?.map((s) => ({ due: formatDate(s.due), owner: s.owner, text: s.text })),
      training: d.readinessPlan
        ? {
            indicativeOnly: d.readinessPlan.indicative,
            language: d.readinessPlan.training.language,
            track: d.readinessPlan.training.track,
            why: d.readinessPlan.training.trackReason,
            totalDays: d.readinessPlan.training.totalDays,
            modules: d.readinessPlan.training.modules.map((m) => `${m.name} (${m.days} days)`),
            shadowing: d.readinessPlan.training.shadowing?.text,
            buddy: d.readinessPlan.training.buddy?.text,
            staffTraining: d.readinessPlan.training.staffTraining.text,
          }
        : undefined,
      rawRow: app.raw,
    };
  }

  compare(idA: string, idB: string) {
    const r = this.current();
    const ids = this.state.input.applications.map((x) => x.id);
    const a = r.decisionById[looseId(idA, ids) ?? idA];
    const b = r.decisionById[looseId(idB, ids) ?? idB];
    if (!a) return this.unknownApp(idA);
    if (!b) return this.unknownApp(idB);
    const higher = (a.score ?? -1) >= (b.score ?? -1) ? a : b;
    const lower = higher === a ? b : a;
    return {
      a: { ...this.brief(a), components: a.breakdown.map((c) => ({ name: c.name, points: c.points, max: c.max })) },
      b: { ...this.brief(b), components: b.breakdown.map((c) => ({ name: c.name, points: c.points, max: c.max })) },
      higherScore: higher.id,
      componentDifference: `${higher.id} vs ${lower.id}: ${componentDiff(higher.breakdown, lower.breakdown)}`,
      sameTerritory: a.allocation?.territoryId === b.allocation?.territoryId || a.ownTerritoryId === b.ownTerritoryId,
      competitorNotes: [...(a.competitors ?? []).filter((c) => c.id === idB), ...(b.competitors ?? []).filter((c) => c.id === idA)].map((c) => c.whyTheyWon),
    };
  }

  getTerritory(id: string) {
    const r = this.current();
    const tid = looseId(id, r.territories.map((x) => x.id));
    const t = r.territories.find((x) => x.id === tid);
    if (!t) return { error: `There is no territory ${id}.`, didYouMean: closestIds(id, r.territories.map((x) => x.id)) };
    const wantsHere = r.decisions.filter((d) => d.ownTerritoryId === t.id || d.allocation?.territoryId === t.id);
    return {
      id: t.id, city: t.city, tier: t.tier, priority: t.priority, openSlots: t.openSlots, filled: t.allocated.length, free: t.freeSlots,
      allocated: t.allocated.map((x) => this.brief(r.decisionById[x])),
      waitlist: t.waitlist.map((x) => this.brief(r.decisionById[x])),
      applicantsWhoAppliedHere: wantsHere.map((d) => this.brief(d)),
      viablePinsLeft: t.viablePins.map(pinLabel),
      whyUnfilled: t.insight?.reasons,
      flags: t.flags.filter((f) => f.severity !== "info").map((f) => f.message),
    };
  }

  list(args: Record<string, unknown>) {
    const r = this.current();
    const status = args.status ? String(args.status).toUpperCase() : null;
    const ter = args.territoryId ? String(args.territoryId).toUpperCase() : null;
    const city = args.city ? String(args.city).toLowerCase() : null;
    const rows = r.decisions.filter(
      (d) => (!status || d.status === status) && (!ter || d.ownTerritoryId?.toUpperCase() === ter || d.allocation?.territoryId.toUpperCase() === ter) && (!city || (d.city ?? "").toLowerCase() === city)
    );
    return { count: rows.length, applicants: rows.map((d) => this.brief(d)) };
  }

  /** Every applicant currently planned at a pin that already has an existing store (should always be none). */
  storeConflicts() {
    const r = this.current();
    const storePins = new Map(r.input.existingStores.map((s) => [s.pin, s.id]));
    return r.decisions.filter((d) => d.allocation && storePins.has(d.allocation.pin)).map((d) => ({ id: d.id, pin: d.allocation!.pin, store: storePins.get(d.allocation!.pin) }));
  }

  // ---------------------------------------------------------------- write tools

  private toChanges(raw: unknown, sourceText: string): { changes: Change[]; skipped: string[]; notes: string[] } {
    const list = z.array(changeSchema).safeParse(raw);
    if (!list.success) return { changes: [], skipped: ["The changes weren't in the expected format."], notes: [] };
    const changes: Change[] = [];
    const skipped: string[] = [];
    const notes: string[] = [];
    for (const c of list.data) this.oneChange(c, sourceText, changes, skipped, notes);
    return { changes, skipped, notes };
  }

  private oneChange(c: RawChange, sourceText: string, out: Change[], skipped: string[], notes: string[]) {
    const eff = this.state.input;
    if (c.target === "territory") {
      const tid = looseId(c.id, eff.territories.map((x) => x.id));
      const t = eff.territories.find((x) => x.id === tid);
      if (!t) return void skipped.push(`There is no territory ${c.id}.`);
      if (c.field === "openSlots") {
        const n = Number(c.value);
        if (!Number.isInteger(n) || n < 0) return void skipped.push(`${t.id}: open slots must be a whole number, 0 or more.`);
        out.push({ target: "territory", id: t.id, field: "openSlots", value: n });
      } else if (c.field === "priority") {
        const p = parsePriority(c.value);
        if (!p.value) return void skipped.push(`${t.id}: priority must be High, Medium or Low.`);
        out.push({ target: "territory", id: t.id, field: "priority", value: p.value });
      } else if (c.field === "pins") {
        const pins = parsePinList(String(c.value ?? "")).pins;
        if (!pins.length) return void skipped.push(`${t.id}: no valid 6-digit pins given.`);
        out.push({ target: "territory", id: t.id, field: "pins", value: pins });
      } else skipped.push(`${t.id}: can't change ${c.field}.`);
      return;
    }
    const aid = looseId(c.id, eff.applications.map((x) => x.id));
    const app = eff.applications.find((a) => a.id === aid);
    if (!app) return void skipped.push(`There is no applicant ${c.id}.`);
    if (c.field === "withdraw" || c.field === "withdrawn") {
      out.push({ target: "application", id: app.id, field: "withdraw", value: String(c.value ?? "") });
      return;
    }
    if (c.field === "addSignal") {
      const text = String(c.value ?? "").trim();
      if (!text) return void skipped.push(`${app.id}: nothing to add.`);
      if (LOAN_SANCTIONED.test(text) || LOAN_SANCTIONED.test(sourceText)) {
        out.push({ target: "application", id: app.id, field: "resolve", value: "LOAN_DEPENDENT" });
        notes.push(`${app.id}: the loan condition is treated as closed on the strength of what you said; the sanction letter itself is still worth collecting.`);
      } else {
        const sig: NoteSignal = { type: POSITIVE_FACT.test(text) ? "green" : "info", impact: POSITIVE_FACT.test(text) ? 1 : 0, text: text.slice(0, 160), quote: (sourceText || text).slice(0, 200) };
        out.push({ target: "application", id: app.id, field: "addSignal", value: sig });
      }
      return;
    }
    if (!APP_FIELDS.includes(c.field as EditableAppField)) return void skipped.push(`${app.id}: can't change “${c.field}”.`);
    const v = coerceValue(c.field as EditableAppField, String(c.value ?? ""));
    if (!v.ok) return void skipped.push(`${app.id} ${c.field}: ${v.message}`);
    out.push({ target: "application", id: app.id, field: c.field as EditableAppField, value: v.value } as Change);
    if (c.field === "spaceAvailable" && v.value === "Identified (ownership unconfirmed)") notes.push(`${app.id}: whether the space is owned or rented wasn't stated, so it is marked “Identified (ownership unconfirmed)” and scored like a rented space.`);
  }

  private describeUpdate(changes: Change[], before: EngineResult, after: EngineResult, committed: boolean) {
    const ids = [...new Set(changes.map((c) => c.id).filter((id) => id.startsWith("APP")))];
    const primaryId = ids[0];
    const diffs = diffResults(before, after, ids);
    const primary = primaryId && after.decisionById[primaryId] ? after.decisionById[primaryId] : null;
    const prev = primaryId ? before.decisionById[primaryId] : null;
    return {
      committed,
      primary: primary && prev
        ? {
            id: primary.id,
            name: primary.name,
            before: outcomeOf(prev),
            after: outcomeOf(primary),
            headlineAfter: primary.headline,
            whyAfter: primary.why,
            scoreByComponent: primary.breakdown.map((c) => ({ component: c.name, before: prev.breakdown.find((x) => x.key === c.key)?.points ?? null, after: c.points })),
          }
        : null,
      knockOn: diffs.filter((d) => d.id !== primaryId).map((d) => ({ id: d.id, name: d.name, from: d.from, to: d.to })),
      stillNeeded: primary ? (primary.conditions ?? []).map((c) => `${c.text} (by ${formatDate(c.deadline)})`).concat(primary.status === "HOLD" ? (primary.questionsForApplicant ?? []) : []) : [],
    };
  }

  private update(raw: unknown, sourceText: string, commit: boolean) {
    const { changes, skipped, notes } = this.toChanges(raw, sourceText);
    if (!changes.length) return { committed: false, applied: [], skipped, error: skipped[0] ?? "Nothing to change." };
    let ov = this.overrides;
    const diffs: FieldDiff[] = [];
    for (const ch of changes) {
      const r = applyChange(this.state.input, ov, ch);
      if (r) {
        ov = r.overrides;
        diffs.push(r.diff);
      }
    }
    if (!diffs.length) return { committed: false, applied: [], skipped, note: "That is already how it is, so nothing changed." };
    const before = this.current();
    const after = this.compute(ov, this.assumptions);
    const body = this.describeUpdate(changes, before, after, commit);
    if (commit) {
      this.entries.push({
        sourceText: sourceText || "Chat update",
        source: "Chat",
        fieldDiffs: diffs,
        statusDiffs: diffResults(before, after, [...new Set(changes.map((c) => c.id))]),
        prev: { overrides: this.overrides, assumptions: this.assumptions },
      });
      this.overrides = ov;
    }
    return { ...body, applied: diffs.map((d) => ({ id: d.id, field: d.label, from: d.from, to: d.to })), skipped, assumptions: notes, nothingCommitted: commit ? undefined : "This was a what-if: no change was made." };
  }

  private withdraw(id: string, reason: string) {
    const wid = looseId(id, this.state.input.applications.map((x) => x.id));
    const app = this.state.input.applications.find((a) => a.id === wid);
    if (!app) return this.unknownApp(id);
    const r = withdrawApplication(this.state.input, this.overrides, app.id, reason);
    if (!r) return { committed: false, note: `${app.id} is already withdrawn.` };
    const before = this.current();
    const after = this.compute(r.overrides, this.assumptions);
    const body = this.describeUpdate([{ target: "application", id: app.id, field: "name", value: app.name } as Change], before, after, true);
    this.entries.push({ sourceText: `${app.id} withdrawn${reason ? `: ${reason}` : ""}`, source: "Chat", fieldDiffs: [r.diff], statusDiffs: diffResults(before, after, [app.id]), prev: { overrides: this.overrides, assumptions: this.assumptions } });
    this.overrides = r.overrides;
    return { ...body, applied: [{ id: app.id, field: "Status", from: "active", to: `withdrawn${reason ? `: ${reason}` : ""}` }], skipped: [] };
  }

  private updateTerritory(args: Record<string, unknown>) {
    const id = String(args.id ?? "");
    const ch = (args.changes ?? {}) as Record<string, unknown>;
    const raw = Object.entries(ch).map(([field, value]) => ({ target: "territory", id, field, value }));
    return this.update(raw, String(args.sourceText ?? `Updated ${id}`), true);
  }

  private setAssumption(key: string, value: number) {
    const def = findAssumptionDef(key);
    if (!def) return { error: `Unknown assumption “${key}”. Examples: catchmentKm.2, approveScore, investmentNeedLakh.1.` };
    if (!Number.isFinite(value) || value < def.min || (def.max !== undefined && value > def.max)) return { error: `${def.label} must be between ${def.min} and ${def.max ?? "any"} ${def.unit}.` };
    const before = this.current();
    const old = def.get(this.assumptions);
    if (old === value) return { committed: false, note: `${def.label} is already ${fmtNum(value)} ${def.unit}.` };
    const next = def.set(this.assumptions, value);
    const bad = validateAssumptionOrder(next);
    if (bad) return { error: bad };
    const after = this.compute(this.overrides, next);
    const diff: FieldDiff = { target: "assumption", id: "", field: def.id, label: def.label, from: `${fmtNum(old)} ${def.unit}`, to: `${fmtNum(value)} ${def.unit}` };
    const statusDiffs = diffResults(before, after);
    this.entries.push({ sourceText: `Changed assumption “${def.label}” from ${fmtNum(old)} to ${fmtNum(value)} ${def.unit}`, source: "Chat", fieldDiffs: [diff], statusDiffs, prev: { overrides: this.overrides, assumptions: this.assumptions } });
    this.assumptions = next;
    return { committed: true, applied: [{ id: "", field: def.label, from: diff.from, to: diff.to }], knockOn: statusDiffs.map((d) => ({ id: d.id, name: d.name, from: d.from, to: d.to })), decisionsChanged: statusDiffs.length };
  }

  private undo() {
    const target = this.entries.length ? this.entries[this.entries.length - 1].prev : this.state.undoTo;
    if (!target) return { error: "There's nothing to undo." };
    const before = this.current();
    const after = this.compute(target.overrides, target.assumptions);
    const statusDiffs = diffResults(before, after);
    this.entries.push({ sourceText: "Undid the last change", source: "Chat", fieldDiffs: [{ target: "assumption", id: "", field: "undo", label: "Undo", from: "changed", to: "restored" }], statusDiffs, prev: { overrides: this.overrides, assumptions: this.assumptions } });
    this.overrides = target.overrides;
    this.assumptions = target.assumptions;
    return { committed: true, restored: true, knockOn: statusDiffs.map((d) => ({ id: d.id, name: d.name, from: d.from, to: d.to })) };
  }
}

// ---------------------------------------------------------------- declarations for Gemini

const str = (description: string) => ({ type: "string", description });
const changeItem = {
  type: "object",
  properties: {
    target: { type: "string", enum: ["application", "territory"] },
    id: str("APP-012 or TER-07"),
    field: str("Application: investmentLakh, experienceYears, business, spaceAvailable, spaceSize, floor, targetLaunchMonths, language, pin, city, notes, addSignal, withdrawn (value = reason). Territory: openSlots, priority, pins"),
    value: { type: "string", description: "The new value exactly as stated. spaceAvailable: Owned, Rented, Not yet identified, or Identified (ownership unconfirmed). floor: Ground, Upper, Mall unit, Not known. For addSignal, a short sentence of the fact." },
    note: str("Optional note"),
  },
  required: ["target", "id", "field", "value"],
};

export const TOOL_DECLARATIONS = [
  { name: "get_overview", description: "Counts by status, slots per territory, unfilled-slot reasons, data alerts, and applications on hold.", parametersJsonSchema: { type: "object", properties: {} } },
  { name: "get_application", description: "Everything about one applicant: decision, why, score breakdown, competitors, conditions, payback, next steps, training plan, what would change the decision, and the raw row.", parametersJsonSchema: { type: "object", properties: { id: str("Application ID, e.g. APP-012") }, required: ["id"] } },
  { name: "compare", description: "Compare two applicants component by component and say who wins what.", parametersJsonSchema: { type: "object", properties: { idA: str("First application ID"), idB: str("Second application ID") }, required: ["idA", "idB"] } },
  { name: "get_territory", description: "A territory's slots, who holds them, who is waiting, viable pins left and why slots are unfilled.", parametersJsonSchema: { type: "object", properties: { id: str("Territory ID, e.g. TER-07") }, required: ["id"] } },
  { name: "list_applications", description: "List applicants, optionally filtered.", parametersJsonSchema: { type: "object", properties: { status: str("APPROVED, CONDITIONAL, REDIRECT, WAITLIST, HOLD or REJECTED"), territoryId: str("Territory ID"), city: str("City name") } } },
  { name: "what_if", description: "Simulate changes WITHOUT committing them, and report the new decision and every knock-on change. Use when the user asks 'what if'.", parametersJsonSchema: { type: "object", properties: { changes: { type: "array", items: changeItem }, sourceText: str("The user's words") }, required: ["changes"] } },
  { name: "apply_update", description: "Commit new information the user states about an applicant or territory. Only include fields the user actually stated.", parametersJsonSchema: { type: "object", properties: { changes: { type: "array", items: changeItem }, sourceText: str("The user's exact words") }, required: ["changes", "sourceText"] } },
  { name: "withdraw", description: "Record that an applicant has withdrawn.", parametersJsonSchema: { type: "object", properties: { id: str("Application ID"), reason: str("Reason, if given") }, required: ["id"] } },
  { name: "update_territory", description: "Change a territory's open slots, priority or pins.", parametersJsonSchema: { type: "object", properties: { id: str("Territory ID"), changes: { type: "object", properties: { openSlots: { type: "string" }, priority: { type: "string" }, pins: { type: "string" } } }, sourceText: str("The user's words") }, required: ["id", "changes"] } },
  { name: "set_assumption", description: "Change one of the brand's assumptions, such as catchmentKm.2 (Tier 2 catchment radius in km), approveScore, slotMinScore, investmentNeedLakh.1, paybackFlagMonths.", parametersJsonSchema: { type: "object", properties: { key: str("Assumption key, e.g. catchmentKm.2"), value: { type: "number" } }, required: ["key", "value"] } },
  { name: "undo", description: "Undo the most recent committed change.", parametersJsonSchema: { type: "object", properties: {} } },
];

export type { Status };
