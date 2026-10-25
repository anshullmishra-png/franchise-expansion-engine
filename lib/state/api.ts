// Browser-side calls to the app's own API routes. Nothing here knows about keys: the server holds them.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function postJson<T>(path: string, body: unknown, timeoutMs = 40_000): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || !data) return { ok: false, error: (data && "error" in data && data.error) || `The server answered with an error (${res.status}).` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "AbortError" ? "That took too long." : "Couldn't reach the server." };
  } finally {
    clearTimeout(timer);
  }
}

export async function getAiStatus(): Promise<boolean | null> {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { aiConfigured?: boolean };
    return !!body.aiConfigured;
  } catch {
    return null;
  }
}
