import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeftRight,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Images,
  ImagePlus,
  PencilLine,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { CATEGORIES } from '@shared/constants';
import { Button, ButtonLink, IconButton } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { Checkbox, Field, Select, SegmentedControl, TextField } from '../../components/ui/Form';
import { PageHeader, Panel } from '../../components/ui/Panel';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { isImageFile, prepareImage, sortByName } from '../../lib/images';
import { invalidateCardLists, useAiStatus, useFacets, usePurchases, useSettings } from '../../lib/queries';
import { loadPref, savePref } from '../../lib/storage';

interface AddOptions {
  category: string;
  binder: string;
  page: string;
  slot: string;
  perPage: number;
  identify: boolean;
  research: boolean;
  isPublic: boolean;
  purchaseId: number | null;
}

const DEFAULT_OPTIONS: AddOptions = {
  category: 'Hockey',
  binder: '',
  page: '',
  slot: '',
  perPage: 9,
  identify: true,
  research: true,
  isPublic: false,
  purchaseId: null,
};

function useObjectUrl(file: File | null): string | null {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

/** Location for the n-th card when walking through a binder page by page. */
function locationFor(opts: AddOptions, index: number): { location_binder: string; location_page: string; location_slot: string } {
  const startPage = Number(opts.page);
  const startSlot = Number(opts.slot) || 1;
  if (!opts.binder && !opts.page) return { location_binder: '', location_page: '', location_slot: '' };
  if (!Number.isFinite(startPage) || startPage <= 0) {
    return { location_binder: opts.binder, location_page: opts.page, location_slot: opts.slot };
  }
  const per = Math.max(1, opts.perPage);
  const slotIndex = startSlot - 1 + index;
  return {
    location_binder: opts.binder,
    location_page: String(startPage + Math.floor(slotIndex / per)),
    location_slot: String((slotIndex % per) + 1),
  };
}

function buildForm(front: Blob, back: Blob | null, opts: AddOptions, index: number, aiOn: boolean): FormData {
  const form = new FormData();
  form.append('front', front, 'front.jpg');
  if (back) form.append('back', back, 'back.jpg');
  form.append(
    'data',
    JSON.stringify({
      category: opts.category,
      ...locationFor(opts, index),
      is_public: opts.isPublic,
      purchase_id: opts.purchaseId,
    }),
  );
  if (aiOn && opts.identify) {
    form.append('identify', '1');
    form.append('research', opts.research ? '1' : '0');
    form.append('category_hint', opts.category);
  }
  return form;
}

export default function AddCardsPage() {
  const [mode, setMode] = useState<'single' | 'batch'>(() => loadPref('add-mode', 'single'));
  const [opts, setOpts] = useState<AddOptions>(() => ({ ...DEFAULT_OPTIONS, ...loadPref<Partial<AddOptions>>('add-options', {}) }));
  const ai = useAiStatus().data;
  const settings = useSettings().data;
  const aiOn = Boolean(ai?.configured);

  useEffect(() => {
    if (settings && loadPref<Partial<AddOptions> | null>('add-options', null) === null) {
      setOpts((o) => ({ ...o, research: settings.ai_auto_price }));
    }
  }, [settings]);

  const setOpt = <K extends keyof AddOptions>(key: K, value: AddOptions[K]) =>
    setOpts((o) => {
      const next = { ...o, [key]: value };
      savePref('add-options', { ...next, page: '', slot: '', purchaseId: null });
      return next;
    });

  return (
    <div>
      <PageHeader
        title="Add cards"
        description="Photograph the front and back. The AI reads the card, fills in the details and looks up what it’s worth."
        actions={
          <SegmentedControl
            ariaLabel="How many cards"
            value={mode}
            onChange={(m) => {
              setMode(m);
              savePref('add-mode', m);
            }}
            options={[
              { value: 'single', label: 'One card' },
              { value: 'batch', label: 'Many cards' },
            ]}
          />
        }
      />
      {ai && !ai.configured && (
        <Alert tone="info" className="mb-5" title="AI is turned off">
          Cards are still saved with their photos — you’ll fill in the details yourself. Add <code className="text-xs">ANTHROPIC_API_KEY</code> on the
          server to have the AI do it.
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">{mode === 'single' ? <SingleCard opts={opts} aiOn={aiOn} /> : <Batch opts={opts} aiOn={aiOn} />}</div>
        <OptionsPanel opts={opts} setOpt={setOpt} aiOn={aiOn} batch={mode === 'batch'} />
      </div>
    </div>
  );
}

function OptionsPanel({
  opts,
  setOpt,
  aiOn,
  batch,
}: {
  opts: AddOptions;
  setOpt: <K extends keyof AddOptions>(key: K, value: AddOptions[K]) => void;
  aiOn: boolean;
  batch: boolean;
}) {
  const facets = useFacets().data;
  const purchases = usePurchases().data ?? [];
  return (
    <Panel title="Details for these cards" className="h-fit">
      <div className="flex flex-col gap-4">
        <Field label="Category" htmlFor="add-category" hint="A hint for the AI — it corrects this if the card says otherwise.">
          <Select id="add-category" value={opts.category} onChange={(e) => setOpt('category', e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <TextField
            label="Binder / box"
            className="col-span-3"
            value={opts.binder}
            onChange={(e) => setOpt('binder', e.target.value)}
            list="add-binders"
            placeholder="Where they’re kept"
          />
          <datalist id="add-binders">{facets?.binders.map((b) => <option key={b.name} value={b.name} />)}</datalist>
          <TextField label={batch ? 'Start page' : 'Page'} inputMode="numeric" value={opts.page} onChange={(e) => setOpt('page', e.target.value)} />
          <TextField label={batch ? 'Start slot' : 'Slot'} inputMode="numeric" value={opts.slot} onChange={(e) => setOpt('slot', e.target.value)} />
          {batch && (
            <TextField
              label="Per page"
              type="number"
              min={1}
              max={50}
              value={opts.perPage}
              onChange={(e) => setOpt('perPage', Math.max(1, Number(e.target.value) || 9))}
            />
          )}
        </div>
        {batch && opts.binder && opts.page && (
          <p className="-mt-2 text-xs text-muted">
            Slots count up 1–{opts.perPage}, then the page goes up — photograph the binder in order.
          </p>
        )}
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <Checkbox
            label={
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="size-4 text-primary" /> Identify with AI
              </span>
            }
            description="Reads player, year, set, card #, condition…"
            checked={aiOn && opts.identify}
            disabled={!aiOn}
            onChange={(e) => setOpt('identify', e.target.checked)}
          />
          <Checkbox
            label="Also look up market value"
            description="Searches recent sales. Slower, and costs a little more per card."
            checked={aiOn && opts.identify && opts.research}
            disabled={!aiOn || !opts.identify}
            onChange={(e) => setOpt('research', e.target.checked)}
          />
          <Checkbox
            label="Show on the website once approved"
            checked={opts.isPublic}
            onChange={(e) => setOpt('isPublic', e.target.checked)}
          />
        </div>
        {purchases.length > 0 && (
          <Field label="Part of a purchase" htmlFor="add-purchase" hint="Links the cost of a lot you bought.">
            <Select id="add-purchase" value={opts.purchaseId ?? ''} onChange={(e) => setOpt('purchaseId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {purchases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.description || p.source || `Purchase #${p.id}`}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Panel>
  );
}

function PhotoSlot({ label, file, onFile }: { label: string; file: File | null; onFile: (f: File | null) => void }) {
  const url = useObjectUrl(file);
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const f = [...e.dataTransfer.files].find(isImageFile);
    if (f) onFile(f);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium text-ink-2">{label}</div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={clsx(
          'relative flex aspect-[5/7] items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors',
          over ? 'border-primary bg-primary-soft' : file ? 'border-transparent bg-surface-3' : 'border-line-strong bg-surface-2 hover:border-primary',
        )}
      >
        {url ? (
          <>
            <img src={url} alt={label} className="size-full object-contain" />
            <div className="absolute inset-x-2 bottom-2 flex justify-center gap-2">
              <Button size="sm" onClick={() => pickRef.current?.click()}>
                Change
              </Button>
              <Button size="sm" onClick={() => onFile(null)} aria-label={`Remove ${label}`}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </>
        ) : (
          <button type="button" onClick={() => pickRef.current?.click()} className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-muted">
            <ImagePlus className="size-9" />
            <span className="text-sm font-medium text-ink-2">Choose or drop a photo</span>
            <span className="text-xs">JPEG from your phone or scanner</span>
          </button>
        )}
      </div>
      {!file && (
        <Button size="sm" icon={<Camera className="size-4" />} onClick={() => cameraRef.current?.click()} className="sm:hidden">
          Take photo
        </Button>
      )}
      <input
        ref={pickRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function SingleCard({ opts, aiOn }: { opts: AddOptions; aiOn: boolean }) {
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [combined, setCombined] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  async function submit() {
    if (!front) return;
    setBusy(true);
    try {
      const [f, b] = await Promise.all([prepareImage(front), back && !combined ? prepareImage(back) : Promise.resolve(null)]);
      const card = await api.createCard(buildForm(f, b, opts, 0, aiOn));
      invalidateCardLists(qc);
      qc.setQueryData(['card', card.id], card);
      navigate(`/admin/cards/${card.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  async function manual() {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('data', JSON.stringify({ category: opts.category, ...locationFor(opts, 0), is_public: opts.isPublic, purchase_id: opts.purchaseId }));
      const card = await api.createCard(form);
      invalidateCardLists(qc);
      navigate(`/admin/cards/${card.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className={clsx('grid gap-4', combined ? 'mx-auto max-w-xs grid-cols-1' : 'grid-cols-2')}>
        <PhotoSlot label={combined ? 'Photo (both sides)' : 'Front'} file={front} onFile={setFront} />
        {!combined && <PhotoSlot label="Back" file={back} onFile={setBack} />}
      </div>
      <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Checkbox
          label="Front and back are in one photo"
          description="e.g. a scan with both sides side by side"
          checked={combined}
          onChange={(e) => setCombined(e.target.checked)}
        />
        <Button variant="primary" size="lg" icon={<Upload className="size-5" />} onClick={submit} loading={busy} disabled={!front}>
          {aiOn && opts.identify ? 'Add & identify' : 'Add card'}
        </Button>
      </div>
      <p className="mt-4 text-sm text-muted">
        No photo handy?{' '}
        <button type="button" className="font-medium text-primary hover:underline" onClick={manual} disabled={busy}>
          <PencilLine className="mr-1 inline size-4" />
          Type the details in by hand
        </button>
      </p>
    </Panel>
  );
}

interface BatchItem {
  id: string;
  front: File;
  back: File | null;
  status: 'waiting' | 'uploading' | 'done' | 'error';
  error?: string;
  cardId?: number;
}

let itemSeq = 0;

function Thumb({ file, label }: { file: File | null; label: string }) {
  const url = useObjectUrl(file);
  return (
    <div className="relative aspect-[5/7] w-full overflow-hidden rounded-md bg-surface-3">
      {url ? <img src={url} alt={label} loading="lazy" className="size-full object-contain" /> : <span className="flex size-full items-center justify-center text-[10px] text-muted">no back</span>}
      <span className="absolute inset-x-0 bottom-0 bg-black/55 text-center text-[10px] font-medium text-white">{label}</span>
    </div>
  );
}

function Batch({ opts, aiOn }: { opts: AddOptions; aiOn: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [pairing, setPairing] = useState<'pairs' | 'single'>(() => loadPref('batch-pairing', 'pairs'));
  const [byName, setByName] = useState(true);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const toast = useToast();

  // Re-pair whenever the photos or pairing rule change (those controls are hidden once uploading starts).
  useEffect(() => {
    const ordered = byName ? sortByName(files) : files;
    const next: BatchItem[] = [];
    if (pairing === 'pairs') {
      for (let i = 0; i < ordered.length; i += 2) {
        next.push({ id: `b${++itemSeq}`, front: ordered[i], back: ordered[i + 1] ?? null, status: 'waiting' });
      }
    } else {
      for (const f of ordered) next.push({ id: `b${++itemSeq}`, front: f, back: null, status: 'waiting' });
    }
    setItems(next);
  }, [files, pairing, byName]);

  const started = items.some((i) => i.status !== 'waiting');
  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const finished = started && !running && items.every((i) => i.status === 'done' || i.status === 'error');

  function addFiles(list: FileList | File[]) {
    const images = [...list].filter(isImageFile);
    if (images.length === 0) return;
    setFiles((f) => [...f, ...images]);
  }

  async function uploadAll() {
    setRunning(true);
    const queue = items.map((item, index) => ({ item, index })).filter(({ item }) => item.status !== 'done');
    const setStatus = (id: string, patch: Partial<BatchItem>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { item, index } = next;
        setStatus(item.id, { status: 'uploading', error: undefined });
        try {
          const [f, b] = await Promise.all([prepareImage(item.front), item.back ? prepareImage(item.back) : Promise.resolve(null)]);
          const card = await api.createCard(buildForm(f, b, opts, index, aiOn));
          setStatus(item.id, { status: 'done', cardId: card.id });
        } catch (err) {
          setStatus(item.id, { status: 'error', error: errorMessage(err) });
        }
      }
    };
    await Promise.all([worker(), worker()]);
    setRunning(false);
    invalidateCardLists(qc);
    toast.success('Upload finished');
  }

  function reset() {
    setFiles([]);
    setItems([]);
  }

  const swap = (id: string) =>
    setItems((list) => list.map((i) => (i.id === id && i.back ? { ...i, front: i.back, back: i.front } : i)));
  const remove = (id: string) => setItems((list) => list.filter((i) => i.id !== id));

  return (
    <Panel>
      {!started && (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              addFiles(e.dataTransfer.files);
            }}
            className={clsx(
              'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              over ? 'border-primary bg-primary-soft' : 'border-line-strong bg-surface-2',
            )}
          >
            <Images className="size-10 text-muted" />
            <div>
              <div className="font-medium">Drop all your card photos here</div>
              <div className="text-sm text-muted">or</div>
            </div>
            <Button variant="primary" icon={<ImagePlus className="size-4" />} onClick={() => inputRef.current?.click()}>
              Choose photos
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="How are the photos arranged?" htmlFor="pairing">
              <Select
                id="pairing"
                value={pairing}
                onChange={(e) => {
                  const v = e.target.value as 'pairs' | 'single';
                  setPairing(v);
                  savePref('batch-pairing', v);
                }}
              >
                <option value="pairs">Front, then back, for each card</option>
                <option value="single">One photo per card</option>
              </Select>
            </Field>
            <Field label="Order" htmlFor="order">
              <Select id="order" value={byName ? 'name' : 'picked'} onChange={(e) => setByName(e.target.value === 'name')}>
                <option value="name">By file name (IMG_0001, IMG_0002…)</option>
                <option value="picked">In the order I picked them</option>
              </Select>
            </Field>
          </div>
        </>
      )}

      {items.length > 0 && (
        <div className="mt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-semibold">{items.length} cards</span>
              <span className="text-muted"> from {files.length} photos</span>
              {started && (
                <span className="ml-2 text-muted">
                  · {done} uploaded{failed ? ` · ${failed} failed` : ''}
                </span>
              )}
            </div>
            {!started ? (
              <div className="flex gap-2">
                <Button onClick={reset}>Clear</Button>
                <Button variant="primary" icon={<Upload className="size-4" />} onClick={uploadAll}>
                  Upload {items.length} {items.length === 1 ? 'card' : 'cards'}
                </Button>
              </div>
            ) : running ? (
              <span className="inline-flex items-center gap-2 text-sm text-ink-2">
                <Spinner className="size-4" /> Uploading… keep this page open
              </span>
            ) : null}
          </div>
          {started && (
            <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((done + failed) / items.length) * 100}%` }} />
            </div>
          )}
          {finished && (
            <Alert
              tone={failed ? 'warning' : 'good'}
              className="mb-4"
              title={failed ? `${done} uploaded, ${failed} failed` : `All ${done} cards uploaded`}
              action={
                <div className="flex flex-wrap gap-2">
                  {failed > 0 && (
                    <Button size="sm" icon={<RotateCcw className="size-4" />} onClick={uploadAll}>
                      Retry failed
                    </Button>
                  )}
                  <ButtonLink to="/admin/review" size="sm" variant="primary" icon={<ClipboardCheck className="size-4" />}>
                    Review them
                  </ButtonLink>
                </div>
              }
            >
              {aiOn && opts.identify
                ? 'The AI is identifying them in the background — you can leave this page.'
                : 'Open each card to fill in its details.'}
              <button type="button" onClick={reset} className="ml-2 font-medium text-primary hover:underline">
                Add more
              </button>
            </Alert>
          )}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((item, index) => {
              const loc = locationFor(opts, index);
              return (
                <li key={item.id} className="rounded-xl border border-line bg-surface p-2">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-semibold">#{index + 1}</span>
                    {item.status === 'waiting' && !started && (
                      <span className="flex">
                        {item.back && (
                          <IconButton label="Swap front and back" size="sm" onClick={() => swap(item.id)}>
                            <ArrowLeftRight className="size-3.5" />
                          </IconButton>
                        )}
                        <IconButton label="Remove" size="sm" onClick={() => remove(item.id)}>
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </span>
                    )}
                    {item.status === 'uploading' && <Spinner className="size-4 text-primary" />}
                    {item.status === 'done' && <CheckCircle2 className="size-4 text-good-text" aria-label="Uploaded" />}
                    {item.status === 'error' && <XCircle className="size-4 text-critical-text" aria-label="Failed" />}
                  </div>
                  <div className={clsx('grid gap-1.5', pairing === 'pairs' ? 'grid-cols-2' : 'grid-cols-1')}>
                    <Thumb file={item.front} label={pairing === 'pairs' ? 'Front' : 'Photo'} />
                    {pairing === 'pairs' && <Thumb file={item.back} label="Back" />}
                  </div>
                  {(loc.location_binder || loc.location_page) && (
                    <div className="mt-1.5 truncate text-[11px] text-muted">
                      {[loc.location_binder, loc.location_page && `p${loc.location_page}`, loc.location_slot && `s${loc.location_slot}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  )}
                  {item.status === 'error' && <div className="mt-1 text-[11px] text-critical-text">{item.error}</div>}
                  {item.status === 'done' && item.cardId && (
                    <Link to={`/admin/cards/${item.cardId}`} className="mt-1 block text-[11px] font-medium text-primary hover:underline">
                      Open card →
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Panel>
  );
}
