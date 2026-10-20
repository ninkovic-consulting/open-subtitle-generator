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
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FsEntry, FsRoot } from '@shared/types';
import { ErrorNote } from '@/components/empty';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
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
  const effective = dir || roots.data?.roots[0]?.path || '';
  const list = useQuery({
    queryKey: ['fs', effective],
    queryFn: () => api.fsList(effective),
    enabled: !!effective,
    retry: false,
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

  const go = (p: string) => setDir(p);
  const videos = list.data?.entries.filter((e) => e.type === 'video') ?? [];
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
    const base = video.name.replace(/\.[^.]+$/, '');
    for (const n of srtNames) if (n.startsWith(base)) return true;
    return false;
  };

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
        {mode === 'files' && videos.length > 0 && (
          <label className="flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 text-sm">
            <Checkbox
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              onCheckedChange={(v) => toggleAll(v === true)}
            />
            <span>
              Select all {videos.length} video{videos.length === 1 ? '' : 's'} in this folder
            </span>
          </label>
        )}
        <div className="flex-1 overflow-y-auto" style={{ maxHeight: 420 }}>
          {list.isLoading && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted">
              <Spinner /> Reading folder…
            </div>
          )}
          {list.error && <ErrorNote error={list.error} className="m-3" />}
          {list.data && list.data.entries.length === 0 && (
            <p className="p-4 text-sm text-muted">This folder has no subfolders or video files.</p>
          )}
          <ul>
            {list.data?.entries.map((e) => {
              if (e.type === 'dir') {
                return (
                  <li key={e.path}>
                    <button
                      type="button"
                      onClick={() => go(e.path)}
                      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm hover:bg-panel-2"
                    >
                      <Folder className="size-4 text-source" />
                      <span className="flex-1 truncate">{e.name}</span>
                      <ChevronRight className="size-4 text-faint" />
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
                    <Film className="size-4 text-muted" />
                    <span className="flex-1 truncate">{e.name}</span>
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
        </div>
      </div>
    </div>
  );
}
