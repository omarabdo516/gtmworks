import { defineConfig } from '@playwright/test';
// Browser checks against a running Docker install (the CI install job): no web server of its own, and its files are
// named *.install.ts so the main suite never picks them up. APP_ORIGIN is the address people open.
export default defineConfig({
  testDir: './tests/install',
  testMatch: '*.install.ts',
  timeout: 240000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '/tmp/install-test-results',
  // APP_ORIGIN is the HTTPS proxy the job starts, whose certificate comes from its own local authority.
  use: { baseURL: process.env.APP_ORIGIN, locale: 'en-US', ignoreHTTPSErrors: true },
});
