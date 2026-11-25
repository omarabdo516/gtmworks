import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { act, use, type ComponentProps } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { render } from 'vitest-browser-react';
import { cdp, page } from 'vitest/browser';
// Gives cdp() Playwright's session type (its send), as the config's provider does at run time.
import type {} from '@vitest/browser-playwright';
import ConversationView, { ConversationLoaded } from '@/app/c/[slug]/conversations/[id]/conversation';
import { LanguageProvider } from '@/lib/i18n-client';
import { LooksProvider } from '@/lib/agent-looks-client';
import type { CompanyLooks } from '@/lib/agent-looks';
import { localeFor } from '@/lib/i18n.mjs';
import { MessageBox } from '@/app/conversation-composer';
import type { ConversationRecord } from '@/lib/conversation-record';
import { latestEnd, shown, withHandedOn, withHandoverAnswers, type AgentRequestView } from '@/lib/conversations';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/globals.css';
// The loaded chat once its record is read, as the page streams it.
const Arrived = ({ record, team }: { record: Promise<ConversationRecord>, team: boolean }) => <ConversationLoaded initial={use(record)} team={team}/>;

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/conversation-archive-actions', () => ({ archiveConversations: vi.fn() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
// The live steps' read (#646) is tests/components/live-steps.test.tsx's own: here it waits for ever, so it never takes an
// answer meant for the record.
// The live steps' read (#646) waits for ever, and each reply's steps (#766) are read as none: neither is the record's read.
const stubFetch = (fetch: (url: string, init?: RequestInit) => unknown) => vi.stubGlobal('fetch', (url: string, init?: RequestInit) => String(url).startsWith('/api/run-steps?') ? new Promise<Response>(() => {}) : String(url).includes('&intent=steps') ? Promise.resolve(Response.json({ steps: {}, usage: null })) : fetch(url, init));
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
 usage: { input: 0, output: 0 }, pending: false, failed: false, working: null, canStop: false,
});
const waiting = record({ ...asked, state: 'waiting', owners: ['Omar'] });
const declined = record({ ...asked, state: 'declined', by: 'Omar', at, reason },
 [{ id: 0, author: 'agent', author_name: 'Lead', body: '', created_at: at, kind: 'decided', decided: { kind: 'request', by: 'Omar', name: 'FollowUp', at, made: false, reason } }]);

test('a Member who keeps their Conversation open sees the Owner\'s answer arrive, and the page stops asking once nothing waits', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const answers = [waiting, declined];
 const asks = vi.fn(async () => Response.json(answers.shift() ?? declined));
 stubFetch(asks);
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
 conversation: { id: 'cv-2', agent_id: null, agent_name: 'Mona', face: 'c-2' }, messages, usage: { input: 0, output: 0 }, pending: false, failed: false, working: null, canStop: false, ...more,
});
const view = (initial: ConversationRecord, language: 'en' | 'ar' = 'en') => <LanguageProvider language={language}><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={initial.conversation} title="" writer><Arrived record={arrived(initial)} team={false}/></ConversationView></LanguageProvider>;
const sent = { id: 1, author: 'person' as const, author_name: 'Omar', body: 'Draft the long launch plan', created_at: at };

test('while the Agent works the page says so, and the line goes once the reply is in the record', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 stubFetch(vi.fn(async () => Response.json(talk([sent, { id: 2, author: 'agent', author_name: 'Mona', body: 'Reply to: Draft the long launch plan', created_at: at }]))));
 const screen = await render(view(talk([sent], { pending: true })));
 await expect.element(screen.getByRole('status')).toHaveTextContent('MonaThinking…');
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

// #767: a waiting Conversation's poll sends the stamp it last read and keeps its record when nothing changed; a hidden tab
// asks nothing until it is shown, then asks at once; a signed-out reader stops asking, and a failing read asks more slowly.
const setHidden = (hidden: boolean) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' }); document.dispatchEvent(new Event('visibilitychange')); };
test('the poll asks only whether anything changed, stops in a hidden tab and reads at once when shown again', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 onTestFinished(() => { setHidden(false); vi.useRealTimers(); });
 const waiting = { ...talk([sent], { pending: true }), stamp: 'a'.repeat(32) };
 const asks = vi.fn(async (_url: string) => Response.json({ unchanged: true, stamp: 'a'.repeat(32) }));
 stubFetch(asks);
 const screen = await render(view(waiting));
 await vi.advanceTimersByTimeAsync(500);
 expect(asks).toHaveBeenCalledTimes(1);
 expect(asks.mock.calls[0][0]).toBe(`/api/conversations?company=co-1&conversation=cv-2&since=${'a'.repeat(32)}`);
 expect(screen.container.querySelector('.turn--user')?.textContent, 'nothing changed, so the record shown stays').toContain('Draft the long launch plan');
 setHidden(true);
 await vi.advanceTimersByTimeAsync(10000);
 expect(asks, 'a hidden tab asks nothing').toHaveBeenCalledTimes(1);
 setHidden(false);
 await vi.advanceTimersByTimeAsync(0);
 expect(asks, 'shown again, it asks at once').toHaveBeenCalledTimes(2);
});

test('a signed-out reader stops asking, and a failing read asks again more slowly', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 onTestFinished(() => { vi.useRealTimers(); });
 const signedOut = vi.fn(async () => Response.json({ error: 'conversationNotFound' }, { status: 401 }));
 stubFetch(signedOut);
 await render(view(talk([sent], { pending: true })));
 await vi.advanceTimersByTimeAsync(20000);
 expect(signedOut).toHaveBeenCalledTimes(1);
 const failing = vi.fn(async () => Response.json({ error: 'conversationFailed' }, { status: 503 }));
 stubFetch(failing);
 await render(view(talk([sent], { pending: true })));
 await vi.advanceTimersByTimeAsync(500);
 expect(failing).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(2999);
 expect(failing, 'the second read waits 3 s, not 1.5 s').toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);
 expect(failing).toHaveBeenCalledTimes(2);
});

// #768: a read that fails keeps what the page shows; after three in a row the line under the transcript says the
// Conversation could not be read, with "Try again", and a read that lands takes the line away and draws the reply.
for (const [language, unread, tryAgain] of [['en', 'This Conversation couldn’t be read.', 'Try again'], ['ar', 'مقدرناش نقرا المحادثة دي.', 'جرّب تاني']] as const) test(`in ${language} a Conversation whose reads fail keeps its messages and says it could not be read, with Try again`, async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 onTestFinished(() => { vi.useRealTimers(); });
 let failing = true;
 const replied = talk([sent, { id: 2, author: 'agent', author_name: 'Lead', body: 'Here is the plan.', created_at: at }]);
 const asks = vi.fn(async () => failing ? Response.json({ error: 'conversationUnread' }, { status: 503 }) : Response.json(replied));
 stubFetch(asks);
 const screen = await render(view(talk([sent], { pending: true }), language));
 for (const [wait, times] of [[500, 1], [3000, 2], [6000, 3]] as const) {
  await vi.advanceTimersByTimeAsync(wait);
  await expect.poll(() => asks.mock.calls.length).toBe(times);
 }
 expect(screen.container.querySelector('.turn--user')?.textContent, 'the messages stay').toContain('Draft the long launch plan');
 const line = () => screen.container.querySelector('[data-outcome="unread"]');
 await expect.poll(() => line()?.textContent).toBe(`${unread} ${tryAgain}`);
 failing = false;
 await screen.getByRole('button', { name: tryAgain }).click();
 await vi.advanceTimersByTimeAsync(0);
 await expect.poll(() => screen.container.textContent).toContain('Here is the plan.');
 expect(line()).toBeNull();
});

// #766 (ADR 0030): a Conversation is drawn from its record at once, and each reply's steps are their own read after it:
// they fill in under their reply when that read lands, with no second rise-in, and a read that fails changes nothing.
test('each reply\'s steps arrive after the messages, under their own reply, and a failed read leaves the replies as they are', async () => {
 const reply = { id: 2, author: 'agent' as const, author_name: 'Lead', body: 'Here is the plan.', created_at: at };
 let answer: (value: Response) => void = () => {};
 vi.stubGlobal('fetch', (url: string) => String(url).includes('&intent=steps') ? new Promise<Response>(resolve => { answer = resolve; }) : new Promise<Response>(() => {}));
 const screen = await render(view(talk([sent, reply])));
 await expect.element(screen.getByText('Here is the plan.')).toBeVisible();
 expect(document.querySelector('.steps__toggle'), 'the messages are drawn before the steps').toBeNull();
 answer(Response.json({ steps: { 2: { list: [{ tool: 'web_search', preview: 'courses', state: 'done' }], seconds: 12 } }, usage: { input: 10, output: 5 } }));
 await expect.element(screen.getByRole('button', { name: 'Used 1 tool · 12 sec' })).toBeVisible();
 expect(screen.getByText('Here is the plan.').element().closest('.turn')!.classList.contains('msg-in'), 'no second rise-in').toBe(false);
 vi.stubGlobal('fetch', (url: string) => String(url).includes('&intent=steps') ? Promise.resolve(Response.json({ error: 'conversationStepsUnread' }, { status: 503 })) : new Promise<Response>(() => {}));
 const failed = await render(view(talk([sent, reply])));
 await expect.poll(() => failed.container.textContent).toContain('Here is the plan.');
 expect(failed.container.querySelector('[role="alert"]'), 'no error line in the Conversation').toBeNull();
});

// #764: a message is stored the moment it is sent and its Run starts after. A turn the Engine refused stays with "Not sent"
// under it and "Try again", which posts the same send key; one waiting behind the current reply says so, and one about to
// start is an ordinary message.
for (const [language, notSent, tryAgain, waits] of [['en', 'Not sent', 'Try again', 'It’ll read this after the current reply'], ['ar', 'ما اتبعتتش', 'جرّب تاني', 'هيقراها بعد الرد اللي شغال عليه']] as const) test(`in ${language} a message that was not sent stays with its line and Try again, which sends the same turn`, async () => {
 const posts: unknown[] = [];
 vi.stubGlobal('fetch', vi.fn(async (_: string, init?: RequestInit) => { if (init?.method === 'POST') posts.push(JSON.parse(String(init.body))); return Response.json(talk([sent])); }));
 const refused = { id: 0, author: 'person' as const, author_name: 'Omar', body: 'Now the email version', created_at: at, kind: 'queued' as const, failed: true, key: 'k7640000-0000-0000-0000-000000000001' };
 const screen = await render(view(talk([sent, refused]), language));
 const turn = screen.getByRole('list', { name: language === 'en' ? 'Messages' : 'الرسائل' }).getByRole('listitem').filter({ hasText: 'Now the email version' });
 await expect.element(turn.getByRole('alert')).toHaveTextContent(`${notSent} ${tryAgain}`);
 expect(screen.container.querySelector('textarea')?.value, 'the words stay in the transcript, not back in the box').toBe('');
 await turn.getByRole('button', { name: tryAgain }).click();
 await expect.poll(() => posts).toEqual([{ company: 'co-1', conversation: 'cv-2', intent: 'retry', sendKey: 'k7640000-0000-0000-0000-000000000001' }]);
 const waiting = await render(view(talk([sent, { ...refused, failed: undefined, key: undefined, behind: true }], { pending: true }), language));
 await expect.element(waiting.getByText(waits)).toBeVisible();
 const starting = await render(view(talk([sent, { ...refused, failed: undefined, key: undefined }], { pending: true }), language));
 expect(starting.container.querySelector('.is-queued'), 'a turn about to start is an ordinary message').toBeNull();
 expect(starting.container.querySelector('.queued')).toBeNull();
});

// #731: a reply that ran out of usage names the accounts that ran out, as Settings › Providers names them, each in its own
// direction, beside when the usage resets; with none named the line stays as it was.
for (const [language, names, line] of [
 ['en', ['ChatGPT', 'حساب عمر'], 'ChatGPT and حساب عمر ran out of usage.'],
 ['ar', ['ChatGPT', 'حساب عمر'], 'الاستخدام خلص على ChatGPT وحساب عمر.']] as const) test(`in ${language} a reply that ran out of usage names the accounts that ran out`, async () => {
 const screen = await render(view(talk([asking], { failed: true, modelRefused: { reason: 'access', owner: false, resetsAt: '2027-05-01T19:24:00.000Z', ranOut: [...names] } }), language));
 const alert = screen.getByRole('alert');
 await expect.poll(() => alert.element().textContent).toContain(line);
 expect([...alert.element().querySelectorAll('bdi')].map(name => name.textContent)).toEqual([...names]);
 expect(alert.element().querySelector('time')).not.toBeNull();
 await screen.unmount();
 const unnamed = await render(view(talk([asking], { failed: true, modelRefused: { reason: 'access', owner: false } }), language));
 expect(unnamed.getByRole('alert').element().querySelector('bdi')).toBeNull();
 await unnamed.unmount();
});

// Review of #330: on the same mounted Conversation, the model line goes once the refused message is no longer the latest
// (another tab sent one); the message in the box stays, and so does a line about something else.
test('the model line goes when the refused message is no longer the latest, keeping the box\'s text and any other line', async () => {
 const modelLine = 'The agent engine did not take that model, so this chat stays on the model it had. Your message is still in the box.';
 const box = (refused?: { key: string, text: string }, send = async () => null as string | null) => <LanguageProvider language="en"><MessageBox placeholder="Message" send={send} refused={refused}/></LanguageProvider>;
 const refused = { key: 'k-1', text: 'Now the email version' };
 const screen = await render(box(refused));
 await expect.element(screen.getByRole('alert')).toHaveTextContent(modelLine);
 await screen.rerender(box());
 await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
 await expect.element(screen.getByRole('textbox')).toHaveValue('Now the email version');
 await screen.unmount();

 const unreachable = async () => 'conversationHermesFailed';
 const other = await render(box(refused, unreachable));
 await other.getByRole('button', { name: 'Send' }).click();
 await expect.element(other.getByRole('alert')).toHaveTextContent('The agent engine could not be reached. Your message was not sent; it is still in the box. Ask the install owner to start it.');
 await other.rerender(box(undefined, unreachable));
 await expect.element(other.getByRole('alert')).toHaveTextContent('The agent engine could not be reached. Your message was not sent; it is still in the box. Ask the install owner to start it.');
 await expect.element(other.getByRole('textbox')).toHaveValue('Now the email version');
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
 const usage = [{ run_id: 'run-1', outcome }];
 return talk(shown([asking], usage, [draft], 'Mona'), { failed: latestEnd([asking], usage) !== null });
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

// #422: a reply that failed because the Company has no model at all says so instead of offering a retry: the Owner
// gets the way to Settings, Subscription and models; a Member is told to ask the Owner.
const words = {
 en: { line: 'This company has no AI subscription or model key connected yet, so its agents can’t reply.', connect: 'Connect one in Providers', ask: 'Ask the company’s Owner to connect one in Settings.', retry: 'Send the message again to retry.' },
 ar: { line: 'الشركة دي لسه مفيهاش اشتراك ذكاء اصطناعي ولا مفتاح موديل متوصّل، فالوكلاء مش هيقدروا يردّوا.', connect: 'وصّل واحد من المزوّدين', ask: 'اطلب من مالك الشركة يوصّل واحد من الإعدادات.', retry: 'ابعت الرسالة تاني' },
} as const;
for (const language of ['en', 'ar'] as const) for (const owner of [true, false]) test(`in ${language} a reply that failed for want of a model tells ${owner ? 'the Owner where to connect one' : 'a Member to ask the Owner'}`, async () => {
 const said = words[language];
 const screen = await render(view(talk([asking], { failed: true, noModel: { owner } }), language));
 const line = screen.getByRole('alert').filter({ hasText: said.line });
 await expect.element(line).toBeVisible();
 await expect.element(line.filter({ hasText: said.retry })).not.toBeInTheDocument();
 if (owner) {
  await expect.element(line.getByRole('link', { name: said.connect })).toHaveAttribute('href', '/c/rs-learning/settings?section=models');
  await expect.element(line.filter({ hasText: said.ask })).not.toBeInTheDocument();
 } else {
  await expect.element(line.filter({ hasText: said.ask })).toBeVisible();
  await expect.element(line.getByRole('link')).not.toBeInTheDocument();
 }
});

// #457: a model error a retry cannot fix names its cause, with no retry: the Owner gets the way to the Agent's model in
// Subscription and models, a Member is told to ask the Owner, in English and Arabic.
const refusedWords = {
 en: { credit: 'Mona could not reply: the company’s model key has no credit left.', key: 'Mona could not reply: the model provider refused the company’s key or sign-in.', model: 'Mona could not reply: its model is not available from the provider.', fix: 'Check the agent’s model in Providers', ask: 'Ask the company’s Owner to check it in Settings.', retry: 'Send the message again to retry.' },
 ar: { credit: 'Mona مقدرش يرد: مفتاح الموديل بتاع الشركة مفيهوش رصيد.', key: 'Mona مقدرش يرد: مزوّد الموديل رفض مفتاح الشركة أو تسجيل الدخول.', model: 'Mona مقدرش يرد: الموديل بتاعه مش متاح عند المزوّد.', fix: 'اتأكد من موديل الوكيل من المزوّدين', ask: 'اطلب من مالك الشركة يتأكد منه من الإعدادات.', retry: 'ابعت الرسالة تاني' },
} as const;
const refusedOutcome = { credit: 'no-credit', key: 'key-refused', model: 'model-missing' } as const;
for (const language of ['en', 'ar'] as const) for (const reason of ['credit', 'key', 'model'] as const) for (const owner of [true, false]) test(`in ${language} a reply that failed for ${reason === 'credit' ? 'no credit' : reason === 'key' ? 'a refused key' : 'a missing model'} tells ${owner ? 'the Owner where to check it' : 'a Member to ask the Owner'}`, async () => {
 const said = refusedWords[language];
 const screen = await render(view(talk([asking], { failed: true, modelRefused: { reason, owner } }), language));
 const line = screen.getByRole('alert').filter({ hasText: said[reason] });
 await expect.element(line).toBeVisible();
 await expect.element(line).toHaveAttribute('data-outcome', refusedOutcome[reason]);
 await expect.element(line.filter({ hasText: said.retry })).not.toBeInTheDocument();
 if (owner) {
  await expect.element(line.getByRole('link', { name: said.fix })).toHaveAttribute('href', '/c/rs-learning/settings?section=models');
  await expect.element(line.filter({ hasText: said.ask })).not.toBeInTheDocument();
 } else {
  await expect.element(line.filter({ hasText: said.ask })).toBeVisible();
  await expect.element(line.getByRole('link')).not.toBeInTheDocument();
 }
});

// #642: a reply that failed because every account ran out says when the usage resets, in the reader's own zone, when the
// Engine named it, with no retry; with no reset named it says only that the accounts ran out.
for (const [language, ran, resets, fix] of [
 ['en', 'Mona could not reply: every account it can use has run out of usage for now.', 'The usage resets on', 'Add an account or choose a fallback model in Providers'],
 ['ar', 'Mona مقدرش يرد: كل الحسابات اللي يقدر يستخدمها خلص استخدامها دلوقتي.', 'الاستخدام هيتجدّد يوم', 'ضيف حساب أو اختار موديل بديل من المزوّدين']] as const) test(`in ${language} a reply that ran out of usage says when it resets`, async () => {
 const resetsAt = '2027-05-01T19:24:00.000Z';
 const screen = await render(view(talk([asking], { failed: true, modelRefused: { reason: 'access', owner: true, resetsAt } }), language));
 const line = screen.getByRole('alert').filter({ hasText: ran });
 await expect.element(line).toHaveAttribute('data-outcome', 'no-access');
 const time = line.element().querySelector('time');
 expect(time?.getAttribute('dateTime')).toBe(resetsAt);
 const reader = new Date(resetsAt);
 expect(time?.textContent).toContain(resets);
 expect(time?.textContent).toContain(reader.toLocaleTimeString(localeFor(language), { hour: '2-digit', minute: '2-digit' }));
 await expect.element(line.getByRole('link', { name: fix })).toBeVisible();
 expect(line.element().textContent).not.toContain(language === 'en' ? 'Send the message again' : 'ابعت الرسالة تاني');
 await screen.unmount();
 const unnamed = await render(view(talk([asking], { failed: true, modelRefused: { reason: 'access', owner: true } }), language));
 await expect.element(unnamed.getByRole('alert').filter({ hasText: ran })).toBeVisible();
 expect(unnamed.getByRole('alert').element().querySelector('time')).toBeNull();
 await unnamed.unmount();
});

// #530: a job command's target whose model call was refused is the Agent the line names, not the chat's own.
test('a job command\'s target out of credit is the Agent the line names', async () => {
 const screen = await render(view(talk([asking], { failed: true, modelRefused: { reason: 'credit', owner: false, agent: 'Ads' } }), 'en'));
 await expect.element(screen.getByRole('alert').filter({ hasText: 'Ads could not reply: the company’s model key has no credit left.' })).toBeVisible();
});

// #317, #475: a job Lead handed another Agent is a quiet row under Lead's reply, drawn from gtmworks's own record: both
// faces, the arrow pointing the way the interface reads, "Lead asked Ads" and the job.
for (const [language, line, arrow] of [['en', 'Lead asked Ads', 'M5 12h14'], ['ar', 'Lead طلب من Ads', 'M19 12H5']] as const) test(`in ${language} a job Lead handed another Agent reads under Lead's reply with both faces and the job`, async () => {
 const record: ConversationRecord = talk([sent, { id: 2, author: 'agent', author_name: 'Lead', body: 'I handed the March intake to Ads.', created_at: at,
  cards: [{ kind: 'handed', from: { name: 'Lead', face: 'c-2' }, name: 'Ads', face: 'c-3', goal: 'Plan the Meta ads for the March intake' }] }]);
 const screen = await render(view(record, language));
 const row = screen.container.querySelector('.turn--agent [data-handover]');
 expect(row).not.toBeNull();
 expect(row?.textContent).toContain(line);
 expect(row?.textContent).toContain('Ads');
 expect(row?.textContent).toContain('Plan the Meta ads for the March intake');
 expect(row?.querySelectorAll('.face').length).toBe(2);
 expect(row?.querySelector('.gw-icon path')?.getAttribute('d')).toBe(arrow);
});

// #475: any Agent asks, not only Lead. In a chat with Writer, Writer asks Ads: the row names both, then Ads's answer under
// its own name and face with "to Writer" on its sender line, then Writer's own reply, in Arabic and English, light and
// dark (design-reference: the handoff row, `.handoff`, and `.sender__to`).
const handing: ConversationRecord = { ...talk([
 { ...sent, body: 'Write the March ad copy' },
 { id: 2, author: 'agent', author_name: 'Writer', body: 'I asked Ads for last campaign\'s numbers.', created_at: '2026-06-10T09:41:00Z',
  cards: [{ kind: 'handed', from: { name: 'Writer', face: 'c-2' }, name: 'Ads', face: 'c-3', goal: 'Last campaign\'s leads and cost per lead' }] },
 { id: 9, author: 'agent', author_name: 'Ads', face: 'c-3', body: '1,240 leads at EGP 7.30 each.', created_at: '2026-06-10T09:42:00Z', kind: 'handed', to: 'Writer' },
 { id: 3, author: 'agent', author_name: 'Writer', body: 'The copy leads with 1,240 leads at EGP 7.30 each.', created_at: '2026-06-10T09:43:00Z' },
]), conversation: { id: 'cv-3', agent_id: null, agent_name: 'Writer', face: 'c-2' } };
for (const [language, line, to] of [['en', 'Writer asked Ads', 'to Writer'], ['ar', 'Writer طلب من Ads', 'لـ Writer']] as const)
 for (const theme of ['light', 'dark'] as const) test(`in ${language}, ${theme}, an Agent that is not the main one asks another, whose answer reads under its own name to the asker before the asker's reply`, async () => {
  document.documentElement.dataset.theme = theme;
  onTestFinished(() => { delete document.documentElement.dataset.theme; });
  const screen = await render(<div className="gw">{view(handing, language)}</div>);
  const turns = [...screen.container.querySelectorAll('.turn--agent')];
  expect(turns.map(turn => turn.querySelector('.sender bdi')?.textContent)).toEqual(['Writer', 'Ads', 'Writer']);
  const row = turns[0].querySelector('[data-handover]');
  expect(row?.querySelector('.handed__t')?.textContent).toBe(line);
  expect(row?.querySelector('.handed__d')?.textContent).toBe('Last campaign\'s leads and cost per lead');
  expect([...row!.querySelectorAll('.face')].map(face => (face as HTMLElement).dataset.agent)).toEqual(['c-2', 'c-3']);
  // The answer wears the asked Agent's own face, the one the row draws for it, and says whom it went to.
  expect(turns[1].querySelector<HTMLElement>('.sender .face')?.dataset.agent).toBe('c-3');
  expect(turns[1].querySelector('.sender__to')?.textContent).toBe(to);
  expect(turns[1].querySelector('.bubble')?.textContent).toBe('1,240 leads at EGP 7.30 each.');
  expect(turns[0].querySelector('.sender__to')).toBeNull();
  expect(turns[2].querySelector('.sender__to')).toBeNull();
  // The names read in the theme's first text colour, and the job and the "to" line in its quiet one.
  const [first, quiet] = theme === 'dark' ? ['rgb(245, 245, 245)', 'rgba(245, 245, 245, 0.6)'] : ['rgb(28, 28, 28)', 'rgba(28, 28, 28, 0.64)'];
  expect(getComputedStyle(row!.querySelector('.handed__t bdi')!).color).toBe(first);
  expect(getComputedStyle(row!.querySelector('.handed__d')!).color).toBe(quiet);
  expect(getComputedStyle(turns[1].querySelector('.sender__to')!).color).toBe(quiet);
 });
// #477: an asked Agent hands on. Writer asks Ads, Ads asks Critic: each step is its own row with its answer, in order —
// Writer's row under its reply, Ads's own row among the turns, Critic's answer to Ads, Ads's answer to Writer, then
// Writer's reply. The record is put together as the server does (withHandoverAnswers, withHandedOn).
const chained = (): ConversationRecord => {
 const base = [
  { ...sent, body: 'Write the March post with last campaign\'s numbers' },
  { id: 2, author: 'agent' as const, author_name: 'Writer', body: 'I asked Ads for the numbers.', created_at: '2026-06-10T09:41:00Z',
   cards: [{ kind: 'handed' as const, from: { name: 'Writer', face: 'c-2' }, name: 'Ads', face: 'c-3', goal: 'Last campaign\'s numbers' }] },
  { id: 3, author: 'agent' as const, author_name: 'Writer', body: 'The post leads with 120 leads.', created_at: '2026-06-10T09:45:00Z' },
 ];
 const answers = withHandoverAnswers(base, [
  { id: 11, from: 'Writer', name: 'Ads', face: 'c-3', body: 'February: 120 leads, checked by Critic.', at: '2026-06-10T09:44:00Z' },
  { id: 12, from: 'Ads', name: 'Critic', face: 'c-4', body: 'The figures check out.', at: '2026-06-10T09:43:00Z' }]);
 const steps = withHandedOn(answers, [{ id: 12, at: '2026-06-10T09:42:00Z', card: { kind: 'handed', from: { name: 'Ads', face: 'c-3' }, name: 'Critic', face: 'c-4', goal: 'Check the figures' } }]);
 return { ...talk(steps), conversation: { id: 'cv-4', agent_id: null, agent_name: 'Writer', face: 'c-2' } };
};
for (const [language, first, second, toAds, toWriter] of [['en', 'Writer asked Ads', 'Ads asked Critic', 'to Ads', 'to Writer'], ['ar', 'Writer طلب من Ads', 'Ads طلب من Critic', 'لـ Ads', 'لـ Writer']] as const)
 test(`in ${language} every step of a chain of handovers is its own row with its answer, in order`, async () => {
  const screen = await render(<div className="gw">{view(chained(), language)}</div>);
  const items = [...screen.container.querySelectorAll('ol.turns > li')].filter(item => item.matches('.turn--agent, [data-handover]'));
  expect(items.map(item => item.matches('[data-handover]') ? `row:${item.querySelector('.handed__t')?.textContent}`
   : `${item.querySelector('.sender bdi')?.textContent}${item.querySelector('.sender__to') ? ` ${item.querySelector('.sender__to')?.textContent}` : ''}:${item.querySelector('.bubble')?.textContent}`)).toEqual([
   'Writer:I asked Ads for the numbers.',
   `row:${second}`,
   `Critic ${toAds}:The figures check out.`,
   `Ads ${toWriter}:February: 120 leads, checked by Critic.`,
   'Writer:The post leads with 120 leads.']);
  expect(items[0].querySelector('[data-handover] .handed__t')?.textContent).toBe(first);
  const step = items[1];
  expect(step.querySelector('.handed__d')?.textContent).toBe('Check the figures');
  expect([...step.querySelectorAll('.face')].map(face => (face as HTMLElement).dataset.agent)).toEqual(['c-3', 'c-4']);
  expect(step.closest('.turn')).toBeNull();
 });
// #478: Stop ends the whole chain. Writer asked Ads and Ads asked Critic when the person pressed Stop: both steps say
// "Stopped" on their rows, quietly (the person asked for it: no failure's colour), in place of "the job didn't finish",
// and no answer or reply follows. Light and dark.
const stoppedChain = (): ConversationRecord => {
 const base = [
  { ...sent, body: 'Write the March post with last campaign\'s numbers' },
  { id: 2, author: 'agent' as const, author_name: 'Writer', body: 'I asked Ads for the numbers.', created_at: '2026-06-10T09:41:00Z',
   cards: [{ kind: 'handed' as const, from: { name: 'Writer', face: 'c-2' }, name: 'Ads', face: 'c-3', goal: 'Last campaign\'s numbers', stopped: true as const }] },
 ];
 const steps = withHandedOn(base, [{ id: 12, at: '2026-06-10T09:42:00Z', card: { kind: 'handed', from: { name: 'Ads', face: 'c-3' }, name: 'Critic', face: 'c-4', goal: 'Check the figures', stopped: true } }]);
 return { ...talk(steps), conversation: { id: 'cv-4', agent_id: null, agent_name: 'Writer', face: 'c-2' } };
};
for (const [language, line] of [['en', 'Stopped'], ['ar', 'اتوقّف']] as const)
 for (const theme of ['light', 'dark'] as const) test(`in ${language}, ${theme}, each step of a chain its person stopped says so on its row`, async () => {
  document.documentElement.dataset.theme = theme;
  onTestFinished(() => { delete document.documentElement.dataset.theme; });
  const screen = await render(<div className="gw">{view(stoppedChain(), language)}</div>);
  const rows = [...screen.container.querySelectorAll('ol.turns [data-handover]')];
  expect(rows.map(row => row.querySelector('.handed__d')?.textContent)).toEqual(['Last campaign\'s numbers', 'Check the figures']);
  expect(rows.map(row => row.querySelector('.handed__failed')?.textContent)).toEqual([line, line]);
  expect(rows.map(row => [row.hasAttribute('data-stopped'), row.hasAttribute('data-failed')])).toEqual([[true, false], [true, false]]);
  expect(screen.container.querySelectorAll('ol.turns .turn--agent').length).toBe(1);
  const danger = theme === 'dark' ? 'rgb(255, 100, 99)' : 'rgb(205, 40, 52)';
  expect(getComputedStyle(rows[1].querySelector('.handed__failed')!).color).not.toBe(danger);
 });
// #375: a handover that did not finish says so on its row, after the job, in the interface's language; one that finished
// says nothing of it.
for (const [language, line] of [['en', 'The job didn’t finish'], ['ar', 'الشغل ماخلصش']] as const) test(`in ${language} a job Lead handed that did not finish says so on its row`, async () => {
 const record: ConversationRecord = talk([sent, { id: 2, author: 'agent', author_name: 'Lead', body: 'I handed the March intake to Ads.', created_at: at,
  cards: [{ kind: 'handed', from: { name: 'Lead', face: 'c-2' }, name: 'Ads', face: 'c-3', goal: 'Plan the Meta ads for the March intake', failed: true }] }]);
 const screen = await render(view(record, language));
 const row = screen.container.querySelector('.turn--agent [data-handover]');
 expect(row?.hasAttribute('data-failed')).toBe(true);
 expect([...row!.children].map(part => part.className)).toEqual(['handed__faces', 'handed__t', 'handed__d', 'handed__failed']);
 expect(row?.querySelector('.handed__failed')?.textContent).toBe(line);
 expect(row?.textContent).toContain('Plan the Meta ads for the March intake');
});
test('a job Lead handed that finished draws no line saying it did not', async () => {
 const record: ConversationRecord = talk([sent, { id: 2, author: 'agent', author_name: 'Lead', body: 'I handed the March intake to Ads.', created_at: at,
  cards: [{ kind: 'handed', from: { name: 'Lead', face: 'c-2' }, name: 'Ads', face: 'c-3', goal: 'Plan the Meta ads' }] }]);
 const screen = await render(view(record));
 const row = screen.container.querySelector('.turn--agent [data-handover]');
 expect(row?.hasAttribute('data-failed')).toBe(false);
 expect(row?.querySelector('.handed__failed')).toBeNull();
});

// #358: the Agent a job command hands the work to answers in the same chat, drawn from that Agent: its own name on the
// reply and its own face, the one the row that handed the job over shows — never the Conversation's Agent's.
test('a job command\'s answer in the main Agent\'s chat is drawn from the Agent handed the work, with its own face', async () => {
 const record: ConversationRecord = talk([
  { id: 1, author: 'person', author_name: 'Youssef', body: '/campaign Launch the December ads', created_at: at },
  { id: 2, author: 'agent', author_name: 'Mona', body: '', created_at: at, cards: [{ kind: 'handed', from: { name: 'Mona', face: 'c-2' }, name: 'Reach', face: 'c-3', goal: 'Launch the December ads' }] },
  { id: 3, author: 'agent', author_name: 'Reach', agent_id: 'a-3', face: 'c-3', body: 'Three ad sets, 30 days, EGP 9,000.', created_at: at },
 ]);
 const screen = await render(view(record));
 const turns = [...screen.container.querySelectorAll('.turn--agent')];
 expect(turns.map(turn => turn.querySelector('.sender bdi')?.textContent)).toEqual(['Mona', 'Reach']);
 const handedFaces = [...turns[0].querySelectorAll<HTMLElement>('.handed__faces .face')];
 expect(handedFaces.map(face => face.dataset.agent)).toEqual(['c-2', 'c-3']);
 // The face is asked for by the Agent's id, so the reply wears the face the row shows for it.
 expect(turns[1].querySelector<HTMLElement>('.sender .face')?.dataset.agent).toBe('c-3');
});

// A handed job keeps the chat asking for Lead's follow-up reply, even though the Run that handed it over has ended.
test('a handed job keeps the chat asking until Lead\'s follow-up reply is in the record', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const handed: ConversationRecord = { ...talk([sent, { id: 2, author: 'agent', author_name: 'Lead', body: 'I handed it to Ads.', created_at: at,
  cards: [{ kind: 'handed', from: { name: 'Lead', face: 'c-2' }, name: 'Ads', face: 'c-3', goal: 'Plan the Meta ads' }] }]), handover: true };
 const replied: ConversationRecord = talk([...handed.messages, { id: 3, author: 'agent', author_name: 'Lead', body: 'Ads planned three ad sets.', created_at: at }]);
 const asks = vi.fn(async () => Response.json(replied));
 stubFetch(asks);
 const screen = await render(view(handed));
 await expect.element(screen.getByText('I handed it to Ads.')).toBeVisible();
 await vi.advanceTimersByTimeAsync(500);
 expect(asks).toHaveBeenCalledTimes(1);
 await expect.element(screen.getByText('Ads planned three ad sets.')).toBeVisible();
});

// #155: the images a message was sent with sit under the Member's bubble, each opening the file by its own address; a
// message with images alone shows no empty bubble, and keeps its chips after a reload (they come from the record).
test('a sent message keeps its images as chips under its bubble, and a message of images alone shows no bubble', async () => {
 const files = [{ id: 11, name: 'cover.png' }, { id: 12, name: 'غلاف.jpg' }];
 const withText = await render(view(talk([{ ...sent, body: 'Here is the cover', files }])));
 const turn = withText.getByRole('list', { name: 'Messages' }).getByRole('listitem').filter({ hasText: 'Here is the cover' });
 await expect.element(turn.getByRole('link', { name: 'cover.png' })).toHaveAttribute('href', '/c/rs-learning/files/conversation/11');
 await expect.element(turn.getByRole('link', { name: 'غلاف.jpg' })).toHaveAttribute('href', '/c/rs-learning/files/conversation/12');
 expect(turn.element().querySelector('.bubble--user')?.textContent).toBe('Here is the cover');
 const alone = await render(view(talk([{ ...sent, body: '', files: [{ id: 13, name: 'alone.png' }] }])));
 const quiet = alone.getByRole('list', { name: 'Messages' }).getByRole('listitem').filter({ hasText: 'alone.png' });
 await expect.element(quiet.getByRole('link', { name: 'alone.png' })).toBeVisible();
 expect(quiet.element().querySelector('.bubble--user')).toBeNull();
});

// #132 (design-reference: msgHTML's msg-in, cleared after one draw; agentCardHTML's card-in; .thinking .shimmer): what
// arrives while the Conversation is open rises once, what it held when it opened stays still, and the working line's
// words breathe.
const motionOf = (element: Element) => { const style = getComputedStyle(element); return [style.animationName, style.animationDuration, style.animationTimingFunction]; };
const turnOf = (text: string) => [...document.querySelectorAll('.turns > li')].find(turn => turn.textContent?.includes(text))!;
const rises = ['gw-rise', '0.2s', 'cubic-bezier(0.2, 0, 0, 1)'];
// Drawn inside the shell's root, as the app draws a Conversation, so its stylesheet applies.
const inShell = (initial: ConversationRecord) => <div className="gw">{view(initial)}</div>;

test('a turn that arrives while the Conversation is open rises once; the turns it opened with and the queued turn once started do not', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const queued = { id: 0, author: 'person' as const, author_name: 'Omar', body: 'And the budget?', created_at: at, kind: 'queued' as const };
 const reply = { id: 2, author: 'agent' as const, author_name: 'Mona', body: 'Here is the plan.', created_at: at };
 const started = { id: 3, author: 'person' as const, author_name: 'Omar', body: 'And the budget?', created_at: at };
 const answers = [talk([sent, reply, queued], { pending: true }), talk([sent, reply, started], { pending: true }), talk([sent, reply, started], { pending: true }), talk([sent, reply, started], { pending: true })];
 stubFetch(vi.fn(async () => Response.json(answers.shift() ?? answers.at(-1))));
 await render(inShell(talk([sent], { pending: true })));
 expect(motionOf(turnOf('Draft the long launch plan'))[0]).toBe('none');
 await vi.advanceTimersByTimeAsync(500);
 await expect.poll(() => turnOf('Here is the plan.')).toBeTruthy();
 expect(motionOf(turnOf('Here is the plan.'))).toEqual(rises);
 expect(motionOf(turnOf('And the budget?'))).toEqual(rises);
 expect(motionOf(turnOf('Draft the long launch plan'))[0]).toBe('none');
 // An animation plays again only when its element is put in the page again or its class comes back. Three further
 // reads (the queued turn starts, then the record comes back the same twice) keep the reply's element as it was, and
 // the started turn, drawn as a new element, carries no rise.
 const replyTurn = turnOf('Here is the plan.');
 for (let read = 0; read < 3; read++) await vi.advanceTimersByTimeAsync(1500);
 await expect.poll(() => turnOf('And the budget?').classList.contains('is-queued')).toBe(false);
 expect(turnOf('Here is the plan.')).toBe(replyTurn);
 expect(replyTurn.classList.contains('msg-in')).toBe(true);
 expect(motionOf(turnOf('And the budget?'))[0]).toBe('none');
 expect(motionOf(turnOf('Draft the long launch plan'))[0]).toBe('none');
});

test('a Conversation opened with its history moves nothing but the working line\'s words, which breathe, and are still with reduced motion', async () => {
 stubFetch(vi.fn(() => new Promise<Response>(() => {})));
 const made = { id: 4, author: 'agent' as const, author_name: 'Mona', body: 'Made it.', created_at: at, cards: [{ kind: 'made' as const, agent: { id: 'ag-9', connection_id: 'c-9', name: 'Reach', job: 'Runs Meta ads', apps: [], fresh: false, created_at: at } }] };
 await render(inShell(talk([sent, made], { pending: true, working: 'Omar' })));
 await expect.element(page.getByRole('status')).toBeVisible();
 // An Agent's face lives by itself (components/face-life), as it does on every page; nothing else moves.
 const moving = [...document.querySelectorAll('.transcript *')].filter(element => !element.closest('.fw') && getComputedStyle(element).animationName !== 'none');
 expect(moving.map(element => element.className)).toEqual(['activity__t shimmer']);
 const words = document.querySelector('.activity .shimmer')!;
 const style = getComputedStyle(words);
 expect([style.animationName, style.animationDuration, style.animationTimingFunction, style.animationIterationCount]).toEqual(['gw-breathe', '1.4s', 'ease-in-out', 'infinite']);
 expect(words.textContent).toBe('Thinking…');
 expect(document.querySelector('.ac-card')!.className).toBe('ac-card');
 await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
 onTestFinished(async () => { await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }); });
 expect([getComputedStyle(words).animationName, getComputedStyle(words).opacity]).toEqual(['none', '1']);
});

test('the card for an Agent Lead makes while the Conversation is open rises in over 280ms', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const made = { id: 4, author: 'agent' as const, author_name: 'Mona', body: 'Made it.', created_at: at, cards: [{ kind: 'made' as const, agent: { id: 'ag-9', connection_id: 'c-9', name: 'Reach', job: 'Runs Meta ads', apps: [], fresh: false, created_at: at } }] };
 stubFetch(vi.fn(async () => Response.json(talk([sent, made]))));
 await render(inShell(talk([sent], { pending: true })));
 await vi.advanceTimersByTimeAsync(500);
 await expect.poll(() => document.querySelector('.ac-card')).toBeTruthy();
 expect(motionOf(document.querySelector('.ac-card')!)).toEqual(['gw-rise', '0.28s', 'cubic-bezier(0.2, 0, 0, 1)']);
});

test('the made card moved from its own turn into the Agent\'s reply does not rise again', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const agent = { id: 'ag-9', connection_id: 'c-9', name: 'Reach', job: 'Runs Meta ads', apps: [], fresh: false, created_at: at };
 const alone = { id: 4, author: 'agent' as const, author_name: 'Mona', body: '', created_at: at, kind: 'made' as const, cards: [{ kind: 'made' as const, agent }] };
 const reply = { id: 5, author: 'agent' as const, author_name: 'Mona', body: 'Made it.', created_at: at, cards: [{ kind: 'made' as const, agent }] };
 const answers = [talk([sent, alone], { pending: true }), talk([sent, reply])];
 stubFetch(vi.fn(async () => Response.json(answers.shift() ?? talk([sent, reply]))));
 await render(inShell(talk([sent], { pending: true })));
 await vi.advanceTimersByTimeAsync(500);
 await expect.poll(() => document.querySelector('.ac-card')?.className).toBe('ac-card card-in');
 await vi.advanceTimersByTimeAsync(1500);
 await expect.poll(() => turnOf('Made it.')).toBeTruthy();
 expect(document.querySelector('.ac-card')!.className).toBe('ac-card');
});

test('a saved rule\'s line moved from under the person\'s message to under the reply does not rise again', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const rule = { id: 'r-1', agent: 'ag-1', removed: false, said_at: at };
 const early = { id: 1, author: 'agent' as const, author_name: 'Mona', body: '', created_at: at, kind: 'saved' as const, saved: [rule] };
 const reply = { id: 2, author: 'agent' as const, author_name: 'Mona', body: 'Noted.', created_at: at };
 const late = { id: 2, author: 'agent' as const, author_name: 'Mona', body: '', created_at: at, kind: 'saved' as const, saved: [rule] };
 const answers = [talk([sent, early], { pending: true }), talk([sent, reply, late])];
 stubFetch(vi.fn(async () => Response.json(answers.shift() ?? talk([sent, reply, late]))));
 await render(inShell(talk([sent], { pending: true })));
 const line = () => document.querySelector('[data-kind="saved"]');
 await vi.advanceTimersByTimeAsync(500);
 await expect.poll(() => line()?.classList.contains('msg-in')).toBe(true);
 await vi.advanceTimersByTimeAsync(1500);
 await expect.poll(() => turnOf('Noted.')).toBeTruthy();
 expect(line()!.classList.contains('msg-in')).toBe(false);
});

// #520: the server draws the page in UTC and the reader is in Cairo, two hours ahead in November. Each message's time
// is drawn in UTC, hidden, until the page hydrates, then in the reader's own zone, with no hydration mismatch.
test('a message\'s time the server drew in UTC shows in the reader\'s own zone once the page hydrates, with no hydration error', async () => {
 const zone = (timezoneId: string) => cdp().send('Emulation.setTimezoneOverride', { timezoneId });
 onTestFinished(async () => { await zone(''); });
 const late = '2026-11-12T22:30:00Z';
 const chat: ConversationRecord = { ...waiting, messages: [
  { id: 1, author: 'person', author_name: 'Youssef', body: 'Plan this week', created_at: late },
  { id: 2, author: 'agent', author_name: 'Lead', body: 'Here is the plan.', created_at: late },
  { id: 3, author: 'agent', author_name: 'Lead', body: '', created_at: late, kind: 'decided', decided: { kind: 'request', by: 'Omar', name: 'FollowUp', at: late, made: false, reason } },
 ] };
 await zone('UTC');
 const host = document.body.appendChild(document.createElement('div'));
 host.innerHTML = renderToString(view(chat));
 const times = () => [...host.querySelectorAll('.turns time')];
 expect(times().map(time => time.textContent)).toEqual(['10:30 PM', '10:30 PM', '10:30 PM']);
 expect(times().map(time => getComputedStyle(time).visibility), 'hidden until the reader\'s zone is known').toEqual(['hidden', 'hidden', 'hidden']);
 await zone('Africa/Cairo');
 const recoverable = vi.fn();
 const root = await act(async () => hydrateRoot(host, view(chat), { onRecoverableError: recoverable }));
 try {
  await expect.poll(() => times().map(time => time.textContent)).toEqual(['12:30 AM', '12:30 AM', '12:30 AM']);
  expect(times().map(time => getComputedStyle(time).visibility)).toEqual(['visible', 'visible', 'visible']);
  expect(recoverable).not.toHaveBeenCalled();
 } finally { act(() => root.unmount()); host.remove(); }
});

// #702: Mona was removed. A Conversation made after this change keeps her id, so its head and her replies show the look
// she had, read from the Company's looks; one detached before names no Agent and shows her name's first letter.
for (const [kept, face] of [['keeps her id', 'mona'], ['names no Agent', '']] as const) test(`a Conversation whose Agent was removed and ${kept} shows ${face ? 'the look she had' : 'her name\'s first letter'}, in its head and on her replies`, async () => {
 stubFetch(vi.fn(() => new Promise<Response>(() => {})));
 const initial = talk([sent, { id: 2, author: 'agent', author_name: 'Mona', body: 'The plan, in three weeks.', created_at: at }], { conversation: { id: 'cv-9', agent_id: null, agent_name: 'Mona', face } });
 const looks: CompanyLooks = { agents: { mona: { shape: 'squircle', colour: 'jade', temperament: 'neat' } }, requests: {}, removed: { mona: 'Mona' } };
 const screen = await render(<LooksProvider looks={looks}>{view(initial)}</LooksProvider>);
 await expect.element(screen.getByText('The plan, in three weeks.')).toBeVisible();
 for (const place of [document.querySelector('.head-pill')!, document.querySelector('.turn--agent .sender')!]) {
  if (face) expect([place.querySelector<HTMLElement>('.face')?.dataset.agent, place.querySelector<HTMLElement>('.face')?.dataset.colour]).toEqual(['mona', 'jade']);
  else {
   expect(place.querySelector('.face')).toBeNull();
   expect(place.querySelector('.avatar')?.textContent).toBe('M');
  }
 }
});
