import { z } from 'zod';
import { AI_EFFORTS } from '../../shared/constants';
import type { Settings } from '../../shared/types';
import type { Db } from '../db';

export const DEFAULT_SETTINGS: Settings = {
  store_name: "Micheline's Card Shop",
  store_tagline: 'Hockey, baseball & trading cards',
  store_intro:
    'Browse the cards we have for sale. Send a message to ask a question, make an offer, or arrange pickup or shipping.',
  contact_email: '',
  contact_phone: '',
  pickup_location: '',
  currency: 'CAD',
  locale: 'en-CA',
  usd_exchange_rate: 1.37,
  sku_prefix: 'MC',
  storefront_enabled: true,
  storefront_show_prices: true,
  shipping_note: 'Ships in a penny sleeve and top loader inside a team bag, in a padded envelope.',
  listing_footer: '',
  ai_model: 'claude-opus-5',
  ai_effort_identify: 'high',
  ai_effort_price: 'medium',
  ai_auto_price: true,
  ai_max_searches: 5,
  stale_listing_days: 30,
  high_value_cents: 5000,
};

const text = (max: number) => z.string().trim().max(max);

export const settingsPatchSchema = z
  .object({
    store_name: text(120).min(1),
    store_tagline: text(200),
    store_intro: text(2000),
    contact_email: text(200),
    contact_phone: text(60),
    pickup_location: text(200),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code like CAD or USD'),
    locale: text(20).min(2),
    usd_exchange_rate: z.number().positive().max(1000),
    sku_prefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{1,6}$/, 'Use 1–6 letters or numbers'),
    storefront_enabled: z.boolean(),
    storefront_show_prices: z.boolean(),
    shipping_note: text(500),
    listing_footer: text(1000),
    ai_model: text(80).min(3),
    ai_effort_identify: z.enum(AI_EFFORTS),
    ai_effort_price: z.enum(AI_EFFORTS),
    ai_auto_price: z.boolean(),
    ai_max_searches: z.number().int().min(1).max(15),
    stale_listing_days: z.number().int().min(1).max(365),
    high_value_cents: z.number().int().min(0),
  })
  .partial()
  .strict();

export function getSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const settings: Settings = { ...DEFAULT_SETTINGS };
  const target = settings as unknown as Record<string, unknown>;
  for (const row of rows) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      target[row.key] = JSON.parse(row.value);
    } catch {
      // ignore corrupt values; the default stays
    }
  }
  if (process.env.ANTHROPIC_MODEL) settings.ai_model = process.env.ANTHROPIC_MODEL;
  return settings;
}

export function updateSettings(db: Db, patch: unknown): Settings {
  const parsed = settingsPatchSchema.parse(patch);
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.transaction(() => {
    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined) continue;
      upsert.run(key, JSON.stringify(value));
    }
  })();
  return getSettings(db);
}
