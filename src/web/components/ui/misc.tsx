import * as React from 'react';
import { cn } from '@/lib/utils';

export function Progress({
  value,
  className,
  tone = 'accent',
}: {
  value: number;
  className?: string;
  tone?: 'accent' | 'source' | 'danger' | 'muted';
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const color = {
    accent: 'bg-accent-fill',
    source: 'bg-source',
    danger: 'bg-danger',
    muted: 'bg-faint',
  }[tone];
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out', color)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn('h-px w-full bg-line', className)} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-2xs text-muted">
      {children}
    </kbd>
  );
}

/** Segmented control for 2–4 mutually exclusive options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  className?: string;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex rounded-md border border-line bg-panel-2 p-0.5', className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'cursor-pointer rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors',
            value === o.value
              ? 'bg-panel text-text shadow-sm shadow-black/10 ring-1 ring-line dark:bg-line-strong dark:ring-line-strong'
              : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('size-4 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('grid gap-4', className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted max-w-prose">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Panel({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-lg border border-line bg-panel', className)} {...props} />;
}
