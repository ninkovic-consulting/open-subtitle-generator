import type {
  ApiCall,
  CreateJobsBody,
  DeleteSubtitleResponse,
  Cue,
  EstimateResponse,
  FsListResponse,
  FsSearchResponse,
  FsRoot,
  Glossary,
  Job,
  JobLog,
  JobOptions,
  JobStage,
  MediaFile,
  ModelInfo,
  OutputEncoding,
  Naming,
  Project,
  SettingsResponse,
  SettingsUpdate,
  StatsResponse,
  SubtitlePair,
  TestProviderBody,
  TestProviderResult,
} from '@shared/types';

const token = document.querySelector('meta[name="osg-token"]')?.getAttribute('content') ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

/**
 * Every server start issues a new session token, so a tab opened before a restart gets 401s.
 * Reloading the page fetches the new token. Guarded so a misconfiguration cannot loop.
 */
export function reloadForNewSession(): void {
  try {
    const last = Number(sessionStorage.getItem('osg-reload-at') ?? 0);
    if (Date.now() - last < 15_000) return;
    sessionStorage.setItem('osg-reload-at', String(Date.now()));
  } catch {
    // storage unavailable: reload anyway
  }
  window.location.reload();
}

/** `ok`: token accepted; `expired`: the server restarted; `down`: the server is unreachable. */
export async function checkSession(): Promise<'ok' | 'expired' | 'down'> {
  try {
    const res = await fetch('/api/settings', { headers: { 'x-osg-token': token } });
    return res.status === 401 ? 'expired' : 'ok';
  } catch {
    return 'down';
  }
}

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

export async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; query?: Query } = {},
): Promise<T> {
  const res = await fetch(withQuery(path, opts.query), {
    method,
    headers: {
      'x-osg-token': token,
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) reloadForNewSession();
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg = (json as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return json as T;
}

/** URL usable by EventSource / <video> / <track>, which cannot send headers. */
export function tokenUrl(path: string, query?: Query): string {
  return withQuery(path, { ...query, token });
}

export const api = {
  settings: () => request<SettingsResponse>('GET', '/api/settings'),
  saveSettings: (patch: SettingsUpdate) =>
    request<SettingsResponse>('PUT', '/api/settings', { body: patch }),
  resetSettings: (scope: 'providers' | 'all') =>
    request<SettingsResponse>('POST', '/api/settings/reset', { body: { scope } }),
  testProvider: (body: TestProviderBody) =>
    request<TestProviderResult>('POST', '/api/settings/test-provider', { body }),
  models: (
    kind: 'stt' | 'chat',
    q: { provider?: string; baseUrl?: string; apiKey?: string } = {},
  ) =>
    request<{ models: ModelInfo[]; error?: string }>('GET', '/api/models', {
      query: { kind, ...q },
    }),

  fsRoots: () => request<{ roots: FsRoot[] }>('GET', '/api/fs/roots'),
  fsList: (path: string) => request<FsListResponse>('GET', '/api/fs/list', { query: { path } }),
  fsSearch: (path: string, q: string) =>
    request<FsSearchResponse>('GET', '/api/fs/search', { query: { path, q } }),
  reveal: (path: string) => request<{ ok: true }>('POST', '/api/fs/reveal', { body: { path } }),

  projects: () => request<{ projects: Project[] }>('GET', '/api/projects'),
  project: (id: number) => request<{ project: Project }>('GET', `/api/projects/${id}`),
  createProject: (body: {
    name: string;
    rootPath: string;
    defaultSourceLang?: string;
    defaultTargetLang?: string;
  }) => request<{ project: Project }>('POST', '/api/projects', { body }),
  updateProject: (
    id: number,
    body: Partial<Pick<Project, 'name' | 'defaultSourceLang' | 'defaultTargetLang'>>,
  ) => request<{ project: Project }>('PATCH', `/api/projects/${id}`, { body }),
  deleteProject: (id: number) => request<{ ok: true }>('DELETE', `/api/projects/${id}`),
  scanProject: (id: number) =>
    request<{ found: number; files: MediaFile[] }>('POST', `/api/projects/${id}/scan`),
  projectFiles: (id: number) => request<{ files: MediaFile[] }>('GET', `/api/projects/${id}/files`),
  glossary: (projectId: number) =>
    request<{ glossary: Glossary }>('GET', `/api/glossary/${projectId}`),
  saveGlossary: (projectId: number, glossary: Glossary) =>
    request<{ glossary: Glossary }>('PUT', `/api/glossary/${projectId}`, { body: glossary }),

  estimate: (body: {
    paths?: string[];
    mediaFileIds?: number[];
    options: JobOptions;
    targetLang?: string;
  }) => request<EstimateResponse>('POST', '/api/jobs/estimate', { body }),
  createJobs: (body: CreateJobsBody) => request<{ jobs: Job[] }>('POST', '/api/jobs', { body }),
  jobs: (q: { status?: string; projectId?: number; mediaFileId?: number; limit?: number } = {}) =>
    request<{ jobs: Job[] }>('GET', '/api/jobs', { query: q }),
  job: (id: number) => request<{ job: Job }>('GET', `/api/jobs/${id}`),
  cancelJob: (id: number) => request<{ job: Job }>('DELETE', `/api/jobs/${id}`),
  removeJob: (id: number) =>
    request<{ ok: true }>('DELETE', `/api/jobs/${id}`, { query: { remove: 1 } }),
  deleteSubtitle: (id: number, keepJob: boolean) =>
    request<DeleteSubtitleResponse>('DELETE', `/api/jobs/${id}/subtitle`, {
      query: { keepJob: keepJob ? 1 : 0 },
    }),
  retryJob: (id: number, fromStage?: JobStage) =>
    request<{ job: Job }>('POST', `/api/jobs/${id}/retry`, { body: { fromStage } }),
  logs: (id: number, after?: number) =>
    request<{ logs: JobLog[] }>('GET', `/api/jobs/${id}/logs`, { query: { after } }),
  calls: (id: number) => request<{ calls: ApiCall[] }>('GET', `/api/jobs/${id}/calls`),
  subtitles: (id: number) => request<SubtitlePair>('GET', `/api/jobs/${id}/subtitles`),
  updateCue: (
    id: number,
    patch: Partial<Pick<Cue, 'text' | 'startMs' | 'endMs' | 'speakerGender'>>,
  ) => request<{ cue: Cue }>('PATCH', `/api/cues/${id}`, { body: patch }),
  exportJob: (
    id: number,
    body: {
      encoding?: OutputEncoding;
      naming?: Naming;
      overwrite?: boolean;
      replacePrevious?: boolean;
    },
  ) =>
    request<{
      path: string;
      paths: string[];
      skipped: string[];
      removed: string[];
      encoding: string;
      fellBack: boolean;
    }>('POST', `/api/jobs/${id}/export`, { body }),
  retranslate: (
    id: number,
    body: { cueIds?: number[]; targetLang?: string; translateModel?: string; options?: JobOptions },
  ) => request<{ cues?: Cue[]; job: Job }>('POST', `/api/jobs/${id}/retranslate`, { body }),

  stats: () => request<StatsResponse>('GET', '/api/stats'),
};
