import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { JOB_STATUSES, type JobStatus, type StatsResponse } from '../../shared/types.js';
import { getDb, schema } from '../db/client.js';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stats', async (): Promise<StatsResponse> => {
    const db = getDb();
    const c = schema.apiCalls;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const since = Date.now() - 60 * 86_400_000;

    const totals = db
      .select({
        total: sql<number>`coalesce(sum(${c.costUsd}), 0)`,
        month: sql<number>`coalesce(sum(case when ${c.ts} >= ${startOfMonth.getTime()} then ${c.costUsd} else 0 end), 0)`,
        today: sql<number>`coalesce(sum(case when ${c.ts} >= ${startOfDay.getTime()} then ${c.costUsd} else 0 end), 0)`,
      })
      .from(c)
      .get();

    const counts = db
      .select({ status: schema.jobs.status, n: sql<number>`count(*)` })
      .from(schema.jobs)
      .groupBy(schema.jobs.status)
      .all();
    const jobCounts = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<
      JobStatus,
      number
    >;
    for (const r of counts) jobCounts[r.status as JobStatus] = Number(r.n);

    const day = sql<string>`strftime('%Y-%m-%d', ${c.ts} / 1000, 'unixepoch', 'localtime')`;
    const costByDay = db
      .select({ day, costUsd: sql<number>`coalesce(sum(${c.costUsd}), 0)` })
      .from(c)
      .where(sql`${c.ts} >= ${since}`)
      .groupBy(day)
      .all();
    const jobDay = sql<string>`strftime('%Y-%m-%d', ${schema.jobs.createdAt} / 1000, 'unixepoch', 'localtime')`;
    const jobsByDay = db
      .select({ day: jobDay, n: sql<number>`count(*)` })
      .from(schema.jobs)
      .where(sql`${schema.jobs.createdAt} >= ${since}`)
      .groupBy(jobDay)
      .all();
    const dayMap = new Map<string, { day: string; costUsd: number; jobs: number }>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dayMap.set(key, { day: key, costUsd: 0, jobs: 0 });
    }
    for (const r of costByDay) {
      const e = dayMap.get(r.day);
      if (e) e.costUsd = Number(r.costUsd);
    }
    for (const r of jobsByDay) {
      const e = dayMap.get(r.day);
      if (e) e.jobs = Number(r.n);
    }

    const byProject = db
      .select({
        projectId: schema.projects.id,
        name: sql<string>`coalesce(${schema.projects.name}, 'Unassigned')`,
        costUsd: sql<number>`coalesce(sum(${schema.jobs.costUsd}), 0)`,
        jobs: sql<number>`count(${schema.jobs.id})`,
      })
      .from(schema.jobs)
      .innerJoin(schema.mediaFiles, sql`${schema.jobs.mediaFileId} = ${schema.mediaFiles.id}`)
      .leftJoin(schema.projects, sql`${schema.mediaFiles.projectId} = ${schema.projects.id}`)
      .groupBy(schema.projects.id)
      .orderBy(sql`3 desc`)
      .all();

    const byModel = db
      .select({
        model: c.model,
        kind: c.kind,
        costUsd: sql<number>`coalesce(sum(${c.costUsd}), 0)`,
        calls: sql<number>`count(*)`,
      })
      .from(c)
      .groupBy(c.model, c.kind)
      .orderBy(sql`3 desc`)
      .all();

    const audio = db
      .select({ s: sql<number>`coalesce(sum(${schema.jobs.audioSeconds}), 0)` })
      .from(schema.jobs)
      .get();

    return {
      totalUsd: Number(totals?.total ?? 0),
      monthUsd: Number(totals?.month ?? 0),
      todayUsd: Number(totals?.today ?? 0),
      jobCounts,
      byDay: [...dayMap.values()],
      byProject: byProject.map((r) => ({ ...r, costUsd: Number(r.costUsd), jobs: Number(r.jobs) })),
      byModel: byModel.map((r) => ({ ...r, costUsd: Number(r.costUsd), calls: Number(r.calls) })),
      audioHours: Number(audio?.s ?? 0) / 3600,
    };
  });
}
