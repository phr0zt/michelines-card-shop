import Anthropic from '@anthropic-ai/sdk';
import { ApiError as GeminiApiError } from '@google/genai';

export class AiError extends Error {}

/** Gemini errors carry the API's JSON error body as their message; pull out the readable part. */
export function geminiMessage(err: GeminiApiError): string {
  try {
    const body = JSON.parse(err.message) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // not JSON
  }
  return err.message;
}

function friendlyGeminiError(err: GeminiApiError): string {
  const message = geminiMessage(err).slice(0, 300);
  if (/api key/i.test(message) || err.status === 401) {
    return 'The Gemini API key was rejected. Check GEMINI_API_KEY on the server.';
  }
  if (err.status === 403) return `Your Gemini key can’t use this model or feature: ${message}`;
  if (err.status === 404) return 'The Gemini model in Settings was not found. Pick a different model in Settings → AI.';
  if (err.status === 429) return 'Gemini rate limit or free-tier quota reached. Wait a while and retry.';
  if (err.status >= 500) return 'Gemini is overloaded or had an error. Retry in a few minutes.';
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
