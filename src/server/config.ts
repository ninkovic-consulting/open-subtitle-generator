import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import envPaths from 'env-paths';

/** Repository root (works from both `src/server` via tsx and `dist/node/server` after build). */
export const ROOT_DIR = (() => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
})();

const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile) && !process.env.OSG_SKIP_DOTENV) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // A malformed .env should not prevent the app from starting.
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')) as {
  version: string;
};

const args = new Set(process.argv.slice(2));

export const config = {
  version: pkg.version,
  host: '127.0.0.1',
  port: Number(process.env.PORT ?? 4747),
  dev: args.has('--dev') || process.env.NODE_ENV === 'development',
  openBrowser: process.env.OPEN_BROWSER !== '0' && !args.has('--no-open'),
  dataDir: process.env.OSG_DATA_DIR ?? envPaths('osg', { suffix: '' }).data,
  webDir: path.join(ROOT_DIR, 'dist', 'web'),
  migrationsDir: path.join(ROOT_DIR, 'src', 'server', 'db', 'migrations'),
  /** OpenRouter key from the environment (`OPENROUTER_API_KEY`, alias `OPEN_ROUTER_API`). */
  envOpenRouterKey: (process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_API ?? '').trim(),
  appUrl: 'https://github.com/ninkovic-consulting/open-subtitle-generator',
  appTitle: 'OSG - Open Subtitle Generator',
};

export function ensureDataDir(): string {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'tmp'), { recursive: true });
  return config.dataDir;
}
