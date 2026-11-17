import { test as base, expect, type BrowserContext } from '@playwright/test';
import { isLocalUrl } from './offline.mjs';

export * from '@playwright/test';

// The browser reaches nothing outside this machine (#266, tests/offline.mjs says what is local): every context a test
// makes, its own `context` and any from `browser.newContext()`, aborts outside requests, and the test fails naming each
// host it tried. A spec's own later route still wins, since Playwright runs the newest route first.
const guarded = new WeakMap<BrowserContext, Promise<unknown>>();
const guard = (context: BrowserContext, hosts: string[]) => {
  if (!guarded.has(context)) guarded.set(context, context.route(url => !isLocalUrl(url), route => {
    hosts.push(new URL(route.request().url()).host);
    return route.abort('blockedbyclient');
  }));
  return guarded.get(context);
};

export const test = base.extend<{ outsideRequests: string[] }>({
  outsideRequests: [async ({ browser }, use) => {
    const hosts: string[] = [];
    // A context closed at once has made no request to guard.
    const listener = (context: BrowserContext) => { guard(context, hosts)?.catch(() => undefined); };
    browser.on('context', listener);
    await use(hosts);
    browser.off('context', listener);
    expect(hosts, 'outside requests the browser made (tests/offline-browser.ts)').toEqual([]);
  }, { auto: true }],
  context: [async ({ context, outsideRequests }, use) => {
    await guard(context, outsideRequests);
    await use(context);
  }, { scope: 'test' }],
});
