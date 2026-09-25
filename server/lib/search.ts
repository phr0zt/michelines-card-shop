/**
 * Cards carry a denormalised, lower-cased `search_text` column so a search like
 * "gretzky opc 79 rc" can match with simple AND-ed LIKE clauses. Common hobby
 * abbreviations are added so shorthand works both ways.
 */

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALIASES: [RegExp, string][] = [
  [/o-?\s?pee-?\s?chee/, 'opc opeechee o-pee-chee'],
  [/upper deck/, 'ud upperdeck'],
  [/young guns/, 'yg'],
  [/pro set/, 'proset'],
  [/sp authentic/, 'spa'],
  [/the cup/, 'cup'],
  [/stadium club/, 'sc'],
  [/pokemon/, 'pkmn'],
  [/magic: the gathering|magic the gathering/, 'mtg magic'],
  [/yu-?gi-?oh/, 'yugioh ygo'],
  [/refractor/, 'ref'],
];

export interface SearchableCard {
  sku: string;
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
  is_rookie: boolean | number;
  is_autograph: boolean | number;
  is_memorabilia: boolean | number;
  is_graded: boolean | number;
  grading_company: string;
  grade: string;
  cert_number: string;
  condition: string;
  location_binder: string;
  location_page: string;
  location_slot: string;
  title: string;
  tags: string;
  notes: string;
  acquired_from: string;
}

export function buildSearchText(c: SearchableCard): string {
  const num = (c.card_number ?? '').replace(/^#/, '').trim();
  const parts: string[] = [
    c.sku,
    c.category,
    c.player,
    c.team,
    c.year,
    c.brand,
    c.set_name,
    c.subset,
    num,
    num ? `#${num}` : '',
    c.parallel,
    c.serial_number,
    c.serial_number ? 'numbered serial' : '',
    c.is_rookie ? 'rookie rc' : '',
    c.is_autograph ? 'autograph auto signed' : '',
    c.is_memorabilia ? 'memorabilia relic patch jersey' : '',
    c.is_graded ? `graded slab ${c.grading_company} ${c.grade} ${c.grading_company}${c.grade}` : 'raw ungraded',
    c.cert_number,
    c.condition,
    c.location_binder ? `binder ${c.location_binder}` : '',
    c.location_page ? `page ${c.location_page}` : '',
    c.location_slot ? `slot ${c.location_slot}` : '',
    c.title,
    c.tags,
    c.notes,
    c.acquired_from,
  ];
  // Two-digit year shorthand: "1979-80" also matches "79", "1990" matches "90".
  const yearMatch = /^(\d{4})/.exec((c.year ?? '').trim());
  if (yearMatch) parts.push(yearMatch[1].slice(2));
  let text = normalize(parts.filter(Boolean).join(' '));
  for (const [re, alias] of ALIASES) {
    if (re.test(text)) text += ` ${alias}`;
  }
  return ` ${text} `;
}

/** Split a query into lower-cased terms; "quoted phrases" stay together. */
export function tokenizeQuery(q: string): string[] {
  const out: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  const norm = normalize(q);
  while ((m = re.exec(norm)) !== null) {
    const t = (m[1] ?? m[2] ?? '').trim();
    if (t) out.push(t);
  }
  return out.slice(0, 12);
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** SQL fragment + params requiring every term to appear in `column`. */
export function searchClause(q: string, column = 'c.search_text'): { sql: string; params: string[] } {
  const terms = tokenizeQuery(q);
  if (terms.length === 0) return { sql: '', params: [] };
  const sql = terms.map(() => `${column} LIKE ? ESCAPE '\\'`).join(' AND ');
  return { sql, params: terms.map((t) => `%${escapeLike(t)}%`) };
}
