import * as React from 'react';
import { cn } from '@/lib/utils';

export const fieldClass =
  'w-full rounded-md border border-line bg-panel px-3 text-base text-text placeholder:text-faint transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-50 aria-invalid:border-danger';

export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return <input type={type} className={cn(fieldClass, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea className={cn(fieldClass, 'min-h-20 py-2 leading-relaxed', className)} {...props} />
  );
}
