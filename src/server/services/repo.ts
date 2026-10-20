import path from 'node:path';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  EMPTY_GLOSSARY,
  glossarySchema,
  type AudioTrack,
  type Cue,
  type Gender,
  type Glossary,
  type Job,
  type JobOptions,
  type JobStage,
  type JobStatus,
  type MediaFile,
  type Project,
  type SubtitleTrack,
  type TimingSource,
} from '../../shared/types.js';
import { getDb, schema } from '../db/client.js';
import { bus } from './events.js';
import { findSidecars, probe } from './media.js';

type JobRow = typeof schema.jobs.$inferSelect;
type MediaRow = typeof schema.mediaFiles.$inferSelect;

export function toJob(row: JobRow, media?: Pick<MediaRow, 'fileName' | 'path' | 'projectId'>): Job {
  return {
    id: row.id,
    mediaFileId: row.mediaFileId,
    projectId: media?.projectId ?? null,
    fileName: media?.fileName ?? '',
    filePath: media?.path ?? '',
    status: row.status as JobStatus,
    stage: (row.stage as JobStage | null) ?? null,
    progress: row.progress,
    sourceLang: row.sourceLang,
    detectedLang: row.detectedLang,
    targetLang: row.targetLang,
    timingSource: (row.timingSource as TimingSource | null) ?? null,
    sttModel: row.sttModel,
    translateModel: row.translateModel,
    options: (row.options ?? {}) as JobOptions,
    outputPath: row.outputPath,
    outputEncoding: row.outputEncoding,
    costUsd: row.costUsd,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    audioSeconds: row.audioSeconds,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

const jobSelect = () =>
  getDb()
    .select({
      job: schema.jobs,
      fileName: schema.mediaFiles.fileName,
      path: schema.mediaFiles.path,
      projectId: schema.mediaFiles.projectId,
    })
    .from(schema.jobs)
    .innerJoin(schema.mediaFiles, eq(schema.jobs.mediaFileId, schema.mediaFiles.id));

export function getJob(id: number): Job | null {
  const row = jobSelect().where(eq(schema.jobs.id, id)).get();
  return row ? toJob(row.job, row) : null;
}

export function listJobs(
  filter: { status?: JobStatus[]; projectId?: number; mediaFileId?: number; limit?: number } = {},
): Job[] {
  const conds = [];
  if (filter.status?.length) conds.push(inArray(schema.jobs.status, filter.status));
  if (filter.projectId) conds.push(eq(schema.mediaFiles.projectId, filter.projectId));
  if (filter.mediaFileId) conds.push(eq(schema.jobs.mediaFileId, filter.mediaFileId));
  const rows = jobSelect()
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.jobs.createdAt), desc(schema.jobs.id))
    .limit(filter.limit ?? 500)
    .all();
  return rows.map((r) => toJob(r.job, r));
}

/** Updates a job row and broadcasts `job.update`. */
export function updateJob(id: number, patch: Partial<typeof schema.jobs.$inferInsert>): Job | null {
  getDb().update(schema.jobs).set(patch).where(eq(schema.jobs.id, id)).run();
  const job = getJob(id);
  if (job) bus.emit({ type: 'job.update', job });
  return job;
}

export function addJobCost(
  id: number,
  delta: { costUsd?: number; tokensIn?: number; tokensOut?: number; audioSeconds?: number },
): void {
  getDb()
    .update(schema.jobs)
    .set({
      costUsd: sql`${schema.jobs.costUsd} + ${delta.costUsd ?? 0}`,
      tokensIn: sql`${schema.jobs.tokensIn} + ${Math.round(delta.tokensIn ?? 0)}`,
      tokensOut: sql`${schema.jobs.tokensOut} + ${Math.round(delta.tokensOut ?? 0)}`,
      audioSeconds: sql`${schema.jobs.audioSeconds} + ${delta.audioSeconds ?? 0}`,
    })
    .where(eq(schema.jobs.id, id))
    .run();
}

// ---------------------------------------------------------------------------
// Projects & media files
// ---------------------------------------------------------------------------

export function listProjects(): Project[] {
  const db = getDb();
  const rows = db.select().from(schema.projects).orderBy(desc(schema.projects.updatedAt)).all();
  const fileCounts = db
    .select({ projectId: schema.mediaFiles.projectId, n: sql<number>`count(*)` })
    .from(schema.mediaFiles)
    .groupBy(schema.mediaFiles.projectId)
    .all();
  const done = db
    .select({
      projectId: schema.mediaFiles.projectId,
      n: sql<number>`count(distinct ${schema.jobs.mediaFileId})`,
    })
    .from(schema.jobs)
    .innerJoin(schema.mediaFiles, eq(schema.jobs.mediaFileId, schema.mediaFiles.id))
    .where(eq(schema.jobs.status, 'done'))
    .groupBy(schema.mediaFiles.projectId)
    .all();
  const cost = db
    .select({
      projectId: schema.mediaFiles.projectId,
      usd: sql<number>`coalesce(sum(${schema.jobs.costUsd}), 0)`,
    })
    .from(schema.jobs)
    .innerJoin(schema.mediaFiles, eq(schema.jobs.mediaFileId, schema.mediaFiles.id))
    .groupBy(schema.mediaFiles.projectId)
    .all();
  const m = <T extends { projectId: number }>(arr: T[]) =>
    new Map(arr.map((r) => [r.projectId, r]));
  const fc = m(fileCounts);
  const dc = m(done);
  const cc = m(cost);
  return rows.map((p) => ({
    ...p,
    fileCount: Number(fc.get(p.id)?.n ?? 0),
    doneCount: Number(dc.get(p.id)?.n ?? 0),
    costUsd: Number(cc.get(p.id)?.usd ?? 0),
  }));
}

export function getProject(id: number): Project | null {
  return listProjects().find((p) => p.id === id) ?? null;
}

/** Subtitle files OSG wrote itself for a video; they are not "existing subtitles". */
export function osgOutputPaths(mediaFileId: number): Set<string> {
  const rows = getDb()
    .select({ p: schema.jobs.outputPath })
    .from(schema.jobs)
    .where(eq(schema.jobs.mediaFileId, mediaFileId))
    .all();
  return new Set(
    rows
      .map((r) => r.p)
      .filter((p): p is string => !!p)
      .map((p) => path.resolve(p)),
  );
}

/** Sidecar subtitles next to a video, excluding files OSG generated. */
export function externalSidecars(videoPath: string, mediaFileId: number | null) {
  const own = mediaFileId ? osgOutputPaths(mediaFileId) : new Set<string>();
  return findSidecars(videoPath).filter(
    (s) => !own.has(path.resolve(s.path)) && !/\.osg\.srt$/i.test(s.path),
  );
}

export function toMediaFile(row: MediaRow, latestJob: Job | null): MediaFile {
  return {
    id: row.id,
    projectId: row.projectId,
    path: row.path,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    durationSec: row.durationSec,
    audioTracks: (row.audioTracks ?? []) as AudioTrack[],
    subtitleTracks: (row.subtitleTracks ?? []) as SubtitleTrack[],
    sidecarSubtitles: externalSidecars(row.path, row.id).map((s) => path.basename(s.path)),
    addedAt: row.addedAt,
    latestJob,
  };
}

export function listMediaFiles(projectId: number): MediaFile[] {
  const rows = getDb()
    .select()
    .from(schema.mediaFiles)
    .where(eq(schema.mediaFiles.projectId, projectId))
    .orderBy(asc(schema.mediaFiles.fileName))
    .all();
  const jobs = listJobs({ projectId });
  const latest = new Map<number, Job>();
  for (const j of jobs) if (!latest.has(j.mediaFileId)) latest.set(j.mediaFileId, j);
  return rows
    .map((r) => toMediaFile(r, latest.get(r.id) ?? null))
    .sort((a, b) =>
      a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' }),
    );
}

export function getMediaFile(id: number): MediaRow | undefined {
  return getDb().select().from(schema.mediaFiles).where(eq(schema.mediaFiles.id, id)).get();
}

/** Inserts or refreshes a media file (probing it with ffprobe). */
export async function upsertMediaFile(
  projectId: number,
  filePath: string,
  sizeBytes: number,
): Promise<MediaRow> {
  const db = getDb();
  const existing = db
    .select()
    .from(schema.mediaFiles)
    .where(eq(schema.mediaFiles.path, filePath))
    .get();
  if (existing && existing.durationSec && existing.sizeBytes === sizeBytes) {
    if (existing.projectId !== projectId) {
      db.update(schema.mediaFiles)
        .set({ projectId })
        .where(eq(schema.mediaFiles.id, existing.id))
        .run();
      return { ...existing, projectId };
    }
    return existing;
  }
  const info = await probe(filePath).catch(() => null);
  const values = {
    projectId,
    path: filePath,
    fileName: path.basename(filePath),
    sizeBytes,
    durationSec: info?.durationSec ?? null,
    audioTracks: info?.audioTracks ?? [],
    subtitleTracks: info?.subtitleTracks ?? [],
  };
  if (existing) {
    db.update(schema.mediaFiles).set(values).where(eq(schema.mediaFiles.id, existing.id)).run();
    return { ...existing, ...values };
  }
  return db.insert(schema.mediaFiles).values(values).returning().get();
}

// ---------------------------------------------------------------------------
// Subtitles & cues
// ---------------------------------------------------------------------------

type CueRow = typeof schema.cues.$inferSelect;

export function toCue(r: CueRow): Cue {
  return {
    id: r.id,
    subtitleId: r.subtitleId,
    idx: r.idx,
    startMs: r.startMs,
    endMs: r.endMs,
    text: r.text,
    speakerGender: (r.speakerGender as Gender) ?? 'u',
    sourceCueId: r.sourceCueId,
    edited: r.edited === 1,
  };
}

export function getSubtitle(
  jobId: number,
  kind: 'source' | 'translated',
): { id: number; language: string; cues: Cue[] } | null {
  const db = getDb();
  const sub = db
    .select()
    .from(schema.subtitles)
    .where(and(eq(schema.subtitles.jobId, jobId), eq(schema.subtitles.kind, kind)))
    .orderBy(desc(schema.subtitles.id))
    .get();
  if (!sub) return null;
  const cues = db
    .select()
    .from(schema.cues)
    .where(eq(schema.cues.subtitleId, sub.id))
    .orderBy(asc(schema.cues.idx))
    .all();
  return { id: sub.id, language: sub.language, cues: cues.map(toCue) };
}

export interface NewCue {
  startMs: number;
  endMs: number;
  text: string;
  speakerGender?: Gender;
  sourceCueId?: number | null;
}

/** Replaces the job's subtitle of the given kind with new cues. Returns the subtitle id and cue ids. */
export function saveSubtitle(
  jobId: number,
  kind: 'source' | 'translated',
  language: string,
  cues: NewCue[],
): { id: number; cueIds: number[] } {
  const db = getDb();
  return db.transaction((tx) => {
    tx.delete(schema.subtitles)
      .where(and(eq(schema.subtitles.jobId, jobId), eq(schema.subtitles.kind, kind)))
      .run();
    const sub = tx.insert(schema.subtitles).values({ jobId, kind, language }).returning().get();
    const cueIds: number[] = [];
    cues.forEach((c, i) => {
      const row = tx
        .insert(schema.cues)
        .values({
          subtitleId: sub.id,
          idx: i + 1,
          startMs: Math.round(c.startMs),
          endMs: Math.round(c.endMs),
          text: c.text,
          speakerGender: c.speakerGender ?? 'u',
          sourceCueId: c.sourceCueId ?? null,
        })
        .returning({ id: schema.cues.id })
        .get();
      cueIds.push(row.id);
    });
    return { id: sub.id, cueIds };
  });
}

export function deleteSubtitles(jobId: number, kinds: ('source' | 'translated')[]): void {
  getDb()
    .delete(schema.subtitles)
    .where(and(eq(schema.subtitles.jobId, jobId), inArray(schema.subtitles.kind, kinds)))
    .run();
}

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

export function getGlossary(projectId: number): Glossary {
  const row = getDb()
    .select()
    .from(schema.glossaries)
    .where(eq(schema.glossaries.projectId, projectId))
    .get();
  if (!row) return structuredClone(EMPTY_GLOSSARY);
  const parsed = glossarySchema.safeParse(row.data);
  return parsed.success ? parsed.data : structuredClone(EMPTY_GLOSSARY);
}

export function saveGlossary(projectId: number, glossary: Glossary): Glossary {
  const data = glossarySchema.parse(glossary);
  getDb()
    .insert(schema.glossaries)
    .values({ projectId, data })
    .onConflictDoUpdate({
      target: schema.glossaries.projectId,
      set: { data, updatedAt: Date.now() },
    })
    .run();
  return data;
}
