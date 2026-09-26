import Anthropic from '@anthropic-ai/sdk';

/** The part of the SDK client the app uses. Tests pass a fake with the same shape. */
export type AiClient = Pick<Anthropic, 'beta'>;

export function aiKeyConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function createAiClient(): AiClient | null {
  if (!aiKeyConfigured()) return null;
  // Credentials come from ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in the environment.
  return new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
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
