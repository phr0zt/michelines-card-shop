import { z } from 'zod';
import { PLATFORM_KINDS } from '../../shared/constants';
import type { Platform } from '../../shared/types';
import type { Db } from '../db';
import { conflict, notFound } from '../lib/http';
import { nowIso } from '../lib/time';
import { cleanUrl } from './listings';
import { platformFromRow } from './serializers';

const text = (max: number) => z.string().trim().max(max);

export const platformCreateSchema = z
  .object({
    name: text(80).min(1),
    kind: z.enum(PLATFORM_KINDS).default('marketplace'),
    fee_percent: z.number().min(0).max(100).default(0),
    fee_fixed_cents: z.number().int().min(0).max(100_000).default(0),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1e3a8a')
      .default('#64748b'),
    url: text(500).default(''),
    active: z.boolean().default(true),
    sort_order: z.number().int().optional(),
  })
  .strict();

export const platformPatchSchema = z
  .object({
    name: text(80).min(1),
    kind: z.enum(PLATFORM_KINDS),
    fee_percent: z.number().min(0).max(100),
    fee_fixed_cents: z.number().int().min(0).max(100_000),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1e3a8a'),
    url: text(500),
    active: z.boolean(),
    sort_order: z.number().int(),
  })
  .partial()
  .strict();

export function listPlatforms(db: Db): Platform[] {
  return (db.prepare('SELECT * FROM platforms ORDER BY sort_order, name').all() as Record<string, unknown>[]).map(
    platformFromRow,
  );
}

export function getPlatform(db: Db, id: number): Platform {
  const row = db.prepare('SELECT * FROM platforms WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Platform not found');
  return platformFromRow(row);
}

function nameTaken(db: Db, name: string, exceptId = 0): boolean {
  return Boolean(db.prepare('SELECT 1 FROM platforms WHERE name = ? COLLATE NOCASE AND id != ?').get(name, exceptId));
}

export function createPlatform(db: Db, input: unknown): Platform {
  const data = platformCreateSchema.parse(input);
  if (nameTaken(db, data.name)) throw conflict(`"${data.name}" already exists`);
  const sortOrder =
    data.sort_order ??
    (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM platforms').get() as { n: number }).n;
  const info = db
    .prepare(
      `INSERT INTO platforms (name, kind, fee_percent, fee_fixed_cents, color, url, active, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.name,
      data.kind,
      data.fee_percent,
      data.fee_fixed_cents,
      data.color,
      cleanUrl(data.url),
      data.active ? 1 : 0,
      sortOrder,
      nowIso(),
    );
  return getPlatform(db, Number(info.lastInsertRowid));
}

export function updatePlatform(db: Db, id: number, input: unknown): Platform {
  const data = platformPatchSchema.parse(input);
  getPlatform(db, id);
  if (data.name && nameTaken(db, data.name, id)) throw conflict(`"${data.name}" already exists`);
  const patch: Record<string, unknown> = { ...data };
  if (data.url !== undefined) patch.url = cleanUrl(data.url);
  if (data.active !== undefined) patch.active = data.active ? 1 : 0;
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length > 0) {
    db.prepare(`UPDATE platforms SET ${entries.map(([k]) => `${k} = @${k}`).join(', ')} WHERE id = @__id`).run({
      ...Object.fromEntries(entries),
      __id: id,
    });
  }
  return getPlatform(db, id);
}

export function deletePlatform(db: Db, id: number): void {
  getPlatform(db, id);
  const used = db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM listings WHERE platform_id = @id)
           OR EXISTS (SELECT 1 FROM sales WHERE platform_id = @id)
           OR EXISTS (SELECT 1 FROM inquiries WHERE platform_id = @id) AS used`,
    )
    .get({ id }) as { used: number };
  if (used.used) {
    throw conflict('This platform has listings, sales or inquiries on record. Turn it off instead so history is kept.');
  }
  db.prepare('DELETE FROM platforms WHERE id = ?').run(id);
}
