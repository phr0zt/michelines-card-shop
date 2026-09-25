import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { parse } from '../lib/http';
import { daysBetween, isIsoDate } from '../lib/time';
import { dashboard, defaultRange, pnl, type Group } from '../services/analytics';

const isoDate = z.string().refine(isIsoDate, 'Use a date like 2025-01-31');
const rangeSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  group: z.enum(['month', 'week', 'day']).optional(),
});

function resolveRange(query: unknown): { from: string; to: string; group: Group } {
  const q = parse(rangeSchema, query);
  const d = defaultRange();
  let from = q.from ?? d.from;
  let to = q.to ?? d.to;
  if (from > to) [from, to] = [to, from];
  const span = daysBetween(from, to);
  const group: Group = q.group ?? (span > 120 ? 'month' : span > 31 ? 'week' : 'day');
  return { from, to, group };
}

export function analyticsRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get('/dashboard', (req, res) => {
    const { from, to, group } = resolveRange(req.query);
    res.json(dashboard(ctx.db, from, to, group));
  });
  r.get('/reports/pnl', (req, res) => {
    const { from, to, group } = resolveRange(req.query);
    res.json(pnl(ctx.db, from, to, group));
  });
  return r;
}
