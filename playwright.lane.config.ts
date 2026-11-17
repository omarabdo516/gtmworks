import { randomBytes } from 'node:crypto';
import { defineConfig } from '@playwright/test';
import { appOrigin, serverLogOf } from './tests/lane.mjs';

// The small visual lane (#257): a few key screens in Arabic, light and dark, at 1440 and 390, drawn by one pinned
// browser (tests/visual-lane/renderer) so every machine makes the same bytes. `./ci.sh lane` starts that browser in its
// container and names its address here; the tests stay on this machine, and the browser reaches the app on loopback
// through them. Without an address the local Chromium draws, which is enough for the guard tests, never for images.
process.env.SETUP_CODE ||= randomBytes(32).toString('hex');
process.env.GTMWORKS_TEST_RUN ||= randomBytes(8).toString('hex');
const renderer = process.env.GTMWORKS_LANE_RENDERER;
// The guard tests write their own pages and need no app.
const guardsOnly = process.env.GTMWORKS_LANE_GUARDS_ONLY === 'true';
export default defineConfig({
  testDir: './tests',
  testMatch: 'visual-lane*.spec.ts',
  timeout: 60000,
  workers: 1,
  retries: 0,
  outputDir: 'test-results/lane',
  // One renderer makes every image, so an image's name carries no platform or project.
  snapshotPathTemplate: '{testDir}/visual-lane/images/{arg}{ext}',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/lane-html', open: 'never' }], ...(process.env.CI ? [['github'] as const] : []), ...(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ? [['json'] as const] : [])],
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 0 } },
  use: {
    baseURL: appOrigin,
    deviceScaleFactor: 1,
    locale: 'ar-EG',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    launchOptions: { args: ['--disable-gpu', '--disable-skia-runtime-opts', '--font-render-hinting=none', '--force-color-profile=srgb'] },
    connectOptions: renderer ? { wsEndpoint: renderer, exposeNetwork: '<loopback>' } : undefined,
  },
  webServer: guardsOnly ? undefined : { command: `mkdir -p playwright-report && LANE=0 bash scripts/web.sh production > ${serverLogOf(0)} 2>&1`, url: `${appOrigin}/sign-in`, reuseExistingServer: false, timeout: 240000 },
});
