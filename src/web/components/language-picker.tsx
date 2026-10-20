import { Command } from 'cmdk';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { LANGUAGES, findLanguage } from '@shared/languages';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** Searchable language list. `allowAuto` adds "Auto-detect"; custom names can be typed in. */
export function LanguagePicker({
  value,
  onChange,
  allowAuto,
  allowCustom = true,
  id,
  className,
}: {
  value: string;
  onChange: (code: string, customName?: string) => void;
  allowAuto?: boolean;
  allowCustom?: boolean;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const lang = findLanguage(value);
  const label = value === 'auto' ? 'Auto-detect' : lang ? `${lang.name}` : value;
  const native = value !== 'auto' && lang && lang.native !== lang.name ? lang.native : null;
  const exact = LANGUAGES.some(
    (l) =>
      l.name.toLowerCase() === search.trim().toLowerCase() ||
      l.code.toLowerCase() === search.trim().toLowerCase(),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className={cn(
            'inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 text-left text-base hover:border-line-strong focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 cursor-pointer',
            className,
          )}
        >
          <span className="truncate">
            {label}
            {native && <span className="ml-2 text-sm text-muted">{native}</span>}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0">
        <Command
          loop
          className="flex flex-col"
          filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}
        >
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Search languages…"
            className="h-10 border-b border-line bg-transparent px-3 text-sm outline-none placeholder:text-faint"
          />
          <Command.List className="max-h-72 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-2 text-sm text-muted">No match.</Command.Empty>
            {allowAuto && (
              <Item
                selected={value === 'auto'}
                value="auto auto-detect"
                onSelect={() => {
                  onChange('auto');
                  setOpen(false);
                }}
              >
                Auto-detect
              </Item>
            )}
            {LANGUAGES.map((l) => (
              <Item
                key={l.code}
                selected={value === l.code}
                value={`${l.name} ${l.native} ${l.code}`}
                onSelect={() => {
                  onChange(l.code);
                  setOpen(false);
                  setSearch('');
                }}
              >
                <span className="flex-1">{l.name}</span>
                <span className="text-xs text-muted">{l.native}</span>
              </Item>
            ))}
            {allowCustom && search.trim() && !exact && (
              <Command.Item
                value={`custom ${search}`}
                onSelect={() => {
                  onChange(search.trim(), search.trim());
                  setOpen(false);
                  setSearch('');
                }}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm data-[selected=true]:bg-panel-2"
              >
                <Plus className="size-3.5 text-muted" /> Use “{search.trim()}” as a custom language
              </Command.Item>
            )}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Item({
  children,
  selected,
  value,
  onSelect,
}: {
  children: React.ReactNode;
  selected: boolean;
  value: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm data-[selected=true]:bg-panel-2"
    >
      <Check className={cn('size-3.5 text-accent', selected ? 'opacity-100' : 'opacity-0')} />
      {children}
    </Command.Item>
  );
}
