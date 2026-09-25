import { useEffect, useMemo, useState } from 'react';
import { FULFILLMENT_LABELS, FULFILLMENT_STATUSES, PAYMENT_METHODS, type FulfillmentStatus } from '@shared/constants';
import { estimateFeesCents, saleNetCents } from '@shared/money';
import type { CardDetail, Inquiry, Listing, Platform } from '@shared/types';
import { PlatformDot } from '../../../components/cards';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Alert } from '../../../components/ui/Feedback';
import { Checkbox, Field, MoneyField, Select, Textarea, TextField } from '../../../components/ui/Form';
import { useToast } from '../../../components/ui/Toast';
import { api, errorMessage } from '../../../lib/api';
import { todayIso, useFormat } from '../../../lib/format';
import { useApplyCard, usePlatforms } from '../../../lib/queries';

export interface SellPrefill {
  platform_id?: number | null;
  price_cents?: number | null;
  inquiry?: Inquiry | null;
}

export function SellDialog({
  card,
  open,
  onClose,
  prefill,
}: {
  card: CardDetail;
  open: boolean;
  onClose: () => void;
  prefill?: SellPrefill;
}) {
  const platforms = usePlatforms().data ?? [];
  const fmt = useFormat();
  const toast = useToast();
  const applyCard = useApplyCard();
  const activeListings = card.listings.filter((l) => l.status === 'active');
  const remaining = card.quantity - card.quantity_sold;

  const initialPlatform = prefill?.platform_id ?? prefill?.inquiry?.platform_id ?? (activeListings.length === 1 ? activeListings[0].platform_id : null);
  const listingPrice = activeListings.find((l) => l.platform_id === initialPlatform)?.price_cents ?? null;

  const [platformId, setPlatformId] = useState<number | null>(initialPlatform);
  const [soldOn, setSoldOn] = useState(todayIso());
  const [quantity, setQuantity] = useState(1);
  // Listing, offer and asking prices are per copy; the sale price is the total.
  const unitPrice = prefill?.price_cents ?? prefill?.inquiry?.offer_cents ?? listingPrice ?? card.asking_price_cents ?? null;
  const [price, setPrice] = useState<number | null>(unitPrice);
  const [priceTouched, setPriceTouched] = useState(false);

  function changeQuantity(value: number) {
    setQuantity(value);
    if (!priceTouched && unitPrice !== null) setPrice(unitPrice * value);
  }
  const [shippingCharged, setShippingCharged] = useState<number | null>(0);
  const [shippingCost, setShippingCost] = useState<number | null>(0);
  const [fees, setFees] = useState<number | null>(null);
  const [feesTouched, setFeesTouched] = useState(false);
  const [otherCosts, setOtherCosts] = useState<number | null>(0);
  const [buyerName, setBuyerName] = useState(prefill?.inquiry?.name ?? '');
  const [buyerContact, setBuyerContact] = useState(prefill?.inquiry?.contact ?? '');
  const [payment, setPayment] = useState('');
  const [fulfillment, setFulfillment] = useState<FulfillmentStatus>('pending');
  const [tracking, setTracking] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platform = platforms.find((p) => p.id === platformId) ?? null;
  const willSellOut = quantity >= remaining;
  const otherListings = activeListings.filter((l) => l.platform_id !== platformId);
  const [takeDown, setTakeDown] = useState<Record<number, boolean>>({});

  // Default every other listing to "taken down" each time the dialog opens.
  const listingIds = activeListings.map((l) => l.id).join(',');
  useEffect(() => {
    setTakeDown(Object.fromEntries(listingIds.split(',').filter(Boolean).map((id) => [Number(id), true])));
  }, [open, listingIds]);

  useEffect(() => {
    if (platform?.kind === 'in_person') setFulfillment('picked_up');
  }, [platform?.kind]);

  const estimatedFees = estimateFeesCents(platform, price ?? 0, shippingCharged ?? 0);
  const effectiveFees = feesTouched ? (fees ?? 0) : estimatedFees;
  const costBasis = (card.cost_cents ?? 0) * quantity;
  const net = useMemo(
    () =>
      saleNetCents({
        sale_price_cents: price ?? 0,
        shipping_charged_cents: shippingCharged ?? 0,
        shipping_cost_cents: shippingCost ?? 0,
        fees_cents: effectiveFees,
        other_costs_cents: otherCosts ?? 0,
        cost_basis_cents: costBasis,
      }),
    [price, shippingCharged, shippingCost, effectiveFees, otherCosts, costBasis],
  );

  async function submit() {
    if (price === null) {
      setError('Enter the sale price');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.addSale(card.id, {
        platform_id: platformId,
        inquiry_id: prefill?.inquiry?.id ?? null,
        quantity,
        sale_price_cents: price,
        shipping_charged_cents: shippingCharged ?? 0,
        shipping_cost_cents: shippingCost ?? 0,
        fees_cents: effectiveFees,
        other_costs_cents: otherCosts ?? 0,
        buyer_name: buyerName,
        buyer_contact: buyerContact,
        payment_method: payment,
        sold_on: soldOn,
        fulfillment,
        tracking_number: tracking,
        notes,
      });
      let detail = result.card;
      const toEnd = result.still_listed.filter((l) => takeDown[l.id]).map((l) => l.id);
      if (toEnd.length > 0) {
        await api.endListings(toEnd);
        detail = await api.card(card.id);
      }
      applyCard(detail);
      const leftUp = result.still_listed.length - toEnd.length;
      toast.success(
        leftUp > 0
          ? `Sale recorded. ${leftUp} listing${leftUp === 1 ? ' is' : 's are'} still up elsewhere — remember to take ${leftUp === 1 ? 'it' : 'them'} down.`
          : 'Sale recorded.',
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const platformOptions = [...platforms].sort((a, b) => Number(b.active) - Number(a.active) || a.sort_order - b.sort_order);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mark as sold"
      description={remaining > 1 ? `${remaining} copies left to sell` : undefined}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={price === null}>
            Record sale
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <Alert tone="critical">{error}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Sold on" htmlFor="sell-platform" className="sm:col-span-2">
            <Select
              id="sell-platform"
              value={platformId ?? ''}
              onChange={(e) => setPlatformId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Other / not recorded</option>
              {platformOptions.map((p: Platform) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {activeListings.some((l) => l.platform_id === p.id) ? ' (listed here)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <TextField label="Date" type="date" value={soldOn} onChange={(e) => setSoldOn(e.target.value)} max={todayIso()} />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {remaining > 1 && (
            <TextField
              label="Quantity"
              type="number"
              min={1}
              max={remaining}
              value={quantity}
              onChange={(e) => changeQuantity(Math.max(1, Math.min(remaining, Number(e.target.value) || 1)))}
            />
          )}
          <MoneyField
            label="Sale price"
            hint={quantity > 1 ? `Total for all ${quantity} copies` : undefined}
            value={price}
            onChange={(v) => {
              setPrice(v);
              setPriceTouched(true);
            }}
            autoFocus
          />
          <MoneyField label="Shipping charged" hint="What the buyer paid for shipping" value={shippingCharged} onChange={setShippingCharged} />
          <MoneyField label="Postage you paid" value={shippingCost} onChange={setShippingCost} />
          <MoneyField
            label="Platform fees"
            hint={feesTouched ? 'Entered by hand' : platform ? `Estimated for ${platform.name}` : 'No platform fees'}
            value={feesTouched ? fees : estimatedFees}
            onChange={(v) => {
              setFeesTouched(true);
              setFees(v);
            }}
          />
          <MoneyField label="Other costs" hint="Top loader, envelope, PayPal fee…" value={otherCosts} onChange={setOtherCosts} />
        </div>

        <div className="rounded-xl bg-surface-2 p-4 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-ink-2">Profit on this sale</span>
            <span className={`text-xl font-semibold ${net >= 0 ? 'text-good-text' : 'text-critical-text'}`}>{fmt.signedMoney(net)}</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Sale + shipping charged − postage − fees − other costs − what the card cost you (
            {card.cost_cents === null ? 'no cost recorded, counted as $0' : fmt.money(costBasis)}).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Buyer" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Name or username" />
          <TextField label="Buyer contact" value={buyerContact} onChange={(e) => setBuyerContact(e.target.value)} placeholder="Email, phone, profile…" />
          <Field label="Payment" htmlFor="sell-payment">
            <Select id="sell-payment" value={payment} onChange={(e) => setPayment(e.target.value)}>
              <option value="">—</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Delivery" htmlFor="sell-fulfillment">
            <Select id="sell-fulfillment" value={fulfillment} onChange={(e) => setFulfillment(e.target.value as FulfillmentStatus)}>
              {FULFILLMENT_STATUSES.map((f) => (
                <option key={f} value={f}>
                  {FULFILLMENT_LABELS[f]}
                </option>
              ))}
            </Select>
          </Field>
          {(fulfillment === 'shipped' || fulfillment === 'delivered') && (
            <TextField label="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          )}
        </div>
        <Field label="Notes" htmlFor="sell-notes">
          <Textarea id="sell-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {willSellOut && otherListings.length > 0 && (
          <div className="rounded-xl border border-warning/50 bg-warning-soft p-4">
            <div className="text-sm font-semibold">Also posted on other sites</div>
            <p className="mb-3 text-xs text-ink-2">Tick the ones you’ve taken down (or will now), so nobody else tries to buy it.</p>
            <div className="flex flex-col gap-2">
              {otherListings.map((l: Listing) => {
                const p = platforms.find((x) => x.id === l.platform_id);
                return (
                  <Checkbox
                    key={l.id}
                    checked={takeDown[l.id] ?? true}
                    onChange={(e) => setTakeDown((s) => ({ ...s, [l.id]: e.target.checked }))}
                    label={
                      <span className="inline-flex items-center gap-2">
                        {p && <PlatformDot platform={p} size="sm" />}
                        Mark as taken down from {p?.name ?? 'platform'}
                        {l.channel ? ` (${l.channel})` : ''}
                      </span>
                    }
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
