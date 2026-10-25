import type { ZodType } from "zod";
import type { AiClient } from "./client";
import { createGeminiClient } from "./client";
import { getAiConfig, scrub, wantsForcedFallback, type AiConfig } from "./config";
import type { AiContext } from "./service";
import { sharedThrottle, visitorKey } from "./throttle";

// Shared plumbing for the API routes: read and validate the body, apply the per-visitor throttle, build the AI
// context, and turn every failure into a friendly JSON answer. Nothing here can leak the API key.

export const MAX_BODY_BYTES = 4 * 1024 * 1024;

let cached: { key: string | null; client: AiClient | null } | null = null;

function clientFor(config: AiConfig): AiClient | null {
  if (!cached || cached.key !== config.apiKey) cached = { key: config.apiKey, client: createGeminiClient(config) };
  return cached.client;
}

export function buildContext(req: Request, overrides: Partial<AiContext> = {}): AiContext {
  const config = getAiConfig();
  const forceFallback = wantsForcedFallback(req.headers);
  const throttled = !forceFallback && !!config.apiKey && !sharedThrottle.allow(visitorKey(req.headers));
  return { client: clientFor(config), config, forceFallback, throttled, ...overrides };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: json({ error: "Couldn't read the request." }, 400) };
  }
  if (text.length > MAX_BODY_BYTES) return { ok: false, response: json({ error: "That request is too large." }, 413) };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: json({ error: "The request wasn't valid JSON." }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: json({ error: "The request wasn't in the expected format.", detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`) }, 400) };
  return { ok: true, data: parsed.data };
}

export function ok(body: unknown): Response {
  return json(body);
}

export function failed(e: unknown): Response {
  const message = scrub(e instanceof Error ? e.message : "Something went wrong.");
  return json({ error: "That request couldn't be processed.", detail: message.slice(0, 200) }, 400);
}
