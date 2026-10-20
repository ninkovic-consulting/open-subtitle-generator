import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/live/**', 'tests/e2e/**', 'node_modules/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/global-setup.ts'],
  },
});
