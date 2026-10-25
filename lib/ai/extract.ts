import { createHash } from "node:crypto";
import { z } from "zod";
import { FESTIVALS } from "../engine/reference";
import type { Application, BusinessCategory, NoteReading, NoteSignal } from "../engine/types";
import { AI_TIMEOUT_MS, type AiClient } from "./client";
import { extractNotesFallback } from "./fallback";

// Note extraction at upload (AI_PROMPTS §1): the fast model reads each applicant's two free-text fields into
// bounded, quoted signals. It never decides anything. Output is validated hard (zod, then "is the quote really
// in the applicant's own words?") and every applicant has a deterministic fallback.

export const EXTRACT_CHUNK = 40;

export const CATEGORIES: BusinessCategory[] = [
  "eyewear_optical_watches",
  "specialty_retail",
  "general_or_food_retail",
  "retail_manager",
  "non_retail_business",
  "salaried_non_retail",
  "unknown",
];
const SIGNAL_TYPES = ["green", "red", "contradiction", "deadline", "site", "finance", "info"] as const;
const SIGNAL_FIELDS = ["investment", "floor", "spaceSize", "spaceAvailable", "city", "pin", "experience", "targetLaunch"] as const;

export const EXTRACT_SYSTEM_PROMPT = `You read franchise applications for a retail brand's expansion team. For each applicant you get their structured fields and two free-text fields ("business" and "notes").

Your job is ONLY to extract facts from the free text. You do not make decisions.

Rules:
- Use only what is written. Never guess or add facts.
- Every signal must include "quote": the exact words from the applicant's text it is based on.
- "impact" is an integer between -3 and +3 and reflects how the fact affects readiness to open and run a store. Use 0 for neutral facts and deadlines.
- If text is blank or says nothing useful, return no signals.
- Flag a "contradiction" when the text disagrees with a structured field (e.g. a different investment amount, says the space is on the first floor while floor says Ground, mentions a city other than the stated city). Put the field name in "field" and the number or value from the text in "value".
- Use type "finance" when the applicant's funding depends on a bank loan or other outside finance.
- Recognise deadlines and festivals. Today is {{TODAY}}. Festival dates: {{FESTIVALS_JSON}}. Return the date in ISO format.
- Classify the business into exactly one category from the schema enum. A salaried store manager in retail is "retail_manager".
- Set "priorFranchise" true only if the text says they have run or currently run a franchise.`;

/** The response schema handed to Gemini (value is a string there; numbers are read back afterwards). */
export const EXTRACT_JSON_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          businessCategory: { type: "string", enum: CATEGORIES },
          priorFranchise: { type: "boolean" },
          signals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: SIGNAL_TYPES },
                text: { type: "string" },
                quote: { type: "string" },
                impact: { type: "integer" },
                field: { type: "string", enum: SIGNAL_FIELDS },
                value: { type: "string" },
                date: { type: "string" },
              },
              required: ["type", "text", "quote", "impact"],
            },
          },
        },
        required: ["id", "businessCategory", "priorFranchise", "signals"],
      },
    },
  },
  required: ["results"],
};

const signalSchema = z.object({
  type: z.enum(SIGNAL_TYPES),
  text: z.string().min(1),
  quote: z.string().min(1),
  impact: z.number(),
  field: z.enum(SIGNAL_FIELDS).optional(),
  value: z.union([z.string(), z.number()]).optional(),
  date: z.string().optional(),
});

export const extractResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      businessCategory: z.enum(CATEGORIES as [BusinessCategory, ...BusinessCategory[]]).catch("unknown"),
      priorFranchise: z.boolean().catch(false),
      signals: z.array(z.unknown()).catch([]),
    })
  ),
});

type Source = Pick<Application, "id" | "city" | "pin" | "investmentLakh" | "experienceYears" | "spaceAvailable" | "spaceSize" | "floor" | "targetLaunchMonths" | "business" | "notes">;

const norm = (s: string) => s.toLowerCase().replace(/[‘’“”]/g, "'").replace(/\s+/g, " ").trim();

/** Keep a signal only if it is well-formed, bounded, and its quote really is in the applicant's own words. */
export function cleanSignal(raw: unknown, source: Source): NoteSignal | null {
  const p = signalSchema.safeParse(raw);
  if (!p.success) return null;
  const s = p.data;
  const haystack = norm(`${source.business ?? ""} \n ${source.notes ?? ""}`);
  const quote = norm(s.quote).replace(/^["']|["']$/g, "");
  if (quote.length < 3 || !haystack.includes(quote)) return null;
  const impact = Math.max(-3, Math.min(3, Math.round(s.impact)));
  const out: NoteSignal = { type: s.type, text: s.text.trim(), quote: s.quote.trim().replace(/^["']|["']$/g, ""), impact };
  if (s.type === "contradiction" || s.type === "deadline") out.impact = 0;
  if (s.field) out.field = s.field;
  if (s.value !== undefined) {
    const numeric = ["investment", "spaceSize", "experience", "targetLaunch"].includes(s.field ?? "");
    if (numeric) {
      const n = Number(String(s.value).replace(/[^\d.]/g, ""));
      if (!Number.isFinite(n) || String(s.value).replace(/[^\d.]/g, "") === "") return null;
      out.value = n;
    } else out.value = String(s.value);
  }
  if (s.type === "contradiction" && (!out.field || out.value === undefined)) return null;
  if (s.type === "deadline") {
    if (!s.date || !/^\d{4}-\d{2}-\d{2}$/.test(s.date) || Number.isNaN(Date.parse(s.date))) return null;
    out.date = s.date;
  }
  return out;
}

/** Add the deterministic reader's signals for the things that must never be missed (loans, figures that disagree, deadlines). */
export function mergeSignals(ai: NoteSignal[], fallback: NoteSignal[]): NoteSignal[] {
  const out = [...ai];
  for (const f of fallback) {
    if (!["finance", "contradiction", "deadline"].includes(f.type)) continue;
    if (out.some((a) => a.type === f.type && (a.field ?? "") === (f.field ?? ""))) continue;
    out.push(f);
  }
  return out;
}

export function hashApplicants(apps: Source[], today: string): string {
  const slim = apps.map((a) => [a.id, a.city, a.pin, a.investmentLakh, a.experienceYears, a.spaceAvailable, a.spaceSize, a.floor, a.targetLaunchMonths, a.business, a.notes]);
  return createHash("sha256").update(JSON.stringify({ slim, today })).digest("hex");
}

const cache = new Map<string, NoteReading[]>();

export interface ExtractOutcome {
  readings: NoteReading[];
  /** True if any applicant was read by the deterministic fallback instead of the AI. */
  usedFallback: boolean;
  aiCount: number;
  reason?: string;
  cached?: boolean;
}

export function clearExtractCache(): void {
  cache.clear();
}

export async function extractReadings(
  apps: Source[],
  today: string,
  client: AiClient | null,
  fastModel: string,
  opts: { force?: boolean; timeoutMs?: number } = {}
): Promise<ExtractOutcome> {
  const fallback = extractNotesFallback(apps, today);
  const fbById = new Map(fallback.map((r) => [r.id, r]));
  const hasText = apps.some((a) => (a.business ?? "").trim() || (a.notes ?? "").trim());

  if (!client || opts.force || !hasText) {
    return { readings: fallback, usedFallback: !!hasText, aiCount: 0, reason: !hasText ? undefined : opts.force ? "Rules-only mode requested." : "AI isn't configured." };
  }

  const key = hashApplicants(apps, today);
  const hit = cache.get(key);
  if (hit) return { readings: hit, usedFallback: false, aiCount: hit.length, cached: true };

  const system = EXTRACT_SYSTEM_PROMPT.replace("{{TODAY}}", today).replace("{{FESTIVALS_JSON}}", JSON.stringify(FESTIVALS));
  const chunks: Source[][] = [];
  for (let i = 0; i < apps.length; i += EXTRACT_CHUNK) chunks.push(apps.slice(i, i + EXTRACT_CHUNK));

  let usedFallback = false;
  let reason: string | undefined;
  let aiCount = 0;
  const byId = new Map<string, NoteReading>();

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const payload = chunk.map((a) => ({
          id: a.id,
          city: a.city,
          pin: a.pin,
          investmentLakh: a.investmentLakh,
          experienceYears: a.experienceYears,
          spaceAvailable: a.spaceAvailable,
          spaceSize: a.spaceSize,
          floor: a.floor,
          targetLaunchMonths: a.targetLaunchMonths,
          business: a.business,
          notes: a.notes,
        }));
        const res = await client.generate(
          { model: fastModel, systemInstruction: system, contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }], responseJsonSchema: EXTRACT_JSON_SCHEMA },
          { timeoutMs: opts.timeoutMs ?? AI_TIMEOUT_MS }
        );
        const parsed = extractResponseSchema.parse(JSON.parse(res.text));
        const known = new Map(chunk.map((a) => [a.id, a]));
        for (const r of parsed.results) {
          const src = known.get(r.id);
          if (!src) continue;
          const ai = r.signals.map((x) => cleanSignal(x, src)).filter((x): x is NoteSignal => !!x);
          const fb = fbById.get(r.id)!;
          byId.set(r.id, {
            id: r.id,
            businessCategory: r.businessCategory === "unknown" && fb.businessCategory !== "unknown" ? fb.businessCategory : r.businessCategory,
            priorFranchise: r.priorFranchise || fb.priorFranchise,
            signals: mergeSignals(ai, fb.signals),
          });
          aiCount++;
        }
      } catch (e) {
        usedFallback = true;
        reason = e instanceof Error ? e.message : "The AI reading failed.";
      }
    })
  );

  const readings = apps.map((a) => byId.get(a.id) ?? fbById.get(a.id)!);
  if (byId.size < apps.length) usedFallback = true;
  if (!usedFallback) cache.set(key, readings);
  return { readings, usedFallback, aiCount, reason };
}
