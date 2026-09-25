import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronRight, Pencil, Plus, Scale, Search, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { cardLabel } from '@shared/cardText';
import type { AllocationPreview } from '@shared/types';
import { CardThumb, StatusBadge } from '../../components/cards';
import { Button, IconButton } from '../../components/ui/Button';
import { Dialog, useConfirm } from '../../components/ui/Dialog';
import { Alert, EmptyState, PageSpinner } from '../../components/ui/Feedback';
import { Input, SegmentedControl } from '../../components/ui/Form';
import { Panel } from '../../components/ui/Panel';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { invalidateCardLists, qk } from '../../lib/queries';
import { PurchaseDialog } from './PurchasesPage';

export default function PurchasePage() {
  const id = Number(useParams().id);
  const fmt = useFormat();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState<'even' | 'by_value'>('by_value');
  const [preview, setPreview] = useState<AllocationPreview | null>(null);

  const purchase = useQuery({ queryKey: ['purchase', id], queryFn: () => api.purchase(id) });
  const cards = useQuery({
    queryKey: ['cards', { purchase: id }],
    queryFn: () => api.cards({ purchase: id, status: 'all', sort: 'value', dir: 'desc', page_size: 500 }),
  });

  if (purchase.isLoading) return <PageSpinner />;
  if (purchase.error || !purchase.data) return <Alert tone="critical">{errorMessage(purchase.error)}</Alert>;
  const p = purchase.data;
  const list = cards.data?.cards ?? [];

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['purchase', id] });
    void qc.invalidateQueries({ queryKey: qk.purchases });
    invalidateCardLists(qc);
  };

  async function runAllocation(apply: boolean) {
    try {
      const result = await api.allocate(id, method, apply);
      if (apply) {
        setPreview(null);
        refresh();
        toast.success('Cost spread across the cards');
      } else {
        setPreview(result);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const stats = p.stats;
  const recovered = Math.min(100, Math.round((stats.revenue_cents / Math.max(1, p.total_cost_cents)) * 100));

  return (
    <div>
      <nav className="mb-3 flex items-center gap-1 text-sm text-muted" aria-label="Breadcrumb">
        <Link to="/admin/purchases" className="hover:text-ink">
          Purchases
        </Link>
        <ChevronRight className="size-4" />
        <span className="text-ink-2">{fmt.date(p.purchased_on)}</span>
      </nav>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{p.description || `Purchase #${p.id}`}</h1>
          <p className="mt-1 text-sm text-muted">
            {fmt.money(p.total_cost_cents)} · {fmt.date(p.purchased_on)}
            {p.source && ` · from ${p.source}`}
          </p>
          {p.notes && <p className="mt-2 max-w-2xl text-sm text-ink-2">{p.notes}</p>}
        </div>
        <div className="flex gap-2">
          <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <IconButton
            label="Delete purchase"
            className="border border-line-strong"
            onClick={async () => {
              const ok = await confirm({
                title: 'Delete this purchase?',
                message: 'The cards stay in your inventory with the costs they have now.',
                confirmLabel: 'Delete',
                danger: true,
              });
              if (!ok) return;
              try {
                await api.deletePurchase(id);
                refresh();
                navigate('/admin/purchases');
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Paid" value={fmt.money(p.total_cost_cents)} sub={`${stats.cards} cards linked (${stats.units} copies)`} />
        <Stat label="Sold so far" value={fmt.money(stats.revenue_cents)} sub={`${stats.sold_units} sold · ${recovered}% of cost back`} />
        <Stat
          label="Profit on this lot"
          value={<span className={stats.profit_cents >= 0 ? 'text-good-text' : 'text-critical-text'}>{fmt.signedMoney(stats.profit_cents)}</span>}
          sub="Sales after fees and postage, minus what you paid"
        />
        <Stat label="Still to sell" value={fmt.money(stats.remaining_value_cents)} sub="Estimated value of what’s left" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Cards from this purchase"
          actions={
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Add cards
            </Button>
          }
          bodyClassName="p-0 sm:p-0"
        >
          {list.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No cards linked yet">Add the cards that came in this lot to track how it pays off.</EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <CardThumb front={c.front_image} alt={cardLabel(c)} size="xs" />
                  <Link to={`/admin/cards/${c.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium hover:text-primary">{cardLabel(c)}</div>
                    <div className="text-xs text-muted">
                      <span className="font-mono">{c.sku}</span> · value {fmt.money(c.market_value_cents)}
                    </div>
                  </Link>
                  <StatusBadge status={c.status} className="hidden sm:inline-flex" />
                  <div className="w-24 text-right">
                    <div className="tabular text-sm font-medium">{fmt.money(c.cost_cents)}</div>
                    <div className="text-xs text-muted">cost each</div>
                  </div>
                  <IconButton
                    label="Remove from purchase"
                    size="sm"
                    onClick={async () => {
                      try {
                        await api.unassignCards(id, [c.id]);
                        refresh();
                      } catch (err) {
                        toast.error(errorMessage(err));
                      }
                    }}
                  >
                    <X className="size-4" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Spread the cost" icon={<Scale />} className="h-fit">
          <p className="mb-3 text-sm text-ink-2">
            Sets each card’s “what you paid” so profit is right when it sells. {fmt.money(p.allocated_cents)} of{' '}
            {fmt.money(p.total_cost_cents)} is spread now.
          </p>
          <SegmentedControl
            value={method}
            onChange={(m) => {
              setMethod(m);
              setPreview(null);
            }}
            options={[
              { value: 'by_value', label: 'By value' },
              { value: 'even', label: 'Evenly' },
            ]}
          />
          <p className="mt-2 text-xs text-muted">
            {method === 'by_value'
              ? 'Pricier cards carry more of the cost. Cards without a value count as average.'
              : 'Every copy gets the same share.'}
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => runAllocation(false)} disabled={list.length === 0}>
              Preview
            </Button>
            <Button size="sm" variant="primary" onClick={() => runAllocation(true)} disabled={list.length === 0}>
              Apply
            </Button>
          </div>
          {preview && (
            <ul className="mt-4 flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
              {preview.allocations.map((a) => {
                const card = list.find((c) => c.id === a.card_id);
                return (
                  <li key={a.card_id} className="flex justify-between gap-2">
                    <span className="truncate text-ink-2">{card ? cardLabel(card) : `Card ${a.card_id}`}</span>
                    <span className="tabular shrink-0">{fmt.money(a.cost_cents)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {editing && <PurchaseDialog open purchase={p} onClose={() => setEditing(false)} />}
      {adding && <AddCardsDialog purchaseId={id} linked={list.map((c) => c.id)} onClose={() => setAdding(false)} onDone={refresh} />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

function AddCardsDialog({ purchaseId, linked, onClose, onDone }: { purchaseId: number; linked: number[]; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const fmt = useFormat();
  const results = useQuery({
    queryKey: ['cards', { q, picker: true }],
    queryFn: () => api.cards({ q, status: 'all', sort: 'updated', dir: 'desc', page_size: 60 }),
    placeholderData: keepPreviousData,
  });
  const list = (results.data?.cards ?? []).filter((c) => !linked.includes(c.id));

  async function submit() {
    setBusy(true);
    try {
      await api.assignCards(purchaseId, [...picked]);
      toast.success(`Linked ${picked.size} cards`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add cards to this purchase"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={picked.size === 0}>
            Link {picked.size || ''} cards
          </Button>
        </>
      }
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your cards…" className="pl-9" autoFocus />
      </div>
      <p className="mb-2 text-xs text-muted">Tip: from Inventory you can also select many cards and use More → Add to a purchase.</p>
      <ul className={clsx('flex flex-col divide-y divide-line', results.isPlaceholderData && 'opacity-60')}>
        {list.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-3 py-2">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={picked.has(c.id)}
                onChange={() =>
                  setPicked((s) => {
                    const next = new Set(s);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  })
                }
              />
              <CardThumb front={c.front_image} alt={cardLabel(c)} size="xs" />
              <span className="min-w-0 flex-1 truncate text-sm">{cardLabel(c)}</span>
              <span className="text-xs text-muted">{c.purchase_id ? 'in another purchase' : fmt.money(c.market_value_cents)}</span>
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
