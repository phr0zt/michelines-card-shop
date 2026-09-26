import { z } from 'zod';
import { LISTING_STATUSES } from '../../shared/constants';
import { formatCents } from '../../shared/money';
import type { Listing } from '../../shared/types';
import type { Db } from '../db';
import { badRequest, notFound } from '../lib/http';
import { isIsoDate, nowIso, today } from '../lib/time';
import { getCardRow, recomputeStatus } from './cards';
import { logActivity, platformName } from './common';
import { listingFromRow } from './serializers';
import { getSettings } from './settings';

const text = (max: number) => z.string().trim().max(max);
const isoDate = z.string().refine(isIsoDate, 'Use a date like 2025-01-31');

/** Only http(s) links are stored, so a pasted "javascript:" URL can never become a clickable link. */
export function cleanUrl(input: string | undefined | null): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw badRequest('That link doesn’t look like a web address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw badRequest('Links must start with http:// or https://');
  return url.toString();
}

export const listingCreateSchema = z
  .object({
    platform_id: z.number().int().positive(),
    status: z.enum(LISTING_STATUSES).default('active'),
    price_cents: z.number().int().min(0).nullable().optional(),
    url: text(2000).optional(),
    channel: text(200).optional(),
    external_id: text(100).optional(),
    listed_at: isoDate.nullable().optional(),
    ended_at: isoDate.nullable().optional(),
    notes: text(5000).optional(),
  })
  .strict();

export const listingPatchSchema = listingCreateSchema.partial().strict();

function getListingRow(db: Db, id: number): Record<string, unknown> {
  const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Listing not found');
  return row;
}

function assertPlatform(db: Db, platformId: number): void {
  if (!db.prepare('SELECT 1 FROM platforms WHERE id = ?').get(platformId)) throw badRequest('Unknown platform');
}

export function createListing(db: Db, cardId: number, input: unknown): Listing {
  const data = listingCreateSchema.parse(input);
  const card = getCardRow(db, cardId);
  assertPlatform(db, data.platform_id);
  if (card.status === 'sold' && data.status === 'active') {
    throw badRequest('This card is already sold. Remove the sale first if it fell through.');
  }
  const now = nowIso();
  const settings = getSettings(db);
  const price = data.price_cents === undefined ? card.asking_price_cents : data.price_cents;
  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO listings (card_id, platform_id, status, price_cents, url, channel, external_id, listed_at, ended_at, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cardId,
        data.platform_id,
        data.status,
        price ?? null,
        cleanUrl(data.url),
        data.channel ?? '',
        data.external_id ?? '',
        data.listed_at === undefined ? today() : data.listed_at,
        data.status === 'active' ? null : (data.ended_at ?? today()),
        data.notes ?? '',
        now,
        now,
      );
    db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now, cardId);
    recomputeStatus(db, cardId);
    const where = platformName(db, data.platform_id) + (data.channel ? ` (${data.channel})` : '');
    logActivity(
      db,
      cardId,
      'listed',
      `Posted on ${where}${price !== null && price !== undefined ? ` for ${formatCents(price, settings.currency, settings.locale)}` : ''}`,
    );
    return Number(info.lastInsertRowid);
  })();
  return listingFromRow(getListingRow(db, id));
}

export function updateListing(db: Db, id: number, input: unknown): Listing {
  const data = listingPatchSchema.parse(input);
  const before = listingFromRow(getListingRow(db, id));
  if (data.platform_id) assertPlatform(db, data.platform_id);
  const patch: Record<string, unknown> = { ...data };
  if (data.url !== undefined) patch.url = cleanUrl(data.url);
  if (data.status && data.status !== before.status) {
    if (data.status === 'active') {
      const card = getCardRow(db, before.card_id);
      if (card.status === 'sold') throw badRequest('This card is already sold. Remove the sale first if it fell through.');
      if (data.ended_at === undefined) patch.ended_at = null;
    } else if (data.ended_at === undefined && !before.ended_at) {
      patch.ended_at = today();
    }
  }
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return before;
  const settings = getSettings(db);
  db.transaction(() => {
    const now = nowIso();
    db.prepare(`UPDATE listings SET ${entries.map(([k]) => `${k} = @${k}`).join(', ')}, updated_at = @__now WHERE id = @__id`).run(
      { ...Object.fromEntries(entries), __now: now, __id: id },
    );
    db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now, before.card_id);
    recomputeStatus(db, before.card_id);
    const where = platformName(db, data.platform_id ?? before.platform_id);
    if (data.status && data.status !== before.status) {
      const verb = data.status === 'active' ? 'Re-listed on' : data.status === 'sold' ? 'Marked sold on' : 'Taken down from';
      logActivity(db, before.card_id, 'listing', `${verb} ${where}`);
    }
    if (data.price_cents !== undefined && data.price_cents !== before.price_cents) {
      logActivity(
        db,
        before.card_id,
        'listing',
        `${where} price changed to ${formatCents(data.price_cents, settings.currency, settings.locale)}`,
      );
    }
  })();
  return listingFromRow(getListingRow(db, id));
}

export function deleteListing(db: Db, id: number): void {
  const before = listingFromRow(getListingRow(db, id));
  db.transaction(() => {
    db.prepare('DELETE FROM listings WHERE id = ?').run(id);
    recomputeStatus(db, before.card_id);
    logActivity(db, before.card_id, 'listing', `Removed the ${platformName(db, before.platform_id)} posting record`);
  })();
}

/** Mark several listings as ended (e.g. the card sold elsewhere). */
export function endListings(db: Db, ids: number[]): number {
  let ended = 0;
  db.transaction(() => {
    for (const id of ids) {
      const row = db.prepare("SELECT * FROM listings WHERE id = ? AND status = 'active'").get(id) as
        | Record<string, unknown>
        | undefined;
      if (!row) continue;
      const listing = listingFromRow(row);
      db.prepare("UPDATE listings SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ?").run(
        today(),
        nowIso(),
        id,
      );
      recomputeStatus(db, listing.card_id);
      logActivity(db, listing.card_id, 'listing', `Taken down from ${platformName(db, listing.platform_id)}`);
      ended++;
    }
  })();
  return ended;
}
