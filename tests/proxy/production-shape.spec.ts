import { test, expect, type Page } from '../offline-browser';

import { signIn } from '../sign-in';

// Everything here runs against the production image behind a reverse proxy on https://app.gtmworks.test.
// What the browser sees is printed ("[evidence] ...") so a failure shows the failing request or error, not a guess.
function watch(page: Page) {
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) console.log(`[evidence] console ${message.type()}: ${message.text()}`); });
  page.on('pageerror', error => console.log(`[evidence] page error: ${error.message}`));
  page.on('requestfailed', request => console.log(`[evidence] request failed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', response => {
    const request = response.request();
    if (request.method() === 'POST' || response.status() >= 400) console.log(`[evidence] ${request.method()} ${response.url()} -> ${response.status()}`);
  });
}

// Next.js keeps an empty role=alert region of its own for screen readers.
const alerts = (page: Page) => page.locator('[role=alert]:not(#__next-route-announcer__)');

test('the page is served over https from the public host name through the proxy', async ({ page }) => {
  watch(page);
  const response = await page.goto('/sign-in');
  expect(response?.headers()['via']).toContain('Caddy');
  expect(new URL(page.url()).protocol).toBe('https:');
  expect(new URL(page.url()).hostname).toBe('app.gtmworks.test');
});

test('Make an invite link shows it on the public origin, and the new Person joins through it', async ({ page, context }) => {
  watch(page);
  // Only the Owner makes a link (#950), from the Members settings overlay.
  await signIn(page, 'omar@example.com', '/c/rs-learning/settings?section=members');
  await page.getByRole('button', { name: 'Make an invite link' }).click();
  await page.getByLabel('Person’s name').fill('Proxy Invited');
  await page.getByRole('button', { name: 'Make the link' }).click();
  const link = await page.getByLabel('Invite link for Proxy Invited').inputValue();
  expect(link.startsWith('https://app.gtmworks.test/join#code=')).toBe(true);
  await context.clearCookies();
  await page.goto(link);
  // A new Person chooses a password on the link's page before the Company opens (#41, #950).
  await page.getByLabel('Your name').fill('Proxy Invited');
  await page.getByLabel('Email').fill('proxy-invited@example.com');
  await page.getByLabel('Password', { exact: true }).fill('proxy-invited-password');
  await page.getByLabel('Confirm password').fill('proxy-invited-password');
  await page.getByRole('button', { name: 'Join and sign in' }).click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/home$/);
  await expect(page.locator('.home-dashboard')).toBeVisible();
});

test('the old all-companies address is not found through the proxy', async ({ page }) => {
  watch(page);
  // Omar is the Owner of every seeded company; there is no list of companies beyond his own.
  await signIn(page, 'omar@example.com', '/c/rs-learning/settings');
  expect((await page.goto('/all-brands'))?.status()).toBe(404);
});

test('a server action whose request fails shows an error and reports it', async ({ page }) => {
  watch(page);
  await signIn(page, 'manager@example.com', '/c/rs-learning/settings/members');
  await page.route('**/c/rs-learning/settings/members*', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  // The failed request is reported to the server's log with where it happened, so a live failure can be read from `docker logs`.
  const reported = page.waitForRequest(request => request.url().endsWith('/api/client-errors') && request.postDataJSON()?.source === 'server-action');
  // A Manager's change of a Viewer's Grant, the members page's own server action.
  const viewer = page.locator('.member-row').filter({ has: page.locator('strong', { hasText: /^مشاهد$/ }) });
  await viewer.getByLabel('Publishing').check();
  await viewer.getByRole('button', { name: 'Save' }).click();
  await expect(alerts(page).first()).toBeVisible({ timeout: 10000 });
  expect((await reported).postDataJSON()).toMatchObject({ source: 'server-action', path: '/c/rs-learning/settings/members' });
});

test('a rejection nobody handled is shown on the page', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(alerts(page)).toHaveCount(0);
  // The notice listens once React has hydrated the page; a rejection forced before that has no listener yet.
  await page.waitForFunction(() => { const button = document.querySelector('button'); return !!button && Object.getOwnPropertyNames(button).some(name => name.startsWith('__reactProps$')); });
  await page.evaluate(() => { void Promise.reject(new Error('forced failure')); });
  await expect(alerts(page)).toContainText('Something went wrong');
});
