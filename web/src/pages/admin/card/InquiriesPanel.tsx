import { BadgeDollarSign, Mail, MessageSquarePlus, Phone, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { INQUIRY_STATUSES, INQUIRY_STATUS_LABELS, OPEN_INQUIRY_STATUSES, type InquiryStatus } from '@shared/constants';
import type { CardDetail, Inquiry, Platform } from '@shared/types';
import { PlatformDot } from '../../../components/cards';
import { Button, IconButton } from '../../../components/ui/Button';
import { useConfirm } from '../../../components/ui/Dialog';
import { Badge, EmptyState } from '../../../components/ui/Feedback';
import { Field, Input, MoneyField, Select, Textarea, TextField } from '../../../components/ui/Form';
import { Panel } from '../../../components/ui/Panel';
import { useToast } from '../../../components/ui/Toast';
import { api, errorMessage } from '../../../lib/api';
import { isoDaysAgo, useFormat } from '../../../lib/format';
import { useApplyCard, usePlatforms } from '../../../lib/queries';

export function contactLink(contact: string): { href: string; icon: React.ReactNode } | null {
  const c = contact.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return { href: `mailto:${c}`, icon: <Mail className="size-3.5" /> };
  const digits = c.replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length >= 7 && /^[\d\s()+.-]+$/.test(c)) return { href: `tel:${digits}`, icon: <Phone className="size-3.5" /> };
  return null;
}

export function inquiryTone(status: InquiryStatus) {
  return status === 'new' ? 'warning' : status === 'accepted' ? 'good' : status === 'declined' || status === 'closed' ? 'neutral' : 'primary';
}

export function InquiriesPanel({ card, onSell }: { card: CardDetail; onSell: (inquiry: Inquiry) => void }) {
  const platforms = usePlatforms().data ?? [];
  const [adding, setAdding] = useState(false);
  const open = card.inquiries.filter((i) => OPEN_INQUIRY_STATUSES.includes(i.status));
  return (
    <Panel
      id="inquiries"
      title="Inquiries & offers"
      description={open.length ? `${open.length} open` : 'Who asked about this card, and what they offered.'}
      actions={
        !adding && (
          <Button size="sm" icon={<MessageSquarePlus className="size-4" />} onClick={() => setAdding(true)}>
            Add inquiry
          </Button>
        )
      }
    >
      {adding && <InquiryForm card={card} platforms={platforms} onDone={() => setAdding(false)} />}
      {card.inquiries.length === 0 && !adding ? (
        <EmptyState title="No inquiries yet">When someone messages you about this card, note it here so you don’t lose track.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {card.inquiries.map((i) => (
            <InquiryRow key={i.id} inquiry={i} card={card} platforms={platforms} onSell={() => onSell(i)} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function InquiryRow({ inquiry, card, platforms, onSell }: { inquiry: Inquiry; card: CardDetail; platforms: Platform[]; onSell: () => void }) {
  const fmt = useFormat();
  const toast = useToast();
  const confirm = useConfirm();
  const applyCard = useApplyCard();
  const platform = platforms.find((p) => p.id === inquiry.platform_id);
  const link = contactLink(inquiry.contact);
  const offerPct =
    inquiry.offer_cents !== null && card.asking_price_cents ? Math.round((inquiry.offer_cents / card.asking_price_cents) * 100) : null;
  const overdue = inquiry.follow_up_on && inquiry.follow_up_on <= isoDaysAgo(0) && OPEN_INQUIRY_STATUSES.includes(inquiry.status);

  async function update(patch: Record<string, unknown>) {
    try {
      await api.updateInquiry(inquiry.id, patch);
      applyCard(await api.card(card.id));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <li className="rounded-xl border border-line p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{inquiry.name || 'Unknown buyer'}</span>
            {platform && (
              <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                <PlatformDot platform={platform} size="sm" /> {platform.name}
              </span>
            )}
            {inquiry.source === 'storefront' && <Badge tone="primary">from website</Badge>}
            <span className="text-xs text-muted">{fmt.relative(inquiry.created_at)}</span>
          </div>
          {inquiry.contact && (
            <div className="mt-0.5 text-sm">
              {link ? (
                <a href={link.href} className="inline-flex items-center gap-1 text-primary hover:underline">
                  {link.icon}
                  {inquiry.contact}
                </a>
              ) : (
                <span className="text-ink-2">{inquiry.contact}</span>
              )}
            </div>
          )}
        </div>
        {inquiry.offer_cents !== null && (
          <div className="text-right">
            <div className="text-lg font-semibold">{fmt.money(inquiry.offer_cents)}</div>
            <div className="text-xs text-muted">
              offer{offerPct !== null && ` · ${offerPct}% of asking`}
              {card.floor_price_cents !== null && inquiry.offer_cents < card.floor_price_cents && ' · below your floor'}
            </div>
          </div>
        )}
      </div>
      {inquiry.message && <p className="mt-2 text-sm whitespace-pre-line text-ink-2">{inquiry.message}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          aria-label="Status"
          value={inquiry.status}
          onChange={(e) => update({ status: e.target.value })}
          className="min-h-9 w-auto py-1.5 text-sm"
        >
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
            value={inquiry.follow_up_on ?? ''}
            onChange={(e) => update({ follow_up_on: e.target.value || null })}
            className={`min-h-9 w-auto py-1.5 text-sm ${overdue ? 'border-serious' : ''}`}
          />
        </label>
        {overdue && <Badge tone="serious">follow-up due</Badge>}
        <span className="ml-auto flex items-center gap-1">
          {card.status !== 'sold' && (
            <Button size="sm" variant="soft" icon={<BadgeDollarSign className="size-4" />} onClick={onSell}>
              Sold to them
            </Button>
          )}
          <IconButton
            label="Delete inquiry"
            size="sm"
            onClick={async () => {
              if (!(await confirm({ title: 'Delete this inquiry?', confirmLabel: 'Delete', danger: true }))) return;
              try {
                await api.deleteInquiry(inquiry.id);
                applyCard(await api.card(card.id));
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
}

function InquiryForm({ card, platforms, onDone }: { card: CardDetail; platforms: Platform[]; onDone: () => void }) {
  const toast = useToast();
  const applyCard = useApplyCard();
  const listedOn = card.listings.filter((l) => l.status === 'active').map((l) => l.platform_id);
  const [platformId, setPlatformId] = useState<number | null>(listedOn[0] ?? null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [offer, setOffer] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      applyCard(
        await api.addInquiry(card.id, {
          platform_id: platformId,
          name,
          contact,
          offer_cents: offer,
          message,
          follow_up_on: followUp || null,
        }),
      );
      toast.success('Inquiry saved');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-primary/40 bg-primary-soft/30 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Where they asked" htmlFor="inq-platform">
          <Select id="inq-platform" value={platformId ?? ''} onChange={(e) => setPlatformId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">In person / other</option>
            {platforms
              .filter((p) => p.active || listedOn.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        <MoneyField label="Offer (optional)" value={offer} onChange={setOffer} />
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name or username" autoFocus />
        <TextField label="Contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email, phone or profile link" />
        <Field label="What they said" htmlFor="inq-message" className="sm:col-span-2">
          <Textarea id="inq-message" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <TextField label="Follow up on (optional)" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={busy} disabled={!name && !contact && !message}>
          Save inquiry
        </Button>
      </div>
    </div>
  );
}
