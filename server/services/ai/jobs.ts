import type { AiJobKind } from '../../../shared/constants';
import type { AiJob, AiStatus } from '../../../shared/types';
import type { Db } from '../../db';
import { badRequest } from '../../lib/http';
import { nowIso } from '../../lib/time';
import { getCardRow } from '../cards';
import { logActivity } from '../common';
import type { ImageStore } from '../images';
import { savePriceCheck } from '../priceChecks';
import { jobFromRow } from '../serializers';
import { getSettings } from '../settings';
import type { AiClient } from './client';
import { estimateCostUsd, type UsageTotals } from './costs';
import { friendlyAiError } from './errors';
import { applyIdentification, runIdentification } from './identify';
import { runPricing } from './pricing';

/** The latest failed job per card and task, with nothing newer since: the ones worth retrying. */
export const OPEN_FAILED_JOBS = `SELECT j.id FROM ai_jobs j WHERE j.status = 'error' AND NOT EXISTS (
  SELECT 1 FROM ai_jobs k WHERE k.card_id = j.card_id AND k.kind = j.kind AND k.id > j.id)`;

export interface JobOptions {
  /** true replaces every field, false fills blanks only; unset decides by card (see applyIdentification). */
  overwrite?: boolean;
  categoryHint?: string;
  /** Queue market research after identification (defaults to the Settings switch). */
  thenPrice?: boolean;
}

interface JobRow {
  id: number;
  card_id: number;
  kind: AiJobKind;
  status: string;
  options_json: string;
}

/**
 * AI work runs in the background, a couple of jobs at a time, from a queue in
 * the database — so a batch of 200 photos survives a server restart.
 */
export class JobRunner {
  private running = 0;
  private idleWaiters: (() => void)[] = [];
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly images: ImageStore,
    private readonly client: AiClient | null,
    private readonly concurrency = 2,
  ) {}

  get configured(): boolean {
    return this.client !== null;
  }

  start(): void {
    this.db.prepare("UPDATE ai_jobs SET status = 'queued', started_at = NULL WHERE status = 'running'").run();
    this.kick();
  }

  stop(): void {
    this.stopped = true;
  }

  enqueue(cardId: number, kind: AiJobKind, options: JobOptions = {}): AiJob {
    if (!this.client) {
      throw badRequest('AI is not set up yet. Add ANTHROPIC_API_KEY to the server environment to turn it on.');
    }
    getCardRow(this.db, cardId);
    const existing = this.db
      .prepare("SELECT * FROM ai_jobs WHERE card_id = ? AND kind = ? AND status IN ('queued', 'running') ORDER BY id LIMIT 1")
      .get(cardId, kind) as Record<string, unknown> | undefined;
    if (existing) return jobFromRow(existing);
    const info = this.db
      .prepare('INSERT INTO ai_jobs (card_id, kind, status, options_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(cardId, kind, 'queued', JSON.stringify(options), nowIso());
    const job = jobFromRow(this.db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(info.lastInsertRowid) as Record<string, unknown>);
    queueMicrotask(() => this.kick());
    return job;
  }

  /**
   * Re-queues the latest failure per card and task (older attempts at the same
   * thing are left alone). A retried identification no longer forces
   * "replace everything", so edits made since the failure are kept.
   */
  retryFailed(): number {
    const n = this.db
      .prepare(
        `UPDATE ai_jobs SET status = 'queued', error = NULL, started_at = NULL, finished_at = NULL,
           options_json = json_remove(options_json, '$.overwrite')
         WHERE id IN (${OPEN_FAILED_JOBS})`,
      )
      .run().changes;
    this.kick();
    return n;
  }

  cancelQueued(): number {
    return this.db.prepare("DELETE FROM ai_jobs WHERE status = 'queued'").run().changes;
  }

  /** Resolves once nothing is queued or running (used by tests and graceful shutdown). */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private isIdle(): boolean {
    if (this.running > 0) return false;
    if (!this.client) return true;
    const queued = this.db.prepare("SELECT COUNT(*) AS n FROM ai_jobs WHERE status = 'queued'").get() as { n: number };
    return queued.n === 0;
  }

  private claim(): JobRow | undefined {
    return this.db
      .prepare(
        `UPDATE ai_jobs SET status = 'running', started_at = ?, attempts = attempts + 1
         WHERE id = (SELECT id FROM ai_jobs WHERE status = 'queued' ORDER BY id LIMIT 1)
         RETURNING id, card_id, kind, status, options_json`,
      )
      .get(nowIso()) as JobRow | undefined;
  }

  kick(): void {
    if (this.stopped || !this.client) {
      this.notifyIdle();
      return;
    }
    while (this.running < this.concurrency) {
      const job = this.claim();
      if (!job) break;
      this.running++;
      void this.run(job).finally(() => {
        this.running--;
        this.kick();
      });
    }
    this.notifyIdle();
  }

  private notifyIdle(): void {
    if (this.idleWaiters.length === 0 || !this.isIdle()) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((w) => w());
  }

  private finish(id: number, status: 'done' | 'error', model: string, usage: UsageTotals | null, error?: string): void {
    this.db
      .prepare(
        'UPDATE ai_jobs SET status = ?, error = ?, model = ?, usage_json = ?, cost_usd = ?, finished_at = ? WHERE id = ?',
      )
      .run(
        status,
        error ?? null,
        model,
        usage ? JSON.stringify(usage) : null,
        usage ? estimateCostUsd(model, usage) : null,
        nowIso(),
        id,
      );
  }

  private async run(job: JobRow): Promise<void> {
    const client = this.client;
    if (!client) return;
    const settings = getSettings(this.db);
    const options = JSON.parse(job.options_json || '{}') as JobOptions;
    const model = settings.ai_model;
    try {
      // The card may have been deleted while queued.
      if (!this.db.prepare('SELECT 1 FROM cards WHERE id = ?').get(job.card_id)) {
        this.finish(job.id, 'error', model, null, 'Card was deleted');
        return;
      }
      if (job.kind === 'identify') {
        const out = await runIdentification(client, this.db, this.images, job.card_id, model, settings.ai_effort_identify, {
          categoryHint: options.categoryHint,
        });
        if (this.db.prepare('SELECT 1 FROM cards WHERE id = ?').get(job.card_id)) {
          applyIdentification(this.db, job.card_id, out.identification, options.overwrite);
        }
        this.finish(job.id, 'done', out.model, out.usage);
        const thenPrice = options.thenPrice ?? settings.ai_auto_price;
        if (thenPrice && out.identification.is_trading_card && this.db.prepare('SELECT 1 FROM cards WHERE id = ?').get(job.card_id)) {
          this.enqueue(job.card_id, 'price');
        }
      } else {
        const out = await runPricing(client, this.db, job.card_id, settings, model, settings.ai_effort_price);
        if (this.db.prepare('SELECT 1 FROM cards WHERE id = ?').get(job.card_id)) {
          savePriceCheck(this.db, job.card_id, out.result);
        }
        this.finish(job.id, 'done', out.model, out.usage);
      }
    } catch (err) {
      const message = friendlyAiError(err);
      console.error(`AI ${job.kind} job ${job.id} failed:`, err);
      this.finish(job.id, 'error', model, null, message);
      if (this.db.prepare('SELECT 1 FROM cards WHERE id = ?').get(job.card_id)) {
        logActivity(this.db, job.card_id, 'ai', `AI ${job.kind === 'identify' ? 'identification' : 'price research'} failed: ${message}`);
      }
    }
  }

  status(): AiStatus {
    const settings = getSettings(this.db);
    const counts = this.db
      .prepare(
        `SELECT
           SUM(status = 'queued') AS queued,
           SUM(status = 'running') AS running,
           SUM(id IN (${OPEN_FAILED_JOBS})) AS failed
         FROM ai_jobs`,
      )
      .get() as { queued: number | null; running: number | null; failed: number | null };
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const month = this.db
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS cost FROM ai_jobs WHERE status = 'done' AND finished_at >= ?")
      .get(monthStart.toISOString()) as { n: number; cost: number };
    return {
      configured: this.configured,
      model: settings.ai_model,
      queued: counts.queued ?? 0,
      running: counts.running ?? 0,
      failed_recent: counts.failed ?? 0,
      month_cost_usd: Math.round(month.cost * 100) / 100,
      month_jobs: month.n,
    };
  }
}
