import { Check, ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface Option<T extends string = string> {
  value: T;
  label: React.ReactNode;
  description?: React.ReactNode;
}

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  id,
  disabled,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: Option<T>[];
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        className={cn(
          'inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 text-base text-text hover:border-line-strong focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-50 cursor-pointer',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line bg-panel shadow-xl shadow-black/20"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-start gap-2 rounded-sm py-1.5 pl-7 pr-3 text-sm outline-none data-[highlighted]:bg-panel-2 data-[state=checked]:font-medium"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 top-2">
                  <Check className="size-3.5 text-accent" />
                </SelectPrimitive.ItemIndicator>
                <div className="grid">
                  <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                  {o.description && <span className="text-xs text-muted">{o.description}</span>}
                </div>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
