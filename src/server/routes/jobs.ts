import fs from 'node:fs';
import path from 'node:path';
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { findLanguage, languageName } from '../../shared/languages.js';
import {
  JOB_STATUSES,
  LOG_LEVELS,
  createJobsSchema,
  cueUpdateSchema,
  estimateSchema,
  exportSchema,
  retranslateSchema,
  type ApiCall,
  type EstimateResponse,
  type FileEstimate,
  type JobLog,
  type JobOptions,
  type LogLevel,
  type SubtitlePair,
} from '../../shared/types.js';
import { getDb, schema } from '../db/client.js';
import { HttpError, notFound, paramId, parse } from '../http.js';
import { estimateCost } from '../services/cost.js';
import { bus } from '../services/events.js';
import { commonDirectory, resolveUserPath } from '../services/fs-browser.js';
import { logJob } from '../services/joblog.js';
import { findSidecars, isVideoFile, probe } from '../services/media.js';
import { getModelPricing } from '../services/models.js';
import type { JobQueue } from '../services/queue.js';
import {
  externalSidecars,
  getJob,
  getMediaFile,
  getSubtitle,
  listJobs,
  toCue,
  updateJob,
  upsertMediaFile,
} from '../services/repo.js';
import { retranslateCuesInPlace } from '../services/retranslate.js';
import { loadSettings } from '../services/settings.js';
import { renderVtt } from '../services/srt.js';
import { mapLimit } from '../services/stt.js';
import { outputPathFor, writeSubtitleFile } from '../services/writer.js';
import { projectNameFor, scanProject } from './projects.js';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Finds or creates the project for a set of picked files (project root = common folder). */
async function resolveProjectForPaths(
  paths: string[],
  projectId?: number,
  projectName?: string,
): Promise<number> {
  const db = getDb();
  if (projectId) {
    if (!db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get())
      notFound('Project');
    return projectId;
  }
  const root = commonDirectory(paths);
  const existing = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.rootPath, root))
    .get();
  if (existing) return existing.id;
  const settings = loadSettings();
  const row = db
    .insert(schema.projects)
    .values({
      name: projectName || projectNameFor(root),
      rootPath: root,
      defaultSourceLang: settings.defaultSourceLang,
      defaultTargetLang: settings.defaultTargetLang,
    })
    .returning()
    .get();
  return row.id;
}

function validateVideoPaths(paths: string[]): string[] {
  return paths.map((p) => {
    const abs = resolveUserPath(p);
    if (!isVideoFile(abs))
      throw new HttpError(400, `Not a supported video file: ${path.basename(abs)}`);
    if (!fs.existsSync(abs)) throw new HttpError(404, `File not found: ${abs}`);
    return abs;
  });
}

export async function jobRoutes(app: FastifyInstance, opts: { queue: JobQueue }): Promise<void> {
  const { queue } = opts;

  app.post('/api/jobs/estimate', async (req): Promise<EstimateResponse> => {
    const body = parse(estimateSchema, req.body);
    const settings = loadSettings();
    const o = body.options;
    const targetLang = body.targetLang ?? settings.defaultTargetLang;
    const naming = o.naming ?? settings.naming;
    const useExisting = o.useExistingSubtitles ?? settings.useExistingSubtitles;
    const useAudio =
      (o.useVoiceForGender ?? settings.useVoiceForGender) &&
      (settings.translation.provider === 'openrouter' || settings.translation.audioInput);
    const sttModel = o.sttModel || settings.stt.model;
    const chatModel = o.translateModel || settings.translation.model;
    const sttIsCustom = settings.stt.provider === 'custom';
    const chatIsCustom = settings.translation.provider === 'custom';
    const [sttPricing, chatPricing] = await Promise.all([
      sttIsCustom ? null : getModelPricing(sttModel, 'stt'),
      chatIsCustom ? null : getModelPricing(chatModel, 'chat'),
    ]);

    const items: string[] = [...(body.paths ? validateVideoPaths(body.paths) : [])];
    for (const id of body.mediaFileIds ?? []) {
      const m = getMediaFile(id);
      if (m) items.push(m.path);
    }
    let pricingKnown = true;
    const files = await mapLimit(items, 4, async (p): Promise<FileEstimate> => {
      const base: FileEstimate = {
        path: p,
        fileName: path.basename(p),
        durationSec: null,
        timingSource: 'stt',
        timingDetail: null,
        sttUsd: 0,
        translateUsd: 0,
        totalUsd: 0,
        existingOutput: null,
      };
      try {
        const info = await probe(p);
        const out = outputPathFor(p, targetLang, naming);
        base.existingOutput = fs.existsSync(out) ? path.basename(out) : null;
        base.durationSec = info.durationSec;
        if (useExisting) {
          const targetIso = findLanguage(targetLang)?.iso ?? targetLang;
          const mediaId =
            getDb()
              .select({ id: schema.mediaFiles.id })
              .from(schema.mediaFiles)
              .where(eq(schema.mediaFiles.path, p))
              .get()?.id ?? null;
          const sidecar = externalSidecars(p, mediaId).find(
            (s) => path.resolve(s.path) !== path.resolve(out) && s.language !== targetIso,
          );
          const track = info.subtitleTracks.find((t) => t.textBased && t.language !== targetIso);
          if (sidecar) {
            base.timingSource = 'sidecar_srt';
            base.timingDetail = path.basename(sidecar.path);
          } else if (track) {
            base.timingSource = 'embedded_srt';
            base.timingDetail = `Track #${track.index} (${track.codec}${track.language ? `, ${track.language}` : ''})`;
          }
        }
        const est = estimateCost({
          durationSec: info.durationSec ?? 0,
          needsStt: base.timingSource === 'stt',
          useAudio,
          batchSize: o.batchSize ?? settings.batchSize,
          sttPricing,
          chatPricing,
          sttIsCustom,
          chatIsCustom,
        });
        if (!est.pricingKnown) pricingKnown = false;
        return {
          ...base,
          sttUsd: est.sttUsd,
          translateUsd: est.translateUsd,
          totalUsd: est.totalUsd,
        };
      } catch (err) {
        return { ...base, error: (err as Error).message };
      }
    });
    return {
      files,
      totalUsd: files.reduce((s, f) => s + f.totalUsd, 0),
      totalDurationSec: files.reduce((s, f) => s + (f.durationSec ?? 0), 0),
      pricingKnown,
    };
  });

  app.post('/api/jobs', async (req) => {
    const body = parse(createJobsSchema, req.body);
    const settings = loadSettings();
    const mediaIds: number[] = [...(body.mediaFileIds ?? [])];
    if (body.paths?.length) {
      const paths = validateVideoPaths(body.paths);
      const projectId = await resolveProjectForPaths(paths, body.projectId, body.projectName);
      const rows = await mapLimit(paths, 4, (p) =>
        upsertMediaFile(projectId, p, fs.statSync(p).size),
      );
      mediaIds.push(...rows.map((r) => r.id));
      // Make the whole folder visible in the project, not only the picked files.
      void scanProject(projectId, commonDirectory(paths)).catch(() => undefined);
    }
    const options: JobOptions = body.options;
    const created = [];
    for (const mediaFileId of [...new Set(mediaIds)]) {
      if (!getMediaFile(mediaFileId)) continue;
      const row = getDb()
        .insert(schema.jobs)
        .values({
          mediaFileId,
          status: 'queued',
          sourceLang: body.sourceLang || 'auto',
          targetLang: body.targetLang,
          options,
          sttModel: options.sttModel || settings.stt.model,
          translateModel: options.translateModel || settings.translation.model,
        })
        .returning()
        .get();
      const job = getJob(row.id)!;
      bus.emit({ type: 'job.update', job });
      logJob(
        job.id,
        'info',
        null,
        `Queued: ${job.fileName} → ${options.targetLangName || languageName(job.targetLang)}`,
      );
      created.push(job);
    }
    queue.enqueue();
    return { jobs: created };
  });

  app.get('/api/jobs', async (req) => {
    const q = parse(
      z.object({
        status: z.string().optional(),
        projectId: z.coerce.number().int().optional(),
        mediaFileId: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().min(1).max(1000).optional(),
      }),
      req.query,
    );
    const status = q.status
      ?.split(',')
      .filter((s): s is (typeof JOB_STATUSES)[number] =>
        (JOB_STATUSES as readonly string[]).includes(s),
      );
    return {
      jobs: listJobs({
        status,
        projectId: q.projectId,
        mediaFileId: q.mediaFileId,
        limit: q.limit,
      }),
    };
  });

  app.get('/api/jobs/:id', async (req) => ({ job: getJob(paramId(req)) ?? notFound('Job') }));

  /** Cancels a job. With `?remove=1` also deletes it (and its logs/subtitles) from history. */
  app.delete('/api/jobs/:id', async (req) => {
    const id = paramId(req);
    const { remove } = parse(z.object({ remove: z.coerce.boolean().optional() }), req.query);
    const job = getJob(id) ?? notFound('Job');
    if (job.status === 'queued' || job.status === 'running') queue.cancel(id);
    if (remove) {
      if (queue.isRunning(id))
        throw new HttpError(409, 'Job is still stopping, try again in a moment');
      getDb().delete(schema.jobs).where(eq(schema.jobs.id, id)).run();
      bus.emit({ type: 'job.deleted', jobId: id });
      return { ok: true };
    }
    return { job: getJob(id) };
  });

  app.post('/api/jobs/:id/retry', async (req) => {
    const id = paramId(req);
    const body = parse(
      z.object({
        fromStage: z
          .enum(['probe', 'extract', 'transcribe', 'context', 'translate', 'write'])
          .optional(),
      }),
      req.body ?? {},
    );
    const job = getJob(id) ?? notFound('Job');
    if (job.status === 'running' || job.status === 'queued')
      throw new HttpError(409, 'Job is already queued or running');
    const options: JobOptions = { ...job.options, fromStage: body.fromStage };
    // The user explicitly asked to run again: replace the subtitle this job wrote before.
    if (job.outputPath && fs.existsSync(job.outputPath)) options.overwrite = true;
    updateJob(id, { status: 'queued', progress: 0, error: null, finishedAt: null, options });
    logJob(
      id,
      'info',
      null,
      body.fromStage ? `Retry requested from stage "${body.fromStage}"` : 'Retry requested',
    );
    queue.enqueue();
    return { job: getJob(id) };
  });

  app.get('/api/jobs/:id/logs', async (req) => {
    const id = paramId(req);
    const q = parse(
      z.object({
        level: z.enum(LOG_LEVELS).optional(),
        after: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().max(20000).optional(),
      }),
      req.query,
    );
    const conds = [eq(schema.jobLogs.jobId, id)];
    if (q.after) conds.push(gt(schema.jobLogs.id, q.after));
    const rows = getDb()
      .select()
      .from(schema.jobLogs)
      .where(and(...conds))
      .orderBy(asc(schema.jobLogs.id))
      .limit(q.limit ?? 5000)
      .all();
    const min = q.level ? LEVEL_ORDER[q.level] : 0;
    const logs: JobLog[] = rows
      .filter((r) => LEVEL_ORDER[r.level as LogLevel] >= min)
      .map((r) => ({
        id: r.id,
        jobId: r.jobId,
        ts: r.ts,
        level: r.level as LogLevel,
        stage: r.stage,
        message: r.message,
        data: r.data,
      }));
    return { logs };
  });

  app.get('/api/jobs/:id/calls', async (req) => {
    const id = paramId(req);
    const rows = getDb()
      .select()
      .from(schema.apiCalls)
      .where(eq(schema.apiCalls.jobId, id))
      .orderBy(desc(schema.apiCalls.id))
      .all();
    const calls: ApiCall[] = rows.map((r) => ({
      ...r,
      kind: r.kind as ApiCall['kind'],
      status: r.status as ApiCall['status'],
    }));
    return { calls };
  });

  app.get('/api/jobs/:id/subtitles', async (req): Promise<SubtitlePair> => {
    const id = paramId(req);
    const job = getJob(id) ?? notFound('Job');
    return { job, source: getSubtitle(id, 'source'), translated: getSubtitle(id, 'translated') };
  });

  app.get('/api/jobs/:id/vtt', async (req, reply) => {
    const id = paramId(req);
    const { kind } = parse(
      z.object({
        kind: z.enum(['source', 'translated']).default('translated'),
        token: z.string().optional(),
      }),
      req.query,
    );
    const sub = getSubtitle(id, kind) ?? notFound('Subtitle');
    reply.header('Content-Type', 'text/vtt; charset=utf-8');
    return renderVtt(sub.cues);
  });

  app.patch('/api/cues/:id', async (req) => {
    const id = paramId(req);
    const body = parse(cueUpdateSchema, req.body);
    const db = getDb();
    const existing =
      db.select().from(schema.cues).where(eq(schema.cues.id, id)).get() ?? notFound('Cue');
    const startMs = body.startMs ?? existing.startMs;
    const endMs = body.endMs ?? existing.endMs;
    if (endMs <= startMs) throw new HttpError(400, 'End time must be after start time');
    const row = db
      .update(schema.cues)
      .set({
        text: body.text ?? existing.text,
        startMs,
        endMs,
        speakerGender: body.speakerGender ?? existing.speakerGender,
        edited: 1,
      })
      .where(eq(schema.cues.id, id))
      .returning()
      .get();
    return { cue: toCue(row!) };
  });

  app.post('/api/jobs/:id/export', async (req) => {
    const id = paramId(req);
    const body = parse(exportSchema, req.body ?? {});
    const job = getJob(id) ?? notFound('Job');
    const sub = getSubtitle(id, 'translated') ?? notFound('Translated subtitle');
    const settings = loadSettings();
    const sidecars =
      job.timingSource === 'sidecar_srt'
        ? findSidecars(job.filePath)
            .map((s) => s.path)
            .filter((p) => p !== job.outputPath)
        : [];
    const written = writeSubtitleFile({
      videoPath: job.filePath,
      cues: sub.cues,
      targetLang: job.targetLang,
      encoding: body.encoding ?? job.options.encoding ?? settings.encoding,
      naming: body.naming ?? job.options.naming ?? settings.naming,
      overwrite: body.overwrite,
      protectedPaths: sidecars,
    });
    updateJob(id, { outputPath: written.path, outputEncoding: written.encoding });
    logJob(id, 'info', 'write', `Exported ${path.basename(written.path)} (${written.encoding})`);
    return { path: written.path, encoding: written.encoding, fellBack: written.fellBack };
  });

  app.post('/api/jobs/:id/retranslate', async (req) => {
    const id = paramId(req);
    const body = parse(retranslateSchema, req.body ?? {});
    const job = getJob(id) ?? notFound('Job');
    if (body.cueIds?.length) {
      const cues = await retranslateCuesInPlace(id, body.cueIds, body.translateModel);
      return { cues, job: getJob(id) };
    }
    const source = getSubtitle(id, 'source');
    if (!source?.cues.length) throw new HttpError(400, 'This job has no source cues to re-use');
    const targetLang = body.targetLang ?? job.targetLang;
    const options: JobOptions = {
      ...job.options,
      ...body.options,
      translateModel:
        body.translateModel ?? body.options?.translateModel ?? job.options.translateModel,
      reuseSourceFromJobId: id,
      fromStage: undefined,
    };
    if (targetLang !== job.targetLang) options.targetLangName = body.options?.targetLangName;
    if (targetLang === job.targetLang && job.outputPath) options.overwrite = true;
    const row = getDb()
      .insert(schema.jobs)
      .values({
        mediaFileId: job.mediaFileId,
        status: 'queued',
        sourceLang: job.detectedLang ?? job.sourceLang,
        targetLang,
        options,
        translateModel: options.translateModel || loadSettings().translation.model,
      })
      .returning()
      .get();
    const created = getJob(row.id)!;
    bus.emit({ type: 'job.update', job: created });
    logJob(
      created.id,
      'info',
      null,
      `Re-translation of job #${id} → ${options.targetLangName || languageName(targetLang)}`,
    );
    queue.enqueue();
    return { job: created };
  });

  /** Bulk cancel, used by the dashboard. */
  app.post('/api/jobs/cancel-all', async () => {
    const active = getDb()
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(inArray(schema.jobs.status, ['queued', 'running']))
      .all();
    for (const a of active) queue.cancel(a.id);
    return { cancelled: active.length };
  });
}
