import { test as base, expect, type BrowserContext } from '@playwright/test';
import { blockOutside } from './offline.mjs';

export * from '@playwright/test';

// The browser reaches nothing outside this machine (#266, tests/offline.mjs says what is local): every context the
// worker's browser makes, a test's own `context`, one from `browser.newContext()` or one a hook opens, aborts outside
// requests. A test fails naming each host it tried; what a `beforeAll` tried fails the next test, and what an
// `afterAll` tried fails the worker. A spec's own later route still wins, since Playwright runs the newest route first.
const betweenTests: string[] = [];
let running = betweenTests;
const guarded = new WeakMap<BrowserContext, Promise<unknown>>();
const guard = (context: BrowserContext) => {
  if (!guarded.has(context)) guarded.set(context, blockOutside(context, host => running.push(host)));
  return guarded.get(context);
};
const message = 'outside requests the browser made (tests/offline-browser.ts)';

export const test = base.extend<{ outsideRequests: string[] }, { offlineBrowser: void }>({
  offlineBrowser: [async ({ browser }, use) => {
    // A context closed at once has made no request to guard.
    const listener = (context: BrowserContext) => { guard(context)?.catch(() => undefined); };
    browser.on('context', listener);
    await use();
    browser.off('context', listener);
    expect(betweenTests, message).toEqual([]);
  }, { scope: 'worker', auto: true }],
  outsideRequests: [async ({}, use) => {
    const hosts = running = betweenTests.splice(0);
    await use(hosts);
    running = betweenTests;
    expect(hosts, message).toEqual([]);
  }, { auto: true }],
  context: [async ({ context }, use) => {
    await guard(context);
    await use(context);
  }, { scope: 'test' }],
});
