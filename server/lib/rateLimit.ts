/** Tiny in-memory fixed-window limiter, keyed by e.g. IP address. */
export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    /** Returns true if this hit is allowed. */
    hit(key: string): boolean {
      const now = Date.now();
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      }
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + opts.windowMs });
        return true;
      }
      entry.count++;
      return entry.count <= opts.max;
    },
    reset(key: string): void {
      hits.delete(key);
    },
  };
}
