import clsx from 'clsx';
import { BadgeDollarSign, ExternalLink, Globe, MoreHorizontal, Plus, Star, Trash2, Undo2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { LISTING_STATUS_LABELS } from '@shared/constants';
import type { CardDetail, Listing, Platform } from '@shared/types';
import { PlatformDot } from '../../../components/cards';
import { Button, IconButton } from '../../../components/ui/Button';
import { useConfirm } from '../../../components/ui/Dialog';
import { Alert, Badge } from '../../../components/ui/Feedback';
import { Input, MoneyInput, Switch } from '../../../components/ui/Form';
import { Menu } from '../../../components/ui/Menu';
import { Panel } from '../../../components/ui/Panel';
import { useToast } from '../../../components/ui/Toast';
import { api, errorMessage } from '../../../lib/api';
import { todayIso, useFormat } from '../../../lib/format';
import { useApplyCard, usePlatforms } from '../../../lib/queries';

function daysSince(date: string | null): number | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  const then = new Date(y, m - 1, d).getTime();
  return Math.max(0, Math.round((Date.now() - then) / 86_400_000));
}

export function ListingsPanel({ card, onSellHere }: { card: CardDetail; onSellHere: (listing: Listing) => void }) {
  const platforms = usePlatforms().data ?? [];
  const applyCard = useApplyCard();
  const toast = useToast();
  const confirm = useConfirm();
  const fmt = useFormat();
  const [busyPlatform, setBusyPlatform] = useState<number | null>(null);
  // Tick/untick shows immediately; it settles to the server's answer when the request finishes.
  const [optimistic, setOptimistic] = useState<Record<number, boolean>>({});

  const active = card.listings.filter((l) => l.status === 'active');
  const history = card.listings.filter((l) => l.status !== 'active');
  const shown = platforms.filter((p) => p.active || active.some((l) => l.platform_id === p.id));
  const sold = card.status === 'sold';
  const canShowOnSite = ['in_stock', 'listed', 'pending'].includes(card.status);

  async function run(fn: () => Promise<CardDetail | unknown>, success?: string) {
    try {
      const result = await fn();
      if (result && typeof result === 'object' && 'listings' in result) applyCard(result as CardDetail);
      else applyCard(await api.card(card.id));
      if (success) toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const settle = (platformId: number) =>
    setOptimistic((o) => {
      const next = { ...o };
      delete next[platformId];
      return next;
    });

  async function post(platform: Platform) {
    setBusyPlatform(platform.id);
    setOptimistic((o) => ({ ...o, [platform.id]: true }));
    await run(() => api.addListing(card.id, { platform_id: platform.id, listed_at: todayIso() }), `Marked as posted on ${platform.name}`);
    settle(platform.id);
    setBusyPlatform(null);
  }

  async function takeDown(platform: Platform, listings: Listing[]) {
    const ok = await confirm({
      title: `Taken down from ${platform.name}?`,
      message: 'The posting is kept in the card’s history as “ended”.',
      confirmLabel: 'Mark as taken down',
    });
    if (!ok) return;
    setBusyPlatform(platform.id);
    setOptimistic((o) => ({ ...o, [platform.id]: false }));
    await run(() => api.endListings(listings.map((l) => l.id)), `Marked as taken down from ${platform.name}`);
    settle(platform.id);
    setBusyPlatform(null);
  }

  return (
    <Panel
      id="listings"
      title="Where it’s posted"
      description="Tick every place you’ve posted this card. Add the link and price so you can find it again."
    >
      <div className="mb-4 flex flex-col gap-3 rounded-xl bg-surface-2 p-3.5">
        <Switch
          checked={card.is_public}
          onChange={(v) => run(() => api.updateCard(card.id, { is_public: v }), v ? 'Now showing on your website' : 'Hidden from your website')}
          label={
            <span className="inline-flex items-center gap-2">
              <Globe className="size-4 text-muted" /> Show on our website
            </span>
          }
          description={
            canShowOnSite
              ? card.is_public
                ? 'Visitors can see it and send you a message about it.'
                : 'Off — only you can see it.'
              : sold
                ? 'Sold cards are never shown.'
                : 'Shown once it’s reviewed and in inventory.'
          }
        />
        {card.is_public && (
          <div className="flex flex-wrap items-center gap-3 pl-6">
            <button
              type="button"
              onClick={() => run(() => api.updateCard(card.id, { featured: !card.featured }))}
              className={clsx(
                'inline-flex items-center gap-1.5 text-sm',
                card.featured ? 'font-medium text-ink' : 'text-muted hover:text-ink',
              )}
            >
              <Star className={clsx('size-4', card.featured && 'fill-current text-warning')} />
              {card.featured ? 'Featured at the top of the shop' : 'Feature it at the top of the shop'}
            </button>
            {canShowOnSite && (
              <a href={`/card/${card.sku}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                View on website <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        )}
      </div>

      {sold && active.length > 0 && (
        <Alert
          tone="critical"
          className="mb-4"
          title="Sold — but still posted elsewhere"
          action={
            <Button size="sm" onClick={() => run(() => api.endListings(active.map((l) => l.id)), 'All postings marked as taken down')}>
              I took them all down
            </Button>
          }
        >
          Take it down from {active.map((l) => platforms.find((p) => p.id === l.platform_id)?.name ?? 'platform').join(', ')} so nobody
          else tries to buy it.
        </Alert>
      )}

      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {shown.map((platform) => {
          const listings = active.filter((l) => l.platform_id === platform.id);
          const posted = listings.length > 0;
          return (
            <li key={platform.id} className={clsx('px-3 py-2.5', posted && 'bg-primary-soft/40')}>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  aria-label={`Posted on ${platform.name}`}
                  className="size-5 shrink-0 cursor-pointer accent-[var(--primary)]"
                  checked={optimistic[platform.id] ?? posted}
                  disabled={busyPlatform === platform.id || (sold && !posted)}
                  onChange={(e) => (e.target.checked ? post(platform) : takeDown(platform, listings))}
                />
                <PlatformDot platform={platform} />
                <span className="flex-1 text-sm font-medium">{platform.name}</span>
                {posted ? (
                  <span className="text-xs text-muted">
                    {listings.length > 1 ? `${listings.length} postings` : `posted ${fmt.shortDate(listings[0].listed_at)}`}
                  </span>
                ) : (
                  !sold && (
                    <button
                      type="button"
                      onClick={() => post(platform)}
                      className="text-xs font-medium text-primary hover:underline"
                      disabled={busyPlatform === platform.id}
                    >
                      Mark as posted
                    </button>
                  )
                )}
              </div>
              {posted && (
                <div className="mt-2 flex flex-col gap-2 pl-8">
                  {listings.map((l) => (
                    <ListingEditor
                      key={l.id}
                      listing={l}
                      platform={platform}
                      onSaved={applyCard}
                      onSellHere={() => onSellHere(l)}
                      canSell={!sold}
                    />
                  ))}
                  {!sold && (
                    <button
                      type="button"
                      onClick={() => post(platform)}
                      className="inline-flex w-fit items-center gap-1 text-xs text-muted hover:text-primary"
                    >
                      <Plus className="size-3.5" /> Posted again (another group or account)
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Missing a site? Turn on more platforms or add your own in{' '}
        <Link to="/admin/settings#platforms" className="text-primary hover:underline">
          Settings
        </Link>
        .
      </p>

      {history.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium select-none">Posting history ({history.length})</summary>
          <ul className="mt-2 flex flex-col divide-y divide-line text-sm">
            {history.map((l) => {
              const p = platforms.find((x) => x.id === l.platform_id);
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  {p && <PlatformDot platform={p} size="sm" />}
                  <span className="font-medium">{p?.name ?? 'Platform'}</span>
                  {l.channel && <span className="text-muted">{l.channel}</span>}
                  <Badge tone={l.status === 'sold' ? 'good' : 'neutral'}>{LISTING_STATUS_LABELS[l.status]}</Badge>
                  <span className="text-muted">
                    {fmt.shortDate(l.listed_at)} → {fmt.shortDate(l.ended_at)}
                    {l.price_cents !== null && ` · ${fmt.money(l.price_cents)}`}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    {l.url && (
                      <a href={l.url} target="_blank" rel="noreferrer noopener" className="rounded p-1 text-muted hover:text-primary" aria-label="Open posting">
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                    {!sold && l.status === 'ended' && (
                      <IconButton label="Re-list" size="sm" onClick={() => run(() => api.updateListing(l.id, { status: 'active' }), 'Posting re-activated')}>
                        <Undo2 className="size-4" />
                      </IconButton>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </Panel>
  );
}

function ListingEditor({
  listing,
  platform,
  onSaved,
  onSellHere,
  canSell,
}: {
  listing: Listing;
  platform: Platform;
  onSaved: (detail: CardDetail) => void;
  onSellHere: () => void;
  canSell: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [url, setUrl] = useState(listing.url);
  const [channel, setChannel] = useState(listing.channel);
  const [listedAt, setListedAt] = useState(listing.listed_at ?? '');
  const days = daysSince(listing.listed_at);

  async function save(patch: Record<string, unknown>) {
    try {
      onSaved(await api.updateListing(listing.id, patch));
    } catch (err) {
      toast.error(errorMessage(err));
      setUrl(listing.url);
      setChannel(listing.channel);
      setListedAt(listing.listed_at ?? '');
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[8rem_1fr_10rem]">
        <MoneyInput
          ariaLabel={`${platform.name} price`}
          value={listing.price_cents}
          onChange={(v) => {
            if (v !== listing.price_cents) void save({ price_cents: v });
          }}
        />
        <Input
          aria-label={`${platform.name} link`}
          placeholder="Paste the posting link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url !== listing.url && save({ url })}
          className="col-span-2 sm:col-span-1"
        />
        <Input
          aria-label="Date posted"
          type="date"
          value={listedAt}
          onChange={(e) => setListedAt(e.target.value)}
          onBlur={() => listedAt !== (listing.listed_at ?? '') && save({ listed_at: listedAt || null })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Group or account"
          placeholder={platform.kind === 'social' ? 'Which group / account?' : 'Item # or note (optional)'}
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          onBlur={() => channel !== listing.channel && save({ channel })}
          className="min-h-9 flex-1 py-1.5 text-sm"
        />
        {days !== null && (
          <span className={clsx('text-xs', days >= 30 ? 'font-medium text-serious-text' : 'text-muted')} title="Days since posted">
            {days === 0 ? 'today' : `${days}d up`}
          </span>
        )}
        {listing.url && (
          <a href={listing.url} target="_blank" rel="noreferrer noopener" className="rounded-lg p-1.5 text-muted hover:bg-surface-3 hover:text-primary" aria-label="Open posting">
            <ExternalLink className="size-4" />
          </a>
        )}
        {canSell && (
          <Button size="sm" variant="soft" icon={<BadgeDollarSign className="size-4" />} onClick={onSellHere}>
            Sold here
          </Button>
        )}
        <Menu
          trigger={(props) => (
            <IconButton label="More" size="sm" {...props}>
              <MoreHorizontal className="size-4" />
            </IconButton>
          )}
          items={[
            {
              label: 'Mark as taken down',
              icon: <XCircle />,
              onSelect: () => save({ status: 'ended' }),
            },
            {
              label: 'Delete this record (posted by mistake)',
              icon: <Trash2 />,
              danger: true,
              onSelect: async () => {
                if (await confirm({ title: 'Delete this posting record?', confirmLabel: 'Delete', danger: true })) {
                  try {
                    onSaved(await api.deleteListing(listing.id));
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }
              },
            },
          ]}
        />
      </div>
    </div>
  );
}
