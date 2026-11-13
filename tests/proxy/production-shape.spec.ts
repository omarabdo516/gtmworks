import { test, expect, type Page } from '@playwright/test';
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

test('Send invitation shows its confirmation, the address gets the link and the link signs the member in', async ({ page, context }) => {
  watch(page);
  await signIn(page, 'manager@example.com', '/c/rs-learning/settings/members');
  await page.request.delete('http://127.0.0.1:54324/api/v1/messages');
  await page.getByLabel('Email').fill('proxy-invited@example.com');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('status')).toContainText('An invitation link was sent', { timeout: 15000 });
  let link = '';
  for (let i = 0; i < 30 && !link; i++) {
    const mailbox = await (await page.request.get('http://127.0.0.1:54324/api/v1/messages')).json();
    const item = mailbox.messages?.find((m: { To: { Address: string }[] }) => m.To.some(to => to.Address === 'proxy-invited@example.com'));
    if (item) { const message = await (await page.request.get(`http://127.0.0.1:54324/api/v1/message/${item.ID}`)).json(); link = (message.HTML || message.Text).match(/https?:\/\/[^"\s<>]+/g)?.find((url: string) => url.includes('/verify'))?.replaceAll('&amp;', '&') || ''; }
    if (!link) await page.waitForTimeout(1000);
  }
  expect(link).toBeTruthy();
  await context.clearCookies();
  await page.goto(link);
  await expect(page).toHaveURL(/\/c\/rs-learning\/settings\/members/);
  await expect(page.getByRole('heading', { name: 'Team members' })).toBeVisible();
});

test('inviting someone who already has an account sends them a sign-in link', async ({ page }) => {
  watch(page);
  await signIn(page, 'manager@example.com', '/c/rs-learning/settings/members');
  await page.request.delete('http://127.0.0.1:54324/api/v1/messages');
  await page.getByLabel('Email').fill('multi@example.com');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('status')).toContainText('An invitation link was sent', { timeout: 15000 });
  await expect(async () => {
    const mailbox = await (await page.request.get('http://127.0.0.1:54324/api/v1/messages')).json();
    expect(mailbox.messages?.some((m: { To: { Address: string }[] }) => m.To.some(to => to.Address === 'multi@example.com'))).toBe(true);
  }).toPass({ timeout: 30000 });
});

test('a key that cannot be revoked says so instead of staying silently active', async ({ page }) => {
  watch(page);
  await signIn(page, 'omar@example.com', '/c/rs-learning/settings/agents');
  await page.locator('.agent-create-form').getByRole('button', { name: 'Member', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Lead', exact: true }).click();
  await page.getByRole('button', { name: 'Create key' }).click();
  await expect(page.locator('.agent-secret code')).toBeVisible({ timeout: 15000 });
  await page.reload();
  // The request names a company the person has no key in, so the database changes nothing.
  await page.locator('.agent-key-row input[name=company]').first().evaluate(input => { (input as HTMLInputElement).value = '00000000-0000-0000-0000-000000000000'; });
  await page.getByRole('button', { name: 'Revoke key Lead' }).first().click();
  await expect(alerts(page).filter({ hasText: 'Could not save the change' })).toBeVisible({ timeout: 15000 });
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
  await page.getByLabel('Email').fill('never-sent@example.com');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(alerts(page).first()).toBeVisible({ timeout: 10000 });
  expect((await reported).postDataJSON()).toMatchObject({ source: 'server-action', path: '/c/rs-learning/settings/members' });
});

test('a rejection nobody handled is shown on the page', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(alerts(page)).toHaveCount(0);
  await page.evaluate(() => { void Promise.reject(new Error('forced failure')); });
  await expect(alerts(page)).toContainText('Something went wrong');
});
