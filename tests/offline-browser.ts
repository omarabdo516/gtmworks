import { test as base, expect, type BrowserContext } from '@playwright/test';
import { isLocalUrl } from './offline.mjs';

export * from '@playwright/test';

// The browser reaches nothing outside this machine (#266, tests/offline.mjs says what is local). It runs behind a proxy
// that nothing answers, which every local name bypasses, so any other request fails; routing would do the same but turn
// off the browser's cache and change the headers a test reads. Every context the worker's browser makes reports each
// outside address it tried: a test fails naming each host, what a `beforeAll` tried fails the next test, and what an
// `afterAll` tried fails the worker.
const nowhere = { server: 'http://127.0.0.1:9', bypass: 'localhost,*.localhost,*.test,*.example,*.invalid,127.0.0.0/8,[::1],0.0.0.0' };
const betweenTests: string[] = [];
let running = betweenTests;
const watched = new WeakSet<BrowserContext>();
const note = (url: string) => { if (!isLocalUrl(url)) running.push(new URL(url).host); };
const watch = (context: BrowserContext) => {
  if (watched.has(context)) return;
  watched.add(context);
  context.on('request', request => note(request.url()));
  context.on('page', page => page.on('websocket', socket => note(socket.url())));
};
const message = 'outside requests the browser made (tests/offline-browser.ts)';

export const test = base.extend<{ outsideRequests: string[] }, { offlineBrowser: void }>({
  launchOptions: [async ({ launchOptions }, use) => use({ ...launchOptions, proxy: nowhere }), { scope: 'worker' }],
  offlineBrowser: [async ({ browser }, use) => {
    browser.on('context', watch);
    await use();
    browser.off('context', watch);
    expect(betweenTests, message).toEqual([]);
  }, { scope: 'worker', auto: true }],
  outsideRequests: [async ({}, use) => {
    const hosts = running = betweenTests.splice(0);
    await use(hosts);
    running = betweenTests;
    expect(hosts, message).toEqual([]);
  }, { auto: true }],
});
