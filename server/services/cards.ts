import crypto from 'node:crypto';
import { z } from 'zod';
import { CARD_STATUSES, MANUAL_STATUSES, OPEN_INQUIRY_STATUSES, type CardStatus } from '../../shared/constants';
import { formatCents } from '../../shared/money';
import type {
  Card,
  CardDetail,
  CardFacets,
  CardFields,
  CardImage,
  CardListResponse,
} from '../../shared/types';
import type { AiJobKind, PriceConfidence } from '../../shared/constants';
import type { Db } from '../db';
import { badRequest, conflict, notFound } from '../lib/http';
import { buildPublicSearchText, buildSearchText, searchClause } from '../lib/search';
import { isIsoDate, nowIso } from '../lib/time';
import { bool, CARD_SUMMARY_SQL, imageFromRow, logActivity, summaryFromPrefixed, type ImageRow } from './common';
import type { ImageStore } from './images';
import {
  activityFromRow,
  inquiryFromRow,
  jobFromRow,
  listingFromRow,
  priceCheckFromRow,
  purchaseFromRow,
  saleFromRow,
} from './serializers';
import { getSettings } from './settings';

export interface CardRow {
  id: number;
  sku: string;
  status: string;
  category: string;
  player: string;
  team: string;
  year: string;
  brand: string;
  set_name: string;
  subset: string;
  card_number: string;
  parallel: string;
  serial_number: string;
  is_rookie: number;
  is_autograph: number;
  is_memorabilia: number;
  is_graded: number;
  grading_company: string;
  grade: string;
  cert_number: string;
  condition: string;
  condition_notes: string;
  quantity: number;
  quantity_sold: number;
  location_binder: string;
  location_page: string;
  location_slot: string;
  cost_cents: number | null;
  acquired_date: string | null;
  acquired_from: string;
  purchase_id: number | null;
  market_value_cents: number | null;
  market_low_cents: number | null;
  market_high_cents: number | null;
  market_confidence: string | null;
  market_checked_at: string | null;
  asking_price_cents: number | null;
  floor_price_cents: number | null;
  title: string;
  description: string;
  notes: string;
  tags: string;
  is_public: number;
  featured: number;
  ai_identified_at: string | null;
  ai_confidence: number | null;
  ai_notes: string;
  search_text: string;
  public_search_text: string;
  created_at: string;
  updated_at: string;
  sold_at: string | null;
  listed_platforms?: string | null;
  open_inquiries?: number;
  active_job?: string | null;
}

const text = (max: number) => z.string().trim().max(max);
const cents = z.number().int().min(0).max(1_000_000_000);
const isoDate = z.string().refine(isIsoDate, 'Use a date like 2025-01-31');

export const cardFieldsSchema = z.object({
  category: text(60).min(1),
  player: text(200),
  team: text(120),
  year: text(20),
  brand: text(120),
  set_name: text(200),
  subset: text(200),
  card_number: text(40),
  parallel: text(200),
  serial_number: text(40),
  is_rookie: z.boolean(),
  is_autograph: z.boolean(),
  is_memorabilia: z.boolean(),
  is_graded: z.boolean(),
  grading_company: text(40),
  grade: text(20),
  cert_number: text(40),
  condition: text(40),
  condition_notes: text(2000),
  quantity: z.number().int().min(1).max(100_000),
  location_binder: text(120),
  location_page: text(20),
  location_slot: text(20),
  cost_cents: cents.nullable(),
  acquired_date: isoDate.nullable(),
  acquired_from: text(200),
  purchase_id: z.number().int().positive().nullable(),
  asking_price_cents: cents.nullable(),
  floor_price_cents: cents.nullable(),
  title: text(200),
  description: text(10_000),
  notes: text(20_000),
  tags: text(500),
  is_public: z.boolean(),
  featured: z.boolean(),
});

export const cardPatchSchema = cardFieldsSchema
  .extend({ status: z.enum(CARD_STATUSES) })
  .partial()
  .strict();

export type CardPatch = z.infer<typeof cardPatchSchema>;

export const CARD_DEFAULTS: CardFields = {
  category: 'Hockey',
  player: '',
  team: '',
  year: '',
  brand: '',
  set_name: '',
  subset: '',
  card_number: '',
  parallel: '',
  serial_number: '',
  is_rookie: false,
  is_autograph: false,
  is_memorabilia: false,
  is_graded: false,
  grading_company: '',
  grade: '',
  cert_number: '',
  condition: '',
  condition_notes: '',
  quantity: 1,
  location_binder: '',
  location_page: '',
  location_slot: '',
  cost_cents: null,
  acquired_date: null,
  acquired_from: '',
  purchase_id: null,
  asking_price_cents: null,
  floor_price_cents: null,
  title: '',
  description: '',
  notes: '',
  tags: '',
  is_public: false,
  featured: false,
};

const BOOL_FIELDS = new Set(['is_rookie', 'is_autograph', 'is_memorabilia', 'is_graded', 'is_public', 'featured']);

function toDbValue(key: string, value: unknown): unknown {
  if (BOOL_FIELDS.has(key)) return value ? 1 : 0;
  return value;
}

const LIST_EXTRAS_SQL = `
  (SELECT group_concat(DISTINCT l.platform_id) FROM listings l WHERE l.card_id = c.id AND l.status = 'active') AS listed_platforms,
  (SELECT COUNT(*) FROM inquiries i WHERE i.card_id = c.id AND i.status IN (${OPEN_INQUIRY_STATUSES.map((s) => `'${s}'`).join(',')})) AS open_inquiries,
  (SELECT j.kind FROM ai_jobs j WHERE j.card_id = c.id AND j.status IN ('queued','running') ORDER BY j.id LIMIT 1) AS active_job`;

export function rowToCard(row: CardRow, images: ImageRow[] = []): Card {
  const byside = (side: string) => {
    const img = images.filter((i) => i.side === side).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)[0];
    return img ? imageFromRow(img) : null;
  };
  return {
    id: row.id,
    sku: row.sku,
    status: row.status as CardStatus,
    category: row.category,
    player: row.player,
    team: row.team,
    year: row.year,
    brand: row.brand,
    set_name: row.set_name,
    subset: row.subset,
    card_number: row.card_number,
    parallel: row.parallel,
    serial_number: row.serial_number,
    is_rookie: bool(row.is_rookie),
    is_autograph: bool(row.is_autograph),
    is_memorabilia: bool(row.is_memorabilia),
    is_graded: bool(row.is_graded),
    grading_company: row.grading_company,
    grade: row.grade,
    cert_number: row.cert_number,
    condition: row.condition,
    condition_notes: row.condition_notes,
    quantity: row.quantity,
    quantity_sold: row.quantity_sold,
    location_binder: row.location_binder,
    location_page: row.location_page,
    location_slot: row.location_slot,
    cost_cents: row.cost_cents,
    acquired_date: row.acquired_date,
    acquired_from: row.acquired_from,
    purchase_id: row.purchase_id,
    market_value_cents: row.market_value_cents,
    market_low_cents: row.market_low_cents,
    market_high_cents: row.market_high_cents,
    market_confidence: (row.market_confidence as PriceConfidence | null) ?? null,
    market_checked_at: row.market_checked_at,
    asking_price_cents: row.asking_price_cents,
    floor_price_cents: row.floor_price_cents,
    title: row.title,
    description: row.description,
    notes: row.notes,
    tags: row.tags,
    is_public: bool(row.is_public),
    featured: bool(row.featured),
    ai_identified_at: row.ai_identified_at,
    ai_confidence: row.ai_confidence,
    ai_notes: row.ai_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    sold_at: row.sold_at,
    front_image: byside('front'),
    back_image: byside('back'),
    listed_platform_ids: (row.listed_platforms ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number),
    open_inquiry_count: row.open_inquiries ?? 0,
    active_job: (row.active_job as AiJobKind | null | undefined) ?? null,
  };
}

export function getCardRow(db: Db, id: number): CardRow {
  const row = db.prepare(`SELECT c.*, ${LIST_EXTRAS_SQL} FROM cards c WHERE c.id = ?`).get(id) as CardRow | undefined;
  if (!row) throw notFound('Card not found');
  return row;
}

function imagesFor(db: Db, cardIds: number[]): Map<number, ImageRow[]> {
  const map = new Map<number, ImageRow[]>();
  if (cardIds.length === 0) return map;
  const rows = db
    .prepare(`SELECT * FROM card_images WHERE card_id IN (${cardIds.map(() => '?').join(',')}) ORDER BY sort_order, id`)
    .all(...cardIds) as ImageRow[];
  for (const r of rows) {
    const list = map.get(r.card_id) ?? [];
    list.push(r);
    map.set(r.card_id, list);
  }
  return map;
}

export function getCard(db: Db, id: number): Card {
  const row = getCardRow(db, id);
  return rowToCard(row, imagesFor(db, [id]).get(id) ?? []);
}

export function getCardDetail(db: Db, id: number): CardDetail {
  const row = getCardRow(db, id);
  const images = (imagesFor(db, [id]).get(id) ?? []);
  const card = rowToCard(row, images);
  const listings = db
    .prepare('SELECT * FROM listings WHERE card_id = ? ORDER BY status = \'active\' DESC, id DESC')
    .all(id) as Record<string, unknown>[];
  const inquiries = db
    .prepare('SELECT * FROM inquiries WHERE card_id = ? ORDER BY id DESC')
    .all(id) as Record<string, unknown>[];
  const sales = db.prepare('SELECT * FROM sales WHERE card_id = ? ORDER BY sold_on DESC, id DESC').all(id) as Record<
    string,
    unknown
  >[];
  const priceChecks = db
    .prepare('SELECT * FROM price_checks WHERE card_id = ? ORDER BY created_at DESC, id DESC LIMIT 50')
    .all(id) as Record<string, unknown>[];
  const activity = db
    .prepare('SELECT * FROM activity WHERE card_id = ? ORDER BY id DESC LIMIT 200')
    .all(id) as Record<string, unknown>[];
  const jobs = db.prepare('SELECT * FROM ai_jobs WHERE card_id = ? ORDER BY id DESC LIMIT 10').all(id) as Record<
    string,
    unknown
  >[];
  const purchase = row.purchase_id
    ? (db
        .prepare(
          `SELECT p.*, (SELECT COUNT(*) FROM cards x WHERE x.purchase_id = p.id) AS card_count,
             (SELECT COALESCE(SUM(COALESCE(x.cost_cents, 0) * x.quantity), 0) FROM cards x WHERE x.purchase_id = p.id) AS allocated_cents
           FROM purchases p WHERE p.id = ?`,
        )
        .get(row.purchase_id) as Record<string, unknown> | undefined)
    : undefined;
  const duplicates =
    row.player && row.card_number
      ? (db
          .prepare(
            `SELECT ${CARD_SUMMARY_SQL} FROM cards c
             WHERE c.id != ? AND c.status != 'sold'
               AND c.player = ? COLLATE NOCASE AND c.year = ? COLLATE NOCASE AND c.card_number = ? COLLATE NOCASE
               AND c.set_name = ? COLLATE NOCASE AND c.parallel = ? COLLATE NOCASE
               AND c.is_graded = ? AND c.grade = ? COLLATE NOCASE
             ORDER BY c.id LIMIT 5`,
          )
          .all(id, row.player, row.year, row.card_number, row.set_name, row.parallel, row.is_graded, row.grade) as Record<string, unknown>[])
      : [];
  return {
    ...card,
    possible_duplicates: duplicates.map(summaryFromPrefixed).filter((d): d is NonNullable<typeof d> => Boolean(d)),
    images: images.map(imageFromRow).sort(sortImages),
    listings: listings.map(listingFromRow),
    inquiries: inquiries.map(inquiryFromRow),
    sales: sales.map(saleFromRow),
    price_checks: priceChecks.map(priceCheckFromRow),
    activity: activity.map(activityFromRow),
    jobs: jobs.map(jobFromRow),
    purchase: purchase ? purchaseFromRow(purchase) : null,
  };
}

function sortImages(a: CardImage, b: CardImage): number {
  const order = { front: 0, back: 1, extra: 2 } as const;
  return order[a.side] - order[b.side] || a.sort_order - b.sort_order || a.id - b.id;
}

export function refreshSearchText(db: Db, id: number): void {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined;
  if (!row) return;
  db.prepare('UPDATE cards SET search_text = ?, public_search_text = ? WHERE id = ?').run(
    buildSearchText(row),
    buildPublicSearchText(row),
    id,
  );
}

/**
 * Status is partly derived: "sold" when every unit has a sale, otherwise
 * "listed"/"in_stock" from active listings — unless someone set a manual
 * status (needs review, sale pending, keeper), which is kept.
 */
export function recomputeStatus(db: Db, id: number): CardStatus {
  const row = db.prepare('SELECT id, status, quantity FROM cards WHERE id = ?').get(id) as
    | { id: number; status: CardStatus; quantity: number }
    | undefined;
  if (!row) throw notFound('Card not found');
  const sold = db
    .prepare('SELECT COALESCE(SUM(quantity), 0) AS qty, MAX(sold_on) AS last FROM sales WHERE card_id = ?')
    .get(id) as { qty: number; last: string | null };
  const active = (
    db.prepare("SELECT COUNT(*) AS n FROM listings WHERE card_id = ? AND status = 'active'").get(id) as { n: number }
  ).n;

  let status: CardStatus = row.status;
  if (sold.qty >= row.quantity) status = 'sold';
  else if (status === 'sold' || !MANUAL_STATUSES.includes(status)) status = active > 0 ? 'listed' : 'in_stock';

  db.prepare('UPDATE cards SET status = ?, quantity_sold = ?, sold_at = ? WHERE id = ?').run(
    status,
    sold.qty,
    status === 'sold' ? sold.last : null,
    id,
  );
  return status;
}

function nextSku(db: Db, id: number, prefix: string): string {
  const base = `${prefix}-${String(id).padStart(5, '0')}`;
  let sku = base;
  for (let n = 2; db.prepare('SELECT 1 FROM cards WHERE sku = ? AND id != ?').get(sku, id); n++) {
    sku = `${base}-${n}`;
  }
  return sku;
}

export function createCard(db: Db, input: Partial<CardFields> & { status?: CardStatus } = {}): number {
  const fields = cardFieldsSchema.partial().parse(input);
  if (fields.purchase_id) assertPurchase(db, fields.purchase_id);
  const status: CardStatus = input.status && input.status !== 'sold' ? input.status : 'draft';
  const merged = { ...CARD_DEFAULTS, ...fields };
  const now = nowIso();
  const columns = Object.keys(merged);
  const values: Record<string, unknown> = {};
  for (const key of columns) values[key] = toDbValue(key, merged[key as keyof CardFields]);

  return db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO cards (sku, status, created_at, updated_at, ${columns.join(', ')})
         VALUES (@__sku, @__status, @__now, @__now, ${columns.map((c) => `@${c}`).join(', ')})`,
      )
      .run({ ...values, __sku: `TMP-${crypto.randomUUID()}`, __status: status, __now: now });
    const id = Number(info.lastInsertRowid);
    const settings = getSettings(db);
    db.prepare('UPDATE cards SET sku = ? WHERE id = ?').run(nextSku(db, id, settings.sku_prefix), id);
    refreshSearchText(db, id);
    recomputeStatus(db, id);
    logActivity(db, id, 'created', 'Card added to inventory');
    return id;
  })();
}

function assertPurchase(db: Db, purchaseId: number): void {
  if (!db.prepare('SELECT 1 FROM purchases WHERE id = ?').get(purchaseId)) throw badRequest('Purchase not found');
}

const FIELD_LABELS: Partial<Record<keyof CardPatch, string>> = {
  player: 'player',
  year: 'year',
  set_name: 'set',
  brand: 'brand',
  card_number: 'card #',
  condition: 'condition',
  grade: 'grade',
  location_binder: 'binder',
  location_page: 'page',
  location_slot: 'slot',
  cost_cents: 'cost',
  quantity: 'quantity',
  title: 'title',
  description: 'description',
  notes: 'notes',
};

export function updateCard(db: Db, id: number, patch: unknown): Card {
  const parsed = cardPatchSchema.parse(patch);
  if (parsed.status === 'sold') throw badRequest('Use "Mark as sold" to record the sale — the card is marked sold automatically.');
  if (parsed.purchase_id) assertPurchase(db, parsed.purchase_id);
  const before = getCardRow(db, id);
  if (parsed.quantity !== undefined && parsed.quantity < before.quantity_sold) {
    throw badRequest(`Quantity can't be lower than the ${before.quantity_sold} already sold`);
  }
  const entries = Object.entries(parsed).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return getCard(db, id);

  const settings = getSettings(db);
  const money = (c: number | null) => formatCents(c, settings.currency, settings.locale);

  db.transaction(() => {
    const sets = entries.map(([k]) => `${k} = @${k}`).join(', ');
    const values: Record<string, unknown> = { id, updated_at: nowIso() };
    for (const [k, v] of entries) values[k] = toDbValue(k, v);
    db.prepare(`UPDATE cards SET ${sets}, updated_at = @updated_at WHERE id = @id`).run(values);
    refreshSearchText(db, id);

    if (parsed.status !== undefined && parsed.status !== before.status) {
      const status = recomputeStatus(db, id);
      logActivity(db, id, 'status', `Status set to "${statusLabel(status)}"`);
    } else if (parsed.quantity !== undefined) {
      recomputeStatus(db, id);
    }
    if (parsed.asking_price_cents !== undefined && parsed.asking_price_cents !== before.asking_price_cents) {
      logActivity(db, id, 'price', `Asking price set to ${money(parsed.asking_price_cents)}`);
    }
    if (parsed.is_public !== undefined && parsed.is_public !== bool(before.is_public)) {
      logActivity(db, id, 'storefront', parsed.is_public ? 'Shown on the website' : 'Hidden from the website');
    }
    const changed = entries
      .map(([k]) => FIELD_LABELS[k as keyof CardPatch])
      .filter((label): label is string => Boolean(label));
    if (changed.length > 0) {
      logActivity(db, id, 'edited', `Updated ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? '…' : ''}`);
    }
  })();
  return getCard(db, id);
}

function statusLabel(s: CardStatus): string {
  return {
    draft: 'Needs review',
    in_stock: 'In inventory',
    listed: 'Listed for sale',
    pending: 'Sale pending',
    sold: 'Sold',
    keeper: 'Keeper',
  }[s];
}

export function deleteCard(db: Db, images: ImageStore, id: number): void {
  getCardRow(db, id);
  const sales = (db.prepare('SELECT COUNT(*) AS n FROM sales WHERE card_id = ?').get(id) as { n: number }).n;
  if (sales > 0) {
    throw conflict('This card has recorded sales, so it is kept for your financial records. Delete its sales first if you really want to remove it.');
  }
  const keys = (db.prepare('SELECT file_key FROM card_images WHERE card_id = ?').all(id) as { file_key: string }[]).map(
    (r) => r.file_key,
  );
  db.prepare('DELETE FROM cards WHERE id = ?').run(id);
  for (const key of keys) images.remove(key);
}

// ---------------------------------------------------------------- listing

export const cardQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  platform: z.coerce.number().int().positive().optional(),
  not_platform: z.coerce.number().int().positive().optional(),
  graded: z.enum(['0', '1']).optional(),
  rookie: z.enum(['0', '1']).optional(),
  autograph: z.enum(['0', '1']).optional(),
  memorabilia: z.enum(['0', '1']).optional(),
  public: z.enum(['0', '1']).optional(),
  has_value: z.enum(['0', '1']).optional(),
  has_price: z.enum(['0', '1']).optional(),
  has_inquiries: z.enum(['0', '1']).optional(),
  binder: z.string().trim().max(120).optional(),
  purchase: z.coerce.number().int().positive().optional(),
  min_value: z.coerce.number().int().min(0).optional(),
  max_value: z.coerce.number().int().min(0).optional(),
  ids: z.string().trim().max(5000).optional(),
  sort: z.enum(['updated', 'created', 'value', 'asking', 'player', 'year', 'sku', 'set', 'location']).default('updated'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(48),
});

export type CardQuery = z.infer<typeof cardQuerySchema>;

export function buildCardWhere(query: Partial<CardQuery>): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (query.q) {
    const s = searchClause(query.q);
    if (s.sql) {
      clauses.push(`(${s.sql})`);
      params.push(...s.params);
    }
  }
  if (query.status) {
    const expanded = new Set<string>();
    for (const s of query.status.split(',').map((x) => x.trim())) {
      if (s === 'available') ['in_stock', 'listed'].forEach((x) => expanded.add(x));
      else if (s === 'unsold') ['draft', 'in_stock', 'listed', 'pending', 'keeper'].forEach((x) => expanded.add(x));
      else if ((CARD_STATUSES as readonly string[]).includes(s)) expanded.add(s);
    }
    if (expanded.size > 0) {
      clauses.push(`c.status IN (${[...expanded].map(() => '?').join(',')})`);
      params.push(...expanded);
    }
  }
  if (query.category) {
    clauses.push('c.category = ?');
    params.push(query.category);
  }
  if (query.platform) {
    clauses.push("EXISTS (SELECT 1 FROM listings l WHERE l.card_id = c.id AND l.platform_id = ? AND l.status = 'active')");
    params.push(query.platform);
  }
  if (query.not_platform) {
    clauses.push(
      "NOT EXISTS (SELECT 1 FROM listings l WHERE l.card_id = c.id AND l.platform_id = ? AND l.status = 'active')",
    );
    params.push(query.not_platform);
  }
  const flag = (value: string | undefined, column: string) => {
    if (value === undefined) return;
    clauses.push(`${column} = ?`);
    params.push(Number(value));
  };
  flag(query.graded, 'c.is_graded');
  flag(query.rookie, 'c.is_rookie');
  flag(query.autograph, 'c.is_autograph');
  flag(query.memorabilia, 'c.is_memorabilia');
  flag(query.public, 'c.is_public');
  if (query.has_value !== undefined) {
    clauses.push(query.has_value === '1' ? 'c.market_value_cents IS NOT NULL' : 'c.market_value_cents IS NULL');
  }
  if (query.has_price !== undefined) {
    clauses.push(query.has_price === '1' ? 'c.asking_price_cents IS NOT NULL' : 'c.asking_price_cents IS NULL');
  }
  if (query.has_inquiries !== undefined) {
    const open = OPEN_INQUIRY_STATUSES.map((s) => `'${s}'`).join(',');
    clauses.push(
      `${query.has_inquiries === '1' ? '' : 'NOT '}EXISTS (SELECT 1 FROM inquiries i WHERE i.card_id = c.id AND i.status IN (${open}))`,
    );
  }
  if (query.binder !== undefined && query.binder !== '') {
    clauses.push('c.location_binder = ? COLLATE NOCASE');
    params.push(query.binder);
  }
  if (query.purchase) {
    clauses.push('c.purchase_id = ?');
    params.push(query.purchase);
  }
  if (query.min_value !== undefined) {
    clauses.push('c.market_value_cents >= ?');
    params.push(query.min_value);
  }
  if (query.max_value !== undefined) {
    clauses.push('c.market_value_cents <= ?');
    params.push(query.max_value);
  }
  if (query.ids) {
    const ids = query.ids
      .split(',')
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 1000);
    clauses.push(ids.length ? `c.id IN (${ids.map(() => '?').join(',')})` : '0');
    params.push(...ids);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function orderBy(sort: CardQuery['sort'], dir: CardQuery['dir']): string {
  const d = dir === 'asc' ? 'ASC' : 'DESC';
  switch (sort) {
    case 'created':
      return `c.created_at ${d}, c.id ${d}`;
    case 'value':
      return `c.market_value_cents ${d} NULLS LAST, c.id DESC`;
    case 'asking':
      return `c.asking_price_cents ${d} NULLS LAST, c.id DESC`;
    case 'player':
      return `c.player COLLATE NOCASE ${d}, c.year ${d}`;
    case 'year':
      return `c.year ${d}, c.set_name COLLATE NOCASE, CAST(c.card_number AS INTEGER)`;
    case 'sku':
      return `c.id ${d}`;
    case 'set':
      return `c.year ${d}, c.set_name COLLATE NOCASE ${d}, CAST(c.card_number AS INTEGER) ${d}, c.card_number ${d}`;
    case 'location':
      return `c.location_binder COLLATE NOCASE ${d}, CAST(c.location_page AS INTEGER) ${d}, CAST(c.location_slot AS INTEGER) ${d}, c.id`;
    case 'updated':
    default:
      return `c.updated_at ${d}, c.id ${d}`;
  }
}

export function listCards(db: Db, query: CardQuery): CardListResponse {
  const { where, params } = buildCardWhere(query);
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS n,
         COALESCE(SUM(c.quantity - c.quantity_sold), 0) AS units,
         COALESCE(SUM(COALESCE(c.market_value_cents, 0) * (c.quantity - c.quantity_sold)), 0) AS value_cents,
         COALESCE(SUM(COALESCE(c.asking_price_cents, 0) * (c.quantity - c.quantity_sold)), 0) AS asking_cents
       FROM cards c ${where}`,
    )
    .get(...params) as { n: number; units: number; value_cents: number; asking_cents: number };
  const offset = (query.page - 1) * query.page_size;
  const rows = db
    .prepare(
      `SELECT c.*, ${LIST_EXTRAS_SQL} FROM cards c ${where} ORDER BY ${orderBy(query.sort, query.dir)} LIMIT ? OFFSET ?`,
    )
    .all(...params, query.page_size, offset) as CardRow[];
  const images = imagesFor(
    db,
    rows.map((r) => r.id),
  );
  return {
    cards: rows.map((r) => rowToCard(r, images.get(r.id) ?? [])),
    total: totals.n,
    page: query.page,
    page_size: query.page_size,
    totals: { units: totals.units, value_cents: totals.value_cents, asking_cents: totals.asking_cents },
  };
}

export function cardFacets(db: Db): CardFacets {
  const distinct = (column: string) =>
    (
      db
        .prepare(
          `SELECT ${column} AS v, COUNT(*) AS n FROM cards WHERE ${column} != '' GROUP BY ${column} COLLATE NOCASE ORDER BY n DESC, v LIMIT 300`,
        )
        .all() as { v: string; n: number }[]
    ).map((r) => r.v);
  return {
    categories: (
      db.prepare('SELECT category AS name, COUNT(*) AS count FROM cards GROUP BY category ORDER BY count DESC').all() as {
        name: string;
        count: number;
      }[]
    ).map((r) => ({ name: r.name, count: r.count })),
    statuses: db.prepare('SELECT status, COUNT(*) AS count FROM cards GROUP BY status').all() as {
      status: CardStatus;
      count: number;
    }[],
    binders: db
      .prepare(
        `SELECT location_binder AS name, COUNT(*) AS count FROM cards WHERE location_binder != ''
         GROUP BY location_binder COLLATE NOCASE ORDER BY location_binder COLLATE NOCASE`,
      )
      .all() as { name: string; count: number }[],
    brands: distinct('brand'),
    sets: distinct('set_name'),
    years: distinct('year').sort().reverse(),
    teams: distinct('team'),
  };
}

// ---------------------------------------------------------------- images

export function addImage(
  db: Db,
  cardId: number,
  side: 'front' | 'back' | 'extra',
  stored: { key: string; width: number; height: number },
  replace: boolean,
  imageStore: ImageStore,
): void {
  getCardRow(db, cardId);
  const now = nowIso();
  const replaced: string[] = [];
  db.transaction(() => {
    if (replace && side !== 'extra') {
      const old = db.prepare('SELECT id, file_key FROM card_images WHERE card_id = ? AND side = ?').all(cardId, side) as {
        id: number;
        file_key: string;
      }[];
      for (const o of old) {
        db.prepare('DELETE FROM card_images WHERE id = ?').run(o.id);
        replaced.push(o.file_key);
      }
    }
    const nextOrder = (
      db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM card_images WHERE card_id = ? AND side = ?').get(
        cardId,
        side,
      ) as { n: number }
    ).n;
    db.prepare(
      'INSERT INTO card_images (card_id, side, file_key, width, height, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(cardId, side, stored.key, stored.width, stored.height, nextOrder, now);
    db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now, cardId);
  })();
  for (const key of replaced) imageStore.remove(key);
}
