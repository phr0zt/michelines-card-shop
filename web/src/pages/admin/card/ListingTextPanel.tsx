import clsx from 'clsx';
import { Check, Copy, Save, Undo2, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildListingTitle, listingTexts } from '@shared/cardText';
import type { CardDetail } from '@shared/types';
import { Button } from '../../../components/ui/Button';
import { Field, Input, SegmentedControl, Textarea } from '../../../components/ui/Form';
import { Panel } from '../../../components/ui/Panel';
import { useToast } from '../../../components/ui/Toast';
import { api, errorMessage } from '../../../lib/api';
import { useApplyCard, useSettings } from '../../../lib/queries';
import { useSyncedForm } from '../../../lib/useSyncedForm';
import { useReportUnsaved } from './unsaved';

export function useCopy() {
  const toast = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(key);
        window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
      } catch {
        toast.error('Couldn’t copy — select the text and copy it by hand.');
      }
    },
  };
}

export function ListingTextPanel({ card, locked }: { card: CardDetail; locked: boolean }) {
  const settings = useSettings().data;
  const toast = useToast();
  const applyCard = useApplyCard();
  const server = useMemo(() => ({ title: card.title, description: card.description }), [card.title, card.description]);
  const form = useSyncedForm(server);
  const [busy, setBusy] = useState(false);
  const { copied, copy } = useCopy();
  const [platform, setPlatform] = useState('eBay');

  const texts = useMemo(
    () =>
      listingTexts(
        { ...card, title: form.values.title, description: form.values.description },
        {
          currency: settings?.currency ?? 'CAD',
          locale: settings?.locale ?? 'en-CA',
          pickup_location: settings?.pickup_location ?? '',
          shipping_note: settings?.shipping_note ?? '',
          listing_footer: settings?.listing_footer ?? '',
        },
        card.asking_price_cents,
      ),
    [card, form.values.title, form.values.description, settings],
  );
  const current = texts.find((t) => t.platform === platform) ?? texts[0];

  async function save(): Promise<boolean> {
    setBusy(true);
    try {
      const detail = await api.updateCard(card.id, form.changes());
      applyCard(detail);
      form.markSaved({ title: detail.title, description: detail.description });
      toast.success('Listing text saved');
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  useReportUnsaved('listing-text', 'the listing text', form.dirty, save);

  return (
    <Panel
      id="listing-text"
      title="Listing text"
      description="Ready-to-paste titles and descriptions for each site."
      actions={
        form.dirty ? (
          <>
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={form.undo}>
              Undo
            </Button>
            <Button size="sm" variant="primary" icon={<Save className="size-4" />} onClick={save} loading={busy}>
              Save
            </Button>
          </>
        ) : null
      }
    >
      <div className="grid grid-cols-1 gap-4">
        {/* Locked while the AI identifies the card, since it writes these too. */}
        <fieldset disabled={locked} className="grid grid-cols-1 gap-4">
          <Field
            label="Title"
            htmlFor="lt-title"
            hint={
              <span className={clsx(form.values.title.length > 80 && 'text-critical-text')}>
                {form.values.title.length}/80 characters (eBay’s limit)
              </span>
            }
          >
            <div className="flex gap-2">
              <Input id="lt-title" value={form.values.title} onChange={(e) => form.set('title', e.target.value)} placeholder={buildListingTitle(card)} />
              <Button
                icon={<Wand2 className="size-4" />}
                onClick={() => form.set('title', buildListingTitle(card, 80))}
                title="Build a title from the card details"
              >
                <span className="hidden sm:inline">From details</span>
              </Button>
            </div>
          </Field>
          <Field label="Description" htmlFor="lt-desc">
            <Textarea
              id="lt-desc"
              rows={3}
              value={form.values.description}
              onChange={(e) => form.set('description', e.target.value)}
              placeholder="A few honest sentences about the card and its condition."
            />
          </Field>
        </fieldset>

        <div className="rounded-xl border border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <SegmentedControl
              size="sm"
              ariaLabel="Platform"
              value={platform}
              onChange={setPlatform}
              options={texts.map((t) => ({ value: t.platform, label: t.platform }))}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                icon={copied === `${platform}-title` ? <Check className="size-4" /> : <Copy className="size-4" />}
                onClick={() => copy(`${platform}-title`, current.title)}
              >
                Copy title
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={copied === `${platform}-body` ? <Check className="size-4" /> : <Copy className="size-4" />}
                onClick={() => copy(`${platform}-body`, current.body)}
              >
                Copy description
              </Button>
            </div>
          </div>
          <div className="p-3">
            <div className="mb-2 text-sm font-semibold">
              {current.title}
              {current.titleLimit && current.title.length > current.titleLimit && (
                <span className="ml-2 text-xs font-normal text-critical-text">over {current.titleLimit} characters</span>
              )}
            </div>
            <pre className="max-h-72 overflow-y-auto font-sans text-sm whitespace-pre-wrap text-ink-2">{current.body}</pre>
          </div>
        </div>
        {!card.asking_price_cents && (
          <p className="text-xs text-muted">Tip: set an asking price in “Value & pricing” and it’s added to the Kijiji and Facebook text.</p>
        )}
      </div>
    </Panel>
  );
}
