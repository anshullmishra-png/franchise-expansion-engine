import { readFileSync } from "node:fs";
import { parseWorkbook } from "../lib/engine/parse";

// Sends one real question to a deployed /api/chat with the stress file loaded. Usage: tsx scripts/live-chat.ts <base-url>
const base = process.argv[2] ?? "http://localhost:3000";
const input = parseWorkbook(readFileSync("test-data/Stress_Test_Case1.xlsx")).input;
async function main() {
const res = await fetch(`${base}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", text: "Why is APP-012 not approved, and what would change that?" }], state: { input, overrides: {}, assumptions: {}, readings: [], today: "2026-10-26" } }),
});
const j = (await res.json()) as { usedFallback?: boolean; reply?: string; text?: string };
console.log(res.status, "usedFallback:", j.usedFallback, "\n", (j.reply ?? j.text ?? JSON.stringify(j)).slice(0, 700));
}
main();
