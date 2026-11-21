import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { use, type ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { cdp, page } from 'vitest/browser';
// Gives cdp() Playwright's session type (its send), as the config's provider does at run time.
import type {} from '@vitest/browser-playwright';
import ConversationView, { ConversationLoaded } from '@/app/c/[slug]/conversations/[id]/conversation';
import { LanguageProvider } from '@/lib/i18n-client';
import { MessageBox } from '@/app/conversation-composer';
import type { ConversationRecord } from '@/lib/conversation-record';
import { latestEnd, shown, withHandedOn, withHandoverAnswers, type AgentRequestView } from '@/lib/conversations';
import '@/app/tokens.css';
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
 expect(row?.querySelectorAll('.agent-face').length).toBe(2);
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
  expect([...row!.querySelectorAll('.agent-face')].map(face => face.getAttribute('aria-label'))).toEqual(['Writer', 'Ads']);
  // The answer wears the asked Agent's own face, the one the row draws for it, and says whom it went to.
  expect(turns[1].querySelector('.sender .agent-face')?.innerHTML).toBe(row!.querySelectorAll('.agent-face')[1].innerHTML);
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
  expect([...step.querySelectorAll('.agent-face')].map(face => face.getAttribute('aria-label'))).toEqual(['Ads', 'Critic']);
  expect(step.closest('.turn')).toBeNull();
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
  cards: [{ kind: 'handed', from: { name: 'Lead', face: 'c-2' }, name: 'Ads', face: 'c-3', goal: 'Plan the Meta ads' }] }]), handover: true };
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
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(answers.shift() ?? answers.at(-1))));
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
 vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
 const made = { id: 4, author: 'agent' as const, author_name: 'Mona', body: 'Made it.', created_at: at, cards: [{ kind: 'made' as const, agent: { id: 'ag-9', connection_id: 'c-9', name: 'Reach', job: 'Runs Meta ads', apps: [], fresh: false, created_at: at } }] };
 await render(inShell(talk([sent, made], { pending: true, working: 'Omar' })));
 await expect.element(page.getByRole('status')).toBeVisible();
 const moving = [...document.querySelectorAll('.transcript *')].filter(element => getComputedStyle(element).animationName !== 'none');
 expect(moving.map(element => element.className)).toEqual(['shimmer']);
 const words = document.querySelector('.thinking .shimmer')!;
 const style = getComputedStyle(words);
 expect([style.animationName, style.animationDuration, style.animationTimingFunction, style.animationIterationCount]).toEqual(['gw-breathe', '1.4s', 'ease-in-out', 'infinite']);
 expect(words.textContent).toContain('Omar');
 expect(document.querySelector('.ac-card')!.className).toBe('ac-card');
 await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
 onTestFinished(async () => { await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }); });
 expect([getComputedStyle(words).animationName, getComputedStyle(words).opacity]).toEqual(['none', '1']);
});

test('the card for an Agent Lead makes while the Conversation is open rises in over 280ms', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const made = { id: 4, author: 'agent' as const, author_name: 'Mona', body: 'Made it.', created_at: at, cards: [{ kind: 'made' as const, agent: { id: 'ag-9', connection_id: 'c-9', name: 'Reach', job: 'Runs Meta ads', apps: [], fresh: false, created_at: at } }] };
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(talk([sent, made]))));
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
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(answers.shift() ?? talk([sent, reply]))));
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
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(answers.shift() ?? talk([sent, reply, late]))));
 await render(inShell(talk([sent], { pending: true })));
 const line = () => document.querySelector('[data-kind="saved"]');
 await vi.advanceTimersByTimeAsync(500);
 await expect.poll(() => line()?.classList.contains('msg-in')).toBe(true);
 await vi.advanceTimersByTimeAsync(1500);
 await expect.poll(() => turnOf('Noted.')).toBeTruthy();
 expect(line()!.classList.contains('msg-in')).toBe(false);
});
