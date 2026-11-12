import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { signIn } from './sign-in';
import { resetFirstRun } from '../scripts/first-run-db.mjs';
import { idle } from './navigation-measure';
import { languages, widths, screens, snapshotName } from './visual-screens.mjs';

// Every listed screen is compared with its approved image (tests/visual.spec.ts-snapshots) in both languages at 1440 and 390.
// This project runs first on the freshly seeded database (see playwright.config.ts). It leaves the data as the seed built it,
// except the opened-card record that opening a card always makes, and it restores the owner's language and sign-in factor.
type Language = 'en' | 'ar';
const owner = '20000000-0000-0000-0000-000000000001';
const rsLearning = '10000000-0000-0000-0000-000000000001';
const seedAuthor = '30000000-0000-0000-0000-000000000001';
const contextOptions = {
  baseURL: 'http://127.0.0.1:3000',
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light' as const,
  reducedMotion: 'reduce' as const,
};
// Supabase CLI targets the local test database by default; never pass --remote.
const query = (sql: string) => execFileSync('npx', ['--no-install', 'supabase', 'db', 'query', sql, '-o', 'json', '--agent', 'no'], { encoding: 'utf8' });

// The seed schedules its cards relative to the moment the database was built. Pin them to fixed days in a past month so
// the board, the card and the calendar look the same on every run, through the same audit trigger the app uses.
function fixPublishingDates() {
  query(`do $$ begin
    perform set_config('request.jwt.claim.sub','${seedAuthor}',true);
    update public.work_cards c set go_live=x.fixed
    from (select id,('2026-06-'||lpad((row_number() over (order by id)*4)::text,2,'0')||'T12:00:00Z')::timestamptz fixed
          from public.work_cards where company_id='${rsLearning}') x
    where c.id=x.id and c.go_live is distinct from x.fixed;
  end $$;`);
}

function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)?.map(b => parseInt(b, 2)) || []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', key).update(counter).digest();
  const offset = hash[19] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

async function chooseLanguage(page: Page, language: Language) {
  await page.goto('/c/rs-learning/settings');
  await page.locator('select[name=language]').selectOption(language);
  await page.locator('form').filter({ has: page.locator('select[name=language]') }).getByRole('button').click();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
}

// The shell scrolls inside its own frame, so a page taller than the window would be cut at the fold. Grow the window until
// nothing scrolls, so the whole screen is compared.
async function showWholePage(page: Page, width: number) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const hidden = await page.evaluate(() => Math.max(0, ...Array.from(document.querySelectorAll('*'))
      .filter(element => /auto|scroll/.test(getComputedStyle(element).overflowY) && element.clientHeight > 0)
      .map(element => element.scrollHeight - element.clientHeight)));
    if (hidden <= 1) return;
    await page.setViewportSize({ width, height: Math.min(page.viewportSize()!.height + hidden, 8000) });
    await idle(page);
  }
}

// Times and the 14 day chart labels follow the real calendar, so they are replaced by fixed text; the layout around
// them, their font and their colour are still compared.
async function fixClockText(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur(); // no focus ring or open picker in the picture
    const months = 'January|February|March|April|May|June|July|August|September|October|November|December|يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر';
    const monthName = new RegExp(months);
    const skipped = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE']);
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      if (element.children.length || skipped.has(element.tagName)) continue;
      const text = (element.textContent ?? '').trim();
      if (element.closest('.chart-bars') && /\d/.test(text) && monthName.test(text)) element.textContent = 'Month 00';
      else if (element.tagName === 'TIME' || /\d{1,2}:\d{2}/.test(text)) element.textContent = 'Date, 00:00';
    }
  });
}

const readyBy: Record<string, string> = {
  home: '.home-dashboard',
  chat: '.chat',
  board: '.board',
  card: '.modal',
  calendar: '.calendar',
  approvals: '.approvals',
  members: '.member-row',
  'work-settings': '.settings-row',
  agencies: '.company-card',
};

async function showScreen(page: Page, screen: (typeof screens)[number], width: number) {
  await page.emulateMedia({ colorScheme: screen.dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(screen.path);
  await expect(page.locator(readyBy[screen.name.replace('-dark', '')] ?? '.content').first()).toBeVisible();
  if (screen.name === 'calendar') {
    // The calendar opens on the current month; every run compares the month the seeded cards are pinned to.
    const title = page.locator('.calendar-title');
    await expect(async () => {
      await page.locator('input[type=month]').fill('2026-06');
      await expect(title).toContainText('2026');
    }).toPass();
    await expect(page.locator('.calendar').getByRole('link')).toHaveCount(5);
  }
  await idle(page);
  // The fixed text is shorter than a real date, so it changes how rows wrap and how tall the page is. It goes in before the
  // window is sized, otherwise the window is sized for the real date and the picture keeps blank space that depends on the day.
  await fixClockText(page);
  await showWholePage(page, width);
}

test.describe('anonymous screens', () => {
  let context: BrowserContext;
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext(contextOptions);
    page = await context.newPage();
  });
  test.afterAll(async () => { await context.close(); });

  for (const language of languages as Language[]) for (const width of widths) for (const screen of screens.filter(s => s.anonymous && s.name !== 'first-run')) {
    test(`${screen.name} ${language} ${width}`, async () => {
      await page.emulateMedia({ colorScheme: screen.dark ? 'dark' : 'light' });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(screen.path);
      await page.locator('select').selectOption(language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await idle(page);
      await showWholePage(page, width);
      // With reduced motion the artwork holds its first frame; it only exists on the wide layout.
      if (width === 1440) await expect(page.locator('pre[aria-hidden=true]')).toContainText('╭');
      if (screen.dark) await expectDarkContrast(page);
      await expect(page).toHaveScreenshot(`${snapshotName(screen, language, width)}.png`, { fullPage: true });
    });
  }
});

test.describe('signed-in screens', () => {
  let context: BrowserContext;
  let page: Page;
  let current: Language | null = null;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240000);
    // A clean slate if an earlier run stopped half way: no authenticator, the seeded dates, English.
    query(`delete from auth.mfa_factors where user_id='${owner}'`);
    fixPublishingDates();
    context = await browser.newContext(contextOptions);
    page = await context.newPage();
    await signIn(page, 'omar@example.com', '/c/rs-learning/settings');
    // The agency list shows companies only after two-step verification; the factor is removed again in afterAll.
    await page.goto('/all-brands');
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    await page.getByRole('button', { name: 'Set up authenticator' }).click();
    const secret = await page.locator('code').textContent();
    expect(secret).toBeTruthy();
    await page.getByLabel('Verification code').fill(totp(secret!));
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(page.locator('.company-card')).toHaveCount(3);
    await chooseLanguage(page, 'en');
    current = 'en';
    // The sidebar lists recently opened cards and opening one is recorded. Open card 1 now so that every screen,
    // in every run, starts with the same list.
    await page.goto('/c/rs-learning/work/board/1');
    await expect(page.locator('.modal')).toBeVisible();
    await idle(page);
    await page.goto('/c/rs-learning/home');
    await expect(page.locator('.recent-cards a')).toHaveCount(1);
  });
  test.afterAll(async () => {
    try {
      if (page && current !== 'en') await chooseLanguage(page, 'en');
    } finally {
      query(`delete from auth.mfa_factors where user_id='${owner}'`);
      await context?.close();
    }
  });

  for (const language of languages as Language[]) for (const width of widths) for (const screen of screens.filter(s => !s.anonymous)) {
    test(`${screen.name} ${language} ${width}`, async () => {
      if (current !== language) {
        await chooseLanguage(page, language);
        current = language;
      }
      await showScreen(page, screen, width);
      if (screen.dark) await expectDarkContrast(page);
      await expect(page).toHaveScreenshot(`${snapshotName(screen, language, width)}.png`, { fullPage: true });
    });
  }
});

async function expectDarkContrast(page: Page) {
  const result = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string) => { canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = css; canvas.fillRect(0, 0, 1, 1); const bytes = canvas.getImageData(0, 0, 1, 1).data; return [bytes[0], bytes[1], bytes[2], bytes[3] / 255]; };
    const over = (top: number[], below: number[]) => [0, 1, 2].map(index => top[index] * top[3] + below[index] * (1 - top[3]));
    const luminance = (color: number[]) => color.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const targets: { element: Element, text: string, pseudo?: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      if (text) targets.push({ element: walker.currentNode.parentElement!, text });
    }
    for (const element of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=hidden]),textarea')) {
      const text = element.value || element.placeholder;
      if (text) targets.push({ element, text, pseudo: element.value ? undefined : '::placeholder' });
    }
    for (const element of document.querySelectorAll<HTMLSelectElement>('select')) targets.push({ element, text: element.selectedOptions[0]?.text || '' });
    let checked = 0;
    const failures = [];
    for (const { element, text, pseudo } of targets) {
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.closest('[aria-hidden=true],.sr-only')) continue;
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      let background = [255, 255, 255], opacity = 1;
      const chain: Element[] = [];
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) chain.unshift(ancestor);
      for (const ancestor of chain) { const style = getComputedStyle(ancestor); background = over(rgba(style.backgroundColor), background); opacity *= Number(style.opacity); }
      const style = getComputedStyle(element, pseudo);
      const color = rgba(style.color);
      const shown = over([color[0], color[1], color[2], color[3] * opacity * (pseudo ? Number(style.opacity) : 1)], background);
      const values = [luminance(shown), luminance(background)].sort((first, second) => second - first);
      const ratio = (values[0] + 0.05) / (values[1] + 0.05);
      checked++;
      if (ratio < 4.5) failures.push({ text, ratio });
    }
    return { checked, failures };
  });
  expect(result.checked, 'visible dark text was measured').toBeGreaterThan(0);
  await test.info().attach('dark-contrast', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.failures, `${result.checked} dark text runs checked at 4.5:1`).toEqual([]);
}

// Last visual group: capture a real empty installation, then restore the exact seed before functional starts.
test.describe('first-run screens', () => {
  test.use(contextOptions);
  test.beforeAll(({ baseURL }) => resetFirstRun(baseURL));
  test.afterAll(({ baseURL }) => resetFirstRun(baseURL, true));
  const screen = screens.find(screen => screen.name === 'first-run')!;
  for (const language of languages) for (const width of widths) {
    test(`first-run ${language} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(screen.path);
      await page.locator('select').selectOption(language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
      await expect(page.locator('input[name=company]')).toBeVisible();
      await idle(page);
      await showWholePage(page, width);
      await expect(page).toHaveScreenshot(`${snapshotName(screen, language, width)}.png`, { fullPage: true });
    });
  }
});
