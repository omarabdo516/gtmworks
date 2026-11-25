import { test, expect, type Browser } from './offline-browser';
import { expectDarkContrast, expectQuietContrast } from './contrast';

// The contrast measure fails on the text it exists for and names it, and passes text that keeps its ratio (#218, #805;
// moved from the visual lane's guard tests, #257). The pages are written in place, so these tests need no app data.
async function pageOf(browser: Browser, html: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent(html);
  return page;
}

test('a quiet label below 4.5:1 is named, and one at 4.5:1 that stays weaker than the body text passes', async ({ browser }) => {
  const page = await pageOf(browser, `<body style="color: #111; background: #fff">
    <span class="faint" style="color: #bbb">تفصيلة باهتة</span><span class="quiet" style="color: #666">تفصيلة هادية</span></body>`);
  await expectQuietContrast(page, [['quiet label', '.quiet']]);
  await expect(expectQuietContrast(page, [['quiet label', '.faint']])).rejects.toThrow(/quiet label "تفصيلة باهتة"/);
  await expect(expectQuietContrast(page, [['quiet label', '.missing']])).rejects.toThrow(/quiet label: nothing to measure/);
});

test('dark text below 4.5:1 is named, and text at 4.5:1 or more passes', async ({ browser }) => {
  const faint = await pageOf(browser, '<body style="background:#111;color:#eee"><p>واضح</p><p style="color:#444">باهت</p></body>');
  await expect(expectDarkContrast(faint)).rejects.toThrow(/باهت/);
  const clear = await pageOf(browser, '<body style="background:#111;color:#eee"><p>واضح</p><p style="color:#999">هادي</p></body>');
  await expectDarkContrast(clear);
});

test('dark text is measured on the canvas the dark scheme draws when no element sets a background', async ({ browser }) => {
  const page = await pageOf(browser, '<html style="color-scheme: dark"><body style="color:#ddd"><p>واضح</p></body></html>');
  await expectDarkContrast(page);
  const faint = await pageOf(browser, '<html style="color-scheme: dark"><body style="color:#333"><p>باهت</p></body></html>');
  await expect(expectDarkContrast(faint)).rejects.toThrow(/باهت/);
});
