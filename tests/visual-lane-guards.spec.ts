import { test, expect, type Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { blockOutsideRequests, expectDarkContrast, expectDeterministic, expectQuietContrast, fixClock, fixClockText, forgetBlocked } from './visual-lane-guards';

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

// The day-group header the log draws (LogDays / useDayName, app/c/[slug]/log/log-client.tsx) names the row's day
// against the reader's clock, outside any <time>, so a run that crosses midnight would draw another word for the same
// rows. This is the lane's day text at the seed's own moment and again at 00:01 the day after.
const seedMoment = new Date('2026-06-15T12:00:00Z');
const dayAfter = new Date('2026-06-16T00:01:00Z');
const ar = JSON.parse(readFileSync('lib/messages/ar.json', 'utf8')) as Record<string, string>;

async function pageAt(browser: Browser, time: Date) {
  const context = await browser.newContext();
  await blockOutsideRequests(context);
  await context.clock.setFixedTime(time);
  return context.newPage();
}

// The page draws the header with the rule useDayName uses: the row's day against today's, in UTC, Today / Yesterday.
const dayHeaderPage = () => `<section class="lg-day"><h3 class="lg-day__h"></h3><time>12:00</time></section><script>
  const day = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'UTC' });
  const today = day(new Date().toISOString()), row = day('2026-06-15T11:55:00Z');
  const back = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(row + 'T00:00:00Z')) / 86400000);
  document.querySelector('.lg-day__h').textContent = back === 0 ? ${JSON.stringify(ar.logToday)} : back === 1 ? ${JSON.stringify(ar.logYesterday)} : row;
</script>`;

test('the day a log header names follows the lane clock, and the clock-text pass fixes it so a run at 00:01 the next day draws the same', async ({ browser }) => {
  const before = await pageAt(browser, seedMoment);
  await before.setContent(dayHeaderPage());
  const after = await pageAt(browser, dayAfter);
  await after.setContent(dayHeaderPage());
  try {
    // The clock is what moves it: the same rows read النهارده at the seed's moment and امبارح at 00:01.
    await expect(before.locator('.lg-day__h')).toHaveText(ar.logToday);
    await expect(after.locator('.lg-day__h')).toHaveText(ar.logYesterday);
    await fixClockText(before);
    await fixClockText(after);
    expect(await after.locator('.lg-day__h').textContent()).toBe(await before.locator('.lg-day__h').textContent());
    expect(await after.locator('body').innerText()).toBe(await before.locator('body').innerText());
  } finally {
    await before.context().close();
    await after.context().close();
  }
});

test('a request that leaves the machine is blocked and named', async ({ browser }) => {
  const page = await pageOf(browser, '<img src="https://fonts.example.com/pixel.png">');
  await expect(expectDeterministic(page)).rejects.toThrow(/requests off the machine were blocked: https:\/\/fonts\.example\.com\/pixel\.png/);
});

test('a local-only face the machine lacks and a run of symbols alone are not named: the pinned image draws them alike', async ({ browser }) => {
  // "Latin Only" is no next/font fallback, so it is checked like any face: it names one the pinned image has.
  const page = await pageOf(browser, `<style>
    @font-face { font-family: "Body Fallback"; src: local("No Such Face Anywhere"); ascent-override: 90%; descent-override: 22%; size-adjust: 107%; }
    @font-face { font-family: "Latin Only"; src: local("Liberation Sans"); unicode-range: U+0000-00FF; }
    p { font-family: "Body Fallback", sans-serif; } b { font-family: "Latin Only", sans-serif; }
  </style><p>نص</p><b>✕</b>`);
  await page.evaluate(() => document.fonts.load('16px "Body Fallback"', 'نص').catch(() => {}));
  await expectDeterministic(page);
});

test('a family with one url() face is checked whole, even beside a local-only face', async ({ browser }) => {
  const page = await pageOf(browser, `<style>
    @font-face { font-family: "Mixed Face"; src: local("No Such Face Anywhere"); font-weight: 400; }
    @font-face { font-family: "Mixed Face"; src: url(data:font/woff2;base64,AAAA) format("woff2"); font-weight: 600; }
    p { font-family: "Mixed Face", sans-serif; font-weight: 600; }
  </style><p>نص</p>`);
  await expect(expectDeterministic(page)).rejects.toThrow(/font "Mixed Face" 600 did not load/);
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

test('dark text below 4.5:1 is named, and text at 4.5:1 or more passes', async ({ browser }) => {
  const faint = await pageOf(browser, '<body style="background:#111;color:#eee"><p>واضح</p><p style="color:#444">باهت</p></body>');
  await expect(expectDarkContrast(faint)).rejects.toThrow(/باهت/);
  const clear = await pageOf(browser, '<body style="background:#111;color:#eee"><p>واضح</p><p style="color:#999">هادي</p></body>');
  await expectDarkContrast(clear);
});

test('a run of symbols alone in a family no face declares is named', async ({ browser }) => {
  const page = await pageOf(browser, '<p style="font-family: sans-serif">نص</p><b style="font-family: \'Gone Icons\', sans-serif">✕</b>');
  await expect(expectDeterministic(page)).rejects.toThrow(/font "Gone Icons" is not declared/);
});

test('a local-only face is passed only when next/font made it as a fallback; any other local-only face is checked', async ({ browser }) => {
  const page = await pageOf(browser, `<style>
    @font-face { font-family: "Shop Face"; src: local("No Such Face Anywhere"); }
    p { font-family: "Shop Face", sans-serif; }
  </style><p>نص</p>`);
  await page.evaluate(() => document.fonts.load('16px "Shop Face"', 'نص').catch(() => {}));
  await expect(expectDeterministic(page)).rejects.toThrow(/font "Shop Face"/);
});

// #359: the name alone is not next/font's mark. A local-only face named "... Fallback" is passed only when it also
// carries the metric overrides next/font writes on every fallback face it makes (size-adjust, ascent-override).
test('a local-only face named like a fallback is passed only with next/font\'s metric overrides', async ({ browser }) => {
  const made = await pageOf(browser, `<style>
    @font-face { font-family: "Made Fallback"; src: local("No Such Face Anywhere"); ascent-override: 90%; size-adjust: 107%; }
    p { font-family: "Made Fallback", sans-serif; }
  </style><p>نص</p>`);
  await made.evaluate(() => document.fonts.load('16px "Made Fallback"', 'نص').catch(() => {}));
  await expectDeterministic(made);
  for (const [family, overrides] of [['Named Fallback', ''], ['Half Fallback', 'size-adjust: 107%;']]) {
    const named = await pageOf(browser, `<style>
      @font-face { font-family: "${family}"; src: local("No Such Face Anywhere"); ${overrides} }
      p { font-family: "${family}", sans-serif; }
    </style><p>نص</p>`);
    await named.evaluate(name => document.fonts.load(`16px "${name}"`, 'نص').catch(() => {}), family);
    await expect(expectDeterministic(named), family).rejects.toThrow(new RegExp(`font "${family}"`));
  }
});

test('dark text is measured on the canvas the dark scheme draws when no element sets a background', async ({ browser }) => {
  const page = await pageOf(browser, '<html style="color-scheme: dark"><body style="color:#ddd"><p>واضح</p></body></html>');
  await expectDarkContrast(page);
  const faint = await pageOf(browser, '<html style="color-scheme: dark"><body style="color:#333"><p>باهت</p></body></html>');
  await expect(expectDarkContrast(faint)).rejects.toThrow(/باهت/);
});

test('a request blocked for one picture is forgotten before the next', async ({ browser }) => {
  const page = await pageOf(browser, '<p style="font-family: sans-serif">نص</p><img src="https://elsewhere.example/pixel.png">');
  await expect(expectDeterministic(page)).rejects.toThrow(/elsewhere\.example/);
  forgetBlocked(page.context());
  await page.setContent('<p style="font-family: sans-serif">نص</p>');
  await expectDeterministic(page);
});

