import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import ChannelView from '@/app/c/[slug]/channels/[id]/channel';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ChannelMessage, ChannelQuestion, ChannelRecord } from '@/lib/channels';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('@/app/channel-actions', () => ({ changeChannel: vi.fn(), channelChoices: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); });

// #149: a question or a handed step in a channel is the team's. Any Member who may write answers it or presses "Done it";
// a Viewer reads the same card with no buttons and the team's wait line; the main Agent's own chips are the Member's
// whose message it answers, and everyone else reads "Waiting for <first name>". Both languages, as the channel draws them.
const at = '2026-06-10T09:05:00Z';
const record = (messages: ChannelMessage[], more: Partial<ChannelRecord> = {}): ChannelRecord => ({
 channel: { id: 'ch-1', company: 'co-1', kind: 'general' },
 members: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }, { person: 'p-2', name: 'Sara Adel', role: 'manager', invitation: null, email: null }],
 agents: [{ id: 'a-1', connection_id: 'c-1', name: 'Ads', speciality: 'Runs the ads.', main: false, only: false, state: 'idle' }, { id: 'a-2', connection_id: 'c-2', name: 'Lead', speciality: 'General', main: true, only: false, state: 'idle' }],
 writer: true, manage: false, managers: [], may: ['once', 'always', 'deny'], messages, handoffs: [], open: messages.some(message => message.author === 'person' && message.mention?.state === 'open'), handover: false, ...more,
});
const channel = (initial: ChannelRecord, language: 'en' | 'ar') => render(<LanguageProvider language={language}><ChannelView person="p-1" initial={initial}/></LanguageProvider>);

const asked = (chips: boolean): ChannelQuestion => ({ id: 31, kind: 'question', title: 'Which angle first?', question: 'Which angle first?', choices: ['Graduates', 'Parents'], multiple: false, state: 'open', chips });
const questionFrom = (agent: string, mine: boolean, name: string, chips: boolean): ChannelMessage => ({ id: 10, author: 'person', mine, name, role: 'owner', body: `@${agent} take a look`, at,
 mention: { agent, face: chips ? 'c-2' : 'c-1', state: 'open', permissions: [], questions: [asked(chips)] } });
const handedReply: ChannelMessage = { id: 11, author: 'agent', name: 'SEO', face: 'c-2', body: 'The article is ready except publishing.', at,
 cards: [{ id: 41, kind: 'hand', title: 'Publish the article', line: 'The draft is ready in WordPress', app: 'WordPress', rows: [], url: null, note: null, state: 'open' }] };
const held = () => vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));

test.each([
 ['en', 'Sara Adel'],
 ['ar', 'سارة عادل'],
] as const)('in the %s interface any writer answers a channel question once, and the record names them, then presses Done it on a handed step', async (language, name) => {
 const sent: Record<string, unknown>[] = [];
 vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
  if (init?.method === 'POST') { const body = JSON.parse(String(init.body)); sent.push(body); return Promise.resolve(Response.json(body.intent === 'answer' ? { state: 'claimed', answerer: 'p-1' } : { state: 'done', at, first: true })); }
  return new Promise<Response>(() => {});
 });
 const screen = await channel(record([questionFrom('Ads', false, name, false), handedReply]), language);
 const question = screen.getByRole('group', { name: 'Which angle first?' });
 await expect.element(question).toBeVisible();
 await expect.element(question).toHaveAttribute('id', 'question-31');
 expect(question.getByRole('button').elements().map(button => button.querySelector('.opt__t')?.textContent)).toEqual(['Graduates', 'Parents']);
 await question.getByRole('button', { name: 'Parents' }).click();
 await expect.poll(() => sent.find(body => body.intent === 'answer')).toEqual({ company: 'co-1', channel: 'ch-1', intent: 'answer', card: 31, choice: 1, answerKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
 // The first answer closes the card for everyone: it shows the choice, with a check.
 const answered = screen.getByRole('group', { name: `Which angle first?: ${language === 'ar' ? 'اتجاوب' : 'Answered'}` });
 await expect.element(answered).toBeVisible();
 expect(answered.getByRole('button').elements()).toEqual([]);
 expect(answered.element().textContent).toContain('Parents');
 const hand = screen.getByRole('group', { name: language === 'ar' ? 'اتسلّمتلك: Publish the article' : 'Handed to you: Publish the article' });
 const done = hand.getByRole('button', { name: language === 'ar' ? 'عملتها' : 'Done it' });
 await expect.element(done).toBeVisible();
 await done.click();
 await expect.poll(() => sent.find(body => body.intent === 'done')).toEqual({ company: 'co-1', channel: 'ch-1', intent: 'done', card: 41 });
 // And the step reads done, with its time, and nothing left to press.
 await expect.element(hand).toHaveClass(/is-resolved/);
 expect(hand.element().querySelector('.card__outcome')).not.toBeNull();
 expect(hand.getByRole('button').elements()).toEqual([]);
});

test.each([
 ['en', 'Waiting for someone on the team to pick', 'Waiting for someone on the team to do it'],
 ['ar', 'مستني حد من الفريق يختار', 'مستني حد من الفريق يعملها'],
] as const)('in the %s interface a Viewer reads a channel question as plain rows under the team\'s wait line and a handed step with no button, and the card is where "Waiting on you" opens it', async (language, pick, doIt) => {
 held();
 const name = language === 'ar' ? 'سارة عادل' : 'Sara Adel';
 const screen = await channel(record([questionFrom('Ads', false, name, false), handedReply], { writer: false, may: [] }), language);
 const question = screen.getByRole('group', { name: 'Which angle first?' });
 await expect.element(question.getByText(pick, { exact: true })).toBeVisible();
 expect(question.element().querySelectorAll('.opt--static')).toHaveLength(2);
 expect(question.getByRole('button').elements()).toEqual([]);
 await expect.element(question).toHaveAttribute('id', 'question-31');
 const hand = screen.getByRole('group', { name: language === 'ar' ? 'اتسلّمتلك: Publish the article' : 'Handed to you: Publish the article' });
 await expect.element(hand.getByText(doIt, { exact: true })).toBeVisible();
 expect(hand.getByRole('button').elements()).toEqual([]);
 await expect.element(hand).toHaveAttribute('id', 'hand-41');
});

test.each([
 ['en', 'Waiting for Sara'],
 ['ar', 'مستني سارة'],
] as const)('in the %s interface the main Agent\'s chips are only the asked Member\'s, and everyone else reads who it waits for', async (language, waiting) => {
 held();
 const name = language === 'ar' ? 'سارة عادل' : 'Sara Adel';
 const screen = await channel(record([questionFrom('Lead', false, name, true)]), language);
 const card = screen.getByRole('group', { name: 'Which angle first?' });
 await expect.element(card.getByText(waiting, { exact: true })).toBeVisible();
 expect(card.getByRole('button').elements()).toEqual([]);
});

test.each([
 ['en', 'Omar'],
 ['ar', 'عمر'],
] as const)('in the %s interface the Member whose message the main Agent answers gets the chips, and the others\' cards stay theirs', async (language, name) => {
 held();
 const screen = await channel(record([questionFrom('Lead', true, name, true)]), language);
 const card = screen.getByRole('group', { name: 'Which angle first?' });
 await expect.element(card).toBeVisible();
 expect(card.getByRole('button').elements().map(chip => chip.textContent)).toEqual(['Graduates', 'Parents']);
 expect(card.getByRole('button').elements().every(chip => chip.classList.contains('chip'))).toBe(true);
 await expect.element(card.getByText(language === 'ar' ? 'أو اكتب الإجابة تحت' : 'or type the answer below', { exact: true })).toBeVisible();
});
