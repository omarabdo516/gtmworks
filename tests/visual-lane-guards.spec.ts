import { test, expect, type Browser } from '@playwright/test';
import { blockOutsideRequests, expectDeterministic, fixClock } from './visual-lane-guards';

// Each guard of the visual lane fails on the page it exists for and names why, and a quiet page passes them all. The
// pages are written in place, so these tests need no app.
async function pageOf(browser: Browser, html: string, { clock = true } = {}) {
  const context = await browser.newContext();
  await blockOutsideRequests(context);
  if (clock) await fixClock(context);
  const page = await context.newPage();
  await page.setContent(html);
  return page;
}

test('a quiet page with a fixed clock and only loopback requests passes', async ({ browser }) => {
  const page = await pageOf(browser, '<p>هدوء</p><img src="http://127.0.0.1:9/nothing.png">');
  await expectDeterministic(page);
});

test('a font that fails to load is named', async ({ browser }) => {
  const page = await pageOf(browser, `<style>
    @font-face { font-family: "Broken Face"; src: url(data:font/woff2;base64,AAAA) format("woff2"); font-weight: 600; }
    p { font-family: "Broken Face", sans-serif; font-weight: 600; }
  </style><p>نص</p>`);
  await expect(expectDeterministic(page)).rejects.toThrow(/font "Broken Face" 600 did not load/);
});

test('a page whose clock is not fixed is refused', async ({ browser }) => {
  const page = await pageOf(browser, '<p>الآن</p>', { clock: false });
  await expect(expectDeterministic(page)).rejects.toThrow(/the page's clock reads \S+, not 2026-06-15T12:00:00\.000Z/);
});

test('a request that leaves the machine is blocked and named', async ({ browser }) => {
  const page = await pageOf(browser, '<img src="https://fonts.example.com/pixel.png">');
  await expect(expectDeterministic(page)).rejects.toThrow(/requests off the machine were blocked: https:\/\/fonts\.example\.com\/pixel\.png/);
});
