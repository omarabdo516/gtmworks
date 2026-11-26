import { expect, onTestFinished, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { Frame, PageFrame } from '@/app/frame';
import { continuePage } from '@/lib/page-fade';
import { setPageBeingOpened } from '@/lib/page-opening';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/tokens.css';
import '@/app/shell.css';

const route = vi.hoisted(() => ({ pathname: '/c/rs-learning/home' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

// Links stay on the test page: a new page is the pathname changing, as the app's router changes it. The frame stays, as
// the Company's layout keeps it (#789); each route draws a page frame of its own (`segment`, its key).
const stay = (event: { preventDefault: () => void }) => event.preventDefault();
const frame = (segment = '', loading = false) => <LanguageProvider language="en"><Frame sidebar={<nav aria-label="Navigation">
 <a href="#chats" onClick={stay}>Chats</a><a href="#board" onClick={stay}>Marketing board</a><button type="button">Account menu</button>
</nav>}><PageFrame key={loading ? `${segment} loading` : segment} title="Home" loading={loading}>{loading ? <main className="page"/> : <main className="page"><a href="#card" onClick={stay}>A card on the page</a></main>}</PageFrame></Frame></LanguageProvider>;
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
// replays the fadeIn of the page drawn in the page region, whether its route keeps the frame or draws a new one (`segment`); a redraw of the same
// page (a poll, a save, the details panel) and a frame mounting again on the same page do not, and the sidebar and the
// menu button never fade. Each test starts on a page of its own, since the frame remembers the page it last showed.
const settle = async () => { await Promise.all(document.getAnimations().map(animation => animation.finished)); };
test('a new page fades in once; a redraw, a frame drawn again on the same page and the sidebar do not', async () => {
 const screen = await show(1440);
 const starts = watchStarts(event => `${(event.target as Element).className.split(' ')[0]} ${event.animationName}`);
 await settle();
 starts.length = 0;
 for (const [path, segment] of [['/c/rs-learning/work/board', 'board'], ['/c/rs-learning/work/list', 'board'], ['/c/rs-learning/numbers', 'numbers'], ['/c/rs-learning/log', 'log'], ['/c/rs-learning/conversations/7', 'conversation']]) {
  route.pathname = path;
  await screen.rerender(frame(segment));
  await expect.poll(() => starts.length, { message: path }).toBe(1);
  expect(starts.pop()).toBe('page gw-fade-in');
  const style = getComputedStyle(content().querySelector('.page')!);
  expect([style.animationDuration, style.animationTimingFunction]).toEqual(['0.2s', 'cubic-bezier(0.2, 0, 0, 1)']);
  await settle();
  for (let redraw = 0; redraw < 3; redraw++) await screen.rerender(frame(segment));
  await screen.rerender(frame(`${segment} again`));
  await new Promise(resolve => setTimeout(resolve, 250));
  expect(starts, `${path}: a redraw or a frame drawn again does not fade`).toEqual([]);
 }
 for (const part of [sidebar(), document.querySelector('.mobile-menu')!]) expect(getComputedStyle(part).animationName).toBe('none');
 expect(getComputedStyle(sidebar()).opacity).toBe('1');
});

// A press draws the page's loading frame at once (#771): it is busy and does not fade; the page that replaces it fades
// once, as any new page does.
test('a loading frame does not fade, and the page that arrives in its place fades once', async () => {
 const screen = await show(1440);
 const starts = watchStarts(event => event.animationName);
 await settle();
 starts.length = 0;
 route.pathname = '/c/rs-learning/numbers';
 await screen.rerender(frame('numbers', true));
 expect(content().getAttribute('aria-busy')).toBe('true');
 await new Promise(resolve => setTimeout(resolve, 250));
 expect(starts, 'the loading frame').toEqual([]);
 await screen.rerender(frame('numbers'));
 await expect.poll(() => starts).toEqual(['gw-fade-in']);
 expect(content().hasAttribute('aria-busy')).toBe(false);
});

// #771: a press whose page has not landed after 100ms draws that page's loading frame in the page's place, inside the
// same sidebar; the page left stays mounted out of sight, and the page that lands takes the frame's place. A press on
// the page shown, or on Settings (drawn over the page), draws none.
test('a press whose page is on its way draws its loading frame in the page\'s place until the page lands', async () => {
 const screen = await show(1440);
 const pageShown = () => getComputedStyle(document.querySelector('.app-content:not([aria-busy])')!).display !== 'none';
 setPageBeingOpened('/c/rs-learning/log');
 await new Promise(resolve => setTimeout(resolve, 50));
 expect(document.querySelector('.app-content[aria-busy]'), 'not before 100ms').toBeNull();
 const loading = screen.getByRole('status');
 await expect.element(loading).toHaveTextContent('Opening page');
 expect(document.querySelector('.app-content[aria-busy="true"]')).not.toBeNull();
 expect(document.querySelector('.topbar h1')!.textContent).toBe('Activity log');
 expect(pageShown()).toBe(false);
 expect(document.querySelector('a[href="#card"]'), 'the page left stays mounted').not.toBeNull();
 await expect.element(screen.getByRole('navigation', { name: 'Navigation' })).toBeVisible();
 route.pathname = '/c/rs-learning/log';
 await screen.rerender(frame('log'));
 expect(document.querySelector('.app-content[aria-busy]'), 'the page landed').toBeNull();
 expect(pageShown()).toBe(true);
 setPageBeingOpened(null);
 for (const pressed of ['/c/rs-learning/log', '/c/rs-learning/settings']) {
  setPageBeingOpened(pressed);
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(document.querySelector('.app-content[aria-busy]'), pressed).toBeNull();
  setPageBeingOpened(null);
 }
});

// A new chat whose first message starts its Conversation goes on as the same page (lib/page-fade), as the reference's
// send() draws the thread without setView; the next page fades again.
test('a new chat going on as its Conversation does not fade again, in its frame or a new one; the next page does', async () => {
 const screen = await show(1440);
 const starts = watchStarts(event => event.animationName);
 route.pathname = '/c/rs-learning/chat/lead';
 await screen.rerender(frame('chat'));
 await expect.poll(() => starts).toEqual(['gw-fade-in']);
 await settle();
 starts.length = 0;
 continuePage('/c/rs-learning/conversations/8');
 route.pathname = '/c/rs-learning/conversations/8';
 await screen.rerender(frame('chat'));
 await new Promise(resolve => setTimeout(resolve, 250));
 expect(starts, 'in the same frame').toEqual([]);
 route.pathname = '/c/rs-learning/chat/nour';
 await screen.rerender(frame('chat'));
 await expect.poll(() => starts).toEqual(['gw-fade-in']);
 await settle();
 continuePage('/c/rs-learning/conversations/9');
 route.pathname = '/c/rs-learning/conversations/9';
 await screen.rerender(frame('conversation'));
 await new Promise(resolve => setTimeout(resolve, 250));
 expect(starts, 'in a frame of its own').toEqual(['gw-fade-in']);
 expect(content().classList.contains('view-enter')).toBe(false);
 route.pathname = '/c/rs-learning/conversations/10';
 await screen.rerender(frame('conversation'));
 await expect.poll(() => starts).toEqual(['gw-fade-in', 'gw-fade-in']);
});

// On a chat page the chat fades and the details panel beside it does not, as the reference's #details sits outside the
// view that fades (#135); the panel's scrim, over the chat on a narrow screen, does not fade either.
const chatPage = (segment: string) => <LanguageProvider language="en"><Frame chat sidebar={<nav aria-label="Navigation"><a href="#chats" onClick={stay}>Chats</a></nav>}><PageFrame key={segment} title="Chats">
 <main className="convo-page"><div className="convo"><div className="chat">A chat</div><div className="dp-scrim"/><aside id="details" className="details">Lead</aside></div></main>
</PageFrame></Frame></LanguageProvider>;
test('on a chat page the chat fades in and the details panel and its scrim do not', async () => {
 route.pathname = '/c/rs-learning/chat/lead'; await page.viewport(1440, 900);
 const screen = await render(chatPage('chat'));
 const starts = watchStarts(event => `${(event.target as Element).className} ${event.animationName}`);
 await settle();
 starts.length = 0;
 for (const path of ['/c/rs-learning/chat/nour', '/c/rs-learning/chat/mona']) {
  route.pathname = path;
  await screen.rerender(chatPage('chat'));
  await expect.poll(() => starts, { message: path }).toEqual(['chat gw-fade-in']);
  for (const part of [content(), document.querySelector('.details')!, document.querySelector('.dp-scrim')!]) expect(getComputedStyle(part).animationName).toBe('none');
  await settle();
  starts.length = 0;
 }
});
