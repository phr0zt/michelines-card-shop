import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, CheckCircle2, ImageOff, MapPin, Send } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { cardLabel, detailLines } from '@shared/cardText';
import { CardFlags } from '../../components/cards';
import { Button } from '../../components/ui/Button';
import { Alert, Badge, EmptyState, PageSpinner } from '../../components/ui/Feedback';
import { Field, Input, MoneyInput, Textarea } from '../../components/ui/Form';
import { api, errorMessage } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { useStore } from './ShopLayout';

export function ShopCardPage() {
  const sku = useParams().sku ?? '';
  const store = useStore();
  const fmt = useFormat();
  const query = useQuery({ queryKey: ['public-card', sku], queryFn: () => api.public.card(sku), retry: false });
  const [imageIndex, setImageIndex] = useState(0);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (query.data) document.title = `${query.data.title || cardLabel(query.data)} — ${store.name}`;
  }, [query.data, store.name]);

  if (query.isLoading) return <PageSpinner />;
  if (query.error || !query.data) {
    return (
      <EmptyState
        title="This card isn’t available anymore"
        action={
          <Link to="/" className="font-medium text-primary hover:underline">
            See the other cards
          </Link>
        }
      >
        It may have just sold.
      </EmptyState>
    );
  }
  const card = query.data;
  const title = cardLabel(card);
  const image = card.images[imageIndex] ?? card.images[0];

  return (
    <div>
      <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> All cards
      </Link>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          <button
            type="button"
            className="block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-line bg-surface-3 p-4"
            onClick={() => image && setZoom(true)}
            aria-label="Zoom in"
          >
            {image ? (
              <img src={image.urls.md} alt={`${title} — ${image.side}`} className="mx-auto aspect-[5/7] max-h-[70vh] w-full object-contain" />
            ) : (
              <div className="flex aspect-[5/7] items-center justify-center text-muted">
                <ImageOff className="size-10" />
              </div>
            )}
          </button>
          {card.images.length > 1 && (
            <div className="mt-3 flex gap-2">
              {card.images.map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setImageIndex(i)}
                  className={clsx('w-20 overflow-hidden rounded-lg ring-2', i === imageIndex ? 'ring-primary' : 'ring-transparent hover:ring-line-strong')}
                  aria-label={`Show ${img.side}`}
                >
                  <img src={img.urls.sm} alt="" className="aspect-[5/7] w-full bg-surface-3 object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <div className="text-sm text-muted">{card.category}</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <CardFlags card={card} />
              {card.parallel && <Badge>{card.parallel}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-semibold">{card.price_cents !== null ? fmt.money(card.price_cents) : 'Ask for price'}</span>
            {card.availability === 'pending' ? <Badge tone="warning">Sale pending</Badge> : <Badge tone="good">Available</Badge>}
          </div>
          {card.description && <p className="text-ink-2">{card.description}</p>}
          <ul className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4 text-sm">
            {detailLines(card).map((l) => {
              const [label, ...rest] = l.split(': ');
              return (
                <li key={l} className="flex justify-between gap-4">
                  <span className="text-muted">{label}</span>
                  <span className="text-right font-medium">{rest.join(': ')}</span>
                </li>
              );
            })}
            <li className="flex justify-between gap-4">
              <span className="text-muted">Item code</span>
              <span className="font-mono">{card.sku}</span>
            </li>
          </ul>
          {store.pickup_location && (
            <p className="inline-flex items-center gap-2 text-sm text-ink-2">
              <MapPin className="size-4" /> Pickup in {store.pickup_location}, or we can ship.
            </p>
          )}
          <InquiryForm sku={card.sku} title={title} showOffer={card.availability === 'available'} />
        </div>
      </div>

      {zoom && image && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setZoom(false)} role="dialog" aria-label="Full-size photo">
          <img src={image.urls.full} alt={title} className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}

function InquiryForm({ sku, title, showOffer }: { sku: string; title: string; showOffer: boolean }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [offer, setOffer] = useState<number | null>(null);
  const [message, setMessage] = useState(`Hi! Is the ${title} still available?`);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.public.inquire(sku, { name, contact, message, offer: offer === null ? null : offer / 100, website });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Alert tone="good" title="Message sent — thank you!">
        We’ll get back to you at {contact} as soon as we can.
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="text-lg font-semibold">Interested? Send us a message</h2>
      <p className="mb-4 text-sm text-muted">Ask a question, make an offer, or arrange pickup or shipping.</p>
      {error && <Alert tone="critical" className="mb-4">{error}</Alert>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Your name" htmlFor="inq-name">
          <Input id="inq-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoComplete="name" />
        </Field>
        <Field label="Email or phone" htmlFor="inq-contact">
          <Input id="inq-contact" value={contact} onChange={(e) => setContact(e.target.value)} required maxLength={200} autoComplete="email" />
        </Field>
        {showOffer && (
          <Field label="Your offer (optional)" htmlFor="inq-offer" className="sm:col-span-2">
            <MoneyInput id="inq-offer" value={offer} onChange={setOffer} placeholder="Leave blank to just ask" />
          </Field>
        )}
        <Field label="Message" htmlFor="inq-message" className="sm:col-span-2">
          <Textarea id="inq-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
        </Field>
        {/* Hidden from people; bots that fill every field get quietly ignored. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>
      </div>
      <Button type="submit" variant="primary" size="lg" className="mt-4 w-full sm:w-auto" loading={busy} icon={<Send className="size-4" />}>
        Send message
      </Button>
      <p className="mt-3 text-xs text-muted">
        <CheckCircle2 className="mr-1 inline size-3.5" />
        We only use your details to reply about this card.
      </p>
    </form>
  );
}
