// Live check of the Gemini layer with the key in .env.local (or the environment). Prints results, never the key.
// Usage: npm run ai:smoke
import { existsSync, readFileSync } from "node:fs";
import { createGeminiClient } from "../lib/ai/client";
import { getAiConfig } from "../lib/ai/config";
import { handleChat, handleExplain, handleExtract, handleMessage } from "../lib/ai/service";
import { runEngine } from "../lib/engine";
import { parseWorkbook } from "../lib/engine/parse";

// Minimal .env.local reader (Next does this for the app; this script runs outside Next).
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const config = getAiConfig();
if (!config.apiKey) {
  console.log("No GEMINI_API_KEY found in .env.local or the environment, so there is nothing to test live.");
  console.log("Create .env.local from .env.example, paste the key, and run this again.");
  process.exit(0);
}
console.log(`Key found. Chat model: ${config.chatModel}. Fast model: ${config.fastModel}.`);
const client = createGeminiClient(config);
const ctx = { client, config };
const today = "2026-10-25";

const parsed = parseWorkbook(readFileSync("test-data/Stress_Test_Case1.xlsx"));
const input = parsed.input;

async function main() {
  console.log("\n1. Reading applicants' notes (fast model)...");
  const ex = await handleExtract({ applications: input.applications as never, today }, ctx);
  console.log(`   AI read ${ex.aiCount} of ${input.applications.length} applicants. Fell back to rules for some: ${ex.usedFallback}${ex.reason ? ` (${ex.reason})` : ""}`);
  for (const r of ex.readings.filter((x) => x.signals.length).slice(0, 4)) console.log(`   ${r.id} [${r.businessCategory}]: ${r.signals.map((s) => `${s.type}(${s.impact}) “${s.quote}”`).join("; ")}`);

  const send = async (text: string, overrides = {}) =>
    handleChat(
      { messages: [{ role: "user", text }], state: { input: { applications: input.applications, territories: input.territories, existingStores: input.existingStores } as never, overrides, assumptions: {}, readings: ex.readings as never, undoTo: null, today } },
      ctx
    );

  for (const q of ["Why is APP-007 on hold?", "Why did APP-002 get 560095 and not APP-003?", "APP-012 has now found a ground-floor space", "What if APP-014 found a co-investor and can invest 30 lakh?", "Tell me about APP-999"]) {
    console.log(`\n> ${q}`);
    const r = await send(q);
    console.log(`  [${r.usedFallback ? `RULES-ONLY: ${r.reason}` : "AI"}${r.entries ? `, committed ${r.entries.length} change(s)` : ""}]`);
    console.log(r.reply.split("\n").map((l) => `  ${l}`).join("\n"));
  }

  const res = runEngine(input, undefined, undefined, { today, readings: ex.readings, simulate: true });
  const d = res.decisionById["APP-008"];
  console.log("\n> Explain simply (APP-008)");
  const e = await handleExplain({ explanation: d.why, decision: { id: d.id, status: d.status, score: d.score } }, ctx);
  console.log(`  [${e.usedFallback ? `UNCHANGED: ${e.reason}` : "AI"}] ${e.text}`);

  console.log("\n> Message to APP-008 in Kannada and Hindi");
  for (const language of ["Kannada", "Hindi"] as const) {
    const m = await handleMessage({ decision: JSON.parse(JSON.stringify(d)), language }, ctx);
    console.log(`  [${language}: ${m.usedFallback ? `ENGLISH FALLBACK: ${m.reason}` : "AI"}]\n${m.message.split("\n").map((l: string) => `    ${l}`).join("\n")}`);
  }
}

main().catch((e) => {
  console.error("Smoke test failed:", e instanceof Error ? e.message.replace(config.apiKey as string, "[key]") : "unknown error");
  process.exit(1);
});
