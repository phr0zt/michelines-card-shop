import { Router } from 'express';
import { OPEN_INQUIRY_STATUSES } from '../../shared/constants';
import type { NavCounts } from '../../shared/types';
import type { AppContext } from '../context';
import { today } from '../lib/time';
import { CARD_SUMMARY_SQL, summaryFromPrefixed } from '../services/common';
import { jobFromRow } from '../services/serializers';
import { getSettings, updateSettings } from '../services/settings';

export function settingsRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db, jobs } = ctx;

  r.get('/settings', (_req, res) => {
    res.json(getSettings(db));
  });
  r.patch('/settings', (req, res) => {
    res.json(updateSettings(db, req.body ?? {}));
  });

  r.get('/nav-counts', (_req, res) => {
    const open = OPEN_INQUIRY_STATUSES.map((st) => `'${st}'`).join(',');
    const counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM cards WHERE status = 'draft') AS drafts,
           (SELECT COUNT(*) FROM inquiries WHERE status = 'new') AS inquiries_new,
           (SELECT COUNT(*) FROM inquiries WHERE status IN (${open}) AND follow_up_on IS NOT NULL AND follow_up_on <= ?) AS inquiries_due,
           (SELECT COUNT(*) FROM sales WHERE fulfillment = 'pending') AS to_ship,
           (SELECT COUNT(*) FROM ai_jobs WHERE status = 'queued') AS ai_queued,
           (SELECT COUNT(*) FROM ai_jobs WHERE status = 'running') AS ai_running,
           (SELECT COUNT(*) FROM listings l JOIN cards c ON c.id = l.card_id WHERE l.status = 'active' AND c.status = 'sold') AS sold_still_listed`,
      )
      .get(today()) as NavCounts;
    res.set('Cache-Control', 'no-store').json(counts);
  });

  r.get('/ai/status', (_req, res) => {
    res.json(jobs.status());
  });
  r.get('/ai/jobs', (_req, res) => {
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const rows = db
      .prepare(
        `SELECT j.*, ${CARD_SUMMARY_SQL} FROM ai_jobs j JOIN cards c ON c.id = j.card_id
         WHERE j.status IN ('queued', 'running') OR j.finished_at >= ?
         ORDER BY j.id DESC LIMIT 500`,
      )
      .all(since) as Record<string, unknown>[];
    res.json(rows.map((row) => ({ ...jobFromRow(row), card: summaryFromPrefixed(row) })));
  });
  r.post('/ai/retry-failed', (_req, res) => {
    res.json({ retried: jobs.retryFailed() });
  });
  r.post('/ai/cancel-queued', (_req, res) => {
    res.json({ cancelled: jobs.cancelQueued() });
  });

  return r;
}
