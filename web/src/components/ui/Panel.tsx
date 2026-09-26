import clsx from 'clsx';
import type { ReactNode } from 'react';

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
  icon,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  icon?: ReactNode;
}) {
  return (
    <section id={id} className={clsx('rounded-xl border border-line bg-surface shadow-card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                {icon && <span className="text-muted [&_svg]:size-4.5">{icon}</span>}
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm text-muted">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function DefinitionList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map((item, i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{item.label}</dt>
          <dd className="min-w-0 text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
