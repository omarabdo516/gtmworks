import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { use, type ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import ConversationView, { ConversationLoaded } from '@/app/c/[slug]/conversations/[id]/conversation';
import { LanguageProvider } from '@/lib/i18n-client';
import { MessageBox } from '@/app/conversation-composer';
import type { ConversationRecord } from '@/lib/conversation-record';
import { latestEnd, shown, type AgentRequestView } from '@/lib/conversations';
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
 usage: { input: 0, output: 0 }, pending: false, failed: false, working: null, canStop: false,
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
 conversation: { id: 'cv-2', agent_id: null, agent_name: 'Mona', face: 'c-2' }, messages, usage: { input: 0, output: 0 }, pending: false, failed: false, working: null, canStop: false, ...more,
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
 en: { line: 'This company has no AI subscription or model key connected yet, so its agents can’t reply.', connect: 'Connect one in Subscription and models', ask: 'Ask the company’s Owner to connect one in Settings.', retry: 'Send the message again to retry.' },
 ar: { line: 'الشركة دي لسه مفيهاش اشتراك ذكاء اصطناعي ولا مفتاح موديل متوصّل، فالوكلاء مش هيقدروا يردّوا.', connect: 'وصّل واحد من الاشتراك والموديلات', ask: 'اطلب من مالك الشركة يوصّل واحد من الإعدادات.', retry: 'ابعت الرسالة تاني' },
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
 en: { credit: 'Mona could not reply: the company’s model key has no credit left.', key: 'Mona could not reply: the model provider refused the company’s key or sign-in.', model: 'Mona could not reply: its model is not available from the provider.', fix: 'Check the agent’s model in Subscription and models', ask: 'Ask the company’s Owner to check it in Settings.', retry: 'Send the message again to retry.' },
 ar: { credit: 'Mona مقدرش يرد: مفتاح الموديل بتاع الشركة مفيهوش رصيد.', key: 'Mona مقدرش يرد: مزوّد الموديل رفض مفتاح الشركة أو تسجيل الدخول.', model: 'Mona مقدرش يرد: الموديل بتاعه مش متاح عند المزوّد.', fix: 'اتأكد من موديل الوكيل من الاشتراك والموديلات', ask: 'اطلب من مالك الشركة يتأكد منه من الإعدادات.', retry: 'ابعت الرسالة تاني' },
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

// #317: a job Lead handed another Agent is a quiet row under Lead's reply, drawn from gtmworks's own record: both
// faces, the arrow pointing the way the interface reads, the other Agent's name and the job.
for (const [language, line, arrow] of [['en', 'Handed to', 'M5 12h14'], ['ar', 'سلّم الشغل لـ', 'M19 12H5']] as const) test(`in ${language} a job Lead handed another Agent reads under Lead's reply with both faces and the job`, async () => {
 const record: ConversationRecord = talk([sent, { id: 2, author: 'agent', author_name: 'Lead', body: 'I handed the March intake to Ads.', created_at: at,
  cards: [{ kind: 'handed', name: 'Ads', face: 'c-3', goal: 'Plan the Meta ads for the March intake' }] }]);
 const screen = await render(view(record, language));
 const row = screen.container.querySelector('.turn--agent [data-handover]');
 expect(row).not.toBeNull();
 expect(row?.textContent).toContain(line);
 expect(row?.textContent).toContain('Ads');
 expect(row?.textContent).toContain('Plan the Meta ads for the March intake');
 expect(row?.querySelectorAll('.agent-face').length).toBe(2);
 expect(row?.querySelector('.gw-icon path')?.getAttribute('d')).toBe(arrow);
});

// #358: the Agent a job command hands the work to answers in the same chat, drawn from that Agent: its own name on the
// reply and its own face, the one the row that handed the job over shows — never the Conversation's Agent's.
test('a job command\'s answer in the main Agent\'s chat is drawn from the Agent handed the work, with its own face', async () => {
 const record: ConversationRecord = talk([
  { id: 1, author: 'person', author_name: 'Youssef', body: '/campaign Launch the December ads', created_at: at },
  { id: 2, author: 'agent', author_name: 'Mona', body: '', created_at: at, cards: [{ kind: 'handed', name: 'Reach', face: 'c-3', goal: 'Launch the December ads' }] },
  { id: 3, author: 'agent', author_name: 'Reach', agent_id: 'a-3', face: 'c-3', body: 'Three ad sets, 30 days, EGP 9,000.', created_at: at },
 ]);
 const screen = await render(view(record));
 const turns = [...screen.container.querySelectorAll('.turn--agent')];
 expect(turns.map(turn => turn.querySelector('.sender bdi')?.textContent)).toEqual(['Mona', 'Reach']);
 const handedFaces = [...turns[0].querySelectorAll('.handed__faces .agent-face')];
 expect(handedFaces.map(face => face.getAttribute('aria-label'))).toEqual(['Mona', 'Reach']);
 const replyFace = turns[1].querySelector('.agent-face');
 expect(replyFace?.getAttribute('aria-label')).toBe('Reach');
 // The drawing is keyed by the Agent's connection, so the reply wears the same face the row shows for it.
 expect(replyFace?.innerHTML).toBe(handedFaces[1].innerHTML);
 expect(replyFace?.innerHTML).not.toBe(handedFaces[0].innerHTML);
});

// A handed job keeps the chat asking for Lead's follow-up reply, even though the Run that handed it over has ended.
test('a handed job keeps the chat asking until Lead\'s follow-up reply is in the record', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const handed: ConversationRecord = { ...talk([sent, { id: 2, author: 'agent', author_name: 'Lead', body: 'I handed it to Ads.', created_at: at,
  cards: [{ kind: 'handed', name: 'Ads', face: 'c-3', goal: 'Plan the Meta ads' }] }]), handover: true };
 const replied: ConversationRecord = talk([...handed.messages, { id: 3, author: 'agent', author_name: 'Lead', body: 'Ads planned three ad sets.', created_at: at }]);
 const asks = vi.fn(async () => Response.json(replied));
 vi.stubGlobal('fetch', asks);
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
