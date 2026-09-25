import { z } from 'zod';
import type { PublicCard, PublicCardList, PublicStore } from '../../shared/types';
import type { Db } from '../db';
import { badRequest, notFound } from '../lib/http';
import { searchClause } from '../lib/search';
import { bool, type ImageRow } from './common';
import { ImageStore } from './images';
import { createInquiry } from './inquiries';
import { getSettings } from './settings';

/** Cards a visitor may see: marked public, not sold out, and not drafts/keepers. */
const VISIBLE = `c.is_public = 1 AND c.status IN ('in_stock', 'listed', 'pending') AND c.quantity > c.quantity_sold`;

export function publicStore(db: Db): PublicStore {
  const s = getSettings(db);
  const categories = db
    .prepare(`SELECT c.category AS name, COUNT(*) AS count FROM cards c WHERE ${VISIBLE} GROUP BY c.category ORDER BY count DESC`)
    .all() as { name: string; count: number }[];
  return {
    enabled: s.storefront_enabled,
    name: s.store_name,
    tagline: s.store_tagline,
    intro: s.store_intro,
    contact_email: s.contact_email,
    contact_phone: s.contact_phone,
    pickup_location: s.pickup_location,
    currency: s.currency,
    locale: s.locale,
    show_prices: s.storefront_show_prices,
    categories: s.storefront_enabled ? categories : [],
  };
}

interface PublicRow {
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
  condition: string;
  title: string;
  description: string;
  asking_price_cents: number | null;
  featured: number;
}

const PUBLIC_COLUMNS = `c.id, c.sku, c.status, c.category, c.player, c.team, c.year, c.brand, c.set_name, c.subset, c.card_number,
  c.parallel, c.serial_number, c.is_rookie, c.is_autograph, c.is_memorabilia, c.is_graded, c.grading_company, c.grade,
  c.condition, c.title, c.description, c.asking_price_cents, c.featured`;

/** Explicit allow-list: costs, notes, locations and buyer details never leave the server. */
function toPublic(row: PublicRow, images: ImageRow[], showPrices: boolean): PublicCard {
  const order = { front: 0, back: 1, extra: 2 } as Record<string, number>;
  return {
    sku: row.sku,
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
    condition: row.condition,
    title: row.title,
    description: row.description,
    price_cents: showPrices ? row.asking_price_cents : null,
    availability: row.status === 'pending' ? 'pending' : 'available',
    featured: bool(row.featured),
    images: images
      .slice()
      .sort((a, b) => (order[a.side] ?? 3) - (order[b.side] ?? 3) || a.sort_order - b.sort_order || a.id - b.id)
      .map((img) => ({ side: img.side as 'front' | 'back' | 'extra', urls: ImageStore.urlsFor(img.file_key) })),
  };
}

function imagesByCard(db: Db, ids: number[]): Map<number, ImageRow[]> {
  const map = new Map<number, ImageRow[]>();
  if (ids.length === 0) return map;
  const rows = db
    .prepare(`SELECT * FROM card_images WHERE card_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as ImageRow[];
  for (const r of rows) map.set(r.card_id, [...(map.get(r.card_id) ?? []), r]);
  return map;
}

export const publicQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(60).optional(),
  graded: z.enum(['0', '1']).optional(),
  rookie: z.enum(['0', '1']).optional(),
  sort: z.enum(['featured', 'newest', 'price_asc', 'price_desc', 'year']).default('featured'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  page_size: z.coerce.number().int().min(1).max(96).default(24),
});

function assertEnabled(db: Db): ReturnType<typeof getSettings> {
  const settings = getSettings(db);
  if (!settings.storefront_enabled) throw notFound('The shop is closed right now');
  return settings;
}

export function listPublicCards(db: Db, query: z.infer<typeof publicQuerySchema>): PublicCardList {
  const settings = assertEnabled(db);
  const clauses = [VISIBLE];
  const params: unknown[] = [];
  if (query.q) {
    const s = searchClause(query.q, 'c.public_search_text');
    if (s.sql) {
      clauses.push(`(${s.sql})`);
      params.push(...s.params);
    }
  }
  if (query.category) {
    clauses.push('c.category = ?');
    params.push(query.category);
  }
  if (query.graded) {
    clauses.push('c.is_graded = ?');
    params.push(Number(query.graded));
  }
  if (query.rookie) {
    clauses.push('c.is_rookie = ?');
    params.push(Number(query.rookie));
  }
  const where = clauses.join(' AND ');
  const order = {
    featured: 'c.featured DESC, c.updated_at DESC, c.id DESC',
    newest: 'c.created_at DESC, c.id DESC',
    price_asc: 'c.asking_price_cents ASC NULLS LAST, c.id DESC',
    price_desc: 'c.asking_price_cents DESC NULLS LAST, c.id DESC',
    year: 'c.year DESC, c.set_name, c.id DESC',
  }[query.sort];
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM cards c WHERE ${where}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT ${PUBLIC_COLUMNS} FROM cards c WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, query.page_size, (query.page - 1) * query.page_size) as PublicRow[];
  const images = imagesByCard(
    db,
    rows.map((r) => r.id),
  );
  return {
    cards: rows.map((r) => toPublic(r, images.get(r.id) ?? [], settings.storefront_show_prices)),
    total,
    page: query.page,
    page_size: query.page_size,
  };
}

function visibleRowBySku(db: Db, sku: string): PublicRow {
  const row = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM cards c WHERE c.sku = ? AND ${VISIBLE}`).get(sku) as
    | PublicRow
    | undefined;
  if (!row) throw notFound('That card is no longer available');
  return row;
}

export function getPublicCard(db: Db, sku: string): PublicCard {
  const settings = assertEnabled(db);
  const row = visibleRowBySku(db, sku);
  return toPublic(row, imagesByCard(db, [row.id]).get(row.id) ?? [], settings.storefront_show_prices);
}

export const publicInquirySchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(100),
  contact: z.string().trim().min(3, 'Please enter an email or phone number').max(200),
  message: z.string().trim().max(2000).default(''),
  offer: z.number().min(0).max(10_000_000).nullable().optional(),
  website: z.string().max(200).optional(), // honeypot: real visitors never see or fill this
});

export function createPublicInquiry(db: Db, sku: string, input: unknown): { ok: true } {
  assertEnabled(db);
  const data = publicInquirySchema.parse(input);
  if (data.website) return { ok: true }; // quietly drop bot submissions
  const row = visibleRowBySku(db, sku);
  if (!/@|\d{3}/.test(data.contact)) throw badRequest('Please enter an email address or phone number');
  const websitePlatform = db
    .prepare("SELECT id FROM platforms WHERE kind = 'website' AND active = 1 ORDER BY sort_order LIMIT 1")
    .get() as { id: number } | undefined;
  createInquiry(
    db,
    row.id,
    {
      platform_id: websitePlatform?.id ?? null,
      name: data.name,
      contact: data.contact,
      message: data.message,
      offer_cents: data.offer === null || data.offer === undefined ? null : Math.round(data.offer * 100),
    },
    'storefront',
  );
  return { ok: true };
}
