import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { config } from './config.js';
import { HttpError } from './http.js';
import { eventRoutes } from './routes/events.js';
import { fsRoutes } from './routes/fs.js';
import { jobRoutes } from './routes/jobs.js';
import { mediaRoutes } from './routes/media.js';
import { projectRoutes } from './routes/projects.js';
import { settingsRoutes } from './routes/settings.js';
import { statsRoutes } from './routes/stats.js';
import { createSessionToken, registerSecurity } from './security.js';
import { FsError } from './services/fs-browser.js';
import { OutputExistsError } from './services/writer.js';
import { JobQueue } from './services/queue.js';
import { runPipeline } from './services/pipeline.js';

export interface AppOptions {
  dev?: boolean;
  token?: string;
  queue?: JobQueue;
  /** Serve the built web UI from dist/web (off in tests and dev). */
  serveWeb?: boolean;
  logger?: boolean;
}

export interface App {
  app: FastifyInstance;
  token: string;
  queue: JobQueue;
}

/** Injects the session token into index.html so only the served page can call the API. */
function renderIndex(token: string): string | null {
  const file = path.join(config.webDir, 'index.html');
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, 'utf8');
  return html.replace('</head>', `  <meta name="osg-token" content="${token}" />\n  </head>`);
}

export async function buildApp(opts: AppOptions = {}): Promise<App> {
  const token = opts.token ?? createSessionToken();
  const dev = opts.dev ?? config.dev;
  const queue = opts.queue ?? new JobQueue(runPipeline);
  const app = Fastify({
    logger: opts.logger ? { level: 'warn' } : false,
    bodyLimit: 10 * 1024 * 1024,
  });

  registerSecurity(app, { token, dev });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError || err instanceof FsError) {
      return reply
        .code(err instanceof HttpError ? err.statusCode : err.status)
        .send({ error: err.message });
    }
    if (err instanceof OutputExistsError)
      return reply.code(409).send({ error: err.message, path: err.outputPath });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: (err as Error).message || 'Internal error' });
  });

  await app.register(settingsRoutes, { queue });
  await app.register(fsRoutes);
  await app.register(projectRoutes);
  await app.register(jobRoutes, { queue });
  await app.register(statsRoutes);
  await app.register(eventRoutes);
  await app.register(mediaRoutes);

  if (dev) app.get('/api/dev/token', async () => ({ token }));

  if (opts.serveWeb ?? !dev) {
    if (fs.existsSync(config.webDir)) {
      await app.register(fastifyStatic, {
        root: config.webDir,
        index: false,
        wildcard: false,
        maxAge: '1h',
      });
      // Hashed assets
      app.get('/assets/*', (req, reply) =>
        reply.sendFile(path.join('assets', (req.params as { '*': string })['*'])),
      );
    }
    const sendIndex = (_req: unknown, reply: FastifyReply) => {
      const html = renderIndex(token);
      if (!html)
        return reply
          .code(503)
          .type('text/plain')
          .send('Web UI is not built yet. Run "npm run build" or "npm start".');
      return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
    };
    app.get('/', sendIndex);
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      const file = path.join(config.webDir, req.url.split('?')[0]!);
      if (path.extname(file) && file.startsWith(config.webDir) && fs.existsSync(file)) {
        return reply.sendFile(path.relative(config.webDir, file));
      }
      return sendIndex(req, reply);
    });
  }

  return { app, token, queue };
}
