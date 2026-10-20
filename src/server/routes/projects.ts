import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { glossarySchema, projectCreateSchema, projectUpdateSchema } from '../../shared/types.js';
import { getDb, schema } from '../db/client.js';
import { HttpError, notFound, paramId, parse } from '../http.js';
import { findVideos, resolveUserPath } from '../services/fs-browser.js';
import {
  getGlossary,
  getProject,
  listMediaFiles,
  listProjects,
  saveGlossary,
  upsertMediaFile,
} from '../services/repo.js';
import { mapLimit } from '../services/stt.js';

export async function scanProject(projectId: number, rootPath: string): Promise<number> {
  const videos = findVideos(rootPath);
  await mapLimit(videos, 4, (v) => upsertMediaFile(projectId, v.path, v.sizeBytes));
  getDb()
    .update(schema.projects)
    .set({ updatedAt: Date.now() })
    .where(eq(schema.projects.id, projectId))
    .run();
  return videos.length;
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', async () => ({ projects: listProjects() }));

  app.post('/api/projects', async (req) => {
    const body = parse(projectCreateSchema, req.body);
    const rootPath = resolveUserPath(body.rootPath);
    if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory())
      throw new HttpError(400, 'Folder does not exist');
    const existing = getDb()
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.rootPath, rootPath))
      .get();
    const row =
      existing ??
      getDb()
        .insert(schema.projects)
        .values({ ...body, rootPath })
        .returning()
        .get();
    await scanProject(row.id, rootPath);
    return { project: getProject(row.id) };
  });

  app.get('/api/projects/:id', async (req) => {
    const project = getProject(paramId(req)) ?? notFound('Project');
    return { project };
  });

  app.patch('/api/projects/:id', async (req) => {
    const id = paramId(req);
    const body = parse(projectUpdateSchema, req.body);
    if (body.rootPath) body.rootPath = resolveUserPath(body.rootPath);
    getDb()
      .update(schema.projects)
      .set({ ...body, updatedAt: Date.now() })
      .where(eq(schema.projects.id, id))
      .run();
    return { project: getProject(id) ?? notFound('Project') };
  });

  app.delete('/api/projects/:id', async (req) => {
    const id = paramId(req);
    getDb().delete(schema.projects).where(eq(schema.projects.id, id)).run();
    return { ok: true };
  });

  app.post('/api/projects/:id/scan', async (req) => {
    const project = getProject(paramId(req)) ?? notFound('Project');
    const found = await scanProject(project.id, project.rootPath);
    return { found, files: listMediaFiles(project.id) };
  });

  app.get('/api/projects/:id/files', async (req) => {
    const project = getProject(paramId(req)) ?? notFound('Project');
    return { files: listMediaFiles(project.id) };
  });

  app.get('/api/glossary/:id', async (req) => {
    const id = paramId(req);
    if (!getProject(id)) notFound('Project');
    return { glossary: getGlossary(id) };
  });

  app.put('/api/glossary/:id', async (req) => {
    const id = paramId(req);
    if (!getProject(id)) notFound('Project');
    const glossary = parse(glossarySchema, req.body);
    return { glossary: saveGlossary(id, glossary) };
  });
}

const SEASON_RE = /^(season|series|staffel|sezona|saison|temporada|stagione|s)\s*\d+$/i;

/** Folder name, prefixed with the show for season folders: "Harbor Lights – Season 01". */
export function projectNameFor(rootPath: string): string {
  const name = path.basename(rootPath) || rootPath;
  const parent = path.basename(path.dirname(rootPath));
  return parent && SEASON_RE.test(name) ? `${parent} – ${name}` : name;
}
