import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { AudioLines, Check, ChevronDown, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { ModelInfo } from '@shared/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export function modelPrice(m: ModelInfo | undefined, kind: 'stt' | 'chat'): string | null {
  if (!m || m.promptPrice == null) return null;
  if (kind === 'stt') return `$${(m.promptPrice * 3600).toFixed(2)} / hour`;
  const perM = (v: number | null) => (v == null ? '?' : `$${(v * 1e6).toFixed(2)}`);
  return `${perM(m.promptPrice)} in · ${perM(m.completionPrice)} out / M tokens${m.audioPrice ? ` · audio ${perM(m.audioPrice)}` : ''}`;
}

/**
 * Model combobox fed by OpenRouter's catalog (or a custom endpoint's /models).
 * Any id can be typed, so new or unlisted models work too.
 */
export function ModelPicker({
  kind,
  value,
  onChange,
  provider,
  baseUrl,
  apiKey,
  id,
}: {
  kind: 'stt' | 'chat';
  value: string;
  onChange: (id: string) => void;
  provider: 'openrouter' | 'custom';
  baseUrl?: string;
  apiKey?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const models = useQuery({
    queryKey: ['models', kind, provider, provider === 'custom' ? baseUrl : ''],
    queryFn: () => api.models(kind, { provider, baseUrl, apiKey }),
    enabled: provider === 'openrouter' || !!baseUrl,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const list = models.data?.models ?? [];
  const current = list.find((m) => m.id === value);
  const filtered =
    kind === 'chat' && provider === 'openrouter'
      ? list.filter((m) => m.audioInput || search)
      : list;

  return (
    <div className="grid min-w-0 gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            className="inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 text-left font-mono text-sm hover:border-line-strong focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 cursor-pointer"
          >
            <span className="truncate">{value || 'Choose a model'}</span>
            <ChevronDown className="size-4 shrink-0 text-muted" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(560px,90vw)] p-0">
          <Command loop shouldFilter>
            <div className="flex items-center gap-2 border-b border-line pr-2">
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder={
                  provider === 'custom'
                    ? 'Model id (type any name)…'
                    : 'Search models or type an id…'
                }
                className="h-10 flex-1 bg-transparent px-3 font-mono text-sm outline-none placeholder:font-sans placeholder:text-faint"
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    search.trim() &&
                    !list.some((m) => m.id === search.trim())
                  ) {
                    onChange(search.trim());
                    setOpen(false);
                  }
                }}
              />
              <button
                type="button"
                aria-label="Reload model list"
                onClick={() => void models.refetch()}
                className="cursor-pointer rounded p-1 text-muted hover:text-text"
              >
                {models.isFetching ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
              </button>
            </div>
            <Command.List className="max-h-80 overflow-y-auto p-1">
              {models.data?.error && (
                <p className="px-3 py-2 text-xs text-warn">{models.data.error}</p>
              )}
              <Command.Empty className="px-3 py-2 text-sm text-muted">
                {search.trim() ? (
                  <button
                    type="button"
                    className="cursor-pointer text-source"
                    onClick={() => {
                      onChange(search.trim());
                      setOpen(false);
                    }}
                  >
                    Use “{search.trim()}”
                  </button>
                ) : (
                  'No models listed.'
                )}
              </Command.Empty>
              {search.trim() &&
                !list.some((m) => m.id === search.trim()) &&
                filtered.length > 0 && (
                  <Command.Item
                    value={`__custom ${search}`}
                    onSelect={() => {
                      onChange(search.trim());
                      setOpen(false);
                    }}
                    className="cursor-pointer rounded-sm px-2.5 py-1.5 text-sm data-[selected=true]:bg-panel-2"
                  >
                    Use “<span className="font-mono">{search.trim()}</span>”
                  </Command.Item>
                )}
              {filtered.map((m) => (
                <Command.Item
                  key={m.id}
                  value={`${m.id} ${m.name}`}
                  onSelect={() => {
                    onChange(m.id);
                    setOpen(false);
                    setSearch('');
                  }}
                  className="flex cursor-pointer items-start gap-2 rounded-sm px-2.5 py-1.5 data-[selected=true]:bg-panel-2"
                >
                  <Check
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0 text-accent',
                      m.id === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <div className="grid min-w-0 flex-1">
                    <span className="truncate font-mono text-sm">{m.id}</span>
                    <span className="truncate text-xs text-muted">
                      {m.name !== m.id && `${m.name} · `}
                      {modelPrice(m, kind) ?? 'local / no price'}
                    </span>
                  </div>
                  {kind === 'chat' && m.audioInput && (
                    <span
                      className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-sm bg-source-soft px-1.5 py-px text-2xs text-source"
                      title="Accepts audio input"
                    >
                      <AudioLines className="size-3" /> audio
                    </span>
                  )}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </PopoverContent>
      </Popover>
      {provider === 'openrouter' && (
        <p className="text-xs text-muted">
          {modelPrice(current, kind) ??
            (models.isLoading ? 'Loading prices…' : 'Price unknown for this id')}
        </p>
      )}
    </div>
  );
}
