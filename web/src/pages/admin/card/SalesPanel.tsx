import { BadgeDollarSign, Trash2 } from 'lucide-react';
import { FULFILLMENT_LABELS, FULFILLMENT_STATUSES } from '@shared/constants';
import type { CardDetail, Sale } from '@shared/types';
import { PlatformDot } from '../../../components/cards';
import { Button, IconButton } from '../../../components/ui/Button';
import { useConfirm } from '../../../components/ui/Dialog';
import { EmptyState } from '../../../components/ui/Feedback';
import { Input, Select } from '../../../components/ui/Form';
import { Panel } from '../../../components/ui/Panel';
import { useToast } from '../../../components/ui/Toast';
import { api, errorMessage } from '../../../lib/api';
import { useFormat } from '../../../lib/format';
import { useApplyCard, usePlatforms } from '../../../lib/queries';

export function SalesPanel({ card, onSell }: { card: CardDetail; onSell: () => void }) {
  const remaining = card.quantity - card.quantity_sold;
  return (
    <Panel
      id="sales"
      title="Sales"
      description={
        card.quantity > 1 ? `${card.quantity_sold} of ${card.quantity} sold` : card.sales.length ? undefined : 'Not sold yet.'
      }
      actions={
        remaining > 0 && (
          <Button size="sm" variant="primary" icon={<BadgeDollarSign className="size-4" />} onClick={onSell}>
            Mark as sold
          </Button>
        )
      }
    >
      {card.sales.length === 0 ? (
        <EmptyState title="No sales recorded">
          When it sells, record the price, fees and shipping here — the profit and your reports update automatically.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {card.sales.map((s) => (
            <SaleRow key={s.id} sale={s} card={card} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SaleRow({ sale, card }: { sale: Sale; card: CardDetail }) {
  const fmt = useFormat();
  const platforms = usePlatforms().data ?? [];
  const toast = useToast();
  const confirm = useConfirm();
  const applyCard = useApplyCard();
  const platform = platforms.find((p) => p.id === sale.platform_id);

  async function update(patch: Record<string, unknown>) {
    try {
      await api.updateSale(sale.id, patch);
      applyCard(await api.card(card.id));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const rows: [string, number][] = [
    ['Sale price', sale.sale_price_cents],
    ['Shipping charged', sale.shipping_charged_cents],
    ['Postage', -sale.shipping_cost_cents],
    ['Fees', -sale.fees_cents],
    ['Other costs', -sale.other_costs_cents],
    ['Cost of card', -sale.cost_basis_cents],
  ];

  return (
    <li className="rounded-xl border border-line p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-medium">
            {fmt.date(sale.sold_on)}
            {platform && (
              <span className="inline-flex items-center gap-1 text-sm font-normal text-ink-2">
                <PlatformDot platform={platform} size="sm" /> {platform.name}
              </span>
            )}
            {sale.quantity > 1 && <span className="text-sm font-normal text-muted">× {sale.quantity}</span>}
          </div>
          <div className="text-sm text-ink-2">
            {sale.buyer_name || 'Buyer not recorded'}
            {sale.buyer_contact && ` · ${sale.buyer_contact}`}
            {sale.payment_method && ` · ${sale.payment_method}`}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-xl font-semibold ${sale.net_cents >= 0 ? 'text-good-text' : 'text-critical-text'}`}>
            {fmt.signedMoney(sale.net_cents)}
          </div>
          <div className="text-xs text-muted">profit</div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        {rows
          .filter(([, v]) => v !== 0)
          .map(([label, v]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-muted">{label}</dt>
              <dd className="tabular">{v < 0 ? `−${fmt.money(-v)}` : fmt.money(v)}</dd>
            </div>
          ))}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          aria-label="Delivery status"
          value={sale.fulfillment}
          onChange={(e) => update({ fulfillment: e.target.value })}
          className="min-h-9 w-auto py-1.5 text-sm"
        >
          {FULFILLMENT_STATUSES.map((f) => (
            <option key={f} value={f}>
              {FULFILLMENT_LABELS[f]}
            </option>
          ))}
        </Select>
        <Input
          aria-label="Tracking number"
          placeholder="Tracking #"
          defaultValue={sale.tracking_number}
          onBlur={(e) => e.target.value !== sale.tracking_number && update({ tracking_number: e.target.value })}
          className="min-h-9 w-44 py-1.5 text-sm"
        />
        <IconButton
          label="Delete sale"
          size="sm"
          className="ml-auto"
          onClick={async () => {
            const ok = await confirm({
              title: 'Delete this sale?',
              message: 'Use this if the sale fell through. The card goes back into inventory.',
              confirmLabel: 'Delete sale',
              danger: true,
            });
            if (!ok) return;
            try {
              await api.deleteSale(sale.id);
              applyCard(await api.card(card.id));
              toast.success('Sale deleted');
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      {sale.notes && <p className="mt-2 text-sm text-ink-2">{sale.notes}</p>}
    </li>
  );
}
