import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './http';
import { createRateLimiter } from './rateLimit';

const COOKIE = 'mcs_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function sha256(s: string): Buffer {
  return crypto.createHash('sha256').update(s).digest();
}

/**
 * One shared admin password (ADMIN_PASSWORD). A successful login gets a signed,
 * HTTP-only cookie that is valid for 30 days. Changing the password or the
 * session secret signs everyone out.
 */
export function createAuth(opts: { password: string; secret: string }) {
  const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
  const key = crypto.createHmac('sha256', opts.secret).update(`pw:${opts.password}`).digest();

  const sign = (payload: string) => crypto.createHmac('sha256', key).update(payload).digest('base64url');

  function issue(): string {
    const exp = String(Date.now() + MAX_AGE_MS);
    return `${exp}.${sign(exp)}`;
  }

  function valid(token: string | undefined): boolean {
    if (!token || !opts.password) return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
    const expected = Buffer.from(sign(exp));
    const given = Buffer.from(sig);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }

  function isAuthenticated(req: Request): boolean {
    return valid(parseCookies(req.headers.cookie)[COOKIE]);
  }

  function setCookie(req: Request, res: Response, value: string, maxAgeMs: number): void {
    res.cookie(COOKIE, value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: maxAgeMs,
      path: '/',
    });
  }

  function login(req: Request, res: Response): void {
    const ip = req.ip ?? 'unknown';
    if (!opts.password) {
      throw new HttpError(503, 'No admin password is set. Add ADMIN_PASSWORD to the server environment and restart.');
    }
    if (!limiter.hit(ip)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.');
    const given = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!crypto.timingSafeEqual(sha256(given), sha256(opts.password))) {
      throw new HttpError(401, 'Wrong password');
    }
    limiter.reset(ip);
    setCookie(req, res, issue(), MAX_AGE_MS);
    res.json({ authenticated: true, password_configured: true });
  }

  function logout(req: Request, res: Response): void {
    setCookie(req, res, '', 0);
    res.json({ authenticated: false, password_configured: Boolean(opts.password) });
  }

  function requireAuth(req: Request, _res: Response, next: NextFunction): void {
    if (isAuthenticated(req)) return next();
    next(new HttpError(401, 'Please log in'));
  }

  return { login, logout, requireAuth, isAuthenticated, passwordConfigured: Boolean(opts.password) };
}

export type Auth = ReturnType<typeof createAuth>;
