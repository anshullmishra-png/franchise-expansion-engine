// AI configuration. Server routes only: GEMINI_API_KEY must never be read in client code or sent to the browser.

export interface AiConfig {
  /** null when no usable key is set, which puts the app in rules-only mode. */
  apiKey: string | null;
  chatModel: string;
  fastModel: string;
}

export const DEFAULT_CHAT_MODEL = "gemini-3.8-flash";
export const DEFAULT_FAST_MODEL = "gemini-3.5-flash-lite";

const PLACEHOLDERS = new Set(["", "your-key-here", "your_key_here", "changeme", "undefined", "null"]);

export function getAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const raw = (env.GEMINI_API_KEY ?? "").trim();
  return {
    apiKey: PLACEHOLDERS.has(raw.toLowerCase()) ? null : raw,
    chatModel: (env.GEMINI_CHAT_MODEL ?? "").trim() || DEFAULT_CHAT_MODEL,
    fastModel: (env.GEMINI_FAST_MODEL ?? "").trim() || DEFAULT_FAST_MODEL,
  };
}

/** The test hook from docs/TEST_PLAN.md: `x-force-fallback: 1` forces rules-only mode, outside production only. */
export function wantsForcedFallback(headers: Pick<Headers, "get">, env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && headers.get("x-force-fallback") === "1";
}

/** Remove the key from any text that might be logged or returned. */
export function scrub(text: string, config: AiConfig = getAiConfig()): string {
  return config.apiKey ? text.split(config.apiKey).join("[key]") : text;
}
