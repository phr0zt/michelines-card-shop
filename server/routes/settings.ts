import { Router } from 'express';
import type { AppContext } from '../context';
import { CARD_SUMMARY_SQL } from '../services/common';
import { jobFromRow } from '../services/serializers';
import { summaryFromPrefixed } from '../services/common';
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
