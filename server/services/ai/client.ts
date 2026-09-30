import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import type { AiProvider } from '../../../shared/constants';

/** The part of each SDK client the app uses. Tests pass fakes with the same shape. */
export type AiClient = Pick<Anthropic, 'beta'>;
export type GeminiClient = Pick<GoogleGenAI, 'models'>;

/** One client per AI provider; null when that provider has no API key. */
export interface AiClients {
  claude: AiClient | null;
  gemini: GeminiClient | null;
}

export function aiKeyConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function createAiClient(): AiClient | null {
  if (!aiKeyConfigured()) return null;
  // Credentials come from ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in the environment.
  return new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
}

/** A Google AI Studio key from GEMINI_API_KEY (or GOOGLE_API_KEY). */
export function createGeminiClient(): GeminiClient | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: 10 * 60 * 1000, retryOptions: { attempts: 4 } } });
}

export function availableProviders(clients: AiClients): Record<AiProvider, boolean> {
  return { claude: clients.claude !== null, gemini: clients.gemini !== null };
}

/**
 * Opus 5-family models can decline a request via safety classifiers; with
 * `fallbacks: "default"` the API retries a declined request on Anthropic's
 * recommended fallback model inside the same call.
 */
export function fallbackParams(model: string): { betas?: string[]; fallbacks?: 'default' } {
  if (/^claude-(opus-5|fable-5)/.test(model)) {
    return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  }
  return {};
}
