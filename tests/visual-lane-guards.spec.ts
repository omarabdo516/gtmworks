import { test, expect, type Browser } from '@playwright/test';
import { blockOutsideRequests, expectDeterministic, expectQuietContrast, fixClock } from './visual-lane-guards';

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
  const page = await pageOf(browser, '<p style="font-family: sans-serif">هدوء</p><img src="http://127.0.0.1:9/nothing.png">');
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

test('a font family no face declares is named', async ({ browser }) => {
  const page = await pageOf(browser, '<p style="font-family: \'Missing Face\', sans-serif">نص</p>');
  await expect(expectDeterministic(page)).rejects.toThrow(/font "Missing Face" is not declared/);
});

test('a declared face that covers none of the text is named', async ({ browser }) => {
  const page = await pageOf(browser, `<style>
    @font-face { font-family: "Latin Only"; src: local("DejaVu Sans"), local("Arial"); unicode-range: U+0000-00FF; }
    p { font-family: "Latin Only", sans-serif; }
  </style><p>نص عربي</p>`);
  await expect(expectDeterministic(page)).rejects.toThrow(/font "Latin Only" covers none of "نص عربي"/);
});

test('a redirect off the machine is named', async ({ browser }) => {
  const page = await pageOf(browser, '');
  await page.route('http://127.0.0.1:9/hop.png', route => route.fulfill({ status: 302, headers: { location: 'https://elsewhere.example/pixel.png' } }));
  const hop = page.waitForEvent('request', request => request.url().startsWith('https://elsewhere.example/'));
  await page.setContent('<img src="http://127.0.0.1:9/hop.png">', { waitUntil: 'commit' });
  await hop;
  await expect(expectDeterministic(page)).rejects.toThrow(/https:\/\/elsewhere\.example\/pixel\.png/);
});

test('a WebSocket off the machine is named', async ({ browser }) => {
  const page = await pageOf(browser, '<script>new WebSocket("wss://socket.example/live")</script>');
  await expect(expectDeterministic(page)).rejects.toThrow(/wss:\/\/socket\.example\/live/);
});

test('a quiet label below 4.5:1 is named, and one at 4.5:1 that stays weaker than the body text passes', async ({ browser }) => {
  const page = await pageOf(browser, `<body style="color: #111; background: #fff">
    <span class="faint" style="color: #bbb">تفصيلة باهتة</span><span class="quiet" style="color: #666">تفصيلة هادية</span></body>`);
  await expectQuietContrast(page, [['quiet label', '.quiet']]);
  await expect(expectQuietContrast(page, [['quiet label', '.faint']])).rejects.toThrow(/quiet label "تفصيلة باهتة"/);
  await expect(expectQuietContrast(page, [['quiet label', '.missing']])).rejects.toThrow(/quiet label: nothing to measure/);
});
