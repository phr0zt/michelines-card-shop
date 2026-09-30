import { ApiError, FinishReason, type GenerateContentConfig, type GenerateContentResponse, type Part } from '@google/genai';
import { z } from 'zod';
import type { PriceSource, Settings } from '../../../shared/types';
import type { Db } from '../../db';
import type { ImageStore } from '../images';
import type { GeminiClient } from './client';
import { emptyUsage, type UsageTotals } from './costs';
import { AiError, geminiBareQuotaError, geminiMessage } from './errors';
import { IDENTIFY_SYSTEM, IdentificationSchema, identifyInstructions, loadCardPhotos, type IdentifyOptions, type IdentifyOutcome } from './identify';
import { describeCard, pricingSystemPrompt, ReportSchema, safeUrl, toPriceResult, type PricingOutcome } from './pricing';

// Google Gemini (AI Studio key) as an alternative to Claude: the same prompts
// and output schemas, with Grounding with Google Search for price research.

/** The JSON Schema keywords Gemini's responseJsonSchema understands; others are dropped. */
const SCHEMA_KEYWORDS = new Set([
  'type',
  'format',
  'title',
  'description',
  'enum',
  'items',
  'prefixItems',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'anyOf',
  'oneOf',
  'properties',
  'additionalProperties',
  'required',
  '$defs',
  '$ref',
]);

export function geminiJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!SCHEMA_KEYWORDS.has(key)) continue;
    // Under "properties" and "$defs" the keys are field names, not keywords.
    out[key] =
      key === 'properties' || key === '$defs'
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, geminiJsonSchema(v)]))
        : geminiJsonSchema(value);
  }
  return out;
}

const IDENTIFICATION_SCHEMA = geminiJsonSchema(z.toJSONSchema(IdentificationSchema));
const REPORT_SCHEMA = geminiJsonSchema(z.toJSONSchema(ReportSchema));

const DECLINED = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.RECITATION,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
]);

function addGeminiUsage(total: UsageTotals, response: GenerateContentResponse): void {
  const u = response.usageMetadata;
  total.input_tokens += (u?.promptTokenCount ?? 0) + (u?.toolUsePromptTokenCount ?? 0);
  total.output_tokens += (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0);
  total.web_search_requests += response.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0;
  total.requests += 1;
}

function checkFinish(response: GenerateContentResponse, declined: string): void {
  const reason = response.candidates?.[0]?.finishReason;
  if (response.promptFeedback?.blockReason || (reason && DECLINED.has(reason))) throw new AiError(declined);
  if (reason === FinishReason.MAX_TOKENS) throw new AiError('The AI response was cut off. Please retry.');
}

/** The JSON object in a reply, with or without a ```json fence around it. */
export function jsonFromText(text: string | undefined): unknown {
  if (!text) return undefined;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export async function runGeminiIdentification(
  client: GeminiClient,
  db: Db,
  images: ImageStore,
  cardId: number,
  model: string,
  options: IdentifyOptions = {},
): Promise<IdentifyOutcome> {
  const parts: Part[] = [];
  for (const photo of await loadCardPhotos(db, images, cardId)) {
    parts.push({ text: photo.label }, { inlineData: { mimeType: 'image/jpeg', data: photo.data } });
  }
  parts.push({ text: identifyInstructions(options.categoryHint) });

  const response = await client.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: IDENTIFY_SYSTEM,
      responseMimeType: 'application/json',
      responseJsonSchema: IDENTIFICATION_SCHEMA,
    },
  });
  const usage = emptyUsage();
  addGeminiUsage(usage, response);
  checkFinish(response, 'The AI declined to identify these photos. You can fill in the details by hand.');
  const parsed = IdentificationSchema.safeParse(jsonFromText(response.text));
  if (!parsed.success) throw new AiError('The AI did not return a usable identification. Please retry.');
  return { identification: parsed.data, usage, model: response.modelVersion || model };
}

const PRICE_FINISH =
  'Reply with the report as a JSON object: found_data, currency, low, typical, high, suggested_list_price, quick_sale_price, confidence (low | medium | high), summary, advice, and up to 8 of the most relevant comps with their URLs.';

/** Gemini rejects a response schema combined with Google Search on some models; this spots that error. */
function schemaWithToolsRejected(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /schema|mime|json|tool/i.test(geminiMessage(err));
}

const NO_SEARCH = `

Web search is not available for this request. Estimate from what you already know about this card and its market. Start the summary with "Estimate without a live search:", say it is not based on current sales and may be out of date, use low confidence, and leave comps empty.`;

const ESTIMATE_PREFIX = 'Estimate without a live search:';

// Google Search isn't part of Gemini's free tier: those requests get a bare 429. After seeing one,
// skip the search for a while instead of spending a request on it every time.
const SEARCH_RETRY_MS = 30 * 60 * 1000;
const searchUnavailableUntil = new WeakMap<GeminiClient, number>();

export async function runGeminiPricing(
  client: GeminiClient,
  db: Db,
  cardId: number,
  settings: Settings,
  model: string,
): Promise<PricingOutcome> {
  const { text } = describeCard(db, cardId);
  const prompt = `Research the current market value of this card.\n\n${text}`;
  const config: GenerateContentConfig = {
    systemInstruction: pricingSystemPrompt(settings, PRICE_FINISH),
    tools: [{ googleSearch: {} }],
  };
  const estimateOnly = () =>
    client.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: pricingSystemPrompt(settings, PRICE_FINISH) + NO_SEARCH,
        responseMimeType: 'application/json',
        responseJsonSchema: REPORT_SCHEMA,
      },
    });

  let response: GenerateContentResponse;
  let searched = true;
  if ((searchUnavailableUntil.get(client) ?? 0) > Date.now()) {
    searched = false;
    response = await estimateOnly();
  } else {
    try {
      response = await client.models.generateContent({
        model,
        contents: prompt,
        config: { ...config, responseMimeType: 'application/json', responseJsonSchema: REPORT_SCHEMA },
      });
    } catch (err) {
      if (geminiBareQuotaError(err)) {
        searchUnavailableUntil.set(client, Date.now() + SEARCH_RETRY_MS);
        searched = false;
        response = await estimateOnly();
      } else if (schemaWithToolsRejected(err)) {
        // Ask for the same JSON in plain text instead.
        response = await client.models.generateContent({
          model,
          contents: `${prompt}\n\nReply with only the JSON object, matching this JSON Schema:\n${JSON.stringify(REPORT_SCHEMA)}`,
          config,
        });
      } else {
        throw err;
      }
    }
  }
  const usage = emptyUsage();
  addGeminiUsage(usage, response);
  checkFinish(response, 'The AI declined to research this card. You can add a price check by hand.');
  const parsed = ReportSchema.safeParse(jsonFromText(response.text));
  if (!parsed.success) throw new AiError('The AI returned an unreadable price report. Please retry.');

  const sources = new Map<string, PriceSource>();
  for (const chunk of response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
    const url = safeUrl(chunk.web?.uri ?? '');
    if (url && !sources.has(url)) sources.set(url, { title: chunk.web?.title || url, url });
  }
  const servedBy = response.modelVersion || model;
  const result = toPriceResult(parsed.data, sources, settings, servedBy);
  if (!searched) {
    // Only what the model remembers: say so, never pass it off as researched, and don't set asking prices from it.
    result.estimate = true;
    result.confidence = 'low';
    result.comps = [];
    result.sources = [];
    if (!result.summary.startsWith(ESTIMATE_PREFIX)) result.summary = `${ESTIMATE_PREFIX} ${result.summary}`.trim();
  }
  return { result, usage, model: servedBy };
}
