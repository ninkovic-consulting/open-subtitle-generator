import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** Validates input with zod and throws a 400 with a readable message. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const res = schema.safeParse(data);
  if (!res.success) {
    const msg = res.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    throw new HttpError(400, msg);
  }
  return res.data;
}

export const idParams = z.object({ id: z.coerce.number().int().positive() });

export function paramId(req: FastifyRequest): number {
  return parse(idParams, req.params).id;
}

export function notFound(what: string): never {
  throw new HttpError(404, `${what} not found`);
}

export type Reply = FastifyReply;
