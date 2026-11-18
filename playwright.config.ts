import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { defineConfig } from '@playwright/test';
// Offline by default (#266): the runner, its workers and the servers below refuse outside connections and name the host.
import { freshLog, nodeOptionsBefore, ownsLog } from './tests/offline.mjs';
// One log of refusals per run, which every process the run starts writes to; the teardown fails the run naming each.
// The runner owns its log, unless it inherited one from the process that started it.
if (!process.env.TEST_WORKER_INDEX && !ownsLog()) freshLog();
import { appOrigin, lanes, originOf, serverLogOf } from './tests/lane.mjs';
// First run opens only with the install's setup code (issue #50). The web server and the test workers inherit this one.
process.env.SETUP_CODE ||= randomBytes(32).toString('hex');
// Each run's spec files restore the seed before they start (tests/fresh-seed.ts); the workers inherit this run's name.
process.env.GTMWORKS_TEST_RUN ||= randomBytes(8).toString('hex');
const hostedElsewhere = process.env.GTMWORKS_HOSTED_ELSEWHERE === 'true';
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  // By its own address: tests/playwright-projects.test.mjs loads this config from a folder of its own.
  globalTeardown: join(__dirname, 'tests/offline-teardown.ts'),
  testIgnore: '**/proxy/**', // the production-shaped suite has its own config (playwright.proxy.config.ts)
  timeout: 60000,
  // One worker per lane, each on a whole stack of its own (tests/lane.mjs, #69): spec files run side by side and never
  // share data; the tests inside one file still run in order. CI sets GTMWORKS_TEST_LANES; a local run has one lane.
  workers: lanes,
  // CI retries a failed test once; Playwright reports one that then passes as flaky. Local runs never retry.
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: appOrigin },
  // Lane 0 builds the app and serves it; every other lane serves that build on its own port (scripts/web.sh).
  webServer: Array.from({ length: lanes }, (_, n) => ({ command: `mkdir -p playwright-report && LANE=${n} bash scripts/web.sh production > ${serverLogOf(n)} 2>&1`, url: `${originOf(n)}/sign-in`, reuseExistingServer: false, timeout: 240000, env: { GTMWORKS_BUILD_NODE_OPTIONS: nodeOptionsBefore } })),
  // Playwright's own reporters only: CI uploads the HTML report, the GitHub reporter marks failures and flaky tests on
  // the run, and ci.sh asks for the JSON one for the measured budgets the visual job reads back (#257). The report keeps a folder of its own, since the
  // servers write their logs to playwright-report/.
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/html', open: 'never' }], ...(process.env.CI ? [['github'] as const] : []), ...(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ? [['json'] as const] : [])],
  projects: [
    // Playwright starts a teardown project only after its setup and everything depending on it have finished, retries
    // included, and starts it even when they failed; a dependent project is skipped instead. So each group is the
    // teardown of an empty anchor: `functional` of `functional-anchor`, `measured` of `measured-anchor` and `first-run`
    // of `seeded`. The order is functional, measured, first run, and a failure in one group hides none of the next.
    // The compared screens are the visual lane, with a config of its own (playwright.lane.config.ts, #257).
    { name: 'seeded', testMatch: /^$/, teardown: 'first-run' },
    // The navigation time budgets are measured with the machine to themselves (#69): `measured` runs alone after every
    // functional test, and before first run.
    { name: 'measured-anchor', testMatch: /^$/, dependencies: ['seeded'], teardown: 'measured' },
    // The chat's open time is measured with no other browser beside it (Omar, 2026-11-18, #346): `alone` runs one worker
    // after every functional test and before the budgets, on the pull request too.
    { name: 'alone-anchor', testMatch: /^$/, dependencies: ['measured-anchor'], teardown: 'alone' },
    { name: 'functional-anchor', testMatch: /^$/, dependencies: ['alone-anchor'], teardown: 'functional' },
    { name: 'functional', testIgnore: ['first-run.spec.ts', 'fresh-install-journey.spec.ts', 'navigation.spec.ts', 'chat-steps.spec.ts', '**/proxy/**', 'visual-lane*.spec.ts'] },
    { name: 'alone', testMatch: 'chat-steps.spec.ts', workers: 1 },
    // CI measures the budgets in a job of their own on ubuntu-latest (`./ci.sh visual`), on a machine no other job
    // shares; `ci.sh integration` leaves this project empty, so it still orders the projects around it.
    { name: 'measured', testMatch: hostedElsewhere ? /^$/ : 'navigation.spec.ts', workers: 1 },
    // Empty-install scenarios (first run, and the whole journey from it, #329) mutate the whole local database and run only after seeded functional tests finish.
    { name: 'first-run', testMatch: ['first-run.spec.ts', 'fresh-install-journey.spec.ts'] },
  ],
});
