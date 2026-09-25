import { z } from 'zod';
import { PRICE_CONFIDENCE, type PriceConfidence } from '../../shared/constants';
import { formatCents } from '../../shared/money';
import type { PriceCheck, PriceComp, PriceSource } from '../../shared/types';
import type { Db } from '../db';
import { notFound } from '../lib/http';
import { nowIso, today } from '../lib/time';
import { getCardRow } from './cards';
import { logActivity } from './common';
import { cleanUrl } from './listings';
import { priceCheckFromRow } from './serializers';
import { getSettings } from './settings';

export interface PriceResult {
  source: 'ai' | 'manual';
  currency: string;
  low_cents: number | null;
  mid_cents: number | null;
  high_cents: number | null;
  suggested_price_cents: number | null;
  quick_sale_cents: number | null;
  confidence: PriceConfidence | null;
  summary: string;
  advice: string;
  comps: PriceComp[];
  sources: PriceSource[];
  model: string;
}

export function savePriceCheck(db: Db, cardId: number, result: PriceResult): PriceCheck {
  const card = getCardRow(db, cardId);
  const settings = getSettings(db);
  const money = (c: number | null) => formatCents(c, settings.currency, settings.locale);
  const now = nowIso();
  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO price_checks (card_id, source, currency, low_cents, mid_cents, high_cents, suggested_price_cents,
           quick_sale_cents, confidence, summary, advice, comps_json, sources_json, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cardId,
        result.source,
        result.currency,
        result.low_cents,
        result.mid_cents,
        result.high_cents,
        result.suggested_price_cents,
        result.quick_sale_cents,
        result.confidence,
        result.summary,
        result.advice,
        JSON.stringify(result.comps),
        JSON.stringify(result.sources),
        result.model,
        now,
      );
    if (result.mid_cents !== null) {
      db.prepare(
        `UPDATE cards SET market_value_cents = ?, market_low_cents = ?, market_high_cents = ?, market_confidence = ?,
           market_checked_at = ?, updated_at = ?,
           asking_price_cents = COALESCE(asking_price_cents, ?),
           floor_price_cents = COALESCE(floor_price_cents, ?)
         WHERE id = ?`,
      ).run(
        result.mid_cents,
        result.low_cents,
        result.high_cents,
        result.confidence,
        now,
        now,
        card.asking_price_cents === null ? result.suggested_price_cents : null,
        card.floor_price_cents === null ? result.quick_sale_cents : null,
        cardId,
      );
      const range =
        result.low_cents !== null && result.high_cents !== null
          ? ` (range ${money(result.low_cents)}–${money(result.high_cents)})`
          : '';
      const who = result.source === 'ai' ? 'AI market research' : 'Manual price check';
      logActivity(db, cardId, 'value', `${who}: worth about ${money(result.mid_cents)}${range}`);
      if (card.asking_price_cents === null && result.suggested_price_cents !== null) {
        logActivity(db, cardId, 'price', `Asking price set to ${money(result.suggested_price_cents)} (suggested)`);
      }
    } else {
      logActivity(db, cardId, 'value', 'Market research found no reliable prices for this card');
    }
    return Number(info.lastInsertRowid);
  })();
  return priceCheckFromRow(db.prepare('SELECT * FROM price_checks WHERE id = ?').get(id) as Record<string, unknown>);
}

export const manualPriceSchema = z
  .object({
    mid_cents: z.number().int().min(0),
    low_cents: z.number().int().min(0).nullable().optional(),
    high_cents: z.number().int().min(0).nullable().optional(),
    summary: z.string().trim().max(2000).optional(),
    url: z.string().trim().max(2000).optional(),
    confidence: z.enum(PRICE_CONFIDENCE).optional(),
  })
  .strict();

export function addManualPriceCheck(db: Db, cardId: number, input: unknown): PriceCheck {
  const data = manualPriceSchema.parse(input);
  const settings = getSettings(db);
  const url = cleanUrl(data.url);
  return savePriceCheck(db, cardId, {
    source: 'manual',
    currency: settings.currency,
    low_cents: data.low_cents ?? null,
    mid_cents: data.mid_cents,
    high_cents: data.high_cents ?? null,
    suggested_price_cents: null,
    quick_sale_cents: null,
    confidence: data.confidence ?? null,
    summary: data.summary ?? '',
    advice: '',
    comps: url
      ? [
          {
            title: data.summary || 'Manual comp',
            price: data.mid_cents / 100,
            currency: settings.currency,
            date: today(),
            venue: new URL(url).hostname.replace(/^www\./, ''),
            url,
            grade: '',
            sold: true,
          },
        ]
      : [],
    sources: url ? [{ title: new URL(url).hostname, url }] : [],
    model: '',
  });
}

/** Deleting a check rolls the card's market value back to the newest remaining one. */
export function deletePriceCheck(db: Db, id: number): void {
  const row = db.prepare('SELECT card_id FROM price_checks WHERE id = ?').get(id) as { card_id: number } | undefined;
  if (!row) throw notFound('Price check not found');
  db.transaction(() => {
    db.prepare('DELETE FROM price_checks WHERE id = ?').run(id);
    const latest = db
      .prepare(
        'SELECT * FROM price_checks WHERE card_id = ? AND mid_cents IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1',
      )
      .get(row.card_id) as Record<string, unknown> | undefined;
    const pc = latest ? priceCheckFromRow(latest) : null;
    db.prepare(
      `UPDATE cards SET market_value_cents = ?, market_low_cents = ?, market_high_cents = ?, market_confidence = ?,
         market_checked_at = ?, updated_at = ? WHERE id = ?`,
    ).run(
      pc?.mid_cents ?? null,
      pc?.low_cents ?? null,
      pc?.high_cents ?? null,
      pc?.confidence ?? null,
      pc?.created_at ?? null,
      nowIso(),
      row.card_id,
    );
  })();
}
