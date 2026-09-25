import { Router } from 'express';
import type { AppContext } from '../context';
import { HttpError, parse } from '../lib/http';
import { createRateLimiter } from '../lib/rateLimit';
import { createPublicInquiry, getPublicCard, listPublicCards, publicQuerySchema, publicStore } from '../services/public';

export function publicRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;
  const inquiryLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 8 });

  r.get('/public/store', (_req, res) => {
    res.set('Cache-Control', 'no-cache').json(publicStore(db));
  });
  r.get('/public/cards', (req, res) => {
    res.set('Cache-Control', 'no-cache').json(listPublicCards(db, parse(publicQuerySchema, req.query)));
  });
  r.get('/public/cards/:sku', (req, res) => {
    res.set('Cache-Control', 'no-cache').json(getPublicCard(db, String(req.params.sku)));
  });
  r.post('/public/cards/:sku/inquiries', (req, res) => {
    if (!inquiryLimiter.hit(req.ip ?? 'unknown')) {
      throw new HttpError(429, 'Thanks! We already got a few messages from you — we’ll reply soon.');
    }
    res.status(201).json(createPublicInquiry(db, String(req.params.sku), req.body ?? {}));
  });
  return r;
}
