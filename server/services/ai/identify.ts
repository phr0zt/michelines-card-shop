import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { cardLabel } from '../../../shared/cardText';
import { CATEGORIES, CONDITIONS, type AiEffort } from '../../../shared/constants';
import type { Db } from '../../db';
import { nowIso } from '../../lib/time';
import { getCardRow, refreshSearchText, type CardRow } from '../cards';
import { logActivity } from '../common';
import type { ImageStore } from '../images';
import { fallbackParams, type AiClient } from './client';
import { addUsage, emptyUsage, type UsageTotals } from './costs';
import { AiError } from './errors';

// Category, condition and confidence are plain strings with the choices in the description:
// the SDK's schema transform turns `enum` into a description hint anyway, and a strict zod enum
// would reject the whole identification over one off-list word. They're normalised below.
export const IdentificationSchema = z.object({
  is_trading_card: z.boolean().describe('False if the photos do not show a trading card.'),
  category: z.string().describe(`Exactly one of: ${CATEGORIES.join(' | ')}`),
  player: z.string().describe('Player, or for TCG cards the character/card name. Empty if unknown.'),
  team: z.string(),
  year: z.string().describe('Year or season as the set uses it, e.g. "1990-91" for most hockey sets, "2023" for baseball.'),
  brand: z.string().describe('Manufacturer, e.g. O-Pee-Chee, Upper Deck, Topps, Panini, Parkhurst, Score.'),
  set_name: z.string().describe('Set name, e.g. "Upper Deck Series 1", "Topps Chrome", "Base Set".'),
  subset: z.string().describe('Insert or subset, e.g. "Young Guns", "Rated Rookie". Empty for base cards.'),
  card_number: z.string().describe('Card number as printed, without "#".'),
  parallel: z.string().describe('Parallel or variation, e.g. "Gold Refractor", "Exclusives". Empty for base.'),
  serial_number: z.string().describe('Serial numbering visible on the card, e.g. "045/199". Empty if not numbered.'),
  is_rookie: z.boolean(),
  is_autograph: z.boolean(),
  is_memorabilia: z.boolean().describe('Contains a jersey/patch/relic piece.'),
  is_graded: z.boolean().describe('The card is sealed in a grading-company slab.'),
  grading_company: z.string().describe('PSA, BGS, SGC, CGC, … when graded; else empty.'),
  grade: z.string().describe('Numeric or label grade from the slab, e.g. "9", "9.5", "Authentic".'),
  cert_number: z.string().describe('Certification number from the slab label, only if clearly readable.'),
  condition: z.string().describe(`One of: ${CONDITIONS.join(' | ')} | Unknown`),
  condition_notes: z.string().describe('What you can see: centering, corners, edges, surface; and what the photos cannot show.'),
  title: z.string().describe('eBay-style listing title, at most 80 characters.'),
  description: z.string().describe('2–4 plain sentences for a buyer. Honest condition summary. No hype, no emojis.'),
  search_query: z.string().describe('Words to type into eBay sold listings to find this exact card.'),
  notable: z.string().describe('Anything that matters for value: Hall of Famer, key rookie, short print, error card… Empty if nothing.'),
  uncertainties: z.string().describe('Anything you are unsure about. Empty if nothing.'),
  confidence: z.string().describe('How sure you are overall: low | medium | high'),
});

export type Identification = z.infer<typeof IdentificationSchema>;

const SYSTEM = `You identify sports and trading cards from photos for a small card shop's inventory. You know card sets across hockey (O-Pee-Chee, Topps, Upper Deck, Parkhurst, Pro Set, Score, Pinnacle, Fleer, Bowman and more), baseball, basketball, football, soccer, and trading card games such as Pokémon, Magic: The Gathering and Yu-Gi-Oh!.

How to fill in the record:
- Read what is printed: card number, copyright line, set logo, serial-number stamps like 045/199, and grading-slab labels. Use your knowledge of card designs to supply what isn't printed (such as the set and year a design belongs to), but never invent a serial number or certification number you cannot read.
- Use season years like "1990-91" when the set does (most hockey and basketball sets).
- Mark is_rookie only for the player's actual rookie card (RC logo or a recognized rookie card).
- For an ungraded card, estimate condition from centering, corners, edges and surface as far as the photos show, and say what you saw in condition_notes. For a slabbed card, use the label grade and pick the matching condition.
- Leave a field as an empty string when you can't tell, and note doubts in uncertainties.`;

export interface IdentifyOptions {
  categoryHint?: string;
}

export interface IdentifyOutcome {
  identification: Identification;
  usage: UsageTotals;
  model: string;
}

type ImagePart = Anthropic.Beta.Messages.BetaContentBlockParam;

async function buildContent(db: Db, images: ImageStore, cardId: number, hint?: string): Promise<ImagePart[]> {
  const rows = db
    .prepare(
      `SELECT side, file_key FROM card_images WHERE card_id = ?
       ORDER BY CASE side WHEN 'front' THEN 0 WHEN 'back' THEN 1 ELSE 2 END, sort_order, id LIMIT 4`,
    )
    .all(cardId) as { side: string; file_key: string }[];
  if (rows.length === 0) throw new AiError('Add a photo of the card first.');

  const content: ImagePart[] = [];
  const onlyOne = rows.length === 1;
  rows.forEach((row, i) => {
    const label =
      row.side === 'front'
        ? onlyOne
          ? 'the front of the card (this one photo may also show the back beside it)'
          : 'the front of the card'
        : row.side === 'back'
          ? 'the back of the card'
          : 'an extra photo of the card';
    content.push({ type: 'text', text: `Photo ${i + 1}: ${label}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '' } });
  });
  // Load image data after the layout is decided so errors surface before any big allocations.
  let imgIndex = 0;
  for (const block of content) {
    if (block.type === 'image' && block.source.type === 'base64') {
      block.source.data = await images.forAi(rows[imgIndex].file_key);
      imgIndex++;
    }
  }
  const instructions = ['Identify this card and fill in the inventory record.'];
  if (hint) instructions.push(`The owner filed it under the category "${hint}".`);
  content.push({ type: 'text', text: instructions.join(' ') });
  return content;
}

export async function runIdentification(
  client: AiClient,
  db: Db,
  images: ImageStore,
  cardId: number,
  model: string,
  effort: AiEffort,
  options: IdentifyOptions = {},
): Promise<IdentifyOutcome> {
  const content = await buildContent(db, images, cardId, options.categoryHint);
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: betaZodOutputFormat(IdentificationSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    ...fallbackParams(model),
  });
  const usage = addUsage(emptyUsage(), response.usage);
  if (response.stop_reason === 'refusal') {
    throw new AiError('The AI declined to identify these photos. You can fill in the details by hand.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AiError('The AI response was cut off. Please retry.');
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new AiError('The AI did not return a usable identification. Please retry.');
  return { identification: parsed, usage, model: response.model ?? model };
}

const CONFIDENCE_SCORE = { low: 0.4, medium: 0.7, high: 0.9 } as const;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function normalizeCategory(value: string, fallback: string): string {
  const v = fold(value);
  const exact = CATEGORIES.find((c) => fold(c) === v);
  if (exact) return exact;
  const rules: [RegExp, string][] = [
    [/pokemon|pkmn/, 'Pokémon'],
    [/magic|mtg/, 'Magic: The Gathering'],
    [/yu ?gi ?oh/, 'Yu-Gi-Oh!'],
    [/one piece/, 'One Piece'],
    [/lorcana/, 'Lorcana'],
    [/hockey|nhl/, 'Hockey'],
    [/baseball|mlb/, 'Baseball'],
    [/basketball|nba/, 'Basketball'],
    [/football|nfl|cfl/, 'Football'],
    [/soccer|futbol/, 'Soccer'],
    [/racing|nascar|f1|formula/, 'Racing'],
    [/wrestling|wwe|wwf/, 'Wrestling'],
    [/golf/, 'Golf'],
    [/tcg|trading card game/, 'Other TCG'],
    [/non ?sport|entertainment|movie|tv/, 'Non-Sport'],
  ];
  for (const [re, category] of rules) if (re.test(v)) return category;
  return fallback || 'Other Sports';
}

const CONDITION_ALIASES: [RegExp, string][] = [
  [/^gem/, 'Gem Mint'],
  [/^(nm ?mt|near mint ?mint)/, 'Near Mint-Mint'],
  [/^(ex ?mt|excellent ?mint)/, 'Excellent-Mint'],
  [/^(vg ?ex|very good ?excellent)/, 'Very Good-Excellent'],
  [/^(nm|near mint)/, 'Near Mint'],
  [/^(ex|excellent)/, 'Excellent'],
  [/^(vg|very good)/, 'Very Good'],
  [/^mint/, 'Mint'],
  [/^good/, 'Good'],
  [/^fair/, 'Fair'],
  [/^poor/, 'Poor'],
];

export function normalizeCondition(value: string): string | null {
  const v = fold(value);
  const exact = CONDITIONS.find((c) => fold(c) === v);
  if (exact) return exact;
  for (const [re, condition] of CONDITION_ALIASES) if (re.test(v)) return condition;
  return null;
}

export function normalizeConfidence(value: string): keyof typeof CONFIDENCE_SCORE {
  const v = value.toLowerCase();
  return v.includes('high') ? 'high' : v.includes('low') ? 'low' : 'medium';
}

const TEXT_FIELDS = [
  'player',
  'team',
  'year',
  'brand',
  'set_name',
  'subset',
  'card_number',
  'parallel',
  'serial_number',
  'grading_company',
  'grade',
  'cert_number',
  'condition_notes',
  'title',
  'description',
] as const;

const FLAG_FIELDS = ['is_rookie', 'is_autograph', 'is_memorabilia', 'is_graded'] as const;

/**
 * Write the AI's identification onto the card. New drafts take everything;
 * for reviewed cards only blank fields are filled unless `overwrite` is set,
 * so nothing a person typed gets clobbered.
 */
export function applyIdentification(db: Db, cardId: number, result: Identification, overwrite: boolean): void {
  const card = getCardRow(db, cardId);
  const takeAll = overwrite || card.status === 'draft';
  const updates: Record<string, unknown> = {};

  for (const field of TEXT_FIELDS) {
    let value = (result[field] ?? '').trim();
    if (field === 'card_number') value = value.replace(/^#/, '');
    if (field === 'title') value = value.slice(0, 80).trim();
    const current = (card[field] as string) ?? '';
    if (!value) continue;
    if (takeAll || current.trim() === '') updates[field] = value;
  }
  for (const field of FLAG_FIELDS) {
    if (takeAll) updates[field] = result[field] ? 1 : 0;
    else if (result[field] && !card[field]) updates[field] = 1;
  }
  if (takeAll || !card.category) updates.category = normalizeCategory(result.category, card.category);
  const condition = normalizeCondition(result.condition);
  if (condition && (takeAll || !card.condition)) updates.condition = condition;
  const confidence = normalizeConfidence(result.confidence);

  const notes = [result.notable && `Notable: ${result.notable}`, result.uncertainties && `Unsure about: ${result.uncertainties}`]
    .filter(Boolean)
    .join('\n');
  const now = nowIso();
  updates.ai_identified_at = now;
  updates.ai_confidence = CONFIDENCE_SCORE[confidence];
  updates.ai_notes = result.is_trading_card ? notes : `This may not be a trading card. ${notes}`.trim();
  updates.updated_at = now;

  db.transaction(() => {
    const keys = Object.keys(updates);
    db.prepare(`UPDATE cards SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @__id`).run({
      ...updates,
      __id: cardId,
    });
    refreshSearchText(db, cardId);
    const after = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as CardRow;
    logActivity(
      db,
      cardId,
      'ai',
      result.is_trading_card
        ? `AI identified this as ${cardLabel(after)} (${confidence} confidence)`
        : 'AI could not recognise a trading card in these photos',
    );
  })();
}
