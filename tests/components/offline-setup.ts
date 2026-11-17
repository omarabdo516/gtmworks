import { afterEach, beforeAll, expect } from 'vitest';
import { commands } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';

declare module 'vitest/browser' {
 interface BrowserCommands {
  blockOutside: () => Promise<void>,
  outsideRequests: () => Promise<string[]>,
 }
}

// Every component test file runs offline (#266, vitest.config.mts): the browser aborts outside requests, and a test that
// made one fails naming each host.
beforeAll(() => commands.blockOutside());
afterEach(async () => { expect(await commands.outsideRequests(), 'outside requests the browser made (tests/components/offline-setup.ts)').toEqual([]); });
