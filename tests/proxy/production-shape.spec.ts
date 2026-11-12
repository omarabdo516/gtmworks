import { test, expect, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
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

function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)?.map(b => parseInt(b, 2)) || []); const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', key).update(counter).digest(); const offset = hash[19] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

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

test('two-step verification: a wrong code shows the error line, the right code shows all companies', async ({ page }) => {
  watch(page);
  await signIn(page, 'omar@example.com', '/c/rs-learning/settings');
  await page.goto('/all-brands');
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  const secret = await page.locator('code').textContent(); expect(secret).toBeTruthy();
  await page.getByLabel('Verification code').fill('000000');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(alerts(page)).toContainText('Incorrect code. Try again.', { timeout: 15000 });
  await page.getByLabel('Verification code').fill(totp(secret!));
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.locator('.company-card')).toHaveCount(3, { timeout: 15000 });
});

test('a button whose request fails shows an error instead of doing nothing', async ({ page }) => {
  watch(page);
  // The previous test left this person with a verified authenticator, so the page offers the code field straight away.
  await signIn(page, 'omar@example.com', '/c/rs-learning/settings');
  await page.goto('/all-brands');
  await page.getByLabel('Verification code').fill('123456');
  await page.route('**/api/config', route => route.abort());
  // The failed step is reported to the server's log with its stage, so a live failure can be read from `docker logs`.
  const reported = page.waitForRequest(request => request.url().endsWith('/api/client-errors') && request.postDataJSON()?.source === 'two-step');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(alerts(page)).toBeVisible({ timeout: 10000 });
  expect((await reported).postDataJSON()).toMatchObject({ source: 'two-step', path: '/all-brands' });
});

test('a server action whose request fails shows an error', async ({ page }) => {
  watch(page);
  await signIn(page, 'manager@example.com', '/c/rs-learning/settings/members');
  await page.route('**/c/rs-learning/settings/members*', route => route.request().method() === 'POST' ? route.abort() : route.continue());
  await page.getByLabel('Email').fill('never-sent@example.com');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(alerts(page).first()).toBeVisible({ timeout: 10000 });
});

test('a rejection nobody handled is shown on the page', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(alerts(page)).toHaveCount(0);
  await page.evaluate(() => { void Promise.reject(new Error('forced failure')); });
  await expect(alerts(page)).toContainText('Something went wrong');
});
