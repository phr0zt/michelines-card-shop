import type Database from 'better-sqlite3';

/**
 * Append-only list of schema migrations. Never edit a migration that has
 * shipped; add a new one instead.
 */
const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE platforms (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT NOT NULL DEFAULT 'marketplace',
  fee_percent REAL NOT NULL DEFAULT 0,
  fee_fixed_cents INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#64748b',
  url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY,
  purchased_on TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  total_cost_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE cards (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  category TEXT NOT NULL DEFAULT 'Hockey',
  player TEXT NOT NULL DEFAULT '',
  team TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  set_name TEXT NOT NULL DEFAULT '',
  subset TEXT NOT NULL DEFAULT '',
  card_number TEXT NOT NULL DEFAULT '',
  parallel TEXT NOT NULL DEFAULT '',
  serial_number TEXT NOT NULL DEFAULT '',
  is_rookie INTEGER NOT NULL DEFAULT 0,
  is_autograph INTEGER NOT NULL DEFAULT 0,
  is_memorabilia INTEGER NOT NULL DEFAULT 0,
  is_graded INTEGER NOT NULL DEFAULT 0,
  grading_company TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '',
  cert_number TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  condition_notes TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  quantity_sold INTEGER NOT NULL DEFAULT 0,
  location_binder TEXT NOT NULL DEFAULT '',
  location_page TEXT NOT NULL DEFAULT '',
  location_slot TEXT NOT NULL DEFAULT '',
  cost_cents INTEGER,
  acquired_date TEXT,
  acquired_from TEXT NOT NULL DEFAULT '',
  purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
  market_value_cents INTEGER,
  market_low_cents INTEGER,
  market_high_cents INTEGER,
  market_confidence TEXT,
  market_checked_at TEXT,
  asking_price_cents INTEGER,
  floor_price_cents INTEGER,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  ai_identified_at TEXT,
  ai_confidence REAL,
  ai_notes TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sold_at TEXT
);
CREATE INDEX idx_cards_status ON cards(status);
CREATE INDEX idx_cards_category ON cards(category);
CREATE INDEX idx_cards_purchase ON cards(purchase_id);
CREATE INDEX idx_cards_binder ON cards(location_binder);
CREATE INDEX idx_cards_public ON cards(is_public, status);

CREATE TABLE card_images (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  side TEXT NOT NULL,
  file_key TEXT NOT NULL UNIQUE,
  width INTEGER,
  height INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_images_card ON card_images(card_id, side, sort_order);

CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',
  price_cents INTEGER,
  url TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL DEFAULT '',
  listed_at TEXT,
  ended_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_listings_card ON listings(card_id, status);
CREATE INDEX idx_listings_platform ON listings(platform_id, status);

CREATE TABLE inquiries (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  platform_id INTEGER REFERENCES platforms(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  offer_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'new',
  follow_up_on TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_inquiries_card ON inquiries(card_id);
CREATE INDEX idx_inquiries_status ON inquiries(status, follow_up_on);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  platform_id INTEGER REFERENCES platforms(id) ON DELETE SET NULL,
  inquiry_id INTEGER REFERENCES inquiries(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  sale_price_cents INTEGER NOT NULL,
  shipping_charged_cents INTEGER NOT NULL DEFAULT 0,
  shipping_cost_cents INTEGER NOT NULL DEFAULT 0,
  fees_cents INTEGER NOT NULL DEFAULT 0,
  other_costs_cents INTEGER NOT NULL DEFAULT 0,
  cost_basis_cents INTEGER NOT NULL DEFAULT 0,
  buyer_name TEXT NOT NULL DEFAULT '',
  buyer_contact TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  sold_on TEXT NOT NULL,
  fulfillment TEXT NOT NULL DEFAULT 'pending',
  tracking_number TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sales_card ON sales(card_id);
CREATE INDEX idx_sales_sold_on ON sales(sold_on);
CREATE INDEX idx_sales_platform ON sales(platform_id);

CREATE TABLE price_checks (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'ai',
  currency TEXT NOT NULL,
  low_cents INTEGER,
  mid_cents INTEGER,
  high_cents INTEGER,
  suggested_price_cents INTEGER,
  quick_sale_cents INTEGER,
  confidence TEXT,
  summary TEXT NOT NULL DEFAULT '',
  advice TEXT NOT NULL DEFAULT '',
  comps_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_price_checks_card ON price_checks(card_id, created_at);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY,
  card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_activity_card ON activity(card_id, id);

CREATE TABLE ai_jobs (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  options_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT '',
  usage_json TEXT,
  cost_usd REAL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_ai_jobs_status ON ai_jobs(status, id);
CREATE INDEX idx_ai_jobs_card ON ai_jobs(card_id, id);

CREATE TABLE value_snapshots (
  date TEXT PRIMARY KEY,
  value_cents INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL,
  cards INTEGER NOT NULL
);
`,
  },
];

export function migrate(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        m.version,
        new Date().toISOString(),
      );
    })();
  }
}
