import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/server/app.js';
import { getDb, schema } from '../src/server/db/client.js';
import { JobQueue } from '../src/server/services/queue.js';
import { updateJob } from '../src/server/services/repo.js';
import { freshDb } from './helpers/db.js';

let ctx: App;
const started: number[] = [];
const release: (() => void)[] = [];

const put = (body: object) =>
  ctx.app.inject({
    method: 'PUT',
    url: '/api/settings',
    payload: body,
    headers: { host: 'localhost:4747', 'x-osg-token': ctx.token },
  });

beforeAll(async () => {
  freshDb();
  const queue = new JobQueue(async (id) => {
    started.push(id);
    await new Promise<void>((r) => release.push(r));
    updateJob(id, { status: 'done', finishedAt: Date.now() });
  });
  ctx = await buildApp({ queue, serveWeb: false });
  queue.start();
});

afterAll(async () => {
  release.forEach((r) => r());
  await ctx.queue.onIdle();
  await ctx.app.close();
});

describe('job queue', () => {
  it('defaults to 4 jobs at once and starts waiting jobs as soon as the limit is raised', async () => {
    const settings = await ctx.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { host: 'localhost:4747', 'x-osg-token': ctx.token },
    });
    expect(JSON.parse(settings.body).settings.jobConcurrency).toBe(4);
    await put({ jobConcurrency: 1 });

    const db = getDb();
    const project = db
      .insert(schema.projects)
      .values({ name: 'Q', rootPath: '/tmp/q' })
      .returning()
      .get();
    for (let i = 0; i < 3; i++) {
      const media = db
        .insert(schema.mediaFiles)
        .values({ projectId: project.id, path: `/tmp/q/ep${i}.mkv`, fileName: `ep${i}.mkv` })
        .returning()
        .get();
      db.insert(schema.jobs).values({ mediaFileId: media.id, targetLang: 'hr' }).run();
    }
    ctx.queue.enqueue();
    expect(started).toHaveLength(1);

    const res = await put({ jobConcurrency: 4 });
    expect(res.statusCode).toBe(200);
    expect(started).toHaveLength(3);

    expect((await put({ jobConcurrency: 9 })).statusCode).toBe(400);
  });
});
