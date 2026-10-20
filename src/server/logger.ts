import pino from 'pino';

const pretty = process.stdout.isTTY && !process.env.VITEST;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'apiKey',
      '*.apiKey',
      'openrouterApiKey',
      '*.openrouterApiKey',
      'headers.authorization',
      'req.headers.authorization',
      'req.headers["x-osg-token"]',
    ],
    censor: '[redacted]',
  },
});
