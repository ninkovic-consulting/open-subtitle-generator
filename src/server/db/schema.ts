import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull(),
  defaultSourceLang: text('default_source_lang').notNull().default('auto'),
  defaultTargetLang: text('default_target_lang').notNull().default('hr'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
});

export const mediaFiles = sqliteTable(
  'media_files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    path: text('path').notNull().unique(),
    fileName: text('file_name').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    durationSec: real('duration_sec'),
    audioTracks: text('audio_tracks', { mode: 'json' }).notNull().default('[]'),
    subtitleTracks: text('subtitle_tracks', { mode: 'json' }).notNull().default('[]'),
    addedAt: integer('added_at').notNull().default(now),
  },
  (t) => [index('media_files_project_idx').on(t.projectId)],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaFileId: integer('media_file_id')
      .notNull()
      .references(() => mediaFiles.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('queued'),
    stage: text('stage'),
    progress: real('progress').notNull().default(0),
    sourceLang: text('source_lang').notNull().default('auto'),
    detectedLang: text('detected_lang'),
    targetLang: text('target_lang').notNull(),
    timingSource: text('timing_source'),
    sttModel: text('stt_model'),
    translateModel: text('translate_model'),
    options: text('options', { mode: 'json' }).notNull().default('{}'),
    outputPath: text('output_path'),
    outputPaths: text('output_paths', { mode: 'json' }).notNull().default('[]'),
    outputEncoding: text('output_encoding'),
    costUsd: real('cost_usd').notNull().default(0),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    audioSeconds: real('audio_seconds').notNull().default(0),
    error: text('error'),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('jobs_media_idx').on(t.mediaFileId), index('jobs_status_idx').on(t.status)],
);

export const jobLogs = sqliteTable(
  'job_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    ts: integer('ts').notNull().default(now),
    level: text('level').notNull(),
    stage: text('stage'),
    message: text('message').notNull(),
    data: text('data', { mode: 'json' }),
  },
  (t) => [index('job_logs_job_idx').on(t.jobId)],
);

export const apiCalls = sqliteTable(
  'api_calls',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    model: text('model').notNull(),
    requestMs: integer('request_ms').notNull().default(0),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    audioTokens: integer('audio_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    status: text('status').notNull(),
    error: text('error'),
    ts: integer('ts').notNull().default(now),
  },
  (t) => [index('api_calls_job_idx').on(t.jobId), index('api_calls_ts_idx').on(t.ts)],
);

export const subtitles = sqliteTable(
  'subtitles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    language: text('language').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('subtitles_job_idx').on(t.jobId)],
);

export const cues = sqliteTable(
  'cues',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    subtitleId: integer('subtitle_id')
      .notNull()
      .references(() => subtitles.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    text: text('text').notNull(),
    speakerGender: text('speaker_gender').notNull().default('u'),
    sourceCueId: integer('source_cue_id'),
    edited: integer('edited').notNull().default(0),
  },
  (t) => [index('cues_subtitle_idx').on(t.subtitleId, t.idx)],
);

export const glossaries = sqliteTable('glossaries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  data: text('data', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at').notNull().default(now),
});
