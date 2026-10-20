import type { FastifyInstance } from 'fastify';
import { bus } from '../services/events.js';

/** Server-Sent Events stream of job updates and log lines. */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/events', async (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    res.write('retry: 2000\n\n');
    send({ type: 'hello', ts: Date.now() });
    const off = bus.on(send);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      off();
    });
  });
}
