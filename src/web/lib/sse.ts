import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import type { Job, JobLog, ServerEvent } from '@shared/types';
import { checkSession, reloadForNewSession, tokenUrl } from './api';

/** `idle` before the first connection, then `live` or `reconnecting`. */
export type ConnectionState = 'idle' | 'live' | 'reconnecting';

let connection: ConnectionState = 'idle';
const listeners = new Set<() => void>();
function setConnection(next: ConnectionState) {
  if (connection === next) return;
  connection = next;
  listeners.forEach((l) => l());
}

export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => connection,
  );
}

function upsertJob(list: { jobs: Job[] } | undefined, job: Job): { jobs: Job[] } | undefined {
  if (!list) return list;
  const idx = list.jobs.findIndex((j) => j.id === job.id);
  if (idx === -1) return list;
  const jobs = list.jobs.slice();
  jobs[idx] = job;
  return { jobs };
}

let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
function invalidateSoon(qc: QueryClient) {
  if (invalidateTimer) return;
  invalidateTimer = setTimeout(() => {
    invalidateTimer = null;
    void qc.invalidateQueries({ queryKey: ['jobs'] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['project-files'] });
    void qc.invalidateQueries({ queryKey: ['stats'] });
  }, 700);
}

/** Subscribes to the server's SSE stream and keeps the TanStack Query cache live. */
export function useServerEvents(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const statuses = new Map<number, Job['status']>();
    const onMessage = (msg: MessageEvent) => {
      const event = JSON.parse(msg.data as string) as ServerEvent;
      if (event.type === 'job.update') {
        const { job } = event;
        qc.setQueryData(['job', job.id], { job });
        qc.setQueriesData<{ jobs: Job[] }>({ queryKey: ['jobs'] }, (old) => upsertJob(old, job));
        const prev = statuses.get(job.id);
        if (prev && prev !== job.status) {
          if (job.status === 'done')
            toast.success(`Subtitles ready: ${job.fileName}`, {
              description: job.outputPath ?? undefined,
            });
          if (job.status === 'failed')
            toast.error(`Failed: ${job.fileName}`, { description: job.error ?? undefined });
          invalidateSoon(qc);
        }
        if (!prev) invalidateSoon(qc);
        statuses.set(job.id, job.status);
      } else if (event.type === 'job.log') {
        const log: JobLog = event.log;
        qc.setQueryData<{ logs: JobLog[] }>(['logs', log.jobId], (old) =>
          old && !old.logs.some((l) => l.id === log.id) ? { logs: [...old.logs, log] } : old,
        );
        if (
          log.message.startsWith('Transcribed') ||
          log.message.startsWith('Translated') ||
          log.message.includes('API')
        ) {
          void qc.invalidateQueries({ queryKey: ['calls', log.jobId] });
        }
      } else if (event.type === 'job.deleted') {
        invalidateSoon(qc);
      }
    };

    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let dropped = false;
    const connect = () => {
      es = new EventSource(tokenUrl('/api/events'));
      es.onmessage = onMessage;
      es.onopen = () => {
        setConnection('live');
        // Events may have been missed while disconnected: refetch everything once.
        if (dropped) void qc.invalidateQueries();
        dropped = false;
      };
      es.onerror = () => {
        dropped = true;
        if (connection === 'live') setConnection('reconnecting');
        if (es?.readyState !== EventSource.CLOSED) return; // the browser retries by itself
        // Closed for good: either the server restarted (new token) or it is still down.
        es.close();
        void checkSession().then((state) => {
          if (disposed) return;
          if (state === 'expired') reloadForNewSession();
          else retry = setTimeout(connect, 2000);
        });
      };
    };
    connect();
    return () => {
      disposed = true;
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [qc]);
}
