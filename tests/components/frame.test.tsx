import { expect, onTestFinished, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { Frame } from '@/app/frame';
import { continuePage } from '@/lib/page-fade';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/tokens.css';
import '@/app/shell.css';

const route = vi.hoisted(() => ({ pathname: '/c/rs-learning/home' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

// Links stay on the test page: a new page is the pathname changing, as the app's router changes it. Each route draws
// a frame of its own (`route`, its key).
const stay = (event: { preventDefault: () => void }) => event.preventDefault();
const frame = (route = '') => <LanguageProvider language="en"><Frame key={route} title="Home" sidebar={<nav aria-label="Navigation">
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

// Each animation that starts in the page, as the test names it.
const watchStarts = (name: (event: AnimationEvent) => string) => {
 const starts: string[] = [];
 const listen = (event: AnimationEvent) => { starts.push(name(event)); };
 document.addEventListener('animationstart', listen);
 onTestFinished(() => document.removeEventListener('animationstart', listen));
 return starts;
};

// Every page fades in once when it opens, as the reference's view does (#135, design-reference setView): a new pathname
// replays the page region's fadeIn, a redraw of the same page (a poll, a save, the details panel) does not, and the
// sidebar and the menu button never fade.
test('a new page fades the page region in once; a redraw of the same page and the sidebar do not fade', async () => {
 const screen = await show(1440);
 const starts = watchStarts(event => `${(event.target as Element).className.split(' ')[0]} ${event.animationName}`);
 const style = getComputedStyle(content());
 expect([style.animationName, style.animationDuration, style.animationTimingFunction]).toEqual(['gw-fade-in', '0.2s', 'cubic-bezier(0.2, 0, 0, 1)']);
 const settle = async () => { await Promise.all(document.getAnimations().map(animation => animation.finished)); };
 await settle();
 starts.length = 0;
 for (const path of ['/c/rs-learning/work/board', '/c/rs-learning/numbers', '/c/rs-learning/log', '/c/rs-learning/conversations/7']) {
  route.pathname = path;
  await screen.rerender(frame());
  await expect.poll(() => starts.length, { message: path }).toBe(1);
  expect(starts.pop()).toBe('app-content gw-fade-in');
  await settle();
  for (let redraw = 0; redraw < 3; redraw++) await screen.rerender(frame());
  await new Promise(resolve => setTimeout(resolve, 250));
  expect(starts, `${path}: a redraw does not fade`).toEqual([]);
 }
 for (const part of [sidebar(), document.querySelector('.mobile-menu')!]) expect(getComputedStyle(part).animationName).toBe('none');
 expect(getComputedStyle(sidebar()).opacity).toBe('1');
});

// A new chat whose first message starts its Conversation goes on as the same page (lib/page-fade), as the reference's
// send() draws the thread without setView; the next page fades again.
test('a new chat going on as its Conversation does not fade again, in its frame or a new one; the next page does', async () => {
 const screen = await show(1440);
 const starts = watchStarts(event => event.animationName);
 await Promise.all(document.getAnimations().map(animation => animation.finished));
 starts.length = 0;
 continuePage('/c/rs-learning/conversations/8');
 route.pathname = '/c/rs-learning/conversations/8';
 await screen.rerender(frame());
 await new Promise(resolve => setTimeout(resolve, 250));
 expect(starts).toEqual([]);
 route.pathname = '/c/rs-learning/work/board';
 await screen.rerender(frame());
 await expect.poll(() => starts).toEqual(['gw-fade-in']);
 // Another route draws a frame of its own: it fades as it mounts, unless it is the new chat going on.
 await Promise.all(document.getAnimations().map(animation => animation.finished));
 continuePage('/c/rs-learning/conversations/9');
 route.pathname = '/c/rs-learning/conversations/9';
 await screen.rerender(frame('conversation'));
 await new Promise(resolve => setTimeout(resolve, 250));
 expect(starts).toEqual(['gw-fade-in']);
 expect(content().classList.contains('view-enter')).toBe(false);
 route.pathname = '/c/rs-learning/conversations/10';
 await screen.rerender(frame('conversation'));
 await expect.poll(() => starts).toEqual(['gw-fade-in', 'gw-fade-in']);
 await Promise.all(document.getAnimations().map(animation => animation.finished));
 route.pathname = '/c/rs-learning/log';
 await screen.rerender(frame('log'));
 await expect.poll(() => starts).toEqual(['gw-fade-in', 'gw-fade-in', 'gw-fade-in']);
});
