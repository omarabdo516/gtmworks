import { expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cdp, userEvent } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import type { WorkProps } from '@/app/c/[slug]/[[...section]]/work';
import type { CompanyLooks } from '@/lib/agent-looks';
import { card, placed, sent, showWork, workProps, workView } from './work-page';

const { push, toast } = vi.hoisted(() => ({ push: vi.fn(), toast: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board' }));
vi.mock('@/app/toast', () => ({ toast }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ decideAgentRule: vi.fn(), answerAgentRequest: vi.fn() }));
vi.mock('@/app/note-actions', () => ({ editNote: vi.fn() }));

// Card 1 is dated in November 2026, card 3 in December 2026; card 2 has no date, and a month filter keeps it.
const cards = [card({ go_live: '2026-11-12T12:00:00+00:00' }), card({ id: 2, title: 'Undated', go_live: null }), card({ id: 3, title: 'December card', go_live: '2026-12-01T12:00:00+00:00' })];

// #683: the board's toolbar has search in place of the Month filter (design-reference-card: bf-q); the List and the
// Calendar keep their month.
test('the board\'s search keeps the Cards whose title holds what is typed, and Escape clears it', async () => {
 const screen = await showWork(workProps({ cards }));
 const drawn = () => [...document.querySelectorAll('#board-cols .kcard')].map(item => item.getAttribute('data-card-id')).sort();
 expect(drawn()).toEqual(['1', '2', '3']);
 await screen.getByRole('button', { name: 'Search cards' }).click();
 await userEvent.keyboard('december');
 await expect.poll(drawn).toEqual(['3']);
 await userEvent.keyboard('{Escape}');
 await expect.poll(drawn).toEqual(['1', '2', '3']);
 expect(screen.container.querySelector('select[aria-label="Month"]')).toBeNull();
});

test('the List filters by month too, and a row\'s title opens its Card', async () => {
 const screen = await showWork(workProps({ section: 'work/list', cards }));
 const row = (id: number) => document.querySelectorAll(`.table tbody tr a[href="/c/rs-learning/work/board?card=${id}"]`).length;
 await expect.element(screen.getByRole('link', { name: 'أفكار لمحتوى الشهر' })).toHaveAttribute('href', '/c/rs-learning/work/board?card=1');
 await userEvent.selectOptions(screen.getByLabelText('Month'), '2026-12');
 await expect.poll(() => row(1)).toBe(0);
 expect(row(3)).toBe(1);
 await userEvent.selectOptions(screen.getByLabelText('Month'), '');
 await expect.poll(() => row(1)).toBe(1);
});

test('the Calendar shows a Card on its publishing day in its month, linking to the Card', async () => {
 const screen = await showWork(workProps({ section: 'work/calendar', cards }));
 await userEvent.fill(screen.getByLabelText('Month'), '2026-11');
 const link = screen.getByRole('link', { name: 'أفكار لمحتوى الشهر' });
 await expect.element(link).toHaveAttribute('href', '/c/rs-learning/work/board?card=1');
 expect(link.element().closest('.day')!.firstChild!.textContent).toBe('12');
});

// The board's six columns (ADR 0013, ADR 0026): card 5 is Waiting on you, for the reader's approval; card 1 is in Ideas.
test('the board shows the six columns of the approved design, Waiting on you first, each Card in its status\'s column', async () => {
 const screen = await showWork(workProps({ cards: [card(), card({ id: 5, title: 'Review the reel', status: 'waiting' })], approvableIds: [5] }));
 const columns = () => [...document.querySelectorAll('#board-cols > .col')].map(column => column.getAttribute('data-column'));
 expect(columns()).toEqual(['waiting', 'ideas', 'planned', 'progress', 'live', 'done']);
 await expect.element(screen.getByRole('heading', { level: 2, name: 'Waiting on you', exact: true })).toBeVisible();
 expect(document.querySelectorAll('.col[data-column="waiting"] .kcard[data-card-id="5"]')).toHaveLength(1);
 expect(document.querySelectorAll('.col[data-column="ideas"] .kcard[data-card-id="1"]')).toHaveLength(1);
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
  card({ id: 3, title: 'Script', status: 'planned', agent_id: 'h-ads' }), card({ id: 4, title: 'Untold' })],
 ...more,
});
const shown = () => [...document.querySelectorAll('#board-cols .kcard')].map(item => item.getAttribute('data-card-id')).sort();
const foot = (id: number) => document.querySelector(`#board-cols .kcard[data-card-id="${id}"] .kcard__foot`)!;

// #683: who a Card is on is one menu (design-reference-card: bf-who): everyone, the reader, no one, the Company's
// Agents and the Members who may be assignees.
test('the assignee menu offers Everyone, Me, No one, the Company\'s Agents and its Members, and keeps the Cards of the one chosen', async () => {
 const screen = await showWork(crewBoard({ cards: [...crewBoard().cards, card({ id: 5, title: 'Mine', agent_id: null, assignee_agent: null, assignee_person: 'p-1' })],
  members: [{ person_id: 'p-1', role: 'owner', people: { name: 'Omar' } }, { person_id: 'p-2', role: 'contributor', people: { name: 'Sara' } }] }));
 const menu = screen.getByRole('button', { name: 'Assignee: Everyone' });
 await menu.click();
 expect(screen.getByRole('menuitemradio').elements().map(item => item.querySelector('.menu__t')!.textContent)).toEqual(['Everyone', 'Me', 'No one', 'Lead', 'Ads', 'SEO', 'Sara']);
 await screen.getByRole('menuitemradio', { name: 'Ads' }).click();
 await expect.poll(shown).toEqual(['1', '3']);
 await expect.element(screen.getByRole('button', { name: 'Assignee: Ads' })).toHaveFocus();
 await screen.getByRole('button', { name: 'Assignee: Ads' }).click();
 await screen.getByRole('menuitemradio', { name: 'Me' }).click();
 await expect.poll(shown).toEqual(['5']);
 await screen.getByRole('button', { name: 'Clear filters' }).click();
 await expect.poll(shown).toEqual(['1', '2', '3', '4', '5']);
});

// #683: a tile shows its title and one state symbol, then the assignee's face and only the counts above zero, and says
// all of it in its name (design-reference-card: kcardHTML).
test('a tile shows its title, its assignee\'s face, its date and the counts above zero, and says all of it in its name', async () => {
 const screen = await showWork(crewBoard({
  cards: [card({ agent_id: 'h-ads', description: '- [x] Hook\n- [ ] Caption', go_live: '2026-06-04T12:00:00+00:00' }), card({ id: 4, title: 'Untold', agent_id: null, assignee_agent: null, go_live: null })],
  attachments: [{ id: 1, card_id: 1, comment_id: null, name: 'brief.pdf', content_type: 'application/pdf' }],
  activity: [{ id: 1, card_id: 1, action: 'comment_added', details: {}, created_at: '2026-06-01T10:00:00Z', actor_id: 'p-1', evidence: null }, { id: 2, card_id: 1, action: 'comment_added', details: {}, created_at: '2026-06-01T11:00:00Z', actor_id: 'p-1', evidence: null }] }));
 expect(foot(1).querySelector<HTMLElement>('.kt-face .face')!.dataset.agent).toBe(ads.id);
 expect([...foot(1).querySelectorAll('.kt-metas > *')].map(meta => meta.textContent)).toEqual(['Jun 4', '1', '2', '1/2']);
 expect(foot(4).querySelector('.kt-face .cw-noone')).not.toBeNull();
 expect(foot(4).querySelector('.kt-metas')).toBeNull();
 await expect.element(screen.getByRole('link', { name: 'أفكار لمحتوى الشهر · Ideas · Assignee: Ads · Publishing date Jun 4 · 1 file · 2 comments · 1 of 2 to-do items done', exact: true })).toBeVisible();
 await expect.element(screen.getByRole('link', { name: 'Untold · Ideas · Assignee: No one', exact: true })).toBeVisible();
 expect(document.querySelector('#board-cols .kcard__crew, #board-cols .kcard__t, #board-cols .badge')).toBeNull();
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
 const agent = { id: 'a-ads', name: 'Ads' };
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
const chatCard = (kind: 'hand' | 'question' = 'hand') => card({ id: 9, title: 'مقال المحاسبة', status: 'progress', wait: { person: 'p-1', kind, title: kind === 'hand' ? 'انشر المقال' : 'Which audience first?' } });
const readers: ['en' | 'ar', string, string, { me: string, waiting?: (typeof handed)[], canCreate?: boolean }][] = [
 ['en', 'the chat\'s person', 'Waiting on you', { me: 'p-1', waiting: [handed] }],
 ['ar', 'the chat\'s person', 'مستنيك', { me: 'p-1', waiting: [handed] }],
 ['en', 'another Contributor', 'Waiting on Omar', { me: 'p-2' }],
 ['ar', 'another Contributor', 'مستني Omar', { me: 'p-2' }],
 ['en', 'a Viewer', 'Waiting on the team', { me: 'p-4', canCreate: false }],
 ['ar', 'a Viewer', 'مستني الفريق', { me: 'p-4', canCreate: false }],
];
test.each(readers)('in the %s interface, %s reads a Card whose chat waits under Waiting on you once, as one question symbol named in it (not "%s")', async (language, _, oldBadge, reader) => {
 await showWork(workProps({ cards: [chatCard()], members, ...reader }), { language });
 const drawn = document.querySelectorAll('#board-cols .kcard[data-card-id="9"]');
 expect(drawn).toHaveLength(1);
 const kcard = drawn[0];
 expect(kcard.closest('.col')!.getAttribute('data-column')).toBe('waiting');
 expect(document.querySelectorAll('a.mcard')).toHaveLength(0);
 expect(document.querySelector('.col[data-column="waiting"] .col__count')!.textContent).toBe('1');
 expect(document.querySelector('.col[data-column="progress"] .col__count')!.textContent).toBe('0');
 // One symbol says it (#683): the question, named in the tile's own name; no badge says it again.
 expect(kcard.querySelector('.kt-syms .sym[data-sym="question"][aria-hidden="true"]')).not.toBeNull();
 expect(kcard.querySelector('.badge, .wtag')).toBeNull();
 expect(kcard.querySelector('a.kcard__title')!.getAttribute('aria-label')).toContain(language === 'ar' ? 'عنده سؤال' : 'Has a question');
 expect(kcard.textContent).not.toContain(oldBadge);
});

test('a question waiting in the chat shows the question symbol, and the Card is back In progress with none once nothing waits', async () => {
 const screen = await showWork(workProps({ cards: [chatCard('question')], members, waiting: [{ ...handed, kind: 'question', id: 43, title: 'Which audience first?' }] }));
 const kcard = () => document.querySelector('#board-cols .kcard[data-card-id="9"]')!;
 expect(kcard().closest('.col')!.getAttribute('data-column')).toBe('waiting');
 expect(kcard().querySelector('.sym[data-sym="question"]')).not.toBeNull();
 await screen.rerender(workView(workProps({ cards: [card({ id: 9, title: 'مقال المحاسبة', status: 'progress', wait: null })], members })));
 await expect.poll(() => kcard().closest('.col')!.getAttribute('data-column')).toBe('progress');
 expect(kcard().querySelector('.kt-syms')).toBeNull();
});

// The Card's chat and its approval count it once, in the column and in the board's own summary.
test('a Card that both waits for the reader\'s approval and holds their chat\'s question and hand is counted once', async () => {
 const rows = [{ ...handed, kind: 'approval', id: 9, conversation_id: null }, handed, { ...handed, kind: 'question', id: 43 }];
 await showWork(workProps({ cards: [chatCard()], members, approvableIds: [9], waiting: rows }));
 expect(document.querySelectorAll('#board-cols .kcard[data-card-id="9"]')).toHaveLength(1);
 expect(document.querySelector('.col[data-column="waiting"] .col__count')!.textContent).toBe('1');
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
test('a hand whose Card a filter leaves off the board is drawn as its own row, and the column counts what is drawn once', async () => {
 const screen = await showWork(workProps({ cards: [chatCard(), card({ id: 7, title: 'December card', status: 'ideas', go_live: '2026-12-01T12:00:00+00:00' })], members, waiting: [handed] }));
 const column = () => document.querySelector('.col[data-column="waiting"]')!;
 const rows = () => [...column().querySelectorAll('a.mcard')].map(item => item.getAttribute('href'));
 const count = () => column().querySelector('.col__count')!.textContent;
 expect(column().querySelectorAll('.kcard[data-card-id="9"]')).toHaveLength(1);
 expect([rows(), count()]).toEqual([[], '1']);
 await screen.getByRole('button', { name: 'Search cards' }).click();
 await userEvent.keyboard('December');
 await expect.poll(rows).toEqual(['/c/rs-learning/conversations/c-9#hand-42']);
 expect(document.querySelectorAll('#board-cols .kcard[data-card-id="9"]')).toHaveLength(0);
 expect(count()).toBe('1');
 await userEvent.keyboard('{Escape}');
 await expect.poll(rows).toEqual([]);
 expect(column().querySelectorAll('.kcard[data-card-id="9"]')).toHaveLength(1);
 expect(count()).toBe('1');
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
 expect(push.mock.calls).toEqual([['/c/rs-learning/work/board?card=9', { scroll: false }]]);
 document.querySelector<HTMLElement>('.kcard[data-card-id="9"] a')!.focus();
 await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
 expect(toast).toHaveBeenCalledTimes(2);
 expect(push.mock.calls).toEqual([['/c/rs-learning/work/board?card=9', { scroll: false }], ['/c/rs-learning/work/board?card=9', { scroll: false }]]);
 expect(sent(props)).toEqual([]);
 expect(placed(props)).toEqual([]);
 expect(document.querySelector('.kcard[data-card-id="9"]')!.closest('.col')!.getAttribute('data-column')).toBe('waiting');
});

// design-reference: syncWaitMarks. The board's first read is the baseline; a Card that starts waiting on the reader after
// it shakes its badge once, though it is drawn again in another column, and a later read does not shake it again.
test('the symbol of a Card that starts waiting on the reader shakes once, and not on the first read or the next', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 try {
  const before = workProps({ cards: [card({ id: 9, title: 'مقال المحاسبة', status: 'progress' }), card({ id: 5, title: 'Review the reel', status: 'waiting' }), card({ id: 7, title: 'December card', status: 'ideas', go_live: '2026-12-01T12:00:00+00:00' })], members, approvableIds: [5] });
  const screen = await showWork(before);
  const mark = (id: number) => document.querySelector(`.kcard[data-card-id="${id}"] .kt-syms`)!;
  expect(mark(5).className).toBe('kt-syms');
  const after = { ...before, cards: [chatCard(), before.cards[1], before.cards[2]], waiting: [handed] };
  await screen.rerender(workView(after));
  await expect.poll(() => mark(9)?.className).toBe('kt-syms is-new');
  expect(getComputedStyle(mark(9).querySelector('.sym')!).animationName).toBe('gw-nudge');
  expect(mark(5).className).toBe('kt-syms');
  vi.advanceTimersByTime(1200);
  await expect.poll(() => mark(9).className).toBe('kt-syms');
  await screen.rerender(workView({ ...after }));
  expect(mark(9).className).toBe('kt-syms');
 } finally { vi.useRealTimers(); }
});

// A Card that leaves waiting and waits again keeps its mark the full 1200ms from its second start.
test('a Card that waits again soon after its first nudge keeps its second one for its full time', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 try {
  const idle = workProps({ cards: [card({ id: 9, title: 'مقال المحاسبة', status: 'progress' })], members });
  const waits = { ...idle, cards: [chatCard()], waiting: [handed] };
  const screen = await showWork(idle);
  const mark = () => document.querySelector('.kcard[data-card-id="9"] .kt-syms');
  await screen.rerender(workView(waits));
  await expect.poll(() => mark()?.className).toBe('kt-syms is-new');
  vi.advanceTimersByTime(600);
  await screen.rerender(workView(idle));
  await expect.poll(mark).toBeNull();
  await screen.rerender(workView(waits));
  await expect.poll(() => mark()?.className).toBe('kt-syms is-new');
  vi.advanceTimersByTime(600);
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(mark()!.className).toBe('kt-syms is-new');
  vi.advanceTimersByTime(600);
  await expect.poll(() => mark()!.className).toBe('kt-syms');
 } finally { vi.useRealTimers(); }
});

// #169: a decided learning suggestion comes back to the board in the address, which names the item and never its Agent:
// the toast names the Agent the page read, and both flags leave the address so a reload does not say it again.
test('a decided suggestion is said once with the Agent\'s name the page read, and its flags leave the address', async () => {
 const start = location.pathname + location.search;
 history.replaceState(history.state, '', '/c/rs-learning/approvals?decided=reject&item=7');
 toast.mockClear();
 try {
  await showWork(workProps({ section: 'work/board', focus: 'waiting', waiting: [], ruleDecision: { approve: false, agent: 'Ads' } }));
  await expect.poll(() => toast.mock.calls).toEqual([['Ads won’t save it', { icon: 'x' }]]);
  await expect.poll(() => new URL(location.href).search).toBe('');
  // A reload of the clean address says nothing, even while the page is drawn with an outcome again.
  toast.mockClear();
  await showWork(workProps({ section: 'work/board', focus: 'waiting', waiting: [] }));
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(toast).not.toHaveBeenCalled();
 } finally { history.replaceState(history.state, '', start); }
});

// #677: the bell holds the reader's own list: the Cards they can act on, the Cards assigned to them (which stay in their
// columns), the requests and the mentions, and its number is its rows. A Viewer has no bell.
test('the bell counts its rows and lists the Card to act on, the Cards assigned to the reader, a request and a mention, each opening what it names', async () => {
 const at = '2026-06-01T00:00:00Z';
 const waiting = [
  { kind: 'approval', id: 1, title: 'أفكار لمحتوى الشهر', body: 'Owner review', asked_by: '', card_id: 1, conversation_id: null, created_at: at },
  { kind: 'agent_request', id: 40, title: 'Ads', body: 'Runs the ads', asked_by: 'Sara', card_id: null, conversation_id: null, created_at: at },
  { kind: 'mention', id: 50, title: 'Script', body: '@Omar look', asked_by: 'Sara', card_id: 3, conversation_id: null, created_at: at },
 ];
 const assigned = [{ id: 1, title: 'أفكار لمحتوى الشهر', status: 'waiting' }, { id: 3, title: 'Script', status: 'planned' }];
 const props = workProps({ cards: [card({ status: 'waiting' }), card({ id: 3, title: 'Script', status: 'planned', assignee_person: 'p-1' })], waiting, assigned, approvableIds: [1] });
 const screen = await showWork(props);
 const bell = screen.getByRole('button', { name: 'Waiting on you: 4', exact: true });
 await expect.element(bell).toHaveTextContent('4');
 // Nothing says it twice (#683): the bell alone counts what waits.
 expect(document.querySelector('.board-tools__summary')).toBeNull();
 expect(document.querySelector('#board-cols .kcard[data-card-id="3"]')!.closest('[data-column]')?.getAttribute('data-column'), 'a Card assigned to the reader stays in its column').toBe('planned');
 await bell.click();
 const menu = screen.getByRole('menu', { name: 'Waiting on you: 4' });
 await expect.element(menu.getByRole('menuitem').first()).toHaveFocus();
 const groups = [...menu.element().querySelectorAll('[role="group"]')].map(group => [group.getAttribute('aria-label'), [...group.querySelectorAll('[role="menuitem"]')].map(row => [row.textContent, row.getAttribute('href')])]);
 expect(groups).toEqual([
  ['Stopped at an Agent', [['أفكار لمحتوى الشهر', '/c/rs-learning/work/board?card=1']]],
  ['Assigned to you', [['ScriptPlanned', '/c/rs-learning/work/board?card=3']]],
  ['Requests waiting for your answer', [['AdsSara', '/c/rs-learning/approvals']]],
  ['Mentions of you', [['ScriptSara', '/c/rs-learning/work/board?card=3']]],
 ]);
 await userEvent.keyboard('{Escape}');
 await expect.element(bell).toHaveFocus();
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
});

test('an empty bell says nothing waits, and a Viewer has no bell', async () => {
 const screen = await showWork(workProps({ waiting: [], assigned: [] }));
 await screen.getByRole('button', { name: 'Waiting on you: 0', exact: true }).click();
 await expect.element(screen.getByRole('menu')).toHaveTextContent('Nothing waiting on you');
 screen.unmount();
 await showWork(workProps({ canCreate: false }));
 expect(document.querySelector('.waiting-bell')).toBeNull();
});
