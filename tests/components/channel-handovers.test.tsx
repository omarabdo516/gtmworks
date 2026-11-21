import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import ChannelView from '@/app/c/[slug]/channels/[id]/channel';
import { LanguageProvider } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { handoverLines, inWrittenOrder, type ChannelHandoff, type ChannelMessage, type ChannelRecord, type StoredHandover } from '@/lib/channels';
import '@/app/tokens.css';
import '@/app/shell.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: React.ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('@/app/channel-actions', () => ({ changeChannel: vi.fn(), channelChoices: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); });

// #150, #476: a channel's handovers, drawn from gtmworks's own record: the quiet row "{asking Agent} asked {asked Agent}"
// with both faces and the job, the asked Agent's answer marked "to {asking Agent}", and the details' "Handoffs" section
// with its count and the last four, newest first.
const at = '2026-06-10T09:05:00Z';
const timeOf = (value: string, language: 'en' | 'ar') => new Date(value).toLocaleTimeString(localeFor(language), { hour: '2-digit', minute: '2-digit' });
const lead = { id: 'a-1', connection_id: 'c-1', name: 'Lead', speciality: 'General', main: true, only: false, state: 'idle' as const };
const ads = { id: 'a-2', connection_id: 'c-2', name: 'Ads', speciality: 'Runs the ads.', main: false, only: false, state: 'idle' as const };
const record = (messages: ChannelMessage[], handoffs: ChannelHandoff[] = [], more: Partial<ChannelRecord> = {}): ChannelRecord => ({
 channel: { id: 'ch-1', company: 'co-1', kind: 'team', name: 'Launch week' },
 members: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, { person: 'p-2', name: 'Sara Adel', role: 'manager', invitation: null, email: null }],
 agents: [lead, ads], writer: true, manage: false, managers: [], may: ['once', 'always', 'deny'],
 messages, handoffs, open: false, handover: false, ...more,
});
const view = (initial: ChannelRecord, language: 'en' | 'ar') => render(<LanguageProvider language={language}><ChannelView slug="rs-learning" person="p-1" initial={initial}/></LanguageProvider>);
const handoff = (id: number, goal: string, minute: string): ChannelHandoff => ({ id, from: { name: 'Lead', face: 'c-1' }, to: { name: 'Ads', face: 'c-2' }, goal, at: `2026-06-10T09:${minute}:00Z` });

test('a channel with no handover draws no Handoffs section', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await view(record([{ id: 1, author: 'person', mine: true, name: 'Omar', role: 'owner', body: 'Morning all', at, files: [], mention: null }]), 'en');
 const details = screen.getByRole('complementary', { name: 'Channel details' });
 await expect.element(details.getByRole('heading', { name: /Members/ })).toBeVisible();
 expect(screen.container.querySelector('#ch-h-h')).toBeNull();
});

test('two handovers are drawn in the details newest first, each with both faces, the Agent it went to, the job and its time', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await view(record([], [handoff(9, 'Plan the Meta ads for the March intake', '08'), handoff(8, 'Write the launch email', '04')]), 'en');
 const details = screen.getByRole('complementary', { name: 'Channel details' });
 const heading = details.getByRole('heading', { name: /Handoffs/ });
 await expect.element(heading).toBeVisible();
 expect(heading.element().textContent).toBe('Handoffs 2');
 const rows = Array.from(screen.container.querySelectorAll('#ch-h-h ~ .panel-card .panel-row'));
 expect(rows.map(row => row.textContent)).toEqual([
  `Lead asked AdsPlan the Meta ads for the March intake · ${timeOf('2026-06-10T09:08:00Z', 'en')}`,
  `Lead asked AdsWrite the launch email · ${timeOf('2026-06-10T09:04:00Z', 'en')}`,
 ]);
 expect(rows.map(row => row.querySelectorAll('.agent-face').length)).toEqual([2, 2]);
 expect(rows[0].querySelector('.handed__faces .gw-icon path')?.getAttribute('d')).toBe('M5 12h14');
});

test('six handovers count six and the details draw the last four, newest first', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const six = [handoff(12, 'Job 6', '12'), handoff(11, 'Job 5', '11'), handoff(10, 'Job 4', '10'), handoff(9, 'Job 3', '09'), handoff(8, 'Job 2', '08'), handoff(7, 'Job 1', '07')];
 const screen = await view(record([], six), 'en');
 const details = screen.getByRole('complementary', { name: 'Channel details' });
 expect(screen.container.querySelector('#ch-h-h')?.textContent).toBe('Handoffs 6');
 const rows = Array.from(screen.container.querySelectorAll('#ch-h-h ~ .panel-card .panel-row'));
 expect(rows.map(row => row.querySelector('.panel-row__t')?.textContent)).toEqual(['Lead asked Ads', 'Lead asked Ads', 'Lead asked Ads', 'Lead asked Ads']);
 expect(rows.map(row => row.querySelector('.panel-row__d')?.textContent?.split(' · ')[0])).toEqual(['Job 6', 'Job 5', 'Job 4', 'Job 3']);
});

test('in Arabic the details read التسليمات with the same count and rows', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await view(record([], [handoff(9, 'خطة إعلانات مارس', '08'), handoff(8, 'إيميل الإطلاق', '04')]), 'ar');
 const details = screen.getByRole('complementary', { name: 'تفاصيل القناة' });
 expect(screen.container.querySelector('#ch-h-h')?.textContent).toBe('التسليمات 2');
 const rows = Array.from(screen.container.querySelectorAll('#ch-h-h ~ .panel-card .panel-row'));
 expect(rows.map(row => row.textContent)).toEqual([
  `Lead طلب من Adsخطة إعلانات مارس · ${timeOf('2026-06-10T09:08:00Z', 'ar')}`,
  `Lead طلب من Adsإيميل الإطلاق · ${timeOf('2026-06-10T09:04:00Z', 'ar')}`,
 ]);
 expect(rows[0].querySelector('.handed__faces .gw-icon path')?.getAttribute('d')).toBe('M19 12H5');
});

test('the transcript draws the row, then the other Agent\'s answer marked "to Lead", then Lead\'s reply, in that order', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const messages: ChannelMessage[] = [
  { id: 1, author: 'person', mine: true, name: 'Omar', role: 'owner', body: '@Lead plan the March ads', at: '2026-06-10T09:05:00Z', files: [], mention: { agent: 'Lead', face: 'c-1', state: 'answered', permissions: [], questions: [] } },
  { id: 2, author: 'agent', name: 'Lead', face: 'c-1', body: 'On it: I handed the job to Ads.', at: '2026-06-10T09:05:30Z' },
  { id: 'handover-7', author: 'handoff', from: { name: 'Lead', face: 'c-1' }, to: { name: 'Ads', face: 'c-2' }, goal: 'Plan the Meta ads for the March intake', at: '2026-06-10T09:06:00Z' },
  { id: 'handover-7-answer', author: 'agent', name: 'Ads', face: 'c-2', body: 'Three ad sets, 30 days, EGP 9,000.', at: '2026-06-10T09:08:00Z', to: 'Lead' },
  { id: 'handover-7-reply', author: 'agent', name: 'Lead', face: 'c-1', body: 'Ads planned the March intake.', at: '2026-06-10T09:09:00Z' },
 ];
 const screen = await view(record(messages), 'en');
 const turns = screen.getByRole('list', { name: 'Messages in #Launch week' });
 const items = Array.from(turns.element().querySelectorAll(':scope > li')).filter(row => !row.classList.contains('divider'));
 expect(items.map(row => row.getAttribute('data-author') ?? (row.hasAttribute('data-handover') ? 'handoff' : row.tagName.toLowerCase()))).toEqual(['person', 'agent', 'handoff', 'agent', 'agent']);
 const row = items[2];
 expect(row.textContent).toBe('Lead asked AdsPlan the Meta ads for the March intake');
 expect(row.querySelectorAll('.agent-face').length).toBe(2);
 expect(row.querySelector('.gw-icon path')?.getAttribute('d')).toBe('M5 12h14');
 expect(items[3].querySelector('.sender')?.textContent).toContain('Ads');
 expect(items[3].querySelector('.sender__to')?.textContent).toBe('to Lead');
 expect(items[3].querySelector('.bubble')?.textContent).toBe('Three ad sets, 30 days, EGP 9,000.');
 expect(items[4].querySelector('.sender__to')).toBeNull();
});

// #477: an asked Agent hands on. Writer asks Ads, outside the channel, and Ads asks Critic: each step is its own row with
// its answer, in order, put together from the record's rows as the channel's record is (handoverLines), then Writer's
// reply. A step handed on has no reply of its own: its answer goes to Ads, whose answer goes to Writer.
const stored = (id: number, from: string, to: string, goal: string, minutes: [string, string | null, string | null], words: { summary?: string, reply?: string } = {}): StoredHandover => ({
 id, message: 1, from_agent: from, from_name: from, from_connection: `c-${from}`, to_agent: to, to_name: to, to_connection: `c-${to}`, goal,
 summary: words.summary ?? null, reply: words.reply ?? null, state: 'done', target_outcome: 'completed',
 created_at: `2026-06-10T09:${minutes[0]}:00Z`, answered_at: minutes[1] && `2026-06-10T09:${minutes[1]}:00Z`, closed_at: minutes[2] && `2026-06-10T09:${minutes[2]}:00Z` });
for (const [language, first, second, toAds, toWriter] of [['en', 'Writer asked Ads', 'Ads asked Critic', 'to Ads', 'to Writer'], ['ar', 'Writer طلب من Ads', 'Ads طلب من Critic', 'لـ Ads', 'لـ Writer']] as const)
 test(`in ${language} every step of a chain of handovers is its own row with its answer, in order, in the channel`, async () => {
  vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
  const messages = inWrittenOrder([
   { id: 1, author: 'person', mine: true, name: 'Omar', role: 'owner', body: '@Writer the March post', at: '2026-06-10T09:05:00Z', files: [], mention: { agent: 'Writer', face: 'c-Writer', state: 'answered', permissions: [], questions: [] } },
   { id: 2, author: 'agent', name: 'Writer', face: 'c-Writer', body: 'I asked Ads for the numbers.', at: '2026-06-10T09:05:30Z' },
   ...handoverLines([
    stored(7, 'Writer', 'Ads', 'Last campaign\'s numbers', ['06', '09', '10'], { summary: 'February: 120 leads, checked by Critic.', reply: 'The post leads with 120 leads.' }),
    stored(8, 'Ads', 'Critic', 'Check the figures', ['07', '08', null], { summary: 'The figures check out.' })]),
  ]);
  const screen = await view(record(messages), language);
  const items = Array.from(screen.container.querySelectorAll('.turns > li')).filter(row => row.matches('[data-author="agent"], [data-handover]'));
  expect(items.map(row => row.matches('[data-handover]') ? `row:${row.querySelector('.handed__t')?.textContent}`
   : `${row.querySelector('.sender bdi')?.textContent}${row.querySelector('.sender__to') ? ` ${row.querySelector('.sender__to')?.textContent}` : ''}:${row.querySelector('.bubble')?.textContent}`)).toEqual([
   'Writer:I asked Ads for the numbers.',
   `row:${first}`,
   `row:${second}`,
   `Critic ${toAds}:The figures check out.`,
   `Ads ${toWriter}:February: 120 leads, checked by Critic.`,
   'Writer:The post leads with 120 leads.']);
 });

test('in Arabic the row and the sender line read in the interface\'s own words', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const messages: ChannelMessage[] = [
  { id: 1, author: 'person', mine: true, name: 'عمر', role: 'owner', body: 'يا Lead ظبط إعلانات مارس', at: '2026-06-10T09:05:00Z', files: [], mention: { agent: 'Lead', face: 'c-1', state: 'answered', permissions: [], questions: [] } },
  { id: 'handover-7', author: 'handoff', from: { name: 'Lead', face: 'c-1' }, to: { name: 'Ads', face: 'c-2' }, goal: 'خطة إعلانات مارس', at: '2026-06-10T09:06:00Z' },
  { id: 'handover-7-answer', author: 'agent', name: 'Ads', face: 'c-2', body: 'تلات مجموعات إعلانية، 30 يوم.', at: '2026-06-10T09:08:00Z', to: 'Lead' },
 ];
 const screen = await view(record(messages), 'ar');
 const turns = screen.getByRole('list', { name: 'الرسايل في #Launch week' }).element();
 expect(turns.querySelector('[data-handover]')?.textContent).toBe('Lead طلب من Adsخطة إعلانات مارس');
 expect(turns.querySelector('.sender__to')?.textContent).toBe('لـ Lead');
 expect(turns.querySelector('[data-handover] .gw-icon path')?.getAttribute('d')).toBe('M19 12H5');
});

// #375: a handover that did not finish says so on the channel's handoff row, after the job, in the interface's language,
// and Lead's reply after it still follows. One that finished says nothing of it.
for (const [language, line] of [['en', 'The job didn’t finish'], ['ar', 'الشغل ماخلصش']] as const) test(`in ${language} a handover that did not finish says so on its row`, async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const messages: ChannelMessage[] = [
  { id: 1, author: 'person', mine: true, name: 'Omar', role: 'owner', body: '@Lead plan the March ads', at: '2026-06-10T09:05:00Z', files: [], mention: { agent: 'Lead', face: 'c-1', state: 'answered', permissions: [], questions: [] } },
  { id: 'handover-7', author: 'handoff', from: { name: 'Lead', face: 'c-1' }, to: { name: 'Ads', face: 'c-2' }, goal: 'Plan the Meta ads', at: '2026-06-10T09:06:00Z', failed: true },
  { id: 'handover-7-reply', author: 'agent', name: 'Lead', face: 'c-1', body: 'Ads could not finish the plan.', at: '2026-06-10T09:30:00Z' },
  { id: 'handover-8', author: 'handoff', from: { name: 'Lead', face: 'c-1' }, to: { name: 'Ads', face: 'c-2' }, goal: 'Write the launch email', at: '2026-06-10T09:31:00Z' },
 ];
 const screen = await view(record(messages), language);
 const rows = Array.from(screen.container.querySelectorAll('.turns [data-handover]'));
 expect(rows.map(row => row.hasAttribute('data-failed'))).toEqual([true, false]);
 expect([...rows[0].children].map(part => part.className)).toEqual(['handed__faces', 'handed__t', 'handed__d', 'handed__failed']);
 expect(rows[0].querySelector('.handed__failed')?.textContent).toBe(line);
 expect(rows[0].querySelector('.handed__d')?.textContent).toBe('Plan the Meta ads');
 expect(rows[1].querySelector('.handed__failed')).toBeNull();
 expect(rows[0].nextElementSibling?.querySelector('.bubble')?.textContent).toBe('Ads could not finish the plan.');
});

// #375: the details' Handoffs list marks a handover that did not finish too, before its time.
test('the details mark a handover that did not finish, and leave a finished one as it was', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await view(record([], [{ ...handoff(9, 'Plan the Meta ads', '08'), failed: true }, handoff(8, 'Write the launch email', '04')]), 'ar');
 const rows = Array.from(screen.container.querySelectorAll('#ch-h-h ~ .panel-card .panel-row'));
 expect(rows.map(row => row.hasAttribute('data-failed'))).toEqual([true, false]);
 expect(rows[0].querySelector('.panel-row__d')?.textContent).toBe(`Plan the Meta ads · الشغل ماخلصش · ${timeOf('2026-06-10T09:08:00Z', 'ar')}`);
 expect(rows[1].querySelector('.handed__failed')).toBeNull();
});

// #428: a handover that ended with no reply because the Company has no model at all says so under its row, in the words
// a Conversation uses (#422): the Owner gets the way to Subscription and models, a Member is told to ask the Owner. A
// handover that ended otherwise draws no such line.
const noModelWords = {
 en: { line: 'This company has no AI subscription or model key connected yet, so its agents can’t reply.', connect: 'Connect one in Subscription and models', ask: 'Ask the company’s Owner to connect one in Settings.' },
 ar: { line: 'الشركة دي لسه مفيهاش اشتراك ذكاء اصطناعي ولا مفتاح موديل متوصّل، فالوكلاء مش هيقدروا يردّوا.', connect: 'وصّل واحد من الاشتراك والموديلات', ask: 'اطلب من مالك الشركة يوصّل واحد من الإعدادات.' },
} as const;
for (const language of ['en', 'ar'] as const) for (const owner of [true, false]) test(`in ${language} a handover that ended for want of a model tells ${owner ? 'the Owner where to connect one' : 'a Member to ask the Owner'} under its row`, async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const said = noModelWords[language];
 const asked: ChannelMessage = { id: 1, author: 'person', mine: true, name: 'Omar', role: 'owner', body: '@Lead plan the ads', at, files: [], mention: { agent: 'Lead', face: 'c-1', state: 'answered', permissions: [], questions: [] } };
 const answered: ChannelMessage = { id: 2, author: 'agent', name: 'Lead', face: 'c-1', body: 'Handing it to Ads.', at };
 const row = (id: number, noModel: boolean): ChannelMessage => ({ id: `handover-${id}`, author: 'handoff', from: { name: 'Lead', face: 'c-1' }, to: { name: 'Ads', face: 'c-2' }, goal: `Job ${id}`, at, ...(noModel ? { model: { cause: 'noModel' as const, agent: 'Ads' } } : {}) });
 const screen = await view(record([asked, answered, row(7, true), row(8, false)], [], { modelLine: { owner } }), language);
 const turns = Array.from(screen.container.querySelectorAll('.turns > li'));
 const handed = turns.findIndex(turn => turn.textContent?.includes('Job 7'));
 const line = turns[handed + 1];
 expect(line.getAttribute('role')).toBe('alert');
 expect(line.getAttribute('data-outcome')).toBe('no-model');
 expect(line.textContent).toContain(said.line);
 expect(turns[handed + 2].textContent).toContain('Job 8');
 expect(screen.container.querySelectorAll('[data-outcome="no-model"]').length).toBe(1);
 if (owner) {
  expect(line.querySelector('a')?.textContent).toBe(said.connect);
  expect(line.querySelector('a')?.getAttribute('href')).toBe('/c/rs-learning/settings?section=models');
  expect(line.textContent).not.toContain(said.ask);
 } else {
  expect(line.textContent).toContain(said.ask);
  expect(line.querySelector('a')).toBeNull();
 }
});

// #530: a handover whose leg the model refused, with no reply from the asking Agent, says that cause under its row and
// names the Agent whose leg it was: the Owner gets the way to the Agent's model, a Member is told to ask the Owner.
for (const owner of [true, false]) test(`a handover whose leg ran out of credit names its Agent under its row and tells ${owner ? 'the Owner where to fix it' : 'a Member to ask the Owner'}`, async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const asked: ChannelMessage = { id: 1, author: 'person', mine: true, name: 'Omar', role: 'owner', body: '@Lead plan the ads', at, files: [], mention: { agent: 'Lead', face: 'c-1', state: 'answered', permissions: [], questions: [] } };
 const row: ChannelMessage = { id: 'handover-7', author: 'handoff', from: { name: 'Lead', face: 'c-1' }, to: { name: 'Ads', face: 'c-2' }, goal: 'Job 7', at, failed: true, model: { cause: 'noCredit', agent: 'Ads' } };
 const screen = await view(record([asked, row], [], { modelLine: { owner } }), 'en');
 const turns = Array.from(screen.container.querySelectorAll('.turns > li'));
 const line = turns[turns.findIndex(turn => turn.textContent?.includes('Job 7')) + 1];
 expect(line.getAttribute('role')).toBe('alert');
 expect(line.getAttribute('data-outcome')).toBe('no-credit');
 expect(line.textContent).toContain('Ads could not reply: the company’s model key has no credit left.');
 if (owner) expect(line.querySelector('a')?.getAttribute('href')).toBe('/c/rs-learning/settings?section=models');
 else { expect(line.textContent).toContain('Ask the company’s Owner to check it in Settings.'); expect(line.querySelector('a')).toBeNull(); }
});

// #476: any Agent of the channel asks any Agent of the Company. In a channel whose one Agent is Writer, Writer asks Ads,
// which is not in the channel: the row names both with their faces, Ads's answer reads under its own name and face with
// "to Writer", then Writer's reply, and the details' Handoffs section lists it, in Arabic and English, light and dark
// (design-reference: the handoff row, `.handoff`, `.sender__to` and the details' handoffs).
const writer = { id: 'a-3', connection_id: 'c-3', name: 'Writer', speciality: 'Posts and articles', main: false, only: true, state: 'idle' as const };
const asked: ChannelMessage[] = [
 { id: 1, author: 'person', mine: true, name: 'Omar', role: 'owner', body: '@Writer write the launch post', at: '2026-06-10T09:05:00Z', files: [], mention: { agent: 'Writer', face: 'c-3', state: 'answered', permissions: [], questions: [] } },
 { id: 2, author: 'agent', name: 'Writer', face: 'c-3', body: 'I asked Ads for last campaign\'s numbers.', at: '2026-06-10T09:05:30Z' },
 { id: 'handover-9', author: 'handoff', from: { name: 'Writer', face: 'c-3' }, to: { name: 'Ads', face: 'c-2' }, goal: 'Last campaign\'s leads and cost per lead', at: '2026-06-10T09:06:00Z' },
 { id: 'handover-9-answer', author: 'agent', name: 'Ads', face: 'c-2', body: '412 leads at EGP 21 each.', at: '2026-06-10T09:08:00Z', to: 'Writer' },
 { id: 'handover-9-reply', author: 'agent', name: 'Writer', face: 'c-3', body: 'The post leads with 412 leads in March.', at: '2026-06-10T09:09:00Z' },
];
const askedHandoff: ChannelHandoff = { id: 9, from: { name: 'Writer', face: 'c-3' }, to: { name: 'Ads', face: 'c-2' }, goal: 'Last campaign\'s leads and cost per lead', at: '2026-06-10T09:06:00Z' };
for (const [language, line, to] of [['en', 'Writer asked Ads', 'to Writer'], ['ar', 'Writer طلب من Ads', 'لـ Writer']] as const)
 for (const theme of ['light', 'dark'] as const) test(`in ${language}, ${theme}, Writer asks Ads, an Agent outside the channel, whose answer reads under its own name and face to Writer`, async () => {
  vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
  document.documentElement.dataset.theme = theme;
  onTestFinished(() => { delete document.documentElement.dataset.theme; });
  const screen = await render(<div className="gw"><LanguageProvider language={language}><ChannelView slug="rs-learning" person="p-1" initial={record(asked, [askedHandoff], { agents: [writer] })}/></LanguageProvider></div>);
  const list = screen.container.querySelector('.turns')!;
  const row = list.querySelector('[data-handover]')!;
  expect(row.querySelector('.handed__t')?.textContent).toBe(line);
  expect(row.querySelector('.handed__d')?.textContent).toBe('Last campaign\'s leads and cost per lead');
  expect([...row.querySelectorAll('.agent-face')].map(face => face.getAttribute('aria-label'))).toEqual(['Writer', 'Ads']);
  const turns = [...list.querySelectorAll('.turn--agent')];
  expect(turns.map(turn => turn.querySelector('.sender bdi')?.textContent)).toEqual(['Writer', 'Ads', 'Writer']);
  // Ads wears the face the row draws for it, though it is not one of the channel's Agents, and says whom it answered.
  expect(turns[1].querySelector('.sender .agent-face')?.innerHTML).toBe(row.querySelectorAll('.agent-face')[1].innerHTML);
  expect(turns[1].querySelector('.sender__to')?.textContent).toBe(to);
  expect(turns[1].querySelector('.bubble')?.textContent).toBe('412 leads at EGP 21 each.');
  expect(turns[2].querySelector('.sender__to')).toBeNull();
  // The details list it under Handoffs with both faces and the same words.
  const listed = screen.container.querySelector('#ch-h-h ~ .panel-card .panel-row')!;
  expect(listed.querySelector('.panel-row__t')?.textContent).toBe(line);
  expect(listed.querySelectorAll('.agent-face').length).toBe(2);
  // The names read in the theme's first text colour, and the job and the "to" line in its quiet one.
  const [first, quiet] = theme === 'dark' ? ['rgb(245, 245, 245)', 'rgba(245, 245, 245, 0.6)'] : ['rgb(28, 28, 28)', 'rgba(28, 28, 28, 0.64)'];
  expect(getComputedStyle(row.querySelector('.handed__t bdi')!).color).toBe(first);
  expect(getComputedStyle(row.querySelector('.handed__d')!).color).toBe(quiet);
  expect(getComputedStyle(turns[1].querySelector('.sender__to')!).color).toBe(quiet);
 });
