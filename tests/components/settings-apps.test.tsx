import { afterEach, expect, test, vi, type Mock } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { AppsList, AppDetail, type AppItem, type AppsPlace } from '@/app/settings-apps-client';
import en from '@/lib/messages/apps.en.json';
import ar from '@/lib/messages/apps.ar.json';
import { apps } from '@/lib/app-catalogue.mjs';

const replace = vi.fn<(href: string) => void>(), refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh, push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))}/> }));
afterEach(() => { replace.mockReset(); refresh.mockReset(); vi.unstubAllGlobals(); });

const text: Record<string, string> = en;
const states: Record<string, AppItem['state']> = { klaviyo: 'connected', notion: 'attention' };
const items: AppItem[] = apps.map(app => ({ key: app.key, name: app.name, mark: app.mark, category: app.category, state: states[app.key] ?? 'off',
  use: text[`use.${app.key}`], can: text[`can.${app.key}`], words: [app.name, ...[en, ar].flatMap(words => [`use.${app.key}`, `alias.${app.key}`].map(key => (words as Record<string, string>)[key]))].join(' ') }));
const item = (key: string) => items.find(entry => entry.key === key)!;
const settings: AppsPlace = { kind: 'address', slug: 'rs-learning' };
// The answers /api/company-apps gives to the Owner's steps, in order, and every step sent to it; the apps read again
// for the sidebar's count (a GET) are answered apart and counted in `reads`.
let reads = 0;
function answers(...bodies: [number, object][]) {
  const sent: Record<string, string>[] = [];
  reads = 0;
  vi.stubGlobal('fetch', (_: string, init?: RequestInit) => {
    if (!init?.body) { reads++; return Promise.resolve(new Response(JSON.stringify({ apps: items }), { status: 200 })); }
    sent.push(JSON.parse(String(init.body))); const [status, body] = bodies.shift() ?? [200, { status: 'waiting' }]; return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  return sent;
}

test('the list groups connected and attention apps apart from the rest, and searches in either language', async () => {
  const screen = await render(<AppsList place={settings} owner items={items} text={text}/>);
  await expect.element(screen.getByText('2 connected')).toBeVisible();
  const on = screen.getByRole('region', { name: /^Connected/ });
  expect(on.getByRole('heading', { level: 5 }).elements().map(element => element.textContent)).toEqual(['Klaviyo', 'Notion']);
  await expect.element(screen.getByRole('link', { name: 'Manage Klaviyo' })).toHaveAttribute('href', '/c/rs-learning/settings?section=apps&app=klaviyo');
  await expect.element(screen.getByRole('link', { name: 'Reconnect Notion' })).toBeVisible();
  await expect.element(screen.getByRole('link', { name: 'Connect Canva' })).toBeVisible();
  await screen.getByRole('searchbox', { name: 'Search apps' }).fill('نوشن');
  expect(screen.getByRole('heading', { level: 5 }).elements().map(element => element.textContent)).toEqual(['Notion']);
  await screen.getByRole('searchbox', { name: 'Search apps' }).fill('zzz');
  await expect.element(screen.getByText('No app matches “zzz”')).toBeVisible();
  await screen.getByRole('button', { name: 'Clear search' }).click();
  await screen.getByRole('button', { name: /^Analytics/ }).click();
  expect(screen.getByRole('heading', { level: 5 }).elements().map(element => element.textContent)).toEqual(['Amplitude', 'Mixpanel']);
});

test('a Member who is not the Owner reads the states with no button', async () => {
  const screen = await render(<AppsList place={settings} owner={false} items={items} text={text}/>);
  await expect.element(screen.getByText(text.subOther)).toBeVisible();
  expect(screen.getByRole('link').elements()).toHaveLength(0);
});

test('Connect opens the vendor\'s window at the click, points it at the sign-in page and follows it until connected', async () => {
  const opened = { opener: {} as unknown, location: { href: 'about:blank' }, close: vi.fn() };
  const open = vi.fn(() => opened);
  vi.stubGlobal('open', open);
  const sent = answers([200, { url: 'https://auth.canva.example/authorize?state=s' }], [200, { status: 'waiting' }], [200, { status: 'connected' }]);
  const screen = await render(<AppDetail place={settings} company="c-1" owner rtl={false} item={item('canva')} text={text} soon="Soon" failed={false}/>);
  await expect.element(screen.getByRole('heading', { name: 'Connect Canva' })).toBeVisible();
  await screen.getByRole('button', { name: 'Connect', exact: true }).click();
  expect(open).toHaveBeenCalledWith('about:blank', '_blank');
  await expect.poll(() => opened.location.href).toBe('https://auth.canva.example/authorize?state=s');
  expect(opened.opener).toBeNull();
  await expect.element(screen.getByRole('status')).toHaveTextContent('Finish signing in to Canva in its window.');
  await expect.poll(() => refresh.mock.calls.length, { timeout: 8000 }).toBe(1);
  expect(reads, 'the sidebar\'s count is read again too').toBe(1);
  expect(sent.map(body => body.action)).toEqual(['connect', 'poll', 'poll']);
  expect(sent.every(body => body.company === 'c-1' && body.app === 'canva')).toBe(true);
});

test('a refused connect closes the window it opened and says why, in the reader\'s words', async () => {
  const opened = { opener: {}, location: { href: 'about:blank' }, close: vi.fn() };
  vi.stubGlobal('open', vi.fn(() => opened));
  answers([409, { error: 'appsBusy' }]);
  const screen = await render(<AppDetail place={settings} company="c-1" owner rtl={false} item={item('canva')} text={text} soon="Soon" failed={false}/>);
  await screen.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.element(screen.getByRole('alert')).toHaveTextContent(text['error.appsBusy']);
  expect((opened.close as Mock).mock.calls.length).toBe(1);
});

test('Disconnect asks first, then turns the app off and returns to the list', async () => {
  const sent = answers([200, { status: 'off' }]);
  const screen = await render(<AppDetail place={settings} company="c-1" owner rtl={false} item={item('klaviyo')} text={text} soon="Soon" failed={false}/>);
  await expect.element(screen.getByText('For now, every agent in the company can use it.')).toBeVisible();
  await screen.getByRole('button', { name: 'Disconnect Klaviyo' }).click();
  await expect.element(screen.getByText('Disconnect Klaviyo? Your agents won’t be able to reach it until you connect it again.')).toBeVisible();
  expect(sent).toEqual([]);
  await screen.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect.poll(() => replace.mock.calls.map(([href]) => href)).toEqual(['/c/rs-learning/settings?section=apps']);
  expect(sent).toEqual([{ company: 'c-1', app: 'klaviyo', action: 'disconnect' }]);
  expect([refresh.mock.calls.length, reads]).toEqual([1, 1]);
});

test('an Engine that cannot be read shows only that it cannot, and one that offers no app says only that', async () => {
  const unreadable = await render(<AppsList place={settings} owner items={null} text={text}/>);
  await expect.element(unreadable.getByText(text.unreadable)).toBeVisible();
  expect(document.querySelectorAll('.tpl-empty, .app-card')).toHaveLength(0);
  await unreadable.unmount();
  const none = await render(<AppsList place={settings} owner items={[]} text={text}/>);
  await expect.element(none.getByText(text.noneOffered)).toBeVisible();
  expect(document.querySelectorAll('.tpl-empty, .app-card')).toHaveLength(0);
  expect(document.body.textContent).not.toContain(text.unreadable);
});

test('while a sign-in is followed, back is marked unavailable and has no address to leave by', async () => {
  vi.stubGlobal('open', vi.fn(() => ({ opener: {}, location: { href: 'about:blank' }, close: vi.fn() })));
  answers([200, { url: 'https://auth.notion.example/authorize?state=s' }]);
  const attention = await render(<AppDetail place={settings} company="c-1" owner rtl={false} item={item('notion')} text={text} soon="Soon" failed={false}/>);
  const back = attention.getByRole('link', { name: 'Back to all apps' });
  await expect.element(back).toHaveAttribute('href', '/c/rs-learning/settings?section=apps');
  await expect.element(back).not.toHaveAttribute('aria-disabled');
  await attention.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect.element(attention.getByRole('status')).toHaveTextContent('Finish signing in to Notion in its window.');
  const held = attention.getByRole('link', { name: 'Back to all apps' });
  await expect.element(held).toHaveAttribute('aria-disabled', 'true');
  await expect.element(held).not.toHaveAttribute('href');
  await held.click({ modifiers: ['ControlOrMeta'], force: true });
  await held.click({ button: 'middle', force: true });
  await expect.element(attention.getByRole('heading', { name: 'Notion' })).toBeVisible();
  expect(replace.mock.calls).toEqual([]);
});

test('a blocked sign-in window starts no sign-in, stays on the page and says how to allow it', async () => {
  vi.stubGlobal('open', vi.fn(() => null));
  const sent = answers();
  const screen = await render(<AppDetail place={settings} company="c-1" owner rtl={false} item={item('canva')} text={text} soon="Soon" failed={false}/>);
  await screen.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.element(screen.getByRole('alert')).toHaveTextContent('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.');
  expect(sent, 'no sign-in was started').toEqual([]);
  await expect.element(screen.getByRole('button', { name: 'Connect', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
});
