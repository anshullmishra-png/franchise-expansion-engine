// Prints every applicant's and territory's flags for a workbook.
// Usage: npm run flags [path-to-xlsx]   (default: test-data/Stress_Test_Case1.xlsx)
import { readFileSync } from "node:fs";
import { extractNotesFallback } from "../lib/ai/fallback";
import { parseWorkbook } from "../lib/engine/parse";
import { todayIST } from "../lib/engine/reference";
import { validate } from "../lib/engine/validate";

const file = process.argv[2] ?? "test-data/Stress_Test_Case1.xlsx";
const parsed = parseWorkbook(readFileSync(file));

console.log(`\nFile: ${file}`);
console.log(`Readable: ${parsed.ok}`);
for (const n of parsed.notices) console.log(`  [${n.level}] ${n.code}: ${n.message}`);

const { input } = parsed;
console.log(
  `\n${input.applications.length} applications, ${input.territories.length} territories, ${input.existingStores.length} existing stores`
);

const today = todayIST();
const readings = extractNotesFallback(input.applications, today);
const result = validate(input, undefined, { today, readings });

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
const SEV: Record<string, string> = { blocker: "BLOCK", condition: "COND", warning: "WARN", info: "info" };

console.log("\nAPPLICANTS");
console.log(`${pad("ID", 9)}${pad("Name", 20)}${pad("Pin", 8)}${pad("Worst", 7)}Flags`);
for (const a of input.applications) {
  const flags = result.applications[a.id] ?? [];
  const worst = flags[0]?.severity ?? "-";
  console.log(
    `${pad(a.id, 9)}${pad(a.name ?? "(blank)", 20)}${pad(a.pin ?? "-", 8)}${pad(SEV[worst] ?? "-", 7)}${flags.map((f) => f.code).join(", ") || "none"}`
  );
}

console.log("\nBLOCKERS (HOLD) with the question we'd ask");
for (const a of input.applications) {
  for (const f of result.applications[a.id] ?? []) {
    if (f.severity === "blocker") console.log(`  ${a.id} ${f.code}: ${f.message}\n      ask: ${f.question ?? "-"}`);
  }
}

console.log("\nTERRITORIES");
for (const t of input.territories) {
  const flags = result.territories[t.id] ?? [];
  console.log(
    `${pad(t.id, 8)}${pad(t.city ?? "-", 18)}tier ${t.tier ?? "?"}  slots ${t.openSlots ?? "?"}  ${flags.map((f) => f.code).join(", ") || "none"}`
  );
}

console.log("\nDATA-QUALITY ALERTS");
for (const al of result.alerts) console.log(`  [${al.severity}] ${al.code}: ${al.message}`);
console.log("");
