import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { Frame } from '@/app/frame';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/tokens.css';
import '@/app/shell.css';

const route = vi.hoisted(() => ({ pathname: '/c/rs-learning/home' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

// Links stay on the test page: a new page is the pathname changing, as the app's router changes it.
const stay = (event: { preventDefault: () => void }) => event.preventDefault();
const frame = () => <LanguageProvider language="en"><Frame title="Home" sidebar={<nav aria-label="Navigation">
 <a href="#chats" onClick={stay}>Chats</a><a href="#board" onClick={stay}>Marketing board</a><button type="button">Account menu</button>
</nav>}><a href="#card" onClick={stay}>A card on the page</a></Frame></LanguageProvider>;
const show = async (width: number) => { route.pathname = '/c/rs-learning/home'; await page.viewport(width, 900); return render(frame()); };

const sidebar = () => document.querySelector<HTMLElement>('.sidebar')!;
const scrim = () => document.querySelector<HTMLElement>('.scrim')!;
const content = () => document.querySelector<HTMLElement>('.app-content')!;
const inside = () => !!document.activeElement?.closest('.sidebar');
const targets = 3;
async function tabs(key: string) {
 const stayed: boolean[] = [];
 for (let step = 0; step < targets + 2; step++) { await userEvent.keyboard(key); stayed.push(inside()); }
 return stayed;
}

test('on a narrow screen the sidebar waits behind the menu button, slides in over a scrim and holds the keyboard until it closes', async () => {
 const screen = await show(390);
 const menu = screen.getByRole('button', { name: 'Open menu' });
 await expect.element(sidebar()).not.toBeVisible();
 await expect.element(scrim()).not.toBeVisible();
 await menu.click();
 await expect.element(menu).toHaveAttribute('aria-expanded', 'true');
 await expect.element(screen.getByRole('dialog', { name: 'Main menu' })).toBeVisible();
 await expect.element(scrim()).toBeVisible();
 expect(inside()).toBe(true);
 expect(content().inert).toBe(true);
 expect(await tabs('{Tab}')).toEqual(Array(targets + 2).fill(true));
 expect(await tabs('{Shift>}{Tab}{/Shift}')).toEqual(Array(targets + 2).fill(true));
 await userEvent.keyboard('{Escape}');
 await expect.element(sidebar()).not.toBeVisible();
 await expect.element(menu).toHaveFocus();
 expect(content().inert).toBe(false);
 await menu.click();
 await page.elementLocator(scrim()).click({ position: { x: 380, y: 450 } });
 await expect.element(sidebar()).not.toBeVisible();
 await expect.element(menu).toHaveFocus();
 await menu.click();
 await screen.getByRole('link', { name: 'Marketing board' }).click();
 route.pathname = '/c/rs-learning/work/board';
 await screen.rerender(frame());
 await expect.element(sidebar()).not.toBeVisible();
 expect(document.documentElement.scrollWidth).toBe(390);
});

test('the sidebar holds the keyboard only while it covers the page', async () => {
 const screen = await show(390);
 const menu = screen.getByRole('button', { name: 'Open menu' });
 const tabLeaves = async () => {
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
  await expect.element(scrim()).not.toBeVisible();
  expect(content().inert).toBe(false);
  sidebar().querySelector('a')!.focus();
  return (await tabs('{Tab}')).includes(false);
 };
 await menu.click();
 await expect.element(screen.getByRole('dialog', { name: 'Main menu' })).toBeVisible();
 await page.viewport(1440, 900);
 expect(await tabLeaves(), 'widened: Tab leaves the sidebar').toBe(true);
 await page.viewport(390, 900);
 await expect.element(screen.getByRole('dialog', { name: 'Main menu' })).toBeVisible();
 sidebar().querySelector('a')!.focus();
 expect(await tabs('{Tab}'), 'narrowed again: Tab stays in the drawer').toEqual(Array(targets + 2).fill(true));
 await userEvent.keyboard('{Escape}');
 await expect.element(sidebar()).not.toBeVisible();
 await page.viewport(1440, 900);
 await menu.click();
 await expect.element(menu).toHaveAttribute('aria-expanded', 'true');
 expect(await tabLeaves(), 'wide: Tab leaves the sidebar').toBe(true);
 await userEvent.keyboard('{Escape}');
 await expect.element(menu).toHaveAttribute('aria-expanded', 'false');
});
