import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeDollarSign,
  CheckCircle2,
  ChevronRight,
  Download,
  MoreHorizontal,
  Printer,
  Tag as TagIcon,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { cardLabel } from '@shared/cardText';
import { STATUS_LABELS, type CardStatus } from '@shared/constants';
import type { CardDetail, Inquiry, Listing } from '@shared/types';
import { CardFlags, locationText, StatusBadge } from '../../../components/cards';
import { Button, IconButton } from '../../../components/ui/Button';
import { useConfirm } from '../../../components/ui/Dialog';
import { Alert, PageSpinner } from '../../../components/ui/Feedback';
import { Select } from '../../../components/ui/Form';
import { Menu } from '../../../components/ui/Menu';
import { useToast } from '../../../components/ui/Toast';
import { api, ApiError, errorMessage } from '../../../lib/api';
import { useFormat } from '../../../lib/format';
import { invalidateCardLists, qk, useApplyCard } from '../../../lib/queries';
import { NotFound } from '../../NotFound';
import { activeJobs, AiPanel } from './AiPanel';
import { DetailsForm } from './DetailsForm';
import { InquiriesPanel } from './InquiriesPanel';
import { ListingsPanel } from './ListingsPanel';
import { ListingTextPanel } from './ListingTextPanel';
import { NotesPanel } from './NotesPanel';
import { PhotoPanel } from './PhotoPanel';
import { SalesPanel } from './SalesPanel';
import { SellDialog, type SellPrefill } from './SellDialog';
import { ValuePanel } from './ValuePanel';

export default function CardPage() {
  const id = Number(useParams().id);
  const query = useQuery({
    queryKey: qk.card(id),
    queryFn: () => api.card(id),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: (q) => (q.state.data && activeJobs(q.state.data).length > 0 ? 2500 : false),
  });

  if (query.isLoading) return <PageSpinner />;
  if (query.error instanceof ApiError && query.error.status === 404) return <NotFound admin />;
  if (query.error || !query.data) {
    return <Alert tone="critical" title="Couldn’t load this card">{errorMessage(query.error)}</Alert>;
  }
  return <CardView card={query.data} />;
}

const MANUAL_CHOICES: { value: CardStatus | 'auto'; label: string }[] = [
  { value: 'auto', label: 'For sale (listed / in inventory)' },
  { value: 'draft', label: STATUS_LABELS.draft },
  { value: 'pending', label: STATUS_LABELS.pending },
  { value: 'keeper', label: 'Keeper — not for sale' },
];

function CardView({ card }: { card: CardDetail }) {
  const fmt = useFormat();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const applyCard = useApplyCard();
  const qc = useQueryClient();
  const [sellOpen, setSellOpen] = useState(false);
  const [sellPrefill, setSellPrefill] = useState<SellPrefill | undefined>();
  const [approving, setApproving] = useState(false);

  const label = cardLabel(card);
  const jobs = activeJobs(card);
  const identifying = jobs.some((j) => j.kind === 'identify');
  const researching = jobs.some((j) => j.kind === 'price');
  const remaining = card.quantity - card.quantity_sold;

  function openSell(prefill?: SellPrefill) {
    setSellPrefill(prefill);
    setSellOpen(true);
  }

  async function setStatus(value: string) {
    try {
      const status = value === 'auto' ? 'in_stock' : value;
      applyCard(await api.updateCard(card.id, { status }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function approve(goNext: boolean) {
    setApproving(true);
    try {
      applyCard(await api.updateCard(card.id, { status: 'in_stock' }));
      toast.success('Approved — it’s in your inventory');
      if (goNext) {
        const next = await api.cards({ status: 'draft', sort: 'created', dir: 'asc', page_size: 1 });
        const nextCard = next.cards.find((c) => c.id !== card.id);
        navigate(nextCard ? `/admin/cards/${nextCard.id}` : '/admin/review');
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setApproving(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Delete this card?',
      message: 'Its photos, postings, inquiries and history are deleted too. This can’t be undone.',
      confirmLabel: 'Delete card',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteCard(card.id);
      qc.removeQueries({ queryKey: qk.card(card.id) });
      invalidateCardLists(qc);
      toast.success('Card deleted');
      navigate('/admin/cards');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${card.sku}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const location = locationText(card);
  const manualValue = ['draft', 'pending', 'keeper'].includes(card.status) ? card.status : 'auto';

  return (
    <div>
      <nav className="mb-3 flex items-center gap-1 text-sm text-muted" aria-label="Breadcrumb">
        <Link to="/admin/cards" className="hover:text-ink">
          Inventory
        </Link>
        <ChevronRight className="size-4" />
        <span className="font-mono text-ink-2">{card.sku}</span>
      </nav>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={card.status} />
            <CardFlags card={card} />
            {card.parallel && <span className="text-sm text-ink-2">{card.parallel}</span>}
          </div>
          <div className="mt-1.5 text-sm text-muted">
            {location ? `📍 ${location}` : 'No binder location yet'}
            {card.quantity > 1 && ` · ${remaining} of ${card.quantity} left`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {card.status !== 'sold' && (
            <Select aria-label="Status" value={manualValue} onChange={(e) => setStatus(e.target.value)} className="w-auto">
              {MANUAL_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
          {remaining > 0 && (
            <Button variant="primary" icon={<BadgeDollarSign className="size-4" />} onClick={() => openSell()}>
              Mark as sold
            </Button>
          )}
          <Menu
            trigger={(props) => (
              <IconButton label="More actions" {...props} className="border border-line-strong">
                <MoreHorizontal className="size-5" />
              </IconButton>
            )}
            items={[
              { label: 'Print index card', icon: <Printer />, onSelect: () => window.open(`/admin/print?ids=${card.id}&mode=sheet`, '_blank') },
              { label: 'Print sleeve label', icon: <TagIcon />, onSelect: () => window.open(`/admin/print?ids=${card.id}&mode=labels`, '_blank') },
              { label: 'Download as file (JSON)', icon: <Download />, onSelect: exportJson },
              'divider',
              { label: 'Delete card', icon: <Trash2 />, danger: true, onSelect: remove },
            ]}
          />
        </div>
      </div>

      {card.status === 'draft' && (
        <Alert
          tone="warning"
          className="mb-5"
          title={identifying ? 'The AI is identifying this card…' : 'Needs review'}
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => approve(false)} loading={approving} disabled={identifying}>
                Approve
              </Button>
              <Button size="sm" variant="primary" icon={<CheckCircle2 className="size-4" />} onClick={() => approve(true)} disabled={approving || identifying}>
                Approve & next
              </Button>
            </div>
          }
        >
          Check the photos and details below. Fix anything the AI got wrong, then approve it into your inventory.
        </Alert>
      )}

      {card.possible_duplicates.length > 0 && card.status !== 'sold' && (
        <Alert tone="info" className="mb-5" title="You may already have this card">
          Same player, year, set, number and parallel as{' '}
          {card.possible_duplicates.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <Link to={`/admin/cards/${d.id}`} className="font-mono font-medium text-primary hover:underline">
                {d.sku}
              </Link>
            </span>
          ))}
          . If it’s a second copy, you can delete this one and raise the quantity on the other — or keep both if you track copies separately.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-4">
          <div className="flex flex-col gap-4 lg:sticky lg:top-20">
            <PhotoPanel card={card} label={label} />
            <AiPanel card={card} />
            <SkuBox card={card} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-8">
          <DetailsForm card={card} locked={identifying} />
          <ValuePanel card={card} researching={researching} />
          <ListingsPanel card={card} onSellHere={(l: Listing) => openSell({ platform_id: l.platform_id, price_cents: l.price_cents })} />
          <ListingTextPanel card={card} />
          <InquiriesPanel card={card} onSell={(i: Inquiry) => openSell({ inquiry: i })} />
          <SalesPanel card={card} onSell={() => openSell()} />
          <NotesPanel card={card} />
          <p className="text-center text-xs text-muted">
            Added {fmt.date(card.created_at)} · last updated {fmt.relative(card.updated_at)}
          </p>
        </div>
      </div>

      {sellOpen && <SellDialog card={card} open={sellOpen} onClose={() => setSellOpen(false)} prefill={sellPrefill} />}
    </div>
  );
}

function SkuBox({ card }: { card: CardDetail }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-4 shadow-card">
      <img src={`/api/cards/${card.id}/qr.svg`} alt="QR code linking to this card" className="size-20 rounded bg-white p-1" />
      <div className="min-w-0">
        <div className="text-xs text-muted">Inventory code</div>
        <div className="font-mono text-lg font-semibold">{card.sku}</div>
        <a href={`/admin/print?ids=${card.id}&mode=labels`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
          Print a label for the sleeve
        </a>
      </div>
    </div>
  );
}
