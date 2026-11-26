import { test, expect, freshSeed } from './fresh-seed';
import type { Page, Route } from '@playwright/test';
import { signIn, openNavigation } from './sign-in';
import { idle } from './navigation-measure';

// #789, #771: the Company's layout draws the Shell once; a page move draws only the page, and a press paints the page's
// loading frame inside the Shell before the page's data arrives.
test.beforeAll(async ({}, testInfo) => { freshSeed(testInfo); });

// Every RSC answer a page move gets (the page itself and any prefetch), as text.
function pageAnswers(page: Page) {
 const answers: { url: string, body: string }[] = [];
 page.on('response', async response => {
  if (response.request().headers()['rsc'] !== '1') return;
  answers.push({ url: response.url(), body: await response.text().catch(() => '') });
 });
 return answers;
}

test('moving between a Company\'s pages draws no sidebar: the Shell stays and its marks follow the page', async ({ page }) => {
 await page.setViewportSize({ width: 1440, height: 900 });
 await signIn(page, 'manager@example.com', '/c/rs-learning/work/board');
 await expect(page.locator('.board')).toBeVisible();
 // The first open draws the sidebar with the page.
 const html = await (await page.request.get('/c/rs-learning/log')).text();
 expect(html, 'a first open draws the sidebar').toContain('sb-nav');
 await idle(page);
 const answers = pageAnswers(page);
 const sidebar = page.locator('.sidebar');
 const marker = await sidebar.evaluate(node => { (node as HTMLElement & { kept?: boolean }).kept = true; return true; });
 expect(marker).toBe(true);
 for (const [entry, path, content] of [['Numbers', '/numbers', '.numbers-page'], ['Activity log', '/log', '.log-page']] as const) {
  await sidebar.locator('.sb-nav').getByRole('link', { name: entry, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/rs-learning${path}$`));
  await expect(page.locator(content)).toBeVisible();
  await expect(sidebar.locator('.sb-nav [aria-current="page"]'), `${entry} is the current entry`).toHaveText(entry);
 }
 await idle(page);
 expect(answers.length, 'the moves were answered by the server').toBeGreaterThan(0);
 for (const answer of answers) expect(answer.body, `${answer.url} draws no sidebar`).not.toContain('sb-nav');
 // The same sidebar element stayed on the page through both moves.
 expect(await sidebar.evaluate(node => !!(node as HTMLElement & { kept?: boolean }).kept)).toBe(true);
});

test('a press paints the page\'s loading frame inside the Shell before its data arrives, and the page fills it', async ({ page }) => {
 await page.setViewportSize({ width: 1440, height: 900 });
 await signIn(page, 'manager@example.com', '/c/rs-learning/work/board');
 await expect(page.locator('.board')).toBeVisible();
 await idle(page);
 // Every request for the Activity log (the intent's prefetch and the press) waits until the test lets it go.
 let release!: () => void;
 const held = new Promise<void>(resolve => { release = resolve; });
 const hold = async (route: Route) => { await held; await route.continue(); };
 await page.route('**/c/rs-learning/log?*', hold);
 await page.route('**/c/rs-learning/log', hold);
 try {
  await openNavigation(page);
  await page.locator('.sidebar .sb-nav').getByRole('link', { name: 'Activity log', exact: true }).click();
  const frame = page.locator('.app-content[aria-busy="true"]');
  await expect(frame).toBeVisible();
  await expect(frame.getByRole('status')).toHaveText('Opening page');
  // One frame: the loading frame is drawn in the page's own top bar and content, never beside a second one.
  await expect(page.locator('.topbar')).toHaveCount(1);
  await expect(page.locator('.sidebar .sb-nav')).toBeVisible();
  await expect(page.locator('.board'), 'the page left is out of sight at once').toBeHidden();
  await expect(page.locator('.log-page'), 'the page has not arrived').toHaveCount(0);
  release();
  await expect(page.locator('.log-page')).toBeVisible();
  await expect(frame).toHaveCount(0);
  await expect(page.locator('.topbar')).toHaveCount(1);
  await expect(page.locator('.app-content')).toHaveCount(1);
 } finally {
  release();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
 }
});

test('the sidebar\'s poll carries the recent chats and what waits on the reader, which a page move no longer draws', async ({ page }) => {
 await signIn(page, 'omar@example.com', '/c/rs-learning/home');
 const company = '10000000-0000-0000-0000-000000000001', omar = '20000000-0000-0000-0000-000000000001';
 const answer = await (await page.request.get(`/api/sidebar?company=${company}&person=${omar}`)).json();
 expect(Array.isArray(answer.chats)).toBe(true);
 expect(typeof answer.approvals).toBe('number');
 await expect(page.locator('.sidebar .sb-count[href$="/approvals"]')).toHaveText(String(answer.approvals));
});
