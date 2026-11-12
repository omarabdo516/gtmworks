import { test, expect, type Page } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';
import { execFileSync } from 'node:child_process';
import { signIn, openNavigation, closeNavigation } from './sign-in';

const query = (sql: string) => execFileSync('npx', ['--no-install', 'supabase', 'db', 'query', sql, '-o', 'json', '--agent', 'no'], { encoding: 'utf8' });
// The reference's sun/moon button flips what is shown now and saves that choice to the account.
async function chooseTheme(page: Page, choice: 'light' | 'dark') {
 await openNavigation(page);
 const toggle = page.locator('#btn-theme');
 await expect(toggle).toHaveAccessibleName(choice === 'light' ? 'Light mode' : 'Dark mode');
 await expect(toggle).toHaveAttribute('aria-pressed', String(choice === 'light'));
 await toggle.click();
 await expect(page.locator('html')).toHaveAttribute('data-theme', choice);
 await expect(toggle).toHaveAttribute('aria-pressed', String(choice === 'dark'));
 await closeNavigation(page);
}
// The toggle has no way back to following the device; the account's saved choice is reset directly.
async function followDevice(page: Page) {
 query(`update public.people set theme='device' where id=(select id from auth.users where email='viewer@example.com')`);
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'device');
}

test('device default, server-rendered theme and saved choice across sessions and devices', async ({ page, browser }) => {
 await page.emulateMedia({ colorScheme: 'dark' });
 const serverTheme = async (path: string, theme: string) => {
  const response = await page.request.get(path);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toMatch(new RegExp(`<html[^>]*data-theme="${theme}"`));
 };
 await serverTheme('/sign-in', 'device');
 await page.goto('/sign-in');
 await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
 await signIn(page, 'viewer@example.com', '/c/rs-learning/home');
 try {
  await serverTheme('/c/rs-learning/home', 'device');
  await expect(page.locator('.app-layout')).toHaveCSS('background-color', 'oklch(0.185 0 0)');
  await chooseTheme(page, 'light');
  await serverTheme('/c/rs-learning/home', 'light');
  await expect(page.locator('.app-layout')).toHaveCSS('background-color', 'rgb(250, 250, 250)');
  const config = await (await page.request.get('/api/config')).json();
  const cookies = await page.context().cookies();
  const db = createServerClient(config.url, config.anonKey, { cookies: { getAll: () => cookies, setAll: () => {} } });
  expect((await db.auth.signOut()).error).toBeNull();
  await page.context().clearCookies();
  await serverTheme('/sign-in', 'device');
  await signIn(page, 'viewer@example.com', '/c/rs-learning/home');
  await expect(page.locator('.app-layout')).toHaveCSS('background-color', 'rgb(250, 250, 250)');
  await serverTheme('/c/rs-learning/home', 'light');
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', colorScheme: 'dark' });
  try {
   const second = await other.newPage();
   await signIn(second, 'viewer@example.com', '/c/rs-learning/home');
   await expect(second.locator('html')).toHaveAttribute('data-theme', 'light');
   await expect(second.locator('.app-layout')).toHaveCSS('background-color', 'rgb(250, 250, 250)');
  } finally { await other.close(); }
  await page.emulateMedia({ colorScheme: 'light' });
  await chooseTheme(page, 'dark');
  await expect(page.locator('.app-layout')).toHaveCSS('background-color', 'oklch(0.185 0 0)');
  await serverTheme('/c/rs-learning/home', 'dark');
 } finally { await followDevice(page); }
 await page.emulateMedia({ colorScheme: 'dark' });
 await expect(page.locator('.app-layout')).toHaveCSS('background-color', 'oklch(0.185 0 0)');
 await serverTheme('/c/rs-learning/home', 'device');
 await page.emulateMedia({ colorScheme: 'light' });
 await expect(page.locator('.app-layout')).toHaveCSS('background-color', 'rgb(250, 250, 250)');
});
