import type { ApiCall, JobLog, LogLevel } from '../../shared/types.js';
import { getDb, schema } from '../db/client.js';
import { logger } from '../logger.js';
import { bus } from './events.js';

/** Writes a log line to `job_logs`, the console and the SSE stream. */
export function logJob(
  jobId: number,
  level: LogLevel,
  stage: string | null,
  message: string,
  data?: unknown,
): void {
  const row = getDb()
    .insert(schema.jobLogs)
    .values({ jobId, level, stage, message, data: data === undefined ? null : (data as object) })
    .returning()
    .get();
  logger[level === 'debug' ? 'debug' : level]({ jobId, stage }, message);
  const log: JobLog = {
    id: row.id,
    jobId,
    ts: row.ts,
    level,
    stage,
    message,
    data: row.data ?? null,
  };
  bus.emit({ type: 'job.log', log });
}

export type JobLogger = (level: LogLevel, message: string, data?: unknown) => void;

export function jobLogger(jobId: number, stage: () => string | null): JobLogger {
  return (level, message, data) => logJob(jobId, level, stage(), message, data);
}

export interface ApiCallRecord {
  jobId: number | null;
  kind: ApiCall['kind'];
  model: string;
  requestMs: number;
  tokensIn?: number;
  tokensOut?: number;
  audioTokens?: number;
  costUsd?: number;
  status: 'ok' | 'error';
  error?: string | null;
}

export function recordApiCall(rec: ApiCallRecord): void {
  getDb()
    .insert(schema.apiCalls)
    .values({
      jobId: rec.jobId,
      kind: rec.kind,
      model: rec.model,
      requestMs: Math.round(rec.requestMs),
      tokensIn: rec.tokensIn ?? 0,
      tokensOut: rec.tokensOut ?? 0,
      audioTokens: rec.audioTokens ?? 0,
      costUsd: rec.costUsd ?? 0,
      status: rec.status,
      error: rec.error ?? null,
    })
    .run();
}
