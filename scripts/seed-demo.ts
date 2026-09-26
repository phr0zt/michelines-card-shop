/**
 * Fills a data folder with sample cards so you can try the app without
 * photographing anything. Photos are drawn, not real scans; prices are made up.
 *
 *   DATA_DIR=./demo-data npx tsx scripts/seed-demo.ts
 *
 * Refuses to touch a database that already has cards unless you pass --force.
 */
import path from 'node:path';
import sharp from 'sharp';
import type { CardFields } from '../shared/types';
import { openDb, type Db } from '../server/db';
import { addDays, nowIso, today } from '../server/lib/time';
import { recordValueSnapshot } from '../server/services/analytics';
import { addImage, createCard, recomputeStatus } from '../server/services/cards';
import { ImageStore } from '../server/services/images';
import { createInquiry } from '../server/services/inquiries';
import { createListing } from '../server/services/listings';
import { savePriceCheck } from '../server/services/priceChecks';
import { assignCards, applyAllocation, createPurchase } from '../server/services/purchases';
import { createSale } from '../server/services/sales';
import { updateSettings } from '../server/services/settings';

const dataDir = path.resolve(process.env.DATA_DIR ?? './demo-data');
const db = openDb(path.join(dataDir, 'cards.db'));
const images = new ImageStore(path.join(dataDir, 'uploads'));

const existing = (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n;
if (existing > 0 && !process.argv.includes('--force')) {
  console.error(`${dataDir} already has ${existing} cards. Pass --force to add demo cards anyway.`);
  process.exit(1);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function drawCard(opts: { name: string; line2: string; team: string; color: string; accent: string; number: string; back?: boolean }) {
  const w = 750;
  const h = 1050;
  const svg = opts.back
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
        <rect width="100%" height="100%" fill="#f3ead7"/>
        <rect x="30" y="30" width="${w - 60}" height="${h - 60}" rx="18" fill="none" stroke="${opts.color}" stroke-width="10"/>
        <text x="70" y="130" font-family="DejaVu Sans, sans-serif" font-size="46" font-weight="bold" fill="${opts.color}">#${esc(opts.number)}</text>
        <text x="70" y="200" font-family="DejaVu Sans, sans-serif" font-size="40" font-weight="bold" fill="#222">${esc(opts.name.toUpperCase())}</text>
        <text x="70" y="250" font-family="DejaVu Sans, sans-serif" font-size="28" fill="#444">${esc(opts.team)}</text>
        ${Array.from({ length: 9 }, (_, i) => `<rect x="70" y="${320 + i * 62}" width="${w - 140}" height="34" fill="${i % 2 ? '#e6dcc4' : '#ede3cc'}"/>`).join('')}
        <text x="70" y="${h - 90}" font-family="DejaVu Sans, sans-serif" font-size="24" fill="#555">${esc(opts.line2)}</text>
      </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
        <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${opts.accent}"/><stop offset="1" stop-color="${opts.color}"/></linearGradient></defs>
        <rect width="100%" height="100%" fill="#fafafa"/>
        <rect x="28" y="28" width="${w - 56}" height="${h - 56}" rx="20" fill="url(#g)"/>
        <rect x="60" y="60" width="${w - 120}" height="${h - 290}" rx="12" fill="#ffffff" opacity="0.18"/>
        <circle cx="${w / 2}" cy="360" r="120" fill="#ffffff" opacity="0.85"/>
        <path d="M${w / 2 - 210} ${h - 240} q210 -330 420 0 z" fill="#ffffff" opacity="0.85"/>
        <rect x="28" y="${h - 230}" width="${w - 56}" height="202" fill="#111" opacity="0.85"/>
        <text x="${w / 2}" y="${h - 150}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="54" font-weight="bold" fill="#fff">${esc(opts.name.toUpperCase())}</text>
        <text x="${w / 2}" y="${h - 90}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="30" fill="${opts.accent}">${esc(opts.line2)}</text>
      </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

interface Demo {
  fields: Partial<CardFields>;
  color: string;
  accent: string;
  value: [number, number, number];
  history?: number[];
  cost?: number;
}

const demos: Demo[] = [
  {
    fields: { category: 'Hockey', player: 'Wayne Gretzky', team: 'Edmonton Oilers', year: '1979-80', brand: 'O-Pee-Chee', set_name: 'O-Pee-Chee', card_number: '18', is_rookie: true, is_graded: true, grading_company: 'PSA', grade: '6', condition: 'Excellent-Mint', location_binder: 'Graded box', title: '1979-80 O-Pee-Chee #18 Wayne Gretzky RC PSA 6', description: 'The Great One’s rookie card, graded PSA 6 EX-MT. Clean slab, well centred for the grade.', asking_price_cents: 199900, floor_price_cents: 175000 },
    color: '#1d3d7a', accent: '#f39c12', value: [165000, 185000, 205000], history: [168000, 176000], cost: 120000,
  },
  {
    fields: { category: 'Hockey', player: 'Connor McDavid', team: 'Edmonton Oilers', year: '2015-16', brand: 'Upper Deck', set_name: 'Upper Deck Series 1', subset: 'Young Guns', card_number: '201', is_rookie: true, condition: 'Near Mint-Mint', location_binder: 'Blue binder', location_page: '1', location_slot: '1', asking_price_cents: 42500, floor_price_cents: 36000 },
    color: '#0b2e6b', accent: '#ff6a13', value: [34000, 38500, 44000], history: [41000, 39500], cost: 9000,
  },
  {
    fields: { category: 'Hockey', player: 'Mario Lemieux', team: 'Pittsburgh Penguins', year: '1985-86', brand: 'O-Pee-Chee', set_name: 'O-Pee-Chee', card_number: '9', is_rookie: true, condition: 'Excellent', location_binder: 'Blue binder', location_page: '1', location_slot: '2', asking_price_cents: 45000 },
    color: '#111111', accent: '#fcb514', value: [36000, 42000, 52000], cost: 15000,
  },
  {
    fields: { category: 'Hockey', player: 'Sidney Crosby', team: 'Pittsburgh Penguins', year: '2005-06', brand: 'Upper Deck', set_name: 'Upper Deck Series 1', subset: 'Young Guns', card_number: '201', is_rookie: true, condition: 'Near Mint', location_binder: 'Blue binder', location_page: '1', location_slot: '3', asking_price_cents: 32500 },
    color: '#111111', accent: '#c5b358', value: [26000, 29500, 34000], history: [27000], cost: 12000,
  },
  {
    fields: { category: 'Baseball', player: 'Ken Griffey Jr.', team: 'Seattle Mariners', year: '1989', brand: 'Upper Deck', set_name: 'Upper Deck', card_number: '1', is_rookie: true, condition: 'Near Mint-Mint', location_binder: 'Red binder', location_page: '1', location_slot: '1', asking_price_cents: 18500 },
    color: '#005c5c', accent: '#c4ced4', value: [12000, 15500, 19000], cost: 4000,
  },
  {
    fields: { category: 'Baseball', player: 'Derek Jeter', team: 'New York Yankees', year: '1993', brand: 'SP', set_name: 'SP', card_number: '279', is_rookie: true, condition: 'Excellent-Mint', location_binder: 'Red binder', location_page: '1', location_slot: '2', asking_price_cents: 39500 },
    color: '#0c2340', accent: '#c4ced3', value: [30000, 36000, 42000], cost: 25000,
  },
  {
    fields: { category: 'Baseball', player: 'Ronald Acuña Jr.', team: 'Atlanta Braves', year: '2018', brand: 'Topps', set_name: 'Topps Update', card_number: 'US250', is_rookie: true, condition: 'Mint', location_binder: 'Red binder', location_page: '1', location_slot: '3', asking_price_cents: 2500 },
    color: '#13274f', accent: '#ce1141', value: [1500, 2000, 2800], cost: 300,
  },
  {
    fields: { category: 'Pokémon', player: 'Charizard', year: '1999', brand: 'Wizards of the Coast', set_name: 'Base Set (Unlimited)', card_number: '4/102', condition: 'Very Good-Excellent', location_binder: 'Pokémon binder', location_page: '1', location_slot: '1', asking_price_cents: 52500, tags: 'holo' },
    color: '#b8321a', accent: '#f7d02c', value: [42000, 49000, 58000], history: [45500], cost: 20000,
  },
  {
    fields: { category: 'Hockey', player: 'Steve Yzerman', team: 'Detroit Red Wings', year: '1990-91', brand: 'Pro Set', set_name: 'Pro Set', card_number: '72', condition: 'Near Mint', location_binder: 'Commons box', quantity: 4, asking_price_cents: 300 },
    color: '#ce1126', accent: '#ffffff', value: [100, 150, 250], cost: 10,
  },
  {
    fields: { category: 'Hockey', player: 'Auston Matthews', team: 'Toronto Maple Leafs', year: '2016-17', brand: 'Upper Deck', set_name: 'Upper Deck Series 1', subset: 'Young Guns', card_number: '201', is_rookie: true, condition: 'Near Mint-Mint', location_binder: 'Blue binder', location_page: '1', location_slot: '4', asking_price_cents: 14500 },
    color: '#00205b', accent: '#ffffff', value: [11000, 13000, 15500], cost: 6000,
  },
  {
    fields: { category: 'Hockey', player: 'Patrick Roy', team: 'Montreal Canadiens', year: '1986-87', brand: 'O-Pee-Chee', set_name: 'O-Pee-Chee', card_number: '53', is_rookie: true, condition: 'Excellent-Mint', location_binder: 'Blue binder', location_page: '1', location_slot: '5', asking_price_cents: 22500 },
    color: '#af1e2d', accent: '#192168', value: [17000, 20500, 25000], cost: 7000,
  },
  {
    fields: { category: 'Basketball', player: 'Michael Jordan', team: 'Chicago Bulls', year: '1990-91', brand: 'Fleer', set_name: 'Fleer', card_number: '26', condition: 'Near Mint', location_binder: 'Green binder', location_page: '1', location_slot: '1', asking_price_cents: 3500 },
    color: '#ce1141', accent: '#000000', value: [2200, 2800, 3500], cost: 500,
  },
];

async function run(db: Db) {
  updateSettings(db, { pickup_location: 'Sudbury, ON', contact_email: 'shop@example.com' });
  const platforms = db.prepare('SELECT id, name FROM platforms').all() as { id: number; name: string }[];
  const pid = (name: string) => platforms.find((p) => p.name === name)!.id;

  const lot = createPurchase(db, {
    purchased_on: addDays(today(), -200),
    source: 'Estate sale',
    description: 'Two binders of 80s–90s hockey',
    total_cost_cents: 45000,
  });

  const ids: number[] = [];
  for (const [i, d] of demos.entries()) {
    const id = createCard(db, { ...d.fields, status: 'in_stock', is_public: true, cost_cents: d.cost ?? null });
    const f = d.fields;
    const front = await drawCard({
      name: f.player ?? '',
      line2: [f.year, f.set_name, f.subset].filter(Boolean).join(' · '),
      team: f.team ?? '',
      color: d.color,
      accent: d.accent,
      number: f.card_number ?? '',
    });
    const back = await drawCard({
      name: f.player ?? '',
      line2: `${f.brand ?? ''} ${f.year ?? ''}`,
      team: f.team ?? '',
      color: d.color,
      accent: d.accent,
      number: f.card_number ?? '',
      back: true,
    });
    addImage(db, id, 'front', await images.save(front), false, images);
    addImage(db, id, 'back', await images.save(back), false, images);

    // Price history: older checks first, then the current AI estimate.
    const stamps = [...(d.history ?? [])];
    stamps.forEach((mid, k) => {
      savePriceCheck(db, id, { source: 'ai', currency: 'CAD', low_cents: Math.round(mid * 0.85), mid_cents: mid, high_cents: Math.round(mid * 1.15), suggested_price_cents: null, quick_sale_cents: null, confidence: 'medium', summary: 'Earlier estimate.', advice: '', comps: [], sources: [], model: 'demo' });
      db.prepare('UPDATE price_checks SET created_at = ? WHERE id = (SELECT MAX(id) FROM price_checks WHERE card_id = ?)').run(
        new Date(Date.now() - (stamps.length - k) * 45 * 86_400_000).toISOString(),
        id,
      );
    });
    const [low, mid, high] = d.value;
    savePriceCheck(db, id, {
      source: 'ai',
      currency: 'CAD',
      low_cents: low,
      mid_cents: mid,
      high_cents: high,
      suggested_price_cents: Math.round(high * 1.02),
      quick_sale_cents: low,
      confidence: 'medium',
      summary: 'Demo data — recent sold listings for this card in similar condition cluster around the typical value.',
      advice: 'Demo data. List at the suggested price on eBay with offers on; post locally on Kijiji and Facebook Marketplace too.',
      comps: [
        { title: `${f.year} ${f.set_name} ${f.player} #${f.card_number}`, price: Math.round(mid / 137) , currency: 'USD', date: addDays(today(), -12), venue: 'eBay', url: 'https://www.ebay.com/sch/i.html?LH_Sold=1', grade: f.is_graded ? `${f.grading_company} ${f.grade}` : 'Raw', sold: true },
        { title: `${f.player} ${f.year} rookie`, price: Math.round(high / 137), currency: 'USD', date: addDays(today(), -30), venue: 'eBay', url: 'https://www.ebay.com/sch/i.html?LH_Sold=1', grade: 'Raw', sold: true },
      ],
      sources: [],
      model: 'demo',
    });
    ids.push(id);
    if (i === 0) db.prepare('UPDATE cards SET featured = 1 WHERE id = ?').run(id);
  }

  assignCards(db, lot.id, ids.filter((_, i) => [2, 8, 10].includes(i)));
  applyAllocation(db, lot.id, 'by_value');

  // Postings across sites.
  const list = (card: number, platform: string, daysAgo: number, extra: Record<string, unknown> = {}) =>
    createListing(db, ids[card], { platform_id: pid(platform), listed_at: addDays(today(), -daysAgo), ...extra });
  list(0, 'eBay', 12, { url: 'https://www.ebay.ca/itm/000000000001' });
  list(0, 'Facebook Groups', 9, { channel: 'Canadian Hockey Card Collectors' });
  list(1, 'eBay', 44, { url: 'https://www.ebay.ca/itm/000000000002' });
  list(1, 'Kijiji', 40);
  list(1, 'Facebook Marketplace', 38);
  list(2, 'Kijiji', 20);
  list(3, 'eBay', 5);
  list(5, 'eBay', 61);
  list(7, 'Whatnot', 3);
  list(7, 'Instagram', 3);
  list(9, 'Kijiji', 15);
  list(9, 'Facebook Marketplace', 15);
  list(10, 'eBay', 33);

  // Sales spread over the last months (a sold card that's still up on Facebook, on purpose).
  const sell = (card: number, platform: string | null, price: number, daysAgo: number, extra: Record<string, unknown> = {}) =>
    createSale(db, ids[card], {
      platform_id: platform ? pid(platform) : null,
      sale_price_cents: price,
      sold_on: addDays(today(), -daysAgo),
      ...extra,
    });
  sell(9, 'Kijiji', 13500, 6, { buyer_name: 'Mike T.', payment_method: 'Cash', fulfillment: 'picked_up' });
  sell(8, 'Card Show', 900, 70, { quantity: 3, buyer_name: 'Show walk-up', fulfillment: 'picked_up', payment_method: 'Cash' });
  sell(6, 'eBay', 2800, 150, { shipping_charged_cents: 400, shipping_cost_cents: 250, buyer_name: 'ebayfan22', fulfillment: 'delivered' });
  sell(11, 'Facebook Groups', 3200, 110, { shipping_charged_cents: 300, shipping_cost_cents: 300, fulfillment: 'delivered', payment_method: 'PayPal Goods & Services', other_costs_cents: 125 });
  sell(4, 'eBay', 16200, 2, { shipping_charged_cents: 500, shipping_cost_cents: 420, buyer_name: 'griffeyfan', payment_method: 'Marketplace payout' });

  // Inquiries.
  createInquiry(db, ids[1], { platform_id: pid('Kijiji'), name: 'Jordan', contact: '705-555-0143', offer_cents: 36000, message: 'Would you take $360 cash? Can meet tonight.', follow_up_on: today() });
  createInquiry(db, ids[0], { platform_id: pid('Facebook Groups'), name: 'Luc B.', contact: 'facebook.com/luc.b', message: 'Any trades? I have a Lemieux RC.' });
  createInquiry(db, ids[7], { platform_id: pid('Instagram'), name: '@pkmn_hunter', offer_cents: 45000, status: 'negotiating', follow_up_on: addDays(today(), 2) });
  createInquiry(db, ids[3], { name: 'Walk-in', message: 'Asked about graded Crosby cards', status: 'replied' }, 'manual');

  // Backdate "created" so the dashboard's cards-added series has history.
  ids.forEach((id, i) => db.prepare('UPDATE cards SET created_at = ? WHERE id = ?').run(new Date(Date.now() - (200 - i * 12) * 86_400_000).toISOString(), id));
  for (const id of ids) recomputeStatus(db, id);

  // A year of inventory value snapshots.
  recordValueSnapshot(db);
  const current = db.prepare('SELECT value_cents, cost_cents, cards FROM value_snapshots WHERE date = ?').get(today()) as { value_cents: number; cost_cents: number; cards: number };
  for (let w = 52; w >= 1; w--) {
    const factor = 0.72 + (0.28 * (52 - w)) / 52 + Math.sin(w / 3) * 0.02;
    db.prepare('INSERT OR IGNORE INTO value_snapshots (date, value_cents, cost_cents, cards) VALUES (?, ?, ?, ?)').run(
      addDays(today(), -w * 7),
      Math.round(current.value_cents * factor),
      current.cost_cents,
      Math.max(1, current.cards - Math.round(w / 8)),
    );
  }
  // One draft waiting for review, like after a batch upload.
  const draft = createCard(db, { category: 'Hockey', player: 'Teemu Selanne', team: 'Winnipeg Jets', year: '1992-93', brand: 'Upper Deck', set_name: 'Upper Deck', card_number: '586', is_rookie: true, condition: 'Near Mint', location_binder: 'Blue binder', location_page: '2', location_slot: '1' });
  addImage(db, draft, 'front', await images.save(await drawCard({ name: 'Teemu Selanne', line2: '1992-93 Upper Deck', team: 'Winnipeg Jets', color: '#041e42', accent: '#ac162c', number: '586' })), false, images);
  db.prepare('UPDATE cards SET ai_identified_at = ?, ai_confidence = 0.7, ai_notes = ? WHERE id = ?').run(nowIso(), 'Unsure about: whether this is the base card or the Calder Candidate insert.', draft);
  console.log(`Seeded ${ids.length + 1} demo cards into ${dataDir}`);
}

await run(db);
db.close();
