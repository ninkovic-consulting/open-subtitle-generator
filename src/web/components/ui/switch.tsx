import { Switch as SwitchPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-panel-2 transition-colors data-[state=checked]:border-accent-fill data-[state=checked]:bg-accent-fill disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-muted transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-ink" />
    </SwitchPrimitive.Root>
  );
}

/** A switch with a title and description, laid out as a row. */
export function SwitchRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  id: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <label htmlFor={id} className="grid gap-0.5 cursor-pointer">
        <span className="text-sm font-medium">{title}</span>
        {description && (
          <span className="text-xs text-muted leading-snug max-w-prose">{description}</span>
        )}
      </label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5"
      />
    </div>
  );
}
