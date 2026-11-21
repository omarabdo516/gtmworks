import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import ChannelView from '@/app/c/[slug]/channels/[id]/channel';
import { LanguageProvider } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import type { ChannelHandoff, ChannelMessage, ChannelRecord } from '@/lib/channels';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: React.ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('@/app/channel-actions', () => ({ changeChannel: vi.fn(), channelChoices: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); });

// #150: a channel's handovers, drawn from gtmworks's own record: the quiet row with both faces and the job, the other
// Agent's answer marked "to Lead", and the details' "Handoffs" section with its count and the last four, newest first.
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
  `Handed to AdsPlan the Meta ads for the March intake · ${timeOf('2026-06-10T09:08:00Z', 'en')}`,
  `Handed to AdsWrite the launch email · ${timeOf('2026-06-10T09:04:00Z', 'en')}`,
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
 expect(rows.map(row => row.querySelector('.panel-row__t')?.textContent)).toEqual(['Handed to Ads', 'Handed to Ads', 'Handed to Ads', 'Handed to Ads']);
 expect(rows.map(row => row.querySelector('.panel-row__d')?.textContent?.split(' · ')[0])).toEqual(['Job 6', 'Job 5', 'Job 4', 'Job 3']);
});

test('in Arabic the details read التسليمات with the same count and rows', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await view(record([], [handoff(9, 'خطة إعلانات مارس', '08'), handoff(8, 'إيميل الإطلاق', '04')]), 'ar');
 const details = screen.getByRole('complementary', { name: 'تفاصيل القناة' });
 expect(screen.container.querySelector('#ch-h-h')?.textContent).toBe('التسليمات 2');
 const rows = Array.from(screen.container.querySelectorAll('#ch-h-h ~ .panel-card .panel-row'));
 expect(rows.map(row => row.textContent)).toEqual([
  `سلّم الشغل لـ Adsخطة إعلانات مارس · ${timeOf('2026-06-10T09:08:00Z', 'ar')}`,
  `سلّم الشغل لـ Adsإيميل الإطلاق · ${timeOf('2026-06-10T09:04:00Z', 'ar')}`,
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
 expect(row.textContent).toBe('Handed to AdsPlan the Meta ads for the March intake');
 expect(row.querySelectorAll('.agent-face').length).toBe(2);
 expect(row.querySelector('.gw-icon path')?.getAttribute('d')).toBe('M5 12h14');
 expect(items[3].querySelector('.sender')?.textContent).toContain('Ads');
 expect(items[3].querySelector('.sender__to')?.textContent).toBe('to Lead');
 expect(items[3].querySelector('.bubble')?.textContent).toBe('Three ad sets, 30 days, EGP 9,000.');
 expect(items[4].querySelector('.sender__to')).toBeNull();
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
 expect(turns.querySelector('[data-handover]')?.textContent).toBe('سلّم الشغل لـ Adsخطة إعلانات مارس');
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
