/** Rough USD cost of a request, for the "AI spend this month" figure in Settings. */

// USD per million tokens, and per web search.
const PRICES: { match: RegExp; input: number; output: number; search: number }[] = [
  { match: /^claude-opus-5-5/, input: 4, output: 20, search: 0.01 },
  { match: /^claude-opus-5/, input: 5, output: 25, search: 0.01 },
  { match: /^claude-opus-4/, input: 5, output: 25, search: 0.01 },
  { match: /^claude-fable-5/, input: 10, output: 50, search: 0.01 },
  { match: /^claude-sonnet-5/, input: 2, output: 10, search: 0.01 },
  { match: /^claude-sonnet-4/, input: 3, output: 15, search: 0.01 },
  { match: /^claude-haiku-4/, input: 1, output: 5, search: 0.01 },
  // Gemini paid-tier rates (an AI Studio free-tier key costs nothing). The first 5,000 Google
  // searches a month are free, which covers a small shop, so searches count as $0.
  { match: /^gemini-3\.5-flash-lite/, input: 0.3, output: 2.5, search: 0 },
  { match: /^gemini/, input: 0.75, output: 3.75, search: 0 },
];

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  web_search_requests: number;
  requests: number;
}

export function emptyUsage(): UsageTotals {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    web_search_requests: 0,
    requests: 0,
  };
}

interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export function addUsage(total: UsageTotals, usage: UsageLike | null | undefined): UsageTotals {
  if (!usage) return total;
  total.input_tokens += usage.input_tokens ?? 0;
  total.output_tokens += usage.output_tokens ?? 0;
  total.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
  total.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
  total.web_search_requests += usage.server_tool_use?.web_search_requests ?? 0;
  total.requests += 1;
  return total;
}

export function estimateCostUsd(model: string, usage: UsageTotals): number {
  const price = PRICES.find((p) => p.match.test(model)) ?? { input: 5, output: 25, search: 0.01 };
  const perToken = (usd: number) => usd / 1_000_000;
  const cost =
    usage.input_tokens * perToken(price.input) +
    usage.cache_creation_input_tokens * perToken(price.input * 1.25) +
    usage.cache_read_input_tokens * perToken(price.input * 0.1) +
    usage.output_tokens * perToken(price.output) +
    usage.web_search_requests * price.search;
  return Math.round(cost * 10_000) / 10_000;
}
