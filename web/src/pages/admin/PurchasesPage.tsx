import { useQueryClient } from '@tanstack/react-query';
import { Download, Package, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Purchase } from '@shared/types';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Alert, EmptyState, PageSpinner } from '../../components/ui/Feedback';
import { Field, MoneyField, Textarea, TextField } from '../../components/ui/Form';
import { PageHeader } from '../../components/ui/Panel';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { todayIso, useFormat } from '../../lib/format';
import { qk, usePurchases } from '../../lib/queries';

export default function PurchasesPage() {
  const purchases = usePurchases();
  const fmt = useFormat();
  const [creating, setCreating] = useState(false);
  const list = purchases.data ?? [];
  const total = list.reduce((a, p) => a + p.total_cost_cents, 0);

  return (
    <div>
      <PageHeader
        title="Purchases"
        description="What you paid for binders, lots and boxes — so every sale shows its real profit."
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={() => (window.location.href = '/api/export/purchases.csv')}>
              Export CSV
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New purchase
            </Button>
          </>
        }
      />
      {purchases.isLoading ? (
        <PageSpinner />
      ) : purchases.error ? (
        <Alert tone="critical">{errorMessage(purchases.error)}</Alert>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Package />}
          title="No purchases recorded"
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Record a purchase
            </Button>
          }
        >
          Bought a binder at a garage sale for $150? Record it, link its cards, and the cost is spread across them automatically.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-2 py-2.5 font-medium">What</th>
                <th className="px-2 py-2.5 font-medium">From</th>
                <th className="px-2 py-2.5 text-right font-medium">Cost</th>
                <th className="px-2 py-2.5 text-right font-medium">Cards</th>
                <th className="px-4 py-2.5 text-right font-medium">Cost spread</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p: Purchase) => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2.5 whitespace-nowrap">{fmt.date(p.purchased_on)}</td>
                  <td className="px-2 py-2.5">
                    <Link to={`/admin/purchases/${p.id}`} className="font-medium text-primary hover:underline">
                      {p.description || `Purchase #${p.id}`}
                    </Link>
                  </td>
                  <td className="px-2 py-2.5 text-ink-2">{p.source || '—'}</td>
                  <td className="tabular px-2 py-2.5 text-right font-medium">{fmt.money(p.total_cost_cents)}</td>
                  <td className="tabular px-2 py-2.5 text-right">{p.card_count}</td>
                  <td className="tabular px-4 py-2.5 text-right text-ink-2">
                    {p.card_count === 0 ? '—' : `${Math.round((p.allocated_cents / Math.max(1, p.total_cost_cents)) * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong font-semibold">
                <td className="px-4 py-2.5" colSpan={3}>
                  Total spent
                </td>
                <td className="tabular px-2 py-2.5 text-right">{fmt.money(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <PurchaseDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

export function PurchaseDialog({ open, onClose, purchase }: { open: boolean; onClose: () => void; purchase?: Purchase }) {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [date, setDate] = useState(purchase?.purchased_on ?? todayIso());
  const [description, setDescription] = useState(purchase?.description ?? '');
  const [source, setSource] = useState(purchase?.source ?? '');
  const [cost, setCost] = useState<number | null>(purchase?.total_cost_cents ?? null);
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (cost === null) return;
    setBusy(true);
    try {
      const body = { purchased_on: date, description, source, total_cost_cents: cost, notes };
      if (purchase) {
        await api.updatePurchase(purchase.id, body);
        void qc.invalidateQueries({ queryKey: ['purchase', purchase.id] });
      } else {
        const created = await api.createPurchase(body);
        navigate(`/admin/purchases/${created.id}`);
      }
      void qc.invalidateQueries({ queryKey: qk.purchases });
      toast.success(purchase ? 'Purchase updated' : 'Purchase recorded');
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
      title={purchase ? 'Edit purchase' : 'Record a purchase'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={cost === null}>
            {purchase ? 'Save' : 'Record purchase'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="What did you buy?" className="sm:col-span-2" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Two binders of 90s hockey" autoFocus />
        <MoneyField label="Total paid" value={cost} onChange={setCost} />
        <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <TextField label="Bought from" className="sm:col-span-2" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Garage sale, card show, Kijiji seller…" />
        <Field label="Notes" htmlFor="purchase-notes" className="sm:col-span-2">
          <Textarea id="purchase-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
