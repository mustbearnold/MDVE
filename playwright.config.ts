import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const e2eDataRoot = process.env.MDVE_E2E_HOME ?? mkdtempSync(join(tmpdir(), 'mdve-playwright-e2e-'));
const defaultServerCommand = [
  `MDVE_HOME='${e2eDataRoot.replaceAll("'", "'\\''")}'`,
  'MDVE_HOST=127.0.0.1',
  'MDVE_PORT=4187',
  'MDVE_AUTH_REQUIRED=0',
  'MDVE_VERSION=1.0.0',
  'MDVE_WEB_DIST=dist/web',
  'node dist/server/index.js',
].join(' ');

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI
    ? [['line'], ['json', { outputFile: process.env.MDVE_E2E_REPORT ?? 'test-results/e2e-results.json' }]]
    : 'line',
  use: {
    baseURL: 'http://127.0.0.1:4187',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command:
      process.env.MDVE_E2E_SERVER_COMMAND ??
      defaultServerCommand,
    url: 'http://127.0.0.1:4187/_mdve/ready',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
