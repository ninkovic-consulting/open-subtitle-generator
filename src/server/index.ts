import open from 'open';
import { buildApp } from './app.js';
import { config, ensureDataDir } from './config.js';
import { openDb } from './db/client.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  ensureDataDir();
  openDb();
  const { app, queue } = await buildApp({ dev: config.dev });
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      logger.error(
        `Port ${config.port} is already in use. Is OSG already running? Set PORT=... to use another port.`,
      );
      process.exit(1);
    }
    throw err;
  }
  queue.start();
  const url = config.dev ? 'http://localhost:5173' : `http://localhost:${config.port}`;
  logger.info(`OSG – Open Subtitle Generator v${config.version}`);
  logger.info(`Data folder: ${config.dataDir}`);
  logger.info(`Open ${url}`);
  if (!config.dev && config.openBrowser) {
    open(url).catch(() => logger.warn('Could not open the browser automatically'));
  }
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
