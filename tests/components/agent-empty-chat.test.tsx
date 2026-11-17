import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import type { ComponentProps } from 'react';
import AgentChat from '@/app/c/[slug]/chat/[[...agent]]/agent-chat';
import type { EmptyChat } from '@/app/agent-empty-chat';
import type { Language } from '@/lib/i18n.mjs';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/shell.css';

// An Agent's empty chat (#170): the main Agent's paragraph for its reader and its suggestions, a new Agent's state with
// its sentence to try, and neither for a Viewer. A suggestion only fills the composer: nothing is sent.
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

const fetches = vi.fn();
beforeEach(() => { push.mockClear(); fetches.mockClear(); vi.stubGlobal('fetch', fetches); });
afterEach(() => { vi.unstubAllGlobals(); });

const lead = { id: 'ag-1', connection_id: 'c-1', name: 'Lead', speciality: 'General', main: true };
const metaAds = { id: 'ag-2', connection_id: 'c-2', name: 'Meta Ads', speciality: 'Runs the Meta ads', main: false };
const made = { at: '2026-06-10T09:01:00Z', by: 'Omar', mine: false, ask: '/c/rs-learning/conversations/x' };
const metaLine = 'Plans Facebook and Instagram campaigns, watches cost per lead every day, and proposes pausing ads that waste spend.';
const metaRole: EmptyChat = { state: 'new', works: 'team', made, line: metaLine,
 handoff: 'It leaves the article as a draft, and you publish it.',
 example: 'Plan a Meta campaign for our next offer, with a budget you suggest' };

const chat = ({ agent = lead, empty, writer = true, width = 1440, language = 'en' }: { agent?: typeof lead, empty: EmptyChat, writer?: boolean, width?: number, language?: Language }) =>
 page.viewport(width, 900).then(() => render(<div className="gw" dir={language === 'ar' ? 'rtl' : 'ltr'}><LanguageProvider language={language}>
  <AgentChat slug="rs-learning" company="co-1" agent={agent} details={null} writer={writer} team empty={empty}/>
 </LanguageProvider></div>));
const suggestions = (screen: Awaited<ReturnType<typeof chat>>) => [...screen.container.querySelectorAll<HTMLButtonElement>('.suggest button')];
const box = (button: Element) => button.getBoundingClientRect();

const paragraphs: [EmptyChat, string][] = [
 [{ state: 'main', reader: 'alone', owners: [] }, 'Your main point of contact. Need a new agent? Tell it in your own words and it makes it.'],
 [{ state: 'main', reader: 'owner', owners: [] }, 'The team’s main point of contact. Need a new agent? Tell it in your own words and it makes it.'],
 [{ state: 'main', reader: 'member', owners: ['Omar'] }, 'The team’s main point of contact. Need a new agent? Tell it and it prepares the request for Omar.'],
];
for (const [empty, paragraph] of paragraphs) test(`the main Agent's empty chat speaks to its reader (${empty.state === 'main' && empty.reader}), with three suggestions in two columns, one on a phone`, async () => {
  const wide = await chat({ empty });
  await expect.element(wide.getByRole('heading', { level: 2 })).toHaveTextContent('LeadMain');
  await expect.element(wide.getByText(paragraph, { exact: true })).toBeVisible();
  const [first, second, third] = suggestions(wide);
  expect(suggestions(wide).map(button => button.textContent)).toEqual(['A new SEO articleOn what your customers search for',
   `${empty.state === 'main' && empty.reader === 'member' ? 'Ask for a new agent' : 'Make a new agent'}In your words: one for social`, 'Who is waiting on what?What is stuck today']);
  expect(box(first).top).toBe(box(second).top);
  expect(box(second).left).toBeGreaterThan(box(first).left);
  expect(box(third).left).toBe(box(first).left);
  expect(box(third).top).toBeGreaterThan(box(first).top);
  wide.unmount();
  const narrow = await chat({ empty, width: 390 });
  const tops = suggestions(narrow).map(button => box(button).top);
  expect(new Set(suggestions(narrow).map(button => box(button).left)).size).toBe(1);
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  expect(new Set(tops).size).toBe(3);
});

for (const reader of ['owner', 'member'] as const) test(`pressing each suggestion as ${reader === 'owner' ? 'the Owner' : 'a Contributor'} puts its sentence in the composer, focused, and sends nothing`, async () => {
 const screen = await chat({ empty: { state: 'main', reader, owners: ['Omar'] } });
 const field = screen.getByRole('textbox', { name: 'Message' });
 const sentences = {
  'A new SEO article': 'I need an SEO article on something our customers search for, linking to the right page on our site',
  [reader === 'owner' ? 'Make a new agent' : 'Ask for a new agent']: 'I want someone to handle our social media: posts and reels for our page',
  'Who is waiting on what?': 'Who is waiting on what today, and is anything stuck?',
 };
 for (const [title, sentence] of Object.entries(sentences)) {
  await screen.getByRole('button', { name: title, exact: false }).click();
  await expect.element(field).toHaveValue(sentence);
  await expect.element(field).toHaveFocus();
 }
 expect(fetches).not.toHaveBeenCalled();
 expect(push).not.toHaveBeenCalled();
});

test('a new Agent made from a role says whom it works with, when it was made, its line and hand-back, and its sentence fills the composer', async () => {
 const screen = await chat({ agent: metaAds, empty: metaRole });
 await expect.element(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Meta Ads');
 await expect.element(screen.getByText('Runs the Meta ads · Works with the whole team', { exact: true })).toBeVisible();
 await expect.element(screen.getByText(/at the request of Omar$/)).toBeVisible();
 expect(screen.container.querySelector('.born--empty')).not.toBeNull();
 expect(screen.container.querySelector('.born a'), 'no "See the ask" in the empty chat').toBeNull();
 await expect.element(screen.getByText(metaLine, { exact: true })).toBeVisible();
 await expect.element(screen.getByText('It leaves the article as a draft, and you publish it.', { exact: true })).toBeVisible();
 expect(screen.container.querySelector('.empty-chat__hand svg')).not.toBeNull();
 await expect.element(screen.getByText('Try starting with this sentence', { exact: true })).toBeVisible();
 await screen.getByRole('button', { name: 'Plan a Meta campaign for our next offer, with a budget you suggest' }).click();
 const field = screen.getByRole('textbox', { name: 'Message' });
 await expect.element(field).toHaveValue('Plan a Meta campaign for our next offer, with a budget you suggest');
 await expect.element(field).toHaveFocus();
 expect(fetches).not.toHaveBeenCalled();
 expect(push).not.toHaveBeenCalled();
});

test('a new Agent made without a role, working with you alone, has the generic line and the general sentence', async () => {
 const screen = await chat({ agent: { ...metaAds, speciality: '' }, empty: { state: 'new', works: 'you', line: null, handoff: null, made: null, example: 'Tell me how you’ll help me, and which tools you need' } });
 await expect.element(screen.getByText('Works with you', { exact: true })).toBeVisible();
 await expect.element(screen.getByText('Give it a first job. It’ll ask you for anything missing and get it done.', { exact: true })).toBeVisible();
 expect(screen.container.querySelector('.born')).toBeNull();
 expect(screen.container.querySelector('.empty-chat__hand')).toBeNull();
 await screen.getByRole('button', { name: 'Tell me how you’ll help me, and which tools you need' }).click();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Tell me how you’ll help me, and which tools you need');
});

const viewed: [typeof lead, EmptyChat][] = [[lead, { state: 'main', reader: 'member', owners: ['Omar'] }], [metaAds, metaRole]];
for (const [agent, empty] of viewed) test(`a Viewer reads the ${empty.state === 'main' ? "main Agent's" : "new Agent's"} empty chat without suggestions or a sentence to try`, async () => {
 const screen = await chat({ agent, empty, writer: false });
 await expect.element(screen.getByRole('heading', { level: 2 })).toHaveTextContent(agent.main ? 'LeadMain' : 'Meta Ads');
 expect(screen.container.querySelector('.suggest, .try-one')).toBeNull();
 expect(screen.container.querySelector('textarea')).toBeNull();
 await expect.element(screen.getByRole('note').filter({ hasText: 'view-only' })).toBeVisible();
});

test('in Arabic the main Agent speaks Egyptian Arabic, its suggestions read right to left, and a new Agent works with the whole team', async () => {
 const main = await chat({ empty: { state: 'main', reader: 'member', owners: ['عمر'] }, language: 'ar' });
 await expect.element(main.getByText('نقطة التواصل الأساسية للفريق. ولو محتاج وكيل جديد، قوله وهو يجهّز الطلب لـعمر.', { exact: true })).toBeVisible();
 const [first, second] = suggestions(main);
 expect(second.textContent).toBe('اطلب وكيل جديدبكلامك: يمسك السوشيال');
 expect(box(first).left).toBeGreaterThan(box(second).left);
 main.unmount();
 const fresh = await chat({ agent: metaAds, empty: { ...metaRole, line: null, handoff: null, made: null, example: 'قولي هتساعدني في إيه، وإيه الأدوات اللي محتاجها' }, language: 'ar' });
 await expect.element(fresh.getByText('Runs the Meta ads · شغال مع الفريق كله', { exact: true })).toBeVisible();
 await expect.element(fresh.getByText('جرّب تبدأ بالجملة دي', { exact: true })).toBeVisible();
});
