import { afterEach, expect, test, vi } from 'vitest';
import { use, type ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import ConversationView, { ConversationLoaded } from '@/app/c/[slug]/conversations/[id]/conversation';
import { LanguageProvider } from '@/lib/i18n-client';
import { conversationRecord, type ConversationRecord } from '@/lib/conversation-record';
import '@/app/tokens.css';
import '@/app/shell.css';
// The loaded chat once its record is read, as the page streams it.
const Arrived = ({ record, team }: { record: Promise<ConversationRecord>, team: boolean }) => <ConversationLoaded initial={use(record)} team={team}/>;

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/conversation-archive-actions', () => ({ archiveConversations: vi.fn() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { vi.unstubAllGlobals(); });
// The record as the server hands it over once it is read: React's use() takes a promise it can see is settled at once.
const arrived = (record: ConversationRecord) => Object.assign(Promise.resolve(record), { status: 'fulfilled', value: record });

// Two Runs of the Contributor's chat with Ads, as the database holds them, and the Card the first one put on the board
// when its reply came (or none, or one the chat was started from, made before it), read through the same record the
// page and its route read.
const at = '2026-06-10T09:41:00Z';
const stored = {
 conversation_run_ends: [{ run_id: 'r1', outcome: 'completed' }, { run_id: 'r2', outcome: 'completed' }],
 conversation_messages: [
  { id: 1, author: 'person', author_name: 'Youssef', body: 'Plan the June campaign', run_id: 'r1', created_at: at },
  { id: 2, author: 'agent', author_name: 'Ads', body: 'On it: audience first.', run_id: 'r1', created_at: at },
  { id: 3, author: 'person', author_name: 'Youssef', body: 'Add a teaser', run_id: 'r2', created_at: at },
  { id: 4, author: 'agent', author_name: 'Ads', body: 'Added.', run_id: 'r2', created_at: at },
 ],
 people: [{ name: 'Youssef' }],
};
const replied = '2026-06-10T09:42:00Z';
type TiedCard = { id: number, column: string, made?: string, wait?: { person: string, kind: 'question' | 'hand', title: string } };
// A handover as conversation_handovers answers it (#475): both Agents named, the job, how far it got and its answer.
type StoredHandover = { id: number, run: string, from_agent: string, from_name: string, from_connection: string, to_agent: string, to_name: string, to_connection: string, goal: string, answer: string | null,
 state: string, target_outcome: string | null, answers_person: boolean, created_at: string, answered_at: string | null };
function database(card: TiedCard | null, messages: typeof stored = stored, agent_handovers: StoredHandover[] = [], snapshot: { id: number, state: string }[] = agent_handovers) {
 // The messages and how their runs ended are read through the Conversation, in one statement (lib/conversation-record.ts).
 const { conversation_run_ends, conversation_messages, ...rest } = messages;
 const rows: Record<string, unknown[]> = { ...rest, conversations: [{ conversation_run_ends, conversation_messages, conversation_queued_turns: [], lead_agent_requests: [], lead_made_agents: [], agent_handovers: snapshot }], work_cards: card ? [{ id: card.id, created_at: card.made ?? replied, stage_id: 3, wait: card.wait ?? null, work_stages: { id: 3, board_column: card.column } }] : [] };
 const table = (name: string) => {
  const found = rows[name] ?? [];
  const query: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => resolve({ data: found, error: null }), maybeSingle: async () => ({ data: found[0] ?? null, error: null }) };
  for (const method of ['select', 'eq', 'is', 'not', 'in', 'order']) query[method] = () => query;
  return query;
 };
 return { from: table, rpc: async (name: string) => ({ data: name === 'conversation_handovers' ? agent_handovers : null, error: null }) } as unknown as Parameters<typeof conversationRecord>[0];
}
const recordWith = (card: TiedCard | null) => conversationRecord(database(card), 'p-3', 'co-1', { id: 'cv-1', agent_id: null, agent_name: 'Ads', hermes_agents: { connection_id: 'c-1' } });
// #147: a chat with Lead, whose Card only a handover makes. The person's message comes first, the Card when Lead's reply
// hands the job over, Lead's reply of that Run, then the follow-up reply the handover's answer is.
const at0 = '2026-06-10T09:41:00Z';
const leadStored = {
 conversation_run_ends: [{ run_id: 'r1', outcome: 'completed' }, { run_id: 'r9', outcome: 'completed' }],
 conversation_messages: [
  { id: 1, author: 'person', author_name: 'Youssef', body: 'Plan the March intake', run_id: 'r1', created_at: at0 },
  { id: 2, author: 'agent', author_name: 'Lead', body: 'That is Ads’s work: I handed it over.', run_id: 'r1', created_at: '2026-06-10T09:41:05Z' },
  { id: 3, author: 'agent', author_name: 'Lead', body: 'Ads planned the March intake.', run_id: 'r9', created_at: '2026-06-10T09:42:10Z' },
 ],
 people: [{ name: 'Youssef' }],
};
const leadRecordWith = (card: TiedCard | null) => conversationRecord(database(card, leadStored), 'p-3', 'co-1', { id: 'cv-9', agent_id: 'a-lead', agent_name: 'Lead', hermes_agents: { connection_id: 'c-0', is_default: true } });
// The page reads the chat's Card beside the record and hands it to the frame, as here.
const view = (record: ConversationRecord, { language = 'en', writer = true }: { language?: 'en' | 'ar', writer?: boolean } = {}) => <LanguageProvider language={language}>
 <div className="gw"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={record.conversation} title="" writer={writer} board={record.board}><Arrived record={arrived(record)} team={false}/></ConversationView></div>
</LanguageProvider>;
const show = (...args: Parameters<typeof view>) => render(view(...args));
const pill = () => document.querySelector<HTMLElement>('.corner-pill');

test('the chat says once, under the Agent\'s first reply, that its Card went on the board, and its corner opens that Card on the board', async () => {
 await page.viewport(1440, 900);
 const screen = await show(await recordWith({ id: 7, column: 'progress' }));
 const turns = [...document.querySelectorAll('.turns > li')].map(row => `${row.getAttribute('data-author') ?? ''}:${row.getAttribute('data-kind') ?? ''}`);
 expect(turns).toEqual(['person:', 'agent:', ':boarded', 'person:', 'agent:']);
 await expect.element(screen.getByText('This card was added to the board under “In progress”')).toBeVisible();
 const link = screen.getByRole('link', { name: 'On the board: In progress' });
 await expect.element(link).toHaveAttribute('href', '/c/rs-learning/work/board?show=7');
 await expect.element(link.getByText('On the board:')).toBeVisible();
 await expect.element(link.getByText('In progress')).toBeVisible();
 expect(pill()!.className).toBe('corner-pill');
 expect(pill()!.querySelector('.dot')!.className).toBe('dot dot--idle');
 // The reference's motion: colours and the press ease over the fast duration, and a press gives a little.
 const motion = getComputedStyle(pill()!);
 expect(motion.transitionProperty).toBe('background-color, box-shadow, color, border-color, transform');
 expect(motion.transitionDuration).toBe('0.15s, 0.15s, 0.15s, 0.15s, 0.15s');
 expect(new Set(motion.transitionTimingFunction.split(/,\s*(?=cubic)/))).toEqual(new Set(['cubic-bezier(0.2, 0, 0, 1)']));
});

test('a chat started from its Card (#145) has the pill but no line, since the Card was on the board before it', async () => {
 const screen = await show(await recordWith({ id: 7, column: 'progress', made: '2026-06-09T08:00:00Z' }));
 await expect.element(screen.getByRole('link', { name: 'On the board: In progress' })).toBeVisible();
 expect(document.querySelectorAll('.turns > li[data-kind="boarded"]')).toHaveLength(0);
 expect(document.querySelectorAll('.turns > li')).toHaveLength(4);
});

test('a chat with Lead whose Card a handover made says so once, under the handover\'s answer', async () => {
 await page.viewport(1440, 900);
 const screen = await show(await leadRecordWith({ id: 9, column: 'progress', made: '2026-06-10T09:41:02Z' }));
 // The line follows the follow-up reply the handover's answer is, never Lead's reply that handed the job over.
 const turns = [...document.querySelectorAll('.turns > li')].map(row => `${row.getAttribute('data-author') ?? ''}:${row.getAttribute('data-kind') ?? ''}`);
 expect(turns).toEqual(['person:', 'agent:', 'agent:', ':boarded']);
 await expect.element(screen.getByText('This card was added to the board under “In progress”')).toBeVisible();
 await expect.element(screen.getByRole('link', { name: 'On the board: In progress' })).toBeVisible();
});

// #477: a chain that comes back to the chat's own Agent (Lead asks Ads, Ads asks Lead) leaves Lead's follow-up its own:
// the line still goes under it, and Lead's messages keep Lead's face.
test('a chain that asks the chat\'s own Agent back still puts the board line under its follow-up reply', async () => {
 await page.viewport(1440, 900);
 const messages = { ...leadStored, conversation_messages: leadStored.conversation_messages.map(message => message.author === 'agent' ? { ...message, agent_id: 'a-lead' } : message) };
 const chain = [
  { id: 1, run: 'r1', from_agent: 'a-lead', from_name: 'Lead', from_connection: 'c-0', to_agent: 'a-ads', to_name: 'Ads', to_connection: 'c-3', goal: 'Plan the Meta ads', answer: 'Three ad sets.', state: 'done', target_outcome: 'completed', answers_person: false, created_at: '2026-06-10T09:41:03Z', answered_at: '2026-06-10T09:42:00Z', parent: null },
  { id: 2, run: 'run-ads', from_agent: 'a-ads', from_name: 'Ads', from_connection: 'c-3', to_agent: 'a-lead', to_name: 'Lead', to_connection: 'c-0', goal: 'Say the budget', answer: 'EGP 9,000.', state: 'done', target_outcome: 'completed', answers_person: false, created_at: '2026-06-10T09:41:20Z', answered_at: '2026-06-10T09:41:40Z', parent: 1 },
 ];
 const record = await conversationRecord(database({ id: 9, column: 'progress', made: '2026-06-10T09:41:02Z' }, messages, chain), 'p-3', 'co-1', { id: 'cv-9', agent_id: 'a-lead', agent_name: 'Lead', hermes_agents: { connection_id: 'c-0', is_default: true } });
 const boarded = record.messages.findIndex(message => message.kind === 'boarded');
 expect(record.messages[boarded - 1]?.body).toBe('Ads planned the March intake.');
 expect(record.messages.filter(message => message.author === 'agent' && !message.kind).map(message => message.face ?? null)).toEqual([null, null]);
});

// #375: the record says a handover did not finish when its target's leg ended without a report, though Lead followed it
// up, or when the handover itself ended failed; one that finished says nothing of it, and none of them keeps the chat
// asking. The row under Lead's reply then says the job did not finish.
const handedTo = (state: string, target_outcome: string | null): StoredHandover => ({ id: 1, run: 'r1', from_agent: 'a-lead', from_name: 'Lead', from_connection: 'c-0', to_agent: 'a-ads', to_name: 'Ads', to_connection: 'c-3',
 goal: 'Plan the Meta ads for the March intake', answer: null, state, target_outcome, answers_person: false, created_at: '2026-06-10T09:41:03Z', answered_at: null });
const handedRecord = (handover: StoredHandover) => conversationRecord(database(null, leadStored, [handover]), 'p-3', 'co-1', { id: 'cv-9', agent_id: 'a-lead', agent_name: 'Lead', hermes_agents: { connection_id: 'c-0', is_default: true } });
const handedCard = (record: ConversationRecord) => record.messages.flatMap(message => message.cards ?? []).find(card => card.kind === 'handed');
test('the record marks a handover that did not finish, whichever leg ended it, and leaves a finished one unmarked', async () => {
 for (const [state, outcome, failed] of [['done', 'completed', false], ['done', 'failed', true], ['done', 'stopped', true], ['done', 'lost', true], ['failed', 'completed', true], ['failed', 'failed', true]] as const) {
  const record = await handedRecord(handedTo(state, outcome));
  expect(handedCard(record), `${state}/${outcome}`).toEqual({ kind: 'handed', from: { name: 'Lead', face: 'a-lead' }, name: 'Ads', face: 'a-ads', goal: 'Plan the Meta ads for the March intake', ...(failed ? { failed: true } : {}) });
  expect(record.handover, `${state}/${outcome}`).toBeUndefined();
 }
 const moving = await handedRecord(handedTo('target', null));
 expect(handedCard(moving)).not.toHaveProperty('failed');
 expect(moving.handover).toBe(true);
});

// #475: the handovers are drawn from conversation_handovers, a read of its own, but whether one is still moving comes from
// the same snapshot as the messages. A follow-up that closed between the two reads (done there, its reply not yet read
// with the messages) keeps the chat asking, so the asking Agent's reply is never left out until a reload.
test('a handover read as done after the messages were read still keeps the chat asking for its reply', async () => {
 const record = await conversationRecord(database(null, leadStored, [handedTo('done', 'completed')], [{ id: 1, state: 'follow_up' }]), 'p-3', 'co-1', { id: 'cv-9', agent_id: 'a-lead', agent_name: 'Lead', hermes_agents: { connection_id: 'c-0', is_default: true } });
 expect(record.handover).toBe(true);
});

test('a handover that did not finish says so under Lead\'s reply, read through the record the page reads', async () => {
 const screen = await show(await handedRecord(handedTo('done', 'failed')));
 const row = screen.container.querySelector('.turn--agent [data-handover]');
 expect(row?.hasAttribute('data-failed')).toBe(true);
 expect(row?.querySelector('.handed__failed')?.textContent).toBe('The job didn’t finish');
});

test('a chat with no Card on the board has no pill and no line', async () => {
 const screen = await show(await recordWith(null));
 await expect.element(screen.getByText('Added.')).toBeVisible();
 expect(document.querySelectorAll('.turns > li')).toHaveLength(4);
 expect(pill()).toBeNull();
});

test('a Card waiting on a decision reads "Waiting on you" for its writer and "Waiting on the team" for a reader who cannot write', async () => {
 const record = await recordWith({ id: 7, column: 'waiting' });
 const screen = await show(record);
 await expect.element(screen.getByRole('link', { name: 'On the board: Waiting on you' })).toBeVisible();
 expect(pill()!.className).toBe('corner-pill is-waiting');
 expect(pill()!.querySelector('.dot')!.className).toBe('dot dot--waiting');
 await screen.rerender(view(record, { writer: false }));
 await expect.element(screen.getByRole('link', { name: 'On the board: Waiting on the team' })).toBeVisible();
});

// #146: the chat's handed step waits on its person while its Card stays In progress; the pill turns to its waiting state
// and shakes once as it does (design-reference: renderChat's pill, syncWaitMarks), and names its column again after.
test('while its chat waits on its person the pill reads "Waiting on you" and shakes once, "Waiting on the team" for a reader who cannot write, and its column again after', async () => {
 const wait = { person: 'p-3', kind: 'hand', title: 'انشر المقال' } as const;
 const answers = [{ ...await recordWith({ id: 7, column: 'progress', wait }), pending: false }, { ...await recordWith({ id: 7, column: 'progress' }), pending: false }];
 // Each reply's steps (#766) are their own read, answered as none: only the record's reads take the answers.
 vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('&intent=steps') ? Response.json({ steps: {}, usage: null }) : Response.json(answers.shift())));
 const record = await recordWith({ id: 7, column: 'progress' });
 const screen = await show(record);
 await expect.element(screen.getByRole('link', { name: 'On the board: In progress' })).toBeVisible();
 window.dispatchEvent(new Event('focus'));
 await expect.element(screen.getByRole('link', { name: 'On the board: Waiting on you' })).toBeVisible();
 expect(pill()!.className).toBe('corner-pill is-waiting is-new');
 expect(pill()!.querySelector('.dot')!.className).toBe('dot dot--waiting');
 const shake = getComputedStyle(pill()!);
 expect([shake.animationName, shake.animationDuration, shake.animationTimingFunction]).toEqual(['gw-nudge', '0.52s', 'cubic-bezier(0.2, 0, 0, 1)']);
 await screen.rerender(view(record, { writer: false }));
 await expect.element(screen.getByRole('link', { name: 'On the board: Waiting on the team' })).toBeVisible();
 window.dispatchEvent(new Event('focus'));
 await expect.element(screen.getByRole('link', { name: 'On the board: In progress' })).toBeVisible();
 expect(pill()!.className).toBe('corner-pill');
});

test('a chat opened while it waits reads "Waiting on you" from the start, with no shake', async () => {
 const screen = await show(await recordWith({ id: 7, column: 'progress', wait: { person: 'p-3', kind: 'question', title: 'Which audience first?' } }), { language: 'ar' });
 await expect.element(screen.getByRole('link', { name: 'على اللوحة: مستنيك' })).toBeVisible();
 expect(pill()!.className).toBe('corner-pill is-waiting');
});

test('on a phone the pill shows the column alone, in Arabic too', async () => {
 await page.viewport(390, 844);
 try {
  const screen = await show(await recordWith({ id: 7, column: 'progress' }), { language: 'ar' });
  const link = screen.getByRole('link', { name: 'على اللوحة: شغالين عليه' });
  await expect.element(link.getByText('شغالين عليه')).toBeVisible();
  await expect.element(link.getByText('على اللوحة:')).not.toBeVisible();
  await expect.element(screen.getByText('البطاقة دي اتضافت للوحة في «شغالين عليه»')).toBeVisible();
  expect(pill()!.getBoundingClientRect().height).toBe(36);
 } finally { await page.viewport(1440, 900); }
});

test('coming back to the chat after the Card moved on the board shows its new column, and only that', async () => {
 // An answer older than the chat on screen (it left before the last message was sent) moves the pill and nothing else.
 const moved = { ...await recordWith({ id: 7, column: 'live' }), pending: false };
 moved.messages = moved.messages.slice(0, 2);
 const asks = vi.fn(async () => Response.json(moved));
 vi.stubGlobal('fetch', asks);
 const screen = await show(await recordWith({ id: 7, column: 'progress' }));
 await expect.element(screen.getByRole('link', { name: 'On the board: In progress' })).toBeVisible();
 window.dispatchEvent(new Event('focus'));
 await expect.element(screen.getByRole('link', { name: 'On the board: Live' })).toBeVisible();
 expect(asks).toHaveBeenCalledWith('/api/conversations?company=co-1&conversation=cv-1', { cache: 'no-store' });
 await expect.element(screen.getByText('This card was added to the board under “In progress”')).toBeVisible();
 await expect.element(screen.getByText('Added.')).toBeVisible();
});
