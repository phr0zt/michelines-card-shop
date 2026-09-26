import type Database from 'better-sqlite3';
import type { PlatformKind } from '../../shared/constants';

interface SeedPlatform {
  name: string;
  kind: PlatformKind;
  fee_percent: number;
  fee_fixed_cents: number;
  color: string;
  url: string;
  active: boolean;
}

/**
 * Starting list of places to sell. Fees are rough defaults for estimating
 * profit — every one of them is editable in Settings.
 */
export const DEFAULT_PLATFORMS: SeedPlatform[] = [
  { name: 'eBay', kind: 'marketplace', fee_percent: 13.25, fee_fixed_cents: 40, color: '#e53238', url: 'https://www.ebay.ca', active: true },
  { name: 'Kijiji', kind: 'classifieds', fee_percent: 0, fee_fixed_cents: 0, color: '#373373', url: 'https://www.kijiji.ca', active: true },
  { name: 'Facebook Marketplace', kind: 'classifieds', fee_percent: 0, fee_fixed_cents: 0, color: '#1877f2', url: 'https://www.facebook.com/marketplace', active: true },
  { name: 'Facebook Groups', kind: 'social', fee_percent: 0, fee_fixed_cents: 0, color: '#4267b2', url: 'https://www.facebook.com/groups', active: true },
  { name: 'Whatnot', kind: 'auction', fee_percent: 10.9, fee_fixed_cents: 30, color: '#d4a106', url: 'https://www.whatnot.com', active: true },
  { name: 'Instagram', kind: 'social', fee_percent: 0, fee_fixed_cents: 0, color: '#c13584', url: 'https://www.instagram.com', active: true },
  { name: 'Card Show', kind: 'in_person', fee_percent: 0, fee_fixed_cents: 0, color: '#0f766e', url: '', active: true },
  { name: 'Our Website', kind: 'website', fee_percent: 0, fee_fixed_cents: 0, color: '#1e3a8a', url: '', active: true },
  { name: 'COMC', kind: 'marketplace', fee_percent: 0, fee_fixed_cents: 0, color: '#b45309', url: 'https://www.comc.com', active: false },
  { name: 'MySlabs', kind: 'marketplace', fee_percent: 0, fee_fixed_cents: 0, color: '#4d7c0f', url: 'https://www.myslabs.com', active: false },
  { name: 'Reddit', kind: 'social', fee_percent: 0, fee_fixed_cents: 0, color: '#ff4500', url: 'https://www.reddit.com/r/hockeycards', active: false },
  { name: 'TCGplayer', kind: 'marketplace', fee_percent: 0, fee_fixed_cents: 0, color: '#1d4ed8', url: 'https://www.tcgplayer.com', active: false },
  { name: 'Shopify', kind: 'website', fee_percent: 0, fee_fixed_cents: 0, color: '#5e8e3e', url: '', active: false },
  { name: 'Local Card Shop', kind: 'in_person', fee_percent: 0, fee_fixed_cents: 0, color: '#6d28d9', url: '', active: false },
];

export function seed(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM platforms').get() as { n: number }).n;
  if (count > 0) return;
  const insert = db.prepare(
    `INSERT INTO platforms (name, kind, fee_percent, fee_fixed_cents, color, url, active, sort_order, created_at)
     VALUES (@name, @kind, @fee_percent, @fee_fixed_cents, @color, @url, @active, @sort_order, @created_at)`,
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    DEFAULT_PLATFORMS.forEach((p, i) =>
      insert.run({ ...p, active: p.active ? 1 : 0, sort_order: (i + 1) * 10, created_at: now }),
    );
  })();
}
