import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, OctagonAlert, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('animate-spin', className ?? 'size-5')} aria-hidden="true" />;
}

export function PageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-24 text-muted" role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export type Tone = 'neutral' | 'primary' | 'good' | 'warning' | 'serious' | 'critical';

const badgeTones: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  primary: 'bg-primary-soft text-primary',
  good: 'bg-good-soft text-good-text',
  warning: 'bg-warning-soft text-warning-text',
  serious: 'bg-serious-soft text-serious-text',
  critical: 'bg-critical-soft text-critical-text',
};

export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        badgeTones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

const alertIcons: Record<Exclude<Tone, 'neutral' | 'primary'> | 'info', ReactNode> = {
  info: <Info className="size-5 shrink-0" />,
  good: <CheckCircle2 className="size-5 shrink-0" />,
  warning: <AlertTriangle className="size-5 shrink-0" />,
  serious: <OctagonAlert className="size-5 shrink-0" />,
  critical: <XCircle className="size-5 shrink-0" />,
};

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: 'info' | 'good' | 'warning' | 'serious' | 'critical';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'bg-primary-soft text-ink border-primary/30 [&_svg]:text-primary',
    good: 'bg-good-soft text-ink border-good/30 [&>svg]:text-good-text',
    warning: 'bg-warning-soft text-ink border-warning/40 [&>svg]:text-warning-text',
    serious: 'bg-serious-soft text-ink border-serious/40 [&>svg]:text-serious-text',
    critical: 'bg-critical-soft text-ink border-critical/40 [&>svg]:text-critical-text',
  }[tone];
  return (
    <div role={tone === 'critical' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-xl border p-3.5', styles, className)}>
      {alertIcons[tone]}
      <div className="min-w-0 flex-1 text-sm">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={clsx(title && 'mt-0.5', 'text-ink-2')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      {icon && <div className="text-muted [&_svg]:size-10">{icon}</div>}
      <div className="text-base font-semibold">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
