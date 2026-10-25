// Per-visitor throttle so a looping client can't burn the Gemini budget (SPEC §1, D13).
// In-memory and per server instance: good enough for a hackathon deployment. When it trips, the route
// answers in rules-only mode instead of failing.

export const THROTTLE_LIMIT = 30;
export const THROTTLE_WINDOW_MS = 60_000;

export class Throttle {
  private hits = new Map<string, number[]>();

  constructor(
    private limit = THROTTLE_LIMIT,
    private windowMs = THROTTLE_WINDOW_MS
  ) {}

  /** Record a call. Returns false when this visitor is over the limit for the current window. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}

export const sharedThrottle = new Throttle();

/** Best-effort visitor key from the proxy headers Vercel sets. */
export function visitorKey(headers: Pick<Headers, "get">): string {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || headers.get("x-real-ip") || "local";
}
