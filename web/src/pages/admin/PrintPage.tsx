import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { cardLabel, detailLines } from '@shared/cardText';
import { FULFILLMENT_LABELS, INQUIRY_STATUS_LABELS, STATUS_LABELS } from '@shared/constants';
import type { Card, CardDetail, Platform } from '@shared/types';
import { locationText } from '../../components/cards';
import { Button, ButtonLink } from '../../components/ui/Button';
import { PageSpinner } from '../../components/ui/Feedback';
import { SegmentedControl } from '../../components/ui/Form';
import { api } from '../../lib/api';
import { FormatProvider, useFormat } from '../../lib/format';
import { usePlatforms, useSettings } from '../../lib/queries';
import { useSession } from '../../lib/session';

/**
 * Printable "index cards" (one page per card) and sleeve labels. Labels are laid
 * out for 30-up address label sheets (2⅝" × 1", e.g. Avery 5160/8160).
 */
export default function PrintPage() {
  const session = useSession();
  const location = useLocation();
  if (session.isLoading) return <PageSpinner />;
  if (!session.data?.authenticated) {
    return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <PrintView />;
}

function PrintView() {
  const [params, setParams] = useSearchParams();
  const settings = useSettings().data;
  const ids = (params.get('ids') ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 300);
  const mode = params.get('mode') === 'labels' ? 'labels' : 'sheet';

  useEffect(() => {
    document.title = mode === 'labels' ? 'Card labels' : 'Index cards';
  }, [mode]);

  return (
    <FormatProvider currency={settings?.currency ?? 'CAD'} locale={settings?.locale ?? 'en-CA'}>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
        {ids.length === 1 ? (
          <ButtonLink to={`/admin/cards/${ids[0]}`} size="sm" variant="ghost" icon={<ArrowLeft className="size-4" />}>
            Back to card
          </ButtonLink>
        ) : (
          <ButtonLink to="/admin/cards" size="sm" variant="ghost" icon={<ArrowLeft className="size-4" />}>
            Inventory
          </ButtonLink>
        )}
        <SegmentedControl
          size="sm"
          value={mode}
          onChange={(m) => {
            const next = new URLSearchParams(params);
            next.set('mode', m);
            setParams(next, { replace: true });
          }}
          options={[
            { value: 'sheet', label: 'Index card (full page)' },
            { value: 'labels', label: 'Sleeve labels' },
          ]}
        />
        <span className="text-sm text-muted">
          {ids.length} {ids.length === 1 ? 'card' : 'cards'}
          {mode === 'labels' && ' · fits 30-up label sheets (2⅝" × 1", like Avery 5160)'}
        </span>
        <Button variant="primary" size="sm" icon={<Printer className="size-4" />} className="ml-auto" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      {ids.length === 0 ? (
        <p className="p-8 text-center text-muted">
          No cards chosen. <Link to="/admin/cards" className="text-primary">Pick cards in Inventory</Link>.
        </p>
      ) : mode === 'labels' ? (
        <Labels ids={ids} />
      ) : (
        <Sheets ids={ids} storeName={settings?.store_name ?? ''} />
      )}
    </FormatProvider>
  );
}

function Labels({ ids }: { ids: number[] }) {
  const fmt = useFormat();
  const query = useQuery({
    queryKey: ['cards', { ids: ids.join(','), print: true }],
    queryFn: () => api.cards({ ids: ids.join(','), status: 'all', sort: 'location', dir: 'asc', page_size: 500 }),
  });
  if (query.isLoading) return <PageSpinner />;
  const cards = query.data?.cards ?? [];
  return (
    <>
      <style>{`
        @page { size: letter; margin: 0; }
        .label-sheet { width: 8.5in; padding: 0.5in 0.1875in 0; display: grid; grid-template-columns: repeat(3, 2.625in); grid-auto-rows: 1in; column-gap: 0.125in; background: white; color: black; margin: 0 auto; }
        .label { box-sizing: border-box; padding: 0.08in 0.1in; display: flex; gap: 0.08in; align-items: center; overflow: hidden; }
        @media screen { .label-sheet { margin: 16px auto; box-shadow: 0 1px 8px rgba(0,0,0,.15); min-height: 11in; } .label { outline: 1px dashed #ddd; } }
        @media print { .label-sheet:nth-of-type(n) { break-after: page; } }
      `}</style>
      {chunk(cards, 30).map((page, i) => (
        <div key={i} className="label-sheet">
          {page.map((c: Card) => (
            <div key={c.id} className="label">
              <img src={`/api/cards/${c.id}/qr.svg`} alt="" style={{ width: '0.8in', height: '0.8in', flexShrink: 0 }} />
              <div style={{ minWidth: 0, lineHeight: 1.15 }}>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: '10pt' }}>{c.sku}</div>
                <div style={{ fontSize: '7pt', maxHeight: '2.4em', overflow: 'hidden' }}>{cardLabel(c)}</div>
                <div style={{ fontSize: '6.5pt', color: '#444' }}>{locationText(c)}</div>
                {c.asking_price_cents !== null && <div style={{ fontSize: '8pt', fontWeight: 700 }}>{fmt.money(c.asking_price_cents)}</div>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out.length ? out : [[]];
}

function Sheets({ ids, storeName }: { ids: number[]; storeName: string }) {
  const platforms = usePlatforms().data ?? [];
  const query = useQuery({
    queryKey: ['print-sheets', ids.join(',')],
    queryFn: async () => {
      const out: CardDetail[] = [];
      for (const id of ids) out.push(await api.card(id));
      return out;
    },
  });
  if (query.isLoading) return <PageSpinner label="Preparing index cards…" />;
  return (
    <>
      <style>{`
        @page { size: letter; margin: 0.5in; }
        .sheet { background: white; color: #111; max-width: 7.5in; margin: 16px auto; padding: 0.4in; box-shadow: 0 1px 8px rgba(0,0,0,.15); font-size: 10pt; }
        .sheet h2 { font-size: 11pt; font-weight: 700; margin: 12px 0 4px; border-bottom: 1px solid #999; padding-bottom: 2px; }
        .sheet table { width: 100%; border-collapse: collapse; font-size: 9pt; }
        .sheet td, .sheet th { border: 1px solid #bbb; padding: 3px 5px; text-align: left; vertical-align: top; }
        .sheet th { background: #f2f2f2; }
        @media print { .sheet { box-shadow: none; margin: 0; padding: 0; max-width: none; break-after: page; } }
      `}</style>
      {(query.data ?? []).map((card) => (
        <Sheet key={card.id} card={card} platforms={platforms} storeName={storeName} />
      ))}
    </>
  );
}

function Sheet({ card, platforms, storeName }: { card: CardDetail; platforms: Platform[]; storeName: string }) {
  const fmt = useFormat();
  const front = card.images.find((i) => i.side === 'front');
  const back = card.images.find((i) => i.side === 'back');
  const shown = platforms.filter((p) => p.active || card.listings.some((l) => l.platform_id === p.id));
  const ourSiteId = shown.find((p) => p.kind === 'website')?.id;
  return (
    <article className="sheet">
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '8pt', color: '#555' }}>{storeName} · Index card · printed {fmt.date(new Date().toISOString())}</div>
          <div style={{ fontSize: '16pt', fontWeight: 700, lineHeight: 1.2, marginTop: 2 }}>{cardLabel(card)}</div>
          <div style={{ fontSize: '10pt', marginTop: 2 }}>
            <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{card.sku}</strong> · {STATUS_LABELS[card.status]}
            {locationText(card) && ` · 📍 ${locationText(card)}`}
          </div>
        </div>
        <img src={`/api/cards/${card.id}/qr.svg`} alt="" style={{ width: '1in', height: '1in' }} />
      </header>

      <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
        {[front, back].map((img, i) =>
          img ? <img key={i} src={img.urls.md} alt="" style={{ height: '3.2in', width: 'auto', border: '1px solid #ccc', borderRadius: 4 }} /> : null,
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ marginTop: 0 }}>Details</h2>
          <div style={{ fontSize: '9pt', lineHeight: 1.5 }}>
            {detailLines(card).map((l) => (
              <div key={l}>{l}</div>
            ))}
            {card.condition_notes && <div>Condition notes: {card.condition_notes}</div>}
            {card.quantity > 1 && <div>Quantity: {card.quantity - card.quantity_sold} of {card.quantity} left</div>}
          </div>
          <h2>Value & pricing</h2>
          <div style={{ fontSize: '9pt', lineHeight: 1.5 }}>
            <div>
              Market value: <strong>{fmt.money(card.market_value_cents)}</strong>
              {card.market_low_cents !== null && card.market_high_cents !== null && ` (${fmt.money(card.market_low_cents)}–${fmt.money(card.market_high_cents)})`}
              {card.market_checked_at && ` · checked ${fmt.date(card.market_checked_at)}`}
            </div>
            <div>
              Asking: <strong>{fmt.money(card.asking_price_cents)}</strong> · Lowest: {fmt.money(card.floor_price_cents)} · Paid: {fmt.money(card.cost_cents)}
            </div>
            {card.acquired_from && <div>Acquired from {card.acquired_from}{card.acquired_date ? ` on ${fmt.date(card.acquired_date)}` : ''}</div>}
          </div>
        </div>
      </div>

      <h2>Where it’s posted</h2>
      <table>
        <thead>
          <tr>
            <th style={{ width: 22 }}>✓</th>
            <th>Platform</th>
            <th>Price</th>
            <th>Posted</th>
            <th>Link / group / notes</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => {
            const listings = card.listings.filter((l) => l.platform_id === p.id);
            const active = listings.filter((l) => l.status === 'active');
            const l = active[0] ?? listings[0];
            const onOurSite = p.id === ourSiteId && card.is_public;
            return (
              <tr key={p.id}>
                <td style={{ textAlign: 'center' }}>{active.length || onOurSite ? '☑' : l ? '☒' : '☐'}</td>
                <td>{p.name}</td>
                <td>{l ? fmt.money(l.price_cents) : onOurSite ? fmt.money(card.asking_price_cents) : ''}</td>
                <td>{l ? fmt.shortDate(l.listed_at) : ''}</td>
                <td style={{ wordBreak: 'break-all' }}>
                  {l ? [l.channel, l.url, l.status !== 'active' ? `(${l.status})` : ''].filter(Boolean).join(' ') : onOurSite ? 'Shown in the online shop' : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Inquiries & offers</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Who</th>
            <th>Contact</th>
            <th>Offer</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {card.inquiries.map((i) => (
            <tr key={i.id}>
              <td>{fmt.shortDate(i.created_at)}</td>
              <td>{i.name}</td>
              <td>{i.contact}</td>
              <td>{fmt.money(i.offer_cents)}</td>
              <td>{INQUIRY_STATUS_LABELS[i.status]}</td>
              <td>{i.message}</td>
            </tr>
          ))}
          {Array.from({ length: Math.max(0, 3 - card.inquiries.length) }, (_, k) => (
            <tr key={`blank-${k}`}>
              <td style={{ height: 22 }} />
              <td />
              <td />
              <td />
              <td />
              <td />
            </tr>
          ))}
        </tbody>
      </table>

      {card.sales.length > 0 && (
        <>
          <h2>Sales</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Where</th>
                <th>Buyer</th>
                <th>Price</th>
                <th>Profit</th>
                <th>Delivery</th>
              </tr>
            </thead>
            <tbody>
              {card.sales.map((s) => (
                <tr key={s.id}>
                  <td>{fmt.date(s.sold_on)}</td>
                  <td>{platforms.find((p) => p.id === s.platform_id)?.name ?? 'Other'}</td>
                  <td>{s.buyer_name}</td>
                  <td>{fmt.money(s.sale_price_cents)}</td>
                  <td>{fmt.signedMoney(s.net_cents)}</td>
                  <td>
                    {FULFILLMENT_LABELS[s.fulfillment]}
                    {s.tracking_number && ` · ${s.tracking_number}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Notes</h2>
      <div style={{ minHeight: '0.8in', whiteSpace: 'pre-wrap', fontSize: '9pt' }}>{card.notes}</div>
    </article>
  );
}
