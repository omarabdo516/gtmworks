import { test, expect, type Page } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';
import { signIn, openNavigation } from './sign-in';

async function chooseTheme(page: Page, choice: string) {
 await openNavigation(page);
 await page.getByRole('button', { name: 'Account menu' }).click();
 await page.getByRole('menuitemradio', { name: choice, exact: true }).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme', choice.toLowerCase());
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
  await chooseTheme(page, 'Light');
  await serverTheme('/c/rs-learning/home', 'light');
  await expect(page.locator('.app-layout')).toHaveCSS('background-color', 'rgb(250, 250, 250)');
  const config = await (await page.request.get('/api/config')).json();
  const cookies = await page.context().cookies();
  const db = createServerClient(config.url, config.anonKey, { cookieOptions: config.cookieOptions, cookies: { getAll: () => cookies, setAll: () => {} } });
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
  await chooseTheme(page, 'Dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('.app-layout')).toHaveCSS('background-color', 'oklch(0.185 0 0)');
  await serverTheme('/c/rs-learning/home', 'dark');
 } finally { await chooseTheme(page, 'Device'); }
 await page.emulateMedia({ colorScheme: 'dark' });
 await expect(page.locator('.app-layout')).toHaveCSS('background-color', 'oklch(0.185 0 0)');
 await serverTheme('/c/rs-learning/home', 'device');
 await page.emulateMedia({ colorScheme: 'light' });
 await expect(page.locator('.app-layout')).toHaveCSS('background-color', 'rgb(250, 250, 250)');
});
