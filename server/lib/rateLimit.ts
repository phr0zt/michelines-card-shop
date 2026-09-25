/**
 * Tiny in-memory fixed-window limiter, keyed by e.g. IP address. The key map is
 * swept once a minute and capped at `maxKeys`, so a flood of distinct keys
 * can't grow memory or make every request scan the whole map.
 */
export function createRateLimiter(opts: { windowMs: number; max: number; maxKeys?: number }) {
  const maxKeys = opts.maxKeys ?? 10_000;
  const hits = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = 0;

  function sweep(now: number): void {
    if (now < nextSweep && hits.size < maxKeys) return;
    nextSweep = now + 60_000;
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    // Still full of live keys: drop the oldest down to 90% so the next inserts stay cheap.
    for (const k of hits.keys()) {
      if (hits.size <= maxKeys * 0.9) break;
      hits.delete(k);
    }
  }

  return {
    /** Counts a hit; returns true if it is allowed. */
    hit(key: string): boolean {
      const now = Date.now();
      sweep(now);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.delete(key);
        hits.set(key, { count: 1, resetAt: now + opts.windowMs });
        return 1 <= opts.max;
      }
      entry.count++;
      return entry.count <= opts.max;
    },
    /** True if `key` has used up its hits for the current window (doesn't count a hit). */
    limited(key: string): boolean {
      const entry = hits.get(key);
      return Boolean(entry && entry.resetAt > Date.now() && entry.count >= opts.max);
    },
    reset(key: string): void {
      hits.delete(key);
    },
  };
}
