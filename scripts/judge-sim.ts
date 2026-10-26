import { readFileSync } from "node:fs";
import { DEFAULT_ASSUMPTIONS, runEngine, type Assumptions } from "../lib/engine";
import { parseWorkbook } from "../lib/engine/parse";
import type { Overrides } from "../lib/engine/types";

// docs/TEST_PLAN.md §3 against a running app. Usage: tsx scripts/judge-sim.ts <base-url> [--force-fallback] [--steps 1,9,12,16]
// Loads the sample file the way "Load sample data" does, then sends each message to /api/chat carrying state forward as the browser does.

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith("http")) ?? "http://localhost:3000").replace(/\/$/, "");
const force = args.includes("--force-fallback");
const stepsArg = args[args.indexOf("--steps") + 1];
const only = args.includes("--steps") && stepsArg ? new Set(stepsArg.split(",").map(Number)) : null;
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

type Entry = { sourceText?: string; prev: unknown; undone?: boolean };
type Reply = { reply: string; usedFallback: boolean; reason?: string; newOverrides?: Overrides; newAssumptions?: Assumptions; entries?: Entry[] };
type Dec = { id: string; status: string; pin?: string | null; headline?: string; allocation?: { pin?: string } | null };

interface Step {
  n: number;
  q: string;
  /** Extra state-based expectation (authoritative; independent of the AI's wording). */
  check: (ctx: Ctx) => string[];
}
interface Ctx { reply: string; r: Reply; before: Map<string, Dec>; after: Map<string, Dec>; ov: Overrides; prevOv: Overrides; asm: Assumptions }

const miss = (re: RegExp, text: string, label: string) => (re.test(text) ? [] : [`reply lacks ${label}`]);
const st = (m: Map<string, Dec>, id: string) => m.get(id)?.status ?? "?";

const STEPS: Step[] = [
  { n: 1, q: "Why is APP-007 on hold?", check: (c) => [...miss(/APP-007/, c.reply, "APP-007"), ...miss(/Mysuru/i, c.reply, "Mysuru"), ...miss(/Bengaluru|560/i, c.reply, "the Bengaluru pin"), ...miss(/hold/i, c.reply, "'hold'")] },
  { n: 2, q: "Why is APP-009 not approved?", check: (c) => [...miss(/APP-009/, c.reply, "APP-009"), ...miss(/APP-008/, c.reply, "APP-008 (the rival)"), ...miss(/overlap|catchment|km|%/i, c.reply, "the overlap reason")] },
  { n: 3, q: "Why did APP-002 get 560095 and not APP-003?", check: (c) => [...miss(/APP-002/, c.reply, "APP-002"), ...miss(/APP-003/, c.reply, "APP-003"), ...miss(/scor|ahead|higher|behind/i, c.reply, "a score comparison")] },
  { n: 4, q: "What does APP-008 need to do next?", check: (c) => [...miss(/letter of intent|LOI/i, c.reply, "letter of intent"), ...miss(/KYC/i, c.reply, "KYC"), ...miss(/site audit/i, c.reply, "site audit")] },
  { n: 5, q: "How will APP-006 be trained?", check: (c) => [...miss(/English/i, c.reply, "English training"), ...miss(/bootcamp|ST-02|training store/i, c.reply, "bootcamp / training store")] },
  { n: 6, q: "Which territories have unfilled slots, and why?", check: (c) => [...miss(/TER-05/, c.reply, "TER-05"), ...miss(/No viable pin|no (viable|eligible)/i, c.reply, "why TER-05 is unfilled")] },
  { n: 7, q: "Is any new store planned in a pin that already has a store?", check: (c) => miss(/^\W*(\*\*)?\W*No\b|\bno new store|none|not planned/i, c.reply, "a plain 'No'") },
  { n: 8, q: "What's APP-017's payback period?", check: (c) => miss(/31\s*months?/i, c.reply, "31 months") },
  {
    n: 9,
    q: "APP-012 has now found a ground-floor space",
    check: (c) => [
      ...(c.ov.applications?.["APP-012"]?.floor === "Ground" ? [] : ["floor not set to Ground for APP-012"]),
      ...(st(c.before, "APP-012") === "WAITLIST" ? [] : [`APP-012 before: ${st(c.before, "APP-012")} (expected WAITLIST)`]),
      ...(["APPROVED", "CONDITIONAL"].includes(st(c.after, "APP-012")) ? [] : [`APP-012 after: ${st(c.after, "APP-012")} (expected CONDITIONAL)`]),
      ...(st(c.after, "APP-013") === "WAITLIST" ? [] : [`APP-013 after: ${st(c.after, "APP-013")} (expected WAITLIST)`]),
      ...miss(/changed|updated/i, c.reply, "what changed"),
      ...miss(/assum/i, c.reply, "what was assumed"),
      ...miss(/APP-013/, c.reply, "the knock-on on APP-013"),
      ...miss(/still needed|needs?|confirm|ownership|size/i, c.reply, "what is still needed"),
    ],
  },
  { n: 10, q: "APP-030's investment is actually 30 lakh", check: (c) => [...(c.ov.applications?.["APP-030"]?.investmentLakh === 30 ? [] : ["investmentLakh not set to 30"]), ...(st(c.after, "APP-030") !== "HOLD" ? [] : ["APP-030 is still on HOLD"])] },
  { n: 11, q: "APP-010 has moved to a ground-floor unit of 400 sq ft", check: (c) => { const o = c.ov.applications?.["APP-010"]; return [...(o?.floor === "Ground" ? [] : ["floor not Ground"]), ...(o?.spaceSize === 400 ? [] : ["spaceSize not 400"])]; } },
  { n: 12, q: "APP-002 has withdrawn", check: (c) => [...(c.ov.withdrawn && "APP-002" in c.ov.withdrawn ? [] : ["APP-002 not recorded as withdrawn"]), ...miss(/APP-002/, c.reply, "APP-002"), ...(st(c.after, "APP-002") !== st(c.before, "APP-002") ? [] : ["APP-002's status did not change"])] },
  { n: 13, q: "TER-03 now has 2 open slots", check: (c) => (c.ov.territories?.["TER-03"]?.openSlots === 2 ? [] : ["TER-03 openSlots not 2"]) },
  { n: 14, q: "APP-033's bank loan was sanctioned", check: (c) => [...(c.ov.resolved?.["APP-033"]?.includes("LOAN_DEPENDENT") ? [] : ["LOAN_DEPENDENT not resolved for APP-033"]), ...(st(c.after, "APP-033") === "APPROVED" ? [] : [`APP-033 after: ${st(c.after, "APP-033")} (expected APPROVED)`])] },
  { n: 15, q: "What if APP-014 found a co-investor and can invest 30 lakh?", check: (c) => [...(JSON.stringify(c.ov) === JSON.stringify(c.prevOv) ? [] : ["state was changed by a what-if"]), ...(c.r.entries?.length ? ["a change-log entry was committed"] : []), ...miss(/APP-014/, c.reply, "APP-014"), ...miss(/nothing|no changes|not (been )?(changed|applied|saved|committed)|simulat|hypothetical|what.?if|would/i, c.reply, "'nothing changed' wording")] },
  { n: 16, q: "Tell me about APP-999", check: (c) => [...miss(/no applicant|doesn.t exist|does not exist|not found|couldn.t find|no such/i, c.reply, "a 'doesn't exist' message"), ...(c.r.entries?.length ? ["a change was committed"] : [])] },
  { n: 17, q: "Undo the last change", check: (c) => [...(JSON.stringify(c.ov) !== JSON.stringify(c.prevOv) ? [] : ["state unchanged by undo"]), ...(c.ov.resolved?.["APP-033"] ? ["the loan change (latest) was not undone"] : [])] },
];

async function main() {
  // "Load sample data": fetch the file the app serves, parse it with the same parser.
  let bytes: Uint8Array;
  try {
    const res = await fetch(`${base}/sample/Stress_Test_Case1.xlsx`);
    if (!res.ok) throw new Error(String(res.status));
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    bytes = new Uint8Array(readFileSync("public/sample/Stress_Test_Case1.xlsx"));
  }
  const parsed = parseWorkbook(bytes);
  const input = parsed.input;
  const decide = (ov: Overrides, asm: Assumptions) => new Map<string, Dec>(runEngine(input, asm, ov, { today, simulate: false, throwOnViolation: false }).decisions.map((d) => [d.id, d as unknown as Dec]));

  let overrides: Overrides = {};
  let assumptions: Assumptions = DEFAULT_ASSUMPTIONS;
  const history: { role: "user" | "assistant"; text: string }[] = [];
  const log: Entry[] = [];
  const rows: { n: number; q: string; verdict: string; mode: string; summary: string; changes: string; fails: string[] }[] = [];

  console.log(`\n=== judge-sim: ${base}  mode=${force ? "forced rules-only (x-force-fallback: 1)" : "normal"}  today=${today} ===`);
  console.log(`Loaded sample: ${input.applications.length} applicants, ${input.territories.length} territories\n`);

  for (const step of STEPS) {
    // State must be carried through every step, even those we don't report, so run all but print only the selected ones.
    const active = log.filter((e) => !e.undone);
    const undoTo = active.length ? active[active.length - 1].prev : null;
    history.push({ role: "user", text: step.q });
    const before = decide(overrides, assumptions);
    const prevOv = overrides;
    let r: Reply;
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(force ? { "x-force-fallback": "1" } : {}) },
        body: JSON.stringify({ messages: history, state: { input, overrides, assumptions, readings: [], undoTo, today } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      r = (await res.json()) as Reply;
    } catch (e) {
      console.log(`${step.n}. ${step.q}\n   FAIL: ${(e as Error).message}\n`);
      rows.push({ n: step.n, q: step.q, verdict: "FAIL", mode: "-", summary: "", changes: "", fails: [(e as Error).message] });
      history.pop();
      continue;
    }
    if (r.newOverrides) overrides = r.newOverrides;
    if (r.newAssumptions) assumptions = r.newAssumptions;
    if (r.entries) {
      if (r.entries.some((e) => e.sourceText === "Undid the last change")) {
        const idx = [...log].reverse().findIndex((e) => !e.undone);
        if (idx >= 0) log[log.length - 1 - idx].undone = true;
      } else log.push(...r.entries);
    }
    history.push({ role: "assistant", text: r.reply });
    const after = decide(overrides, assumptions);

    if (only && !only.has(step.n)) continue;

    const fails = step.check({ reply: r.reply, r, before, after, ov: overrides, prevOv, asm: assumptions });
    // Mode expectation: forced → rules-only on non-production; on production the header must be ignored (AI on).
    const isProd = !/localhost|127\.0\.0\.1/.test(base);
    const wantFallback = force && !isProd;
    if (wantFallback && !r.usedFallback) fails.push("expected rules-only (usedFallback:true) but AI answered");
    if (force && isProd && r.usedFallback) fails.push("production should ignore x-force-fallback, but the fallback was used");
    if (!force && r.usedFallback) fails.push(`expected AI but fallback was used${r.reason ? ` (${r.reason})` : ""}`);

    const changed: string[] = [];
    for (const [id, d] of after) { const b = before.get(id); if (b && b.status !== d.status) changed.push(`${id} ${b.status}→${d.status}`); }
    for (const [id, d] of after) { const b = before.get(id); if (b && b.status === d.status && (b.allocation?.pin ?? null) !== (d.allocation?.pin ?? null) && true) changed.push(`${id} pin ${b.allocation?.pin ?? b.pin}→${d.allocation?.pin ?? d.pin}`); }
    const full = !!process.env.FULL;
    const summary = full ? r.reply : r.reply.replace(/\s+/g, " ").replace(/\*\*/g, "").slice(0, 230);
    const verdict = fails.length ? "FAIL" : "PASS";
    const mode = r.usedFallback ? "rules" : "AI";
    rows.push({ n: step.n, q: step.q, verdict, mode, summary, changes: changed.join("; "), fails });
    console.log(`${step.n}. ${step.q}\n   [${mode}] ${verdict} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n   reply: ${summary}${!full && r.reply.length > 230 ? "…" : ""}`);
    if (changed.length) console.log(`   status changes: ${changed.join("; ")}`);
    if (fails.length) console.log(`   FAILS: ${fails.join(" | ")}`);
    console.log();
  }

  console.log("| # | Step | Mode | Result |\n|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.n} | ${r.q} | ${r.mode} | ${r.verdict}${r.fails.length ? ` — ${r.fails.join("; ")}` : ""} |`);
  const bad = rows.filter((r) => r.verdict === "FAIL").length;
  console.log(`\n${rows.length - bad}/${rows.length} passed`);
}
main();
