import { defineConfig } from 'vitest/config';

/** `npm run test:live`: real OpenRouter calls (needs OPENROUTER_API_KEY; costs well under one cent). */
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    testTimeout: 120_000,
    pool: 'forks',
  },
});
