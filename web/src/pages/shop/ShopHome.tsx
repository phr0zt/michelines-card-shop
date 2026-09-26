import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ImageOff, Search, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { cardLabel } from '@shared/cardText';
import type { PublicCard } from '@shared/types';
import { CardFlags } from '../../components/cards';
import { Button } from '../../components/ui/Button';
import { Badge, EmptyState, PageSpinner } from '../../components/ui/Feedback';
import { Checkbox, Input, Select } from '../../components/ui/Form';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { useStore } from './ShopLayout';

export function ShopHome() {
  const store = useStore();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [pages, setPages] = useState(1);

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((params.get('q') ?? '') !== q) set('q', q || null);
    }, 350);
    return () => window.clearTimeout(t);
    // Only react to typing; `set` reads the latest params itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const filters = {
    q: params.get('q') ?? undefined,
    category: params.get('category') ?? undefined,
    graded: params.get('graded') ?? undefined,
    rookie: params.get('rookie') ?? undefined,
    sort: params.get('sort') ?? 'featured',
  };
  useEffect(() => setPages(1), [filters.q, filters.category, filters.graded, filters.rookie, filters.sort]);

  const query = useQuery({
    queryKey: ['public-cards', filters, pages],
    queryFn: () => api.public.cards({ ...filters, page: 1, page_size: 24 * pages }),
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  return (
    <div>
      {store.intro && !filters.category && !filters.q && <p className="mb-6 max-w-3xl text-ink-2">{store.intro}</p>}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player, team, year or set…" className="pl-9" aria-label="Search cards" />
        </div>
        <Select aria-label="Sort" value={filters.sort} onChange={(e) => set('sort', e.target.value === 'featured' ? null : e.target.value)} className="w-auto">
          <option value="featured">Featured</option>
          <option value="newest">Newest</option>
          {store.show_prices && <option value="price_asc">Price: low to high</option>}
          {store.show_prices && <option value="price_desc">Price: high to low</option>}
          <option value="year">Year</option>
        </Select>
        <Checkbox label="Graded" checked={filters.graded === '1'} onChange={(e) => set('graded', e.target.checked ? '1' : null)} />
        <Checkbox label="Rookies" checked={filters.rookie === '1'} onChange={(e) => set('rookie', e.target.checked ? '1' : null)} />
      </div>

      {query.isLoading ? (
        <PageSpinner />
      ) : !data || data.cards.length === 0 ? (
        <EmptyState title={filters.q || filters.category ? 'No cards match' : 'New cards coming soon'}>
          {filters.q || filters.category ? 'Try a different search.' : 'Check back soon, or send us a message about what you’re looking for.'}
        </EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            {data.total} {data.total === 1 ? 'card' : 'cards'}
            {filters.category ? ` in ${filters.category}` : ''}
          </p>
          <div className={clsx('grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4', query.isPlaceholderData && 'opacity-60')}>
            {data.cards.map((c) => (
              <ShopTile key={c.sku} card={c} />
            ))}
          </div>
          {data.cards.length < data.total && (
            <div className="mt-8 flex justify-center">
              <Button onClick={() => setPages((p) => p + 1)} loading={query.isFetching}>
                Show more cards
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ShopTile({ card }: { card: PublicCard }) {
  const fmt = useFormat();
  const [hover, setHover] = useState(false);
  const front = card.images.find((i) => i.side === 'front') ?? card.images[0];
  const back = card.images.find((i) => i.side === 'back');
  const img = hover && back ? back : front;
  const title = card.title || cardLabel(card);
  return (
    <Link
      to={`/card/${encodeURIComponent(card.sku)}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-shadow hover:shadow-pop"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="relative bg-surface-3 p-3">
        <div className="aspect-[5/7] w-full">
          {img ? (
            <img src={img.urls.md} alt={title} loading="lazy" className="size-full object-contain" />
          ) : (
            <div className="flex size-full items-center justify-center text-muted">
              <ImageOff className="size-8" />
            </div>
          )}
        </div>
        {card.featured && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-xs font-medium shadow-card">
            <Star className="size-3 fill-current text-warning" /> Featured
          </span>
        )}
        {card.availability === 'pending' && (
          <Badge tone="warning" className="absolute top-2 right-2">
            Sale pending
          </Badge>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="line-clamp-2 text-sm leading-snug font-medium group-hover:text-primary">{cardLabel(card)}</div>
        <CardFlags card={card} />
        <div className="mt-auto pt-1 text-base font-semibold">
          {card.price_cents !== null ? fmt.money(card.price_cents) : <span className="text-sm font-medium text-primary">Ask for price</span>}
        </div>
      </div>
    </Link>
  );
}
