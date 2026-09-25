import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Camera,
  CheckSquare,
  Download,
  Globe,
  LayoutGrid,
  Library,
  List,
  MessageSquare,
  MoreHorizontal,
  Printer,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { cardLabel } from '@shared/cardText';
import { CATEGORIES } from '@shared/constants';
import type { Card, Platform } from '@shared/types';
import { CardFlags, CardThumb, locationText, PlatformChips, PlatformDot, StatusBadge } from '../../components/cards';
import { Button, ButtonLink, IconButton } from '../../components/ui/Button';
import { Dialog, useConfirm } from '../../components/ui/Dialog';
import { Alert, EmptyState, Spinner } from '../../components/ui/Feedback';
import { Checkbox, Field, Input, Select, TextField } from '../../components/ui/Form';
import { Menu } from '../../components/ui/Menu';
import { PageHeader } from '../../components/ui/Panel';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { invalidateCardLists, useAiStatus, useFacets, usePlatforms, usePurchases } from '../../lib/queries';
import { loadPref, savePref } from '../../lib/storage';

const STATUS_TABS = [
  { value: 'unsold', label: 'All unsold' },
  { value: 'available', label: 'For sale' },
  { value: 'in_stock', label: 'Not posted' },
  { value: 'listed', label: 'Posted' },
  { value: 'draft', label: 'Needs review' },
  { value: 'pending', label: 'Pending' },
  { value: 'keeper', label: 'Keepers' },
  { value: 'sold', label: 'Sold' },
  { value: 'all', label: 'Everything' },
];

const SORTS = [
  { value: 'updated:desc', label: 'Recently updated' },
  { value: 'created:desc', label: 'Newest added' },
  { value: 'value:desc', label: 'Value: high to low' },
  { value: 'value:asc', label: 'Value: low to high' },
  { value: 'asking:desc', label: 'Asking price: high to low' },
  { value: 'player:asc', label: 'Player A–Z' },
  { value: 'set:desc', label: 'Year & set' },
  { value: 'location:asc', label: 'Binder, page, slot' },
  { value: 'sku:asc', label: 'Inventory code' },
];

const FILTER_KEYS = ['platform', 'not_platform', 'binder', 'graded', 'rookie', 'autograph', 'public', 'has_value', 'has_price', 'has_inquiries', 'purchase'];

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const fmt = useFormat();
  const platforms = usePlatforms().data ?? [];
  const facets = useFacets().data;
  const [view, setView] = useState<'grid' | 'table'>(() => loadPref('inventory-view', 'grid'));
  const [showFilters, setShowFilters] = useState(() => FILTER_KEYS.some((k) => params.has(k)));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const urlQ = params.get('q') ?? '';
  const [q, setQ] = useState(urlQ);
  const debouncedQ = useDebounced(q);
  const pushedQ = useRef(urlQ);

  const status = params.get('status') ?? 'unsold';
  const sort = params.get('sort') ?? 'updated:desc';
  const page = Number(params.get('page') ?? '1') || 1;

  const update = (changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  // Typing updates the URL once the person pauses; this must not re-run when the URL itself changes.
  useEffect(() => {
    if (debouncedQ === urlQ) return;
    pushedQ.current = debouncedQ;
    update({ q: debouncedQ || null });
  }, [debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps
  // Follow searches that come from elsewhere (the header search box).
  useEffect(() => {
    if (urlQ !== pushedQ.current) {
      pushedQ.current = urlQ;
      setQ(urlQ);
    }
  }, [urlQ]);

  const [sortKey, dir] = sort.split(':');
  const apiParams = useMemo(() => {
    const p: Record<string, string | number> = { sort: sortKey, dir, page, page_size: 48 };
    if (status !== 'all') p.status = status;
    for (const k of ['q', 'category', ...FILTER_KEYS]) {
      const v = params.get(k);
      if (v) p[k] = v;
    }
    return p;
  }, [params, sortKey, dir, page, status]);

  const query = useQuery({
    queryKey: ['cards', apiParams],
    queryFn: () => api.cards(apiParams),
    placeholderData: keepPreviousData,
    refetchInterval: (qq) => (qq.state.data?.cards.some((c) => c.active_job) ? 4000 : false),
  });
  const data = query.data;
  const cards = data?.cards ?? [];

  useEffect(() => setSelected(new Set()), [apiParams]);

  const activeFilterCount = FILTER_KEYS.filter((k) => params.has(k)).length + (params.get('category') ? 1 : 0);
  const narrowed = [...params.keys()].some((k) => k !== 'sort' && k !== 'page');
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const allSelected = cards.length > 0 && cards.every((c) => selected.has(c.id));

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="pb-24">
      <PageHeader
        title="Inventory"
        description={
          data
            ? `${fmt.number(data.total)} ${data.total === 1 ? 'card' : 'cards'} · ${fmt.number(data.totals.units)} in stock · worth about ${fmt.money(data.totals.value_cents, { noCents: true })}`
            : ' '
        }
        actions={
          <>
            <Button
              icon={<Download className="size-4" />}
              onClick={() => {
                window.location.href = '/api/export/cards.csv';
              }}
            >
              Export CSV
            </Button>
            <ButtonLink to="/admin/cards/new" variant="primary" icon={<Camera className="size-4" />}>
              Add cards
            </ButtonLink>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search: gretzky opc 79, young guns, binder 3, MC-00042…"
              className="pl-9"
              aria-label="Search cards"
            />
          </div>
          <Select aria-label="Category" value={params.get('category') ?? ''} onChange={(e) => update({ category: e.target.value || null })} className="w-auto">
            <option value="">All categories</option>
            {(facets?.categories.length ? facets.categories.map((c) => c.name) : CATEGORIES).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select aria-label="Sort" value={sort} onChange={(e) => update({ sort: e.target.value }, false)} className="w-auto">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Button
            icon={<SlidersHorizontal className="size-4" />}
            onClick={() => setShowFilters((f) => !f)}
            variant={activeFilterCount ? 'soft' : 'secondary'}
            aria-expanded={showFilters}
          >
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </Button>
          <div className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
            <IconButton
              label="Grid view"
              size="sm"
              className={clsx(view === 'grid' && 'bg-surface-3 text-ink')}
              onClick={() => {
                setView('grid');
                savePref('inventory-view', 'grid');
              }}
            >
              <LayoutGrid className="size-4" />
            </IconButton>
            <IconButton
              label="Table view"
              size="sm"
              className={clsx(view === 'table' && 'bg-surface-3 text-ink')}
              onClick={() => {
                setView('table');
                savePref('inventory-view', 'table');
              }}
            >
              <List className="size-4" />
            </IconButton>
          </div>
        </div>

        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Status">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={status === t.value}
              onClick={() => update({ status: t.value === 'unsold' ? null : t.value })}
              className={clsx(
                'shrink-0 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
                status === t.value
                  ? 'bg-ink text-surface'
                  : 'bg-surface text-ink-2 ring-1 ring-line ring-inset hover:text-ink',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {showFilters && <FilterPanel params={params} update={update} platforms={platforms} binders={facets?.binders ?? []} />}
      </div>

      {query.error ? (
        <Alert tone="critical" title="Couldn’t load cards">
          {errorMessage(query.error)}
        </Alert>
      ) : !data ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : cards.length === 0 ? (
        <EmptyState
          icon={<Library />}
          title={narrowed ? 'No cards match' : 'No cards yet'}
          action={
            narrowed ? (
              <Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear search & filters</Button>
            ) : (
              <ButtonLink to="/admin/cards/new" variant="primary" icon={<Camera className="size-4" />}>
                Add your first cards
              </ButtonLink>
            )
          }
        >
          {narrowed
            ? 'Try fewer words or different filters.'
            : 'Snap a photo of the front and back — the AI fills in the details.'}
        </EmptyState>
      ) : (
        <div className={clsx('transition-opacity', query.isFetching && query.isPlaceholderData && 'opacity-60')}>
          <div className="mb-2 flex items-center gap-3 text-sm text-muted">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 hover:text-ink"
              onClick={() => setSelected(allSelected ? new Set() : new Set(cards.map((c) => c.id)))}
            >
              {allSelected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
              {allSelected ? 'Unselect all' : 'Select all on this page'}
            </button>
            <span>
              {fmt.number((page - 1) * data.page_size + 1)}–{fmt.number(Math.min(page * data.page_size, data.total))} of {fmt.number(data.total)}
            </span>
          </div>
          {view === 'grid' ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {cards.map((c) => (
                <GridCard key={c.id} card={c} platforms={platforms} selected={selected.has(c.id)} onToggle={() => toggle(c.id)} />
              ))}
            </div>
          ) : (
            <CardTable cards={cards} platforms={platforms} selected={selected} onToggle={toggle} />
          )}
          {pages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}>
                Previous
              </Button>
              <span className="px-2 text-sm text-muted">
                Page {page} of {pages}
              </span>
              <Button disabled={page >= pages} onClick={() => update({ page: String(page + 1) }, false)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {selected.size > 0 && <BulkBar ids={[...selected]} platforms={platforms} onDone={() => setSelected(new Set())} />}
    </div>
  );
}

function FilterPanel({
  params,
  update,
  platforms,
  binders,
}: {
  params: URLSearchParams;
  update: (changes: Record<string, string | null>) => void;
  platforms: Platform[];
  binders: { name: string; count: number }[];
}) {
  const purchases = usePurchases().data ?? [];
  const flag = (key: string, label: string, value = '1') => (
    <Checkbox label={label} checked={params.get(key) === value} onChange={(e) => update({ [key]: e.target.checked ? value : null })} />
  );
  return (
    <div className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Posted on" htmlFor="f-platform">
        <Select id="f-platform" value={params.get('platform') ?? ''} onChange={(e) => update({ platform: e.target.value || null })}>
          <option value="">Anywhere or nowhere</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Not yet posted on" htmlFor="f-notplatform">
        <Select id="f-notplatform" value={params.get('not_platform') ?? ''} onChange={(e) => update({ not_platform: e.target.value || null })}>
          <option value="">—</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Binder / box" htmlFor="f-binder">
        <Select id="f-binder" value={params.get('binder') ?? ''} onChange={(e) => update({ binder: e.target.value || null })}>
          <option value="">Any</option>
          {binders.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name} ({b.count})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="From purchase" htmlFor="f-purchase">
        <Select id="f-purchase" value={params.get('purchase') ?? ''} onChange={(e) => update({ purchase: e.target.value || null })}>
          <option value="">Any</option>
          {purchases.map((p) => (
            <option key={p.id} value={p.id}>
              {p.description || p.source || `Purchase #${p.id}`}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-4 lg:flex-row lg:flex-wrap lg:gap-x-6">
        {flag('graded', 'Graded')}
        {flag('rookie', 'Rookies')}
        {flag('autograph', 'Autographs')}
        {flag('public', 'On the website')}
        {flag('has_inquiries', 'Has open inquiries')}
        {flag('has_value', 'No market value yet', '0')}
        {flag('has_price', 'No asking price yet', '0')}
      </div>
    </div>
  );
}

function GridCard({ card, platforms, selected, onToggle }: { card: Card; platforms: Platform[]; selected: boolean; onToggle: () => void }) {
  const fmt = useFormat();
  const label = cardLabel(card);
  const listed = card.listed_platform_ids.map((id) => platforms.find((p) => p.id === id)).filter((p): p is Platform => Boolean(p));
  return (
    <div
      className={clsx(
        'group relative flex flex-col overflow-hidden rounded-xl border bg-surface shadow-card transition-shadow hover:shadow-pop',
        selected ? 'border-primary ring-2 ring-primary' : 'border-line',
      )}
    >
      <label className="absolute top-2 left-2 z-10 flex size-7 cursor-pointer items-center justify-center rounded-md bg-surface/90 shadow-card">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${label}`} className="size-4 accent-[var(--primary)]" />
      </label>
      <Link to={`/admin/cards/${card.id}`} className="flex flex-1 flex-col">
        <div className="relative bg-surface-3 p-2">
          <CardThumb front={card.front_image} back={card.back_image} alt={label} busy={Boolean(card.active_job)} className="rounded-md ring-0" />
          <StatusBadge status={card.status} className="absolute right-2 bottom-2 text-[11px] shadow-card" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-2.5">
          <span className="font-mono text-[11px] whitespace-nowrap text-muted">{card.sku}</span>
          <div className="line-clamp-2 text-sm leading-snug font-medium">{label}</div>
          <CardFlags card={card} />
          <div className="mt-auto flex items-end justify-between gap-2 pt-1">
            <div className="leading-tight">
              <div className="text-sm font-semibold">{fmt.money(card.asking_price_cents ?? card.market_value_cents)}</div>
              <div className="text-[11px] text-muted">
                {card.asking_price_cents !== null ? 'asking' : card.market_value_cents !== null ? 'est. value' : 'no price yet'}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {card.open_inquiry_count > 0 && (
                <span className="inline-flex items-center gap-0.5 text-xs text-ink-2" title={`${card.open_inquiry_count} open inquiries`}>
                  <MessageSquare className="size-3.5" />
                  {card.open_inquiry_count}
                </span>
              )}
              {card.is_public && <Globe className="size-3.5 text-muted" aria-label="On the website" />}
              <span className="flex -space-x-0.5">
                {listed.slice(0, 5).map((p) => (
                  <PlatformDot key={p.id} platform={p} size="sm" />
                ))}
              </span>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}

function CardTable({
  cards,
  platforms,
  selected,
  onToggle,
}: {
  cards: Card[];
  platforms: Platform[];
  selected: Set<number>;
  onToggle: (id: number) => void;
}) {
  const fmt = useFormat();
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="w-10 px-3 py-2.5" />
            <th className="px-2 py-2.5 font-medium">Card</th>
            <th className="px-2 py-2.5 font-medium">Status</th>
            <th className="px-2 py-2.5 font-medium">Location</th>
            <th className="px-2 py-2.5 text-right font-medium">Value</th>
            <th className="px-2 py-2.5 text-right font-medium">Asking</th>
            <th className="px-2 py-2.5 font-medium">Posted on</th>
            <th className="px-3 py-2.5 text-right font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => {
            const label = cardLabel(c);
            return (
              <tr key={c.id} className={clsx('border-b border-line last:border-0 hover:bg-surface-2', selected.has(c.id) && 'bg-primary-soft/50')}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => onToggle(c.id)} aria-label={`Select ${label}`} className="size-4 accent-[var(--primary)]" />
                </td>
                <td className="px-2 py-2">
                  <Link to={`/admin/cards/${c.id}`} className="flex items-center gap-3">
                    <CardThumb front={c.front_image} back={c.back_image} alt={label} size="xs" busy={Boolean(c.active_job)} />
                    <span className="min-w-0">
                      <span className="block font-medium hover:text-primary">{label}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs text-muted">{c.sku}</span>
                        <CardFlags card={c} />
                        {c.quantity - c.quantity_sold > 1 && <span className="text-xs text-muted">× {c.quantity - c.quantity_sold}</span>}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-2 py-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-2 py-2 text-xs text-ink-2">{locationText(c) || '—'}</td>
                <td className="tabular px-2 py-2 text-right">{fmt.money(c.market_value_cents)}</td>
                <td className="tabular px-2 py-2 text-right font-medium">{fmt.money(c.asking_price_cents)}</td>
                <td className="px-2 py-2">
                  <PlatformChips ids={c.listed_platform_ids} platforms={platforms} max={3} />
                </td>
                <td className="px-3 py-2 text-right text-xs whitespace-nowrap text-muted">{fmt.relative(c.updated_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type BulkDialogKind = 'list' | 'end' | 'binder' | 'price' | 'purchase' | null;

function BulkBar({ ids, platforms, onDone }: { ids: number[]; platforms: Platform[]; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const ai = useAiStatus().data;
  const [dialog, setDialog] = useState<BulkDialogKind>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: string, value?: unknown, verb = 'Updated') {
    setBusy(true);
    try {
      const result = await api.bulk(ids, action, value);
      invalidateCardLists(qc);
      for (const id of ids) void qc.invalidateQueries({ queryKey: ['card', id] });
      if (result.failed.length === 0) toast.success(`${verb} ${result.ok} ${result.ok === 1 ? 'card' : 'cards'}`);
      else {
        const reasons = [...new Set(result.failed.map((f) => f.error))].slice(0, 2).join('; ');
        toast.info(`${verb} ${result.ok}. Skipped ${result.failed.length}: ${reasons}`);
      }
      setDialog(null);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-3 py-3 shadow-pop backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
          <span className="mr-2 text-sm font-semibold">{ids.length} selected</span>
          <Button size="sm" variant="primary" onClick={() => setDialog('list')} disabled={busy}>
            Mark as posted on…
          </Button>
          <Button size="sm" onClick={() => setDialog('end')} disabled={busy}>
            Taken down from…
          </Button>
          <Button size="sm" icon={<Globe className="size-4" />} onClick={() => run('public', true, 'Showing on website:')} disabled={busy}>
            Show on website
          </Button>
          <Menu
            align="left"
            trigger={(props) => (
              <Button size="sm" icon={<MoreHorizontal className="size-4" />} disabled={busy} {...props}>
                More
              </Button>
            )}
            items={[
              { label: 'Hide from website', onSelect: () => run('public', false, 'Hidden:') },
              { label: 'Move to binder / box…', onSelect: () => setDialog('binder') },
              { label: 'Set asking price from value…', onSelect: () => setDialog('price') },
              { label: 'Add to a purchase…', onSelect: () => setDialog('purchase') },
              'divider',
              { label: 'Approve (move into inventory)', onSelect: () => run('status', 'in_stock', 'Approved') },
              { label: 'Mark as keeper (not for sale)', onSelect: () => run('status', 'keeper', 'Marked') },
              { label: 'Mark as sale pending', onSelect: () => run('status', 'pending', 'Marked') },
              'divider',
              ai?.configured && { label: 'Identify with AI', icon: <Sparkles />, onSelect: () => run('identify', undefined, 'Queued') },
              ai?.configured && { label: 'Research values with AI', icon: <Sparkles />, onSelect: () => run('research', undefined, 'Queued') },
              { label: 'Print sleeve labels', icon: <Printer />, onSelect: () => window.open(`/admin/print?mode=labels&ids=${ids.join(',')}`, '_blank') },
              { label: 'Print index cards', icon: <Printer />, onSelect: () => window.open(`/admin/print?mode=sheet&ids=${ids.join(',')}`, '_blank') },
              'divider',
              {
                label: 'Delete…',
                danger: true,
                onSelect: async () => {
                  const ok = await confirm({
                    title: `Delete ${ids.length} ${ids.length === 1 ? 'card' : 'cards'}?`,
                    message: 'Photos and history are deleted too. Cards with recorded sales are kept for your records.',
                    confirmLabel: 'Delete',
                    danger: true,
                  });
                  if (ok) void run('delete', undefined, 'Deleted');
                },
              },
            ]}
          />
          <IconButton label="Clear selection" size="sm" className="ml-auto" onClick={onDone}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>
      <BulkValueDialog kind={dialog} count={ids.length} platforms={platforms} busy={busy} onClose={() => setDialog(null)} onRun={run} />
    </>
  );
}

function BulkValueDialog({
  kind,
  count,
  platforms,
  busy,
  onClose,
  onRun,
}: {
  kind: BulkDialogKind;
  count: number;
  platforms: Platform[];
  busy: boolean;
  onClose: () => void;
  onRun: (action: string, value?: unknown, verb?: string) => void;
}) {
  const purchases = usePurchases().data ?? [];
  const facets = useFacets().data;
  const [platformId, setPlatformId] = useState<number | null>(null);
  const [binder, setBinder] = useState('');
  const [percent, setPercent] = useState(110);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [purchaseId, setPurchaseId] = useState<number | null>(null);
  const active = platforms.filter((p) => p.active);

  if (!kind) return null;
  const titles: Record<Exclude<BulkDialogKind, null>, string> = {
    list: `Mark ${count} cards as posted`,
    end: `Mark ${count} cards as taken down`,
    binder: `Move ${count} cards`,
    price: `Set asking prices for ${count} cards`,
    purchase: `Add ${count} cards to a purchase`,
  };
  const submit = () => {
    if (kind === 'list' && platformId) onRun('list', { platform_id: platformId }, 'Marked as posted:');
    if (kind === 'end' && platformId) onRun('end_listings', { platform_id: platformId }, 'Taken down:');
    if (kind === 'binder') onRun('binder', binder, 'Moved');
    if (kind === 'price') onRun('price_from_value', { percent, only_missing: onlyMissing }, 'Priced');
    if (kind === 'purchase') onRun('purchase', purchaseId, 'Linked');
  };
  const needsPlatform = kind === 'list' || kind === 'end';
  return (
    <Dialog
      open
      onClose={onClose}
      title={titles[kind]}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={needsPlatform && !platformId}>
            Apply
          </Button>
        </>
      }
    >
      {needsPlatform && (
        <div className="flex flex-col gap-2">
          {(kind === 'list' ? active : platforms).map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 hover:bg-surface-2">
              <input type="radio" name="bulk-platform" checked={platformId === p.id} onChange={() => setPlatformId(p.id)} className="accent-[var(--primary)]" />
              <PlatformDot platform={p} />
              <span className="text-sm font-medium">{p.name}</span>
            </label>
          ))}
          {kind === 'list' && <p className="text-xs text-muted">Each card is recorded at its asking price, posted today. Cards already posted there are skipped.</p>}
        </div>
      )}
      {kind === 'binder' && (
        <>
          <TextField label="Binder / box name" value={binder} onChange={(e) => setBinder(e.target.value)} list="bulk-binders" autoFocus />
          <datalist id="bulk-binders">{facets?.binders.map((b) => <option key={b.name} value={b.name} />)}</datalist>
        </>
      )}
      {kind === 'price' && (
        <div className="flex flex-col gap-4">
          <TextField
            label="Asking price = market value ×"
            type="number"
            min={1}
            max={1000}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value) || 100)}
            hint={`${percent}% of the estimated value, rounded to the nearest 25¢. Cards without a value are skipped.`}
          />
          <Checkbox label="Only cards that don’t have an asking price yet" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
        </div>
      )}
      {kind === 'purchase' && (
        <Field label="Purchase" htmlFor="bulk-purchase" hint="Create purchases on the Purchases page.">
          <Select id="bulk-purchase" value={purchaseId ?? ''} onChange={(e) => setPurchaseId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Remove from its purchase</option>
            {purchases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.description || p.source || `Purchase #${p.id}`}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Dialog>
  );
}
