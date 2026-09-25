import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const notFound = (what = 'Not found') => new HttpError(404, what);
export const conflict = (msg: string) => new HttpError(409, msg);

function describeZodError(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return 'Invalid request';
  const path = first.path.join('.');
  return path ? `${path}: ${first.message}` : first.message;
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest(describeZodError(result.error));
  return result.data;
}

export function idParam(req: Request, name = 'id'): number {
  const raw = req.params[name];
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest(`Invalid ${name}`);
  return id;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: describeZodError(err) });
    return;
  }
  const e = err as { type?: string; status?: number; message?: string; code?: string };
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request is too large' });
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body' });
    return;
  }
  if (e?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'Photo is too large (max 25 MB per file)' });
    return;
  }
  if (e?.code === 'LIMIT_UNEXPECTED_FILE' || e?.code === 'LIMIT_FILE_COUNT') {
    res.status(400).json({ error: 'Too many files, or an unexpected file field' });
    return;
  }
  if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) {
    res.status(e.status).json({ error: e.status === 404 ? 'Not found' : (e.message ?? 'Request failed') });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
}
