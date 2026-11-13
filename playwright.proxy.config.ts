import { defineConfig } from '@playwright/test';
const host = 'app.gtmworks.test';
// The same pages as the main suite, reached the way people reach them on the server: https, a public-looking host
// name, a reverse proxy in front of the production image (scripts/proxy-stack.sh).
export default defineConfig({
  testDir: './tests/proxy',
  testMatch: '*.spec.ts',
  timeout: 90000,
  workers: 1,
  // Its own journal (docs/ci-test-journal.md), kept apart from the main suite's.
  reporter: [['list'], ['./scripts/playwright-journal-reporter.mjs', { invocation: 'proxy', outputFile: 'playwright-report/journal-proxy.jsonl' }]],
  use: { baseURL: `https://${host}`, ignoreHTTPSErrors: true, launchOptions: { args: [`--host-resolver-rules=MAP ${host} 127.0.0.1`] } },
  webServer: {
    command: 'bash scripts/proxy-stack.sh',
    wait: { stdout: /PROXY STACK READY/ },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 300000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 20000 },
  },
});
