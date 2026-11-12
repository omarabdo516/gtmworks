import { defineConfig } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// The app signs a company in to its model subscription through the `hermes` command (#3); in tests a fake stands in
// for it, with one Hermes home per company. Both live in a scratch folder made for this run (the workers and the web
// server inherit it), and they always replace any configured Hermes, so a test never touches a real one or its homes.
// HERMES_COMMAND is one program path: a launcher that runs the fake with Node, every path quoted.
process.env.GTMWORKS_TEST_HERMES_ROOT ??= mkdtempSync(join(tmpdir(),'gtmworks-fake-hermes-'));
const fakeHermes=process.env.GTMWORKS_TEST_HERMES_ROOT;
const quoted=(text:string)=>`'${text.replaceAll("'","'\\''")}'`;
process.env.HERMES_COMMAND=join(fakeHermes,'hermes');
process.env.HERMES_COMPANY_HOMES=join(fakeHermes,'homes');
writeFileSync(process.env.HERMES_COMMAND,`#!/bin/sh\nexec ${quoted(process.execPath)} ${quoted(resolve('tests/fake-hermes-cli.mjs'))} "$@"\n`,{mode:0o755});
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
  reporter: [['list'], ['json', { outputFile: 'playwright-report/results.json' }]],
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
