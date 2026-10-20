import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = 4790;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-e2e-'));

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } },
    },
  ],
  webServer: {
    command: 'node dist/node/server/index.js --no-open',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(port),
      OSG_DATA_DIR: dataDir,
      OSG_SKIP_DOTENV: '1',
      OPEN_BROWSER: '0',
      LOG_LEVEL: 'warn',
    },
  },
});
