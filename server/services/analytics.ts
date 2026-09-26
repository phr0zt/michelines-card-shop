import { OPEN_INQUIRY_STATUSES } from '../../shared/constants';
import type {
  Attention,
  CardSummary,
  CategoryStat,
  Dashboard,
  ListingAlert,
  Mover,
  Overview,
  PlatformStat,
  PnlReport,
  PnlRow,
  TimePoint,
  ValuePoint,
} from '../../shared/types';
import type { Db } from '../db';
import { addDays, daysBetween, today } from '../lib/time';
import { OPEN_FAILED_JOBS } from './ai/jobs';
import { CARD_SUMMARY_SQL, summaryFromPrefixed } from './common';
import { activityFromRow, inquiryFromRow, saleFromRow } from './serializers';
import { getSettings } from './settings';

export type Group = 'month' | 'week' | 'day';

const OPEN_SQL = OPEN_INQUIRY_STATUSES.map((s) => `'${s}'`).join(',');

export function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  return { from: today(from), to: today(now) };
}

interface SaleAggRow {
  sold_on: string;
  quantity: number;
  sale_price_cents: number;
  shipping_charged_cents: number;
  shipping_cost_cents: number;
  fees_cents: number;
  other_costs_cents: number;
  cost_basis_cents: number;
  platform_id: number | null;
  card_id: number;
}

function salesInRange(db: Db, from: string, to: string): SaleAggRow[] {
  return db
    .prepare(
      `SELECT sold_on, quantity, sale_price_cents, shipping_charged_cents, shipping_cost_cents, fees_cents,
              other_costs_cents, cost_basis_cents, platform_id, card_id
       FROM sales WHERE sold_on >= ? AND sold_on <= ?`,
    )
    .all(from, to) as SaleAggRow[];
}

function emptyPnl(period: string): PnlRow {
  return {
    period,
    sales: 0,
    units: 0,
    item_cents: 0,
    shipping_income_cents: 0,
    gross_cents: 0,
    fees_cents: 0,
    shipping_cost_cents: 0,
    other_costs_cents: 0,
    cogs_cents: 0,
    net_cents: 0,
    purchases_cents: 0,
  };
}

function addSale(row: PnlRow, s: SaleAggRow): void {
  row.sales += 1;
  row.units += s.quantity;
  row.item_cents += s.sale_price_cents;
  row.shipping_income_cents += s.shipping_charged_cents;
  row.gross_cents += s.sale_price_cents + s.shipping_charged_cents;
  row.fees_cents += s.fees_cents;
  row.shipping_cost_cents += s.shipping_cost_cents;
  row.other_costs_cents += s.other_costs_cents;
  row.cogs_cents += s.cost_basis_cents;
  row.net_cents +=
    s.sale_price_cents +
    s.shipping_charged_cents -
    s.shipping_cost_cents -
    s.fees_cents -
    s.other_costs_cents -
    s.cost_basis_cents;
}

/** Bucket label for a YYYY-MM-DD date: "2025-03" (month), the Monday "2025-03-10" (week), or the day. */
export function bucketKey(date: string, group: Group): string {
  if (group === 'month') return date.slice(0, 7);
  if (group === 'day') return date.slice(0, 10);
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const offset = (dt.getDay() + 6) % 7; // days since Monday
  dt.setDate(dt.getDate() - offset);
  return today(dt);
}

/**
 * Where a report's periods should start. Ranges up to a year are shown whole;
 * longer ones (like "All time") start at the first sale or purchase instead of
 * listing years of empty periods.
 */
export function periodsStart(db: Db, from: string, to: string): string {
  const yearBack = addDays(to, -365);
  if (from >= yearBack) return from;
  const first = (
    db.prepare('SELECT MIN(d) AS d FROM (SELECT MIN(sold_on) AS d FROM sales UNION ALL SELECT MIN(purchased_on) FROM purchases)').get() as {
      d: string | null;
    }
  ).d;
  const start = first && first < yearBack ? first : yearBack;
  return start > from ? start : from;
}

export function bucketsBetween(from: string, to: string, group: Group): string[] {
  const keys: string[] = [];
  if (group === 'month') {
    let [y, m] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) {
      keys.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
      if (keys.length > 1200) break;
    }
    return keys;
  }
  let cursor = bucketKey(from, group);
  const step = group === 'week' ? 7 : 1;
  while (cursor <= to && keys.length < 4000) {
    keys.push(cursor);
    cursor = addDays(cursor, step);
  }
  return keys;
}

export function overview(db: Db, from: string, to: string): Overview {
  const inv = db
    .prepare(
      `SELECT COUNT(*) AS cards,
         COALESCE(SUM(quantity - quantity_sold), 0) AS units,
         COALESCE(SUM(COALESCE(market_value_cents, 0) * (quantity - quantity_sold)), 0) AS value_cents,
         COALESCE(SUM(COALESCE(cost_cents, 0) * (quantity - quantity_sold)), 0) AS cost_cents,
         COALESCE(SUM(market_value_cents IS NULL), 0) AS missing_value,
         COALESCE(SUM(status = 'draft'), 0) AS drafts,
         COALESCE(SUM(status = 'listed'), 0) AS listed_cards,
         COALESCE(SUM(is_public = 1 AND status IN ('in_stock', 'listed', 'pending')), 0) AS public_cards,
         COALESCE(SUM(status = 'keeper'), 0) AS keepers
       FROM cards WHERE status != 'sold'`,
    )
    .get() as Overview['inventory'];
  const activeListings = (
    db
      .prepare("SELECT COUNT(*) AS n FROM listings l JOIN cards c ON c.id = l.card_id WHERE l.status = 'active' AND c.status != 'sold'")
      .get() as { n: number }
  ).n;

  const totals = emptyPnl('total');
  for (const s of salesInRange(db, from, to)) addSale(totals, s);

  const days = db
    .prepare(
      `SELECT AVG(MAX(0, julianday(s.sold_on) - julianday(COALESCE(
           (SELECT MIN(l.listed_at) FROM listings l WHERE l.card_id = s.card_id AND l.listed_at IS NOT NULL),
           substr(c.created_at, 1, 10))))) AS d
       FROM sales s JOIN cards c ON c.id = s.card_id WHERE s.sold_on >= ? AND s.sold_on <= ?`,
    )
    .get(from, to) as { d: number | null };

  const inquiries = db
    .prepare(
      `SELECT
         COALESCE(SUM(status IN (${OPEN_SQL})), 0) AS open,
         COALESCE(SUM(substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?), 0) AS new_in_period,
         COALESCE(SUM(status IN (${OPEN_SQL}) AND follow_up_on IS NOT NULL AND follow_up_on <= ?), 0) AS follow_ups_due
       FROM inquiries`,
    )
    .get(from, to, today()) as Overview['inquiries'];

  const purchases = db
    .prepare(
      'SELECT COUNT(*) AS count, COALESCE(SUM(total_cost_cents), 0) AS spent_cents FROM purchases WHERE purchased_on >= ? AND purchased_on <= ?',
    )
    .get(from, to) as Overview['purchases'];

  const forSale = (
    db
      .prepare("SELECT COALESCE(SUM(quantity - quantity_sold), 0) AS n FROM cards WHERE status IN ('in_stock', 'listed', 'pending')")
      .get() as { n: number }
  ).n;

  return {
    period: { from, to },
    inventory: { ...inv, active_listings: activeListings },
    sales: {
      count: totals.sales,
      units: totals.units,
      item_cents: totals.item_cents,
      shipping_income_cents: totals.shipping_income_cents,
      gross_cents: totals.gross_cents,
      fees_cents: totals.fees_cents,
      shipping_cost_cents: totals.shipping_cost_cents,
      other_costs_cents: totals.other_costs_cents,
      cogs_cents: totals.cogs_cents,
      net_cents: totals.net_cents,
      avg_sale_cents: totals.sales ? Math.round(totals.item_cents / totals.sales) : null,
      margin_pct: totals.gross_cents > 0 ? Math.round((totals.net_cents / totals.gross_cents) * 1000) / 10 : null,
      avg_days_to_sell: days.d === null ? null : Math.round(days.d * 10) / 10,
    },
    inquiries,
    purchases,
    sell_through_pct:
      totals.units + forSale > 0 ? Math.round((totals.units / (totals.units + forSale)) * 1000) / 10 : null,
  };
}

export function timeseries(db: Db, from: string, to: string, group: Group): TimePoint[] {
  const points = new Map<string, TimePoint>();
  for (const key of bucketsBetween(periodsStart(db, from, to), to, group)) {
    points.set(key, { period: key, sales: 0, units: 0, gross_cents: 0, fees_cents: 0, net_cents: 0, cards_added: 0, purchases_cents: 0 });
  }
  const get = (date: string) => points.get(bucketKey(date, group));
  for (const s of salesInRange(db, from, to)) {
    const p = get(s.sold_on);
    if (!p) continue;
    const row = emptyPnl('');
    addSale(row, s);
    p.sales += 1;
    p.units += row.units;
    p.gross_cents += row.gross_cents;
    p.fees_cents += row.fees_cents;
    p.net_cents += row.net_cents;
  }
  const added = db
    .prepare('SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS n FROM cards WHERE substr(created_at, 1, 10) BETWEEN ? AND ? GROUP BY d')
    .all(from, to) as { d: string; n: number }[];
  for (const a of added) {
    const p = get(a.d);
    if (p) p.cards_added += a.n;
  }
  const bought = db
    .prepare('SELECT purchased_on AS d, total_cost_cents AS c FROM purchases WHERE purchased_on BETWEEN ? AND ?')
    .all(from, to) as { d: string; c: number }[];
  for (const b of bought) {
    const p = get(b.d);
    if (p) p.purchases_cents += b.c;
  }
  return [...points.values()];
}

export function byPlatform(db: Db, from: string, to: string): PlatformStat[] {
  const platforms = db.prepare('SELECT id, name, color, active, sort_order FROM platforms ORDER BY sort_order, name').all() as {
    id: number;
    name: string;
    color: string;
    active: number;
  }[];
  const stats = new Map<number | null, PlatformStat>();
  for (const p of platforms) {
    stats.set(p.id, {
      platform_id: p.id,
      name: p.name,
      color: p.color,
      sales: 0,
      gross_cents: 0,
      fees_cents: 0,
      net_cents: 0,
      avg_days_to_sell: null,
      active_listings: 0,
      inquiries: 0,
    });
  }
  const other: PlatformStat = {
    platform_id: null,
    name: 'Other / not recorded',
    color: '#94a3b8',
    sales: 0,
    gross_cents: 0,
    fees_cents: 0,
    net_cents: 0,
    avg_days_to_sell: null,
    active_listings: 0,
    inquiries: 0,
  };
  for (const s of salesInRange(db, from, to)) {
    const st = (s.platform_id !== null ? stats.get(s.platform_id) : undefined) ?? other;
    const row = emptyPnl('');
    addSale(row, s);
    st.sales += 1;
    st.gross_cents += row.gross_cents;
    st.fees_cents += row.fees_cents;
    st.net_cents += row.net_cents;
  }
  const days = db
    .prepare(
      `SELECT s.platform_id AS pid, AVG(MAX(0, julianday(s.sold_on) - julianday(COALESCE(
           (SELECT MIN(l.listed_at) FROM listings l WHERE l.card_id = s.card_id AND l.listed_at IS NOT NULL),
           substr(c.created_at, 1, 10))))) AS d
       FROM sales s JOIN cards c ON c.id = s.card_id
       WHERE s.sold_on >= ? AND s.sold_on <= ? AND s.platform_id IS NOT NULL GROUP BY s.platform_id`,
    )
    .all(from, to) as { pid: number; d: number | null }[];
  for (const d of days) {
    const st = stats.get(d.pid);
    if (st && d.d !== null) st.avg_days_to_sell = Math.round(d.d * 10) / 10;
  }
  const active = db
    .prepare(
      `SELECT l.platform_id AS pid, COUNT(*) AS n FROM listings l JOIN cards c ON c.id = l.card_id
       WHERE l.status = 'active' AND c.status != 'sold' GROUP BY l.platform_id`,
    )
    .all() as { pid: number; n: number }[];
  for (const a of active) {
    const st = stats.get(a.pid);
    if (st) st.active_listings = a.n;
  }
  const inq = db
    .prepare(
      `SELECT platform_id AS pid, COUNT(*) AS n FROM inquiries
       WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ? GROUP BY platform_id`,
    )
    .all(from, to) as { pid: number | null; n: number }[];
  for (const i of inq) {
    const st = (i.pid !== null ? stats.get(i.pid) : undefined) ?? other;
    st.inquiries += i.n;
  }
  const activeIds = new Set(platforms.filter((p) => p.active).map((p) => p.id));
  const result = [...stats.values()].filter(
    (s) => (s.platform_id !== null && activeIds.has(s.platform_id)) || s.sales > 0 || s.active_listings > 0 || s.inquiries > 0,
  );
  if (other.sales > 0 || other.inquiries > 0) result.push(other);
  return result;
}

export function byCategory(db: Db, from: string, to: string): CategoryStat[] {
  const inv = db
    .prepare(
      `SELECT category, COUNT(*) AS cards, COALESCE(SUM(quantity - quantity_sold), 0) AS units,
         COALESCE(SUM(COALESCE(market_value_cents, 0) * (quantity - quantity_sold)), 0) AS value_cents
       FROM cards WHERE status != 'sold' GROUP BY category`,
    )
    .all() as { category: string; cards: number; units: number; value_cents: number }[];
  const sold = db
    .prepare(
      `SELECT c.category, COALESCE(SUM(s.quantity), 0) AS units, COALESCE(SUM(s.sale_price_cents + s.shipping_charged_cents), 0) AS gross
       FROM sales s JOIN cards c ON c.id = s.card_id WHERE s.sold_on >= ? AND s.sold_on <= ? GROUP BY c.category`,
    )
    .all(from, to) as { category: string; units: number; gross: number }[];
  const map = new Map<string, CategoryStat>();
  for (const i of inv) {
    map.set(i.category, { category: i.category, cards: i.cards, units: i.units, value_cents: i.value_cents, sold_units: 0, sold_gross_cents: 0 });
  }
  for (const s of sold) {
    const st = map.get(s.category) ?? { category: s.category, cards: 0, units: 0, value_cents: 0, sold_units: 0, sold_gross_cents: 0 };
    st.sold_units = s.units;
    st.sold_gross_cents = s.gross;
    map.set(s.category, st);
  }
  return [...map.values()].sort((a, b) => b.value_cents - a.value_cents || b.sold_gross_cents - a.sold_gross_cents);
}

/** Upsert today's total inventory value so the dashboard can chart it over time. */
export function recordValueSnapshot(db: Db): void {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cards,
         COALESCE(SUM(COALESCE(market_value_cents, 0) * (quantity - quantity_sold)), 0) AS value_cents,
         COALESCE(SUM(COALESCE(cost_cents, 0) * (quantity - quantity_sold)), 0) AS cost_cents
       FROM cards WHERE status != 'sold'`,
    )
    .get() as { cards: number; value_cents: number; cost_cents: number };
  db.prepare(
    `INSERT INTO value_snapshots (date, value_cents, cost_cents, cards) VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET value_cents = excluded.value_cents, cost_cents = excluded.cost_cents, cards = excluded.cards`,
  ).run(today(), row.value_cents, row.cost_cents, row.cards);
}

export function valueHistory(db: Db, from: string): ValuePoint[] {
  return db
    .prepare('SELECT date, value_cents, cost_cents, cards FROM value_snapshots WHERE date >= ? ORDER BY date')
    .all(from) as ValuePoint[];
}

function summaries(rows: Record<string, unknown>[]): CardSummary[] {
  return rows.map((r) => summaryFromPrefixed(r)).filter((s): s is CardSummary => Boolean(s));
}

export function topCards(db: Db, limit = 8): CardSummary[] {
  return summaries(
    db
      .prepare(
        `SELECT ${CARD_SUMMARY_SQL} FROM cards c
         WHERE c.status NOT IN ('sold') AND c.market_value_cents IS NOT NULL
         ORDER BY c.market_value_cents DESC LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[],
  );
}

export function movers(db: Db, limit = 6): Mover[] {
  const rows = db
    .prepare(
      `WITH ranked AS (
         SELECT card_id, mid_cents, created_at,
           ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY created_at DESC, id DESC) AS rn
         FROM price_checks WHERE mid_cents IS NOT NULL
       )
       SELECT a.card_id, a.mid_cents AS cur, b.mid_cents AS prev, a.created_at AS checked_at, ${CARD_SUMMARY_SQL}
       FROM ranked a
       JOIN ranked b ON b.card_id = a.card_id AND b.rn = 2
       JOIN cards c ON c.id = a.card_id
       WHERE a.rn = 1 AND b.mid_cents > 0 AND a.mid_cents != b.mid_cents AND c.status != 'sold'
       ORDER BY ABS(a.mid_cents - b.mid_cents) * 1.0 / b.mid_cents DESC
       LIMIT ?`,
    )
    .all(limit) as (Record<string, unknown> & { cur: number; prev: number; checked_at: string })[];
  return rows
    .map((r) => {
      const card = summaryFromPrefixed(r);
      if (!card) return null;
      return {
        card,
        previous_cents: r.prev,
        current_cents: r.cur,
        change_pct: Math.round(((r.cur - r.prev) / r.prev) * 1000) / 10,
        checked_at: r.checked_at,
      };
    })
    .filter((m): m is Mover => m !== null);
}

function listingAlerts(db: Db, where: string, params: unknown[], limit: number): ListingAlert[] {
  const rows = db
    .prepare(
      `SELECT l.id AS listing_id, l.platform_id, p.name AS platform_name, l.listed_at, l.price_cents, l.url, ${CARD_SUMMARY_SQL}
       FROM listings l JOIN cards c ON c.id = l.card_id JOIN platforms p ON p.id = l.platform_id
       WHERE ${where} ORDER BY l.listed_at, l.id LIMIT ?`,
    )
    .all(...params, limit) as Record<string, unknown>[];
  const now = today();
  return rows.map((r) => ({
    listing_id: r.listing_id as number,
    platform_id: r.platform_id as number,
    platform_name: r.platform_name as string,
    listed_at: (r.listed_at as string | null) ?? null,
    days_listed: r.listed_at ? daysBetween(r.listed_at as string, now) : null,
    price_cents: (r.price_cents as number | null) ?? null,
    url: (r.url as string) ?? '',
    card: summaryFromPrefixed(r)!,
  }));
}

export function attention(db: Db): Attention {
  const settings = getSettings(db);
  const now = today();
  const staleBefore = addDays(now, -settings.stale_listing_days);
  return {
    drafts: summaries(
      db
        .prepare(`SELECT ${CARD_SUMMARY_SQL} FROM cards c WHERE c.status = 'draft' ORDER BY c.id LIMIT 8`)
        .all() as Record<string, unknown>[],
    ),
    follow_ups: (
      db
        .prepare(
          `SELECT i.*, ${CARD_SUMMARY_SQL} FROM inquiries i JOIN cards c ON c.id = i.card_id
           WHERE i.status = 'new' OR (i.status IN (${OPEN_SQL}) AND i.follow_up_on IS NOT NULL AND i.follow_up_on <= ?)
           ORDER BY i.status != 'new', i.follow_up_on, i.id LIMIT 10`,
        )
        .all(now) as Record<string, unknown>[]
    ).map(inquiryFromRow),
    sold_still_listed: listingAlerts(db, "l.status = 'active' AND c.status = 'sold'", [], 20),
    stale_listings: listingAlerts(
      db,
      "l.status = 'active' AND c.status != 'sold' AND l.listed_at IS NOT NULL AND l.listed_at <= ?",
      [staleBefore],
      10,
    ),
    unfulfilled: (
      db
        .prepare(
          `SELECT s.*, ${CARD_SUMMARY_SQL} FROM sales s JOIN cards c ON c.id = s.card_id
           WHERE s.fulfillment = 'pending' ORDER BY s.sold_on, s.id LIMIT 10`,
        )
        .all() as Record<string, unknown>[]
    ).map(saleFromRow),
    high_value_unlisted: summaries(
      db
        .prepare(
          `SELECT ${CARD_SUMMARY_SQL} FROM cards c
           WHERE c.status = 'in_stock' AND c.market_value_cents >= ?
           ORDER BY c.market_value_cents DESC LIMIT 8`,
        )
        .all(settings.high_value_cents) as Record<string, unknown>[],
    ),
    no_asking_price: (
      db
        .prepare("SELECT COUNT(*) AS n FROM cards WHERE status IN ('in_stock', 'listed') AND asking_price_cents IS NULL")
        .get() as { n: number }
    ).n,
    failed_jobs: (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM (${OPEN_FAILED_JOBS})`,
        )
        .get() as { n: number }
    ).n,
  };
}

export function recentActivity(db: Db, limit = 15): Dashboard['recent_activity'] {
  const rows = db
    .prepare(
      `SELECT a.*, ${CARD_SUMMARY_SQL} FROM activity a LEFT JOIN cards c ON c.id = a.card_id
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => {
    const card = summaryFromPrefixed(r);
    return { ...activityFromRow(r), ...(card ? { card } : {}) };
  });
}

export function dashboard(db: Db, from: string, to: string, group: Group): Dashboard {
  recordValueSnapshot(db);
  return {
    overview: overview(db, from, to),
    timeseries: timeseries(db, from, to, group),
    platforms: byPlatform(db, from, to),
    categories: byCategory(db, from, to),
    value_history: valueHistory(db, addDays(today(), -365)),
    top_cards: topCards(db),
    movers: movers(db),
    attention: attention(db),
    recent_activity: recentActivity(db),
  };
}

export function pnl(db: Db, from: string, to: string, group: Group): PnlReport {
  const rows = new Map<string, PnlRow>();
  for (const key of bucketsBetween(periodsStart(db, from, to), to, group)) rows.set(key, emptyPnl(key));
  const totals = emptyPnl('total');
  for (const s of salesInRange(db, from, to)) {
    const row = rows.get(bucketKey(s.sold_on, group));
    if (row) addSale(row, s);
    addSale(totals, s);
  }
  const bought = db
    .prepare('SELECT purchased_on AS d, total_cost_cents AS c FROM purchases WHERE purchased_on BETWEEN ? AND ?')
    .all(from, to) as { d: string; c: number }[];
  for (const b of bought) {
    const row = rows.get(bucketKey(b.d, group));
    if (row) row.purchases_cents += b.c;
    totals.purchases_cents += b.c;
  }
  return {
    from,
    to,
    group,
    rows: [...rows.values()],
    totals,
    by_platform: byPlatform(db, from, to),
    by_category: byCategory(db, from, to),
  };
}
