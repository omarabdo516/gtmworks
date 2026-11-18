import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { use, type ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import ConversationView, { ConversationLoaded } from '@/app/c/[slug]/conversations/[id]/conversation';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ConversationRecord } from '@/lib/conversation-record';
import { latestEnded, shown, type AgentRequestView } from '@/lib/conversations';
import '@/app/shell.css';
// The loaded chat once its record is read, as the page streams it.
const Arrived = ({ record, team }: { record: Promise<ConversationRecord>, team: boolean }) => <ConversationLoaded initial={use(record)} team={team}/>;

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
// The record as the server hands it over once it is read: React's use() takes a promise it can see is settled at once.
const arrived = (record: ConversationRecord) => Object.assign(Promise.resolve(record), { status: 'fulfilled', value: record });

const at = '2026-06-10T09:41:00Z';
const reason = 'Ads follows WhatsApp leads now.';
const asked = { id: 7, name: 'FollowUp', job: 'Follows up the WhatsApp leads.', apps: ['WhatsApp Business'], askedBy: 'Youssef', askedWith: 'The leads go cold' };
const record = (request: AgentRequestView, decided: ConversationRecord['messages'] = []): ConversationRecord => ({
 conversation: { id: 'cv-1', agent_id: null, agent_name: 'Lead', face: 'c-1' },
 messages: [
  { id: 1, author: 'person', author_name: 'Youssef', body: 'The leads go cold', created_at: at },
  { id: 2, author: 'agent', author_name: 'Lead', body: 'I prepared your request and sent it to the Owner.', created_at: at, cards: [{ kind: 'request', request }] },
  ...decided,
 ],
 usage: { input: 0, output: 0, unknown: 0 }, pending: false, failed: false, working: null, canStop: false,
});
const waiting = record({ ...asked, state: 'waiting', owners: ['Omar'] });
const declined = record({ ...asked, state: 'declined', by: 'Omar', at, reason },
 [{ id: 0, author: 'agent', author_name: 'Lead', body: '', created_at: at, kind: 'decided', decided: { kind: 'request', by: 'Omar', name: 'FollowUp', at, made: false, reason } }]);

test('a Member who keeps their Conversation open sees the Owner\'s answer arrive, and the page stops asking once nothing waits', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const answers = [waiting, declined];
 const asks = vi.fn(async () => Response.json(answers.shift() ?? declined));
 vi.stubGlobal('fetch', asks);
 const screen = await render(<LanguageProvider language="en"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={waiting.conversation} title="" writer={false}><Arrived record={arrived(waiting)} team={false}/></ConversationView></LanguageProvider>);
 const request = screen.getByRole('group', { name: 'Agent request: FollowUp' });
 await expect.element(request.getByText('Request · not made yet')).toBeVisible();

 await vi.advanceTimersByTimeAsync(500);
 expect(asks).toHaveBeenCalledTimes(1);
 await expect.element(request.getByText('Request · not made yet')).toBeVisible();

 await vi.advanceTimersByTimeAsync(5000);
 expect(asks).toHaveBeenCalledTimes(2);
 await expect.element(request.getByText('Omar said no')).toBeVisible();
 expect(request.element().textContent).toContain(`Reason: «${reason}»`);

 await vi.advanceTimersByTimeAsync(30000);
 expect(asks).toHaveBeenCalledTimes(2);
});

const talk = (messages: ConversationRecord['messages'], more: Partial<ConversationRecord> = {}): ConversationRecord => ({
 conversation: { id: 'cv-2', agent_id: null, agent_name: 'Mona', face: 'c-2' }, messages, usage: { input: 0, output: 0, unknown: 0 }, pending: false, failed: false, working: null, canStop: false, ...more,
});
const view = (initial: ConversationRecord, language: 'en' | 'ar' = 'en') => <LanguageProvider language={language}><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={initial.conversation} title="" writer><Arrived record={arrived(initial)} team={false}/></ConversationView></LanguageProvider>;
const sent = { id: 1, author: 'person' as const, author_name: 'Omar', body: 'Draft the long launch plan', created_at: at };

test('while the Agent works the page says so, and the line goes once the reply is in the record', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(talk([sent, { id: 2, author: 'agent', author_name: 'Mona', body: 'Reply to: Draft the long launch plan', created_at: at }]))));
 const screen = await render(view(talk([sent], { pending: true })));
 await expect.element(screen.getByRole('status')).toHaveTextContent('Mona is working on a reply…');
 await vi.advanceTimersByTimeAsync(500);
 await expect.element(screen.getByText('Reply to: Draft the long launch plan')).toBeVisible();
 await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
});

test('a message whose run the engine no longer knows is marked lost', async () => {
 const screen = await render(view(talk([{ ...sent, lost: true }], { failed: true })));
 const turn = screen.getByRole('list', { name: 'Messages' }).getByRole('listitem').filter({ hasText: 'Draft the long launch plan' });
 await expect.element(turn.getByText('Lost: the agent engine no longer has this reply.')).toBeVisible();
});

// #158: a message that waited its turn and was refused by the Engine for the Conversation's model is told as a sent one
// is, with the model line under the composer and the message back in the box; a turn refused for any other reason
// keeps its own line by the message, and once a later message follows, the model line has gone.
for (const [language, line] of [['en', 'The agent engine did not take that model, so this chat stays on the model it had. Your message is still in the box.'], ['ar', 'محرك الوكلاء ماقبلش الموديل ده، فالمحادثة فضلت على الموديل اللي كانت عليه. رسالتك لسه في المربع.']] as const) test(`in ${language} a waiting message the Engine refuses for its model shows the model line under the composer, with the message back in the box`, async () => {
 const queued = { id: 0, author: 'person' as const, author_name: 'Omar', body: 'Now the email version', created_at: at, kind: 'queued' as const, failed: true };
 const screen = await render(view(talk([sent, { ...queued, model_refused: true }]), language));
 await expect.element(screen.getByRole('alert').filter({ hasText: line })).toBeVisible();
 expect(screen.container.querySelector('.composer-error')?.textContent).toBe(line);
 await expect.element(screen.getByRole('textbox')).toHaveValue('Now the email version');
 const other = await render(view(talk([sent, queued]), language));
 expect(other.container.querySelector('textarea')?.value).toBe('');
 expect(other.container.querySelector('.composer-error')).toBeNull();
 const later = await render(view(talk([sent, { ...queued, model_refused: true }, { ...sent, id: 3, body: 'Then the post' }]), language));
 expect(later.container.querySelector('textarea')?.value).toBe('');
 expect(later.container.querySelector('.composer-error')).toBeNull();
});

for (const [language, dir, body, own] of [['en', 'ltr', 'خطة إطلاق الكورس for the Meta campaign', 'rtl'], ['ar', 'rtl', 'Plan the launch week', 'ltr']] as const) test(`in ${dir} the person's turn sits on the end side and the Agent's on the start side, and a message in the other script keeps its own direction`, async () => {
 await page.viewport(1440, 900);
 document.documentElement.dir = dir;
 onTestFinished(() => { document.documentElement.dir = ''; });
 const screen = await render(<div className="gw" dir={dir}>{view(talk([{ ...sent, body }, { id: 2, author: 'agent', author_name: 'Mona', body: 'On it.', created_at: at }]), language)}</div>);
 const turns = screen.getByRole('list'); const column = turns.element().getBoundingClientRect();
 const [mine, reply] = [turns.getByText(body).element(), turns.getByText('On it.').element()];
 const [person, agent] = [mine.getBoundingClientRect(), reply.getBoundingClientRect()];
 const [start, end] = dir === 'ltr' ? ['left', 'right'] as const : ['right', 'left'] as const;
 expect([Math.round(person[end]), Math.round(agent[start])]).toEqual([Math.round(column[end]), Math.round(column[start])]);
 expect(person.width).toBeLessThan(column.width / 2);
 expect(agent.width).toBeLessThan(column.width / 2);
 expect(getComputedStyle(mine).direction).toBe(own);
 expect(getComputedStyle(screen.getByRole('heading').getByText(body).element()).direction).toBe(own);
});

test('Lead\'s sentence to try in a new workspace keeps the text already typed and follows it on the next line', async () => {
 const empty: ConversationRecord = { ...waiting, messages: [] };
 const screen = await render(<div className="gw"><LanguageProvider language="en"><ConversationView slug="rs-learning" agent={{ id: 'ag-1', connection_id: 'c-1', name: 'Lead', speciality: 'General', main: true }} details={null} company="co-1" conversation={empty.conversation} title="" writer><Arrived record={arrived(empty)} team={false}/></ConversationView></LanguageProvider></div>);
 const field = screen.getByRole('textbox', { name: 'Message' });
 await field.fill('First, the numbers');
 await screen.getByRole('button', { name: 'I want someone to run our Meta and Google ads' }).click();
 await expect.element(field).toHaveValue('First, the numbers\nI want someone to run our Meta and Google ads');
 await expect.element(field).toHaveFocus();
});

// #227: a reply that is only a card is a whole reply. Its Run is recorded completed, so the turn is the card with no
// failure line; the same turn recorded failed shows the line.
const asking = { id: 1, author: 'person' as const, author_name: 'Omar', body: 'Plan the December campaign', created_at: at, run_id: 'run-1' };
const draft = { run_id: 'run-1', at, card: { kind: 'reply' as const, card: { id: 5, kind: 'draft' as const, title: 'Campaign plan', line: 'Draft · Meta Ads', rows: [{ label: 'Goal', value: 'WhatsApp leads' }] } } };
const onlyCard = (outcome: 'completed' | 'failed') => {
 const usage = [{ run_id: 'run-1', outcome, input_tokens: null, output_tokens: null }];
 return talk(shown([asking], usage, [draft], 'Mona'), { failed: latestEnded([asking], usage) });
};
for (const [language, line] of [['en', 'The agent could not finish this reply. Send the message again to retry.'], ['ar', 'الوكيل مقدرش يكمّل الرد ده. ابعت الرسالة تاني عشان تجرّب من الأول.']] as const) test(`in ${language} a reply that is only a card shows the card and no failure line, and a failed one shows the line`, async () => {
 const done = await render(view(onlyCard('completed'), language));
 await expect.element(done.getByRole('group', { name: 'Campaign plan' })).toBeVisible();
 await expect.element(done.getByRole('alert').filter({ hasText: line })).not.toBeInTheDocument();
 await done.unmount();
 const failed = await render(view(onlyCard('failed'), language));
 await expect.element(failed.getByRole('group', { name: 'Campaign plan' })).toBeVisible();
 await expect.element(failed.getByRole('alert').filter({ hasText: line })).toBeVisible();
});
