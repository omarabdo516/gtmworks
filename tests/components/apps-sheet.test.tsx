import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps, MouseEvent } from 'react';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { AppsSheetProvider, AppsButton } from '@/app/apps-sheet';
import AccountMenuView from '@/app/account-menu-view';
import { Frame } from '@/app/frame';
import type { AppItem } from '@/app/settings-apps-client';
import { ToastHost } from '@/app/toast';
import { LanguageProvider } from '@/lib/i18n-client';
import { useAppsSheet } from '@/app/apps-sheet-open';
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
const items: AppItem[] = apps.map(app => ({ key: app.key, name: app.name, mark: app.mark, category: app.category, source: app.source, ...(app.url ? { url: app.url } : {}), ...(app.auth ? { auth: app.auth } : {}), ...(app.care ? { care: app.care } : {}), state: states[app.key] ?? 'off',
 agents: [{ id: '3a000000-0000-0000-0000-000000000011', name: 'Lead', connection: 'f0000000-0000-0000-0000-000000000011', main: true, own: true, state: states[app.key] ?? 'off' }],
 use: text[`use.${app.key}`], can: text[`can.${app.key}`], words: app.name }));

// The browser reads the apps from GET /api/company-apps: `read` is what the next read gets ('hang' never answers, 'fail'
// is a 500); the Owner's steps (POST) are answered by `step` and kept in `steps`.
type Read = AppItem[] | null | 'hang' | 'fail';
function engine(first: Read, step: (body: Record<string, string>) => object = () => ({ status: 'waiting' })) {
 const seen = { read: first, reads: 0, steps: [] as (Record<string, string> & { keepalive?: boolean })[] };
 vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
  if (!init?.body) {
   expect(url).toMatch(/^\/api\/company-apps\?company=/);
   seen.reads++;
   if (seen.read === 'hang') return new Promise(() => {});
   return Promise.resolve(seen.read === 'fail' ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ apps: seen.read }), { status: 200 }));
  }
  const body = JSON.parse(String(init.body)); seen.steps.push({ ...body, ...(init.keepalive ? { keepalive: true } : {}) });
  return Promise.resolve(new Response(JSON.stringify(step(body)), { status: 200 }));
 });
 return seen;
}
// Each test draws its own Company: the browser keeps each Company's last read across the pages it is drawn on.
let companies = 0;
const shell = (owner = true, company = `c-${++companies}`, language: 'en' | 'ar' = 'en') => <div className="gw"><LanguageProvider language={language}>
 <AppsSheetProvider company={company} owner={owner} rtl={language === 'ar'}>
  <AppsButton/>
  <AccountMenuView saveLanguage={async () => ''} saveTheme={async () => ''} slug="rs-learning" personName="Omar" role="Owner" theme="light" companyName="RS Learning"/>
 </AppsSheetProvider>
 <ToastHost/>
</LanguageProvider></div>;
const dialog = () => document.querySelector<HTMLDialogElement>('dialog.apps-sheet')!;
const appsButton = () => document.querySelector<HTMLButtonElement>('#btn-apps')!;
const closedBack = async (opener: HTMLElement) => {
 expect(dialog().classList.contains('is-closing'), 'the leave is drawn first').toBe(true);
 await expect.poll(() => document.querySelector('dialog.apps-sheet')).toBeNull();
 await expect.element(opener).toHaveFocus();
};

test('the sidebar button opens the sheet with the keyboard in the search field, and the close button, Escape and a press on the backdrop each close it back to the button', async () => {
 await page.viewport(1280, 900);
 engine(items);
 const screen = await render(shell());
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
 engine(items);
 const screen = await render(shell());
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

test('the count on the button and on the menu item is the sheet\'s badge, read once after the page is drawn and again when the sheet opens', async () => {
 const seen = engine(items);
 const screen = await render(shell());
 await expect.element(appsButton()).toHaveTextContent('Connect apps2 connected');
 expect(seen.reads).toBe(1);
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await expect.element(screen.getByRole('dialog').getByText('2 connected')).toBeVisible();
 expect(seen.reads).toBe(2);
});

test('while the apps are being read the sheet draws its head with the search field and no list', async () => {
 engine('hang');
 const screen = await render(shell());
 expect(appsButton().textContent).toBe('Connect apps');
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await expect.element(screen.getByRole('searchbox', { name: 'Search apps' })).toHaveFocus();
 expect(dialog().querySelectorAll('.app-card, .apps-count, .tpl-cats')).toHaveLength(0);
});

test('an Engine that cannot be read leaves the count out of the button and the menu item, and the sheet says only so, as Settings does', async () => {
 engine(null);
 const screen = await render(shell());
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await expect.element(screen.getByText(text.unreadable)).toBeVisible();
 expect(dialog().querySelectorAll('.tpl-empty')).toHaveLength(0);
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => document.querySelector('dialog.apps-sheet')).toBeNull();
 expect(appsButton().textContent).toBe('Connect apps');
 await screen.getByRole('button', { name: 'Account menu' }).click();
 await expect.element(screen.getByRole('menuitem', { name: /^Connect apps/ })).toBeInTheDocument();
 expect(screen.getByRole('menuitem', { name: /^Connect apps/ }).element().textContent).toBe('Connect apps');
});

test('an app\'s button opens its page inside the sheet with no change of address, and back returns to the list on that button', async () => {
 engine(items);
 const screen = await render(shell());
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
 const seen = engine(items, () => ({ status: 'off' }));
 const screen = await render(shell());
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await screen.getByRole('button', { name: 'Manage Klaviyo' }).click();
 await screen.getByRole('button', { name: 'Disconnect Klaviyo' }).click();
 const reads = seen.reads;
 seen.read = items.map(entry => entry.key === 'klaviyo' ? { ...entry, state: 'off' as const } : entry);
 await screen.getByRole('button', { name: 'Disconnect', exact: true }).click();
 await expect.element(screen.getByRole('button', { name: 'Connect Klaviyo' })).toHaveFocus();
 await expect.element(appsButton()).toHaveTextContent('Connect apps1 connected');
 expect(seen.reads, 'the apps were read again').toBe(reads + 1);
 expect([refresh.mock.calls.length, replace.mock.calls.length], 'the page behind is not drawn again').toEqual([0, 0]);
});

const signingIn = (body: Record<string, string>) => body.action === 'connect' ? { url: 'https://auth.canva.example/authorize?state=s' } : { status: 'waiting' };
test('while a sign-in is being followed, back is marked unavailable and stays on the app\'s page', async () => {
 vi.stubGlobal('open', vi.fn(() => ({ opener: {}, location: { href: 'about:blank' }, close: vi.fn() })));
 engine(items, signingIn);
 const screen = await render(shell());
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await screen.getByRole('button', { name: 'Connect Canva' }).click();
 await expect.element(screen.getByRole('button', { name: 'Back to all apps' })).not.toHaveAttribute('aria-disabled');
 await screen.getByRole('button', { name: 'Connect', exact: true }).click();
 await expect.element(screen.getByText('Finish signing in to Canva in its window.')).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'Back to all apps' })).toHaveAttribute('aria-disabled', 'true');
 await screen.getByRole('button', { name: 'Back to all apps' }).click({ force: true });
 await expect.element(screen.getByRole('heading', { name: 'Connect Canva' })).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'Connect Canva' })).not.toBeInTheDocument();
});

test('closing the sheet while a sign-in is followed cancels it, closes the vendor\'s window and says so', async () => {
 const opened = { opener: {}, location: { href: 'about:blank' }, close: vi.fn() };
 vi.stubGlobal('open', vi.fn(() => opened));
 const seen = engine(items, signingIn);
 const screen = await render(shell());
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await screen.getByRole('button', { name: 'Connect Canva' }).click();
 await screen.getByRole('button', { name: 'Connect', exact: true }).click();
 await expect.element(screen.getByText('Finish signing in to Canva in its window.')).toBeVisible();
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => document.querySelector('dialog.apps-sheet')).toBeNull();
 await expect.element(screen.getByText('The sign-in to Canva was cancelled.')).toBeVisible();
 expect(seen.steps.at(-1)).toEqual({ company: expect.any(String), agent: '3a000000-0000-0000-0000-000000000011', app: 'canva', action: 'cancel', keepalive: true });
 expect(opened.close).toHaveBeenCalledTimes(1);
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await expect.element(screen.getByRole('button', { name: 'Connect Canva' })).toBeVisible();
});

test('a read that fails after a good one changes nothing: the count stays and the app\'s page stays open', async () => {
 vi.stubGlobal('open', vi.fn(() => ({ opener: {}, location: { href: 'about:blank' }, close: vi.fn() })));
 const seen = engine(items, body => body.action === 'connect' ? { url: 'https://auth.notion.example/authorize?state=s' } : { status: 'connected' });
 const screen = await render(shell());
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await screen.getByRole('button', { name: 'Reconnect Notion' }).click();
 seen.read = 'fail';
 const reads = seen.reads;
 await screen.getByRole('button', { name: 'Reconnect', exact: true }).click();
 await expect.poll(() => seen.reads, { timeout: 8000 }).toBe(reads + 1);
 await expect.element(screen.getByRole('heading', { name: 'Notion' })).toBeVisible();
 await expect.element(appsButton()).toHaveTextContent('Connect apps2 connected');
});

test('the apps are kept per reader\'s language: another language reads them again rather than show the first one\'s words', async () => {
 const seen = engine(items);
 const screen = await render(shell(true, 'c-language'));
 await expect.element(appsButton()).toHaveTextContent('Connect apps2 connected');
 seen.read = 'hang';
 await screen.rerender(shell(true, 'c-language', 'ar'));
 await expect.poll(() => seen.reads).toBe(2);
 expect(appsButton().querySelector('.sb-apps__n'), 'no count until the Arabic read lands').toBeNull();
});

test('a Member who is not the Owner opens the sheet and reads the states with no button', async () => {
 engine(items);
 const screen = await render(shell(false));
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await expect.element(screen.getByText(text.subOther)).toBeVisible();
 await expect.element(screen.getByRole('dialog').getByText('Needs attention')).toBeVisible();
 expect(dialog().querySelectorAll('.app-card button, .app-card a')).toHaveLength(0);
});

// Tab walks the sheet and then leaves the document for the browser's own controls (here the test runner's page), as a
// modal dialog does; it never reaches the drawer or the page behind.
test('on a phone the sheet opened from the drawer holds Tab, and Escape closes the sheet alone', async () => {
 await page.viewport(390, 900);
 engine(items);
 const screen = await render(<LanguageProvider language="en"><Frame title="Home" sidebar={shell()}><a href="#card">A card on the page</a></Frame></LanguageProvider>);
 await screen.getByRole('button', { name: 'Open menu' }).click();
 await screen.getByRole('button', { name: /^Connect apps/ }).click();
 await expect.element(screen.getByRole('searchbox', { name: 'Search apps' })).toHaveFocus();
 const stayed: string[] = [];
 for (let step = 0; step < 120; step++) { await userEvent.keyboard('{Tab}'); const at = document.activeElement; stayed.push(at === document.body ? 'left the document' : dialog().contains(at) ? 'in the sheet' : `behind it: ${at?.outerHTML.slice(0, 60)}`); }
 expect(stayed.slice(0, 11)).toEqual(Array(11).fill('in the sheet'));
 expect(new Set(stayed)).toEqual(new Set(['in the sheet', 'left the document']));
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => document.querySelector('dialog.apps-sheet')).toBeNull();
 await expect.element(appsButton()).toHaveFocus();
 expect(document.querySelector('.sidebar')!.classList.contains('is-open'), 'the drawer stays open').toBe(true);
});

test('the next page shows the count read a moment ago, with no read of its own', async () => {
 const seen = engine(items);
 const first = await render(shell(true, 'c-kept'));
 await expect.element(first.getByRole('button', { name: 'Connect apps 2 connected' })).toBeVisible();
 await first.unmount();
 seen.read = 'hang';
 const next = await render(shell(true, 'c-kept'));
 await expect.element(next.getByRole('button', { name: 'Connect apps 2 connected' })).toBeVisible();
 expect(seen.reads, 'a read under a minute old is kept').toBe(1);
});

// #458: a card that needs a token or a declared field opens the sheet at that app's page.
function Opener() {
  const open = useAppsSheet();
  return <button type="button" onClick={() => open?.(null, 'klaviyo')}>Open Klaviyo</button>;
}
test('the sheet can open at one app\'s page from outside it', async () => {
  engine(items);
  const screen = await render(<div className="gw"><LanguageProvider language="en">
    <AppsSheetProvider company="c-direct" owner rtl={false}><Opener/></AppsSheetProvider>
  </LanguageProvider></div>);
  await screen.getByRole('button', { name: 'Open Klaviyo' }).click();
  await expect.element(screen.getByRole('heading', { name: 'Klaviyo' })).toBeVisible();
});

// The Agent that asked (a connect card or Connected tools of a non-main Agent) is the one picked on the app's page.
function OpenerFor({ agent }: { agent: string }) {
  const open = useAppsSheet();
  return <button type="button" onClick={() => open?.(null, 'airtable', agent)}>Open Airtable</button>;
}
test('the sheet opened for an Agent picks that Agent on the app\'s page, not the main one', async () => {
  const writer = '3a000000-0000-0000-0000-000000000012';
  engine(items.map(item => item.key !== 'airtable' ? item : { ...item, agents: [...item.agents, { id: writer, name: 'Writer', connection: 'f0000000-0000-0000-0000-000000000012', main: false, own: true, state: 'off' as const }] }));
  const screen = await render(<div className="gw"><LanguageProvider language="en">
    <AppsSheetProvider company="c-for-agent" owner rtl={false}><OpenerFor agent={writer}/></AppsSheetProvider>
  </LanguageProvider></div>);
  await screen.getByRole('button', { name: 'Open Airtable' }).click();
  await expect.element(screen.getByRole('checkbox', { name: /Writer/ })).toHaveAttribute('aria-checked', 'true');
  await expect.element(screen.getByRole('checkbox', { name: /Lead/ })).toHaveAttribute('aria-checked', 'false');
});
