import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { computedMotion, referenceComputed, type ComputedStyle } from './tests/motion-css.mjs';
import { languages, widths } from './tests/visual-screens.mjs';

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
    browser: {
      enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }],
      commands: {
        referenceComputed: (_, selector: string, width: number) => referenceComputed(selector, width),
        computedMotion: (_, style: ComputedStyle) => computedMotion(style),
      },
    },
  },
});
