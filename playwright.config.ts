import { randomBytes } from 'node:crypto';
import { defineConfig } from '@playwright/test';
// First run opens only with the install's setup code (issue #50). The web server and the test workers inherit this one.
process.env.SETUP_CODE ||= randomBytes(32).toString('hex');
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  testIgnore: '**/proxy/**', // the production-shaped suite has its own config (playwright.proxy.config.ts)
  timeout: 60000,
  workers: 1,
  // CI retries a failed test once; one that then passes is reported as flaky (scripts/flaky-tests.mjs). Local runs never retry.
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:3000' },
  webServer: { command: 'mkdir -p playwright-report && bash scripts/web.sh production > playwright-report/server.log 2>&1', url: 'http://127.0.0.1:3000/sign-in', reuseExistingServer: false, timeout: 240000 },
  // The JSON report is saved by every CI run so a PR's failures can be compared with main's (scripts/compare-failures.mjs).
  // The journal keeps what was selected and observed, test by test, when the run stops before that report is written.
  reporter: [['list'], ['json', { outputFile: 'playwright-report/results.json' }], ['./scripts/playwright-journal-reporter.mjs', { invocation: 'main', outputFile: 'playwright-report/journal-main.jsonl' }]],
  // A picture must match its approved image exactly. Animations and the caret are stopped, and Playwright waits until
  // two captures in a row are identical before it compares.
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 0 } },
  projects: [
    // The comparisons run first, on the database exactly as the seed builds it: the other tests create and change cards.
    // A failing comparison writes its expected, actual and difference images next to the screenshots CI already uploads.
    // Playwright starts a teardown project only after its setup and everything depending on it have finished, retries
    // included, and starts it even when they failed; a dependent project is skipped instead. So `functional` is the
    // teardown of `visual` and `first-run` the teardown of the empty `seeded` anchor that `visual` depends on: the
    // order is visual, functional, first-run, and a failed screen no longer hides the functional failures (#257).
    // The screen-only scripts pass --no-deps so they do not pull the later projects in.
    { name: 'seeded', testMatch: /^$/, teardown: 'first-run' },
    { name: 'visual', testMatch: 'visual.spec.ts', outputDir: 'test-results/screenshots/visual', dependencies: ['seeded'], teardown: 'functional' },
    { name: 'functional', testIgnore: ['visual.spec.ts', 'first-run.spec.ts', '**/proxy/**'] },
    // Empty-install scenarios mutate the whole local database and run only after seeded functional tests finish.
    { name: 'first-run', testMatch: 'first-run.spec.ts' },
  ],
});
