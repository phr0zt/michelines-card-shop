import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Database, Download, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import type { PnlRow } from '@shared/types';
import { ChartCard, ColumnChart, DataTable, Legend } from '../../components/charts';
import { PlatformDot } from '../../components/cards';
import { Button } from '../../components/ui/Button';
import { Alert, PageSpinner } from '../../components/ui/Feedback';
import { Input, Select } from '../../components/ui/Form';
import { PageHeader, Panel } from '../../components/ui/Panel';
import { api, errorMessage, qs } from '../../lib/api';
import { todayIso, useFormat } from '../../lib/format';

type Group = 'month' | 'week' | 'day';

function yearRange(offset: number) {
  const y = new Date().getFullYear() + offset;
  return { from: `${y}-01-01`, to: offset === 0 ? todayIso() : `${y}-12-31` };
}

const COLUMNS: { key: keyof PnlRow; label: string; hint?: string; negative?: boolean }[] = [
  { key: 'sales', label: 'Sales' },
  { key: 'item_cents', label: 'Card sales' },
  { key: 'shipping_income_cents', label: 'Shipping charged' },
  { key: 'gross_cents', label: 'Total in' },
  { key: 'fees_cents', label: 'Fees', negative: true },
  { key: 'shipping_cost_cents', label: 'Postage', negative: true },
  { key: 'other_costs_cents', label: 'Supplies & other', negative: true },
  { key: 'cogs_cents', label: 'Cost of cards sold', negative: true },
  { key: 'net_cents', label: 'Profit' },
  { key: 'purchases_cents', label: 'Spent on inventory', hint: 'Money spent buying lots/binders (not counted in profit until those cards sell)' },
];

export default function ReportsPage() {
  const fmt = useFormat();
  const [range, setRange] = useState(yearRange(0));
  const [group, setGroup] = useState<Group>('month');
  const params = { ...range, group };
  const query = useQuery({ queryKey: ['reports', params], queryFn: () => api.pnl(params), placeholderData: keepPreviousData });

  const presets = [
    { label: 'This year', value: yearRange(0) },
    { label: 'Last year', value: yearRange(-1) },
    { label: 'All time', value: { from: '2000-01-01', to: todayIso() } },
  ];

  const cell = (row: PnlRow, key: keyof PnlRow, negative?: boolean) => {
    const v = row[key] as number;
    if (key === 'sales') return fmt.number(v);
    if (v === 0) return <span className="text-muted">—</span>;
    return negative ? `−${fmt.money(v)}` : fmt.money(v);
  };

  const data = query.data;
  const rows = data ? data.rows.filter((r) => r.sales > 0 || r.purchases_cents > 0 || group === 'month') : [];
  const periodLabel = (p: string) => {
    if (/^\d{4}-\d{2}$/.test(p)) {
      const [y, m] = p.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString(fmt.locale, { month: 'long', year: 'numeric' });
    }
    return group === 'week' ? `Week of ${fmt.date(p)}` : fmt.date(p);
  };

  const series = [
    { key: 'gross_cents', label: 'Total in' },
    { key: 'net_cents', label: 'Profit' },
  ];

  return (
    <div>
      <PageHeader title="Reports" description="Profit and loss, and where the money comes from — ready for your books or taxes." />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <Button
            key={p.label}
            size="sm"
            variant={range.from === p.value.from && range.to === p.value.to ? 'soft' : 'secondary'}
            onClick={() => setRange(p.value)}
          >
            {p.label}
          </Button>
        ))}
        <Input type="date" aria-label="From" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value || r.from }))} className="w-auto" />
        <span className="text-muted">to</span>
        <Input type="date" aria-label="To" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value || r.to }))} className="w-auto" />
        <Select aria-label="Group by" value={group} onChange={(e) => setGroup(e.target.value as Group)} className="w-auto">
          <option value="month">By month</option>
          <option value="week">By week</option>
          <option value="day">By day</option>
        </Select>
      </div>

      {query.isLoading ? (
        <PageSpinner />
      ) : query.error || !data ? (
        <Alert tone="critical">{errorMessage(query.error)}</Alert>
      ) : (
        <div className={clsx('flex flex-col gap-5 transition-opacity', query.isPlaceholderData && 'opacity-60')}>
          <Panel title="Profit & loss" description={`${fmt.date(data.from)} – ${fmt.date(data.to)}`} bodyClassName="p-0 sm:p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-4 py-2.5 font-medium">Period</th>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className="px-3 py-2.5 text-right font-medium whitespace-nowrap" title={c.hint}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.period} className="border-b border-line">
                      <td className="px-4 py-2 whitespace-nowrap">{periodLabel(r.period)}</td>
                      {COLUMNS.map((c) => (
                        <td
                          key={c.key}
                          className={clsx(
                            'tabular px-3 py-2 text-right whitespace-nowrap',
                            c.key === 'net_cents' && r.net_cents !== 0 && (r.net_cents > 0 ? 'font-medium text-good-text' : 'font-medium text-critical-text'),
                          )}
                        >
                          {cell(r, c.key, c.negative)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line-strong bg-surface-2 font-semibold">
                    <td className="px-4 py-2.5">Total</td>
                    {COLUMNS.map((c) => (
                      <td
                        key={c.key}
                        className={clsx(
                          'tabular px-3 py-2.5 text-right whitespace-nowrap',
                          c.key === 'net_cents' && (data.totals.net_cents >= 0 ? 'text-good-text' : 'text-critical-text'),
                        )}
                      >
                        {cell(data.totals, c.key, c.negative)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          <ChartCard
            title="Money in and profit"
            legend={<Legend series={series} />}
            chart={
              <ColumnChart
                data={data.rows as unknown as Record<string, unknown>[]}
                xKey="period"
                series={series}
                format={(v) => fmt.money(v)}
                compactFormat={(v) => fmt.money(v, { compact: true })}
                labelFormat={(p) => (/^\d{4}-\d{2}$/.test(p) ? new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1).toLocaleDateString(fmt.locale, { month: 'short' }) : fmt.shortDate(p))}
              />
            }
            table={
              <DataTable
                columns={[
                  { key: 'period', label: 'Period', render: (r) => periodLabel(String(r.period)) },
                  { key: 'gross_cents', label: 'Total in', align: 'right', render: (r) => fmt.money(Number(r.gross_cents)) },
                  { key: 'net_cents', label: 'Profit', align: 'right', render: (r) => fmt.money(Number(r.net_cents)) },
                ]}
                rows={data.rows as unknown as Record<string, unknown>[]}
              />
            }
          />

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="By platform" bodyClassName="p-0 sm:p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="px-4 py-2.5 font-medium">Platform</th>
                      <th className="px-3 py-2.5 text-right font-medium">Sales</th>
                      <th className="px-3 py-2.5 text-right font-medium">Total in</th>
                      <th className="px-3 py-2.5 text-right font-medium">Fees</th>
                      <th className="px-3 py-2.5 text-right font-medium">Profit</th>
                      <th className="px-4 py-2.5 text-right font-medium">Inquiries</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_platform
                      .filter((p) => p.sales > 0 || p.inquiries > 0)
                      .map((p) => (
                        <tr key={p.platform_id ?? 'other'} className="border-b border-line last:border-0">
                          <td className="px-4 py-2">
                            <span className="inline-flex items-center gap-2">
                              <PlatformDot platform={p} size="sm" /> {p.name}
                            </span>
                          </td>
                          <td className="tabular px-3 py-2 text-right">{p.sales}</td>
                          <td className="tabular px-3 py-2 text-right">{fmt.money(p.gross_cents)}</td>
                          <td className="tabular px-3 py-2 text-right">{fmt.money(p.fees_cents)}</td>
                          <td className="tabular px-3 py-2 text-right font-medium">{fmt.money(p.net_cents)}</td>
                          <td className="tabular px-4 py-2 text-right">{p.inquiries}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="By category" bodyClassName="p-0 sm:p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="px-4 py-2.5 font-medium">Category</th>
                      <th className="px-3 py-2.5 text-right font-medium">Sold</th>
                      <th className="px-3 py-2.5 text-right font-medium">Sales</th>
                      <th className="px-3 py-2.5 text-right font-medium">On hand</th>
                      <th className="px-4 py-2.5 text-right font-medium">Est. value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_category.map((c) => (
                      <tr key={c.category} className="border-b border-line last:border-0">
                        <td className="px-4 py-2">{c.category}</td>
                        <td className="tabular px-3 py-2 text-right">{c.sold_units}</td>
                        <td className="tabular px-3 py-2 text-right">{fmt.money(c.sold_gross_cents)}</td>
                        <td className="tabular px-3 py-2 text-right">{c.units}</td>
                        <td className="tabular px-4 py-2 text-right">{fmt.money(c.value_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Panel title="Download your data" icon={<FileSpreadsheet />}>
              <p className="mb-3 text-sm text-ink-2">Spreadsheet files (CSV) open in Excel, Numbers or Google Sheets.</p>
              <div className="flex flex-wrap gap-2">
                <Button icon={<Download className="size-4" />} onClick={() => (window.location.href = `/api/export/sales.csv${qs(range)}`)}>
                  Sales in this period
                </Button>
                <Button icon={<Download className="size-4" />} onClick={() => (window.location.href = '/api/export/cards.csv')}>
                  All cards
                </Button>
                <Button icon={<Download className="size-4" />} onClick={() => (window.location.href = '/api/export/inquiries.csv')}>
                  Inquiries
                </Button>
                <Button icon={<Download className="size-4" />} onClick={() => (window.location.href = '/api/export/purchases.csv')}>
                  Purchases
                </Button>
                <Button icon={<Database className="size-4" />} onClick={() => (window.location.href = '/api/export/backup.sqlite')}>
                  Full database backup
                </Button>
              </div>
            </Panel>
            <Panel title="How profit is worked out">
              <p className="text-sm text-ink-2">
                <strong className="text-ink">Profit</strong> = card sale price + shipping the buyer paid − platform fees − postage − supplies & other
                costs − what you paid for the card.
              </p>
              <p className="mt-2 text-sm text-ink-2">
                “What you paid” comes from each card’s cost (or its share of a purchase). Cards with no cost count as $0, so profit looks higher
                than it really is until costs are filled in. Money spent buying lots is shown separately in “Spent on inventory”.
              </p>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
