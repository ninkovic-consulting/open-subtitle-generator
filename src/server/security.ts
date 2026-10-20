import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const LOCAL_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const LOCAL_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/** Routes that browsers call without custom headers (EventSource, <video>, <track>) accept ?token=. */
const QUERY_TOKEN_ROUTES = [
  /^\/api\/events$/,
  /^\/api\/media\/\d+\/stream$/,
  /^\/api\/jobs\/\d+\/vtt$/,
];
const PUBLIC_ROUTES = [/^\/api\/health$/];

export interface SecurityOptions {
  token: string;
  dev: boolean;
}

export function createSessionToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Local-app hardening:
 * - Host header must be localhost (blocks DNS-rebinding attacks).
 * - Cross-origin requests from other websites are rejected (Origin check).
 * - Every API call needs the per-launch session token, which is only embedded in the served page.
 */
export function registerSecurity(app: FastifyInstance, opts: SecurityOptions): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply) => {
    const host = req.headers.host ?? '';
    if (!LOCAL_HOST_RE.test(host)) {
      return reply.code(403).send({ error: 'Forbidden host' });
    }
    const origin = req.headers.origin;
    if (origin && !LOCAL_ORIGIN_RE.test(origin)) {
      return reply.code(403).send({ error: 'Cross-origin requests are not allowed' });
    }
    const url = req.url.split('?')[0] ?? '';
    if (!url.startsWith('/api/')) return;
    if (PUBLIC_ROUTES.some((r) => r.test(url))) return;
    if (opts.dev && url === '/api/dev/token') return;
    const header = req.headers['x-osg-token'];
    let token = typeof header === 'string' ? header : '';
    if (!token && req.method === 'GET' && QUERY_TOKEN_ROUTES.some((r) => r.test(url))) {
      token = String((req.query as Record<string, unknown>)?.token ?? '');
    }
    if (!token || !safeEqual(token, opts.token)) {
      return reply.code(401).send({ error: 'Missing or invalid session token. Reload the page.' });
    }
  });
}
