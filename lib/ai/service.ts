import { z } from "zod";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "../engine/assumptions";
import { draftMessage, type MessageDraft } from "../engine/message";
import { todayIST } from "../engine/reference";
import type { Decision, EngineInput, NoteReading, Overrides } from "../engine/types";
import { runChatAI } from "./chat";
import { fallbackChat } from "./chat-fallback";
import { AiError, type AiClient } from "./client";
import type { AiConfig } from "./config";
import { extractReadings, type ExtractOutcome } from "./extract";
import { aiMessage, explainSimply } from "./rewrite";
import { ToolRuntime, type Committed } from "./tools";

// What the three API routes do, separated from HTTP so it can be tested with a fake AI client.
// Every function answers even when the AI is missing, throttled, slow or wrong: that is the rules-only fallback.

export interface AiContext {
  client: AiClient | null;
  config: AiConfig;
  /** Rules-only requested (test header) or throttled. */
  forceFallback?: boolean;
  throttled?: boolean;
  timeoutMs?: number;
}

const obj = z.record(z.string(), z.unknown());

const stateSchema = z.object({
  input: z.object({
    applications: z.array(obj).max(700),
    territories: z.array(obj).max(150),
    existingStores: z.array(obj).max(200),
    excludedExamples: z.object({ applications: z.array(z.unknown()), territories: z.array(z.unknown()) }).optional(),
  }),
  overrides: obj.default({}),
  assumptions: obj.default({}),
  readings: z.array(z.object({ id: z.string() }).passthrough()).max(700).default([]),
  undoTo: z.object({ overrides: obj, assumptions: obj }).nullable().optional(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const chatBodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).min(1).max(60),
  state: stateSchema,
});

export const explainBodySchema = z.object({ explanation: z.string().min(1).max(5000), decision: z.unknown().optional() });
export type ExplainBody = z.infer<typeof explainBodySchema>;

export const messageBodySchema = z.object({
  decision: obj,
  language: z.enum(["Kannada", "English", "Hindi"]),
  english: z.string().min(1).max(4000).optional(),
});

const appSource = z.object({
  id: z.string(),
  city: z.string().nullable().optional(),
  pin: z.string().nullable().optional(),
  investmentLakh: z.number().nullable().optional(),
  experienceYears: z.number().nullable().optional(),
  spaceAvailable: z.string().nullable().optional(),
  spaceSize: z.number().nullable().optional(),
  floor: z.string().nullable().optional(),
  targetLaunchMonths: z.number().nullable().optional(),
  business: z.string().max(2000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});
export const extractBodySchema = z.object({ applications: z.array(appSource).max(700), today: z.string().optional() });

export interface ChatResponse {
  reply: string;
  usedFallback: boolean;
  reason?: string;
  newOverrides?: Overrides;
  newAssumptions?: Assumptions;
  entries?: Committed[];
}

const usable = (ctx: AiContext) => !!ctx.client && !ctx.forceFallback && !ctx.throttled;

function whyFallback(ctx: AiContext): string {
  if (ctx.throttled) return "You're sending questions very quickly, so this one was answered by the rules directly.";
  if (ctx.forceFallback) return "Rules-only mode was requested.";
  return "The AI isn't configured, so questions are answered by the rules directly.";
}

export async function handleChat(rawBody: z.infer<typeof chatBodySchema>, ctx: AiContext): Promise<ChatResponse> {
  const s = rawBody.state;
  const rt = new ToolRuntime({
    input: { ...s.input, excludedExamples: s.input.excludedExamples ?? { applications: [], territories: [] } } as unknown as EngineInput,
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...(s.assumptions as Partial<Assumptions>) },
    overrides: s.overrides as Overrides,
    readings: s.readings as unknown as NoteReading[],
    today: s.today ?? todayIST(),
    undoTo: (s.undoTo as ToolRuntime["state"]["undoTo"]) ?? null,
  });
  const messages = rawBody.messages;
  const last = [...messages].reverse().find((m) => m.role === "user")?.text ?? "";

  const finish = (reply: string, usedFallback: boolean, reason?: string): ChatResponse => ({
    reply,
    usedFallback,
    reason,
    ...(rt.changed ? { newOverrides: rt.overrides, newAssumptions: rt.assumptions, entries: rt.entries } : {}),
  });

  if (usable(ctx)) {
    try {
      const reply = await runChatAI({ client: ctx.client as AiClient, model: ctx.config.chatModel, messages, runtime: rt, today: rt.state.today, timeoutMs: ctx.timeoutMs });
      return finish(reply, false);
    } catch (e) {
      const reason = e instanceof AiError ? e.message : "The AI couldn't answer.";
      if (rt.changed) {
        // The AI changed things before it failed: report what was applied rather than applying anything twice.
        return finish(`Done: ${rt.entries.map((x) => x.sourceText).join("; ")}. (The AI stopped before it could summarise, so ask “what changed?” or check the Change log.)`, true, reason);
      }
      return finish(fallbackChat(last, rt), true, reason);
    }
  }
  return finish(fallbackChat(last, rt), true, whyFallback(ctx));
}

export async function handleExplain(body: z.infer<typeof explainBodySchema>, ctx: AiContext): Promise<{ text: string; usedFallback: boolean; reason?: string }> {
  if (!usable(ctx)) return { text: body.explanation, usedFallback: true, reason: whyFallback(ctx) };
  try {
    const text = await explainSimply(ctx.client as AiClient, ctx.config.chatModel, body.explanation, body.decision, ctx.timeoutMs);
    return { text, usedFallback: false };
  } catch (e) {
    return { text: body.explanation, usedFallback: true, reason: e instanceof AiError ? e.message : "The AI couldn't rewrite that." };
  }
}

export type MessageResponse = MessageDraft & { usedFallback: boolean; reason?: string };

export async function handleMessage(body: z.infer<typeof messageBodySchema>, ctx: AiContext): Promise<MessageResponse> {
  const decision = body.decision as unknown as Decision;
  const draft = draftMessage(decision, body.language);
  if (body.language === "English") return { ...draft, usedFallback: false };
  if (!usable(ctx)) return { ...draft, usedFallback: true, reason: whyFallback(ctx) };
  try {
    const out = await aiMessage(ctx.client as AiClient, ctx.config.chatModel, body.decision, body.language, draft.englishVersion, ctx.timeoutMs);
    return { language: body.language, message: out.message, englishVersion: draft.englishVersion, translated: true, usedFallback: false };
  } catch (e) {
    return { ...draft, usedFallback: true, reason: e instanceof AiError ? e.message : "The AI couldn't translate that." };
  }
}

export async function handleExtract(body: z.infer<typeof extractBodySchema>, ctx: AiContext): Promise<ExtractOutcome> {
  const apps = body.applications.map((a) => ({
    id: a.id,
    city: a.city ?? null,
    pin: a.pin ?? null,
    investmentLakh: a.investmentLakh ?? null,
    experienceYears: a.experienceYears ?? null,
    spaceAvailable: (a.spaceAvailable ?? null) as never,
    spaceSize: a.spaceSize ?? null,
    floor: (a.floor ?? null) as never,
    targetLaunchMonths: a.targetLaunchMonths ?? null,
    business: a.business ?? null,
    notes: a.notes ?? null,
  }));
  const client = usable(ctx) ? ctx.client : null;
  const out = await extractReadings(apps, body.today ?? todayIST(), client, ctx.config.fastModel, { force: ctx.forceFallback, timeoutMs: ctx.timeoutMs });
  if (ctx.throttled && !out.reason) out.reason = "Too many requests, so the notes were read by the rules.";
  return out;
}
