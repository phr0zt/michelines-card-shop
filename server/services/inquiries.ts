import { z } from 'zod';
import { INQUIRY_STATUSES, INQUIRY_STATUS_LABELS, OPEN_INQUIRY_STATUSES } from '../../shared/constants';
import { formatCents } from '../../shared/money';
import type { Inquiry } from '../../shared/types';
import type { Db } from '../db';
import { badRequest, notFound } from '../lib/http';
import { searchClause } from '../lib/search';
import { isIsoDate, nowIso, today } from '../lib/time';
import { getCardRow } from './cards';
import { CARD_SUMMARY_SQL, logActivity, platformName } from './common';
import { inquiryFromRow } from './serializers';
import { getSettings } from './settings';

const text = (max: number) => z.string().trim().max(max);
const isoDate = z.string().refine(isIsoDate, 'Use a date like 2025-01-31');

export const inquiryCreateSchema = z
  .object({
    platform_id: z.number().int().positive().nullable().optional(),
    name: text(200).optional(),
    contact: text(300).optional(),
    message: text(5000).optional(),
    offer_cents: z.number().int().min(0).nullable().optional(),
    status: z.enum(INQUIRY_STATUSES).optional(),
    follow_up_on: isoDate.nullable().optional(),
  })
  .strict();

export const inquiryPatchSchema = inquiryCreateSchema.partial().strict();

const OPEN_SQL = OPEN_INQUIRY_STATUSES.map((s) => `'${s}'`).join(',');

function getInquiryRow(db: Db, id: number): Record<string, unknown> {
  const row = db
    .prepare(`SELECT i.*, ${CARD_SUMMARY_SQL} FROM inquiries i JOIN cards c ON c.id = i.card_id WHERE i.id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Inquiry not found');
  return row;
}

export function getInquiry(db: Db, id: number): Inquiry {
  return inquiryFromRow(getInquiryRow(db, id));
}

export function createInquiry(
  db: Db,
  cardId: number,
  input: unknown,
  source: 'manual' | 'storefront' = 'manual',
): Inquiry {
  const data = inquiryCreateSchema.parse(input);
  getCardRow(db, cardId);
  if (data.platform_id && !db.prepare('SELECT 1 FROM platforms WHERE id = ?').get(data.platform_id)) {
    throw badRequest('Unknown platform');
  }
  if (!data.name && !data.contact && !data.message) throw badRequest('Add at least a name, contact or message');
  const now = nowIso();
  const settings = getSettings(db);
  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO inquiries (card_id, platform_id, name, contact, message, offer_cents, status, follow_up_on, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cardId,
        data.platform_id ?? null,
        data.name ?? '',
        data.contact ?? '',
        data.message ?? '',
        data.offer_cents ?? null,
        data.status ?? 'new',
        data.follow_up_on ?? null,
        source,
        now,
        now,
      );
    const who = data.name || data.contact || 'someone';
    const via = source === 'storefront' ? ' via the website' : data.platform_id ? ` via ${platformName(db, data.platform_id)}` : '';
    const offer =
      data.offer_cents !== null && data.offer_cents !== undefined
        ? ` — offered ${formatCents(data.offer_cents, settings.currency, settings.locale)}`
        : '';
    logActivity(db, cardId, 'inquiry', `Inquiry from ${who}${via}${offer}`);
    return Number(info.lastInsertRowid);
  })();
  return getInquiry(db, id);
}

export function updateInquiry(db: Db, id: number, input: unknown): Inquiry {
  const data = inquiryPatchSchema.parse(input);
  const before = getInquiry(db, id);
  if (data.platform_id && !db.prepare('SELECT 1 FROM platforms WHERE id = ?').get(data.platform_id)) {
    throw badRequest('Unknown platform');
  }
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return before;
  db.transaction(() => {
    db.prepare(
      `UPDATE inquiries SET ${entries.map(([k]) => `${k} = @${k}`).join(', ')}, updated_at = @__now WHERE id = @__id`,
    ).run({ ...Object.fromEntries(entries), __now: nowIso(), __id: id });
    if (data.status && data.status !== before.status) {
      logActivity(
        db,
        before.card_id,
        'inquiry',
        `Inquiry from ${before.name || before.contact || 'buyer'} → ${INQUIRY_STATUS_LABELS[data.status]}`,
      );
    }
  })();
  return getInquiry(db, id);
}

export function deleteInquiry(db: Db, id: number): void {
  getInquiryRow(db, id);
  db.prepare('DELETE FROM inquiries WHERE id = ?').run(id);
}

export const inquiryQuerySchema = z.object({
  status: z.string().trim().max(40).default('open'),
  due: z.enum(['0', '1']).optional(),
  card_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(100),
});

export function listInquiries(
  db: Db,
  query: z.infer<typeof inquiryQuerySchema>,
): { inquiries: Inquiry[]; total: number } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.status === 'open') clauses.push(`i.status IN (${OPEN_SQL})`);
  else if (query.status === 'done') clauses.push("i.status IN ('declined', 'closed')");
  else if ((INQUIRY_STATUSES as readonly string[]).includes(query.status)) {
    clauses.push('i.status = ?');
    params.push(query.status);
  }
  if (query.due === '1') {
    clauses.push(`i.follow_up_on IS NOT NULL AND i.follow_up_on <= ? AND i.status IN (${OPEN_SQL})`);
    params.push(today());
  }
  if (query.card_id) {
    clauses.push('i.card_id = ?');
    params.push(query.card_id);
  }
  if (query.q) {
    const s = searchClause(query.q, "(lower(i.name || ' ' || i.contact || ' ' || i.message) || c.search_text)");
    if (s.sql) {
      clauses.push(`(${s.sql})`);
      params.push(...s.params);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM inquiries i JOIN cards c ON c.id = i.card_id ${where}`).get(...params) as {
      n: number;
    }
  ).n;
  const rows = db
    .prepare(
      `SELECT i.*, ${CARD_SUMMARY_SQL} FROM inquiries i JOIN cards c ON c.id = i.card_id ${where}
       ORDER BY (i.follow_up_on IS NULL), i.follow_up_on, i.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, query.page_size, (query.page - 1) * query.page_size) as Record<string, unknown>[];
  return { inquiries: rows.map(inquiryFromRow), total };
}
