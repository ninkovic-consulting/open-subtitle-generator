import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FsEntry, FsListResponse, FsRoot, FsSearchResponse } from '../../shared/types.js';
import { SUBTITLE_EXTENSIONS, VIDEO_EXTENSIONS } from './media.js';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export class FsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Resolves and validates a user-supplied absolute path. */
export function resolveUserPath(p: string): string {
  if (!p || typeof p !== 'string') throw new FsError('Path is required');
  const expanded = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
  if (!path.isAbsolute(expanded)) throw new FsError('Path must be absolute');
  return path.resolve(expanded);
}

/** Lists a directory, exposing only folders, video files and .srt files. Hidden entries are skipped. */
export function listDirectory(dir: string): FsListResponse {
  const abs = resolveUserPath(dir);
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(abs, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new FsError('Folder not found', 404);
    if (code === 'EACCES' || code === 'EPERM')
      throw new FsError('Permission denied for this folder', 403);
    if (code === 'ENOTDIR') throw new FsError('Not a folder');
    throw new FsError((err as Error).message);
  }
  const entries: FsEntry[] = [];
  for (const d of dirents) {
    if (d.name.startsWith('.') || d.name.startsWith('$')) continue;
    const full = path.join(abs, d.name);
    let isDir = d.isDirectory();
    let isFile = d.isFile();
    if (d.isSymbolicLink()) {
      try {
        const st = fs.statSync(full);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
    }
    if (isDir) {
      entries.push({ name: d.name, path: full, type: 'dir' });
      continue;
    }
    if (!isFile) continue;
    const ext = path.extname(d.name).toLowerCase();
    const type = VIDEO_EXTENSIONS.has(ext)
      ? 'video'
      : SUBTITLE_EXTENSIONS.has(ext)
        ? 'subtitle'
        : null;
    if (!type) continue;
    let sizeBytes: number | undefined;
    let modifiedAt: number | undefined;
    try {
      const st = fs.statSync(full);
      sizeBytes = st.size;
      modifiedAt = st.mtimeMs;
    } catch {
      // ignore
    }
    entries.push({ name: d.name, path: full, type, sizeBytes, modifiedAt });
  }
  const order = { dir: 0, video: 1, subtitle: 2 } as const;
  entries.sort((a, b) => order[a.type] - order[b.type] || collator.compare(a.name, b.name));
  const parent = path.dirname(abs);
  return {
    path: abs,
    parent: parent === abs ? null : parent,
    entries,
    videoCount: entries.filter((e) => e.type === 'video').length,
  };
}

function existsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Quick-access locations: home, common media folders and mounted volumes. */
export function listRoots(): FsRoot[] {
  const home = os.homedir();
  const roots: FsRoot[] = [{ name: 'Home', path: home, kind: 'home' }];
  for (const name of ['Desktop', 'Movies', 'Videos', 'Downloads', 'Documents']) {
    const p = path.join(home, name);
    if (existsDir(p)) roots.push({ name, path: p, kind: 'folder' });
  }
  const volumes: string[] = [];
  if (process.platform === 'darwin') {
    try {
      for (const v of fs.readdirSync('/Volumes')) volumes.push(path.join('/Volumes', v));
    } catch {
      // ignore
    }
  } else if (process.platform === 'win32') {
    for (let c = 67; c <= 90; c++) {
      const drive = `${String.fromCharCode(c)}:\\`;
      if (existsDir(drive)) volumes.push(drive);
    }
  } else {
    for (const base of [
      `/media/${os.userInfo().username}`,
      '/media',
      '/mnt',
      '/run/media/' + os.userInfo().username,
    ]) {
      try {
        for (const v of fs.readdirSync(base)) {
          const p = path.join(base, v);
          if (existsDir(p) && !volumes.includes(p)) volumes.push(p);
        }
      } catch {
        // ignore
      }
    }
  }
  for (const v of volumes) {
    if (!existsDir(v)) continue;
    roots.push({ name: path.basename(v) || v, path: v, kind: 'volume' });
  }
  return roots;
}

export interface FoundVideo {
  path: string;
  sizeBytes: number;
}

/** Recursively finds video files (max depth 6, skips hidden folders and macOS bundles). */
export function findVideos(root: string, maxDepth = 6, limit = 5000): FoundVideo[] {
  const found: FoundVideo[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || found.length >= limit) return;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (d.name.startsWith('.') || d.name.startsWith('$')) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (/\.(app|bundle|photoslibrary)$/i.test(d.name)) continue;
        walk(full, depth + 1);
      } else if (d.isFile() && VIDEO_EXTENSIONS.has(path.extname(d.name).toLowerCase())) {
        if (/(^|[.\s_-])sample([.\s_-]|$)/i.test(d.name)) continue;
        try {
          found.push({ path: full, sizeBytes: fs.statSync(full).size });
        } catch {
          // ignore
        }
      }
    }
  };
  walk(resolveUserPath(root), 0);
  return found.sort((a, b) => collator.compare(a.path, b.path));
}

/** Case- and accent-insensitive form used for name matching ("Čarobnjak" matches "carob"). */
export function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Recursive name search below `root` for folders and video files. Every word of the query must
 * appear in the name. Bounded by depth, result count, visited folders and time.
 */
export function searchEntries(
  root: string,
  query: string,
  opts: { maxDepth?: number; limit?: number; maxDirs?: number; timeMs?: number } = {},
): FsSearchResponse {
  const base = resolveUserPath(root);
  const words = foldName(query).split(/\s+/).filter(Boolean);
  const maxDepth = opts.maxDepth ?? 6;
  const limit = opts.limit ?? 300;
  const maxDirs = opts.maxDirs ?? 20_000;
  const deadline = Date.now() + (opts.timeMs ?? 4000);
  const entries: FsEntry[] = [];
  let visited = 0;
  let truncated = false;
  if (!words.length) return { path: base, query, entries, truncated };
  const matches = (name: string) => {
    const n = foldName(name);
    return words.every((w) => n.includes(w));
  };
  const walk = (dir: string, depth: number) => {
    if (truncated) return;
    if (entries.length >= limit || visited >= maxDirs || Date.now() > deadline) {
      truncated = true;
      return;
    }
    visited++;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs: string[] = [];
    for (const d of dirents) {
      if (d.name.startsWith('.') || d.name.startsWith('$')) continue;
      const full = path.join(dir, d.name);
      const relativeDir = path.relative(base, dir);
      if (d.isDirectory()) {
        if (/\.(app|bundle|photoslibrary)$/i.test(d.name)) continue;
        if (matches(d.name)) entries.push({ name: d.name, path: full, type: 'dir', relativeDir });
        subdirs.push(full);
      } else if (
        d.isFile() &&
        VIDEO_EXTENSIONS.has(path.extname(d.name).toLowerCase()) &&
        matches(d.name)
      ) {
        let sizeBytes: number | undefined;
        try {
          sizeBytes = fs.statSync(full).size;
        } catch {
          // ignore
        }
        entries.push({ name: d.name, path: full, type: 'video', sizeBytes, relativeDir });
      }
      if (entries.length >= limit) {
        truncated = true;
        return;
      }
    }
    if (depth < maxDepth) for (const sub of subdirs) walk(sub, depth + 1);
  };
  walk(base, 0);
  const order = { dir: 0, video: 1, subtitle: 2 } as const;
  entries.sort((a, b) => order[a.type] - order[b.type] || collator.compare(a.name, b.name));
  return { path: base, query, entries, truncated };
}

/** Longest common directory of the given absolute paths. */
export function commonDirectory(paths: string[]): string {
  if (paths.length === 0) return os.homedir();
  const split = paths.map((p) => path.dirname(p).split(path.sep));
  const first = split[0]!;
  let n = first.length;
  for (const parts of split.slice(1)) {
    let i = 0;
    while (i < n && i < parts.length && parts[i] === first[i]) i++;
    n = i;
  }
  const joined = first.slice(0, n).join(path.sep);
  return joined || path.parse(paths[0]!).root;
}
