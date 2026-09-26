import clsx from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Small click-to-open menu; closes on outside click, Escape, or choosing an item. */
export function Menu({
  trigger,
  items,
  align = 'right',
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode;
  items: (MenuItem | 'divider' | null | false | undefined)[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute z-30 mt-1 min-w-52 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-pop',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) =>
            !item ? null : item === 'divider' ? (
              <div key={i} className="my-1 border-t border-line" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={clsx(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-3 disabled:opacity-40',
                  item.danger ? 'text-critical-text' : 'text-ink',
                )}
              >
                {item.icon && <span className="text-muted [&_svg]:size-4">{item.icon}</span>}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
