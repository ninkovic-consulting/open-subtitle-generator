import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import type { Job, JobLog, ServerEvent } from '@shared/types';
import { tokenUrl } from './api';

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
    const es = new EventSource(tokenUrl('/api/events'));
    es.onmessage = (msg) => {
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
    return () => es.close();
  }, [qc]);
}
