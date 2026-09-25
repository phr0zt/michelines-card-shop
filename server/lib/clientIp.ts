import type { Request } from 'express';

/**
 * The visitor's address, for rate limits. Some hosts put it in a header of
 * their own that clients can't forge (Railway: X-Real-IP; set with the
 * "client ip header" app setting). Otherwise it's Express's req.ip, which
 * only trusts X-Forwarded-For as far as the "trust proxy" setting allows.
 */
export function clientIp(req: Request): string {
  const header = req.app.get('client ip header') as string | undefined;
  if (header) {
    // A proxy that appends to the header puts the address it saw last.
    const value = req.get(header)?.split(',').at(-1)?.trim();
    if (value) return value;
  }
  return req.ip ?? 'unknown';
}
