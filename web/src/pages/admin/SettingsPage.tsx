import { useQueryClient } from '@tanstack/react-query';
import { Database, Download, Plus, RotateCcw, Save, Sparkles, Trash2, XCircle } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { AI_EFFORTS, AI_MODELS, PLATFORM_KINDS, PLATFORM_KIND_LABELS, type PlatformKind } from '@shared/constants';
import type { Platform, Settings } from '@shared/types';
import { Button, IconButton } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/Dialog';
import { Alert, Badge, PageSpinner } from '../../components/ui/Feedback';
import { Field, Input, MoneyInput, MoneyField, Select, Switch, Textarea, TextField } from '../../components/ui/Form';
import { PageHeader, Panel } from '../../components/ui/Panel';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { qk, useAiStatus, usePlatforms, useSettings } from '../../lib/queries';
import { useSyncedForm } from '../../lib/useSyncedForm';

type Form<T extends Record<string, unknown>> = ReturnType<typeof useSyncedForm<T>>;

function SettingsSection<K extends keyof Settings>({
  id,
  title,
  description,
  settings,
  keys,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  settings: Settings;
  keys: K[];
  children: (form: Form<Pick<Settings, K>>) => ReactNode;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const server = useMemo(() => Object.fromEntries(keys.map((k) => [k, settings[k]])) as Pick<Settings, K>, [settings, keys]);
  const form = useSyncedForm(server);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const next = await api.updateSettings(form.changes() as Partial<Settings>);
      qc.setQueryData(qk.settings, next);
      form.markSaved(Object.fromEntries(keys.map((k) => [k, next[k]])) as Pick<Settings, K>);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      id={id}
      title={title}
      description={description}
      actions={
        form.dirty && (
          <Button size="sm" variant="primary" icon={<Save className="size-4" />} onClick={save} loading={busy}>
            Save
          </Button>
        )
      }
    >
      {children(form)}
    </Panel>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  if (settings.isLoading) return <PageSpinner />;
  if (!settings.data) return <Alert tone="critical">{errorMessage(settings.error)}</Alert>;
  const s = settings.data;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" description="Your shop, the sites you sell on, and the AI assistant." />
      <nav className="mb-5 flex flex-wrap gap-2 text-sm">
        {[
          ['store', 'Store & website'],
          ['money', 'Money & codes'],
          ['listing', 'Listing text'],
          ['platforms', 'Platforms & fees'],
          ['ai', 'AI assistant'],
          ['alerts', 'Alerts'],
          ['data', 'Data'],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full bg-surface px-3 py-1 text-ink-2 ring-1 ring-line ring-inset hover:text-ink">
            {label}
          </a>
        ))}
      </nav>
      <div className="flex flex-col gap-5">
        <SettingsSection
          id="store"
          title="Store & website"
          description="Shown on your public shop page."
          settings={s}
          keys={['store_name', 'store_tagline', 'store_intro', 'contact_email', 'contact_phone', 'pickup_location', 'storefront_enabled', 'storefront_show_prices']}
        >
          {({ values, set }) => (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField label="Shop name" value={values.store_name} onChange={(e) => set('store_name', e.target.value)} />
              <TextField label="Tagline" value={values.store_tagline} onChange={(e) => set('store_tagline', e.target.value)} />
              <Field label="Welcome text" htmlFor="st-intro" className="sm:col-span-2">
                <Textarea id="st-intro" rows={2} value={values.store_intro} onChange={(e) => set('store_intro', e.target.value)} />
              </Field>
              <TextField label="Contact email" type="email" value={values.contact_email} onChange={(e) => set('contact_email', e.target.value)} />
              <TextField label="Contact phone" value={values.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} />
              <TextField
                label="Pickup area"
                className="sm:col-span-2"
                value={values.pickup_location}
                onChange={(e) => set('pickup_location', e.target.value)}
                placeholder="e.g. Sudbury, ON"
                hint="Used in the shop and in Kijiji/Facebook listing text."
              />
              <div className="flex flex-col gap-4 rounded-xl bg-surface-2 p-4 sm:col-span-2">
                <Switch
                  checked={values.storefront_enabled}
                  onChange={(v) => set('storefront_enabled', v)}
                  label="Public shop is open"
                  description="When off, visitors see a “closed” page. Your admin still works."
                />
                <Switch
                  checked={values.storefront_show_prices}
                  onChange={(v) => set('storefront_show_prices', v)}
                  label="Show asking prices on the shop"
                  description="When off, every card says “Ask for price”."
                />
              </div>
            </div>
          )}
        </SettingsSection>

        <SettingsSection id="money" title="Money & inventory codes" settings={s} keys={['currency', 'locale', 'usd_exchange_rate', 'sku_prefix']}>
          {({ values, set }) => (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField label="Currency" value={values.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} maxLength={3} hint="3-letter code, e.g. CAD or USD" />
              <TextField label="Number format" value={values.locale} onChange={(e) => set('locale', e.target.value)} hint="e.g. en-CA, fr-CA, en-US" />
              <TextField
                label={`${values.currency || 'CAD'} per 1 USD`}
                type="number"
                step="0.01"
                min={0.01}
                value={values.usd_exchange_rate}
                onChange={(e) => set('usd_exchange_rate', Number(e.target.value) || 1)}
                hint="Most price data is in US dollars. The AI converts with this rate — update it now and then."
              />
              <TextField
                label="Inventory code prefix"
                value={values.sku_prefix}
                onChange={(e) => set('sku_prefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                hint="New cards get codes like MC-00042. Existing codes don’t change."
              />
            </div>
          )}
        </SettingsSection>

        <SettingsSection id="listing" title="Listing text" description="Added to the ready-to-paste descriptions." settings={s} keys={['shipping_note', 'listing_footer']}>
          {({ values, set }) => (
            <div className="grid grid-cols-1 gap-4">
              <Field label="Shipping note" htmlFor="st-ship">
                <Textarea id="st-ship" rows={2} value={values.shipping_note} onChange={(e) => set('shipping_note', e.target.value)} />
              </Field>
              <Field label="Footer" htmlFor="st-footer" hint="e.g. “Check out my other listings — combined shipping available.”">
                <Textarea id="st-footer" rows={2} value={values.listing_footer} onChange={(e) => set('listing_footer', e.target.value)} />
              </Field>
            </div>
          )}
        </SettingsSection>

        <PlatformsSection />

        <AiSection settings={s} />

        <SettingsSection id="alerts" title="Dashboard alerts" settings={s} keys={['stale_listing_days', 'high_value_cents']}>
          {({ values, set }) => (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label="Flag listings older than (days)"
                type="number"
                min={1}
                value={values.stale_listing_days}
                onChange={(e) => set('stale_listing_days', Math.max(1, Number(e.target.value) || 30))}
                hint="Suggests a price drop or repost."
              />
              <MoneyField
                label="Flag unposted cards worth at least"
                value={values.high_value_cents}
                onChange={(v) => set('high_value_cents', v ?? 0)}
                hint="So valuable cards don’t sit in a binder."
              />
            </div>
          )}
        </SettingsSection>

        <Panel id="data" title="Data & backups" icon={<Database />}>
          <p className="mb-3 text-sm text-ink-2">
            Everything lives in one database file plus the photos folder on the server. Download a backup now and then — especially before
            big changes.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Database className="size-4" />} onClick={() => (window.location.href = '/api/export/backup.sqlite')}>
              Download database backup
            </Button>
            <Button icon={<Download className="size-4" />} onClick={() => (window.location.href = '/api/export/cards.csv')}>
              Cards (CSV)
            </Button>
            <Button icon={<Download className="size-4" />} onClick={() => (window.location.href = '/api/export/sales.csv')}>
              Sales (CSV)
            </Button>
          </div>
        </Panel>

        <Panel title="Password">
          <p className="text-sm text-ink-2">
            The admin password is the <code className="text-xs">ADMIN_PASSWORD</code> setting on the server. Change it there and restart; everyone
            is signed out.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function AiSection({ settings }: { settings: Settings }) {
  const ai = useAiStatus();
  const toast = useToast();
  const qc = useQueryClient();
  const models = AI_MODELS.some((m) => m.id === settings.ai_model) ? AI_MODELS : [...AI_MODELS, { id: settings.ai_model, label: settings.ai_model }];

  async function act(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      void qc.invalidateQueries({ queryKey: qk.aiStatus });
      void qc.invalidateQueries({ queryKey: ['nav-counts'] });
      toast.success(message);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <SettingsSection
      id="ai"
      title="AI assistant"
      description="Identifies cards from photos and researches market value using Claude."
      settings={settings}
      keys={['ai_model', 'ai_effort_identify', 'ai_effort_price', 'ai_auto_price', 'ai_max_searches']}
    >
      {({ values, set }) => (
        <div className="flex flex-col gap-4">
          {ai.data && !ai.data.configured ? (
            <Alert tone="warning" title="Not connected">
              Add an Anthropic API key as <code className="text-xs">ANTHROPIC_API_KEY</code> in the server’s environment, then restart. Get a key
              at console.anthropic.com. Price research also needs web search turned on for your Anthropic organization.
            </Alert>
          ) : ai.data ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-surface-2 p-3 text-sm">
              <Badge tone="good" icon={<Sparkles className="size-3.5" />}>
                Connected
              </Badge>
              <span className="text-ink-2">
                This month: <strong className="text-ink">{ai.data.month_jobs}</strong> AI tasks, about{' '}
                <strong className="text-ink">US${ai.data.month_cost_usd.toFixed(2)}</strong>
              </span>
              {(ai.data.queued > 0 || ai.data.running > 0) && (
                <span className="text-ink-2">
                  {ai.data.running} running · {ai.data.queued} waiting
                </span>
              )}
              <span className="ml-auto flex gap-2">
                {ai.data.failed_recent > 0 && (
                  <Button size="sm" icon={<RotateCcw className="size-4" />} onClick={() => act(api.retryFailed, 'Retrying failed tasks')}>
                    Retry {ai.data.failed_recent} failed
                  </Button>
                )}
                {ai.data.queued > 0 && (
                  <Button size="sm" icon={<XCircle className="size-4" />} onClick={() => act(api.cancelQueued, 'Cancelled waiting tasks')}>
                    Cancel waiting
                  </Button>
                )}
              </span>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Model" htmlFor="ai-model" hint="Opus is the most accurate at reading cards; Sonnet is faster and cheaper.">
              <Select id="ai-model" value={values.ai_model} onChange={(e) => set('ai_model', e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <TextField
              label="Web searches per price lookup"
              type="number"
              min={1}
              max={15}
              value={values.ai_max_searches}
              onChange={(e) => set('ai_max_searches', Math.min(15, Math.max(1, Number(e.target.value) || 5)))}
              hint="More searches can find better comps but cost a bit more (about 1¢ each)."
            />
            <Field label="Care when identifying" htmlFor="ai-eff-id" hint="Higher reads small print and variations more carefully.">
              <Select id="ai-eff-id" value={values.ai_effort_identify} onChange={(e) => set('ai_effort_identify', e.target.value as Settings['ai_effort_identify'])}>
                {AI_EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {e[0].toUpperCase() + e.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Care when researching prices" htmlFor="ai-eff-price">
              <Select id="ai-eff-price" value={values.ai_effort_price} onChange={(e) => set('ai_effort_price', e.target.value as Settings['ai_effort_price'])}>
                {AI_EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {e[0].toUpperCase() + e.slice(1)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Switch
            checked={values.ai_auto_price}
            onChange={(v) => set('ai_auto_price', v)}
            label="Look up market value automatically after identifying"
            description="Turn off to save money on big batches of commons — you can research any card later with one click."
          />
        </div>
      )}
    </SettingsSection>
  );
}

function PlatformsSection() {
  const platforms = usePlatforms().data ?? [];
  const [adding, setAdding] = useState(false);
  return (
    <Panel
      id="platforms"
      title="Platforms & fees"
      description="The places you post cards. Fees are used to estimate profit — check them against each site’s current rates."
      actions={
        !adding && (
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            Add platform
          </Button>
        )
      }
      bodyClassName="p-0 sm:p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-medium">On</th>
              <th className="px-2 py-2.5 font-medium">Name</th>
              <th className="px-2 py-2.5 font-medium">Type</th>
              <th className="px-2 py-2.5 font-medium">Fee %</th>
              <th className="px-2 py-2.5 font-medium">+ fixed</th>
              <th className="px-2 py-2.5 font-medium">Colour</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {platforms.map((p) => (
              <PlatformRow key={p.id} platform={p} />
            ))}
            {adding && <PlatformRow onDone={() => setAdding(false)} />}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function PlatformRow({ platform, onDone }: { platform?: Platform; onDone?: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const fmt = useFormat();
  const server = useMemo(
    () => ({
      name: platform?.name ?? '',
      kind: (platform?.kind ?? 'marketplace') as PlatformKind,
      fee_percent: platform?.fee_percent ?? 0,
      fee_fixed_cents: platform?.fee_fixed_cents ?? 0,
      color: platform?.color ?? '#64748b',
      active: platform?.active ?? true,
    }),
    [platform],
  );
  const form = useSyncedForm(server);
  const { values, set } = form;
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.platforms });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  async function save(patch?: Partial<typeof values>) {
    setBusy(true);
    try {
      if (platform) {
        const updated = await api.updatePlatform(platform.id, patch ?? form.changes());
        form.markSaved({
          name: updated.name,
          kind: updated.kind,
          fee_percent: updated.fee_percent,
          fee_fixed_cents: updated.fee_fixed_cents,
          color: updated.color,
          active: updated.active,
        });
      } else {
        await api.createPlatform(values);
        onDone?.();
      }
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-2">
        <input
          type="checkbox"
          aria-label={`Use ${values.name || 'platform'}`}
          checked={values.active}
          className="size-4 accent-[var(--primary)]"
          onChange={(e) => {
            set('active', e.target.checked);
            if (platform) void save({ active: e.target.checked });
          }}
        />
      </td>
      <td className="px-2 py-2">
        <Input value={values.name} onChange={(e) => set('name', e.target.value)} aria-label="Name" placeholder="e.g. Local card show" className="min-h-9 min-w-40 py-1.5" autoFocus={!platform} />
      </td>
      <td className="px-2 py-2">
        <Select value={values.kind} onChange={(e) => set('kind', e.target.value as PlatformKind)} aria-label="Type" className="min-h-9 w-auto py-1.5">
          {PLATFORM_KINDS.map((k) => (
            <option key={k} value={k}>
              {PLATFORM_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-2 py-2">
        <Input
          type="number"
          step="0.01"
          min={0}
          max={100}
          value={values.fee_percent}
          onChange={(e) => set('fee_percent', Number(e.target.value) || 0)}
          aria-label="Fee percent"
          className="min-h-9 w-20 py-1.5"
        />
      </td>
      <td className="px-2 py-2">
        <MoneyInput value={values.fee_fixed_cents} onChange={(v) => set('fee_fixed_cents', v ?? 0)} ariaLabel="Fixed fee" className="w-24" />
      </td>
      <td className="px-2 py-2">
        <input type="color" value={values.color} onChange={(e) => set('color', e.target.value)} aria-label="Colour" className="h-9 w-12 cursor-pointer rounded-md border border-line-strong bg-surface p-1" />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center justify-end gap-1">
          {(form.dirty || !platform) && (
            <Button size="sm" variant="primary" onClick={() => save()} loading={busy} disabled={!values.name.trim()}>
              {platform ? 'Save' : 'Add'}
            </Button>
          )}
          {!platform && (
            <Button size="sm" onClick={onDone}>
              Cancel
            </Button>
          )}
          {platform && !form.dirty && (
            <IconButton
              label="Delete platform"
              size="sm"
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete ${platform.name}?`,
                  message: 'Only possible if no card was ever posted there. Otherwise, untick it to hide it.',
                  confirmLabel: 'Delete',
                  danger: true,
                });
                if (!ok) return;
                try {
                  await api.deletePlatform(platform.id);
                  refresh();
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          )}
        </div>
        {values.fee_percent > 0 && (
          <div className="mt-1 text-right text-[11px] whitespace-nowrap text-muted">
            on {fmt.money(5000)}: {fmt.money(Math.round(5000 * (values.fee_percent / 100)) + values.fee_fixed_cents)}
          </div>
        )}
      </td>
    </tr>
  );
}
