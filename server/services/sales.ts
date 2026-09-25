import { z } from 'zod';
import { FULFILLMENT_STATUSES } from '../../shared/constants';
import { estimateFeesCents, formatCents } from '../../shared/money';
import type { Listing, Sale } from '../../shared/types';
import type { Db } from '../db';
import { badRequest, notFound } from '../lib/http';
import { searchClause } from '../lib/search';
import { isIsoDate, nowIso, today } from '../lib/time';
import { getCardRow, recomputeStatus } from './cards';
import { CARD_SUMMARY_SQL, logActivity, platformName } from './common';
import { endListings } from './listings';
import { listingFromRow, platformFromRow, saleFromRow } from './serializers';
import { getSettings } from './settings';

const text = (max: number) => z.string().trim().max(max);
const cents = z.number().int().min(0).max(1_000_000_000);
const isoDate = z.string().refine(isIsoDate, 'Use a date like 2025-01-31');

export const saleCreateSchema = z
  .object({
    platform_id: z.number().int().positive().nullable().optional(),
    inquiry_id: z.number().int().positive().nullable().optional(),
    quantity: z.number().int().min(1).max(100_000).default(1),
    sale_price_cents: cents,
    shipping_charged_cents: cents.default(0),
    shipping_cost_cents: cents.default(0),
    fees_cents: cents.nullable().optional(),
    other_costs_cents: cents.default(0),
    buyer_name: text(200).default(''),
    buyer_contact: text(300).default(''),
    payment_method: text(60).default(''),
    sold_on: isoDate.optional(),
    fulfillment: z.enum(FULFILLMENT_STATUSES).optional(),
    tracking_number: text(100).default(''),
    notes: text(5000).default(''),
    end_other_listings: z.boolean().default(false),
  })
  .strict();

export const salePatchSchema = z
  .object({
    platform_id: z.number().int().positive().nullable(),
    quantity: z.number().int().min(1).max(100_000),
    sale_price_cents: cents,
    shipping_charged_cents: cents,
    shipping_cost_cents: cents,
    fees_cents: cents,
    other_costs_cents: cents,
    cost_basis_cents: cents,
    buyer_name: text(200),
    buyer_contact: text(300),
    payment_method: text(60),
    sold_on: isoDate,
    fulfillment: z.enum(FULFILLMENT_STATUSES),
    tracking_number: text(100),
    notes: text(5000),
  })
  .partial()
  .strict();

function getSaleRow(db: Db, id: number): Record<string, unknown> {
  const row = db
    .prepare(`SELECT s.*, ${CARD_SUMMARY_SQL} FROM sales s JOIN cards c ON c.id = s.card_id WHERE s.id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Sale not found');
  return row;
}

export function getSale(db: Db, id: number): Sale {
  return saleFromRow(getSaleRow(db, id));
}

export interface CreateSaleResult {
  sale: Sale;
  /** Listings still up on other sites for a card that is now sold out — take these down! */
  still_listed: Listing[];
}

export function createSale(db: Db, cardId: number, input: unknown): CreateSaleResult {
  const data = saleCreateSchema.parse(input);
  const card = getCardRow(db, cardId);
  const remaining = card.quantity - card.quantity_sold;
  if (remaining <= 0) throw badRequest('Every copy of this card is already sold.');
  if (data.quantity > remaining) throw badRequest(`Only ${remaining} left to sell`);

  const platformRow = data.platform_id
    ? (db.prepare('SELECT * FROM platforms WHERE id = ?').get(data.platform_id) as Record<string, unknown> | undefined)
    : undefined;
  if (data.platform_id && !platformRow) throw badRequest('Unknown platform');
  const platform = platformRow ? platformFromRow(platformRow) : null;
  if (data.inquiry_id && !db.prepare('SELECT 1 FROM inquiries WHERE id = ? AND card_id = ?').get(data.inquiry_id, cardId)) {
    throw badRequest('That inquiry is for a different card');
  }

  const fees =
    data.fees_cents === null || data.fees_cents === undefined
      ? estimateFeesCents(platform, data.sale_price_cents, data.shipping_charged_cents)
      : data.fees_cents;
  const fulfillment = data.fulfillment ?? (platform?.kind === 'in_person' ? 'picked_up' : 'pending');
  const soldOn = data.sold_on ?? today();
  const settings = getSettings(db);
  const now = nowIso();

  let stillListed: Listing[] = [];
  const saleId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO sales (card_id, platform_id, inquiry_id, quantity, sale_price_cents, shipping_charged_cents, shipping_cost_cents,
           fees_cents, other_costs_cents, cost_basis_cents, buyer_name, buyer_contact, payment_method, sold_on, fulfillment,
           tracking_number, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cardId,
        data.platform_id ?? null,
        data.inquiry_id ?? null,
        data.quantity,
        data.sale_price_cents,
        data.shipping_charged_cents,
        data.shipping_cost_cents,
        fees,
        data.other_costs_cents,
        (card.cost_cents ?? 0) * data.quantity,
        data.buyer_name,
        data.buyer_contact,
        data.payment_method,
        soldOn,
        fulfillment,
        data.tracking_number,
        data.notes,
        now,
        now,
      );
    const id = Number(info.lastInsertRowid);

    const soldOut = data.quantity >= remaining;
    if (soldOut && data.platform_id) {
      db.prepare(
        "UPDATE listings SET status = 'sold', ended_at = ?, updated_at = ? WHERE card_id = ? AND platform_id = ? AND status = 'active'",
      ).run(soldOn, now, cardId, data.platform_id);
    }
    if (data.inquiry_id) {
      db.prepare("UPDATE inquiries SET status = 'closed', updated_at = ? WHERE id = ?").run(now, data.inquiry_id);
    }
    const where = data.platform_id ? ` on ${platformName(db, data.platform_id)}` : '';
    const buyer = data.buyer_name ? ` to ${data.buyer_name}` : '';
    const qty = data.quantity > 1 ? `${data.quantity} × ` : '';
    logActivity(
      db,
      cardId,
      'sold',
      `Sold ${qty}${where}${buyer} for ${formatCents(data.sale_price_cents, settings.currency, settings.locale)}`,
    );

    if (soldOut) {
      const others = db
        .prepare("SELECT * FROM listings WHERE card_id = ? AND status = 'active'")
        .all(cardId) as Record<string, unknown>[];
      if (data.end_other_listings) endListings(db, others.map((l) => Number(l.id)));
      else stillListed = others.map(listingFromRow);
    }
    recomputeStatus(db, cardId);
    db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now, cardId);
    return id;
  })();

  return { sale: getSale(db, saleId), still_listed: stillListed };
}

export function updateSale(db: Db, id: number, input: unknown): Sale {
  const data = salePatchSchema.parse(input);
  const before = getSale(db, id);
  if (data.platform_id && !db.prepare('SELECT 1 FROM platforms WHERE id = ?').get(data.platform_id)) {
    throw badRequest('Unknown platform');
  }
  if (data.quantity !== undefined && data.quantity !== before.quantity) {
    const card = getCardRow(db, before.card_id);
    const available = card.quantity - card.quantity_sold + before.quantity;
    if (data.quantity > available) throw badRequest(`Only ${available} available for this sale`);
  }
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return before;
  db.transaction(() => {
    db.prepare(`UPDATE sales SET ${entries.map(([k]) => `${k} = @${k}`).join(', ')}, updated_at = @__now WHERE id = @__id`).run({
      ...Object.fromEntries(entries),
      __now: nowIso(),
      __id: id,
    });
    recomputeStatus(db, before.card_id);
  })();
  return getSale(db, id);
}

export function deleteSale(db: Db, id: number): void {
  const sale = getSale(db, id);
  const settings = getSettings(db);
  db.transaction(() => {
    db.prepare('DELETE FROM sales WHERE id = ?').run(id);
    recomputeStatus(db, sale.card_id);
    logActivity(
      db,
      sale.card_id,
      'sold',
      `Sale of ${formatCents(sale.sale_price_cents, settings.currency, settings.locale)} removed`,
    );
  })();
}

export const saleQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  platform: z.coerce.number().int().positive().optional(),
  fulfillment: z.string().trim().max(40).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(1000).default(100),
});

export function saleWhere(query: Partial<z.infer<typeof saleQuerySchema>>): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.from) {
    clauses.push('s.sold_on >= ?');
    params.push(query.from);
  }
  if (query.to) {
    clauses.push('s.sold_on <= ?');
    params.push(query.to);
  }
  if (query.platform) {
    clauses.push('s.platform_id = ?');
    params.push(query.platform);
  }
  if (query.fulfillment === 'open') clauses.push("s.fulfillment = 'pending'");
  else if (query.fulfillment && (FULFILLMENT_STATUSES as readonly string[]).includes(query.fulfillment)) {
    clauses.push('s.fulfillment = ?');
    params.push(query.fulfillment);
  }
  if (query.q) {
    const s = searchClause(query.q, "(lower(s.buyer_name || ' ' || s.buyer_contact || ' ' || s.notes || ' ' || s.tracking_number) || c.search_text)");
    if (s.sql) {
      clauses.push(`(${s.sql})`);
      params.push(...s.params);
    }
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function listSales(
  db: Db,
  query: z.infer<typeof saleQuerySchema>,
): { sales: Sale[]; total: number; totals: { gross_cents: number; fees_cents: number; net_cents: number; count: number } } {
  const { where, params } = saleWhere(query);
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS n,
         COALESCE(SUM(s.sale_price_cents + s.shipping_charged_cents), 0) AS gross,
         COALESCE(SUM(s.fees_cents), 0) AS fees,
         COALESCE(SUM(s.sale_price_cents + s.shipping_charged_cents - s.shipping_cost_cents - s.fees_cents - s.other_costs_cents - s.cost_basis_cents), 0) AS net
       FROM sales s JOIN cards c ON c.id = s.card_id ${where}`,
    )
    .get(...params) as { n: number; gross: number; fees: number; net: number };
  const rows = db
    .prepare(
      `SELECT s.*, ${CARD_SUMMARY_SQL} FROM sales s JOIN cards c ON c.id = s.card_id ${where}
       ORDER BY s.sold_on DESC, s.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, query.page_size, (query.page - 1) * query.page_size) as Record<string, unknown>[];
  return {
    sales: rows.map(saleFromRow),
    total: agg.n,
    totals: { gross_cents: agg.gross, fees_cents: agg.fees, net_cents: agg.net, count: agg.n },
  };
}
