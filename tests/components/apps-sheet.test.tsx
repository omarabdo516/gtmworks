import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps, MouseEvent } from 'react';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { AppsSheetProvider, AppsButton } from '@/app/apps-sheet';
import AccountMenuView from '@/app/account-menu-view';
import { Frame } from '@/app/frame';
import type { AppItem } from '@/app/settings-apps-client';
import { LanguageProvider } from '@/lib/i18n-client';
import en from '@/lib/messages/apps.en.json';
import { apps } from '@/lib/app-catalogue.mjs';
import '@/app/tokens.css';
import '@/app/shell.css';

const replace = vi.fn(), refresh = vi.fn(), push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh, push, prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/home' }));
vi.mock('@/lib/link', () => ({
 default: ({ onClick, ...props }: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))} onClick={(event: MouseEvent<HTMLAnchorElement>) => { onClick?.(event); event.preventDefault(); }}/>,
 pageBeingOpened: () => null,
}));
afterEach(async () => {
 if (document.querySelector('[role="menu"]')) await userEvent.keyboard('{Escape}');
 replace.mockReset(); refresh.mockReset(); push.mockReset(); vi.unstubAllGlobals();
});

const text: Record<string, string> = en;
const states: Record<string, AppItem['state']> = { klaviyo: 'connected', notion: 'attention' };
const items: AppItem[] = apps.map(app => ({ key: app.key, name: app.name, mark: app.mark, category: app.category, state: states[app.key] ?? 'off',
 use: text[`use.${app.key}`], can: text[`can.${app.key}`], words: app.name }));

// Each test draws its own Company: the provider keeps each Company's last read across the pages it is drawn on.
let companies = 0;
const shell = (read: Promise<AppItem[] | null>, owner = true, company = `c-${++companies}`) => <div className="gw"><LanguageProvider language="en">
 <AppsSheetProvider apps={read} company={company} owner={owner} rtl={false}>
  <AppsButton/>
  <AccountMenuView saveLanguage={async () => ''} saveTheme={async () => ''} slug="rs-learning" personName="Omar" role="Owner" theme="light" companyName="RS Learning"/>
 </AppsSheetProvider>
</LanguageProvider></div>;
const dialog = () => document.querySelector<HTMLDialogElement>('dialog.apps-sheet')!;
const appsButton = () => document.querySelector<HTMLButtonElement>('#btn-apps')!;
const closedBack = async (opener: HTMLElement) => {
 expect(dialog().classList.contains('is-closing'), 'the leave is drawn first').toBe(true);
 await expect.poll(() => dialog().open).toBe(false);
 await expect.element(opener).toHaveFocus();
};

test('the sidebar button opens the sheet with the keyboard in the search field, and the close button, Escape and a press on the backdrop each close it back to the button', async () => {
 await page.viewport(1280, 900);
 const screen = await render(shell(Promise.resolve(items)));
 await expect.element(appsButton()).toHaveAttribute('aria-haspopup', 'dialog');
 const open = async () => {
  await screen.getByRole('button', { name: /^Connect apps/ }).click();
  await expect.element(screen.getByRole('dialog', { name: 'Connect apps' })).toBeVisible();
  await expect.element(screen.getByRole('searchbox', { name: 'Search apps' })).toHaveFocus();
 };
 await open();
 await screen.getByRole('button', { name: 'Close', exact: true }).click();
 await closedBack(appsButton());
 await open();
 await userEvent.keyboard('{Escape}');
 await closedBack(appsButton());
 await open();
 // The backdrop is the part of the window the sheet does not cover, at the inline start.
 await page.elementLocator(dialog()).click({ position: { x: -20, y: 20 } });
 await closedBack(appsButton());
});

test('the account menu item carries the count, closes the menu and opens the sheet, which closes back to the account button', async () => {
 const screen = await render(shell(Promise.resolve(items)));
 await screen.getByRole('button', { name: 'Account menu' }).click();
 const item = screen.getByRole('menuitem', { name: /^Connect apps/ });
 await expect.element(item).toHaveTextContent('Connect apps2 connected');
 // Pressed in the page itself: with the shell's styles and no sidebar around it, the menu opens above the window's top.
 (item.element() as HTMLButtonElement).click();
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
 await expect.element(screen.getByRole('searchbox', { name: 'Search apps' })).toHaveFocus();
 await userEvent.keyboard('{Escape}');
 await closedBack(document.querySelector<HTMLElement>('#btn-me')!);
});

test('the count on the button and on the menu item is the sheet\'s badge, and an Engine that cannot be read leaves it out', async () => {
 const screen = await render(shell(Promise.resolve(items)));
 await expect.element(appsButton()).toHaveTextContent('Connect apps2 connected');
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await expect.element(screen.getByRole('dialog').getByText('2 connected')).toBeVisible();
});

test('while the apps are being read the sheet draws its head with the search field and no list', async () => {
 const screen = await render(shell(new Promise(() => {})));
 expect(appsButton().textContent).toBe('Connect apps');
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await expect.element(screen.getByRole('searchbox', { name: 'Search apps' })).toHaveFocus();
 expect(dialog().querySelectorAll('.app-card, .apps-count, .tpl-cats')).toHaveLength(0);
});

test('an Engine that cannot be read leaves the count out of the button and the menu item, and the sheet says so as Settings does', async () => {
 const screen = await render(shell(Promise.resolve(null)));
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await expect.element(screen.getByText(text.unreadable)).toBeVisible();
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => dialog().open).toBe(false);
 expect(appsButton().textContent).toBe('Connect apps');
 await screen.getByRole('button', { name: 'Account menu' }).click();
 await expect.element(screen.getByRole('menuitem', { name: /^Connect apps/ })).toBeInTheDocument();
 expect(screen.getByRole('menuitem', { name: /^Connect apps/ }).element().textContent).toBe('Connect apps');
});

test('an app\'s button opens its page inside the sheet with no change of address, and back returns to the list on that button', async () => {
 const screen = await render(shell(Promise.resolve(items)));
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await screen.getByRole('button', { name: 'Manage Klaviyo' }).click();
 await expect.element(screen.getByRole('heading', { name: 'Klaviyo' })).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'Back to all apps' })).toHaveFocus();
 await expect.element(screen.getByRole('dialog').getByRole('button', { name: 'Close', exact: true })).toBeVisible();
 expect([push, replace].map(spy => spy.mock.calls.length)).toEqual([0, 0]);
 await screen.getByRole('button', { name: 'Back to all apps' }).click();
 await expect.element(screen.getByRole('button', { name: 'Manage Klaviyo' })).toHaveFocus();
 await screen.getByRole('button', { name: 'Connect Canva' }).click();
 await screen.getByRole('button', { name: 'Cancel', exact: true }).click();
 await expect.element(screen.getByRole('button', { name: 'Connect Canva' })).toHaveFocus();
 expect([push, replace].map(spy => spy.mock.calls.length)).toEqual([0, 0]);
});

test('Disconnect in the sheet returns to the list and reads the apps again, keeping the keyboard on the app\'s button', async () => {
 vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ status: 'off' }), { status: 200 })));
 const screen = await render(shell(Promise.resolve(items)));
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await screen.getByRole('button', { name: 'Manage Klaviyo' }).click();
 await screen.getByRole('button', { name: 'Disconnect Klaviyo' }).click();
 await screen.getByRole('button', { name: 'Disconnect', exact: true }).click();
 await expect.element(screen.getByRole('button', { name: 'Manage Klaviyo' })).toHaveFocus();
 expect([refresh.mock.calls.length, replace.mock.calls.length]).toEqual([1, 0]);
 // The refresh hands the sheet the apps read again, with Klaviyo now off.
 await screen.rerender(shell(Promise.resolve(items.map(entry => entry.key === 'klaviyo' ? { ...entry, state: 'off' as const } : entry))));
 await expect.element(screen.getByRole('button', { name: 'Connect Klaviyo' })).toHaveFocus();
 await expect.element(appsButton()).toHaveTextContent('Connect apps1 connected');
});

test('while a sign-in is being followed, back stays on the app\'s page', async () => {
 const opened = { opener: {}, location: { href: 'about:blank' }, close: vi.fn() };
 vi.stubGlobal('open', vi.fn(() => opened));
 vi.stubGlobal('fetch', (_: string, init: RequestInit) => Promise.resolve(new Response(JSON.stringify(JSON.parse(String(init.body)).action === 'connect' ? { url: 'https://auth.canva.example/authorize?state=s' } : { status: 'waiting' }), { status: 200 })));
 const screen = await render(shell(Promise.resolve(items)));
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await screen.getByRole('button', { name: 'Connect Canva' }).click();
 await screen.getByRole('button', { name: 'Connect', exact: true }).click();
 await expect.element(screen.getByText('Finish signing in to Canva in its window.')).toBeVisible();
 await screen.getByRole('button', { name: 'Back to all apps' }).click();
 await expect.element(screen.getByRole('heading', { name: 'Connect Canva' })).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'Connect Canva' })).not.toBeInTheDocument();
});

test('a Member who is not the Owner opens the sheet and reads the states with no button', async () => {
 const screen = await render(shell(Promise.resolve(items), false));
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await expect.element(screen.getByText(text.subOther)).toBeVisible();
 await expect.element(screen.getByRole('dialog').getByText('Needs attention')).toBeVisible();
 expect(dialog().querySelectorAll('.app-card button, .app-card a')).toHaveLength(0);
});

// Tab walks the sheet and then leaves the document for the browser's own controls (here the test runner's page), as a
// modal dialog does; it never reaches the drawer or the page behind.
test('on a phone the sheet opened from the drawer holds Tab, and Escape closes the sheet alone', async () => {
 await page.viewport(390, 900);
 const screen = await render(<LanguageProvider language="en"><Frame title="Home" sidebar={shell(Promise.resolve(items))}><a href="#card">A card on the page</a></Frame></LanguageProvider>);
 await screen.getByRole('button', { name: 'Open menu' }).click();
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await expect.element(screen.getByRole('searchbox', { name: 'Search apps' })).toHaveFocus();
 const stayed: string[] = [];
 for (let step = 0; step < 20; step++) { await userEvent.keyboard('{Tab}'); const at = document.activeElement; stayed.push(at === document.body ? 'left the document' : dialog().contains(at) ? 'in the sheet' : `behind it: ${at?.outerHTML.slice(0, 60)}`); }
 expect(stayed.slice(0, 11)).toEqual(Array(11).fill('in the sheet'));
 expect(new Set(stayed)).toEqual(new Set(['in the sheet', 'left the document']));
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => dialog().open).toBe(false);
 await expect.element(appsButton()).toHaveFocus();
 expect(document.querySelector('.sidebar')!.classList.contains('is-open'), 'the drawer stays open').toBe(true);
});

test('the next page keeps the count in place while its own read of the apps is on its way', async () => {
 const first = await render(shell(Promise.resolve(items), true, 'c-kept'));
 await expect.element(first.getByRole('button', { name: 'Connect apps 2 connected' })).toBeVisible();
 await first.unmount();
 const next = await render(shell(new Promise(() => {}), true, 'c-kept'));
 await expect.element(next.getByRole('button', { name: 'Connect apps 2 connected' })).toBeVisible();
});
