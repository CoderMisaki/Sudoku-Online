// Playwright E2E for the Harvest Moon mobile orientation lifecycle.
// Boots the REAL custom server (Next + persistent /ws/harvest on one origin).
import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /mobile-lifecycle\.spec\.mjs/,
  timeout: 180000,
  expect: { timeout: 30000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3111',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'PORT=3111 node server/run.mjs',
    url: 'http://127.0.0.1:3111/api/harvest/health',
    timeout: 240000,
    reuseExistingServer: true,
  },
});
