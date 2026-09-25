import {
  BadgeDollarSign,
  Camera,
  CircleDot,
  Globe,
  MessageSquare,
  PencilLine,
  Plus,
  Save,
  Sparkles,
  Store,
  Tag,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { CardDetail } from '@shared/types';
import { Button } from '../../../components/ui/Button';
import { Textarea } from '../../../components/ui/Form';
import { Panel } from '../../../components/ui/Panel';
import { useToast } from '../../../components/ui/Toast';
import { api, errorMessage } from '../../../lib/api';
import { useFormat } from '../../../lib/format';
import { useApplyCard } from '../../../lib/queries';
import { useSyncedForm } from '../../../lib/useSyncedForm';

const ICONS: Record<string, ReactNode> = {
  created: <Plus />,
  ai: <Sparkles />,
  value: <TrendingUp />,
  price: <Tag />,
  listed: <Store />,
  listing: <Store />,
  inquiry: <MessageSquare />,
  sold: <BadgeDollarSign />,
  status: <CircleDot />,
  storefront: <Globe />,
  photo: <Camera />,
  cost: <Wallet />,
  edited: <PencilLine />,
};

export function NotesPanel({ card }: { card: CardDetail }) {
  const fmt = useFormat();
  const toast = useToast();
  const applyCard = useApplyCard();
  const server = useMemo(() => ({ notes: card.notes }), [card.notes]);
  const form = useSyncedForm(server);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const activity = showAll ? card.activity : card.activity.slice(0, 12);

  async function save() {
    setBusy(true);
    try {
      const detail = await api.updateCard(card.id, { notes: form.values.notes });
      applyCard(detail);
      form.markSaved({ notes: detail.notes });
      toast.success('Notes saved');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel id="notes" title="Notes & history">
      <div className="flex flex-col gap-2">
        <Textarea
          aria-label="Private notes"
          rows={3}
          value={form.values.notes}
          onChange={(e) => form.set('notes', e.target.value)}
          placeholder="Private notes — who you promised it to, trade ideas, anything."
        />
        {form.dirty && (
          <div className="flex justify-end">
            <Button size="sm" variant="primary" icon={<Save className="size-4" />} onClick={save} loading={busy}>
              Save notes
            </Button>
          </div>
        )}
      </div>
      <ol className="mt-5 flex flex-col">
        {activity.map((a, i) => (
          <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < activity.length - 1 && <span className="absolute top-7 bottom-0 left-3.5 w-px bg-line" aria-hidden="true" />}
            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-2 [&_svg]:size-3.5">
              {ICONS[a.kind] ?? <CircleDot />}
            </span>
            <div className="min-w-0 pt-0.5">
              <div className="text-sm text-ink">{a.message}</div>
              <div className="text-xs text-muted" title={fmt.dateTime(a.created_at)}>
                {fmt.relative(a.created_at)}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {card.activity.length > 12 && (
        <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-3 text-sm text-primary hover:underline">
          {showAll ? 'Show less' : `Show all ${card.activity.length} events`}
        </button>
      )}
    </Panel>
  );
}
