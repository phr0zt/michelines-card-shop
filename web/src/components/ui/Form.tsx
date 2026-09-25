import clsx from 'clsx';
import {
  forwardRef,
  useEffect,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { centsToInput, parseMoneyToCents } from '@shared/money';

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-sm font-medium text-ink-2">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-critical-text">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={clsx('field-control', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={clsx('field-control resize-y', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={clsx('field-control', className)} {...rest}>
      {children}
    </select>
  );
});

/** Labelled input in one line: <TextField label="Player" value=… onChange=… />. */
export function TextField({
  label,
  hint,
  className,
  inputClassName,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; inputClassName?: string }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <Input id={id} className={inputClassName} {...rest} />
    </Field>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className={clsx('flex cursor-pointer items-start gap-2.5 select-none', className)}>
      <input id={id} type="checkbox" className="mt-0.5 size-4.5 shrink-0 cursor-pointer accent-[var(--primary)]" {...rest} />
      <span className="text-sm">
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="cursor-pointer text-sm">
        <span className="font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-surface-3 ring-1 ring-line-strong ring-inset',
        )}
      >
        <span
          className={clsx(
            'inline-block size-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

/**
 * Money input that shows dollars but reports integer cents (or null when blank).
 * It keeps what the person typed while they type, and re-syncs when the value
 * changes from outside.
 */
export function MoneyInput({
  value,
  onChange,
  placeholder = '0.00',
  className,
  id,
  disabled,
  autoFocus,
  ariaLabel,
}: {
  value: number | null | undefined;
  onChange: (cents: number | null) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(centsToInput(value));
  useEffect(() => {
    setText((current) => (parseMoneyToCents(current) === (value ?? null) ? current : centsToInput(value)));
  }, [value]);
  const invalid = text.trim() !== '' && parseMoneyToCents(text) === null;
  return (
    <div className={clsx('relative', className)}>
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">$</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        autoFocus={autoFocus}
        className={clsx('field-control tabular pl-7', invalid && 'border-critical')}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const cents = parseMoneyToCents(e.target.value);
          if (e.target.value.trim() === '') onChange(null);
          else if (cents !== null && cents >= 0) onChange(cents);
        }}
        onBlur={() => {
          const cents = parseMoneyToCents(text);
          if (cents !== null && cents >= 0) setText(centsToInput(cents));
        }}
      />
    </div>
  );
}

export function MoneyField({
  label,
  hint,
  className,
  ...rest
}: Parameters<typeof MoneyInput>[0] & { label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <MoneyInput id={id} {...rest} />
    </Field>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex flex-wrap gap-1 rounded-lg bg-surface-3 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="tabular text-xs text-muted">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
