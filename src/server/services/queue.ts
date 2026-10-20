import { eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/client.js';
import { logger } from '../logger.js';
import { logJob } from './joblog.js';
import { getJob, updateJob } from './repo.js';
import { loadSettings } from './settings.js';

export type JobRunner = (jobId: number, signal: AbortSignal) => Promise<void>;

/**
 * In-process job queue persisted in the `jobs` table. A few jobs run at a time (each job is
 * internally parallel); cancellation goes through an AbortController passed down to every API call
 * and ffmpeg process.
 */
export class JobQueue {
  private readonly controllers = new Map<number, AbortController>();
  private idleResolvers: (() => void)[] = [];
  private started = false;

  constructor(private runner: JobRunner) {}

  setRunner(runner: JobRunner): void {
    this.runner = runner;
  }

  /** Re-queues jobs that were running when the server stopped, then starts processing. */
  start(): void {
    const db = getDb();
    const stale = db
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(eq(schema.jobs.status, 'running'))
      .all();
    if (stale.length) {
      db.update(schema.jobs)
        .set({ status: 'queued' })
        .where(
          inArray(
            schema.jobs.id,
            stale.map((s) => s.id),
          ),
        )
        .run();
      for (const s of stale)
        logJob(
          s.id,
          'info',
          null,
          'Server restarted: job re-queued and will resume from the last completed stage',
        );
    }
    this.started = true;
    this.tick();
  }

  enqueue(_jobId?: number): void {
    if (this.started) this.tick();
  }

  isRunning(jobId: number): boolean {
    return this.controllers.has(jobId);
  }

  get runningCount(): number {
    return this.controllers.size;
  }

  cancel(jobId: number): boolean {
    const ctrl = this.controllers.get(jobId);
    if (ctrl) {
      ctrl.abort();
      return true;
    }
    const job = getJob(jobId);
    if (job && job.status === 'queued') {
      updateJob(jobId, { status: 'cancelled', finishedAt: Date.now() });
      logJob(jobId, 'warn', null, 'Cancelled before it started');
      return true;
    }
    return false;
  }

  /** Resolves when nothing is running or queued (used by tests). */
  onIdle(): Promise<void> {
    if (this.controllers.size === 0 && !this.nextQueued()) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private nextQueued(): number | null {
    const row = getDb()
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(eq(schema.jobs.status, 'queued'))
      .orderBy(schema.jobs.createdAt, schema.jobs.id)
      .limit(this.controllers.size + 10)
      .all()
      .find((r) => !this.controllers.has(r.id));
    return row?.id ?? null;
  }

  private tick(): void {
    const limit = loadSettings().jobConcurrency;
    while (this.controllers.size < limit) {
      const id = this.nextQueued();
      if (id === null) break;
      const ctrl = new AbortController();
      this.controllers.set(id, ctrl);
      updateJob(id, { status: 'running' });
      this.runner(id, ctrl.signal)
        .catch((err) => {
          logger.error({ err, jobId: id }, 'Job runner crashed');
          updateJob(id, {
            status: 'failed',
            error: (err as Error).message,
            finishedAt: Date.now(),
          });
        })
        .finally(() => {
          this.controllers.delete(id);
          const job = getJob(id);
          if (job && job.status === 'running') {
            updateJob(id, {
              status: ctrl.signal.aborted ? 'cancelled' : 'failed',
              finishedAt: Date.now(),
            });
          }
          this.tick();
        });
    }
    if (this.controllers.size === 0 && this.nextQueued() === null) {
      const resolvers = this.idleResolvers;
      this.idleResolvers = [];
      resolvers.forEach((r) => r());
    }
  }
}
