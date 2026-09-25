import { cardLabel } from '../../shared/cardText';
import type { CardStatus } from '../../shared/constants';
import type { CardImage, CardSummary, ImageSide } from '../../shared/types';
import type { Db } from '../db';
import { nowIso } from '../lib/time';
import { ImageStore } from './images';

export const bool = (v: unknown): boolean => v === 1 || v === true || v === '1';

export interface ImageRow {
  id: number;
  card_id: number;
  side: string;
  file_key: string;
  width: number | null;
  height: number | null;
  sort_order: number;
  created_at: string;
}

export function imageFromRow(row: ImageRow): CardImage {
  return {
    id: row.id,
    card_id: row.card_id,
    side: row.side as ImageSide,
    width: row.width,
    height: row.height,
    sort_order: row.sort_order,
    urls: ImageStore.urlsFor(row.file_key),
  };
}

/** Columns (aliased with a `c_` prefix) that describe a card in a joined list. Needs `cards c`. */
export const CARD_SUMMARY_SQL = `
  c.id AS c_id, c.sku AS c_sku, c.status AS c_status, c.year AS c_year, c.brand AS c_brand,
  c.set_name AS c_set_name, c.subset AS c_subset, c.card_number AS c_card_number, c.player AS c_player,
  c.market_value_cents AS c_market_value_cents, c.asking_price_cents AS c_asking_price_cents,
  (SELECT ci.file_key FROM card_images ci WHERE ci.card_id = c.id
     ORDER BY CASE ci.side WHEN 'front' THEN 0 WHEN 'back' THEN 1 ELSE 2 END, ci.sort_order, ci.id LIMIT 1) AS c_thumb_key`;

export function summaryFromPrefixed(row: Record<string, unknown>): CardSummary | undefined {
  if (row.c_id === null || row.c_id === undefined) return undefined;
  const thumbKey = row.c_thumb_key as string | null;
  return {
    id: row.c_id as number,
    sku: row.c_sku as string,
    status: row.c_status as CardStatus,
    label: cardLabel({
      year: row.c_year as string,
      brand: row.c_brand as string,
      set_name: row.c_set_name as string,
      subset: row.c_subset as string,
      card_number: row.c_card_number as string,
      player: row.c_player as string,
    }),
    thumb_url: thumbKey ? ImageStore.urlsFor(thumbKey).sm : null,
    market_value_cents: (row.c_market_value_cents as number | null) ?? null,
    asking_price_cents: (row.c_asking_price_cents as number | null) ?? null,
  };
}

export function cardSummaryById(db: Db, id: number): CardSummary | undefined {
  const row = db.prepare(`SELECT ${CARD_SUMMARY_SQL} FROM cards c WHERE c.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? summaryFromPrefixed(row) : undefined;
}

export function logActivity(db: Db, cardId: number | null, kind: string, message: string): void {
  db.prepare('INSERT INTO activity (card_id, kind, message, created_at) VALUES (?, ?, ?, ?)').run(
    cardId,
    kind,
    message,
    nowIso(),
  );
}

export function platformName(db: Db, platformId: number | null | undefined): string {
  if (!platformId) return 'unknown platform';
  const row = db.prepare('SELECT name FROM platforms WHERE id = ?').get(platformId) as { name: string } | undefined;
  return row?.name ?? 'unknown platform';
}
