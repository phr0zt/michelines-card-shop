import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertOctagon,
  ArrowDownRight,
  ArrowUpRight,
  ClipboardCheck,
  Clock,
  Gem,
  MessageSquare,
  Sparkles,
  Tag,
  Truck,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Dashboard } from '@shared/types';
import { BarList, ChartCard, ColumnChart, DataTable, Legend, TrendChart } from '../../components/charts';
import { CardThumb, PlatformDot } from '../../components/cards';
import { Button } from '../../components/ui/Button';
import { Alert, PageSpinner } from '../../components/ui/Feedback';
import { Input } from '../../components/ui/Form';
import { PageHeader } from '../../components/ui/Panel';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { isoDaysAgo, todayIso, useFormat } from '../../lib/format';
import { invalidateCardLists } from '../../lib/queries';

type Preset = 'month' | '30' | '90' | 'year' | '12m' | 'all' | 'custom';

function presetRange(p: Preset): { from: string; to: string } {
  const to = todayIso();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (p) {
    case 'month':
      return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to };
    case '30':
      return { from: isoDaysAgo(29), to };
    case '90':
      return { from: isoDaysAgo(89), to };
    case 'year':
      return { from: `${now.getFullYear()}-01-01`, to };
    case 'all':
      return { from: '2000-01-01', to };
    case '12m':
    default: {
      const d = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      return { from: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, to };
    }
  }
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'year', label: 'This year' },
  { value: '12m', label: '12 months' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

export default function DashboardPage() {
  const [preset, setPreset] = useState<Preset>('12m');
  const [custom, setCustom] = useState(presetRange('12m'));
  const range = preset === 'custom' ? custom : presetRange(preset);
  const query = useQuery({
    queryKey: ['dashboard', range],
    queryFn: () => api.dashboard(range),
    placeholderData: keepPreviousData,
  });

  if (query.isLoading) return <PageSpinner />;
  if (query.error || !query.data) return <Alert tone="critical" title="Couldn’t load the dashboard">{errorMessage(query.error)}</Alert>;
  const d = query.data;
  const dim = query.isFetching && query.isPlaceholderData;

  return (
    <div>
      <PageHeader title="Dashboard" description="How the shop is doing, and what needs your attention." />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg bg-surface-3 p-1" role="tablist" aria-label="Date range">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="tab"
              aria-selected={preset === p.value}
              onClick={() => setPreset(p.value)}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                preset === p.value ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || c.from }))} className="w-auto" />
            <span className="text-muted">to</span>
            <Input type="date" aria-label="To" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || c.to }))} className="w-auto" />
          </div>
        )}
      </div>

      <div className={clsx('flex flex-col gap-5 transition-opacity', dim && 'opacity-60')}>
        <AttentionPanel data={d} />
        <Kpis data={d} />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <SalesChart data={d} className="xl:col-span-2" />
          <ValueChart data={d} />
        </div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <PlatformTable data={d} className="xl:col-span-2" />
          <CategoryChart data={d} />
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <TopCards data={d} />
          <Movers data={d} />
          <RecentActivity data={d} />
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub, hero }: { label: string; value: ReactNode; sub?: ReactNode; hero?: boolean }) {
  return (
    <div className={clsx('rounded-xl border border-line bg-surface p-4 shadow-card', hero && 'col-span-2 sm:row-span-2 sm:p-6')}>
      <div className="text-sm text-muted">{label}</div>
      <div className={clsx('mt-1 font-semibold tracking-tight text-ink', hero ? 'text-4xl sm:text-5xl' : 'text-2xl')}>{value}</div>
      {sub && <div className={clsx('mt-1 text-ink-2', hero ? 'text-sm' : 'text-xs')}>{sub}</div>}
    </div>
  );
}

function Kpis({ data }: { data: Dashboard }) {
  const fmt = useFormat();
  const { sales, inventory, inquiries } = data.overview;
  const netTone = sales.net_cents >= 0 ? 'text-good-text' : 'text-critical-text';
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
      <StatTile
        hero
        label="Profit in this period"
        value={
          <span className={clsx('inline-flex items-center gap-2', netTone)}>
            {sales.net_cents >= 0 ? <ArrowUpRight className="size-9" /> : <ArrowDownRight className="size-9" />}
            {fmt.money(sales.net_cents, { noCents: Math.abs(sales.net_cents) >= 100000 })}
          </span>
        }
        sub={
          sales.count > 0 ? (
            <>
              From {fmt.money(sales.gross_cents)} in sales after {fmt.money(sales.fees_cents)} fees, {fmt.money(sales.shipping_cost_cents)} postage and{' '}
              {fmt.money(sales.cogs_cents)} card costs
              {sales.margin_pct !== null && ` — a ${fmt.pct(sales.margin_pct)} margin`}.
            </>
          ) : (
            'No sales in this period yet.'
          )
        }
      />
      <StatTile label="Sales" value={fmt.money(sales.gross_cents, { noCents: sales.gross_cents >= 100000 })} sub={`${fmt.number(sales.units)} cards sold`} />
      <StatTile label="Average sale" value={fmt.money(sales.avg_sale_cents)} sub={sales.avg_days_to_sell !== null ? `${sales.avg_days_to_sell} days from posting to sold` : undefined} />
      <StatTile label="Fees paid" value={fmt.money(sales.fees_cents)} sub={sales.gross_cents ? `${fmt.pct(Math.round((sales.fees_cents / sales.gross_cents) * 1000) / 10)} of sales` : undefined} />
      <StatTile label="Sell-through" value={fmt.pct(data.overview.sell_through_pct)} sub="of cards for sale that sold" />
      <StatTile
        label="Inventory value"
        value={fmt.money(inventory.value_cents, { noCents: true })}
        sub={inventory.cost_cents ? `Cost ${fmt.money(inventory.cost_cents, { noCents: true })}` : `${fmt.number(inventory.missing_value)} cards without a value`}
      />
      <StatTile label="Cards on hand" value={fmt.number(inventory.units)} sub={`${fmt.number(inventory.cards)} different · ${fmt.number(inventory.keepers)} keepers`} />
      <StatTile label="Posted listings" value={fmt.number(inventory.active_listings)} sub={`${fmt.number(inventory.listed_cards)} cards · ${fmt.number(inventory.public_cards)} on website`} />
      <StatTile label="Open inquiries" value={fmt.number(inquiries.open)} sub={inquiries.follow_ups_due ? `${inquiries.follow_ups_due} follow-ups due` : `${inquiries.new_in_period} in this period`} />
    </div>
  );
}

function periodLabel(fmt: ReturnType<typeof useFormat>, period: string) {
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(fmt.locale, { month: 'short', year: '2-digit' });
  }
  return fmt.shortDate(period);
}

function SalesChart({ data, className }: { data: Dashboard; className?: string }) {
  const fmt = useFormat();
  const series = [
    { key: 'gross_cents', label: 'Sales' },
    { key: 'net_cents', label: 'Profit' },
  ];
  const rows = data.timeseries as unknown as Record<string, unknown>[];
  return (
    <ChartCard
      className={className}
      title="Sales & profit"
      subtitle="Profit is after fees, postage and what the cards cost you"
      legend={<Legend series={series} />}
      chart={
        <ColumnChart
          data={rows}
          xKey="period"
          series={series}
          format={(v) => fmt.money(v)}
          compactFormat={(v) => fmt.money(v, { compact: true })}
          labelFormat={(l) => periodLabel(fmt, l)}
        />
      }
      table={
        <DataTable
          columns={[
            { key: 'period', label: 'Period', render: (r) => periodLabel(fmt, String(r.period)) },
            { key: 'sales', label: 'Sales', align: 'right' },
            { key: 'gross_cents', label: 'Sales $', align: 'right', render: (r) => fmt.money(Number(r.gross_cents)) },
            { key: 'fees_cents', label: 'Fees', align: 'right', render: (r) => fmt.money(Number(r.fees_cents)) },
            { key: 'net_cents', label: 'Profit', align: 'right', render: (r) => fmt.money(Number(r.net_cents)) },
            { key: 'cards_added', label: 'Cards added', align: 'right' },
          ]}
          rows={rows}
        />
      }
    />
  );
}

function ValueChart({ data }: { data: Dashboard }) {
  const fmt = useFormat();
  const rows = data.value_history as unknown as Record<string, unknown>[];
  return (
    <ChartCard
      title="Inventory value"
      subtitle="Estimated market value of unsold cards"
      chart={
        rows.length >= 2 ? (
          <TrendChart
            area
            data={rows}
            xKey="date"
            series={[{ key: 'value_cents', label: 'Inventory value' }]}
            format={(v) => fmt.money(v)}
            compactFormat={(v) => fmt.money(v, { compact: true })}
            labelFormat={(l) => fmt.shortDate(l)}
            height={260}
          />
        ) : (
          <p className="py-16 text-center text-sm text-muted">The chart fills in as the days go by.</p>
        )
      }
      table={
        <DataTable
          columns={[
            { key: 'date', label: 'Date', render: (r) => fmt.date(String(r.date)) },
            { key: 'cards', label: 'Cards', align: 'right' },
            { key: 'value_cents', label: 'Value', align: 'right', render: (r) => fmt.money(Number(r.value_cents)) },
            { key: 'cost_cents', label: 'Cost', align: 'right', render: (r) => fmt.money(Number(r.cost_cents)) },
          ]}
          rows={[...rows].reverse().slice(0, 60)}
        />
      }
    />
  );
}

function PlatformTable({ data, className }: { data: Dashboard; className?: string }) {
  const fmt = useFormat();
  const max = Math.max(1, ...data.platforms.map((p) => p.gross_cents));
  return (
    <section className={clsx('rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5', className)}>
      <h2 className="text-base font-semibold">Where you sell best</h2>
      <p className="mb-3 text-sm text-muted">Sales, profit and interest by platform for this period</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2 pr-3 font-medium">Platform</th>
              <th className="w-1/4 py-2 pr-3 font-medium">Sales</th>
              <th className="py-2 pr-3 text-right font-medium">Sold</th>
              <th className="py-2 pr-3 text-right font-medium">Profit</th>
              <th className="py-2 pr-3 text-right font-medium">Fees</th>
              <th className="py-2 pr-3 text-right font-medium">Days to sell</th>
              <th className="py-2 pr-3 text-right font-medium">Posted now</th>
              <th className="py-2 text-right font-medium">Inquiries</th>
            </tr>
          </thead>
          <tbody>
            {data.platforms.map((p) => (
              <tr key={p.platform_id ?? 'other'} className="border-b border-line last:border-0">
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <PlatformDot platform={p} size="sm" />
                    {p.name}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 flex-1">
                      {p.gross_cents > 0 && <div className="h-full rounded-r-[4px] bg-series-1" style={{ width: `${Math.max(2, (p.gross_cents / max) * 100)}%` }} />}
                    </div>
                    <span className="tabular w-20 shrink-0 text-right">{fmt.money(p.gross_cents, { noCents: true })}</span>
                  </div>
                </td>
                <td className="tabular py-2 pr-3 text-right">{p.sales}</td>
                <td className="tabular py-2 pr-3 text-right">{fmt.money(p.net_cents, { noCents: true })}</td>
                <td className="tabular py-2 pr-3 text-right">{fmt.money(p.fees_cents, { noCents: true })}</td>
                <td className="tabular py-2 pr-3 text-right">{p.avg_days_to_sell ?? '—'}</td>
                <td className="tabular py-2 pr-3 text-right">{p.active_listings}</td>
                <td className="tabular py-2 text-right">{p.inquiries}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CategoryChart({ data }: { data: Dashboard }) {
  const fmt = useFormat();
  const rows = data.categories.filter((c) => c.value_cents > 0 || c.cards > 0);
  return (
    <ChartCard
      title="Inventory by category"
      subtitle="Estimated value of unsold cards"
      chart={
        <BarList
          rows={rows.map((c) => ({
            key: c.category,
            label: c.category,
            value: c.value_cents,
            detail: `${fmt.number(c.units)} cards${c.sold_units ? ` · ${c.sold_units} sold this period` : ''}`,
          }))}
          format={(v) => fmt.money(v, { noCents: true })}
        />
      }
      table={
        <DataTable
          columns={[
            { key: 'category', label: 'Category' },
            { key: 'units', label: 'Cards', align: 'right' },
            { key: 'value_cents', label: 'Value', align: 'right', render: (r) => fmt.money(Number(r.value_cents)) },
            { key: 'sold_units', label: 'Sold', align: 'right' },
            { key: 'sold_gross_cents', label: 'Sales', align: 'right', render: (r) => fmt.money(Number(r.sold_gross_cents)) },
          ]}
          rows={rows as unknown as Record<string, unknown>[]}
        />
      }
    />
  );
}

function ListPanel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function TopCards({ data }: { data: Dashboard }) {
  const fmt = useFormat();
  return (
    <ListPanel
      title="Most valuable cards"
      action={
        <Link to="/admin/cards?sort=value:desc" className="text-sm text-primary hover:underline">
          See all
        </Link>
      }
    >
      {data.top_cards.length === 0 ? (
        <p className="text-sm text-muted">Values appear once cards are researched.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.top_cards.map((c) => (
            <li key={c.id}>
              <Link to={`/admin/cards/${c.id}`} className="flex items-center gap-3 rounded-lg p-1 hover:bg-surface-2">
                <CardThumb front={c.thumb_url ? { urls: { sm: c.thumb_url, md: c.thumb_url } } : null} alt={c.label} size="xs" />
                <span className="min-w-0 flex-1 truncate text-sm">{c.label}</span>
                <span className="tabular text-sm font-medium">{fmt.money(c.market_value_cents, { noCents: true })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ListPanel>
  );
}

function Movers({ data }: { data: Dashboard }) {
  const fmt = useFormat();
  return (
    <ListPanel title="Price movers">
      {data.movers.length === 0 ? (
        <p className="text-sm text-muted">After a card’s value is researched twice, changes show up here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.movers.map((m) => (
            <li key={m.card.id}>
              <Link to={`/admin/cards/${m.card.id}`} className="flex items-center gap-3 rounded-lg p-1 hover:bg-surface-2">
                <CardThumb front={m.card.thumb_url ? { urls: { sm: m.card.thumb_url, md: m.card.thumb_url } } : null} alt={m.card.label} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{m.card.label}</span>
                  <span className="text-xs text-muted">
                    {fmt.money(m.previous_cents)} → {fmt.money(m.current_cents)}
                  </span>
                </span>
                <span
                  className={clsx(
                    'inline-flex items-center gap-0.5 text-sm font-medium',
                    m.change_pct >= 0 ? 'text-good-text' : 'text-critical-text',
                  )}
                >
                  {m.change_pct >= 0 ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                  {Math.abs(m.change_pct)}%
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ListPanel>
  );
}

function RecentActivity({ data }: { data: Dashboard }) {
  const fmt = useFormat();
  return (
    <ListPanel title="Recent activity">
      <ul className="flex flex-col gap-2.5">
        {data.recent_activity.slice(0, 10).map((a) => (
          <li key={a.id} className="text-sm">
            <div className="text-ink">
              {a.card ? (
                <Link to={`/admin/cards/${a.card.id}`} className="font-medium hover:text-primary">
                  {a.card.label}
                </Link>
              ) : null}
              {a.card ? ': ' : ''}
              <span className="text-ink-2">{a.message}</span>
            </div>
            <div className="text-xs text-muted">{fmt.relative(a.created_at)}</div>
          </li>
        ))}
      </ul>
    </ListPanel>
  );
}

function groupByCard(alerts: Dashboard['attention']['stale_listings']) {
  const groups = new Map<number, { card: (typeof alerts)[number]['card']; listings: typeof alerts }>();
  for (const l of alerts) {
    const g = groups.get(l.card.id) ?? { card: l.card, listings: [] };
    g.listings.push(l);
    groups.set(l.card.id, g);
  }
  return [...groups.values()];
}

function AttentionRow({
  icon,
  tone,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  tone: 'critical' | 'serious' | 'warning' | 'info';
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const color = {
    critical: 'bg-critical-soft text-critical-text',
    serious: 'bg-serious-soft text-serious-text',
    warning: 'bg-warning-soft text-warning-text',
    info: 'bg-primary-soft text-primary',
  }[tone];
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className={clsx('flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4.5', color)}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium">{title}</div>
          {action}
        </div>
        {children && <div className="mt-1.5">{children}</div>}
      </div>
    </li>
  );
}

function AttentionPanel({ data }: { data: Dashboard }) {
  const fmt = useFormat();
  const qc = useQueryClient();
  const toast = useToast();
  const a = data.attention;
  const inquiriesDue = a.follow_ups.length;
  const empty =
    a.sold_still_listed.length === 0 &&
    a.unfulfilled.length === 0 &&
    inquiriesDue === 0 &&
    a.drafts.length === 0 &&
    a.stale_listings.length === 0 &&
    a.high_value_unlisted.length === 0 &&
    a.no_asking_price === 0 &&
    a.failed_jobs === 0;

  const takeDown = async (ids: number[]) => {
    try {
      await api.endListings(ids);
      invalidateCardLists(qc);
      toast.success('Marked as taken down');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const cardLinks = (items: { id: number; label: string; extra?: ReactNode }[]) => (
    <ul className="flex flex-col gap-1">
      {items.map((c, i) => (
        <li key={i} className="flex items-center justify-between gap-2 text-sm">
          <Link to={`/admin/cards/${c.id}`} className="min-w-0 truncate text-ink-2 hover:text-primary">
            {c.label}
          </Link>
          {c.extra}
        </li>
      ))}
    </ul>
  );

  if (empty) {
    return (
      <Alert tone="good" title="All caught up">
        Nothing needs your attention right now.
      </Alert>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <h2 className="mb-3 text-base font-semibold">Needs your attention</h2>
      <ul className="flex flex-col divide-y divide-line">
        {a.sold_still_listed.length > 0 && (
          <AttentionRow
            tone="critical"
            icon={<AlertOctagon />}
            title={`Sold, but still posted — ${a.sold_still_listed.length} ${a.sold_still_listed.length === 1 ? 'listing' : 'listings'} to take down`}
            action={
              <Button size="sm" onClick={() => takeDown(a.sold_still_listed.map((l) => l.listing_id))}>
                I took them all down
              </Button>
            }
          >
            {cardLinks(
              a.sold_still_listed.map((l) => ({
                id: l.card.id,
                label: l.card.label,
                extra: (
                  <span className="inline-flex shrink-0 items-center gap-2 text-xs text-muted">
                    {l.platform_name}
                    <button type="button" className="font-medium text-primary hover:underline" onClick={() => takeDown([l.listing_id])}>
                      Done
                    </button>
                  </span>
                ),
              })),
            )}
          </AttentionRow>
        )}
        {a.unfulfilled.length > 0 && (
          <AttentionRow
            tone="warning"
            icon={<Truck />}
            title={`${a.unfulfilled.length} ${a.unfulfilled.length === 1 ? 'sale' : 'sales'} to ship or hand over`}
            action={
              <Link to="/admin/sales?fulfillment=open" className="text-sm text-primary hover:underline">
                Open sales
              </Link>
            }
          >
            {cardLinks(
              a.unfulfilled.map((s) => ({
                id: s.card_id,
                label: s.card?.label ?? `Sale #${s.id}`,
                extra: <span className="shrink-0 text-xs text-muted">{s.buyer_name || 'buyer'} · sold {fmt.relative(s.sold_on)}</span>,
              })),
            )}
          </AttentionRow>
        )}
        {inquiriesDue > 0 && (
          <AttentionRow
            tone="warning"
            icon={<MessageSquare />}
            title={`${inquiriesDue} ${inquiriesDue === 1 ? 'inquiry needs' : 'inquiries need'} a reply or follow-up`}
            action={
              <Link to="/admin/inquiries" className="text-sm text-primary hover:underline">
                All inquiries
              </Link>
            }
          >
            {cardLinks(
              a.follow_ups.map((i) => ({
                id: i.card_id,
                label: `${i.name || i.contact || 'Buyer'} about ${i.card?.label ?? 'a card'}`,
                extra: (
                  <span className="shrink-0 text-xs text-muted">
                    {i.status === 'new' ? 'new' : `follow up ${fmt.shortDate(i.follow_up_on)}`}
                    {i.offer_cents !== null && ` · offer ${fmt.money(i.offer_cents)}`}
                  </span>
                ),
              })),
            )}
          </AttentionRow>
        )}
        {a.drafts.length > 0 && (
          <AttentionRow
            tone="info"
            icon={<ClipboardCheck />}
            title={`${data.overview.inventory.drafts} new ${data.overview.inventory.drafts === 1 ? 'card' : 'cards'} to review`}
            action={
              <Link to="/admin/review" className="text-sm text-primary hover:underline">
                Review
              </Link>
            }
          />
        )}
        {a.stale_listings.length > 0 && (
          <AttentionRow tone="serious" icon={<Clock />} title="Posted a while without selling — consider a price drop or a repost">
            {cardLinks(
              groupByCard(a.stale_listings).map(({ card, listings }) => ({
                id: card.id,
                label: card.label,
                extra: (
                  <span className="shrink-0 text-right text-xs text-muted">
                    {listings.map((l) => `${l.platform_name} ${l.days_listed}d`).join(' · ')}
                  </span>
                ),
              })),
            )}
          </AttentionRow>
        )}
        {a.high_value_unlisted.length > 0 && (
          <AttentionRow tone="info" icon={<Gem />} title="Valuable cards not posted anywhere yet">
            {cardLinks(
              a.high_value_unlisted.map((c) => ({
                id: c.id,
                label: c.label,
                extra: <span className="tabular shrink-0 text-xs text-muted">{fmt.money(c.market_value_cents)}</span>,
              })),
            )}
          </AttentionRow>
        )}
        {a.no_asking_price > 0 && (
          <AttentionRow
            tone="info"
            icon={<Tag />}
            title={`${a.no_asking_price} ${a.no_asking_price === 1 ? 'card has' : 'cards have'} no asking price`}
            action={
              <Link to="/admin/cards?status=available&has_price=0" className="text-sm text-primary hover:underline">
                Show them
              </Link>
            }
          />
        )}
        {a.failed_jobs > 0 && (
          <AttentionRow
            tone="critical"
            icon={<Sparkles />}
            title={`${a.failed_jobs} AI ${a.failed_jobs === 1 ? 'task' : 'tasks'} failed`}
            action={
              <Link to="/admin/review" className="text-sm text-primary hover:underline">
                See why
              </Link>
            }
          />
        )}
      </ul>
    </section>
  );
}
