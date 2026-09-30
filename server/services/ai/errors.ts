import Anthropic from '@anthropic-ai/sdk';
import { ApiError as GeminiApiError } from '@google/genai';

export class AiError extends Error {}

interface GeminiErrorBody {
  message: string;
  details: Record<string, unknown>[];
}

/** Gemini errors carry the API's JSON error body as their message; this parses it. */
function geminiBody(err: GeminiApiError): GeminiErrorBody {
  try {
    const body = JSON.parse(err.message) as { error?: { message?: string; details?: unknown } };
    if (body.error) {
      return {
        message: body.error.message || err.message,
        details: Array.isArray(body.error.details) ? (body.error.details as Record<string, unknown>[]) : [],
      };
    }
  } catch {
    // not JSON
  }
  return { message: err.message, details: [] };
}

/** The readable part of a Gemini error. */
export function geminiMessage(err: GeminiApiError): string {
  return geminiBody(err).message;
}

export interface GeminiQuota {
  /** The limit that was hit, e.g. 5 (requests a minute); null if Google didn't say. */
  limit: number | null;
  model: string | null;
  daily: boolean;
  /** How long Google says to wait, if it said. */
  retryMs: number | null;
}

/** What a Gemini 429 says about the quota that was hit (Google's QuotaFailure and RetryInfo details). */
export function geminiQuota(err: GeminiApiError): GeminiQuota {
  const { message, details } = geminiBody(err);
  const detail = (type: string) => details.find((d) => String(d['@type'] ?? '').endsWith(type));
  const violation = (detail('google.rpc.QuotaFailure')?.violations as Record<string, unknown>[] | undefined)?.[0];
  const quotaId = String(violation?.quotaId ?? '');
  const limitText = (violation?.quotaValue as string | undefined) ?? /limit: (\d+)/.exec(message)?.[1];
  const dimensions = violation?.quotaDimensions as Record<string, string> | undefined;
  const delay = (detail('google.rpc.RetryInfo')?.retryDelay as string | undefined) ?? /retry in ([\d.]+)s/i.exec(message)?.[1];
  const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
  return {
    limit: limitText === undefined ? null : Number(limitText),
    model: dimensions?.model ?? /model: ([\w.-]+)/.exec(message)?.[1] ?? null,
    daily: /PerDay/i.test(quotaId),
    retryMs: Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : null,
  };
}

/** A bare 429 with no quota details: what Gemini returns for Google Search on a free-tier key. */
export function geminiBareQuotaError(err: unknown): boolean {
  if (!(err instanceof GeminiApiError) || err.status !== 429) return false;
  const quota = geminiQuota(err);
  return quota.limit === null && quota.retryMs === null;
}

export interface RetryWait {
  waitMs: number;
  /** Shown on the card while it waits. */
  note: string;
}

/**
 * Rate limits and "too busy" answers that are worth waiting out, with how long
 * to wait. Null for errors that waiting won't fix (a used-up daily quota, a bad key…).
 */
export function retryWait(err: unknown): RetryWait | null {
  if (err instanceof GeminiApiError) {
    if (err.status === 429) {
      const quota = geminiQuota(err);
      if (quota.daily || quota.limit === 0) return null;
      const note =
        quota.limit !== null
          ? `Gemini allows ${quota.limit} requests a minute${quota.model ? ` for ${quota.model}` : ''} on this key.`
          : 'Gemini says too many requests right now.';
      return { waitMs: (quota.retryMs ?? 60_000) + 1_000, note };
    }
    if (err.status === 503) return { waitMs: 45_000, note: 'Gemini is busy right now (high demand).' };
    if (err.status >= 500) return { waitMs: 60_000, note: 'Gemini had a temporary error.' };
    return null;
  }
  if (err instanceof Anthropic.RateLimitError) {
    const seconds = Number(err.headers?.get('retry-after'));
    return { waitMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 + 1_000 : 60_000, note: 'Anthropic rate limit reached.' };
  }
  if (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503)) {
    return { waitMs: 60_000, note: 'Claude is overloaded right now.' };
  }
  return null;
}

function friendlyGeminiError(err: GeminiApiError): string {
  const message = geminiMessage(err).slice(0, 300);
  if (/api key/i.test(message) || err.status === 401) {
    return 'The Gemini API key was rejected. Check GEMINI_API_KEY on the server.';
  }
  if (err.status === 403) return `Your Gemini key can’t use this model or feature: ${message}`;
  if (err.status === 404) return 'The Gemini model in Settings was not found. Pick a different model in Settings → AI.';
  if (err.status === 429) {
    const { limit, model, daily } = geminiQuota(err);
    const which = model ?? 'this model';
    if (daily) {
      return `Gemini’s daily limit for ${which} is used up${limit ? ` (${limit} requests a day)` : ''}. It resets at midnight Pacific time. You can pick another Gemini model in Settings → AI (each has its own limit), or turn on billing in Google AI Studio for higher limits.`;
    }
    if (limit === 0) {
      return `Your Gemini key has no free quota for ${which}. Pick another model in Settings → AI, or turn on billing in Google AI Studio.`;
    }
    if (limit !== null) {
      return `Gemini kept hitting its limit of ${limit} requests a minute for ${which}. Retry in a few minutes, or turn on billing in Google AI Studio for higher limits.`;
    }
    return 'Gemini says your quota is used up. The free tier has low limits; turning on billing in Google AI Studio raises them.';
  }
  if (err.status === 503) return 'Gemini was too busy to answer (high demand). Retry in a few minutes.';
  if (err.status >= 500) return 'Gemini had an error. Retry in a few minutes.';
  return `Gemini rejected the request: ${message}`;
}

/** Turn SDK errors into messages a shop owner can act on. */
export function friendlyAiError(err: unknown): string {
  if (err instanceof AiError) return err.message;
  if (err instanceof GeminiApiError) return friendlyGeminiError(err);
  if (err instanceof Anthropic.AuthenticationError) {
    return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the server.';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'Your Anthropic account is not allowed to use this model or tool. If price research fails, make sure web search is enabled for your organization in the Claude Console.';
  }
  if (err instanceof Anthropic.NotFoundError) {
    return 'The AI model in Settings was not found. Pick a different model in Settings → AI.';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Anthropic rate limit reached. Wait a minute and retry.';
  }
  if (err instanceof Anthropic.BadRequestError && /credit balance is too low/i.test(err.message)) {
    return 'Your Anthropic account has no credit left. Add credit at console.anthropic.com (Plans & Billing), or pick a Gemini model in Settings → AI if you have a Gemini key.';
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `Anthropic rejected the request: ${err.message}`;
  }
  if (err instanceof Anthropic.InternalServerError) {
    return 'Anthropic is overloaded or had an error. Retry in a few minutes.';
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach Anthropic. Check the server’s internet connection and retry.';
  }
  if (err instanceof Anthropic.APIError) {
    return `AI request failed (${err.status ?? 'error'}): ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return 'AI request failed';
}
