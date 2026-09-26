import { formatCents } from './money';

/** The subset of card fields needed to describe a card in text. */
export interface CardTextFields {
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
  is_rookie: boolean;
  is_autograph: boolean;
  is_memorabilia: boolean;
  is_graded: boolean;
  grading_company: string;
  grade: string;
  cert_number?: string;
  condition: string;
  condition_notes?: string;
  title?: string;
  description?: string;
  sku?: string;
}

const TCG_CATEGORIES = new Set(['Pokémon', 'Magic: The Gathering', 'Yu-Gi-Oh!', 'One Piece', 'Lorcana', 'Other TCG']);

export function isTcg(category: string): boolean {
  return TCG_CATEGORIES.has(category);
}

function clean(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** "Upper Deck" + "Upper Deck Series 1" -> "Upper Deck Series 1"; "Topps" + "Chrome" -> "Topps Chrome". */
export function brandAndSet(brand: string, setName: string): string {
  const b = clean(brand);
  const s = clean(setName);
  if (!b) return s;
  if (!s) return b;
  if (s.toLowerCase().includes(b.toLowerCase())) return s;
  return `${b} ${s}`;
}

export function cardNumberText(cardNumber: string): string {
  const n = clean(cardNumber).replace(/^#/, '');
  return n ? `#${n}` : '';
}

/** Short human label, e.g. "1979-80 O-Pee-Chee #18 Wayne Gretzky". */
export function cardLabel(c: Pick<CardTextFields, 'year' | 'brand' | 'set_name' | 'player' | 'card_number' | 'subset'>): string {
  const parts = [clean(c.year), brandAndSet(c.brand, c.set_name), clean(c.subset), cardNumberText(c.card_number), clean(c.player)];
  const label = parts.filter(Boolean).join(' ');
  return label || 'Unidentified card';
}

function gradeText(c: CardTextFields): string {
  if (!c.is_graded) return '';
  return [clean(c.grading_company), clean(c.grade)].filter(Boolean).join(' ');
}

function serialText(serial: string): string {
  const s = clean(serial);
  if (!s) return '';
  return s.includes('/') ? s : `/${s}`;
}

/**
 * Marketplace-style title, most important words first, trimmed to `max`
 * characters (eBay allows 80) by dropping the least important pieces.
 */
export function buildListingTitle(c: CardTextFields, max = 80): string {
  const pieces: { text: string; priority: number }[] = [
    { text: clean(c.year), priority: 1 },
    { text: brandAndSet(c.brand, c.set_name), priority: 1 },
    { text: clean(c.subset), priority: 3 },
    { text: clean(c.player), priority: 0 },
    { text: cardNumberText(c.card_number), priority: 2 },
    { text: clean(c.parallel), priority: 2 },
    { text: serialText(c.serial_number), priority: 2 },
    { text: c.is_rookie ? 'RC' : '', priority: 1 },
    { text: c.is_autograph ? 'AUTO' : '', priority: 1 },
    { text: c.is_memorabilia ? 'Patch/Relic' : '', priority: 3 },
    { text: gradeText(c), priority: 0 },
    { text: clean(c.team), priority: 4 },
  ].filter((p) => p.text);

  let current = pieces;
  const join = (list: typeof pieces) => list.map((p) => p.text).join(' ');
  for (let priority = 4; priority >= 1 && join(current).length > max; priority--) {
    current = current.filter((p) => p.priority < priority);
  }
  let title = join(current);
  if (title.length > max) title = title.slice(0, max).trim();
  return title || 'Trading card';
}

/** Search text for price lookups (eBay sold listings, price guides). */
export function researchQuery(c: CardTextFields): string {
  const parts = [
    clean(c.year),
    brandAndSet(c.brand, c.set_name),
    clean(c.subset),
    clean(c.player),
    cardNumberText(c.card_number),
    clean(c.parallel),
    serialText(c.serial_number).replace(/^\d+(?=\/)/, ''),
    c.is_autograph ? 'auto' : '',
    gradeText(c),
  ];
  return parts.filter(Boolean).join(' ').trim();
}

export interface ResearchLink {
  label: string;
  url: string;
  hint: string;
}

export function researchLinks(c: CardTextFields): ResearchLink[] {
  const q = researchQuery(c);
  if (!q) return [];
  const enc = encodeURIComponent;
  const links: ResearchLink[] = [
    {
      label: 'eBay sold (.com)',
      url: `https://www.ebay.com/sch/i.html?_nkw=${enc(q)}&LH_Sold=1&LH_Complete=1`,
      hint: 'Completed sales in USD — the best real-world comps',
    },
    {
      label: 'eBay sold (.ca)',
      url: `https://www.ebay.ca/sch/i.html?_nkw=${enc(q)}&LH_Sold=1&LH_Complete=1`,
      hint: 'Completed sales on eBay Canada',
    },
    isTcg(c.category)
      ? {
          label: 'PriceCharting',
          url: `https://www.pricecharting.com/search-products?q=${enc(q)}&type=prices`,
          hint: 'Price guide built from sold listings',
        }
      : {
          label: 'SportsCardsPro',
          url: `https://www.sportscardspro.com/search-products?q=${enc(q)}&type=prices`,
          hint: 'Raw and graded price guide built from sold listings',
        },
    {
      label: 'Beckett (Google)',
      url: `https://www.google.com/search?q=${enc(`site:beckett.com ${q}`)}`,
      hint: 'Beckett price guide pages (subscription needed for full values)',
    },
    {
      label: 'Google',
      url: `https://www.google.com/search?q=${enc(`${q} sold price`)}`,
      hint: 'Everything else',
    },
  ];
  if (isTcg(c.category)) {
    links.splice(2, 0, {
      label: 'TCGplayer',
      url: `https://www.tcgplayer.com/search/all/product?q=${enc(q)}`,
      hint: 'Market price for TCG singles',
    });
  }
  const cert = clean(c.cert_number);
  if (c.is_graded && cert && clean(c.grading_company).toUpperCase() === 'PSA') {
    links.push({
      label: 'PSA cert lookup',
      url: `https://www.psacard.com/cert/${enc(cert)}`,
      hint: 'Verify the slab and see population data',
    });
  }
  return links;
}

function hashtag(s: string): string {
  const tag = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
  return tag ? `#${tag}` : '';
}

export function hashtags(c: CardTextFields): string[] {
  const categoryTags: Record<string, string[]> = {
    Hockey: ['#hockeycards', '#nhl'],
    Baseball: ['#baseballcards', '#mlb'],
    Basketball: ['#basketballcards', '#nba'],
    Football: ['#footballcards', '#nfl'],
    Soccer: ['#soccercards'],
    'Pokémon': ['#pokemon', '#pokemontcg'],
    'Magic: The Gathering': ['#mtg', '#magicthegathering'],
    'Yu-Gi-Oh!': ['#yugioh'],
  };
  const tags = [
    ...(categoryTags[c.category] ?? ['#tradingcards']),
    '#sportscards',
    hashtag(c.player),
    hashtag(c.brand),
    hashtag(c.team),
    c.is_rookie ? '#rookiecard' : '',
    c.is_autograph ? '#autograph' : '',
    c.is_graded ? hashtag(c.grading_company) : '',
    '#thehobby',
  ];
  const seen = new Set<string>();
  return tags.filter((t) => t && t !== '#' && !seen.has(t) && (seen.add(t), true)).slice(0, 12);
}

export function detailLines(c: CardTextFields): string[] {
  const lines: string[] = [];
  const add = (label: string, value: string) => {
    if (clean(value)) lines.push(`${label}: ${clean(value)}`);
  };
  add(isTcg(c.category) ? 'Card' : 'Player', c.player);
  add('Team', c.team);
  add('Year', c.year);
  add('Set', brandAndSet(c.brand, c.set_name));
  add('Insert / subset', c.subset);
  add('Card #', c.card_number.replace(/^#/, ''));
  add('Parallel / variation', c.parallel);
  add('Serial numbered', serialText(c.serial_number));
  if (c.is_rookie) lines.push('Rookie card: Yes');
  if (c.is_autograph) lines.push('Autograph: Yes');
  if (c.is_memorabilia) lines.push('Memorabilia / relic: Yes');
  if (c.is_graded) {
    add('Graded', `${gradeText(c)}${c.cert_number ? ` (cert #${clean(c.cert_number)})` : ''}`);
  } else {
    add('Condition (raw, ungraded)', c.condition);
  }
  return lines;
}

export interface ListingTextSettings {
  currency: string;
  locale: string;
  pickup_location: string;
  shipping_note: string;
  listing_footer: string;
}

export interface ListingText {
  platform: string;
  title: string;
  body: string;
  titleLimit?: number;
}

/** Ready-to-paste listing text for the most common places cards get posted. */
export function listingTexts(c: CardTextFields, s: ListingTextSettings, priceCents: number | null): ListingText[] {
  const title = (clean(c.title) || buildListingTitle(c, 80)).slice(0, 80).trim();
  const shortTitle = title.length > 64 ? buildListingTitle(c, 64) : title;
  const price = priceCents !== null && priceCents !== undefined ? formatCents(priceCents, s.currency, s.locale) : '';
  const description = clean(c.description);
  const details = detailLines(c).map((l) => `• ${l}`).join('\n');
  const conditionNote = clean(c.condition_notes);
  const footer = clean(s.listing_footer);
  const sku = c.sku ? `Ref: ${c.sku}` : '';
  const pickup = clean(s.pickup_location);
  const shipping = clean(s.shipping_note);
  const tags = hashtags(c).join(' ');

  const block = (...parts: string[]) => parts.filter((p) => p && p.trim()).join('\n\n');

  return [
    {
      platform: 'eBay',
      title,
      titleLimit: 80,
      body: block(
        description,
        details,
        conditionNote ? `Condition notes: ${conditionNote}` : '',
        'The card pictured is the exact card you will receive.',
        shipping,
        footer,
        sku,
      ),
    },
    {
      platform: 'Kijiji',
      title: shortTitle,
      titleLimit: 64,
      body: block(
        description,
        details,
        price ? `Price: ${price}` : '',
        pickup ? `Pickup in ${pickup}. Shipping available.` : 'Shipping available.',
        shipping,
        footer,
        sku,
      ),
    },
    {
      platform: 'Facebook',
      title: shortTitle,
      body: block(
        [title, price ? `— ${price}` : ''].filter(Boolean).join(' '),
        description,
        details,
        pickup ? `📍 Pickup in ${pickup} or I can ship.` : 'Can ship.',
        footer,
        tags,
        sku,
      ),
    },
    {
      platform: 'Instagram',
      title: shortTitle,
      body: block(
        `${title}${price ? ` — ${price}` : ''}`,
        description,
        'DM to buy or make an offer.',
        tags,
      ),
    },
  ];
}
