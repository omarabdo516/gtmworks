import { randomBytes } from 'node:crypto';
import { defineConfig } from '@playwright/test';
import { appOrigin, lanes, originOf, serverLogOf } from './tests/lane.mjs';
// First run opens only with the install's setup code (issue #50). The web server and the test workers inherit this one.
process.env.SETUP_CODE ||= randomBytes(32).toString('hex');
// Each run's spec files restore the seed before they start (tests/fresh-seed.ts); the workers inherit this run's name.
process.env.GTMWORKS_TEST_RUN ||= randomBytes(8).toString('hex');
const hostedElsewhere = process.env.GTMWORKS_HOSTED_ELSEWHERE === 'true';
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  testIgnore: '**/proxy/**', // the production-shaped suite has its own config (playwright.proxy.config.ts)
  timeout: 60000,
  // One worker per lane, each on a whole stack of its own (tests/lane.mjs, #69): spec files run side by side and never
  // share data; the tests inside one file still run in order. CI sets GTMWORKS_TEST_LANES; a local run has one lane.
  workers: lanes,
  // CI retries a failed test once; Playwright reports one that then passes as flaky. Local runs never retry.
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: appOrigin },
  // Lane 0 builds the app and serves it; every other lane serves that build on its own port (scripts/web.sh).
  webServer: Array.from({ length: lanes }, (_, n) => ({ command: `mkdir -p playwright-report && LANE=${n} bash scripts/web.sh production > ${serverLogOf(n)} 2>&1`, url: `${originOf(n)}/sign-in`, reuseExistingServer: false, timeout: 240000 })),
  // Playwright's own reporters only: CI uploads the HTML report, the GitHub reporter marks failures and flaky tests on
  // the run, and ci.sh asks for the JSON one for the CI ledger (#256). The report keeps a folder of its own, since the
  // servers write their logs to playwright-report/.
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/html', open: 'never' }], ...(process.env.CI ? [['github'] as const] : []), ...(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ? [['json'] as const] : [])],
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
    // The navigation time budgets are measured with the machine to themselves (#69): `measured` is the teardown of an
    // empty anchor that `visual` depends on, so it runs alone after every functional test, and before first run.
    { name: 'measured-anchor', testMatch: /^$/, dependencies: ['seeded'], teardown: 'measured' },
    // CI runs the compared screens and the measured budgets in a job of their own on ubuntu-latest (`./ci.sh visual`):
    // the screens' images are made there, and the budgets need a machine no other job shares. `ci.sh integration` then
    // leaves both projects empty, so they still order the projects around them.
    { name: 'visual', testMatch: hostedElsewhere ? /^$/ : 'visual.spec.ts', outputDir: 'test-results/screenshots/visual', dependencies: ['measured-anchor'], teardown: 'functional' },
    { name: 'functional', testIgnore: ['visual.spec.ts', 'first-run.spec.ts', 'navigation.spec.ts', '**/proxy/**'] },
    { name: 'measured', testMatch: hostedElsewhere ? /^$/ : 'navigation.spec.ts', workers: 1 },
    // Empty-install scenarios mutate the whole local database and run only after seeded functional tests finish.
    { name: 'first-run', testMatch: 'first-run.spec.ts' },
  ],
});
