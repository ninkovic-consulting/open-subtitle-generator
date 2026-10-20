import { Tooltip as T } from 'radix-ui';
import * as React from 'react';

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <T.Provider delayDuration={300}>{children}</T.Provider>;
}

export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded-md bg-text px-2.5 py-1.5 text-xs text-bg shadow-lg"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
