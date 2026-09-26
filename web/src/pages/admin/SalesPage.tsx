import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, Receipt, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FULFILLMENT_LABELS, FULFILLMENT_STATUSES } from '@shared/constants';
import type { Sale } from '@shared/types';
import { CardThumb, PlatformDot } from '../../components/cards';
import { Button, IconButton } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Dialog';
import { Alert, EmptyState, PageSpinner } from '../../components/ui/Feedback';
import { Input, Select } from '../../components/ui/Form';
import { PageHeader } from '../../components/ui/Panel';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage, qs } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { invalidateCardLists, usePlatforms } from '../../lib/queries';

export default function SalesPage() {
  const [params, setParams] = useSearchParams();
  const fmt = useFormat();
  const platforms = usePlatforms().data ?? [];
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');

  const filters = {
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    platform: params.get('platform') ?? '',
    fulfillment: params.get('fulfillment') ?? '',
  };
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const apiParams = { ...filters, q: q || undefined, page_size: 500 };
  const query = useQuery({ queryKey: ['sales', apiParams], queryFn: () => api.sales(apiParams), placeholderData: keepPreviousData });

  async function update(sale: Sale, patch: Record<string, unknown>) {
    try {
      await api.updateSale(sale.id, patch);
      invalidateCardLists(qc);
      void qc.invalidateQueries({ queryKey: ['card', sale.card_id] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const data = query.data;
  return (
    <div>
      <PageHeader
        title="Sales"
        description="Every sale with its fees, postage and profit."
        actions={
          <Button
            icon={<Download className="size-4" />}
            onClick={() => (window.location.href = `/api/export/sales.csv${qs({ from: filters.from, to: filters.to })}`)}
          >
            Export CSV
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select aria-label="Delivery" value={filters.fulfillment} onChange={(e) => set('fulfillment', e.target.value)} className="w-auto">
          <option value="">All sales</option>
          <option value="open">To ship / hand over</option>
          {FULFILLMENT_STATUSES.filter((f) => f !== 'pending').map((f) => (
            <option key={f} value={f}>
              {FULFILLMENT_LABELS[f]}
            </option>
          ))}
        </Select>
        <Select aria-label="Platform" value={filters.platform} onChange={(e) => set('platform', e.target.value)} className="w-auto">
          <option value="">All platforms</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Input type="date" aria-label="From" value={filters.from} onChange={(e) => set('from', e.target.value)} className="w-auto" />
        <span className="text-muted">to</span>
        <Input type="date" aria-label="To" value={filters.to} onChange={(e) => set('to', e.target.value)} className="w-auto" />
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buyer, tracking #, card…" className="pl-9" />
        </div>
      </div>

      {data && data.totals.count > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Sales', fmt.number(data.totals.count)],
            ['Sales total', fmt.money(data.totals.gross_cents)],
            ['Fees', fmt.money(data.totals.fees_cents)],
            ['Profit', fmt.signedMoney(data.totals.net_cents)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-surface p-3.5 shadow-card">
              <div className="text-xs text-muted">{label}</div>
              <div className="mt-0.5 text-xl font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}

      {query.isLoading ? (
        <PageSpinner />
      ) : query.error ? (
        <Alert tone="critical">{errorMessage(query.error)}</Alert>
      ) : !data || data.sales.length === 0 ? (
        <EmptyState icon={<Receipt />} title="No sales here">
          Record a sale with “Mark as sold” on a card’s page.
        </EmptyState>
      ) : (
        <div className={clsx('overflow-x-auto rounded-xl border border-line bg-surface shadow-card transition-opacity', query.isPlaceholderData && 'opacity-60')}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-2 py-2.5 font-medium">Card</th>
                <th className="px-2 py-2.5 font-medium">Where / buyer</th>
                <th className="px-2 py-2.5 text-right font-medium">Price</th>
                <th className="px-2 py-2.5 text-right font-medium">Fees + postage</th>
                <th className="px-2 py-2.5 text-right font-medium">Profit</th>
                <th className="px-2 py-2.5 font-medium">Delivery</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {data.sales.map((s) => {
                const platform = platforms.find((p) => p.id === s.platform_id);
                return (
                  <tr key={s.id} className="border-b border-line align-top last:border-0">
                    <td className="px-3 py-2.5 whitespace-nowrap">{fmt.date(s.sold_on)}</td>
                    <td className="px-2 py-2.5">
                      {s.card && (
                        <Link to={`/admin/cards/${s.card_id}`} className="flex items-center gap-2.5">
                          <CardThumb front={s.card.thumb_url ? { urls: { sm: s.card.thumb_url, md: s.card.thumb_url } } : null} alt={s.card.label} size="xs" />
                          <span className="min-w-0">
                            <span className="line-clamp-2 font-medium hover:text-primary">{s.card.label}</span>
                            {s.quantity > 1 && <span className="text-xs text-muted">× {s.quantity}</span>}
                          </span>
                        </Link>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        {platform && <PlatformDot platform={platform} size="sm" />}
                        {platform?.name ?? 'Other'}
                      </div>
                      <div className="text-xs text-muted">{s.buyer_name || '—'}</div>
                    </td>
                    <td className="tabular px-2 py-2.5 text-right whitespace-nowrap">
                      {fmt.money(s.sale_price_cents)}
                      {s.shipping_charged_cents > 0 && <div className="text-xs text-muted">+{fmt.money(s.shipping_charged_cents)} ship</div>}
                    </td>
                    <td className="tabular px-2 py-2.5 text-right whitespace-nowrap text-ink-2">
                      {fmt.money(s.fees_cents + s.shipping_cost_cents + s.other_costs_cents)}
                    </td>
                    <td className={clsx('tabular px-2 py-2.5 text-right font-semibold whitespace-nowrap', s.net_cents >= 0 ? 'text-good-text' : 'text-critical-text')}>
                      {fmt.signedMoney(s.net_cents)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-col gap-1.5">
                        <Select
                          aria-label="Delivery status"
                          value={s.fulfillment}
                          onChange={(e) => update(s, { fulfillment: e.target.value })}
                          className={clsx('min-h-8 w-44 py-1 text-xs', s.fulfillment === 'pending' && 'border-warning')}
                        >
                          {FULFILLMENT_STATUSES.map((f) => (
                            <option key={f} value={f}>
                              {FULFILLMENT_LABELS[f]}
                            </option>
                          ))}
                        </Select>
                        {s.fulfillment !== 'picked_up' && (
                          <Input
                            aria-label="Tracking number"
                            placeholder="Tracking #"
                            defaultValue={s.tracking_number}
                            onBlur={(e) => e.target.value !== s.tracking_number && update(s, { tracking_number: e.target.value })}
                            className="min-h-8 w-44 py-1 text-xs"
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <IconButton
                        label="Delete sale"
                        size="sm"
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Delete this sale?',
                            message: 'The card goes back into inventory.',
                            confirmLabel: 'Delete sale',
                            danger: true,
                          });
                          if (!ok) return;
                          try {
                            await api.deleteSale(s.id);
                            invalidateCardLists(qc);
                            toast.success('Sale deleted');
                          } catch (err) {
                            toast.error(errorMessage(err));
                          }
                        }}
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
