import { defineConfig } from 'vitest/config';

// Real-PostgreSQL integration suite: `npm run test:integration`. See README "Testing".
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['**/*.integration.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    globalSetup: ['tests/integration/global-setup.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    // One shared throwaway database that is truncated before every test, so files run one at a time.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
