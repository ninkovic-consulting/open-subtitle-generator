import { Popover as P } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;

export function PopoverContent({
  className,
  align = 'start',
  ...props
}: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={4}
        className={cn(
          'z-50 rounded-md border border-line bg-panel shadow-xl shadow-black/20 outline-none',
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}
