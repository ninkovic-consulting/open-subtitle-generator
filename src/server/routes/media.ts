import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { notFound, paramId } from '../http.js';
import { getMediaFile } from '../services/repo.js';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/webm',
  '.ogv': 'video/ogg',
};

/** Streams a known media file with HTTP range support (for the editor's video preview). */
export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/media/:id/stream', async (req, reply) => {
    const media = getMediaFile(paramId(req)) ?? notFound('Media file');
    if (!fs.existsSync(media.path)) notFound('Video file');
    const size = fs.statSync(media.path).size;
    const type = MIME[path.extname(media.path).toLowerCase()] ?? 'application/octet-stream';
    const range = req.headers.range;
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', type);
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m?.[1] ? Number(m[1]) : 0;
      let end = m?.[2] ? Number(m[2]) : Math.min(size - 1, start + 8 * 1024 * 1024);
      if (!m?.[1] && m?.[2]) {
        start = Math.max(0, size - Number(m[2]));
        end = size - 1;
      }
      if (start >= size || end < start) {
        reply.code(416).header('Content-Range', `bytes */${size}`);
        return reply.send();
      }
      end = Math.min(end, size - 1);
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
      reply.header('Content-Length', String(end - start + 1));
      return reply.send(fs.createReadStream(media.path, { start, end }));
    }
    reply.header('Content-Length', String(size));
    return reply.send(fs.createReadStream(media.path));
  });
}
