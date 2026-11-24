import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { act, type ComponentProps } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { render } from 'vitest-browser-react';
import { cdp, userEvent } from 'vitest/browser';
// Gives cdp() Playwright's session type (its send), as the config's provider does at run time.
import type {} from '@vitest/browser-playwright';
import ChannelView from '@/app/c/[slug]/channels/[id]/channel';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ChannelHandoff, ChannelMention, ChannelMessage, ChannelRecord } from '@/lib/channels';
import { changeChannel, channelChoices } from '@/app/channel-actions';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/globals.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('@/app/channel-actions', () => ({ changeChannel: vi.fn(), channelChoices: vi.fn() }));
vi.mock('@/app/channel-archive-actions', () => ({ archiveChannels: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); });

const at = '2026-06-10T09:05:00Z';
const peer: ChannelMessage = { id: 1, author: 'person', mine: false, name: 'Sara Adel', role: 'manager', body: 'Morning all', at, files: [], mention: null };
const called = (state: ChannelMention['state']): ChannelMessage => ({ id: 2, author: 'person', mine: true, name: 'Omar', role: 'owner', body: 'Hey @lead, what is due today?', at, files: [], mention: { agent: 'Lead', face: 'c-1', state, permissions: [], questions: [] } });
const reply: ChannelMessage = { id: 3, author: 'agent', name: 'Lead', face: 'c-1', body: 'Two things are due.', at };
const record = (messages: ChannelMessage[], more: Partial<ChannelRecord> = {}): ChannelRecord => ({
 channel: { id: 'ch-1', company: 'co-1', kind: 'general' },
 members: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, { person: 'p-2', name: 'Sara Adel', role: 'manager', invitation: null, email: null }],
 agents: [{ id: 'a-1', connection_id: 'c-1', name: 'Lead', speciality: 'General', main: true, only: false, state: 'idle' }],
 writer: true, manage: false, managers: [], may: ['once', 'always', 'deny'], messages, handoffs: [], open: messages.some(message => message.author === 'person' && (message.mentions ?? (message.mention ? [message.mention] : [])).some(mention => mention.state === 'open')), handover: false, ...more,
});
const channel = (initial: ChannelRecord) => render(<LanguageProvider language="en"><ChannelView slug="rs-learning" person="p-1" initial={initial}/></LanguageProvider>);

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

test('in Arabic the composer gives the same hint, with the general channel named عام', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await render(<LanguageProvider language="ar"><ChannelView slug="rs-learning" person="p-1" initial={record([peer])}/></LanguageProvider>);
 const box = screen.getByRole('textbox', { name: 'اكتب رسالتك في القناة', exact: true });
 await expect.element(box).toHaveAttribute('placeholder', 'اكتب في #عام… والوكيل بيرد بس لو ناديته باسمه');
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

// #428: a channel Run that failed because the Company has no model at all says so, in the words a Conversation uses
// (#422), instead of that the Agent could not reply: the Owner gets the way to Subscription and models, a Member is told
// to ask the Owner.
const noModelWords = {
 en: { line: 'This company has no AI subscription or model key connected yet, so its agents can’t reply.', connect: 'Connect one in Providers', ask: 'Ask the company’s Owner to connect one in Settings.', failed: 'couldn’t reply' },
 ar: { line: 'الشركة دي لسه مفيهاش اشتراك ذكاء اصطناعي ولا مفتاح موديل متوصّل، فالوكلاء مش هيقدروا يردّوا.', connect: 'وصّل واحد من المزوّدين', ask: 'اطلب من مالك الشركة يوصّل واحد من الإعدادات.', failed: 'مقدرش يرد' },
} as const;
for (const language of ['en', 'ar'] as const) for (const owner of [true, false]) test(`in ${language} a channel Run that failed for want of a model tells ${owner ? 'the Owner where to connect one' : 'a Member to ask the Owner'}`, async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const said = noModelWords[language];
 const screen = await render(<LanguageProvider language={language}><ChannelView slug="rs-learning" person="p-1" initial={record([called('noModel')], { modelLine: { owner } })}/></LanguageProvider>);
 const line = screen.getByRole('alert');
 await expect.element(line).toBeVisible();
 expect(line.element().textContent).toContain(said.line);
 expect(line.element().getAttribute('data-outcome')).toBe('no-model');
 expect(line.element().textContent).not.toContain(said.failed);
 if (owner) {
  await expect.element(line.getByRole('link', { name: said.connect })).toHaveAttribute('href', '/c/rs-learning/settings?section=models');
  expect(line.element().textContent).not.toContain(said.ask);
 } else {
  expect(line.element().textContent).toContain(said.ask);
  await expect.element(line.getByRole('link')).not.toBeInTheDocument();
 }
});

test('two Agents a message called that both had no model say it once, and another that could not reply keeps its own line', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const mention = (agent: string, state: 'noModel' | 'unanswered') => ({ agent, face: agent, state, permissions: [], questions: [] });
 const three: ChannelMessage = { id: 6, author: 'person', mine: true, name: 'Omar', role: 'owner', body: '@Ads @SEO @Lead the scripts', at, files: [],
  mention: mention('Ads', 'noModel'), mentions: [mention('Ads', 'noModel'), mention('SEO', 'noModel'), mention('Lead', 'unanswered')] };
 const screen = await channel(record([three], { modelLine: { owner: false } }));
 const lines = screen.getByRole('alert').elements().map(line => line.textContent);
 expect(lines).toEqual(['Lead couldn’t reply to this message.', 'This company has no AI subscription or model key connected yet, so its agents can’t reply. Ask the company’s Owner to connect one in Settings.']);
});

// #530: a channel Run whose model call cannot succeed on a retry says its cause and its Agent, in the words a
// Conversation uses (#457), instead of that the Agent could not reply: the Owner gets the way to the Agent's model in
// Providers, a Member is told to ask the Owner.
const refusedWords = {
 en: { noCredit: 'Lead could not reply: the company’s model key has no credit left.', keyRefused: 'Lead could not reply: the model provider refused the company’s key or sign-in.', modelMissing: 'Lead could not reply: its model is not available from the provider.', fix: 'Check the agent’s model in Providers', ask: 'Ask the company’s Owner to check it in Settings.' },
 ar: { noCredit: 'Lead مقدرش يرد: مفتاح الموديل بتاع الشركة مفيهوش رصيد.', keyRefused: 'Lead مقدرش يرد: مزوّد الموديل رفض مفتاح الشركة أو تسجيل الدخول.', modelMissing: 'Lead مقدرش يرد: الموديل بتاعه مش متاح عند المزوّد.', fix: 'اتأكد من موديل الوكيل من المزوّدين', ask: 'اطلب من مالك الشركة يتأكد منه من الإعدادات.' },
} as const;
for (const language of ['en', 'ar'] as const) for (const cause of ['noCredit', 'keyRefused', 'modelMissing'] as const) for (const owner of [true, false]) test(`in ${language} a channel Run refused for ${cause} says so and tells ${owner ? 'the Owner where to fix it' : 'a Member to ask the Owner'}`, async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const said = refusedWords[language];
 const screen = await render(<LanguageProvider language={language}><ChannelView slug="rs-learning" person="p-1" initial={record([called(cause)], { modelLine: { owner } })}/></LanguageProvider>);
 const line = screen.getByRole('alert');
 await expect.element(line).toBeVisible();
 expect(line.element().textContent).toContain(said[cause]);
 expect(line.element().getAttribute('data-outcome')).toBe({ noCredit: 'no-credit', keyRefused: 'key-refused', modelMissing: 'model-missing' }[cause]);
 if (owner) {
  await expect.element(line.getByRole('link', { name: said.fix })).toHaveAttribute('href', '/c/rs-learning/settings?section=models');
  expect(line.element().textContent).not.toContain(said.ask);
 } else {
  expect(line.element().textContent).toContain(said.ask);
  await expect.element(line.getByRole('link')).not.toBeInTheDocument();
 }
});

test('each Agent a message called whose model refused it says its own cause, beside the no-model line and another Agent\'s "couldn\'t reply"', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const mention = (agent: string, state: ChannelMention['state']) => ({ agent, face: agent, state, permissions: [], questions: [] });
 const three: ChannelMessage = { id: 6, author: 'person', mine: true, name: 'Omar', role: 'owner', body: '@Ads @SEO @Lead the scripts', at, files: [],
  mention: mention('Ads', 'noCredit'), mentions: [mention('Ads', 'noCredit'), mention('SEO', 'modelMissing'), mention('Lead', 'unanswered')] };
 const screen = await channel(record([three], { modelLine: { owner: false } }));
 const lines = screen.getByRole('alert').elements().map(line => line.textContent);
 expect(lines).toEqual(['Ads could not reply: the company’s model key has no credit left. Ask the company’s Owner to check it in Settings.',
  'SEO could not reply: its model is not available from the provider. Ask the company’s Owner to check it in Settings.', 'Lead couldn’t reply to this message.']);
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

test('the images of a message sit under it as chips, on the writer\'s side and on the start side', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const theirs: ChannelMessage = { ...peer, files: [{ id: 12, name: 'logo.jpeg' }] };
 const mine: ChannelMessage = { id: 4, author: 'person', mine: true, name: 'Omar', role: 'owner', body: 'Here it is', at, files: [{ id: 11, name: 'cover.png' }], mention: null };
 const screen = await channel(record([theirs, mine]));
 const peerChip = screen.container.querySelector('.turn--peer .msg-files a.file-chip');
 expect(peerChip?.textContent).toBe('logo.jpeg');
 expect(peerChip?.getAttribute('href')).toBe('/c/rs-learning/files/channel/12');
 expect(peerChip?.getAttribute('aria-label')).toBe('Open logo.jpeg');
 const ownChip = screen.container.querySelector('.turn--user .msg-files a.file-chip');
 expect(ownChip?.textContent).toBe('cover.png');
 expect(ownChip?.getAttribute('href')).toBe('/c/rs-learning/files/channel/11');
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
 members: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, { person: 'p-2', name: 'Sara Adel', role: 'manager', invitation: null, email: null }, { person: 'p-3', name: 'Youssef', role: 'contributor', invitation: null, email: null }],
 agents: [{ id: 'a-1', connection_id: 'c-1', name: 'Ads', speciality: 'Runs the ads.', main: false, only: false, state: 'idle' }, { id: 'a-2', connection_id: 'c-2', name: 'SEO', speciality: 'Writes the blog.', main: false, only: true, state: 'idle' }],
 managers: [{ name: 'Omar', role: 'owner' }, { name: 'Sara Adel', role: 'manager' }],
 ...more,
});
const reader = (initial: ChannelRecord) => render(<LanguageProvider language="en"><ChannelView slug="rs-learning" person="p-3" initial={initial}/></LanguageProvider>);

test('a team channel\'s Agent hidden from the reader elsewhere is marked as shown here only, and a reader who cannot change it is told who can', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await reader(team());
 await expect.element(screen.getByRole('button', { name: 'Launch week · Channel details' })).toBeVisible();
 expect(screen.container.querySelector('.ch-intro__only')?.textContent).toBe('SEO is shown to you in this channel only, and you can call it here. Outside the channel it stays hidden.');
 const details = screen.getByRole('complementary', { name: 'Channel details' });
 const rows = Array.from(details.element().querySelectorAll('.panel-row')).map(row => row.textContent);
 expect(rows).toContain('SEOShown to you in this channel only');
 expect(rows).toContain('AdsRuns the ads. · Idle');
 await expect.element(details.getByText('Members and agents are added and removed by Omar (Owner) and Sara Adel (Manager).')).toBeVisible();
 await expect.element(details.getByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
 await expect.element(details.getByRole('button', { name: 'Add a member' })).not.toBeInTheDocument();
});

// #206: each Agent in the channel's details carries its own state on its face and under its name, and the head counts
// the ones working. Every Member sees it, a Viewer included, and only the state is drawn.
test('each Agent in the channel\'s details shows its state on its face and under its name, and the head counts the ones working, for a Viewer too', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await reader(team({
  writer: false,
  agents: [
   { id: 'a-1', connection_id: 'c-1', name: 'Ads', speciality: 'Runs the ads.', main: false, only: false, state: 'working' },
   { id: 'a-2', connection_id: 'c-2', name: 'SEO', speciality: '', main: false, only: false, state: 'waiting' },
   { id: 'a-3', connection_id: 'c-3', name: 'Critic', speciality: 'Reads the copy.', main: false, only: false, state: 'idle' },
  ],
 }));
 const details = screen.getByRole('complementary', { name: 'Channel details' });
 const head = details.element().querySelector('.dp-id__role');
 expect(head?.textContent).toBe('3 members · 3 agents · 1 working');
 expect(head?.querySelector('.dot--working')).not.toBeNull();
 const rows = Array.from(details.element().querySelectorAll('.panel-row')).filter(row => row.querySelector('.face-wrap'));
 expect(rows.map(row => row.querySelector('.panel-row__d')?.textContent)).toEqual(['Runs the ads. · Working', 'Waiting on you', 'Reads the copy. · Idle']);
 expect(rows.map(row => row.querySelector('.face-wrap .dot')?.className)).toEqual(['dot dot--working', 'dot dot--waiting', 'dot dot--idle']);
});

test('in Arabic the details name each Agent\'s state and count the working ones', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await render(<LanguageProvider language="ar"><ChannelView slug="rs-learning" person="p-3" initial={team({ agents: [{ id: 'a-1', connection_id: 'c-1', name: 'Ads', speciality: 'بيظبط الإعلانات.', main: false, only: false, state: 'working' }, { id: 'a-2', connection_id: 'c-2', name: 'SEO', speciality: '', main: false, only: false, state: 'waiting' }] })}/></LanguageProvider>);
 const details = screen.getByRole('complementary', { name: 'تفاصيل القناة' });
 expect(details.element().querySelector('.dp-id__role')?.textContent).toBe('3 أعضاء · 2 وكلاء · 1 شغال');
 const rows = Array.from(details.element().querySelectorAll('.panel-row')).filter(row => row.querySelector('.face-wrap'));
 expect(rows.map(row => row.querySelector('.panel-row__d')?.textContent)).toEqual(['بيظبط الإعلانات. · شغال', 'مستنيك']);
});

test('the head drops the working count when none of the channel\'s Agents is working', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await reader(team());
 const head = screen.getByRole('complementary', { name: 'Channel details' }).element().querySelector('.dp-id__role');
 expect(head?.textContent).toBe('3 members · 2 agents');
 expect(head?.querySelector('.dot')).toBeNull();
});

test('a call in the channel turns its Agent working in its row and in the head, and its reply turns them back, without a reload', { timeout: 15000 }, async () => {
 const idle = { id: 'a-1', connection_id: 'c-1', name: 'Ads', speciality: 'Runs the ads.', main: false, only: false, state: 'idle' as const };
 const calledOut = team({ agents: [idle], messages: [called('open')], open: true });
 const working = team({ agents: [{ ...idle, state: 'working' as const }], messages: [called('open')], open: true });
 const answered = team({ agents: [idle], messages: [called('answered'), reply] });
 const answers = [working, answered]; let asked = 0;
 vi.stubGlobal('fetch', async () => new Response(JSON.stringify(answers[Math.min(asked++, answers.length - 1)])));
 const screen = await channel(calledOut);
 const details = screen.getByRole('complementary', { name: 'Channel details' });
 const row = () => Array.from(details.element().querySelectorAll('.panel-row')).find(node => node.textContent?.includes('Ads'));
 const head = () => details.element().querySelector('.dp-id__role');
 await expect.poll(() => row()?.textContent, { timeout: 5000 }).toContain('Working');
 expect(head()?.textContent).toBe('3 members · 1 agent · 1 working');
 await expect.poll(() => row()?.textContent, { timeout: 6000 }).toContain('Idle');
 expect(head()?.textContent).toBe('3 members · 1 agent');
 expect(head()?.querySelector('.dot')).toBeNull();
});

test('an Owner or a Manager takes a Member out and adds one the channel does not have, and the channel is read again', async () => {
 const asked = vi.fn<(url: string) => void>();
 vi.stubGlobal('fetch', async (url: string) => { asked(url); return new Response(JSON.stringify(team({ manage: true }))); });
 vi.mocked(changeChannel).mockResolvedValue('');
 vi.mocked(channelChoices).mockResolvedValue({ people: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, { person: 'p-2', name: 'Sara Adel', role: 'manager', invitation: null, email: null }, { person: 'p-3', name: 'Youssef', role: 'contributor', invitation: null, email: null }, { person: 'p-4', name: 'Mona', role: 'viewer', invitation: null, email: null }], agents: [] });
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

// #207: an invited person is in the members list with the name made from the email, their Role and "Invite sent", and
// every count includes them. Only the Owner and the Managers are sent the email.
const invitee = (email: string | null, role: 'contributor' | 'viewer' = 'contributor') => ({ person: null, name: 'Mona', role, invitation: 'i-1', email });
const hiring = (members: ChannelRecord['members']) => record([peer], { members });

test('an invited person is a member row with their Role and "Invite sent", in the list, the heading and the intro', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await channel(hiring([{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, invitee('mona@example.test', 'viewer')]));
 expect(document.querySelector('.ch-intro')?.textContent).toContain('2 members · Lead');
 const details = screen.getByRole('complementary', { name: 'Channel details' });
 expect(details.element().querySelector('.dp-id__role')?.textContent).toBe('2 members · 1 agent');
 expect(details.element().querySelector('#ch-h-p .muted')?.textContent).toBe('2');
 const rows = Array.from(details.element().querySelectorAll('.panel-row')).map(row => row.textContent);
 expect(rows).toContain('MMonaViewer · mona@example.test · reads only · Invite sent');
});

test('a Contributor and a Viewer read the invited row with no email anywhere on the page', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await channel(hiring([{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, invitee(null)]));
 const details = screen.getByRole('complementary', { name: 'Channel details' });
 const rows = Array.from(details.element().querySelectorAll('.panel-row')).map(row => row.textContent);
 expect(rows).toContain('MMonaContributor · Invite sent');
 expect(document.body.innerHTML).not.toContain('mona@example.test');
 expect(document.body.innerHTML).not.toContain('@example.test');
});

test('the channel draws the line the invitation added where it was written, in both languages', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const note: ChannelMessage = { id: -1, author: 'note', kind: 'invite', actor: 'Omar', name: 'Mona', at };
 const screen = await channel(record([peer, note]));
 const line = document.querySelector('.turns .note');
 expect(line?.className).toBe('note note--icon');
 expect(line?.textContent).toBe('Omar invited Mona, who joined “general” right away');
 expect(line?.querySelector('.note__icon')).not.toBeNull();
 const arabic = await render(<LanguageProvider language="ar"><ChannelView slug="rs-learning" person="p-1" initial={record([note])}/></LanguageProvider>);
 expect(arabic.container.querySelector('.turns .note')?.textContent).toBe('Omar عزم Mona، ودخل «عام» على طول');
});

test('a Manager finds an invited person under "Add a member", adds them, and takes them out of the channel', async () => {
 vi.stubGlobal('fetch', async () => new Response(JSON.stringify(team({ manage: true, members: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, invitee('mona@example.test')] }))));
 vi.mocked(changeChannel).mockResolvedValue('');
 vi.mocked(channelChoices).mockResolvedValue({ people: [{ person: null, name: 'Nour', role: 'contributor', invitation: 'i-2', email: 'nour@example.test' }], agents: [] });
 const screen = await reader(team({ manage: true, members: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, invitee('mona@example.test')] }));
 const details = screen.getByRole('complementary', { name: 'Channel details' });
 expect(Array.from(details.element().querySelectorAll('.panel-row')).map(row => row.textContent)).toContain('MMonaContributor · mona@example.test · Invite sentRemove');
 await details.getByRole('button', { name: 'Add a member' }).click();
 await expect.poll(() => details.element().querySelector('.tm-cand')?.textContent).toBe('NNourContributor · nour@example.testAdd');
 await details.getByRole('button', { name: 'Add', exact: true }).click();
 await expect.poll(() => vi.mocked(changeChannel).mock.calls.at(-1)).toEqual(['co-1', 'ch-1', { invitation: 'i-2', present: true }]);
 await details.getByRole('button', { name: 'Remove Mona from the channel' }).click();
 await expect.poll(() => vi.mocked(changeChannel).mock.calls.at(-1)).toEqual(['co-1', 'ch-1', { invitation: 'i-1', present: false }]);
});

// #148: a channel reply carries its Run's steps above the bubble and the card it showed under it, drawn by the same
// components a Conversation uses; every member reads them, a Viewer included.
const replied: ChannelMessage = { id: 4, author: 'agent', name: 'Faye', face: 'c-1', body: 'Here are the three scripts.', at,
 steps: { list: [{ tool: 'meta_ads', preview: 'October results', state: 'done' }, { tool: 'docs', preview: null, state: 'failed' }], seconds: 48 },
 cards: [{ id: 21, kind: 'review', title: 'Script review', line: '3 scripts · Meta Ads', items: [
  { text: 'من خريج تجارة لمحاسب شغال', fine: true, note: 'The promise is clear.' },
  { text: 'أضمن طريق لأول وظيفة', fine: false, note: 'Swap “أضمن” for “أقصر”.' }], decision: '1 ready, 1 back to Ads' }] };

test.each([
 ['en', 'Used 2 tools · 48 sec', 'Done', 'Skipped', 'Fine', 'Needs an edit', 'Decision'],
 ['ar', 'استخدم 2 أداة · 48 ثانية', 'تم', 'اتخطى', 'تمام', 'يتعدّل', 'القرار'],
] as const)('in the %s interface a channel reply draws its steps above the bubble and its review card under it', async (language, used, done, skipped, fine, edit, decision) => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await render(<LanguageProvider language={language}><ChannelView slug="rs-learning" person="p-1" initial={record([called('answered'), replied])}/></LanguageProvider>);
 const turn = screen.getByRole('list', { name: language === 'ar' ? 'الرسايل في #عام' : 'Messages in #general' }).getByRole('listitem').nth(2);
 const button = turn.getByRole('button', { name: used, exact: true });
 await expect.element(button).toBeVisible();
 const steps = button.element().closest('.steps')!;
 expect(steps.previousElementSibling?.className, 'right after the sender line').toBe('sender');
 expect(steps.nextElementSibling?.className, 'and before the bubble').toContain('bubble--agent');
 await button.click();
 expect([...document.getElementById(button.element().getAttribute('aria-controls') ?? '')!.querySelectorAll('.step__state')].map(state => state.textContent)).toEqual([done, skipped]);
 const card = turn.getByRole('group', { name: new RegExp(`Script review$`) });
 await expect.element(card).toBeVisible();
 expect(card.element().className).toContain('reply-card--review');
 expect(card.element().textContent).toContain('من خريج تجارة لمحاسب شغال');
 await expect.element(card.getByText(fine, { exact: true })).toBeVisible();
 await expect.element(card.getByText(edit, { exact: true })).toBeVisible();
 await expect.element(card.getByText(decision, { exact: true })).toBeVisible();
});

test('a Viewer reads a channel reply\'s steps and its card, and the card has no action', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await channel(record([replied], { writer: false, may: [] }));
 await expect.element(screen.getByRole('button', { name: 'Used 2 tools · 48 sec', exact: true })).toBeVisible();
 const card = screen.getByRole('group', { name: /Script review$/ });
 await expect.element(card).toBeVisible();
 expect(card.getByRole('button').elements()).toEqual([]);
});

// #152: a message that calls two Agents marks both names, the working line names the Agent replying now, and an Agent
// that could not reply gets its own line while the other Agent's reply still shows, in both languages.
const two = (second: 'open' | 'unanswered'): ChannelMessage => ({ id: 5, author: 'person', mine: true, name: 'Omar', role: 'owner', body: '@Ads @SEO we need two scripts', at, files: [],
 mention: { agent: 'Ads', face: 'c-1', state: 'answered', permissions: [], questions: [] },
 mentions: [{ agent: 'Ads', face: 'c-1', state: 'answered', permissions: [], questions: [] }, { agent: 'SEO', face: 'c-2', state: second, permissions: [], questions: [] }] });
const adsReply: ChannelMessage = { id: 6, author: 'agent', name: 'Ads', face: 'c-1', body: 'Two scripts are in.', at };

test.each([
 ['en', 'SEO is working on a reply…', 'SEO couldn’t reply to this message.'],
 ['ar', 'SEO يكتب الرد…', 'SEO مقدرش يرد على الرسالة دي.'],
] as const)('in the %s interface a message that called two Agents marks both names, names the one working, and gives the one that failed its own line', async (language, working, failed) => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await render(<LanguageProvider language={language}><ChannelView slug="rs-learning" person="p-1" initial={record([two('open'), adsReply])}/></LanguageProvider>);
 await expect.element(screen.getByRole('status')).toHaveTextContent(working);
 expect([...screen.container.querySelectorAll('.bubble .mention')].map(mark => mark.textContent)).toEqual(['@Ads', '@SEO']);
 expect([...screen.container.querySelectorAll('.bubble--agent')].map(bubble => bubble.textContent)).toEqual(['Two scripts are in.']);
 const stopped = await render(<LanguageProvider language={language}><ChannelView slug="rs-learning" person="p-1" initial={record([two('unanswered'), adsReply])}/></LanguageProvider>);
 await expect.element(stopped.getByRole('alert')).toHaveTextContent(failed);
 expect([...stopped.container.querySelectorAll('.bubble--agent')].map(bubble => bubble.textContent)).toEqual(['Two scripts are in.']);
 expect(stopped.container.querySelector('[role="status"]'), 'no Agent is working').toBeNull();
});

// #165: an Agent called in a channel asks to be allowed an action. The card sits under the Agent's turn; the Member who
// called it decides it, and everyone else reads the team's wait line.
const asking = (mine: boolean): ChannelMessage => ({ ...called('open'), mine, mention: { agent: 'Lead', face: 'c-1', state: 'open', permissions: [
 { id: 9, kind: 'permission', title: 'delete the old exports', description: 'delete the old exports', command: 'rm -r exports', choices: ['once', 'deny'], state: 'open' }], questions: [] } }) as ChannelMessage;

test('the caller decides the request under the Agent\'s turn, and the press goes to the channel route once', async () => {
 const sent: unknown[] = [];
 vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
  if (init?.method === 'POST') { sent.push(JSON.parse(String(init.body))); return Promise.resolve(Response.json({ state: 'decided', choice: 'once', at, first: true })); }
  return new Promise<Response>(() => {});
 });
 const screen = await channel(record([asking(true)]));
 const turn = screen.getByRole('list', { name: 'Messages in #general' }).getByRole('listitem').nth(2);
 await expect.element(turn).toHaveClass(/turn--agent/);
 const card = turn.getByRole('group', { name: 'Approval request: delete the old exports' });
 expect(turn.element().textContent).toMatch(/^Lead/);
 await expect.element(card).toHaveAttribute('id', 'permission-9');
 expect(card.getByRole('button').elements().map(button => button.textContent)).toEqual(['Don’t allow', 'Allow once']);
 await card.getByRole('button', { name: 'Allow once' }).click();
 await expect.element(card.getByText(/^Allowed once · /)).toBeInTheDocument();
 expect(sent).toEqual([{ company: 'co-1', channel: 'ch-1', intent: 'permit', request: 9, choice: 'once' }]);
});

test('another Member, and a Viewer, read the team\'s wait line on the request and no button', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 for (const more of [{}, { writer: false, may: [] }] as Partial<ChannelRecord>[]) {
  const screen = await channel(record([asking(false)], more));
  const card = screen.getByRole('group', { name: 'Approval request: delete the old exports' });
  await expect.element(card.getByText('Waiting for someone on the team to approve')).toBeInTheDocument();
  expect(card.getByRole('button').elements()).toEqual([]);
  await screen.unmount();
 }
});

// #200: a Member named with @ in a message is marked as bold as the called Agent's name is, for every reader.
const namedBoth: ChannelMessage = { id: 8, author: 'person', mine: false, name: 'Omar', role: 'owner', body: '@Sara Adel شوفي الخطة و @Ads راجعها', at, files: [],
 mention: { agent: 'Ads', face: 'c-1', state: 'answered', permissions: [], questions: [] } };

test.each(['en', 'ar'] as const)('in the %s interface a Member\'s name in a message is marked as the called Agent\'s name is', async (language) => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await render(<LanguageProvider language={language}><ChannelView slug="rs-learning" person="p-3" initial={team({ messages: [namedBoth] })}/></LanguageProvider>);
 expect([...screen.container.querySelectorAll('.bubble .mention')].map(mark => mark.textContent)).toEqual(['@Sara Adel', '@Ads']);
});

// #200: pressing the item opens the channel at that message, which rings once, and the read names the mention so the list
// lets it go. Opening the channel any other way sends no mention.
test('opened from a mention the message rings once and the read names that mention', async () => {
 const asked: string[] = [];
 vi.stubGlobal('fetch', (url: string) => { asked.push(url); return new Promise<Response>(() => {}); });
 history.replaceState(history.state, '', `${location.pathname}${location.search}#mention-42`);
 const screen = await channel(record([{ ...peer, id: 42 }, called('answered')]));
 expect(screen.container.querySelector('[data-msg="42"] .bubble')?.classList.contains('is-spot')).toBe(true);
 expect(screen.container.querySelector('[data-msg="2"] .is-spot')).toBeNull();
 await expect.poll(() => asked[0]).toBe('/api/channels?company=co-1&channel=ch-1&mention=42');
 await screen.unmount();
 history.replaceState(history.state, '', `${location.pathname}${location.search}`);
 const again = await channel(record([{ ...peer, id: 42 }]));
 expect(again.container.querySelector('.is-spot')).toBeNull();
 await expect.poll(() => asked[1]).toBe('/api/channels?company=co-1&channel=ch-1');
});

// #151: a channel whose Card is on the board shows it in its details as "On the board", with the Card's title, its line
// and the column it stands in, and opens the board at that Card. The channel's top corner carries the pill of #144.
test('a channel with a Card shows "On the board" with its title, its line and its column, and opens the board at it', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const board = { card: 41, title: 'Launch week', column: 'progress' as const, line: 'Write the launch post · 40%', waiting: false };
 const screen = await reader(team({ board }));
 const details = screen.getByRole('complementary', { name: 'Channel details' });
 await expect.element(details.getByRole('heading', { name: 'On the board' })).toBeVisible();
 const row = details.getByRole('link', { name: /Launch week/ });
 await expect.element(row).toHaveAttribute('href', '/c/rs-learning/work/board?show=41');
 expect(row.element().textContent).toBe('Launch weekWrite the launch post · 40%In progress');
 await expect.element(screen.getByRole('link', { name: 'On the board: In progress' })).toHaveAttribute('href', '/c/rs-learning/work/board?show=41');
});

test('a channel with no Card has no "On the board" section and no pill', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await reader(team());
 const details = screen.getByRole('complementary', { name: 'Channel details' });
 await expect.element(details.getByRole('heading', { name: 'On the board' })).not.toBeInTheDocument();
 await expect.element(screen.getByRole('link', { name: /On the board:/ })).not.toBeInTheDocument();
});

test('in Arabic the section and the pill carry the approved words, and a Viewer reads the waiting column as the team\'s', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await render(<LanguageProvider language="ar"><ChannelView slug="rs-learning" person="p-3" initial={team({ writer: false, board: { card: 41, title: 'إطلاق الأسبوع', column: 'waiting', line: 'مراجعة', waiting: true } })}/></LanguageProvider>);
 const details = screen.getByRole('complementary', { name: 'تفاصيل القناة' });
 await expect.element(details.getByRole('heading', { name: 'على اللوحة' })).toBeVisible();
 expect(details.getByRole('link', { name: /إطلاق الأسبوع/ }).element().textContent).toBe('إطلاق الأسبوعمراجعةمستني الفريق');
 const pill = screen.getByRole('link', { name: 'على اللوحة: مستني الفريق' });
 await expect.element(pill).toHaveAttribute('href', '/c/rs-learning/work/board?show=41');
 expect(pill.element().querySelector('.dot')?.className).toContain('dot--waiting');
});

// #151: the quiet line a channel's Card adds says where it went, in both languages.
test.each([['en', 'This card was added to the board under “In progress”'], ['ar', 'البطاقة دي اتضافت للوحة في «شغالين عليه»']] as const)('in the %s channel the Card\'s quiet line says where it went', async (language, words) => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const note: ChannelMessage = { id: -9, author: 'note', kind: 'card', at };
 const screen = await render(<LanguageProvider language={language}><ChannelView slug="rs-learning" person="p-1" initial={record([note])}/></LanguageProvider>);
 await expect.element(screen.getByText(words)).toBeVisible();
});

// #132 (design-reference: msgHTML's msg-in, .thinking .shimmer): a Viewer of the general channel sees what arrives rise
// once and the working line breathe; what the channel held when opened, its own first read included, stays still; a
// Viewer has no send arrow, so no copy of it ever flies.
test('a Viewer sees the working line breathe and the reply rise once when it arrives; the opened messages stay still', async () => {
 const later: ChannelMessage = { id: 4, author: 'person', mine: false, name: 'Sara Adel', role: 'manager', body: 'Read before the page drew', at, files: [], mention: null };
 const reads = [record([peer, later, called('open')], { writer: false })];
 vi.stubGlobal('fetch', async () => new Response(JSON.stringify(reads.shift() ?? record([peer, later, called('answered'), reply], { writer: false }))));
 const flew: string[] = [];
 const watch = new MutationObserver(records => records.forEach(each => each.addedNodes.forEach(node => { if (node instanceof Element && node.matches('.send-fly, :has(.send-fly)')) flew.push(node.outerHTML); })));
 watch.observe(document.body, { subtree: true, childList: true });
 onTestFinished(() => watch.disconnect());
 const screen = await render(<div className="gw"><LanguageProvider language="en"><ChannelView slug="rs-learning" person="p-1" initial={record([peer, called('open')], { writer: false })}/></LanguageProvider></div>);
 await expect.element(screen.getByText('Read before the page drew')).toBeVisible();
 const words = screen.container.querySelector('.thinking .shimmer')!;
 const style = getComputedStyle(words);
 expect([style.animationName, style.animationDuration, style.animationTimingFunction, style.animationIterationCount]).toEqual(['gw-breathe', '1.4s', 'ease-in-out', 'infinite']);
 expect(words.textContent).toBe('Lead is working on a reply…');
 await expect.element(screen.getByText('Two things are due.'), { timeout: 5000 }).toBeVisible();
 const turn = screen.container.querySelector('.turn--agent')!;
 expect([getComputedStyle(turn).animationName, getComputedStyle(turn).animationDuration, getComputedStyle(turn).animationTimingFunction]).toEqual(['gw-rise', '0.2s', 'cubic-bezier(0.2, 0, 0, 1)']);
 // An animation plays again only when its element is put in the page again: further reads keep the reply's element,
 // and what the channel opened with, its first read included, carries no rise.
 await new Promise(resolve => setTimeout(resolve, 3500));
 expect(screen.container.querySelector('.turn--agent')).toBe(turn);
 const still = [...screen.container.querySelectorAll('.turns > li')].filter(item => item !== turn && getComputedStyle(item).animationName !== 'none');
 expect(still.map(item => item.textContent), 'the reply rose, and nothing the channel opened with').toEqual([]);
 expect(screen.container.querySelector('.composer__send')).toBeNull();
 expect(flew).toEqual([]);
});

// #132: a called Agent's question that arrives while the channel is open: its card turn rises, though the Agent was
// already called when the channel opened.
test('a question the called Agent asks while the channel is open rises in its own turn', async () => {
 const question = { id: 31, kind: 'question' as const, title: 'Which angle first?', question: 'Which angle first?', choices: ['Graduates', 'Parents'], multiple: false, state: 'open' as const, chips: false };
 const asking: ChannelMessage = { id: 2, author: 'person', mine: true, name: 'Omar', role: 'owner', body: 'Hey @lead, what is due today?', at, files: [], mention: { agent: 'Lead', face: 'c-1', state: 'open', permissions: [], questions: [question] } };
 // The channel's own first read still has no question; the next one brings it.
 const reads = [record([called('open')])];
 vi.stubGlobal('fetch', async () => new Response(JSON.stringify(reads.shift() ?? record([asking]))));
 const screen = await render(<div className="gw"><LanguageProvider language="en"><ChannelView slug="rs-learning" person="p-1" initial={record([called('open')])}/></LanguageProvider></div>);
 await expect.element(screen.getByText('Which angle first?').first(), { timeout: 5000 }).toBeVisible();
 const turn = screen.getByText('Which angle first?').first().element().closest('.turns > li')!;
 expect(turn.classList.contains('msg-in')).toBe(true);
});

// #586: the server draws the page in UTC and the reader is in Cairo, two hours ahead in November. Each message's time, and
// each handover's in the details, is drawn in UTC, hidden, until the page hydrates, then in the reader's own zone, with no
// hydration mismatch (as the Conversation page does since #520).
test('a message\'s time the server drew in UTC shows in the reader\'s own zone once the channel hydrates, with no hydration error', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const zone = (timezoneId: string) => cdp().send('Emulation.setTimezoneOverride', { timezoneId });
 onTestFinished(async () => { await zone(''); });
 const late = '2026-11-12T22:30:00Z';
 const handed: ChannelHandoff = { id: 1, from: { name: 'Lead', face: 'c-1' }, to: { name: 'Ads', face: 'c-2' }, goal: 'Plan the ads', at: late };
 const chat = record([{ ...peer, at: late }, { ...called('answered'), at: late }, { ...reply, at: late }], { handoffs: [handed] });
 const view = <LanguageProvider language="en"><ChannelView slug="rs-learning" person="p-1" initial={chat}/></LanguageProvider>;
 await zone('UTC');
 const host = document.body.appendChild(document.createElement('div'));
 host.innerHTML = renderToString(view);
 const times = () => [...host.querySelectorAll('.turns time:not(.divider time), .panel-row__d time')];
 expect(times().map(time => time.textContent)).toEqual(['10:30 PM', '10:30 PM', '10:30 PM', '10:30 PM']);
 expect(times().map(time => getComputedStyle(time).visibility), 'hidden until the reader\'s zone is known').toEqual(['hidden', 'hidden', 'hidden', 'hidden']);
 await zone('Africa/Cairo');
 const recoverable = vi.fn();
 const root = await act(async () => hydrateRoot(host, view, { onRecoverableError: recoverable }));
 try {
  await expect.poll(() => times().map(time => time.textContent)).toEqual(['12:30 AM', '12:30 AM', '12:30 AM', '12:30 AM']);
  expect(times().map(time => getComputedStyle(time).visibility)).toEqual(['visible', 'visible', 'visible', 'visible']);
  expect(recoverable).not.toHaveBeenCalled();
 } finally { act(() => root.unmount()); host.remove(); }
});
