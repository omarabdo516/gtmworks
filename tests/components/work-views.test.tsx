import { expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cdp, userEvent } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import type { WorkProps } from '@/app/c/[slug]/[[...section]]/work';
import { card, sent, showWork, workProps, workView } from './work-page';

const { push, toast } = vi.hoisted(() => ({ push: vi.fn(), toast: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board' }));
vi.mock('@/app/toast', () => ({ toast }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ decideAgentRule: vi.fn(), answerAgentRequest: vi.fn() }));
vi.mock('@/app/note-actions', () => ({ editNote: vi.fn() }));

// Card 1 is dated in November 2026; card 2 has no date, and a month filter keeps it.
const cards = [card({ go_live: '2026-11-12T12:00:00+00:00' }), card({ id: 2, title: 'Undated', go_live: null })];

test('the board\'s month filter hides a Card dated in another month and keeps an undated one; clearing it brings the Card back', async () => {
 const screen = await showWork(workProps({ cards }));
 const dated = () => document.querySelectorAll('#board-cols .kcard[data-card-id="1"]').length;
 expect(dated()).toBe(1);
 await userEvent.fill(screen.getByLabelText('Month'), '2000-01');
 await expect.poll(dated).toBe(0);
 expect(document.querySelectorAll('#board-cols .kcard[data-card-id="2"]')).toHaveLength(1);
 await userEvent.fill(screen.getByLabelText('Month'), '');
 await expect.poll(dated).toBe(1);
});

test('the List filters by month too, and a row\'s title opens its Card', async () => {
 const screen = await showWork(workProps({ section: 'work/list', cards }));
 const row = () => document.querySelectorAll('.table tbody tr a[href="/c/rs-learning/work/board/1"]').length;
 await expect.element(screen.getByRole('link', { name: 'أفكار لمحتوى الشهر' })).toHaveAttribute('href', '/c/rs-learning/work/board/1');
 await userEvent.fill(screen.getByLabelText('Month'), '2000-01');
 await expect.poll(row).toBe(0);
 await userEvent.fill(screen.getByLabelText('Month'), '');
 await expect.poll(row).toBe(1);
});

test('the Calendar shows a Card on its publishing day in its month, linking to the Card', async () => {
 const screen = await showWork(workProps({ section: 'work/calendar', cards }));
 await userEvent.fill(screen.getByLabelText('Month'), '2026-11');
 const link = screen.getByRole('link', { name: 'أفكار لمحتوى الشهر' });
 await expect.element(link).toHaveAttribute('href', '/c/rs-learning/work/board/1');
 expect(link.element().closest('.day')!.firstChild!.textContent).toBe('12');
});

test('Work settings name every stage\'s and every label\'s fields for what they change', async () => {
 const screen = await showWork(workProps({ section: 'settings/work' }));
 for (const name of ['Stage name أفكار', 'Stage order أفكار', 'Label name static', 'Label color static']) await expect.element(screen.getByLabelText(name, { exact: true })).toBeVisible();
});

// The board's six columns over the stages (ADR 0013): card 5 is in the review stage, which is Waiting on you, and waits
// for the reader's approval; card 1 is in أفكار, the Ideas column's one stage.
test('the board shows the six columns of the approved design, Waiting on you first, each Card in its stage\'s column', async () => {
 const screen = await showWork(workProps({ cards: [card(), card({ id: 5, title: 'Review the reel', stage_id: 4 })], approvableIds: [5] }));
 const columns = () => [...document.querySelectorAll('#board-cols > .col')].map(column => column.getAttribute('data-column'));
 expect(columns()).toEqual(['waiting', 'ideas', 'planned', 'progress', 'live', 'done']);
 await expect.element(screen.getByRole('heading', { level: 2, name: 'Waiting on you', exact: true })).toBeVisible();
 expect(document.querySelectorAll('.col[data-column="waiting"] .kcard[data-card-id="5"]')).toHaveLength(1);
 expect(document.querySelectorAll('.col[data-column="ideas"] .column[data-stage-name="أفكار"] .kcard[data-card-id="1"]')).toHaveLength(1);
});

// The Company's Agents (#190): Lead (main) and two Lead made, given in the sidebar's order. Cards 1 and 3 are Ads's,
// card 2 is SEO's, card 4 has no Agent; Ads and SEO both wrote on card 1. The old role agents still hold grants.
const lead = { id: 'h-lead', connection_id: 'c-lead', name: 'Lead', speciality: 'General', is_default: true };
const ads = { id: 'h-ads', connection_id: 'c-ads', name: 'Ads', speciality: 'Meta ads', is_default: false };
const seo = { id: 'h-seo', connection_id: 'c-seo', name: 'SEO', speciality: 'Search', is_default: false };
const crewBoard = (more: Partial<WorkProps> = {}) => workProps({
 cardAgents: [lead, ads, seo],
 agents: [{ person_id: 'ag-w', role: 'writer', granted: true }, { person_id: 'ag-d', role: 'designer', granted: true }],
 members: [{ person_id: 'ag-w', people: { name: 'Writer' } }, { person_id: 'ag-d', people: { name: 'Designer' } }],
 cards: [card({ agent_id: 'h-ads', crew: ['h-seo', 'h-ads'] }), card({ id: 2, title: 'Design', agent_id: 'h-seo', crew: ['h-seo'] }),
  card({ id: 3, title: 'Script', stage_id: 2, agent_id: 'h-ads' }), card({ id: 4, title: 'Untold', channel: 'Facebook' })],
 ...more,
});
const shown = () => [...document.querySelectorAll('#board-cols .kcard')].map(item => item.getAttribute('data-card-id')).sort();
const foot = (id: number) => document.querySelector(`#board-cols .kcard[data-card-id="${id}"] .kcard__foot`)!;

test('the chips are All and the Company\'s Agents, the main Agent first, and no old role agent', async () => {
 const screen = await showWork(crewBoard({ canCreate: false }));
 const tools = screen.getByRole('group', { name: 'Filter by agent' });
 expect(tools.getByRole('button').elements().map(chip => chip.textContent)).toEqual(['All', 'Lead', 'Ads', 'SEO']);
 expect(tools.getByRole('button').elements().slice(1).map(chip => chip.querySelector('.chip__face[aria-hidden="true"] .agent-face')?.getAttribute('aria-label'))).toEqual(['Lead', 'Ads', 'SEO']);
});

// Rewritten for #190 from "the Agent filter shows only that Agent's cards, and All brings the others back": the filter
// now follows a Card's own Agent, and still keeps one Agent's Cards and brings the rest back under All.
test('pressing an Agent\'s chip keeps only its Cards in every column and the focus on the chip; All shows every Card again', async () => {
 const screen = await showWork(crewBoard());
 const tools = screen.getByRole('group', { name: 'Filter by agent' });
 expect(shown()).toEqual(['1', '2', '3', '4']);
 await tools.getByRole('button', { name: 'Ads', exact: true }).click();
 await expect.element(tools.getByRole('button', { name: 'Ads', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await expect.element(tools.getByRole('button', { name: 'Ads', exact: true })).toHaveFocus();
 await expect.poll(shown).toEqual(['1', '3']);
 expect(document.querySelectorAll('.col[data-column="planned"] .kcard[data-card-id="3"]')).toHaveLength(1);
 await tools.getByRole('button', { name: 'Lead', exact: true }).click();
 await expect.poll(shown).toEqual([]);
 await tools.getByRole('button', { name: 'All', exact: true }).click();
 await expect.element(tools.getByRole('button', { name: 'All', exact: true })).toHaveFocus();
 await expect.poll(shown).toEqual(['1', '2', '3', '4']);
});

test('a Card\'s foot shows its Agent\'s face and name before the channel and the date; a Card with no Agent shows the channel and the date alone', async () => {
 await showWork(crewBoard());
 expect(foot(2).querySelector('.kcard__agent .agent-face')!.getAttribute('aria-label')).toBe('SEO');
 expect(foot(2).textContent).toBe('SEO· InstagramJun 4');
 expect(foot(4).querySelector('.kcard__agent')).toBeNull();
 expect(foot(4).textContent).toBe('FacebookJun 4');
});

test('a Card two Agents worked on carries both faces and "Worked on it", and says it in its name; a one-Agent Card has no crew line', async () => {
 const screen = await showWork(crewBoard());
 const crew = document.querySelector('#board-cols .kcard[data-card-id="1"] .kcard__crew')!;
 expect([...crew.querySelectorAll('.fstack[aria-hidden="true"] .agent-face')].map(face => face.getAttribute('aria-label'))).toEqual(['SEO', 'Ads']);
 expect(crew.querySelector('.kcard__crew-t')!.textContent).toBe('Worked on it: SEO, Ads');
 expect(crew.nextElementSibling).toBe(foot(1));
 await expect.element(screen.getByRole('link', { name: 'أفكار لمحتوى الشهر · Worked on it: SEO, Ads', exact: true })).toBeVisible();
 expect(document.querySelectorAll('#board-cols .kcard__crew')).toHaveLength(1);
 await expect.element(screen.getByRole('link', { name: 'Design', exact: true })).toBeVisible();
});

test('in Arabic the crew\'s names are joined as Arabic joins a list, each kept in its own direction', async () => {
 const screen = await showWork(crewBoard(), { language: 'ar' });
 const line = document.querySelector('#board-cols .kcard[data-card-id="1"] .kcard__crew-t')!;
 expect(line.textContent).toBe('اشتغل عليها: SEO، Ads');
 expect([...line.querySelectorAll('bdi')].map(name => name.textContent)).toEqual(['SEO', 'Ads']);
 await expect.element(screen.getByRole('link', { name: 'أفكار لمحتوى الشهر · اشتغل عليها: SEO، Ads', exact: true })).toBeVisible();
});

// #140: a step an Agent handed to the reader waits in Waiting on you: its Agent and time on top, then the tag (the hand
// in a small pill, its own width) before the step's title alone, and it opens the Conversation at the card.
test.each([['en', 'Handed to you'], ['ar', 'اتسلّمتلك']] as const)('in the %s interface, a handed step is tagged before its title and opens its Conversation at the card', async (language, tag) => {
 const hand = { kind: 'hand', id: 42, title: 'انشر المقال', body: '', asked_by: 'Writer', card_id: null, conversation_id: 'c-7', created_at: '2026-06-10T09:00:00Z' };
 await showWork(workProps({ waiting: [hand] }), { language });
 const item = document.querySelector<HTMLAnchorElement>('a.mcard[data-kind="hand"]')!;
 expect(item.getAttribute('href')).toBe('/c/rs-learning/conversations/c-7#hand-42');
 expect(item.closest('.col')!.getAttribute('data-column')).toBe('waiting');
 const wtag = item.querySelector('.wtag.wtag--hand')!;
 expect(wtag.textContent).toBe(tag);
 expect(wtag.querySelector('svg.gw-icon')!.getBoundingClientRect().width).toBe(13);
 expect(wtag.nextElementSibling!.className).toContain('mcard__q');
 expect(wtag.nextElementSibling!.textContent).toBe('انشر المقال');
 expect(item.querySelector('.mcard__who')!.textContent).toBe('Writer');
 expect(wtag.getBoundingClientRect().width).toBeLessThan(item.querySelector('.mcard__q')!.getBoundingClientRect().width);
 expect(getComputedStyle(wtag).borderRadius).not.toBe('0px');
});

// #165: a permission request waits on its person as an item of its own: its Agent's face and name on top, what it asks
// under them, and it opens the Conversation at its card, or a channel's request the channel.
test.each(['en', 'ar'] as const)('in the %s interface, a permission request names its Agent with its face and opens its chat at the card', async language => {
 const agent = { connection_id: 'c-ads', name: 'Ads' };
 const asked = { kind: 'permission', id: 51, title: 'delete the old exports', body: '', asked_by: 'Ads', card_id: null, conversation_id: 'c-7', created_at: '2026-06-10T09:00:00Z', agent };
 const inChannel = { ...asked, kind: 'channel_permission', id: 6, title: 'delete the old backups', conversation_id: null, channel_id: 'ch-1' };
 await showWork(workProps({ waiting: [asked, inChannel] }), { language });
 const item = document.querySelector<HTMLAnchorElement>('a.mcard[data-kind="permission"]')!;
 expect(item.closest('.col')!.getAttribute('data-column')).toBe('waiting');
 expect(item.getAttribute('href')).toBe('/c/rs-learning/conversations/c-7#permission-51');
 expect(item.querySelector('.mcard__who')!.textContent).toBe('Ads');
 expect(item.querySelector('.mcard__who .ln-who > [aria-hidden="true"] svg, .mcard__who .ln-who > [aria-hidden="true"] img')).not.toBeNull();
 expect(item.querySelector('.mcard__q')!.textContent).toBe('delete the old exports');
 const channel = document.querySelector<HTMLAnchorElement>('a.mcard[data-kind="channel_permission"]')!;
 expect(channel.getAttribute('href')).toBe('/c/rs-learning/channels/ch-1#permission-6');
 expect(channel.querySelector('.mcard__q')!.textContent).toBe('delete the old backups');
});

// #200: a Member named in a channel message waits alone under "Mentions of you": who mentioned them and where on top
// with their initial, then the message with the reader's own name marked, and it opens the channel at that message.
test.each(['en', 'ar'] as const)('in the %s interface a mention of the reader names who mentioned them and where, and opens the channel at the message', async language => {
 const mention = { kind: 'channel_mention', id: 61, title: 'Launch week', body: 'يا @Omar شوف الخطة', asked_by: 'Sara Adel', card_id: null, conversation_id: null,
  channel_id: 'ch-1', channel_message_id: 42, created_at: '2026-06-10T09:00:00Z' };
 await showWork(workProps({ waiting: [mention], members: [{ person_id: 'p-1', people: { name: 'Omar Abdo' } }, { person_id: 'p-2', people: { name: 'Sara Adel' } }] }), { language });
 const item = document.querySelector<HTMLAnchorElement>('a.mcard[data-kind="channel_mention"]')!;
 expect(item.getAttribute('href')).toBe('/c/rs-learning/channels/ch-1#mention-42');
 expect(item.closest('.col')!.getAttribute('data-column')).toBe('waiting');
 expect(item.querySelector('.mcard__top .mcard__av')!.textContent).toBe('S');
 expect(item.querySelector('.mcard__who b')!.textContent).toBe('Sara Adel');
 expect(item.querySelector('.mcard__who')!.textContent).toBe(language === 'ar' ? 'Sara Adel ذكرك في #Launch week' : 'Sara Adel mentioned you in #Launch week');
 expect([...item.querySelectorAll('.mcard__q .mention')].map(mark => mark.textContent)).toEqual(['@Omar']);
 expect(item.querySelector('.mcard__q')!.className).toContain('od-clamp-3');
 const group = item.closest('.mn-group')!;
 expect(group.querySelector('.mn-h')!.textContent).toBe(language === 'ar' ? 'اتذكرت فيها 1' : 'Mentions of you 1');
});

// #200: a mention in the general channel names it in the reader's language, as the sidebar does.
test.each([['en', 'Sara Adel mentioned you in #general'], ['ar', 'Sara Adel ذكرك في #عام']] as const)('in the %s interface a mention in the general channel names it in that language', async (language, line) => {
 const mention = { kind: 'channel_mention', id: 62, title: 'general', body: 'يا @Omar', asked_by: 'Sara Adel', card_id: null, conversation_id: null,
  channel_id: 'ch-0', channel_message_id: 43, created_at: '2026-06-10T09:00:00Z' };
 await showWork(workProps({ waiting: [mention], members: [{ person_id: 'p-1', people: { name: 'Omar Abdo' } }] }), { language });
 expect(document.querySelector('a.mcard[data-kind="channel_mention"] .mcard__who')!.textContent).toBe(line);
});

// #200: the Inbox ("Waiting on you" as its own list) draws the reader's mentions at the top, under "Mentions of you" with
// their count, above what needs their reply, as the board's column does.
test('the Inbox puts the reader\'s mentions under "Mentions of you", above what needs their reply', async () => {
 const mention = { kind: 'channel_mention', id: 61, title: 'Launch week', body: 'يا @Omar شوف الخطة', asked_by: 'Sara Adel', card_id: null, conversation_id: null,
  channel_id: 'ch-1', channel_message_id: 42, created_at: '2026-06-10T09:00:00Z' };
 const step = { kind: 'test_kind', id: 7, title: 'A step that waits', body: '', asked_by: 'Lead', card_id: null, conversation_id: null, created_at: '2026-06-10T09:30:00Z' };
 await showWork(workProps({ focus: 'waiting', waiting: [step, mention], members: [{ person_id: 'p-1', people: { name: 'Omar Abdo' } }] }));
 const column = document.querySelector('.col[data-column="waiting"]')!;
 const group = column.querySelector('.mn-group')!;
 expect(group.querySelector('.mn-h')!.textContent).toBe('Mentions of you 1');
 expect(group.querySelector('a.mcard[data-kind="channel_mention"]')).not.toBeNull();
 expect(group.querySelector('.mn-sep')).not.toBeNull();
 const entries = [...column.querySelectorAll(':is(.kcard,.mcard)')];
 expect(entries.map(entry => entry.getAttribute('data-kind'))).toEqual(['channel_mention', 'test_kind']);
});

// #146: Card 9 is In progress (stage كتابة), tied to Omar's chat with Ads, whose handed step waits on him. Waiting on you
// draws it once, with the badge and line for whoever reads it (design-reference: kcardHTML's waiting branch, waitTagHTML).
const members = [{ person_id: 'p-1', people: { name: 'Omar Abdo' } }, { person_id: 'p-2', people: { name: 'Sara' } }];
const handed = { kind: 'hand', id: 42, title: 'انشر المقال', body: '', asked_by: 'Ads', card_id: 9, conversation_id: 'c-9', created_at: '2026-06-10T09:00:00Z' };
const chatCard = (kind: 'hand' | 'question' = 'hand') => card({ id: 9, title: 'مقال المحاسبة', stage_id: 3, wait: { person: 'p-1', kind, title: kind === 'hand' ? 'انشر المقال' : 'Which audience first?' } });
const readers: ['en' | 'ar', string, string, { me: string, waiting?: (typeof handed)[], canCreate?: boolean }][] = [
 ['en', 'the chat\'s person', 'Waiting on you', { me: 'p-1', waiting: [handed] }],
 ['ar', 'the chat\'s person', 'مستنيك', { me: 'p-1', waiting: [handed] }],
 ['en', 'another Contributor', 'Waiting on Omar', { me: 'p-2' }],
 ['ar', 'another Contributor', 'مستني Omar', { me: 'p-2' }],
 ['en', 'a Viewer', 'Waiting on the team', { me: 'p-4', canCreate: false }],
 ['ar', 'a Viewer', 'مستني الفريق', { me: 'p-4', canCreate: false }],
];
test.each(readers)('in the %s interface, %s reads a Card whose chat waits under Waiting on you once, with its tag, "%s" and the step\'s title, its stage kept', async (language, _, badge, reader) => {
 await showWork(workProps({ cards: [chatCard()], members, ...reader }), { language });
 const drawn = document.querySelectorAll('#board-cols .kcard[data-card-id="9"]');
 expect(drawn).toHaveLength(1);
 const kcard = drawn[0];
 expect(kcard.closest('.col')!.getAttribute('data-column')).toBe('waiting');
 expect(kcard.getAttribute('data-stage-id')).toBe('3');
 expect(document.querySelectorAll('a.mcard')).toHaveLength(0);
 const waiting = document.querySelector('.col[data-column="waiting"]')!;
 expect(waiting.querySelector('.col__count')!.textContent).toBe('1');
 expect(document.querySelector('.col[data-column="progress"] .col__count')!.textContent).toBe('0');
 const [tag, shown, line] = [...kcard.children].slice(1);
 expect([tag.className, tag.textContent]).toEqual(['wtag wtag--hand', language === 'ar' ? 'اتسلّمتلك' : 'Handed to you']);
 expect(tag.getBoundingClientRect().width).toBeLessThan(line.getBoundingClientRect().width);
 const mine = reader.me === 'p-1';
 expect(shown.className).toBe(mine ? 'badge badge--wait' : 'badge');
 expect(shown.textContent).toBe(badge);
 expect(!!shown.querySelector('.dot.dot--waiting')).toBe(mine);
 expect(!!shown.querySelector('svg')).toBe(!mine);
 expect([line.className, line.textContent]).toEqual(['kcard__t', 'انشر المقال']);
});

test('a question waiting in the chat reads as its question with no tag, and the Card is back In progress once nothing waits', async () => {
 const screen = await showWork(workProps({ cards: [chatCard('question')], members, waiting: [{ ...handed, kind: 'question', id: 43, title: 'Which audience first?' }] }));
 const kcard = () => document.querySelector('#board-cols .kcard[data-card-id="9"]')!;
 expect(kcard().closest('.col')!.getAttribute('data-column')).toBe('waiting');
 expect(kcard().querySelector('.wtag')).toBeNull();
 expect(kcard().querySelector('.kcard__t')!.textContent).toBe('Which audience first?');
 await screen.rerender(workView(workProps({ cards: [card({ id: 9, title: 'مقال المحاسبة', stage_id: 3, wait: null })], members })));
 await expect.poll(() => kcard().closest('.col')!.getAttribute('data-column')).toBe('progress');
 expect(kcard().getAttribute('data-stage-id')).toBe('3');
 expect(kcard().querySelector('.badge')).toBeNull();
});

// The Card's chat and its approval count it once, in the column and in the board's own summary.
test('a Card that both waits for the reader\'s approval and holds their chat\'s question and hand is counted once', async () => {
 const rows = [{ ...handed, kind: 'approval', id: 9, conversation_id: null }, handed, { ...handed, kind: 'question', id: 43 }];
 await showWork(workProps({ cards: [chatCard()], members, approvableIds: [9], waiting: rows }));
 expect(document.querySelectorAll('#board-cols .kcard[data-card-id="9"]')).toHaveLength(1);
 expect(document.querySelector('.col[data-column="waiting"] .col__count')!.textContent).toBe('1');
 expect(document.querySelector('.board-tools__summary')!.textContent).toBe('1 things waiting on you');
});

// On the reader's own list (/approvals) the Card stands for its chat's rows too, and a chat with no Card keeps its item.
test('the reader\'s own Waiting on you draws a Card whose chat waits once, in place of its question and hand, beside the item of a chat with no Card', async () => {
 const rows = [handed, { ...handed, kind: 'question', id: 43 }, { ...handed, id: 44, card_id: null, conversation_id: 'c-10' }];
 await showWork(workProps({ cards: [chatCard()], members, waiting: rows, focus: 'waiting' }));
 const column = document.querySelector('.col[data-column="waiting"]')!;
 expect(column.querySelectorAll('.kcard[data-card-id="9"]')).toHaveLength(1);
 expect([...column.querySelectorAll('a.mcard')].map(item => item.getAttribute('href'))).toEqual(['/c/rs-learning/conversations/c-10#hand-44']);
 expect(column.querySelector('.col__count')!.textContent).toBe('2');
});

// A filter that leaves the Card out leaves its chat's step drawn on its own, as before #146, and counted once.
test('a hand whose Card a filter leaves off the board is drawn as its own row, and every count names what is drawn once', async () => {
 const screen = await showWork(workProps({ cards: [chatCard()], members, waiting: [handed] }));
 const column = () => document.querySelector('.col[data-column="waiting"]')!;
 const rows = () => [...column().querySelectorAll('a.mcard')].map(item => item.getAttribute('href'));
 const counts = () => [column().querySelector('.col__count')!.textContent, document.querySelector('.board-tools__summary')!.textContent];
 expect(column().querySelectorAll('.kcard[data-card-id="9"]')).toHaveLength(1);
 expect([rows(), counts()]).toEqual([[], ['1', '1 things waiting on you']]);
 await userEvent.fill(screen.getByLabelText('Month'), '2000-01');
 await expect.poll(rows).toEqual(['/c/rs-learning/conversations/c-9#hand-42']);
 expect(document.querySelectorAll('#board-cols .kcard[data-card-id="9"]')).toHaveLength(0);
 expect(counts()).toEqual(['1', '1 things waiting on you']);
 await userEvent.fill(screen.getByLabelText('Month'), '');
 await expect.poll(rows).toEqual([]);
 expect(column().querySelectorAll('.kcard[data-card-id="9"]')).toHaveLength(1);
 expect(counts()).toEqual(['1', '1 things waiting on you']);
});

// As a Card waiting on a decision: the drop and Shift+Arrow are refused, say so and open the Card; nothing is sent.
test('a Card whose chat waits leaves Waiting on you by its answer: a mouse drop elsewhere and Shift+Arrow open it and move nothing', async () => {
 push.mockClear(); toast.mockClear();
 const props = workProps({ cards: [chatCard()], members, waiting: [handed] });
 await showWork(props);
 const from = document.querySelector('.kcard[data-card-id="9"]')!.getBoundingClientRect();
 const to = document.querySelector('.col[data-column="ideas"]')!.getBoundingClientRect();
 const mouse = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, y: number) => cdp().send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
 await mouse('mousePressed', from.left + from.width / 2, from.top + 20);
 for (let step = 1; step <= 10; step++) await mouse('mouseMoved', from.left + from.width / 2 + (to.left + to.width / 2 - from.left - from.width / 2) * step / 10, from.top + 20 + (to.top + 40 - from.top - 20) * step / 10);
 await mouse('mouseReleased', to.left + to.width / 2, to.top + 40);
 await expect.poll(() => toast.mock.calls).toEqual([['This card is waiting on its chat. Once it’s answered or done there, the card moves back on its own', { icon: 'hand' }]]);
 expect(push.mock.calls).toEqual([['/c/rs-learning/work/board/9']]);
 document.querySelector<HTMLElement>('.kcard[data-card-id="9"] a')!.focus();
 await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
 expect(toast).toHaveBeenCalledTimes(2);
 expect(push.mock.calls).toEqual([['/c/rs-learning/work/board/9'], ['/c/rs-learning/work/board/9']]);
 expect(sent(props)).toEqual([]);
 expect(document.querySelector('.kcard[data-card-id="9"]')!.closest('.col')!.getAttribute('data-column')).toBe('waiting');
});

// design-reference: syncWaitMarks. The board's first read is the baseline; a Card that starts waiting on the reader after
// it shakes its badge once, though it is drawn again in another column, and a later read does not shake it again.
test('the badge of a Card that starts waiting on the reader shakes once, and not on the first read or the next', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 try {
  const before = workProps({ cards: [card({ id: 9, title: 'مقال المحاسبة', stage_id: 3 }), card({ id: 5, title: 'Review the reel', stage_id: 4 })], members, approvableIds: [5] });
  const screen = await showWork(before);
  const badge = (id: number) => document.querySelector(`.kcard[data-card-id="${id}"] .badge`)!;
  expect(badge(5).className).toBe('badge badge--wait');
  const after = { ...before, cards: [chatCard(), before.cards[1]], waiting: [handed] };
  await screen.rerender(workView(after));
  await expect.poll(() => badge(9)?.className).toBe('badge badge--wait is-new');
  expect(getComputedStyle(badge(9)).animationName).toBe('gw-nudge');
  expect(badge(5).className).toBe('badge badge--wait');
  vi.advanceTimersByTime(1200);
  await expect.poll(() => badge(9).className).toBe('badge badge--wait');
  await screen.rerender(workView({ ...after, items: [] }));
  expect(badge(9).className).toBe('badge badge--wait');
  await userEvent.fill(screen.getByLabelText('Month'), '2000-01');
  await expect.poll(() => document.querySelector('.kcard[data-card-id="9"]')).toBeNull();
  await userEvent.fill(screen.getByLabelText('Month'), '');
  await expect.poll(() => badge(9)?.className).toBe('badge badge--wait');
 } finally { vi.useRealTimers(); }
});

// A Card that leaves waiting and waits again keeps its mark the full 1200ms from its second start.
test('a Card that waits again soon after its first nudge keeps its second one for its full time', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 try {
  const idle = workProps({ cards: [card({ id: 9, title: 'مقال المحاسبة', stage_id: 3 })], members });
  const waits = { ...idle, cards: [chatCard()], waiting: [handed] };
  const screen = await showWork(idle);
  const badge = () => document.querySelector('.kcard[data-card-id="9"] .badge');
  await screen.rerender(workView(waits));
  await expect.poll(() => badge()?.className).toBe('badge badge--wait is-new');
  vi.advanceTimersByTime(600);
  await screen.rerender(workView(idle));
  await expect.poll(badge).toBeNull();
  await screen.rerender(workView(waits));
  await expect.poll(() => badge()?.className).toBe('badge badge--wait is-new');
  vi.advanceTimersByTime(600);
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(badge()!.className).toBe('badge badge--wait is-new');
  vi.advanceTimersByTime(600);
  await expect.poll(() => badge()!.className).toBe('badge badge--wait');
 } finally { vi.useRealTimers(); }
});
