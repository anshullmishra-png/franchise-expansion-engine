// Runs the engine on a workbook and prints status, score and allocation per applicant.
// Usage: npm run engine [path-to-xlsx] [--why APP-012]
import { readFileSync } from "node:fs";
import { runEngine } from "../lib/engine";
import { parseWorkbook } from "../lib/engine/parse";

const args = process.argv.slice(2);
const whyIdx = args.indexOf("--why");
const why = whyIdx >= 0 ? args.splice(whyIdx, 2)[1] : null;
const file = args[0] ?? "test-data/Stress_Test_Case1.xlsx";

const parsed = parseWorkbook(readFileSync(file));
const res = runEngine(parsed.input, undefined, undefined, { today: "2026-10-25" });

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
console.log(`\n${file}  (today 2026-10-25)`);
console.log(`${pad("ID", 9)}${pad("Name", 19)}${pad("Applied", 8)}${pad("Status", 12)}${pad("Score", 7)}${pad("Eff", 5)}${pad("Placed at", 22)}${pad("Payback", 8)}Conf`);
for (const d of res.decisions) {
  const al = d.allocation ? `${d.allocation.pin} ${d.allocation.territoryId}` : d.waitlistRank ? `wait ${d.waitlistRank.territoryId} #${d.waitlistRank.rank}` : "-";
  console.log(
    `${pad(d.id, 9)}${pad(d.name ?? "(blank)", 19)}${pad(d.pin ?? "-", 8)}${pad(d.status, 12)}${pad(String(d.score ?? "-"), 7)}${pad(String(d.effectiveScore ?? "-"), 5)}${pad(al, 22)}${pad(d.payback && Number.isFinite(d.payback.months) ? `${Math.round(d.payback.months)}m` : "-", 8)}${d.confidence}`
  );
}

console.log("\nCOUNTS", JSON.stringify(res.counts));
console.log(`INVARIANTS ${res.invariants.ok ? "OK" : "VIOLATED"} (${res.invariants.checked} placements checked)`);
for (const v of res.invariants.violations) console.log(`  ${v.rule}: ${v.message}`);

console.log("\nTERRITORIES");
for (const t of res.territories) {
  console.log(`${pad(t.id, 8)}${pad(t.city ?? "-", 18)}slots ${t.allocated.length}/${t.openSlots}  placed: ${t.allocated.join(", ") || "-"}  waitlist: ${t.waitlist.join(", ") || "-"}`);
  for (const r of t.insight?.reasons ?? []) console.log(`           ↳ ${r}`);
}

if (why) {
  const d = res.decisionById[why];
  if (!d) console.log(`\nNo such applicant: ${why}`);
  else {
    console.log(`\n${d.id} ${d.name}: ${d.status}\n  ${d.headline}\n  ${d.why}`);
    for (const c of d.breakdown) console.log(`  ${pad(c.name, 22)}${String(c.points).padStart(3)}/${c.max}  ${c.reason}`);
    for (const f of d.flags) console.log(`  [${f.severity}] ${f.code}: ${f.message}`);
    for (const c of d.competitors ?? []) console.log(`  competitor ${c.id} (${c.outcome}): ${c.whyTheyWon}`);
    if (d.whatWouldChange) console.log(`  what would change it: ${d.whatWouldChange}`);
    for (const s of d.nextSteps ?? []) console.log(`  next ${s.due} [${s.owner}] ${s.text}`);
    for (const b of d.readinessPlan?.timeline ?? []) console.log(`  timeline ${b.start}${b.end !== b.start ? ` to ${b.end}` : ""}  ${b.label}`);
    const tr = d.readinessPlan?.training;
    if (tr) console.log(`  training (${tr.track}, ${tr.language}, ${tr.totalDays} days): ${tr.shadowing?.text ?? ""}`);
  }
}
console.log("");
