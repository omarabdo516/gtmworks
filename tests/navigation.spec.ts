import { test, expect } from '@playwright/test';
import { chooseLanguageInSettings } from './choose-language';
import { clickPath, idle, measureClick, median, type Timing } from './navigation-measure';
import { signIn, openNavigation, closeNavigation, openMoreSection } from './sign-in';
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { sections } from '../lib/navigation';
import { execFileSync } from 'node:child_process';

// Supabase CLI targets the local test database by default; never pass --remote.
const query = (sql: string) => execFileSync('npx', ['--no-install', 'supabase', 'db', 'query', sql, '-o', 'json', '--agent', 'no'], { encoding: 'utf8' });

// The prepared-navigation test measures a non-empty Inbox: before this file's tests one new card is moved to review,
// where it waits on Omar (the seed's approver). The setup runs in its own hooks, so the measured test keeps its own
// deadline. Cleanup approves only that card, found by its own address and its run-unique title; each worker (a retry
// starts a new one) cleans the card it created and nothing else.
let inboxFixture: { title: string, path: string } | undefined;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' });
  try {
    const page = await context.newPage();
    await signIn(page, 'omar@example.com', '/c/rs-learning/work/board');
    const title = `بطاقة قياس الوارد ${randomUUID()}`;
    await page.getByRole('button', { name: "+ New card" }).click();
    await page.getByLabel('Message', { exact: true }).fill(title);
    await page.getByRole('button', { name: "Create card" }).click();
    await expect(page.locator('.modal h2').first()).toHaveText(title);
    const path = new URL(page.url()).pathname;
    expect(path).toMatch(/^\/c\/rs-learning\/work\/board\/\d+$/);
    inboxFixture = { title, path };
    await page.getByLabel("Move to list", { exact: true }).selectOption({ label: 'مراجعة' });
    await expect(page.locator('.card-stage-line')).toContainText('مراجعة');
  } finally { await context.close(); }
});
test.afterAll(async ({ browser }) => {
  const created = inboxFixture;
  if (!created) return;
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' });
  try {
    const page = await context.newPage();
    await signIn(page, 'omar@example.com', '/c/rs-learning/approvals');
    await expect(page.locator('.approvals')).toBeVisible();
    const card = page.locator('.approval-card')
      .filter({ has: page.locator(`a[href="${created.path}"]`) })
      .filter({ hasText: created.title });
    // A setup that failed before the move left no approval to clean; otherwise exactly this card is approved, once,
    // as the seed's single step needs (the same flow as "own comments, moves and approvals ...").
    if (await card.count()) {
      expect(await card.count(), 'only the card this run created').toBe(1);
      // The waiting column lists the card; its decision is taken inside the card (#16).
      await card.getByRole('link', { name: created.title }).click();
      await page.locator('[data-card-section="review"]').getByRole('button', { name: "Approve", exact: true }).click();
      await expect(page.locator('.card-stage-line')).toContainText('معتمد');
      await page.goto('/c/rs-learning/approvals');
      await expect(card).toHaveCount(0);
    }
    inboxFixture = undefined;
  } finally { await context.close(); }
});

test('prepared navigation and Paperclip motion inventory (production, warm-up + 3 runs)', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'omar@example.com', '/c/rs-learning/work/board');
  // The measured Inbox step opens a non-empty Inbox from the sidebar's approvals entry.
  expect(Number(await page.locator('.sidebar .sb-count[href$="/approvals"]').textContent())).toBeGreaterThan(0);
  const runs: Record<string, Timing[]> = Object.fromEntries(clickPath.map(step => [step.name, []]));
  for (let run = 0; run < 4; run++) {
    await page.goto('/c/rs-learning/work/board');
    await expect(page.locator('.board')).toBeVisible();
    for (const step of clickPath) {
      const timing = await measureClick(page, step);
      if (run) runs[step.name].push(timing);
    }
  }
  const results = Object.fromEntries(Object.entries(runs).map(([name, timings]) => [name, {
    shown: median(timings.map(t => t.shown)), settled: median(timings.map(t => t.settled)),
  }]));
  // Enforce wall-clock budgets in CI; shared local hosts still report every sample.
  const enforceBudget = process.env.CI === 'true';
  console.log('CLICK_BUDGET_MODE', enforceBudget ? 'enforced (CI=true)' : 'report-only (local)');
  console.log('CLICK_BUDGET', JSON.stringify(results));
  console.log('CLICK_RUNS', JSON.stringify(runs));
  await testInfo.attach('click-timings.json', { body: JSON.stringify({ enforceBudget, results, runs }, null, 2), contentType: 'application/json' });
  if (enforceBudget) for (const [name, timing] of Object.entries(results)) {
    expect(timing.shown, `${name}: shown ${timing.shown.toFixed(1)}ms`).toBeLessThan(100);
    expect(timing.settled, `${name}: settled ${timing.settled.toFixed(1)}ms`).toBeLessThan(200);
  }
  for (const [name, timings] of Object.entries(runs)) for (const timing of timings) {
    expect(timing.all, `${name}: unlisted computed transition-property: all`).toEqual([]);
    expect(timing.progress, `${name}: prepared click must not flash progress`).toBe(false);
  }
  expect(runs.inbox.length, 'the Inbox was measured on every counted run').toBe(3);
  await idle(page);
});

// Set aside so the new shell can match the approved design first; #55 restores it (Omar, 2026-11-12).
test.fixme('unprepared links answer within 50ms and clear feedback when content arrives', async ({ page }, testInfo) => {
  await signIn(page, 'manager@example.com', '/c/rs-learning/work/board');
  const answers: number[] = [];
  for (let run = 0; run < 4; run++) {
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    let requested!: () => void;
    const requestArrived = new Promise<void>(resolve => { requested = resolve; });
    await page.route('**/c/rs-learning/library?*', async route => {
      requested();
      await delayed;
      await route.continue();
    });
    try {
      await page.goto('/c/rs-learning/work/board');
      await expect(page.locator('.board')).toBeVisible();
      await requestArrived; // Hold the full prefetch so the click cannot use the prepared cache.
      await page.evaluate(async () => { await document.fonts.ready; });
      await page.evaluate(() => {
        const state = window as typeof window & { answerMs?: number };
        document.addEventListener('click', () => {
          const start = performance.now();
          const sample = () => {
            const bar = document.querySelector('.navigation-progress');
            const link = document.querySelector('.nav a[href$="/library"]')!;
            const style = getComputedStyle(link);
            if (bar?.getBoundingClientRect().height === 3 && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
              state.answerMs = performance.now() - start;
            } else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }, { once: true, capture: true });
      });
      await openNavigation(page);
      await page.locator('.nav a[href$="/library"]').click();
      await page.waitForFunction(() => (window as typeof window & { answerMs?: number }).answerMs !== undefined);
      const answer = await page.evaluate(() => (window as typeof window & { answerMs: number }).answerMs);
      if (run) answers.push(answer);
      await expect(page.getByRole('progressbar', { name: "Opening page" })).toBeVisible();
      release();
      await expect(page.locator('.heading h1')).toHaveText("Library");
      await expect(page.getByRole('progressbar')).toHaveCount(0);
      await expect(page.locator('.link-pending')).toHaveCount(0);
    } finally {
      release();
      await page.unroute('**/c/rs-learning/library?*');
    }
  }
  console.log('INSTANT_ANSWER', JSON.stringify({ median: median(answers), runs: answers }));
  await testInfo.attach('instant-answer.json', { body: JSON.stringify(answers), contentType: 'application/json' });
  expect(median(answers)).toBeLessThan(50);
});

test('visible links fully prefetch page data and closing reuses the visited board', async ({ page: sessionPage }) => {
  await signIn(sessionPage, 'manager@example.com', '/c/rs-learning/work/board');
  const page = await sessionPage.context().newPage();
  const prepared = new Map<string, string>();
  await page.route('**/c/**', async route => {
    if (route.request().headers()['rsc'] !== '1') return route.continue();
    const response = await route.fetch();
    if (route.request().headers()['next-router-prefetch'] !== '1') {
      prepared.set(new URL(route.request().url()).pathname, await response.text());
    }
    await route.fulfill({ response });
  });
  await page.goto('/c/rs-learning/work/board');
  await idle(page);
  const links = await page.locator('a[href^="/"]').evaluateAll(async links => {
    // Respect clipping inside the scrolling sidebar and board, as link prefetch does.
    const visible = await Promise.all(links.map(link => new Promise<boolean>(resolve => {
      const observer = new IntersectionObserver(([entry]) => {
        observer.disconnect();
        resolve(entry.intersectionRatio > 0);
      });
      observer.observe(link);
    })));
    return links.filter((_, index) => visible[index]).map(link => link.getAttribute('href')!);
  });
  expect(links.some(link => /\/board\/\d+$/.test(link))).toBe(true);
  for (const link of new Set(links)) {
    // The current page already carries its data; it needs no prefetch of itself.
    if (link === '/c/rs-learning/work/board') continue;
    // Network idle can precede the browser's visibility callback that starts prefetch.
    await expect.poll(() => prepared.has(link), { message: `${link}: full prefetch response` }).toBe(true);
    const body = prepared.get(link)!;
    expect(body, `${link}: page data, not a partial layout/loading shell`).toContain('"content"');
    if (link.endsWith('/home')) expect(body).toContain("Recent activity");
    if (/\/board\/\d+$/.test(link)) expect(body).toContain(`"cardId":${link.split('/').pop()}`);
    if (link.endsWith('/work/calendar')) expect(body).toContain('work/calendar');
    if (link.endsWith('/work/list')) expect(body).toContain('work/list');
  }
  await page.locator('.card a[href$="/board/1"]').click();
  await expect(page.locator('.modal')).toBeVisible();
  await idle(page);
  const requests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/c/')) requests.push(request.url());
  });
  await page.locator('.close-card').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await idle(page);
  expect(requests, 'return to the board must make no company server request').toEqual([]);
});

test('reduced motion disables hover, veil and card animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, 'manager@example.com', '/c/rs-learning/work/board');
  for (const step of clickPath.slice(0, 4)) {
    const timing = await measureClick(page, step);
    expect(timing.longest).toBe(0);
    expect(timing.all).toEqual([]);
  }
});

test('own comments, moves and approvals invalidate prepared pages immediately', async ({ page }) => {
  await signIn(page, 'omar@example.com', '/c/rs-learning/work/board');
  await idle(page); // Home, board and the inbox are prepared before any write.
  await page.getByRole('button', { name: "+ New card" }).click();
  const title = `بطاقة تحديث فوري ${Date.now()}`;
  await page.getByLabel('Message',{exact:true}).fill(title);
  await page.getByRole('button', { name: "Create card" }).click();
  await expect(page.locator('.modal h2').first()).toHaveText(title);
  const cardPath = new URL(page.url()).pathname;
  const comment = `تعليق فوري ${Date.now()}`;
  await page.getByLabel("Comment", { exact: true }).fill(comment);
  await page.getByRole('button', { name: "Send", exact: true }).click();
  await expect(page.locator('.comment-body').filter({ hasText: comment })).toBeVisible();
  await page.locator('.close-card').click();
  // Home has no sidebar entry; it opens from the account menu's "More sections" (#8).
  await openMoreSection(page, 'home');
  await expect(page.locator('.comment-body').filter({ hasText: comment })).toBeVisible();
  await page.locator(`.content a[href="${cardPath}"]`).first().click();
  await page.getByLabel("Move to list", { exact: true }).selectOption({ label: 'مراجعة' });
  await expect(page.locator('.card-stage-line')).toContainText('مراجعة');
  await page.locator('.close-card').click();
  await expect(page.locator('.column[data-stage-name="مراجعة"] .card').filter({ hasText: title })).toBeVisible();
  await openNavigation(page);
  await page.locator('.sidebar .sb-count[href$="/approvals"]').click();
  const queued = page.locator('.approval-card').filter({ hasText: title });
  await expect(queued).toBeVisible();
  await queued.getByRole('link', { name: title }).click();
  await page.locator('[data-card-section="review"]').getByRole('button', { name: "Approve", exact: true }).click();
  await expect(page.locator('.card-stage-line')).toContainText('معتمد');
  await openNavigation(page);
  await page.locator('.sidebar .sb-count[href$="/approvals"]').click();
  await expect(queued).toHaveCount(0);
  await openNavigation(page);
  await page.locator('.nav a[href$="/work/board"]').click();
  await expect(page.locator('.column[data-stage-name="معتمد"] .card').filter({ hasText: title })).toBeVisible();
});

test('every company route loads at most 230 KiB gzip of JavaScript', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await signIn(page, 'manager@example.com', '/c/rs-learning/home');
  const sizes: Record<string, number> = {};
  for (const section of ['', ...Object.keys(sections), 'work/board/1']) {
    const routePage = await page.context().newPage();
    const scripts = new Map<string, Promise<number>>();
    routePage.on('response', response => {
      if (response.request().resourceType() === 'script') {
        scripts.set(response.url(), response.body().then(body => gzipSync(body).length));
      }
    });
    const route = `/c/rs-learning/${section}`;
    await routePage.goto(route);
    // The shell is drawn: the board, Inbox, Numbers and Activity log pages hide the top bar's title on a wide screen
    // (#16, #35, #11), so the page counts as shown once the frame has its title and its sidebar and content are visible.
    await expect(routePage.locator('.topbar .heading')).toBeAttached();
    await expect(routePage.locator('.sidebar')).toBeVisible();
    await expect(routePage.locator('.app-content')).toBeVisible();
    await idle(routePage);
    expect(scripts.size, `${route}: measured scripts`).toBeGreaterThan(0);
    const bytes = (await Promise.all(scripts.values())).reduce((total, size) => total + size, 0);
    sizes[route] = bytes;
    console.log(`JS_GZIP ${route}: ${bytes} bytes (${(bytes / 1000).toFixed(2)} KB)`);
    expect(bytes, `${route}: ${bytes} bytes gzip (limit 230 KiB)`).toBeLessThanOrEqual(230*1024);
    await routePage.close();
  }
  await testInfo.attach('js-gzip.json', { body: JSON.stringify(sizes, null, 2), contentType: 'application/json' });
});

// Tap areas that sit on top of each other. A target is measured by the part a person can reach: a row scrolled out
// of the drawer's list is cut off by the list, so its hidden part is under the footer only on paper (#48).
async function tapOverlaps(targets: import('@playwright/test').Locator) {
  return targets.evaluateAll(nodes => {
    const reach = (node: Element) => {
      const own = node.getBoundingClientRect();
      let box = { left: own.left, top: own.top, right: own.right, bottom: own.bottom };
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (!/auto|scroll|hidden|clip/.test(`${style.overflowX} ${style.overflowY}`)) continue;
        const clip = parent.getBoundingClientRect();
        box = { left: Math.max(box.left, clip.left), top: Math.max(box.top, clip.top), right: Math.min(box.right, clip.right), bottom: Math.min(box.bottom, clip.bottom) };
      }
      return box;
    };
    return nodes.flatMap((node, index) => nodes.slice(index + 1).filter(other => {
      const a = reach(node), b = reach(other);
      const shown = a.right > a.left && a.bottom > a.top && b.right > b.left && b.bottom > b.top;
      return shown && !node.contains(other) && !other.contains(node) && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }).map(other => `${node.textContent} / ${other.textContent}`));
  });
}

test('drawer targets are at least 44px and do not overlap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, 'manager@example.com', '/c/rs-learning/home');
  try {
    for (const language of ['en', 'ar']) {
      await chooseLanguageInSettings(page,language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await page.goto('/c/rs-learning/home');
      await openNavigation(page);
      await expect(page.getByRole('dialog')).toBeVisible();
      const drawer = page.getByRole('dialog', { name: language === 'ar' ? 'القايمة الرئيسية' : 'Main menu' });
      await expect(drawer).toHaveAttribute('aria-modal', 'true');
      await mkdir('test-results/screenshots', { recursive: true });
      await page.screenshot({ path: `test-results/screenshots/drawer-${language}-390.png` });
      // The approvals entry is there even when nothing waits (the manager has nothing to approve in the seed),
      // and the company picker is a target like the rest.
      await expect(drawer.locator('.sb-count[href$="/approvals"]')).toBeVisible();
      await expect(drawer.locator('.sb-count[href$="/approvals"]')).toHaveAccessibleName(/./);
      await expect(drawer.getByRole('button', { name: language === 'ar' ? 'اختيار الشركة' : 'Choose company', exact: true })).toBeVisible();
      const targets = drawer.locator(':is(.sb-item, .sb-count, .switch, .circle-btn, .me, .agent-tile)');
      const count = await targets.count();
      expect(count, `${language}: drawer has targets`).toBeGreaterThan(0);
      for (const kind of ['.sb-count', '.switch']) expect(await drawer.locator(kind).count(), `${language}: ${kind} is measured`).toBe(1);
      for (let index = 0; index < count; index++) {
        const box = (await targets.nth(index).boundingBox())!;
        expect.soft(box.height, `${language} target ${index}: height`).toBeGreaterThanOrEqual(44);
        expect.soft(box.width, `${language} target ${index}: width`).toBeGreaterThanOrEqual(44);
      }
      // No tap area sits on top of another one.
      expect.soft(await tapOverlaps(targets), `${language}: overlapping targets`).toEqual([]);
      await closeNavigation(page);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  } finally {
  await page.setViewportSize({ width: 1440, height: 900 });
  await chooseLanguageInSettings(page,'en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  }
});

test('with many recent chats and cards the drawer list scrolls above a footer that stays put, and no tap areas overlap', async ({ page }) => {
  // The Manager's own chats and three recent cards make the list longer than a phone screen (#48).
  const company = '10000000-0000-0000-0000-000000000001', manager = '20000000-0000-0000-0000-000000000002', stamp = Date.now();
  const chats = Array.from({ length: 12 }, (_, index) => `63000000-0000-4000-8000-${String(stamp + index).slice(-12).padStart(12, '0')}`);
  query(`insert into public.conversations(id,company_id,person_id,agent_name) values ${chats.map(id => `('${id}','${company}','${manager}','Lead')`).join(',')}`);
  query(`insert into public.work_card_visits(company_id,person_id,card_id) select '${company}','${manager}',id from public.work_cards where company_id='${company}' order by id limit 3 on conflict do nothing`);
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, 'manager@example.com', '/c/rs-learning/home');
  try {
    for (const language of ['en', 'ar']) {
      await chooseLanguageInSettings(page, language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await page.goto('/c/rs-learning/home');
      await openNavigation(page);
      const drawer = page.getByRole('dialog', { name: language === 'ar' ? 'القايمة الرئيسية' : 'Main menu' });
      await expect(drawer.locator('.recent-cards a')).toHaveCount(3);
      await expect(drawer.locator('#sb-recent .thread-item')).not.toHaveCount(0);
      const list = drawer.locator('.sb-scroll'), foot = drawer.locator('.sb-foot');
      // The list is longer than its place, so it scrolls, and its place ends where the footer begins.
      expect(await list.evaluate(node => node.scrollHeight > node.clientHeight), `${language}: the list scrolls`).toBe(true);
      const [listBox, footBox, drawerBox] = [await list.boundingBox(), await foot.boundingBox(), await drawer.boundingBox()];
      expect(listBox!.y + listBox!.height, `${language}: the list ends above the footer`).toBeLessThanOrEqual(footBox!.y + 0.5);
      expect(footBox!.y + footBox!.height, `${language}: the footer stays at the bottom`).toBeCloseTo(drawerBox!.y + drawerBox!.height, 0);
      const targets = drawer.locator(':is(.sb-item, .sb-count, .switch, .circle-btn, .me, .agent-tile)');
      for (const position of ['top', 'bottom']) {
        await list.evaluate((node, end) => { node.scrollTop = end === 'top' ? 0 : node.scrollHeight; }, position);
        await expect(foot).toBeVisible();
        // Every footer control answers a tap at its centre, whatever the list shows behind it.
        for (const control of await foot.locator(':is(.sb-item, .me, .circle-btn)').all()) {
          expect(await control.evaluate(node => { const box = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)); }), `${language} ${position}: ${await control.textContent()} answers its tap`).toBe(true);
        }
        expect.soft(await tapOverlaps(targets), `${language} ${position}: overlapping targets`).toEqual([]);
      }
      // At the end of the list the last recent card is wholly above the footer and answers its own tap.
      const last = drawer.locator('.recent-cards a').last();
      const lastBox = (await last.boundingBox())!;
      expect(lastBox.y + lastBox.height, `${language}: the last card ends above the footer`).toBeLessThanOrEqual(footBox!.y + 0.5);
      expect(await last.evaluate(node => { const box = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)); })).toBe(true);
      await closeNavigation(page);
    }
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
    await chooseLanguageInSettings(page, 'en');
    query(`delete from public.conversations where id in (${chats.map(id => `'${id}'`).join(',')})`);
    query(`delete from public.work_card_visits where company_id='${company}' and person_id='${manager}'`);
  }
});
