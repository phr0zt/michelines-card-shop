/**
 * Money is stored and sent as integer cents everywhere. These helpers convert
 * between what people type ("$1,234.50") and cents.
 */

export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  const cleaned = input.replace(/CAD|USD|US\$|C\$|[\s$€£¥,]/gi, '').trim();
  if (cleaned === '') return null;
  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === '.' || cleaned === '-') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatCents(
  cents: number | null | undefined,
  currency = 'CAD',
  locale = 'en-CA',
  opts: { compact?: boolean; noCents?: boolean } = {},
): string {
  if (cents === null || cents === undefined) return '—';
  const key = `${currency}|${locale}|${opts.compact ? 'c' : ''}|${opts.noCents ? 'n' : ''}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      notation: opts.compact ? 'compact' : 'standard',
      maximumFractionDigits: opts.compact ? 1 : opts.noCents ? 0 : 2,
      minimumFractionDigits: opts.compact || opts.noCents ? 0 : 2,
    });
    formatters.set(key, fmt);
  }
  return fmt.format(cents / 100);
}

/** Estimated platform fees for a sale: percent of (item + shipping charged) plus a fixed amount. */
export function estimateFeesCents(
  platform: { fee_percent: number; fee_fixed_cents: number } | null | undefined,
  itemCents: number,
  shippingChargedCents = 0,
): number {
  if (!platform || itemCents <= 0) return 0;
  const pct = Math.max(0, platform.fee_percent) / 100;
  return Math.round((itemCents + Math.max(0, shippingChargedCents)) * pct) + Math.max(0, platform.fee_fixed_cents);
}

export interface SaleMoney {
  sale_price_cents: number;
  shipping_charged_cents: number;
  shipping_cost_cents: number;
  fees_cents: number;
  other_costs_cents: number;
  cost_basis_cents: number;
}

/** What actually ends up in the pocket after fees, postage and what the card cost. */
export function saleNetCents(s: SaleMoney): number {
  return (
    s.sale_price_cents +
    s.shipping_charged_cents -
    s.shipping_cost_cents -
    s.fees_cents -
    s.other_costs_cents -
    s.cost_basis_cents
  );
}

/**
 * Split a total across weights so the parts add up to the total exactly
 * (largest-remainder rounding). Zero/negative weights get nothing unless all
 * weights are zero, in which case the split is even.
 */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  const effective = sum > 0 ? clean : clean.map(() => 1);
  const effSum = sum > 0 ? sum : effective.length;
  const raw = effective.map((w) => (totalCents * w) / effSum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}
