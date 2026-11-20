import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { ConnectedTools, type AgentToolItem } from '@/app/connected-tools';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/shell.css';

const { toast, signInToApp } = vi.hoisted(() => ({ toast: vi.fn(), signInToApp: vi.fn() }));
vi.mock('@/app/toast', () => ({ toast }));
vi.mock('@/app/app-sign-in', () => ({ signInToApp }));

// #204, design-reference: activityHTML's "Connected tools" and noToolsText, worded as the reference words them.
const tools: AgentToolItem[] = [
 { key: 'canva', name: 'Canva', mark: 'Ca', state: 'connected', use: 'Agents find your designs and templates and read what’s in them.' },
 { key: 'notion', name: 'Notion', mark: 'N', state: 'turnedOff', use: 'Agents search and read your pages, databases and meeting notes.' },
 { key: 'klaviyo', name: 'Klaviyo', mark: 'K', state: 'attention', use: 'Agents read your email campaigns, flows and segments, and how each one did.' },
 { key: 'mixpanel', name: 'Mixpanel', mark: 'MP', state: 'missing', use: 'Agents query your events, funnels and cohorts to explain the numbers.' },
];
const drawn = (props: Partial<Parameters<typeof ConnectedTools>[0]>, language: 'en' | 'ar' = 'en') => render(<LanguageProvider language={language}>
 <div className="gw"><div className="details is-open" dir={language === 'ar' ? 'rtl' : 'ltr'}><ConnectedTools company="co-1" agent="ag-1" name="Mona" owner={false} tools={tools} {...props}/></div></div>
</LanguageProvider>);
const rows = (screen: Awaited<ReturnType<typeof drawn>>) => [...screen.container.querySelectorAll('.panel-card > .panel-row')].map(row => [
 row.querySelector('.panel-row__t')?.textContent, row.querySelector('.panel-row__d')?.textContent, row.querySelector(':scope > .panel-row__meta, :scope > button')?.textContent,
 !!row.querySelector('.tool-tile'), !!row.querySelector(':scope > .panel-row__meta .gw-icon')]);

test('a reader sees each row\'s tile, name and use, ending in Connected with a check, Turned off for it, Needs attention or Not connected, and no Manage', async () => {
 const screen = await drawn({});
 await expect.element(screen.getByRole('heading', { name: 'Connected tools' })).toBeVisible();
 expect(rows(screen)).toEqual([
  ['Canva', tools[0].use, 'Connected', true, true],
  ['Notion', tools[1].use, 'Turned off for it', true, false],
  ['Klaviyo', tools[2].use, 'Needs attention', true, false],
  ['Mixpanel', `Not connected · ${tools[3].use}`, 'Not connected', true, false],
 ]);
 expect(screen.container.querySelectorAll('button')).toHaveLength(0);
});

test('in Arabic the rows read as the reference words them', async () => {
 const screen = await drawn({ tools: tools.map(tool => ({ ...tool, use: 'x' })) }, 'ar');
 await expect.element(screen.getByRole('heading', { name: 'الأدوات المتوصلة' })).toBeVisible();
 expect(rows(screen).map(row => [row[1], row[2]])).toEqual([['x', 'متوصل'], ['x', 'مقفول عليه'], ['x', 'محتاج يتوصل تاني'], ['مش متوصل · x', 'مش متوصل']]);
});

test('the Owner has Manage in the heading and Connect on a row not connected; Manage turns connected rows into Disconnect and reads Done, and Done restores them', async () => {
 const screen = await drawn({ owner: true });
 const manage = screen.getByRole('button', { name: 'Manage' });
 await expect.element(manage).toHaveAttribute('aria-pressed', 'false');
 expect(rows(screen).map(row => row[2])).toEqual(['Connected', 'Turned off for it', 'Needs attention', 'Connect']);
 await manage.click();
 const done = screen.getByRole('button', { name: 'Done' });
 await expect.element(done).toHaveAttribute('aria-pressed', 'true');
 await expect.element(done).toHaveFocus();
 expect(rows(screen).map(row => row[2])).toEqual(['Disconnect', 'Disconnect', 'Disconnect', 'Connect']);
 await done.click();
 expect(rows(screen).map(row => row[2])).toEqual(['Connected', 'Turned off for it', 'Needs attention', 'Connect']);
});

test('an Agent with no app reads the empty line with its own name, with no Manage', async () => {
 const none = await drawn({ tools: [], owner: true });
 expect(none.container.querySelector('.panel-empty')?.textContent).toBe('Mona only works on what you send it and doesn’t need outside tools.');
 expect(none.container.querySelectorAll('button, .panel-row')).toHaveLength(0);
});
test('in Arabic the empty line names the Agent as the reference words it', async () => {
 const ar = await drawn({ tools: [] }, 'ar');
 expect(ar.container.querySelector('.panel-empty')?.textContent).toBe('Mona بيشتغل على اللي بتبعتهوله بس، مش محتاج أدوات خارجية.');
});
test('an Engine that cannot be read shows the apps\' line, with no rows and no Manage', async () => {
 const unread = await drawn({ tools: null, owner: true });
 expect(unread.container.querySelector('.panel-empty')?.textContent).toBe('The apps can’t be read right now. Try again in a minute.');
 expect(unread.container.querySelectorAll('button, .panel-row')).toHaveLength(0);
});

// A page is drawn with no read of the Engine (#201): the section draws its heading first and reads the Agent's tools
// from /api/company-apps after it.
test('drawn with no tools, the section reads this Agent\'s tools from the apps route after it is drawn', async () => {
 let answer: (response: Response) => void = () => {}; const held = new Promise<Response>(resolve => { answer = resolve; });
 const fetch = vi.spyOn(window, 'fetch').mockReturnValue(held);
 try {
  const screen = await drawn({ tools: undefined, owner: true });
  await expect.element(screen.getByRole('heading', { name: 'Connected tools' })).toBeVisible();
  expect(fetch).toHaveBeenCalledWith('/api/company-apps?company=co-1&agent=ag-1', { cache: 'no-store' });
  expect(screen.container.querySelectorAll('button, .panel-row, .panel-empty')).toHaveLength(0);
  answer(new Response(JSON.stringify({ tools }), { headers: { 'Content-Type': 'application/json' } }));
  await expect.element(screen.getByRole('button', { name: 'Manage' })).toBeVisible();
  expect(rows(screen).map(row => row[2])).toEqual(['Connected', 'Turned off for it', 'Needs attention', 'Connect']);
 } finally { fetch.mockRestore(); }
});
test('a read of the tools that fails shows the apps\' line', async () => {
 const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
 try {
  const screen = await drawn({ tools: undefined, owner: true });
  await expect.element(screen.getByText('The apps can’t be read right now. Try again in a minute.')).toBeVisible();
  expect(screen.container.querySelectorAll('button, .panel-row')).toHaveLength(0);
 } finally { fetch.mockRestore(); }
});

// #458: an app that needs a token or a declared field is typed in the apps sheet, not connected from this row; the row
// stays Connect and no toast says it connected.
test('Connect on a row opens the app\'s page in the sheet when it needs a value typed there', async () => {
 signInToApp.mockReset(); signInToApp.mockResolvedValue({ state: 'manual' }); toast.mockReset();
 const screen = await drawn({ owner: true });
 await screen.getByRole('button', { name: 'Connect' }).click();
 await expect.poll(() => signInToApp.mock.calls.length).toBe(1);
 expect(signInToApp.mock.calls[0][0]).toMatchObject({ company: 'co-1', agent: 'ag-1', app: 'mixpanel', openApp: expect.any(Function) });
 await expect.element(screen.getByRole('button', { name: 'Connect' })).toBeVisible();
 expect(toast).not.toHaveBeenCalled();
});
