import { describe, expect, it } from 'vitest';
import { buildListingTitle, cardLabel, listingTexts, researchLinks, researchQuery } from '../shared/cardText';
import { allocateCents, estimateFeesCents, parseMoneyToCents, saleNetCents } from '../shared/money';
import { buildSearchText, tokenizeQuery } from '../server/lib/search';
import { toCsv } from '../server/services/exports';
import { bucketKey, bucketsBetween } from '../server/services/analytics';
import { normalizeCategory, normalizeCondition, normalizeConfidence } from '../server/services/ai/identify';

const card = {
  category: 'Hockey',
  player: 'Wayne Gretzky',
  team: 'Edmonton Oilers',
  year: '1979-80',
  brand: 'O-Pee-Chee',
  set_name: 'O-Pee-Chee',
  subset: '',
  card_number: '18',
  parallel: '',
  serial_number: '',
  is_rookie: true,
  is_autograph: false,
  is_memorabilia: false,
  is_graded: true,
  grading_company: 'PSA',
  grade: '8',
  cert_number: '12345678',
  condition: 'Near Mint-Mint',
  title: '',
  description: 'The Great One’s rookie card.',
};

describe('money', () => {
  it('parses what people type', () => {
    expect(parseMoneyToCents('12')).toBe(1200);
    expect(parseMoneyToCents('$1,234.50')).toBe(123450);
    expect(parseMoneyToCents('C$ 19.99')).toBe(1999);
    expect(parseMoneyToCents('0.5')).toBe(50);
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('1.2.3')).toBeNull();
  });

  it('estimates fees on item + shipping plus the fixed part', () => {
    expect(estimateFeesCents({ fee_percent: 13.25, fee_fixed_cents: 40 }, 10000, 500)).toBe(1431);
    expect(estimateFeesCents({ fee_percent: 0, fee_fixed_cents: 0 }, 10000)).toBe(0);
    expect(estimateFeesCents(null, 10000)).toBe(0);
  });

  it('computes net profit', () => {
    expect(
      saleNetCents({
        sale_price_cents: 5000,
        shipping_charged_cents: 500,
        shipping_cost_cents: 400,
        fees_cents: 700,
        other_costs_cents: 100,
        cost_basis_cents: 1000,
      }),
    ).toBe(3300);
  });

  it('allocates a total exactly', () => {
    const parts = allocateCents(10000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(allocateCents(1000, [0, 0])).toEqual([500, 500]);
    expect(allocateCents(1000, [3, 1])).toEqual([750, 250]);
  });
});

describe('card text', () => {
  it('builds a readable label and a title that fits', () => {
    expect(cardLabel(card)).toBe('1979-80 O-Pee-Chee #18 Wayne Gretzky');
    const title = buildListingTitle(card, 80);
    expect(title).toContain('Wayne Gretzky');
    expect(title).toContain('PSA 8');
    expect(title.length).toBeLessThanOrEqual(80);
    const long = buildListingTitle({ ...card, subset: 'A very long subset name for testing purposes', parallel: 'Gold Rainbow Refractor Parallel' }, 40);
    expect(long.length).toBeLessThanOrEqual(40);
  });

  it('makes research links including PSA cert lookup', () => {
    expect(researchQuery(card)).toContain('Wayne Gretzky');
    const links = researchLinks(card);
    expect(links.some((l) => l.url.startsWith('https://www.ebay.com/sch/i.html?') && l.url.includes('LH_Sold=1'))).toBe(true);
    expect(links.some((l) => l.url === 'https://www.psacard.com/cert/12345678')).toBe(true);
  });

  it('writes listing text for each platform', () => {
    const texts = listingTexts(card, { currency: 'CAD', locale: 'en-CA', pickup_location: 'Sudbury', shipping_note: 'Ships in a top loader', listing_footer: '' }, 25000);
    const ebay = texts.find((t) => t.platform === 'eBay')!;
    expect(ebay.title.length).toBeLessThanOrEqual(80);
    expect(ebay.body).toContain('Graded: PSA 8');
    const kijiji = texts.find((t) => t.platform === 'Kijiji')!;
    expect(kijiji.body).toContain('Pickup in Sudbury');
    expect(kijiji.body).toMatch(/\$250\.00/);
  });
});

describe('search', () => {
  it('matches hobby shorthand', () => {
    const text = buildSearchText({
      ...card,
      sku: 'MC-00001',
      location_binder: 'Binder 3',
      location_page: '12',
      location_slot: '4',
      tags: '',
      notes: '',
      acquired_from: '',
    });
    for (const term of tokenizeQuery('gretzky opc 79 rc psa8 "binder 3"')) {
      expect(text.includes(term)).toBe(true);
    }
  });
});

describe('csv', () => {
  it('quotes and neutralises formulas in text cells but not numbers', () => {
    const csv = toCsv(['a', 'b', 'c'], [['=HYPERLINK("x")', -12.5, 'hello, "world"']]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(',-12.5,');
    expect(csv).toContain('"hello, ""world"""');
  });
});

describe('date buckets', () => {
  it('groups by month and Monday-start week', () => {
    expect(bucketKey('2025-03-15', 'month')).toBe('2025-03');
    expect(bucketKey('2025-03-16', 'week')).toBe('2025-03-10'); // Sunday → previous Monday
    expect(bucketKey('2025-03-17', 'week')).toBe('2025-03-17');
    expect(bucketsBetween('2024-11-20', '2025-02-01', 'month')).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
  });
});

describe('AI answer normalisation', () => {
  it('maps loose categories onto the known list', () => {
    expect(normalizeCategory('hockey', 'Baseball')).toBe('Hockey');
    expect(normalizeCategory('Pokemon', 'Hockey')).toBe('Pokémon');
    expect(normalizeCategory('NHL hockey card', 'Baseball')).toBe('Hockey');
    expect(normalizeCategory('Magic the Gathering', 'Hockey')).toBe('Magic: The Gathering');
    expect(normalizeCategory('something odd', 'Baseball')).toBe('Baseball');
  });

  it('maps grading shorthand onto conditions', () => {
    expect(normalizeCondition('Near Mint-Mint')).toBe('Near Mint-Mint');
    expect(normalizeCondition('NM-MT')).toBe('Near Mint-Mint');
    expect(normalizeCondition('nm')).toBe('Near Mint');
    expect(normalizeCondition('EX')).toBe('Excellent');
    expect(normalizeCondition('Unknown')).toBeNull();
    expect(normalizeConfidence('High')).toBe('high');
    expect(normalizeConfidence('fairly sure')).toBe('medium');
  });
});
