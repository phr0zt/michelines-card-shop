import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCheck, ClipboardCheck, RotateCcw, Sparkles, Trash2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { cardLabel } from '@shared/cardText';
import type { Card } from '@shared/types';
import { CardFlags, CardThumb, locationText } from '../../components/cards';
import { Button, ButtonLink } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Dialog';
import { Alert, Badge, EmptyState, PageSpinner, Spinner } from '../../components/ui/Feedback';
import { PageHeader } from '../../components/ui/Panel';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage, type AiJobWithCard } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { invalidateCardLists, qk, useAiStatus } from '../../lib/queries';

function aiState(card: Card, jobs: AiJobWithCard[]): { label: string; tone: 'neutral' | 'primary' | 'good' | 'warning' | 'critical'; busy?: boolean; error?: string } {
  const mine = jobs.filter((j) => j.card_id === card.id);
  const active = mine.find((j) => j.status === 'running') ?? mine.find((j) => j.status === 'queued');
  if (active) {
    const what = active.kind === 'identify' ? 'Identifying' : 'Looking up value';
    return { label: active.status === 'queued' ? `Waiting (${what.toLowerCase()})` : `${what}…`, tone: 'primary', busy: true };
  }
  const latest = mine[0];
  if (latest?.status === 'error') return { label: latest.kind === 'identify' ? 'Identification failed' : 'Value lookup failed', tone: 'critical', error: latest.error ?? undefined };
  if (card.ai_identified_at) {
    const c = card.ai_confidence ?? 0;
    return c >= 0.85 ? { label: 'AI: high confidence', tone: 'good' } : c >= 0.6 ? { label: 'AI: check details', tone: 'warning' } : { label: 'AI: unsure', tone: 'warning' };
  }
  return { label: 'Not identified', tone: 'neutral' };
}

export default function ReviewPage() {
  const fmt = useFormat();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const ai = useAiStatus();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const drafts = useQuery({
    queryKey: ['cards', { status: 'draft', review: true }],
    queryFn: () => api.cards({ status: 'draft', sort: 'created', dir: 'asc', page_size: 200 }),
    refetchInterval: 5000,
  });
  const jobs = useQuery({ queryKey: qk.aiJobs, queryFn: api.aiJobs, refetchInterval: 5000 });

  const cards = drafts.data?.cards ?? [];
  const jobList = jobs.data ?? [];
  const confident = useMemo(
    () => cards.filter((c) => (c.ai_confidence ?? 0) >= 0.85 && !c.active_job).map((c) => c.id),
    [cards],
  );
  const queued = jobList.filter((j) => j.status === 'queued').length;
  const running = jobList.filter((j) => j.status === 'running').length;
  const failed = jobList.filter((j) => j.status === 'error').length;

  async function bulk(ids: number[], action: string, value?: unknown, message = 'Done') {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await api.bulk(ids, action, value);
      invalidateCardLists(qc);
      toast.success(`${message}: ${res.ok} ${res.ok === 1 ? 'card' : 'cards'}`);
      setSelected(new Set());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function aiAction(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: qk.aiJobs });
      invalidateCardLists(qc);
      toast.success(message);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (drafts.isLoading) return <PageSpinner />;

  return (
    <div className="pb-10">
      <PageHeader
        title="Review new cards"
        description="Cards added from photos wait here until you’ve checked what the AI filled in."
        actions={
          confident.length > 0 && (
            <Button
              variant="primary"
              icon={<CheckCheck className="size-4" />}
              loading={busy}
              onClick={async () => {
                const ok = await confirm({
                  title: `Approve ${confident.length} high-confidence ${confident.length === 1 ? 'card' : 'cards'}?`,
                  message: 'These are the cards the AI was most sure about. You can still edit them later.',
                  confirmLabel: 'Approve',
                });
                if (ok) void bulk(confident, 'status', 'in_stock', 'Approved');
              }}
            >
              Approve {confident.length} confident
            </Button>
          )
        }
      />

      {ai.data?.configured && (queued > 0 || running > 0 || failed > 0) && (
        <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-card">
          <span className="inline-flex items-center gap-2 font-medium">
            <Sparkles className="size-4 text-primary" /> AI queue
          </span>
          {running > 0 && (
            <span className="inline-flex items-center gap-1.5 text-ink-2">
              <Spinner className="size-4" /> {running} working
            </span>
          )}
          {queued > 0 && <span className="text-ink-2">{queued} waiting</span>}
          {failed > 0 && <span className="text-critical-text">{failed} failed recently</span>}
          <span className="ml-auto flex gap-2">
            {failed > 0 && (
              <Button size="sm" icon={<RotateCcw className="size-4" />} onClick={() => aiAction(api.retryFailed, 'Retrying failed AI jobs')}>
                Retry failed
              </Button>
            )}
            {queued > 0 && (
              <Button size="sm" icon={<XCircle className="size-4" />} onClick={() => aiAction(api.cancelQueued, 'Stopped the waiting AI jobs')}>
                Stop waiting jobs
              </Button>
            )}
          </span>
        </div>
      )}

      {drafts.error && <Alert tone="critical">{errorMessage(drafts.error)}</Alert>}

      {cards.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title="Nothing to review"
          action={
            <ButtonLink to="/admin/cards/new" variant="primary">
              Add cards
            </ButtonLink>
          }
        >
          New cards show up here after you upload photos.
        </EmptyState>
      ) : (
        <>
          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-sm">
              <span className="font-medium">{selected.size} selected</span>
              <Button size="sm" variant="primary" onClick={() => bulk([...selected], 'status', 'in_stock', 'Approved')} loading={busy}>
                Approve
              </Button>
              <Button
                size="sm"
                icon={<Trash2 className="size-4" />}
                onClick={async () => {
                  if (await confirm({ title: `Delete ${selected.size} cards?`, confirmLabel: 'Delete', danger: true })) {
                    void bulk([...selected], 'delete', undefined, 'Deleted');
                  }
                }}
              >
                Delete
              </Button>
              <button type="button" className="ml-auto text-muted hover:text-ink" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          )}
          <ul className="flex flex-col gap-2">
            {cards.map((c) => {
              const state = aiState(c, jobList);
              const label = cardLabel(c);
              return (
                <li
                  key={c.id}
                  className={clsx(
                    'flex items-center gap-3 rounded-xl border bg-surface p-3 shadow-card',
                    selected.has(c.id) ? 'border-primary' : 'border-line',
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${label}`}
                    className="size-4 shrink-0 accent-[var(--primary)]"
                    checked={selected.has(c.id)}
                    onChange={() =>
                      setSelected((s) => {
                        const next = new Set(s);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                  />
                  <Link to={`/admin/cards/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <CardThumb front={c.front_image} back={c.back_image} alt={label} size="sm" busy={state.busy} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{label}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span className="font-mono">{c.sku}</span>
                        <CardFlags card={c} />
                        {locationText(c) && <span>· {locationText(c)}</span>}
                        <span>· added {fmt.relative(c.created_at)}</span>
                      </div>
                      {state.error && <div className="mt-1 truncate text-xs text-critical-text">{state.error}</div>}
                    </div>
                  </Link>
                  <div className="hidden text-right sm:block">
                    <Badge tone={state.tone}>{state.busy && <Spinner className="size-3" />}{state.label}</Badge>
                    <div className="mt-1 text-sm font-medium">{c.market_value_cents !== null ? fmt.money(c.market_value_cents) : ''}</div>
                  </div>
                  <ButtonLink to={`/admin/cards/${c.id}`} size="sm">
                    Review
                  </ButtonLink>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
