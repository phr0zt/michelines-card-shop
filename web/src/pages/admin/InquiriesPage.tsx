import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BadgeDollarSign, Download, MessagesSquare, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { INQUIRY_STATUSES, INQUIRY_STATUS_LABELS, OPEN_INQUIRY_STATUSES } from '@shared/constants';
import type { CardDetail, Inquiry } from '@shared/types';
import { CardThumb, PlatformDot } from '../../components/cards';
import { Button, IconButton } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Dialog';
import { Alert, Badge, EmptyState, PageSpinner } from '../../components/ui/Feedback';
import { Input, SegmentedControl, Select } from '../../components/ui/Form';
import { PageHeader } from '../../components/ui/Panel';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { todayIso, useFormat } from '../../lib/format';
import { invalidateCardLists, useNavCounts, usePlatforms } from '../../lib/queries';
import { contactLink } from './card/InquiriesPanel';
import { SellDialog } from './card/SellDialog';

type Tab = 'open' | 'due' | 'new' | 'all' | 'closed';

export default function InquiriesPage() {
  const [tab, setTab] = useState<Tab>('open');
  const [q, setQ] = useState('');
  const counts = useNavCounts().data;
  const fmt = useFormat();
  const platforms = usePlatforms().data ?? [];
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [selling, setSelling] = useState<{ card: CardDetail; inquiry: Inquiry } | null>(null);

  const params = {
    status: tab === 'due' ? 'open' : tab === 'all' ? 'any' : tab === 'closed' ? 'done' : tab,
    due: tab === 'due' ? '1' : undefined,
    q: q || undefined,
  };
  const query = useQuery({
    queryKey: ['inquiries', params],
    queryFn: () => api.inquiries(params),
    placeholderData: keepPreviousData,
  });

  async function update(inquiry: Inquiry, patch: Record<string, unknown>) {
    try {
      await api.updateInquiry(inquiry.id, patch);
      invalidateCardLists(qc);
      void qc.invalidateQueries({ queryKey: ['card', inquiry.card_id] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function sell(inquiry: Inquiry) {
    try {
      setSelling({ card: await api.card(inquiry.card_id), inquiry });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const list = query.data?.inquiries ?? [];
  return (
    <div>
      <PageHeader
        title="Inquiries & offers"
        description="Everyone who asked about a card, wherever they found it."
        actions={
          <Button icon={<Download className="size-4" />} onClick={() => (window.location.href = '/api/export/inquiries.csv')}>
            Export CSV
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedControl
          ariaLabel="Which inquiries"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'due', label: 'Follow up', count: counts?.inquiries_due },
            { value: 'new', label: 'New', count: counts?.inquiries_new },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
        />
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, message or card…" className="pl-9" />
        </div>
      </div>

      {query.isLoading ? (
        <PageSpinner />
      ) : query.error ? (
        <Alert tone="critical">{errorMessage(query.error)}</Alert>
      ) : list.length === 0 ? (
        <EmptyState icon={<MessagesSquare />} title={tab === 'open' ? 'No open inquiries' : 'Nothing here'}>
          Record inquiries from a card’s page. Messages sent from your website show up here automatically.
        </EmptyState>
      ) : (
        <ul className={clsx('flex flex-col gap-3 transition-opacity', query.isPlaceholderData && 'opacity-60')}>
          {list.map((i) => {
            const platform = platforms.find((p) => p.id === i.platform_id);
            const link = contactLink(i.contact);
            const open = OPEN_INQUIRY_STATUSES.includes(i.status);
            const overdue = open && i.follow_up_on !== null && i.follow_up_on <= todayIso();
            return (
              <li key={i.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start gap-4">
                  {i.card && (
                    <Link to={`/admin/cards/${i.card_id}`} className="flex min-w-0 flex-1 basis-72 items-center gap-3">
                      <CardThumb front={i.card.thumb_url ? { urls: { sm: i.card.thumb_url, md: i.card.thumb_url } } : null} alt={i.card.label} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate font-medium hover:text-primary">{i.card.label}</div>
                        <div className="text-xs text-muted">
                          <span className="font-mono">{i.card.sku}</span>
                          {i.card.asking_price_cents !== null && ` · asking ${fmt.money(i.card.asking_price_cents)}`}
                        </div>
                      </div>
                    </Link>
                  )}
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{i.name || 'Unknown buyer'}</span>
                      {platform && (
                        <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                          <PlatformDot platform={platform} size="sm" /> {platform.name}
                        </span>
                      )}
                      {i.source === 'storefront' && <Badge tone="primary">website</Badge>}
                      <span className="text-xs text-muted">{fmt.relative(i.created_at)}</span>
                    </div>
                    {i.contact && (
                      <div className="text-sm">
                        {link ? (
                          <a href={link.href} className="inline-flex items-center gap-1 text-primary hover:underline">
                            {link.icon}
                            {i.contact}
                          </a>
                        ) : (
                          <span className="text-ink-2">{i.contact}</span>
                        )}
                      </div>
                    )}
                    {i.message && <p className="mt-1 text-sm whitespace-pre-line text-ink-2">{i.message}</p>}
                  </div>
                  {i.offer_cents !== null && (
                    <div className="text-right">
                      <div className="text-lg font-semibold">{fmt.money(i.offer_cents)}</div>
                      <div className="text-xs text-muted">offer</div>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <Select aria-label="Status" value={i.status} onChange={(e) => update(i, { status: e.target.value })} className="min-h-9 w-auto py-1.5 text-sm">
                    {INQUIRY_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {INQUIRY_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                  <label className="inline-flex items-center gap-2 text-sm text-ink-2">
                    Follow up
                    <Input
                      type="date"
                      value={i.follow_up_on ?? ''}
                      onChange={(e) => update(i, { follow_up_on: e.target.value || null })}
                      className="min-h-9 w-auto py-1.5 text-sm"
                    />
                  </label>
                  {overdue && <Badge tone="serious">due</Badge>}
                  <span className="ml-auto flex items-center gap-1">
                    {open && i.card?.status !== 'sold' && (
                      <Button size="sm" variant="soft" icon={<BadgeDollarSign className="size-4" />} onClick={() => sell(i)}>
                        Sold to them
                      </Button>
                    )}
                    <IconButton
                      label="Delete inquiry"
                      size="sm"
                      onClick={async () => {
                        if (!(await confirm({ title: 'Delete this inquiry?', confirmLabel: 'Delete', danger: true }))) return;
                        try {
                          await api.deleteInquiry(i.id);
                          invalidateCardLists(qc);
                        } catch (err) {
                          toast.error(errorMessage(err));
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {selling && <SellDialog card={selling.card} open onClose={() => setSelling(null)} prefill={{ inquiry: selling.inquiry }} />}
    </div>
  );
}
