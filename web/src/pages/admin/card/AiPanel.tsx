import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, RefreshCw, SearchCheck, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CardDetail } from '@shared/types';
import { Button } from '../../../components/ui/Button';
import { Alert, Badge, Spinner } from '../../../components/ui/Feedback';
import { Menu } from '../../../components/ui/Menu';
import { useToast } from '../../../components/ui/Toast';
import { api, errorMessage } from '../../../lib/api';
import { useFormat } from '../../../lib/format';
import { useAiStatus, useApplyCard } from '../../../lib/queries';

export function activeJobs(card: CardDetail) {
  return card.jobs.filter((j) => j.status === 'queued' || j.status === 'running');
}

export function AiPanel({ card }: { card: CardDetail }) {
  const ai = useAiStatus().data;
  const fmt = useFormat();
  const toast = useToast();
  const applyCard = useApplyCard();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const active = activeJobs(card);
  const identifying = active.find((j) => j.kind === 'identify');
  const pricing = active.find((j) => j.kind === 'price');
  const lastIdentify = card.jobs.find((j) => j.kind === 'identify' && (j.status === 'done' || j.status === 'error'));
  const lastPrice = card.jobs.find((j) => j.kind === 'price' && (j.status === 'done' || j.status === 'error'));
  const failed = [lastIdentify, lastPrice].filter((j) => j && j.status === 'error' && !active.some((a) => a.kind === j.kind));

  // Toast when a job finishes while this page is open.
  const wasActive = useRef(active.length);
  useEffect(() => {
    if (wasActive.current > 0 && active.length === 0) {
      void qc.invalidateQueries({ queryKey: ['nav-counts'] });
      if (failed.length === 0) toast.success('AI finished — the card has been updated.');
    }
    wasActive.current = active.length;
  }, [active.length, failed.length, qc, toast]);

  async function start(fn: () => Promise<CardDetail>) {
    setBusy(true);
    try {
      applyCard(await fn());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (ai && !ai.configured) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted">
        <div className="mb-1 flex items-center gap-2 font-medium text-ink-2">
          <Sparkles className="size-4" /> AI is off
        </div>
        Add an <code className="text-xs">ANTHROPIC_API_KEY</code> to the server to identify cards from photos and research prices
        automatically.
      </div>
    );
  }

  const confidence = card.ai_confidence === null ? null : card.ai_confidence >= 0.85 ? 'high' : card.ai_confidence >= 0.6 ? 'medium' : 'low';

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" /> AI assistant
        </div>
        {confidence && (
          <Badge tone={confidence === 'high' ? 'good' : confidence === 'medium' ? 'warning' : 'serious'} title="How sure the AI was about the identification">
            {confidence} confidence
          </Badge>
        )}
      </div>

      {identifying && (
        <div className="flex items-center gap-2 text-sm text-ink-2">
          <Spinner className="size-4" />
          {identifying.status === 'queued' ? 'Waiting to identify…' : 'Reading the card photos…'}
        </div>
      )}
      {pricing && (
        <div className="flex items-center gap-2 text-sm text-ink-2">
          <Spinner className="size-4" />
          {pricing.status === 'queued' ? 'Waiting to research prices…' : 'Searching recent sales for prices…'}
        </div>
      )}
      {!identifying && card.ai_identified_at && (
        <p className="text-xs text-muted">Identified {fmt.relative(card.ai_identified_at)}.</p>
      )}
      {card.ai_notes && !identifying && (
        <p className="whitespace-pre-line rounded-lg bg-surface-2 p-2.5 text-xs text-ink-2">{card.ai_notes}</p>
      )}
      {failed.map((job) =>
        job ? (
          <Alert key={job.id} tone="critical" title={job.kind === 'identify' ? 'Identification failed' : 'Price research failed'}>
            {job.error}
          </Alert>
        ) : null,
      )}

      <div className="flex flex-wrap gap-2">
        <Menu
          align="left"
          trigger={(props) => (
            <Button size="sm" icon={<RefreshCw className="size-4" />} disabled={busy || Boolean(identifying) || card.images.length === 0} {...props}>
              {card.ai_identified_at ? 'Identify again' : 'Identify'}
              <ChevronDown className="size-3.5" />
            </Button>
          )}
          items={[
            {
              label: 'Fill in blank fields only',
              onSelect: () => start(() => api.identify(card.id, { overwrite: false, then_price: false })),
            },
            {
              label: 'Replace all details with the AI’s reading',
              onSelect: () => start(() => api.identify(card.id, { overwrite: true, then_price: false })),
            },
          ]}
        />
        <Button
          size="sm"
          variant="soft"
          icon={<SearchCheck className="size-4" />}
          disabled={busy || Boolean(pricing) || Boolean(identifying)}
          onClick={() => start(() => api.research(card.id))}
        >
          Research value
        </Button>
      </div>
    </div>
  );
}
