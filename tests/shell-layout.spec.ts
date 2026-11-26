import { test, expect } from './fresh-seed';
import { signIn } from './sign-in';

// The Shell is drawn once by the Company's layout (#789): moving between a Company's pages asks the server for the page
// alone. A page answer that drew the Shell again would carry the sidebar (its Agents heading, `lbl-agents`), so every
// answer the browser receives on the way is read for it; the sidebar stays the same element across the moves, and the
// entry of the open page is marked current after each one.
test('two moves between a Company\'s pages read no sidebar again and keep the same sidebar', async ({ page }) => {
 await page.setViewportSize({ width: 1440, height: 900 });
 await signIn(page, 'omar@example.com', '/c/rs-learning/home');
 await expect(page.locator('#lbl-agents')).toBeVisible();
 await page.evaluate(() => { (window as typeof window & { firstSidebar?: Element | null }).firstSidebar = document.getElementById('sidebar'); });
 const answers: Promise<{ url: string, sidebar: boolean }>[] = [];
 page.on('response', response => {
  if (!response.request().headers()['rsc'] || !new URL(response.url()).pathname.startsWith('/c/')) return;
  answers.push(response.text().then(body => ({ url: response.url(), sidebar: body.includes('lbl-agents') }), () => ({ url: response.url(), sidebar: false })));
 });
 const sidebar = page.locator('#sidebar');
 await sidebar.getByRole('link', { name: 'Numbers', exact: true }).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/numbers$/);
 await expect(page.locator('.numbers-page')).toBeVisible();
 await expect(sidebar.getByRole('link', { name: 'Numbers', exact: true })).toHaveAttribute('aria-current', 'page');
 await sidebar.getByRole('link', { name: 'Activity log', exact: true }).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/log$/);
 await expect(page.locator('.log-page')).toBeVisible();
 await expect(sidebar.getByRole('link', { name: 'Activity log', exact: true })).toHaveAttribute('aria-current', 'page');
 await expect(sidebar.getByRole('link', { name: 'Numbers', exact: true })).not.toHaveAttribute('aria-current', 'page');
 await expect(page.locator('.topbar h1')).toHaveText('Activity log');
 const read = await Promise.all(answers);
 expect(read.filter(answer => /\/(numbers|log)(\?|$)/.test(new URL(answer.url).pathname + new URL(answer.url).search)).length, 'each move asked the server for its page').toBeGreaterThanOrEqual(2);
 expect(read.filter(answer => answer.sidebar).map(answer => answer.url), 'no page answer draws the sidebar again').toEqual([]);
 expect(await page.evaluate(() => (window as typeof window & { firstSidebar?: Element | null }).firstSidebar === document.getElementById('sidebar')), 'the sidebar is the one drawn with the first page').toBe(true);
});
