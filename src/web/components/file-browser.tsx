import { useQuery } from '@tanstack/react-query';
import {
  ArrowUp,
  Captions,
  ChevronRight,
  Film,
  Folder,
  HardDrive,
  Home,
  Monitor,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FsEntry, FsRoot } from '@shared/types';
import { ErrorNote } from '@/components/empty';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

const LAST_DIR_KEY = 'osg-last-dir';

function rootIcon(root: FsRoot) {
  if (root.kind === 'home') return <Home />;
  if (root.kind === 'volume') return <HardDrive />;
  if (root.name === 'Desktop') return <Monitor />;
  return <Folder />;
}

function splitPath(p: string): { name: string; path: string }[] {
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/';
  const parts = p.split(sep).filter(Boolean);
  const crumbs: { name: string; path: string }[] = [];
  let acc = sep === '/' ? '' : '';
  parts.forEach((part, i) => {
    acc =
      sep === '/'
        ? `${acc}/${part}`
        : i === 0
          ? `${part}\\`
          : `${acc}${acc.endsWith('\\') ? '' : '\\'}${part}`;
    crumbs.push({ name: part, path: acc });
  });
  return crumbs;
}

/** Keeps breadcrumbs short: first folder, an ellipsis, then the last three. */
function trimCrumbs(crumbs: { name: string; path: string }[]): { name: string; path: string }[] {
  if (crumbs.length <= 5) return crumbs;
  return [crumbs[0]!, { name: '…', path: '' }, ...crumbs.slice(-3)];
}

export interface FileBrowserProps {
  mode: 'files' | 'folder';
  selected?: Map<string, FsEntry>;
  onSelectedChange?: (next: Map<string, FsEntry>) => void;
  onFolderChange?: (path: string) => void;
  className?: string;
}

/** Case- and accent-insensitive form for matching ("Čarobnjak" matches "carob"). */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Local disk browser. Only folders, video files and .srt files are shown. */
export function FileBrowser({
  mode,
  selected,
  onSelectedChange,
  onFolderChange,
  className,
}: FileBrowserProps) {
  const roots = useQuery({ queryKey: ['fs-roots'], queryFn: api.fsRoots, staleTime: 60_000 });
  const [dir, setDir] = useState<string>(() => {
    try {
      return localStorage.getItem(LAST_DIR_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [deep, setDeep] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  const effective = dir || roots.data?.roots[0]?.path || '';
  const list = useQuery({
    queryKey: ['fs', effective],
    queryFn: () => api.fsList(effective),
    enabled: !!effective,
    retry: false,
  });
  const trimmed = query.trim();
  const debounced = useDebounced(trimmed, 300);
  const deepSearch = useQuery({
    queryKey: ['fs-search', effective, debounced],
    queryFn: () => api.fsSearch(effective, debounced),
    enabled: deep && debounced.length >= 2 && !!effective,
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (list.data?.path) {
      setTyped(list.data.path);
      onFolderChange?.(list.data.path);
      try {
        localStorage.setItem(LAST_DIR_KEY, list.data.path);
      } catch {
        // ignore
      }
    }
  }, [list.data?.path, onFolderChange]);

  const go = (p: string) => {
    setDir(p);
    setQuery('');
  };
  const filtering = trimmed.length > 0;
  const showingDeep = filtering && deep;
  const words = fold(trimmed).split(/\s+/).filter(Boolean);
  const entries: FsEntry[] = showingDeep
    ? (deepSearch.data?.entries ?? [])
    : (list.data?.entries ?? []).filter(
        (e) => !filtering || words.every((w) => fold(e.name).includes(w)),
      );
  const videos = entries.filter((e) => e.type === 'video');
  const allSelected = videos.length > 0 && videos.every((v) => selected?.has(v.path));
  const someSelected = videos.some((v) => selected?.has(v.path));
  const srtNames = new Set(
    (list.data?.entries ?? []).filter((e) => e.type === 'subtitle').map((e) => e.name),
  );

  const toggle = (entry: FsEntry, on: boolean) => {
    if (!selected || !onSelectedChange) return;
    const next = new Map(selected);
    if (on) next.set(entry.path, entry);
    else next.delete(entry.path);
    onSelectedChange(next);
  };
  const toggleAll = (on: boolean) => {
    if (!selected || !onSelectedChange) return;
    const next = new Map(selected);
    for (const v of videos) {
      if (on) next.set(v.path, v);
      else next.delete(v.path);
    }
    onSelectedChange(next);
  };

  const hasSidecar = (video: FsEntry) => {
    if (video.relativeDir !== undefined) return false;
    const base = video.name.replace(/\.[^.]+$/, '');
    for (const n of srtNames) if (n.startsWith(base)) return true;
    return false;
  };

  const loading = showingDeep ? deepSearch.isFetching || debounced !== trimmed : list.isLoading;
  const error = showingDeep ? deepSearch.error : list.error;

  return (
    <div
      className={cn(
        'grid overflow-hidden rounded-lg border border-line bg-panel md:grid-cols-[200px_1fr]',
        className,
      )}
    >
      <nav
        aria-label="Locations"
        className="border-b border-line bg-panel-2 p-2 md:border-b-0 md:border-r"
      >
        <ul className="flex gap-1 overflow-x-auto md:grid md:overflow-visible">
          {roots.data?.roots.map((r) => (
            <li key={r.path}>
              <button
                type="button"
                onClick={() => go(r.path)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm text-muted hover:bg-panel hover:text-text [&_svg]:size-4',
                  effective === r.path && 'bg-panel text-text ring-1 ring-line',
                )}
              >
                {rootIcon(r)}
                <span className="truncate">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-h-[380px] min-w-0 flex-col">
        <div className="flex items-center gap-2 border-b border-line p-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Parent folder"
            disabled={!list.data?.parent}
            onClick={() => list.data?.parent && go(list.data.parent)}
          >
            <ArrowUp />
          </Button>
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) go(typed.trim());
            }}
          >
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Folder path"
              className="h-8 font-mono text-xs"
              spellCheck={false}
            />
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-3 py-1.5 text-xs text-muted">
          {trimCrumbs(splitPath(effective)).map((c, i, arr) => (
            <span key={c.path || `gap-${i}`} className="flex min-w-0 items-center gap-0.5">
              {c.path ? (
                <button
                  type="button"
                  className="max-w-[16ch] cursor-pointer truncate rounded px-1 hover:bg-panel-2 hover:text-text"
                  onClick={() => go(c.path)}
                  title={c.path}
                >
                  {c.name}
                </button>
              ) : (
                <span className="px-1 text-faint">…</span>
              )}
              {i < arr.length - 1 && <ChevronRight className="size-3 shrink-0 text-faint" />}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-2 py-1.5">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-faint" />
            <Input
              ref={searchBox}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder={deep ? 'Search this folder and its subfolders' : 'Search this folder'}
              aria-label="Search folders and videos"
              className="h-8 pl-8 pr-8 text-sm [&::-webkit-search-cancel-button]:hidden"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery('');
                  searchBox.current?.focus();
                }}
                className="absolute right-2 top-2 cursor-pointer text-faint hover:text-text"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-xs text-muted">
            <Switch checked={deep} onCheckedChange={setDeep} aria-label="Include subfolders" />
            Include subfolders
          </label>
        </div>
        {mode === 'files' && videos.length > 0 && (
          <label className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 text-sm">
            <Checkbox
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              onCheckedChange={(v) => toggleAll(v === true)}
            />
            <span>
              {filtering
                ? `Select all ${videos.length} matching video${videos.length === 1 ? '' : 's'}`
                : `Select all ${videos.length} video${videos.length === 1 ? '' : 's'} in this folder`}
            </span>
          </label>
        )}
        <div className="flex-1 overflow-y-auto" style={{ maxHeight: 420 }}>
          {loading && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted">
              <Spinner /> {showingDeep ? 'Searching subfolders…' : 'Reading folder…'}
            </div>
          )}
          {error && <ErrorNote error={error} className="m-3" />}
          {!loading && !error && entries.length === 0 && list.data && (
            <div className="grid justify-items-start gap-2 p-4 text-sm text-muted">
              {filtering ? (
                <>
                  <p>Nothing here matches “{trimmed}”.</p>
                  {!deep && (
                    <Button variant="secondary" size="sm" onClick={() => setDeep(true)}>
                      <Search /> Search subfolders too
                    </Button>
                  )}
                  {deep && trimmed.length < 2 && <p>Type at least two characters.</p>}
                </>
              ) : (
                <p>This folder has no subfolders or video files.</p>
              )}
            </div>
          )}
          <ul>
            {entries.map((e) => {
              const where =
                e.relativeDir !== undefined ? (
                  <span className="block truncate text-2xs text-faint">
                    {e.relativeDir || 'This folder'}
                  </span>
                ) : null;
              if (e.type === 'dir') {
                return (
                  <li key={e.path}>
                    <button
                      type="button"
                      onClick={() => go(e.path)}
                      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm hover:bg-panel-2"
                    >
                      <Folder className="size-4 shrink-0 text-source" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{e.name}</span>
                        {where}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-faint" />
                    </button>
                  </li>
                );
              }
              if (e.type === 'subtitle') {
                return (
                  <li
                    key={e.path}
                    className="flex items-center gap-3 px-3 py-1.5 pl-10 text-xs text-faint"
                  >
                    <Captions className="size-3.5" />
                    <span className="truncate">{e.name}</span>
                  </li>
                );
              }
              const checked = selected?.has(e.path) ?? false;
              return (
                <li key={e.path}>
                  <label
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 text-sm',
                      mode === 'files' ? 'cursor-pointer hover:bg-panel-2' : 'text-muted',
                      checked && 'bg-accent-soft/50',
                    )}
                  >
                    {mode === 'files' ? (
                      <Checkbox checked={checked} onCheckedChange={(v) => toggle(e, v === true)} />
                    ) : (
                      <span className="w-4" />
                    )}
                    <Film className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{e.name}</span>
                      {where}
                    </span>
                    {hasSidecar(e) && (
                      <span
                        className="hidden text-2xs text-muted sm:inline"
                        title="A subtitle file with the same name exists"
                      >
                        has .srt
                      </span>
                    )}
                    <span className="tabular w-16 text-right text-xs text-faint">
                      {formatBytes(e.sizeBytes)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {showingDeep && deepSearch.data?.truncated && (
            <p className="px-3 py-2 text-xs text-muted">
              Showing the first {deepSearch.data.entries.length} matches. Type more to narrow it
              down.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
