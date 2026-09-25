import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { formatCents } from '@shared/money';

interface FormatConfig {
  currency: string;
  locale: string;
}

const FormatContext = createContext<FormatConfig>({ currency: 'CAD', locale: 'en-CA' });

export function FormatProvider({ currency, locale, children }: FormatConfig & { children: ReactNode }) {
  const value = useMemo(() => ({ currency, locale }), [currency, locale]);
  return <FormatContext.Provider value={value}>{children}</FormatContext.Provider>;
}

function parseDate(value: string): Date {
  // Plain dates (YYYY-MM-DD) are calendar days, not UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

export function useFormat() {
  const { currency, locale } = useContext(FormatContext);
  return useMemo(() => {
    const dateFmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' });
    const shortDateFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    const dateTimeFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    const numberFmt = new Intl.NumberFormat(locale);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return {
      currency,
      locale,
      money: (cents: number | null | undefined, opts?: { compact?: boolean; noCents?: boolean }) =>
        formatCents(cents, currency, locale, opts),
      /** Signed money for profit/loss: "+$12.00" / "−$3.50". */
      signedMoney: (cents: number) => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${formatCents(Math.abs(cents), currency, locale)}`,
      number: (n: number | null | undefined) => (n === null || n === undefined ? '—' : numberFmt.format(n)),
      pct: (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${numberFmt.format(n)}%`),
      date: (value: string | null | undefined) => (value ? dateFmt.format(parseDate(value)) : '—'),
      shortDate: (value: string | null | undefined) => (value ? shortDateFmt.format(parseDate(value)) : '—'),
      dateTime: (value: string | null | undefined) => (value ? dateTimeFmt.format(parseDate(value)) : '—'),
      relative: (value: string | null | undefined) => {
        if (!value) return '—';
        const diffMs = parseDate(value).getTime() - Date.now();
        const abs = Math.abs(diffMs);
        const minute = 60_000;
        const hour = 60 * minute;
        const day = 24 * hour;
        if (abs < minute) return 'just now';
        if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
        if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
        if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), 'day');
        if (abs < 365 * day) return rtf.format(Math.round(diffMs / (30 * day)), 'month');
        return rtf.format(Math.round(diffMs / (365 * day)), 'year');
      },
    };
  }, [currency, locale]);
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
