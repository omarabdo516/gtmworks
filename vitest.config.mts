import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { computedMotion, referenceComputed, type ComputedStyle } from './tests/motion-css.mjs';
import { languages, widths } from './tests/visual-screens.mjs';
// Offline by default (#266): the runner refuses outside connections and names the host; the browser runs behind a proxy
// nothing answers (`nowhere`), and each outside address it tried is named.
import { nowhere, watchOutside } from './tests/offline.mjs';

// Outside requests each test browser session made (a session has its own context and runs its files one at a time), read
// and emptied by tests/components/offline-setup.ts after each test.
const outside = new WeakMap<object, string[]>();

// Screens tested as components in headless Chromium, as T3 Code does (#81).
export default defineConfig({
  // tsconfig keeps JSX for Next to compile; here Vite compiles it with React's automatic runtime.
  oxc: { jsx: { runtime: 'automatic' } },
  // Prebundled up front so Vite never reloads a running test to add it.
  optimizeDeps: { include: ['react/jsx-dev-runtime', 'react-dom/client', 'vitest-browser-react'] },
  resolve: { alias: { '@': import.meta.dirname } },
  test: {
    include: ['tests/components/**/*.test.tsx'],
    // tests/components/motion.test.tsx runs in the browser, which cannot read files, so the compared screens' widths and
    // languages and the reference's motion (tests/motion-css.mjs) come from here in Node.
    provide: { languages, widths },
    setupFiles: ['tests/components/offline-setup.ts'],
    browser: {
      enabled: true, headless: true, provider: playwright({ launchOptions: { proxy: nowhere } }), instances: [{ browser: 'chromium' }],
      commands: {
        referenceComputed: (_, selector: string, width: number) => referenceComputed(selector, width),
        computedMotion: (_, style: ComputedStyle) => computedMotion(style),
        watchOutside: ({ context }) => {
          if (outside.has(context)) return;
          const hosts: string[] = [];
          outside.set(context, hosts);
          watchOutside(context, host => hosts.push(host));
        },
        // One round trip to the page first: Playwright delivers a page's events in order, so each request it had started
        // by then has been named.
        outsideRequests: async ({ context, page }) => { await page.evaluate(() => 0); return outside.get(context)?.splice(0) ?? []; },
      },
    },
  },
});
