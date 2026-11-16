import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import ChannelView from '@/app/c/[slug]/channels/[id]/channel';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ChannelMessage, ChannelRecord } from '@/lib/channels';
import { changeChannel, channelChoices } from '@/app/channel-actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('@/app/channel-actions', () => ({ changeChannel: vi.fn(), channelChoices: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); });

const at = '2026-06-10T09:05:00Z';
const peer: ChannelMessage = { id: 1, author: 'person', mine: false, name: 'Sara Adel', role: 'manager', body: 'Morning all', at, mention: null };
const called = (state: 'open' | 'answered' | 'unanswered'): ChannelMessage => ({ id: 2, author: 'person', mine: true, name: 'Omar', role: 'owner', body: 'Hey @lead, what is due today?', at, mention: { agent: 'Lead', state } });
const reply: ChannelMessage = { id: 3, author: 'agent', name: 'Lead', face: 'c-1', body: 'Two things are due.', at };
const record = (messages: ChannelMessage[], more: Partial<ChannelRecord> = {}): ChannelRecord => ({
 channel: { id: 'ch-1', company: 'co-1', kind: 'general' },
 members: [{ person: 'p-1', name: 'Omar', role: 'owner' }, { person: 'p-2', name: 'Sara Adel', role: 'manager' }],
 agents: [{ id: 'a-1', connection_id: 'c-1', name: 'Lead', speciality: 'General', main: true, only: false }],
 writer: true, manage: false, managers: [], messages, open: messages.some(message => message.author === 'person' && message.mention?.state === 'open'), ...more,
});
const channel = (initial: ChannelRecord) => render(<LanguageProvider language="en"><ChannelView person="p-1" initial={initial}/></LanguageProvider>);

test('another member writes on the start side with their first name and role, the reader on the end side, and the called Agent is marked and replies', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await channel(record([peer, called('answered'), reply]));
 expect(screen.container.querySelector('.ch-intro')?.textContent).toBe('#general2 members · LeadAgents read and reply only when someone calls them by name, like @Lead. Ordinary talk between members goes to no agent.');
 const turns = screen.getByRole('list', { name: 'Messages in #general' });
 await expect.element(turns.getByRole('listitem').nth(1)).toHaveClass(/turn--peer/);
 expect(turns.getByRole('listitem').nth(1).element().textContent).toMatch(/^SSaraManager.+Morning all$/);
 await expect.element(turns.getByRole('listitem').nth(2)).toHaveClass(/turn--user/);
 await expect.element(turns.getByText('@lead', { exact: true })).toHaveClass('mention');
 expect(turns.getByRole('listitem').nth(3).element().textContent).toMatch(/^Lead.+Two things are due\.$/);
 await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
 const box = screen.getByRole('textbox', { name: 'Write your message in the channel' });
 await expect.element(box).toHaveAttribute('placeholder', 'Write in #general… an agent replies only when called by name');
});

test('while the called Agent replies the page says so and asks again, and a reply that never came says it could not', async () => {
 const asked = vi.fn<(url: string) => void>();
 vi.stubGlobal('fetch', async (url: string) => { asked(url); return new Response(JSON.stringify(record([called('answered'), reply]))); });
 const screen = await channel(record([called('open')]));
 await expect.element(screen.getByRole('status')).toHaveTextContent('Lead is working on a reply…');
 await expect.poll(() => asked.mock.calls.length, { timeout: 5000 }).toBeGreaterThan(0);
 expect(asked.mock.calls[0][0]).toBe('/api/channels?company=co-1&channel=ch-1');
 await expect.element(screen.getByText('Two things are due.')).toBeVisible();
 await expect.element(screen.getByRole('status')).not.toBeInTheDocument();

 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const failed = await channel(record([called('unanswered')]));
 await expect.element(failed.getByRole('alert')).toHaveTextContent('Lead couldn’t reply to this message.');
});

test('a message is posted to the channel with its own send key', async () => {
 const posted = vi.fn<(url: string, body: Record<string, string>) => void>();
 vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
  if (init?.method === 'POST') { posted(url, JSON.parse(String(init.body))); return new Response(JSON.stringify({ message: 9 })); }
  return new Promise<Response>(() => {});
 });
 const screen = await channel(record([peer]));
 await userEvent.type(screen.getByRole('textbox', { name: 'Write your message in the channel' }), 'Morning, team{Enter}');
 await expect.poll(() => posted.mock.calls.length).toBe(1);
 const [url, body] = posted.mock.calls[0];
 expect(url).toBe('/api/channels');
 expect(body).toEqual({ company: 'co-1', channel: 'ch-1', message: 'Morning, team', sendKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
});

test('a Viewer reads the channel with no composer', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await channel(record([peer], { writer: false }));
 await expect.element(screen.getByText('Morning all')).toBeVisible();
 await expect.element(screen.getByRole('textbox')).not.toBeInTheDocument();
 expect(screen.getByRole('note').element().textContent).toBe('Your account is view-only: you can read everything you’re allowed to, without writing, approving or changing anything.');
});

const team = (more: Partial<ChannelRecord> = {}): ChannelRecord => record([peer], {
 channel: { id: 'ch-1', company: 'co-1', kind: 'team', name: 'Launch week' },
 members: [{ person: 'p-1', name: 'Omar', role: 'owner' }, { person: 'p-2', name: 'Sara Adel', role: 'manager' }, { person: 'p-3', name: 'Youssef', role: 'contributor' }],
 agents: [{ id: 'a-1', connection_id: 'c-1', name: 'Ads', speciality: 'Runs the ads.', main: false, only: false }, { id: 'a-2', connection_id: 'c-2', name: 'SEO', speciality: 'Writes the blog.', main: false, only: true }],
 managers: [{ name: 'Omar', role: 'owner' }, { name: 'Sara Adel', role: 'manager' }],
 ...more,
});
const reader = (initial: ChannelRecord) => render(<LanguageProvider language="en"><ChannelView person="p-3" initial={initial}/></LanguageProvider>);

test('a team channel\'s Agent hidden from the reader elsewhere is marked as shown here only, and a reader who cannot change it is told who can', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await reader(team());
 await expect.element(screen.getByRole('button', { name: 'Launch week · Channel details' })).toBeVisible();
 expect(screen.container.querySelector('.ch-intro__only')?.textContent).toBe('SEO is shown to you in this channel only, and you can call it here. Outside the channel it stays hidden.');
 const details = screen.getByRole('complementary', { name: 'Channel details' });
 const rows = Array.from(details.element().querySelectorAll('.panel-row')).map(row => row.textContent);
 expect(rows).toContain('SEOShown to you in this channel only');
 expect(rows).toContain('AdsRuns the ads.');
 await expect.element(details.getByText('Members and agents are added and removed by Omar (Owner) and Sara Adel (Manager).')).toBeVisible();
 await expect.element(details.getByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
 await expect.element(details.getByRole('button', { name: 'Add a member' })).not.toBeInTheDocument();
});

test('an Owner or a Manager takes a Member out and adds one the channel does not have, and the channel is read again', async () => {
 const asked = vi.fn<(url: string) => void>();
 vi.stubGlobal('fetch', async (url: string) => { asked(url); return new Response(JSON.stringify(team({ manage: true }))); });
 vi.mocked(changeChannel).mockResolvedValue('');
 vi.mocked(channelChoices).mockResolvedValue({ people: [{ person: 'p-1', name: 'Omar', role: 'owner' }, { person: 'p-2', name: 'Sara Adel', role: 'manager' }, { person: 'p-3', name: 'Youssef', role: 'contributor' }, { person: 'p-4', name: 'Mona', role: 'viewer' }], agents: [] });
 const screen = await reader(team({ manage: true }));
 const details = screen.getByRole('complementary', { name: 'Channel details' });
 await expect.element(details.getByRole('button', { name: 'Remove Youssef from the channel' })).not.toBeInTheDocument();
 await details.getByRole('button', { name: 'Remove Sara Adel from the channel' }).click();
 await expect.poll(() => vi.mocked(changeChannel).mock.calls).toEqual([['co-1', 'ch-1', { person: 'p-2', present: false }]]);
 await expect.poll(() => asked.mock.calls.map(([url]) => url)).toContain('/api/channels?company=co-1&channel=ch-1');
 await details.getByRole('button', { name: 'Add a member' }).click();
 await expect.element(details.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-expanded', 'true');
 const add = details.getByRole('button', { name: 'Add', exact: true });
 await expect.element(add).toBeVisible();
 expect(Array.from(details.element().querySelectorAll('.tm-cand')).map(row => row.textContent)).toEqual(['MMonaViewerAdd']);
 await add.click();
 await expect.poll(() => vi.mocked(changeChannel).mock.calls.at(-1)).toEqual(['co-1', 'ch-1', { person: 'p-4', present: true }]);
 await details.getByRole('button', { name: 'Remove SEO from the channel' }).click();
 await expect.poll(() => vi.mocked(changeChannel).mock.calls.at(-1)).toEqual(['co-1', 'ch-1', { agent: 'a-2', present: false }]);
});
