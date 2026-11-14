import { defineConfig } from '@playwright/test';

// This UI regression mocks auth responses and does not require a database.
const port = Number(process.env.E2E_PORT ?? 3101);
export default defineConfig({
  testDir: './e2e',
  testMatch: 'auth-errors.spec.ts',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}`, trace: 'off' },
  webServer: {
    command: `npm run dev -- -p ${port}`,
    url: `http://localhost:${port}/icon.svg`,
    timeout: 180_000,
  },
});
