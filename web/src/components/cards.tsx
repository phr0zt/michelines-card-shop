import clsx from 'clsx';
import { Archive, CheckCircle2, Clock, Heart, ImageOff, PencilLine, Sparkles, Store } from 'lucide-react';
import { useState } from 'react';
import { STATUS_LABELS, type CardStatus } from '@shared/constants';
import type { CardImage, Platform } from '@shared/types';
import { Badge, Spinner, type Tone } from './ui/Feedback';

const STATUS_STYLE: Record<CardStatus, { tone: Tone; icon: React.ReactNode }> = {
  draft: { tone: 'warning', icon: <PencilLine className="size-3.5" /> },
  in_stock: { tone: 'neutral', icon: <Archive className="size-3.5" /> },
  listed: { tone: 'primary', icon: <Store className="size-3.5" /> },
  pending: { tone: 'primary', icon: <Clock className="size-3.5" /> },
  sold: { tone: 'good', icon: <CheckCircle2 className="size-3.5" /> },
  keeper: { tone: 'neutral', icon: <Heart className="size-3.5" /> },
};

export function StatusBadge({ status, className }: { status: CardStatus; className?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <Badge tone={s.tone} icon={s.icon} className={className}>
      {status === 'keeper' ? 'Keeper' : STATUS_LABELS[status]}
    </Badge>
  );
}

interface FlagFields {
  is_rookie: boolean;
  is_autograph: boolean;
  is_memorabilia: boolean;
  is_graded: boolean;
  grading_company: string;
  grade: string;
  serial_number: string;
}

export function CardFlags({ card, className }: { card: FlagFields; className?: string }) {
  const flags: string[] = [];
  if (card.is_rookie) flags.push('RC');
  if (card.is_autograph) flags.push('AUTO');
  if (card.is_memorabilia) flags.push('RELIC');
  if (card.serial_number) flags.push(card.serial_number.includes('/') ? card.serial_number : `/${card.serial_number}`);
  const graded = card.is_graded ? [card.grading_company, card.grade].filter(Boolean).join(' ') || 'Graded' : '';
  if (flags.length === 0 && !graded) return null;
  return (
    <span className={clsx('inline-flex flex-wrap gap-1', className)}>
      {graded && (
        <Badge tone="primary" className="font-semibold">
          {graded}
        </Badge>
      )}
      {flags.map((f) => (
        <Badge key={f} tone="neutral" className="font-semibold tracking-wide">
          {f}
        </Badge>
      ))}
    </span>
  );
}

export function PlatformDot({ platform, size = 'md' }: { platform: Pick<Platform, 'name' | 'color'>; size?: 'sm' | 'md' }) {
  return (
    <span
      title={platform.name}
      aria-label={platform.name}
      className={clsx('inline-block shrink-0 rounded-full ring-2 ring-surface', size === 'sm' ? 'size-2.5' : 'size-3')}
      style={{ background: platform.color }}
    />
  );
}

export function PlatformChips({ ids, platforms, max = 4 }: { ids: number[]; platforms: Platform[]; max?: number }) {
  const list = ids.map((id) => platforms.find((p) => p.id === id)).filter((p): p is Platform => Boolean(p));
  if (list.length === 0) return <span className="text-xs text-muted">Not posted anywhere</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {list.slice(0, max).map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1 text-xs text-ink-2">
          <PlatformDot platform={p} size="sm" />
          {p.name}
        </span>
      ))}
      {list.length > max && <span className="text-xs text-muted">+{list.length - max}</span>}
    </span>
  );
}

/** A card photo at the standard 5:7 card ratio. Hover shows the back when there is one. */
export function CardThumb({
  front,
  back,
  alt,
  size = 'md',
  className,
  flipOnHover = true,
  busy,
}: {
  front: CardImage | { urls: { sm: string; md: string } } | null | undefined;
  back?: CardImage | null;
  alt: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  flipOnHover?: boolean;
  busy?: boolean;
}) {
  const [showBack, setShowBack] = useState(false);
  const sizes = { xs: 'w-10', sm: 'w-14', md: 'w-full', lg: 'w-full' };
  const img = showBack && back ? back : front;
  const src = img ? (size === 'xs' || size === 'sm' ? img.urls.sm : img.urls.md) : null;
  return (
    <div
      className={clsx(
        'relative aspect-[5/7] shrink-0 overflow-hidden rounded-lg bg-surface-3 ring-1 ring-line',
        sizes[size],
        className,
      )}
      onMouseEnter={() => flipOnHover && back && setShowBack(true)}
      onMouseLeave={() => setShowBack(false)}
    >
      {src ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" className="size-full object-contain" />
      ) : (
        <div className="flex size-full items-center justify-center text-muted">
          <ImageOff className={size === 'xs' ? 'size-4' : 'size-6'} />
        </div>
      )}
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35 text-white" title="AI is working on this card">
          <Sparkles className="absolute top-1 right-1 size-3.5" />
          <Spinner className="size-5" />
        </div>
      )}
    </div>
  );
}

export function locationText(c: { location_binder: string; location_page: string; location_slot: string }): string {
  const parts = [
    c.location_binder,
    c.location_page ? `page ${c.location_page}` : '',
    c.location_slot ? `slot ${c.location_slot}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}
