import clsx from 'clsx';
import { ArrowLeftRight, ImagePlus, Maximize2, RotateCw, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { CardDetail, CardImage, ImageSide } from '@shared/types';
import { IconButton } from '../../../components/ui/Button';
import { useConfirm } from '../../../components/ui/Dialog';
import { Spinner } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { api, errorMessage } from '../../../lib/api';
import { prepareImage } from '../../../lib/images';
import { useApplyCard } from '../../../lib/queries';

const SIDE_LABEL: Record<ImageSide, string> = { front: 'Front', back: 'Back', extra: 'Extra' };

export function PhotoPanel({ card, label }: { card: CardDetail; label: string }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadSide = useRef<ImageSide>('front');
  const applyCard = useApplyCard();
  const toast = useToast();
  const confirm = useConfirm();

  const images = card.images;
  const selected: CardImage | undefined = images.find((i) => i.id === selectedId) ?? images[0];

  async function run(action: () => Promise<CardDetail>, success?: string) {
    setBusy(true);
    try {
      applyCard(await action());
      if (success) toast.success(success);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function pick(side: ImageSide) {
    uploadSide.current = side;
    fileRef.current?.click();
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const blob = await prepareImage(file);
    await run(() => api.uploadImage(card.id, uploadSide.current, blob, uploadSide.current !== 'extra'), 'Photo uploaded');
  }

  const hasFront = images.some((i) => i.side === 'front');
  const hasBack = images.some((i) => i.side === 'back');

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl border border-line bg-surface-3">
        {selected ? (
          <button type="button" className="block w-full cursor-zoom-in" onClick={() => setZoom(true)} aria-label="Open full-size photo">
            <img src={selected.urls.md} alt={`${label} — ${SIDE_LABEL[selected.side]}`} className="mx-auto aspect-[5/7] max-h-[70vh] w-full object-contain" />
          </button>
        ) : (
          <div className="flex aspect-[5/7] flex-col items-center justify-center gap-3 p-6 text-center text-muted">
            <ImagePlus className="size-10" />
            <div className="text-sm">No photos yet</div>
            <button type="button" onClick={() => pick('front')} className="text-sm font-medium text-primary hover:underline">
              Upload the front
            </button>
          </div>
        )}
        {selected && (
          <div className="absolute top-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
            {SIDE_LABEL[selected.side]}
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Spinner className="size-8 text-white" />
          </div>
        )}
      </div>

      {selected && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          <IconButton label="Rotate photo" onClick={() => run(() => api.rotateImage(card.id, selected.id, 90))} disabled={busy}>
            <RotateCw className="size-4.5" />
          </IconButton>
          {hasFront && hasBack && (
            <IconButton label="Swap front and back" onClick={() => run(() => api.swapImages(card.id), 'Front and back swapped')} disabled={busy}>
              <ArrowLeftRight className="size-4.5" />
            </IconButton>
          )}
          <IconButton label={`Replace ${SIDE_LABEL[selected.side].toLowerCase()} photo`} onClick={() => pick(selected.side)} disabled={busy}>
            <Upload className="size-4.5" />
          </IconButton>
          <IconButton label="View full size" onClick={() => setZoom(true)}>
            <Maximize2 className="size-4.5" />
          </IconButton>
          <IconButton
            label="Delete photo"
            disabled={busy}
            onClick={async () => {
              if (await confirm({ title: 'Delete this photo?', confirmLabel: 'Delete', danger: true })) {
                await run(() => api.deleteImage(card.id, selected.id), 'Photo deleted');
                setSelectedId(null);
              }
            }}
          >
            <Trash2 className="size-4.5" />
          </IconButton>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {images.map((img) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setSelectedId(img.id)}
            className={clsx(
              'relative w-16 overflow-hidden rounded-lg ring-2 transition',
              selected?.id === img.id ? 'ring-primary' : 'ring-transparent hover:ring-line-strong',
            )}
            aria-label={`Show ${SIDE_LABEL[img.side].toLowerCase()} photo`}
          >
            <img src={img.urls.sm} alt="" className="aspect-[5/7] w-full bg-surface-3 object-contain" />
            <span className="absolute inset-x-0 bottom-0 bg-black/55 text-center text-[10px] font-medium text-white">
              {SIDE_LABEL[img.side]}
            </span>
          </button>
        ))}
        {!hasFront && images.length > 0 && <AddTile label="Front" onClick={() => pick('front')} />}
        {!hasBack && <AddTile label="Back" onClick={() => pick('back')} />}
        <AddTile label="Extra" onClick={() => pick('extra')} />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {zoom && selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setZoom(false)}
          role="dialog"
          aria-label="Full-size photo"
        >
          <img src={selected.urls.full} alt={label} className="max-h-full max-w-full object-contain" />
          <div className="absolute top-3 right-3 rounded-lg bg-white/15 px-3 py-1.5 text-sm text-white">Click anywhere to close</div>
        </div>
      )}
    </div>
  );
}

function AddTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex aspect-[5/7] w-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong text-muted hover:border-primary hover:text-primary"
    >
      <ImagePlus className="size-4" />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}
