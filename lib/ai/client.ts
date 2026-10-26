import { GoogleGenAI, type Content } from "@google/genai";
import type { AiConfig } from "./config";
import { scrub } from "./config";

// A thin wrapper around the Gemini SDK: temperature 0, a hard timeout, one retry, and no key in any error.
// Everything above this file talks to the AiClient interface, so tests can supply a fake.

export type AiContent = Content;

export interface GenRequest {
  model: string;
  contents: AiContent[];
  systemInstruction?: string;
  /** JSON Schema for structured output (extraction). */
  responseJsonSchema?: unknown;
  /** Function declarations for tool calling (chat). */
  functionDeclarations?: { name: string; description: string; parametersJsonSchema: unknown }[];
}

export interface GenResult {
  text: string;
  functionCalls: { name: string; args: Record<string, unknown> }[];
  /** The model's own turn, to put back in the history unchanged (it carries thought signatures). */
  modelContent: AiContent | undefined;
}

export interface AiClient {
  generate(req: GenRequest, opts?: { timeoutMs?: number }): Promise<GenResult>;
}

export type AiFailureKind = "timeout" | "throttled" | "bad-output" | "unavailable" | "no-key";

export class AiError extends Error {
  constructor(
    public kind: AiFailureKind,
    message: string
  ) {
    super(message);
    this.name = "AiError";
  }
}

export const AI_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function classify(e: unknown, config: AiConfig): AiError {
  if (e instanceof AiError) return e;
  const msg = scrub(e instanceof Error ? e.message : String(e), config);
  const status = (e as { status?: number } | null)?.status;
  if (e instanceof Error && (e.name === "AbortError" || /abort|timed? ?out|timeout/i.test(e.message))) return new AiError("timeout", "The AI took too long to answer.");
  if (status === 429 || /429|quota|rate.?limit|resource.?exhausted/i.test(msg)) return new AiError("throttled", "The AI is busy right now (rate limit).");
  return new AiError("unavailable", `The AI isn't available right now. ${msg.slice(0, 160)}`);
}

const retryable = (e: AiError) => e.kind === "timeout" || e.kind === "throttled" || /\b5\d\d\b|fetch failed|network|ECONN|ETIMEDOUT/i.test(e.message);

export function createGeminiClient(config: AiConfig): AiClient | null {
  if (!config.apiKey) return null;
  const ai = new GoogleGenAI({ apiKey: config.apiKey });

  async function once(req: GenRequest, timeoutMs: number): Promise<GenResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await ai.models.generateContent({
        model: req.model,
        contents: req.contents,
        config: {
          temperature: 0,
          abortSignal: controller.signal,
          httpOptions: { timeout: timeoutMs },
          systemInstruction: req.systemInstruction,
          ...(req.responseJsonSchema ? { responseMimeType: "application/json", responseJsonSchema: req.responseJsonSchema } : {}),
          ...(req.functionDeclarations ? { tools: [{ functionDeclarations: req.functionDeclarations }], automaticFunctionCalling: { disable: true } } : {}),
        },
      });
      const calls = (res.functionCalls ?? []).filter((c) => !!c.name).map((c) => ({ name: c.name as string, args: (c.args ?? {}) as Record<string, unknown> }));
      // Read the text parts directly: the SDK's `.text` getter logs a warning whenever the reply also holds a tool call.
      const parts = res.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => typeof p.text === "string" && !p.thought)
        .map((p) => p.text as string)
        .join("");
      return { text, functionCalls: calls, modelContent: res.candidates?.[0]?.content };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async generate(req, opts) {
      const timeoutMs = opts?.timeoutMs ?? AI_TIMEOUT_MS;
      let last: AiError | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await once(req, timeoutMs);
        } catch (e) {
          last = classify(e, config);
          if (attempt === 0 && retryable(last)) {
            await sleep(400);
            continue;
          }
          break;
        }
      }
      throw last ?? new AiError("unavailable", "The AI isn't available right now.");
    },
  };
}
