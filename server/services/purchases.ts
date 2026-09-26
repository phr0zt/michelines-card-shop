import { z } from 'zod';
import { COST_ALLOCATION_METHODS, type CostAllocationMethod } from '../../shared/constants';
import { allocateCents, formatCents } from '../../shared/money';
import type { AllocationPreview, Purchase, PurchaseDetail } from '../../shared/types';
import type { Db } from '../db';
import { badRequest, notFound } from '../lib/http';
import { isIsoDate, nowIso, today } from '../lib/time';
import { refreshSaleCosts } from './cards';
import { logActivity } from './common';
import { purchaseFromRow } from './serializers';
import { getSettings } from './settings';

const text = (max: number) => z.string().trim().max(max);
const isoDate = z.string().refine(isIsoDate, 'Use a date like 2025-01-31');

export const purchaseCreateSchema = z
  .object({
    purchased_on: isoDate.optional(),
    source: text(200).default(''),
    description: text(500).default(''),
    total_cost_cents: z.number().int().min(0).max(1_000_000_000),
    notes: text(5000).default(''),
  })
  .strict();

export const purchasePatchSchema = z
  .object({
    purchased_on: isoDate,
    source: text(200),
    description: text(500),
    total_cost_cents: z.number().int().min(0).max(1_000_000_000),
    notes: text(5000),
  })
  .partial()
  .strict();

const PURCHASE_SQL = `SELECT p.*,
  (SELECT COUNT(*) FROM cards x WHERE x.purchase_id = p.id) AS card_count,
  (SELECT COALESCE(SUM(COALESCE(x.cost_cents, 0) * x.quantity), 0) FROM cards x WHERE x.purchase_id = p.id) AS allocated_cents
  FROM purchases p`;

export function getPurchase(db: Db, id: number): Purchase {
  const row = db.prepare(`${PURCHASE_SQL} WHERE p.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Purchase not found');
  return purchaseFromRow(row);
}

/** How a lot is paying off: what its cards sold for, the profit, and what's left. */
export function getPurchaseDetail(db: Db, id: number): PurchaseDetail {
  const purchase = getPurchase(db, id);
  const inv = db
    .prepare(
      `SELECT COUNT(*) AS cards, COALESCE(SUM(quantity), 0) AS units, COALESCE(SUM(quantity_sold), 0) AS sold_units,
         COALESCE(SUM(COALESCE(market_value_cents, 0) * (quantity - quantity_sold)), 0) AS remaining_value_cents
       FROM cards WHERE purchase_id = ?`,
    )
    .get(id) as { cards: number; units: number; sold_units: number; remaining_value_cents: number };
  const sales = db
    .prepare(
      `SELECT COALESCE(SUM(s.sale_price_cents + s.shipping_charged_cents), 0) AS revenue,
         COALESCE(SUM(s.sale_price_cents + s.shipping_charged_cents - s.shipping_cost_cents - s.fees_cents - s.other_costs_cents), 0) AS after_costs
       FROM sales s JOIN cards c ON c.id = s.card_id WHERE c.purchase_id = ?`,
    )
    .get(id) as { revenue: number; after_costs: number };
  return {
    ...purchase,
    stats: {
      cards: inv.cards,
      units: inv.units,
      sold_units: inv.sold_units,
      revenue_cents: sales.revenue,
      // Profit on the lot as a whole: sale proceeds minus selling costs minus what the lot cost.
      profit_cents: sales.after_costs - purchase.total_cost_cents,
      remaining_value_cents: inv.remaining_value_cents,
    },
  };
}

export function listPurchases(db: Db): Purchase[] {
  return (db.prepare(`${PURCHASE_SQL} ORDER BY p.purchased_on DESC, p.id DESC`).all() as Record<string, unknown>[]).map(
    purchaseFromRow,
  );
}

export function createPurchase(db: Db, input: unknown): Purchase {
  const data = purchaseCreateSchema.parse(input);
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO purchases (purchased_on, source, description, total_cost_cents, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(data.purchased_on ?? today(), data.source, data.description, data.total_cost_cents, data.notes, now, now);
  return getPurchase(db, Number(info.lastInsertRowid));
}

export function updatePurchase(db: Db, id: number, input: unknown): Purchase {
  const data = purchasePatchSchema.parse(input);
  getPurchase(db, id);
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length > 0) {
    db.prepare(
      `UPDATE purchases SET ${entries.map(([k]) => `${k} = @${k}`).join(', ')}, updated_at = @__now WHERE id = @__id`,
    ).run({ ...Object.fromEntries(entries), __now: nowIso(), __id: id });
  }
  return getPurchase(db, id);
}

export function deletePurchase(db: Db, id: number): void {
  getPurchase(db, id);
  db.prepare('DELETE FROM purchases WHERE id = ?').run(id);
}

/** Link cards to a purchase; fills in acquired date/source when those are blank. */
export function assignCards(db: Db, purchaseId: number, cardIds: number[]): number {
  const purchase = getPurchase(db, purchaseId);
  const now = nowIso();
  let n = 0;
  db.transaction(() => {
    const stmt = db.prepare(
      `UPDATE cards SET purchase_id = ?,
         acquired_date = COALESCE(acquired_date, ?),
         acquired_from = CASE WHEN acquired_from = '' THEN ? ELSE acquired_from END,
         updated_at = ?
       WHERE id = ?`,
    );
    for (const id of cardIds) {
      n += stmt.run(purchaseId, purchase.purchased_on, purchase.source, now, id).changes;
    }
  })();
  return n;
}

export function unassignCards(db: Db, purchaseId: number, cardIds: number[]): number {
  let n = 0;
  db.transaction(() => {
    const stmt = db.prepare('UPDATE cards SET purchase_id = NULL, updated_at = ? WHERE id = ? AND purchase_id = ?');
    for (const id of cardIds) n += stmt.run(nowIso(), id, purchaseId).changes;
  })();
  return n;
}

/**
 * Spread a purchase's total cost across its cards so every sale shows real
 * profit. "even" splits per unit; "by_value" weights by estimated market value
 * (cards without a value get the average of those that have one).
 */
export function previewAllocation(db: Db, purchaseId: number, method: CostAllocationMethod): AllocationPreview {
  if (!(COST_ALLOCATION_METHODS as readonly string[]).includes(method)) throw badRequest('Unknown allocation method');
  const purchase = getPurchase(db, purchaseId);
  const cards = db
    .prepare('SELECT id, quantity, market_value_cents FROM cards WHERE purchase_id = ? ORDER BY id')
    .all(purchaseId) as { id: number; quantity: number; market_value_cents: number | null }[];
  if (cards.length === 0) return { method, total_cents: purchase.total_cost_cents, allocations: [] };

  let weights: number[];
  if (method === 'even') {
    weights = cards.map((c) => c.quantity);
  } else {
    const known = cards.filter((c) => c.market_value_cents !== null && c.market_value_cents > 0);
    const avg = known.length ? known.reduce((a, c) => a + (c.market_value_cents ?? 0), 0) / known.length : 1;
    weights = cards.map((c) => (c.market_value_cents && c.market_value_cents > 0 ? c.market_value_cents : avg) * c.quantity);
  }
  const totals = allocateCents(purchase.total_cost_cents, weights);
  return {
    method,
    total_cents: purchase.total_cost_cents,
    allocations: cards.map((c, i) => ({ card_id: c.id, cost_cents: Math.round(totals[i] / Math.max(1, c.quantity)) })),
  };
}

export function applyAllocation(db: Db, purchaseId: number, method: CostAllocationMethod): AllocationPreview {
  const preview = previewAllocation(db, purchaseId, method);
  const settings = getSettings(db);
  db.transaction(() => {
    const stmt = db.prepare('UPDATE cards SET cost_cents = ?, updated_at = ? WHERE id = ?');
    for (const a of preview.allocations) {
      stmt.run(a.cost_cents, nowIso(), a.card_id);
      refreshSaleCosts(db, a.card_id);
      logActivity(
        db,
        a.card_id,
        'cost',
        `Cost set to ${formatCents(a.cost_cents, settings.currency, settings.locale)} from purchase #${purchaseId}`,
      );
    }
  })();
  return preview;
}
