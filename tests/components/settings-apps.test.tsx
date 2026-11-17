import { afterEach, expect, test, vi, type Mock } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { AppsList, AppDetail, type AppItem, type AppsPlace } from '@/app/settings-apps-client';
import en from '@/lib/messages/apps.en.json';
import ar from '@/lib/messages/apps.ar.json';
import { apps, mergedState, type AppAgent } from '@/lib/app-catalogue.mjs';

const replace = vi.fn<(href: string) => void>(), refresh = vi.fn();
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh, push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))}/> }));
vi.mock('@/app/toast', () => ({ toast }));
afterEach(() => { replace.mockReset(); refresh.mockReset(); toast.mockReset(); vi.unstubAllGlobals(); });

const text: Record<string, string> = en;
// Lead keeps the Company's profile, Writer has its own, Helper has not moved and shares Lead's.
const [lead, writer, helper] = ['3a000000-0000-0000-0000-000000000011', '3a000000-0000-0000-0000-000000000021', '3a000000-0000-0000-0000-000000000041'];
const agent = (id: string, name: string, own: boolean, state: AppAgent['state']): AppAgent => ({ id, name, connection: id === writer ? 'f0000000-0000-0000-0000-000000000021' : 'f0000000-0000-0000-0000-000000000011', main: id === lead, own, state });
const states: Record<string, [AppAgent['state'], AppAgent['state']]> = { klaviyo: ['connected', 'off'], notion: ['attention', 'off'] };
const items: AppItem[] = apps.map(app => {
  const [mine, writers] = states[app.key] ?? ['off', 'off'];
  const agents = [agent(lead, 'Lead', true, mine), agent(writer, 'Writer', true, writers), agent(helper, 'Helper', false, mine)];
  return { key: app.key, name: app.name, mark: app.mark, category: app.category, state: mergedState(agents), agents,
    use: text[`use.${app.key}`], can: text[`can.${app.key}`], words: [app.name, ...[en, ar].flatMap(words => [`use.${app.key}`, `alias.${app.key}`].map(key => (words as Record<string, string>)[key]))].join(' ') };
});
const item = (key: string) => items.find(entry => entry.key === key)!;
const settings: AppsPlace = { kind: 'address', slug: 'rs-learning' };
// The answers /api/company-apps gives, in order, and every request sent to it.
function answers(...bodies: [number, object][]) {
  const sent: Record<string, string>[] = [];
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); const [status, body] = bodies.shift() ?? [200, { status: 'waiting' }]; return Promise.resolve(new Response(JSON.stringify(body), { status })); });
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
  const screen = await render(<AppDetail place={settings} company="c-1" owner rtl={false} item={item('canva')} text={text} failed={false}/>);
  await expect.element(screen.getByRole('heading', { name: 'Connect Canva' })).toBeVisible();
  await screen.getByRole('button', { name: 'Connect', exact: true }).click();
  expect(open).toHaveBeenCalledWith('about:blank', '_blank');
  await expect.poll(() => opened.location.href).toBe('https://auth.canva.example/authorize?state=s');
  expect(opened.opener).toBeNull();
  await expect.element(screen.getByRole('status')).toHaveTextContent('Finish signing in to Canva in its window.');
  await expect.poll(() => refresh.mock.calls.length, { timeout: 8000 }).toBe(1);
  expect(sent.map(body => body.action)).toEqual(['connect', 'poll', 'poll']);
  expect(sent.every(body => body.company === 'c-1' && body.app === 'canva' && body.agent === lead)).toBe(true);
  expect(toast.mock.calls).toEqual([['Canva connected · Lead']]);
});

test('a refused connect closes the window it opened and says why, in the reader\'s words', async () => {
  const opened = { opener: {}, location: { href: 'about:blank' }, close: vi.fn() };
  vi.stubGlobal('open', vi.fn(() => opened));
  answers([409, { error: 'appsBusy' }]);
  const screen = await render(<AppDetail place={settings} company="c-1" owner rtl={false} item={item('canva')} text={text} failed={false}/>);
  await screen.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.element(screen.getByRole('alert')).toHaveTextContent(text['error.appsBusy']);
  expect((opened.close as Mock).mock.calls.length).toBe(1);
});

test('Disconnect asks first, naming the Agents that lose it, then turns the app off for every one and returns to the list', async () => {
  const sent = answers([200, { status: 'off' }]);
  const screen = await render(<AppDetail place={settings} company="c-1" owner rtl={false} item={item('klaviyo')} text={text} failed={false}/>);
  await screen.getByRole('button', { name: 'Disconnect Klaviyo' }).click();
  await expect.element(screen.getByText('Disconnect Klaviyo? Lead won’t be able to reach it until you connect it again.')).toBeVisible();
  expect(sent).toEqual([]);
  await screen.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect.poll(() => replace.mock.calls.map(([href]) => href)).toEqual(['/c/rs-learning/settings?section=apps']);
  expect(sent).toEqual([{ company: 'c-1', app: 'klaviyo', action: 'disconnect' }]);
  expect(toast.mock.calls).toEqual([['Klaviyo disconnected', { icon: 'x' }]]);
});

test('a connected app\'s card shows the faces of the Agents that use it', async () => {
  const screen = await render(<AppsList place={settings} owner items={items} text={text}/>);
  const card = screen.getByRole('article', { name: 'Klaviyo' });
  expect(card.element().querySelector('.app__state .fstack')?.getAttribute('aria-hidden')).toBe('true');
  expect([...card.element().querySelectorAll('.fstack .agent-face')].map(face => face.getAttribute('aria-label'))).toEqual(['Lead', 'Helper']);
  expect(screen.getByRole('article', { name: 'Notion' }).element().querySelector('.fstack')).toBeNull();
});

test('who uses it: one row per Agent with its own state, and a switch only where the Owner can turn it on or off for that Agent alone', async () => {
  const screen = await render(<AppDetail place={settings} company="c-1" owner rtl={false} item={item('klaviyo')} text={text} failed={false}/>);
  const rows = screen.getByRole('region', { name: 'Who uses it' }).getByRole('listitem');
  expect(rows.elements().map(row => row.querySelector('.panel-row__text')?.textContent)).toEqual(['LeadCan use it', 'WriterTurned off for it', 'HelperUses Lead’s apps until it has its own space']);
  await expect.element(screen.getByRole('switch', { name: 'Lead' })).toHaveAttribute('aria-checked', 'true');
  await expect.element(screen.getByRole('switch', { name: 'Writer' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('switch').elements()).toHaveLength(2);
  await expect.element(screen.getByRole('link', { name: 'Done' })).toBeVisible();
  const member = await render(<AppDetail place={settings} company="c-1" owner={false} rtl={false} item={item('notion')} text={text} failed={false}/>);
  expect(member.container.querySelectorAll('.panel-row').length).toBe(3);
  expect(member.container.querySelectorAll('[role="switch"], .panel-row button')).toHaveLength(0);
});

test('turning an Agent on signs in for that Agent alone, and off turns it off for it alone, each said in a toast', async () => {
  const opened = { opener: {} as unknown, location: { href: 'about:blank' }, close: vi.fn() };
  vi.stubGlobal('open', vi.fn(() => opened));
  const sent = answers([200, { url: 'https://auth.klaviyo.example/authorize?state=s' }], [200, { status: 'connected' }], [200, { status: 'off' }]);
  const screen = await render(<AppDetail place={settings} company="c-1" owner rtl={false} item={item('klaviyo')} text={text} failed={false}/>);
  await screen.getByRole('switch', { name: 'Writer' }).click();
  await expect.element(screen.getByRole('status')).toHaveTextContent('Finish signing in to Klaviyo in its window.');
  await expect.element(screen.getByRole('switch', { name: 'Lead' })).toHaveAttribute('aria-disabled', 'true');
  await expect.element(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect.poll(() => refresh.mock.calls.length, { timeout: 8000 }).toBe(1);
  expect(toast.mock.calls).toEqual([['Writer can use Klaviyo']]);
  await expect.poll(() => document.activeElement?.id).toBe(`app-ag-${writer}`);
  await screen.getByRole('switch', { name: 'Lead' }).click();
  await expect.poll(() => refresh.mock.calls.length).toBe(2);
  expect(toast.mock.calls[1]).toEqual(['Lead can no longer use Klaviyo', { icon: 'x' }]);
  expect(sent).toEqual([{ company: 'c-1', agent: writer, app: 'klaviyo', action: 'connect' }, { company: 'c-1', agent: writer, app: 'klaviyo', action: 'poll' },
    { company: 'c-1', agent: lead, app: 'klaviyo', action: 'disconnect' }]);
});

test('an Agent whose sign-in needs attention gets its own Reconnect', async () => {
  vi.stubGlobal('open', vi.fn(() => null));
  const sent = answers([409, { error: 'appsAgentNotOwn' }]);
  const screen = await render(<AppDetail place={settings} company="c-1" owner rtl={false} item={item('notion')} text={text} failed={false}/>);
  expect(screen.getByRole('listitem').elements()[0].querySelector('.panel-row__d')?.textContent).toBe('Needs attention');
  await screen.getByRole('button', { name: 'Reconnect for Lead' }).click();
  await expect.element(screen.getByRole('alert')).toHaveTextContent(text['error.appsAgentNotOwn']);
  expect(sent).toEqual([{ company: 'c-1', agent: lead, app: 'notion', action: 'connect' }]);
});

test('who gets access: none picked is said and nothing is sent; each picked Agent after the first signs in at its own click', async () => {
  const opened = { opener: {} as unknown, location: { href: 'about:blank' }, close: vi.fn() };
  vi.stubGlobal('open', vi.fn(() => opened));
  const sent = answers([200, { url: 'https://auth.gamma.example/a' }], [200, { status: 'connected' }], [200, { url: 'https://auth.gamma.example/b' }], [200, { status: 'connected' }]);
  const screen = await render(<AppDetail place={settings} company="c-1" owner rtl={false} item={item('gamma')} text={text} failed={false}/>);
  const lead_ = screen.getByRole('checkbox', { name: 'Lead' }), writer_ = screen.getByRole('checkbox', { name: 'Writer' });
  await expect.element(lead_).toHaveAttribute('aria-checked', 'true');
  await expect.element(writer_).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('checkbox').elements()).toHaveLength(2);
  await expect.element(screen.getByRole('heading', { name: 'Who gets access 1' })).toBeVisible();
  await lead_.click();
  await screen.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.element(screen.getByText('Pick at least one agent.')).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(lead_.element());
  expect(sent).toEqual([]);
  await lead_.click();
  await writer_.click();
  await expect.element(screen.getByText('Pick at least one agent.')).not.toBeVisible();
  await screen.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.element(screen.getByRole('button', { name: 'Connect for Writer' }), { timeout: 8000 }).toBeVisible();
  expect(refresh).not.toHaveBeenCalled();
  await screen.getByRole('button', { name: 'Connect for Writer' }).click();
  await expect.poll(() => refresh.mock.calls.length, { timeout: 8000 }).toBe(1);
  expect(sent.map(body => [body.agent, body.action])).toEqual([[lead, 'connect'], [lead, 'poll'], [writer, 'connect'], [writer, 'poll']]);
  expect(toast.mock.calls).toEqual([['Gamma connected · Lead, Writer']]);
});

test('no page of an app names the engine or shows a path, in either language', async () => {
  for (const words of [en, ar] as Record<string, string>[]) for (const key of ['klaviyo', 'notion', 'canva']) for (const owner of [true, false]) {
    const screen = await render(<AppDetail place={settings} company="c-1" owner={owner} rtl={words === ar} item={item(key)} text={words} failed={false}/>);
    expect(screen.container.textContent).not.toMatch(/hermes|هيرمس|هرمس|\b(co|ag)-[0-9a-f]|\/(opt|data|home|root|tmp)\/|config\.yaml|mcp_servers|profile/i);
    await screen.unmount();
  }
});
