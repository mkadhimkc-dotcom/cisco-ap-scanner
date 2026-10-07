import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 90000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:8765', ...devices['iPhone 13'], browserName: 'chromium' },
  webServer: { command: 'node scripts/serve.mjs 8765', url: 'http://localhost:8765', reuseExistingServer: true, timeout: 20000 },
});
