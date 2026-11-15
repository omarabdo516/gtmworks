import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// Screens tested as components in headless Chromium, as T3 Code does (#81).
export default defineConfig({
  // tsconfig keeps JSX for Next to compile; here Vite compiles it with React's automatic runtime.
  oxc: { jsx: { runtime: 'automatic' } },
  // Prebundled up front so Vite never reloads a running test to add it.
  optimizeDeps: { include: ['react/jsx-dev-runtime', 'react-dom/client', 'vitest-browser-react'] },
  resolve: { alias: { '@': import.meta.dirname } },
  test: {
    include: ['tests/components/**/*.test.tsx'],
    browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] },
  },
});
