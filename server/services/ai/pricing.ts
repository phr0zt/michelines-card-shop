import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { cardLabel, detailLines, researchQuery } from '../../../shared/cardText';
import type { AiEffort, PriceConfidence } from '../../../shared/constants';
import type { PriceComp, PriceSource, Settings } from '../../../shared/types';
import type { Db } from '../../db';
import { getCard } from '../cards';
import type { PriceResult } from '../priceChecks';
import { fallbackParams, type AiClient } from './client';
import { addUsage, emptyUsage, type UsageTotals } from './costs';
import { AiError } from './errors';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock;

const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };

const REPORT_TOOL = {
  name: 'report_market_value',
  description:
    'Report the final market value findings for the card. Call this exactly once, after you have finished researching.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: [
      'found_data',
      'currency',
      'low',
      'typical',
      'high',
      'suggested_list_price',
      'quick_sale_price',
      'confidence',
      'summary',
      'advice',
      'comps',
    ],
    properties: {
      found_data: {
        type: 'boolean',
        description: 'True if you found real sales or price-guide data for this card or a very close match.',
      },
      currency: { type: 'string', description: 'Currency of all the numbers below (the shop currency).' },
      low: { ...nullableNumber, description: 'Low end of realistic sold prices for this card in this condition.' },
      typical: { ...nullableNumber, description: 'Typical/most likely sale price — the market value.' },
      high: { ...nullableNumber, description: 'High end of realistic sold prices.' },
      suggested_list_price: {
        ...nullableNumber,
        description: 'Fixed price to list at, leaving a little room for offers.',
      },
      quick_sale_price: { ...nullableNumber, description: 'Price that would sell quickly (local buyer or dealer).' },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      summary: { type: 'string', description: '2–4 sentences describing the market for this card and what the numbers are based on.' },
      advice: {
        type: 'string',
        description: 'Short selling advice: best places to sell, whether grading is worth it, pricing strategy.',
      },
      comps: {
        type: 'array',
        description: 'Up to 8 of the most relevant comparable sales or price-guide entries.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'price', 'currency', 'date', 'venue', 'url', 'grade', 'sold'],
          properties: {
            title: { type: 'string' },
            price: { type: 'number', description: 'Price in the original currency of the source.' },
            currency: { type: 'string', description: 'Original currency, e.g. USD or CAD.' },
            date: { type: 'string', description: 'Sale date (YYYY-MM-DD) if known, else empty.' },
            venue: { type: 'string', description: 'Where: eBay, PriceCharting, 130point, COMC, Beckett, …' },
            url: { type: 'string', description: 'Source URL, or empty.' },
            grade: { type: 'string', description: 'Raw, or e.g. PSA 9.' },
            sold: { type: 'boolean', description: 'True for a completed sale, false for an asking price or guide value.' },
          },
        },
      },
    },
  },
};

const ReportSchema = z.object({
  found_data: z.boolean(),
  currency: z.string(),
  low: z.number().nullable(),
  typical: z.number().nullable(),
  high: z.number().nullable(),
  suggested_list_price: z.number().nullable(),
  quick_sale_price: z.number().nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
  summary: z.string(),
  advice: z.string(),
  comps: z.array(
    z.object({
      title: z.string(),
      price: z.number(),
      currency: z.string(),
      date: z.string(),
      venue: z.string(),
      url: z.string(),
      grade: z.string(),
      sold: z.boolean(),
    }),
  ),
});

function systemPrompt(settings: Settings): string {
  const cur = settings.currency;
  const conversion =
    cur === 'USD'
      ? ''
      : ` Convert USD prices at ${settings.usd_exchange_rate} ${cur} per USD (keep each comp in its original currency).`;
  return `You research what trading cards actually sell for, for a small card shop. Use web search to find current market prices for the exact card described.

- Prefer completed (sold) prices from roughly the last three months: eBay sold listings, 130point, PriceCharting / SportsCardsPro, Card Ladder, COMC, PSA auction prices, Goldin. Beckett guide values are a secondary reference. Asking prices on active listings are only an upper bound.
- Match the exact card: year, set, card number, parallel or serial numbering, and condition. Compare raw cards with raw sales, and graded cards with sales at the same grade from the same grader. For a raw card, you can mention what graded copies bring in the advice.
- Report low / typical / high, suggested_list_price and quick_sale_price in ${cur}.${conversion}
- If the exact card has no data, use the closest comparable cards, say so in the summary, and use low confidence. If there's really nothing to go on, set found_data to false and leave the prices null.
- Common cards worth under a dollar or two are normal; just say so.
- Finish by calling report_market_value once, with up to 8 of the most relevant comps and their URLs.`;
}

function describeCard(db: Db, cardId: number): { label: string; text: string } {
  const card = getCard(db, cardId);
  const label = cardLabel(card);
  if (label === 'Unidentified card' && !card.title) {
    throw new AiError('Identify the card first (or fill in the player, year and set) so there is something to research.');
  }
  const lines = [
    `Card: ${card.title || label}`,
    `Category: ${card.category}`,
    ...detailLines(card),
    card.condition_notes ? `Condition notes: ${card.condition_notes}` : '',
    card.quantity > 1 ? `Quantity: ${card.quantity} copies` : '',
    `Suggested search: ${researchQuery(card)}`,
  ].filter(Boolean);
  return { label, text: lines.join('\n') };
}

/**
 * After a server-side fallback mid-answer, only text blocks from before the
 * last `fallback` marker may be sent back; everything after it echoes normally.
 */
function echoableContent(content: ContentBlock[]): ContentBlock[] {
  let last = -1;
  content.forEach((b, i) => {
    if (b.type === 'fallback') last = i;
  });
  if (last < 0) return content;
  return content.filter((b, i) => i > last || b.type === 'text');
}

function collectSources(content: ContentBlock[], into: Map<string, PriceSource>): void {
  for (const block of content) {
    if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue;
    for (const result of block.content) {
      if (result.type === 'web_search_result' && result.url && !into.has(result.url)) {
        into.set(result.url, { title: result.title || result.url, url: result.url });
      }
    }
  }
}

const toCents = (n: number | null): number | null =>
  n === null || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100);

function safeUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export interface PricingOutcome {
  result: PriceResult;
  usage: UsageTotals;
  model: string;
}

export async function runPricing(
  client: AiClient,
  db: Db,
  cardId: number,
  settings: Settings,
  model: string,
  effort: AiEffort,
): Promise<PricingOutcome> {
  const { text } = describeCard(db, cardId);
  const messages: MessageParam[] = [
    { role: 'user', content: `Research the current market value of this card.\n\n${text}` },
  ];
  const usage = emptyUsage();
  const sources = new Map<string, PriceSource>();
  let servedBy = model;
  let nudged = false;

  for (let turn = 0; turn < 8; turn++) {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort },
      system: systemPrompt(settings),
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: settings.ai_max_searches },
        REPORT_TOOL,
      ],
      tool_choice: { type: 'auto' },
      messages,
      ...fallbackParams(model),
    });
    addUsage(usage, response.usage);
    servedBy = response.model ?? servedBy;
    collectSources(response.content, sources);

    if (response.stop_reason === 'refusal') {
      throw new AiError('The AI declined to research this card. You can add a price check by hand.');
    }
    const report = response.content.find(
      (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use' && b.name === REPORT_TOOL.name,
    );
    if (report) {
      const parsed = ReportSchema.safeParse(report.input);
      if (!parsed.success) throw new AiError('The AI returned an unreadable price report. Please retry.');
      return { result: toPriceResult(parsed.data, sources, settings, servedBy), usage, model: servedBy };
    }
    if (response.stop_reason === 'max_tokens') throw new AiError('The AI response was cut off. Please retry.');

    messages.push({ role: 'assistant', content: echoableContent(response.content) });
    if (response.stop_reason === 'pause_turn') continue; // server-side search loop paused; resend to resume
    if (nudged) break;
    nudged = true;
    messages.push({ role: 'user', content: 'Please call report_market_value now with what you found.' });
  }
  throw new AiError('The AI finished without reporting a price. Please retry.');
}

function toPriceResult(
  r: z.infer<typeof ReportSchema>,
  sources: Map<string, PriceSource>,
  settings: Settings,
  model: string,
): PriceResult {
  const comps: PriceComp[] = r.comps.slice(0, 12).map((c) => ({
    title: c.title.slice(0, 300),
    price: Number.isFinite(c.price) ? c.price : 0,
    currency: (c.currency || settings.currency).slice(0, 8).toUpperCase(),
    date: c.date.slice(0, 20),
    venue: c.venue.slice(0, 80),
    url: safeUrl(c.url),
    grade: c.grade.slice(0, 40),
    sold: c.sold,
  }));
  const found = r.found_data;
  return {
    source: 'ai',
    currency: settings.currency,
    low_cents: found ? toCents(r.low) : null,
    mid_cents: found ? toCents(r.typical) : null,
    high_cents: found ? toCents(r.high) : null,
    suggested_price_cents: found ? toCents(r.suggested_list_price) : null,
    quick_sale_cents: found ? toCents(r.quick_sale_price) : null,
    confidence: r.confidence as PriceConfidence,
    summary: r.summary.slice(0, 4000),
    advice: r.advice.slice(0, 4000),
    comps,
    sources: [...sources.values()].slice(0, 20),
    model,
  };
}
