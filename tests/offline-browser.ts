import { test as base, expect, type BrowserContext } from '@playwright/test';
import { nowhere, watchOutside } from './offline.mjs';

export * from '@playwright/test';

// The browser reaches nothing outside this machine (#266, tests/offline.mjs says what is local): it runs behind a proxy
// nothing answers, which every local name bypasses, and every context it makes names each outside address it tried.
// A test fails naming each host it tried. One a hook tried is kept for the worker, with the test it came after, and
// the worker fails naming it when it ends, so no other test or file takes the blame.
const betweenTests: string[] = [];
let running: string[] | undefined;
let after = 'before the first test';
const note = (host: string) => { if (running) running.push(host); else betweenTests.push(`${host} (between tests, ${after})`); };
const watch = (context: BrowserContext) => watchOutside(context, note);
const message = 'outside requests the browser made (tests/offline-browser.ts)';

export const test = base.extend<{ outsideRequests: string[] }, { outsideBetweenTests: string[] }>({
  launchOptions: [async ({ launchOptions }, use) => use({ ...launchOptions, proxy: nowhere }), { scope: 'worker' }],
  outsideBetweenTests: [async ({}, use) => {
    await use(betweenTests);
    expect(betweenTests, message).toEqual([]);
  }, { scope: 'worker' }],
  // The browser stays lazy: a worker that opens no page starts none.
  browser: [async ({ browser, outsideBetweenTests }, use) => {
    void outsideBetweenTests; // set up first, so it checks once the browser is gone
    browser.on('context', watch);
    await use(browser);
    browser.off('context', watch);
  }, { scope: 'worker' }],
  outsideRequests: [async ({}, use, testInfo) => {
    const hosts: string[] = running = [];
    await use(hosts);
    running = undefined;
    after = `after "${testInfo.titlePath.slice(1).join(' › ')}" in ${testInfo.file.split('/tests/').pop()}`;
    expect(hosts, message).toEqual([]);
  }, { auto: true }],
});
