import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { eq, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb, schema } from '../db/client.js';
import { HttpError, parse } from '../http.js';
import {
  listDirectory,
  listRoots,
  resolveUserPath,
  searchEntries,
} from '../services/fs-browser.js';

export async function fsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/fs/roots', async () => ({ roots: listRoots() }));

  app.get('/api/fs/list', async (req) => {
    const { path: p } = parse(z.object({ path: z.string().default('') }), req.query);
    return listDirectory(p || listRoots()[0]!.path);
  });

  /** Finds folders and videos by name in a folder and its subfolders. */
  app.get('/api/fs/search', async (req) => {
    const q = parse(
      z.object({ path: z.string().min(1), q: z.string().trim().min(1).max(200) }),
      req.query,
    );
    return searchEntries(q.path, q.q);
  });

  /** Shows a known video or generated subtitle in Finder / Explorer / the file manager. */
  app.post('/api/fs/reveal', async (req) => {
    const { path: p } = parse(z.object({ path: z.string().min(1) }), req.body);
    const abs = resolveUserPath(p);
    const known =
      getDb()
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(eq(schema.jobs.outputPath, abs))
        .get() ??
      getDb()
        .select({ id: schema.mediaFiles.id })
        .from(schema.mediaFiles)
        .where(or(eq(schema.mediaFiles.path, abs)))
        .get();
    if (!known) throw new HttpError(403, 'Only videos and generated subtitles can be revealed');
    if (!fs.existsSync(abs)) throw new HttpError(404, 'File no longer exists');
    const [cmd, args] =
      process.platform === 'darwin'
        ? ['open', ['-R', abs]]
        : process.platform === 'win32'
          ? ['explorer', [`/select,${abs}`]]
          : ['xdg-open', [path.dirname(abs)]];
    spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  });
}
