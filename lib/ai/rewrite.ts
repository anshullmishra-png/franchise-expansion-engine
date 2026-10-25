import { z } from "zod";
import type { Language } from "../engine/types";
import { AiError, type AiClient } from "./client";

// "Explain simply" (AI_PROMPTS §3) and the applicant message in Kannada or Hindi (AI_PROMPTS §4).
// Both only rephrase text the rules engine already produced, and both are checked before being shown.

export const EXPLAIN_PROMPT = `Rewrite this decision explanation for the applicant's case so a non-expert expansion manager understands it in 3-4 sentences. Keep every number and rule exactly as given. Do not add reasons that are not in the input.
INPUT: {{INPUT}}`;

export const MESSAGE_PROMPT = `Write a short, warm, professional message from the brand's expansion team to a franchise applicant, in {{LANGUAGE}} (use the native script for Kannada and Hindi, simple everyday words). Also return the same message in English.

Content by status:
- APPROVED / CONDITIONAL / REDIRECT: congratulate, state the decision in one line, list the next steps with due dates, list any conditions with deadlines, mention their training plan briefly.
- HOLD: thank them, explain we need a few details, list the exact questions.
- WAITLIST: explain they are on the waitlist (with rank if given), why, and what would improve their chances.
- REJECTED: thank them, give the main reason kindly, say what would change the decision.
Use only facts from the input. No promises beyond it. Under 140 words. Sign off as "Expansion Team".
INPUT: {{INPUT}}`;

const MESSAGE_JSON_SCHEMA = {
  type: "object",
  properties: { language: { type: "string" }, message: { type: "string" }, englishVersion: { type: "string" } },
  required: ["language", "message", "englishVersion"],
};
const messageSchema = z.object({ language: z.string(), message: z.string().min(10).max(2500), englishVersion: z.string().min(10).max(2500) });

const numbersIn = (s: string) =>
  (s.replace(/\b[A-Z]{2,4}-\d+(?:#\d+)?\b/g, " ").match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => n.length >= 2 || n.includes("."));

/** Keep the rewrite only if it still contains the numbers of the original (the model must not drop or change them). */
export function keepsNumbers(original: string, rewrite: string): boolean {
  const needed = [...new Set(numbersIn(original))];
  if (needed.length === 0) return true;
  const have = new Set(numbersIn(rewrite));
  return needed.filter((n) => have.has(n)).length / needed.length >= 0.85;
}

export async function explainSimply(client: AiClient, model: string, explanation: string, decision: unknown, timeoutMs?: number): Promise<string> {
  const res = await client.generate(
    { model, contents: [{ role: "user", parts: [{ text: EXPLAIN_PROMPT.replace("{{INPUT}}", JSON.stringify({ explanation, decision })) }] }] },
    { timeoutMs }
  );
  const text = res.text.trim();
  if (!text || text.length > 1500) throw new AiError("bad-output", "The AI rewrite wasn't usable.");
  if (!keepsNumbers(explanation, text)) throw new AiError("bad-output", "The AI rewrite changed the numbers, so it was discarded.");
  return text;
}

export async function aiMessage(client: AiClient, model: string, decision: unknown, language: Language, english: string, timeoutMs?: number) {
  const res = await client.generate(
    {
      model,
      contents: [{ role: "user", parts: [{ text: MESSAGE_PROMPT.replace("{{LANGUAGE}}", language).replace("{{INPUT}}", JSON.stringify(decision)) }] }],
      responseJsonSchema: MESSAGE_JSON_SCHEMA,
    },
    { timeoutMs }
  );
  const parsed = messageSchema.safeParse(JSON.parse(res.text));
  if (!parsed.success) throw new AiError("bad-output", "The AI message wasn't in the expected format.");
  // Dates and IDs must survive translation; pins and ₹ figures are checked through the English version.
  if (!keepsNumbers(english, parsed.data.englishVersion)) throw new AiError("bad-output", "The AI message changed the facts, so it was discarded.");
  return { language, message: parsed.data.message, englishVersion: parsed.data.englishVersion };
}
