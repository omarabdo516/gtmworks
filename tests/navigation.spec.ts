import { test, expect } from '@playwright/test';
import { clickPath, idle, measureClick, median, type Timing } from './navigation-measure';
import { signIn, openNavigation, closeNavigation } from './sign-in';
import { gzipSync } from 'node:zlib';
import { mkdir } from 'node:fs/promises';
import { sections } from '../lib/navigation';

test('prepared navigation and Paperclip motion inventory (production, warm-up + 3 runs)', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'manager@example.com', '/c/rs-learning/work/board');
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
  await openNavigation(page);
  await page.locator('.nav a[href$="/home"]').click();
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
  await queued.locator('.approval-expand > summary').click();
  await queued.getByRole('button', { name: "Approve", exact: true }).click();
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
    await expect(routePage.locator('.topbar .heading')).toBeVisible();
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

test('drawer targets are at least 44px and do not overlap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, 'manager@example.com', '/c/rs-learning/home');
  try {
    for (const language of ['en', 'ar']) {
      await page.goto('/c/rs-learning/settings');
      await page.locator('select[name=language]').selectOption(language);
      await page.locator('form').filter({ has: page.locator('select[name=language]') }).getByRole('button').click();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await page.goto('/c/rs-learning/home');
      await openNavigation(page);
      await expect(page.getByRole('dialog')).toBeVisible();
      const drawer = page.getByRole('dialog', { name: language === 'ar' ? 'القايمة الرئيسية' : 'Main menu' });
      await expect(drawer).toHaveAttribute('aria-modal', 'true');
      await mkdir('test-results/screenshots', { recursive: true });
      await page.screenshot({ path: `test-results/screenshots/drawer-${language}-390.png` });
      const targets = drawer.locator(':is(.sb-item, .circle-btn, .me, .agent-tile)');
      const count = await targets.count();
      expect(count, `${language}: drawer has targets`).toBeGreaterThan(0);
      for (let index = 0; index < count; index++) {
        const box = (await targets.nth(index).boundingBox())!;
        expect.soft(box.height, `${language} target ${index}: height`).toBeGreaterThanOrEqual(44);
        expect.soft(box.width, `${language} target ${index}: width`).toBeGreaterThanOrEqual(44);
      }
      // No tap area sits on top of another one.
      const overlaps = await targets.evaluateAll(nodes => nodes.flatMap((node, index) => nodes.slice(index + 1).filter(other => {
        const a = node.getBoundingClientRect(), b = other.getBoundingClientRect();
        return !node.contains(other) && !other.contains(node) && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      }).map(other => `${node.textContent} / ${other.textContent}`)));
      expect.soft(overlaps, `${language}: overlapping targets`).toEqual([]);
      await closeNavigation(page);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  } finally {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/c/rs-learning/settings');
  await page.locator('select[name=language]').selectOption('en');
  await page.locator('form').filter({ has: page.locator('select[name=language]') }).getByRole('button').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  }
});
