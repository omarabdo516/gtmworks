import { afterEach, expect } from 'vitest';
import { commands } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';

declare module 'vitest/browser' {
 interface BrowserCommands {
  watchOutside: () => Promise<void>,
  outsideRequests: () => Promise<string[]>,
 }
}

// Every component test file runs offline (#266, vitest.config.mts): the browser runs behind a proxy nothing answers, and
// a test that tried an outside address fails naming each host.
// Awaited here, before the test file itself loads, so a request the file makes while it loads is named too.
await commands.watchOutside();
afterEach(async () => { expect(await commands.outsideRequests(), 'outside requests the browser made (tests/components/offline-setup.ts)').toEqual([]); });
