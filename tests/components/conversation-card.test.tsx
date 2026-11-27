import { afterEach, expect, test, vi } from 'vitest';
import { use, type ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
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

// Two Runs of the Contributor's chat with Ads, as the database holds them, read through the same record the page and its
// route read. The old board is switched off (#846): a chat names no Card of it, with no line and no corner pill.
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
// A handover as conversation_handovers answers it (#475): both Agents named, the job, how far it got and its answer.
type StoredHandover = { id: number, run: string, from_agent: string, from_name: string, from_connection: string, to_agent: string, to_name: string, to_connection: string, goal: string, answer: string | null,
 state: string, target_outcome: string | null, answers_person: boolean, created_at: string, answered_at: string | null };
function database(messages: typeof stored = stored, agent_handovers: StoredHandover[] = [], snapshot: { id: number, state: string }[] = agent_handovers, read: string[] = []) {
 // The messages and how their runs ended are read through the Conversation, in one statement (lib/conversation-record.ts).
 const { conversation_run_ends, conversation_messages, ...rest } = messages;
 const rows: Record<string, unknown[]> = { ...rest, conversations: [{ conversation_run_ends, conversation_messages, conversation_queued_turns: [], lead_agent_requests: [], lead_made_agents: [], agent_handovers: snapshot }] };
 const table = (name: string) => {
  read.push(name);
  const found = rows[name] ?? [];
  const query: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => resolve({ data: found, error: null }), maybeSingle: async () => ({ data: found[0] ?? null, error: null }) };
  for (const method of ['select', 'eq', 'is', 'not', 'in', 'order']) query[method] = () => query;
  return query;
 };
 return { from: table, rpc: async (name: string) => ({ data: name === 'conversation_handovers' ? agent_handovers : null, error: null }) } as unknown as Parameters<typeof conversationRecord>[0];
}
// #147: a chat with Lead that hands a job over: the person's message, Lead's reply of that Run, then the follow-up reply
// the handover's answer is.
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
// #375: the record says a handover did not finish when its target's leg ended without a report, though Lead followed it
// up, or when the handover itself ended failed; one that finished says nothing of it, and none of them keeps the chat
// asking. The row under Lead's reply then says the job did not finish.
const handedTo = (state: string, target_outcome: string | null): StoredHandover => ({ id: 1, run: 'r1', from_agent: 'a-lead', from_name: 'Lead', from_connection: 'c-0', to_agent: 'a-ads', to_name: 'Ads', to_connection: 'c-3',
 goal: 'Plan the Meta ads for the March intake', answer: null, state, target_outcome, answers_person: false, created_at: '2026-06-10T09:41:03Z', answered_at: null });
const handedRecord = (handover: StoredHandover) => conversationRecord(database(leadStored, [handover]), 'p-3', 'co-1', { id: 'cv-9', agent_id: 'a-lead', agent_name: 'Lead', hermes_agents: { connection_id: 'c-0', is_default: true } });
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
 const record = await conversationRecord(database(leadStored, [handedTo('done', 'completed')], [{ id: 1, state: 'follow_up' }]), 'p-3', 'co-1', { id: 'cv-9', agent_id: 'a-lead', agent_name: 'Lead', hermes_agents: { connection_id: 'c-0', is_default: true } });
 expect(record.handover).toBe(true);
});

test('a handover that did not finish says so under Lead\'s reply, read through the record the page reads', async () => {
 const screen = await show(await handedRecord(handedTo('done', 'failed')));
 const row = screen.container.querySelector('.turn--agent [data-handover]');
 expect(row?.hasAttribute('data-failed')).toBe(true);
 expect(row?.querySelector('.handed__failed')?.textContent).toBe('The job didn’t finish');
});

// The page hands the frame the Conversation; its record arrives after (#172).
const view = (record: ConversationRecord, { language = 'en', writer = true }: { language?: 'en' | 'ar', writer?: boolean } = {}) => <LanguageProvider language={language}>
 <div className="gw"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={record.conversation} title="" writer={writer}><Arrived record={arrived(record)} team={false}/></ConversationView></div>
</LanguageProvider>;
const show = (...args: Parameters<typeof view>) => render(view(...args));

test('a chat names no Card of the old board: no line, no pill, and none of its tables is read', async () => {
 const read: string[] = [];
 const record = await conversationRecord(database(stored, [], [], read), 'p-3', 'co-1', { id: 'cv-1', agent_id: null, agent_name: 'Ads', hermes_agents: { connection_id: 'c-1' } });
 const screen = await show(record);
 await expect.element(screen.getByText('Added.')).toBeVisible();
 expect(document.querySelectorAll('.turns > li')).toHaveLength(4);
 expect(document.querySelector('.corner-pill')).toBeNull();
 expect(read.filter(name => name.startsWith('work_'))).toEqual([]);
});
