import { ExternalLink, Plus, Save, SearchCheck, Trash2, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { researchLinks } from '@shared/cardText';
import type { CardDetail, PriceCheck } from '@shared/types';
import { TrendChart } from '../../../components/charts';
import { Button, IconButton } from '../../../components/ui/Button';
import { Dialog, useConfirm } from '../../../components/ui/Dialog';
import { Alert, Badge, Spinner } from '../../../components/ui/Feedback';
import { Field, MoneyField, Select, TextField } from '../../../components/ui/Form';
import { Panel } from '../../../components/ui/Panel';
import { useToast } from '../../../components/ui/Toast';
import { api, errorMessage } from '../../../lib/api';
import { useFormat } from '../../../lib/format';
import { useAiStatus, useApplyCard, usePurchases } from '../../../lib/queries';
import { useSyncedForm } from '../../../lib/useSyncedForm';
import { useReportUnsaved } from './unsaved';

const CONFIDENCE_TONE = { low: 'serious', medium: 'warning', high: 'good' } as const;

/** A comp's price in its own currency; tolerates odd currency codes from older AI results. */
function compPrice(price: number, currency: string, locale: string, fallback: string): string {
  try {
    return price.toLocaleString(locale, { style: 'currency', currency: currency || fallback, currencyDisplay: 'code' });
  } catch {
    return `${price.toLocaleString(locale)} ${currency}`.trim();
  }
}

export function ValuePanel({ card, researching }: { card: CardDetail; researching: boolean }) {
  const fmt = useFormat();
  const ai = useAiStatus().data;
  const toast = useToast();
  const confirm = useConfirm();
  const applyCard = useApplyCard();
  const [manualOpen, setManualOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const latestAi: PriceCheck | undefined = card.price_checks.find((p) => p.source === 'ai');
  const history = useMemo(
    () =>
      card.price_checks
        .filter((p) => p.mid_cents !== null)
        .slice()
        .reverse()
        .map((p) => ({ date: p.created_at.slice(0, 10), value: p.mid_cents }) as Record<string, unknown>),
    [card.price_checks],
  );
  const links = researchLinks(card);

  async function research() {
    setBusy(true);
    try {
      applyCard(await api.research(card.id));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      id="value"
      title="Value & pricing"
      description="What it’s worth, what you’re asking, and what you paid."
      actions={
        <>
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setManualOpen(true)}>
            Add a price
          </Button>
          {ai?.configured && (
            <Button
              size="sm"
              variant="soft"
              icon={researching ? <Spinner className="size-4" /> : <SearchCheck className="size-4" />}
              onClick={research}
              disabled={busy || researching}
            >
              {researching ? 'Researching…' : 'Research with AI'}
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="text-sm text-muted">Estimated market value</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-4xl font-semibold tracking-tight">{fmt.money(card.market_value_cents)}</span>
            {card.market_confidence && (
              <Badge tone={CONFIDENCE_TONE[card.market_confidence]}>{card.market_confidence} confidence</Badge>
            )}
          </div>
          {card.market_low_cents !== null && card.market_high_cents !== null && (
            <div className="mt-1 text-sm text-ink-2">
              Range {fmt.money(card.market_low_cents)} – {fmt.money(card.market_high_cents)}
            </div>
          )}
          <div className="mt-1 text-xs text-muted">
            {card.market_checked_at ? `Checked ${fmt.relative(card.market_checked_at)}` : 'Not researched yet'}
            {card.quantity - card.quantity_sold > 1 && card.market_value_cents !== null
              ? ` · ${card.quantity - card.quantity_sold} copies ≈ ${fmt.money(card.market_value_cents * (card.quantity - card.quantity_sold))}`
              : ''}
          </div>
          {researching && (
            <Alert tone="info" className="mt-4" title="Researching recent sales…">
              The AI is searching eBay sold listings and price guides. This usually takes under a minute.
            </Alert>
          )}
        </div>
        <div className="lg:col-span-3">
          {history.length >= 2 ? (
            <>
              <div className="mb-1 text-xs text-muted">Value history</div>
              <TrendChart
                data={history}
                xKey="date"
                series={[{ key: 'value', label: 'Estimated value' }]}
                format={(v) => fmt.money(v)}
                compactFormat={(v) => fmt.money(v, { compact: true })}
                labelFormat={(l) => fmt.shortDate(l)}
                height={140}
              />
            </>
          ) : (
            <div className="flex h-full flex-col justify-center gap-2 rounded-xl bg-surface-2 p-4 text-sm text-ink-2">
              <div className="font-medium text-ink">Check prices yourself</div>
              <div className="flex flex-wrap gap-2">
                {links.map((l) => (
                  <a
                    key={l.label}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={l.hint}
                    className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ink hover:border-primary hover:text-primary"
                  >
                    {l.label} <ExternalLink className="size-3" />
                  </a>
                ))}
                {links.length === 0 && <span className="text-xs text-muted">Fill in the card details to get search links.</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      {latestAi && (
        <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Latest AI research</h3>
            <span className="text-xs text-muted">
              {fmt.dateTime(latestAi.created_at)}
              {latestAi.suggested_price_cents !== null && ` · suggested list price ${fmt.money(latestAi.suggested_price_cents)}`}
              {latestAi.quick_sale_cents !== null && ` · quick sale ${fmt.money(latestAi.quick_sale_cents)}`}
            </span>
          </div>
          {latestAi.summary && <p className="text-sm text-ink-2">{latestAi.summary}</p>}
          {latestAi.advice && (
            <p className="rounded-lg bg-primary-soft p-3 text-sm text-ink">
              <span className="font-medium">Selling tip: </span>
              {latestAi.advice}
            </p>
          )}
          {latestAi.comps.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Comparable</th>
                    <th className="py-2 pr-3 text-right font-medium">Price</th>
                    <th className="py-2 pr-3 font-medium">Grade</th>
                    <th className="py-2 pr-3 font-medium">Where</th>
                    <th className="py-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {latestAi.comps.map((c, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="max-w-72 py-2 pr-3">
                        {c.url ? (
                          <a href={c.url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                            {c.title || 'Listing'}
                          </a>
                        ) : (
                          c.title
                        )}
                      </td>
                      <td className="tabular py-2 pr-3 text-right whitespace-nowrap">
                        {compPrice(c.price, c.currency, fmt.locale, fmt.currency)}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-ink-2">{c.grade || '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-ink-2">
                        {c.venue}
                        {!c.sold && <Badge className="ml-1.5">asking</Badge>}
                      </td>
                      <td className="py-2 whitespace-nowrap text-ink-2">{c.date || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {latestAi.sources.length > 0 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer select-none">Pages the AI looked at ({latestAi.sources.length})</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {latestAi.sources.map((s) => (
                  <li key={s.url} className="truncate">
                    <a href={s.url} target="_blank" rel="noreferrer noopener" className="hover:text-primary hover:underline">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {history.length >= 2 && links.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <span className="text-xs text-muted">Check yourself:</span>
          {links.map((l) => (
            <a
              key={l.label}
              href={l.url}
              target="_blank"
              rel="noreferrer noopener"
              title={l.hint}
              className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium hover:border-primary hover:text-primary"
            >
              {l.label} <ExternalLink className="size-3" />
            </a>
          ))}
        </div>
      )}

      <PricingForm card={card} />

      {card.price_checks.length > 0 && (
        <details className="mt-5 border-t border-line pt-4">
          <summary className="cursor-pointer text-sm font-medium select-none">All price checks ({card.price_checks.length})</summary>
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {card.price_checks.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{fmt.money(p.mid_cents)}</span>
                  <span className="text-muted">
                    {' '}
                    · {p.source === 'ai' ? 'AI research' : 'Manual'} · {fmt.date(p.created_at)}
                  </span>
                  {p.source === 'manual' && p.summary && <div className="truncate text-xs text-muted">{p.summary}</div>}
                </div>
                <IconButton
                  label="Delete price check"
                  size="sm"
                  onClick={async () => {
                    if (!(await confirm({ title: 'Delete this price check?', confirmLabel: 'Delete', danger: true }))) return;
                    try {
                      await api.deletePriceCheck(p.id);
                      applyCard(await api.card(card.id));
                    } catch (err) {
                      toast.error(errorMessage(err));
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ManualPriceDialog card={card} open={manualOpen} onClose={() => setManualOpen(false)} />
    </Panel>
  );
}

function PricingForm({ card }: { card: CardDetail }) {
  const fmt = useFormat();
  const toast = useToast();
  const applyCard = useApplyCard();
  const purchases = usePurchases().data ?? [];
  const server = useMemo(
    () => ({
      asking_price_cents: card.asking_price_cents,
      floor_price_cents: card.floor_price_cents,
      cost_cents: card.cost_cents,
      acquired_date: card.acquired_date ?? '',
      acquired_from: card.acquired_from,
      purchase_id: card.purchase_id,
    }),
    [card],
  );
  const form = useSyncedForm(server);
  const { values, set, dirty, serverChanged } = form;
  const [busy, setBusy] = useState(false);

  async function save(): Promise<boolean> {
    setBusy(true);
    try {
      // Only send what was edited, so prices the AI filled in meanwhile aren't overwritten.
      const { acquired_date, ...changes } = form.changes();
      const detail = await api.updateCard(card.id, {
        ...changes,
        ...(acquired_date !== undefined && { acquired_date: acquired_date || null }),
      });
      applyCard(detail);
      form.markSaved({
        asking_price_cents: detail.asking_price_cents,
        floor_price_cents: detail.floor_price_cents,
        cost_cents: detail.cost_cents,
        acquired_date: detail.acquired_date ?? '',
        acquired_from: detail.acquired_from,
        purchase_id: detail.purchase_id,
      });
      toast.success('Prices saved');
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  useReportUnsaved('prices', 'your prices', dirty, save);

  const margin =
    values.asking_price_cents !== null && values.cost_cents !== null ? values.asking_price_cents - values.cost_cents : null;

  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Your prices</h3>
        {dirty && (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={form.undo}>
              Undo
            </Button>
            <Button size="sm" variant="primary" icon={<Save className="size-4" />} onClick={save} loading={busy}>
              Save
            </Button>
          </div>
        )}
      </div>
      {dirty && serverChanged && (
        <Alert
          tone="warning"
          className="mb-4"
          title="These prices were updated while you were editing"
          action={
            <Button size="sm" onClick={form.loadServer}>
              Load latest
            </Button>
          }
        >
          Saving will keep your edits for the fields you changed.
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MoneyField
          label="Asking price"
          hint={
            card.market_value_cents !== null && values.asking_price_cents !== null
              ? `${Math.round((values.asking_price_cents / Math.max(1, card.market_value_cents)) * 100)}% of market value`
              : 'Default price when you post it'
          }
          value={values.asking_price_cents}
          onChange={(v) => set('asking_price_cents', v)}
        />
        <MoneyField
          label="Lowest you’ll take"
          hint="Private — for handling offers"
          value={values.floor_price_cents}
          onChange={(v) => set('floor_price_cents', v)}
        />
        <MoneyField
          label="What you paid (each)"
          hint={margin !== null ? `${fmt.signedMoney(margin)} at asking price, before fees` : 'Used to work out profit'}
          value={values.cost_cents}
          onChange={(v) => set('cost_cents', v)}
        />
        <TextField label="Date acquired" type="date" value={values.acquired_date} onChange={(e) => set('acquired_date', e.target.value)} />
        <TextField
          label="Acquired from"
          value={values.acquired_from}
          onChange={(e) => set('acquired_from', e.target.value)}
          placeholder="Card show, garage sale, pack…"
        />
        <Field label="Part of purchase" htmlFor="f-purchase">
          <Select
            id="f-purchase"
            value={values.purchase_id ?? ''}
            onChange={(e) => set('purchase_id', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">—</option>
            {purchases.map((p) => (
              <option key={p.id} value={p.id}>
                {fmt.date(p.purchased_on)} · {p.description || p.source || `Purchase #${p.id}`}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );
}

function ManualPriceDialog({ card, open, onClose }: { card: CardDetail; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const applyCard = useApplyCard();
  const [mid, setMid] = useState<number | null>(null);
  const [low, setLow] = useState<number | null>(null);
  const [high, setHigh] = useState<number | null>(null);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (mid === null) return;
    setBusy(true);
    try {
      applyCard(await api.addPriceCheck(card.id, { mid_cents: mid, low_cents: low, high_cents: high, url, summary: note }));
      toast.success('Price saved');
      setMid(null);
      setLow(null);
      setHigh(null);
      setUrl('');
      setNote('');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a price by hand"
      description="From a Beckett guide, a sold listing you found, or a dealer’s offer."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={mid === null}>
            Save price
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MoneyField label="Market value" value={mid} onChange={setMid} autoFocus className="sm:col-span-3" />
        <MoneyField label="Low (optional)" value={low} onChange={setLow} />
        <MoneyField label="High (optional)" value={high} onChange={setHigh} />
        <div className="hidden sm:block" />
        <TextField label="Link (optional)" className="sm:col-span-3" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        <TextField label="Note" className="sm:col-span-3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Beckett guide, PSA 9 sold on eBay" />
      </div>
    </Dialog>
  );
}
