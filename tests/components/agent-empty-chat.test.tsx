import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { act } from 'react';
import AgentChat from '@/app/c/[slug]/chat/[[...agent]]/agent-chat';
import type { EmptyChat } from '@/app/agent-empty-chat';
import type { AgentDetailsView } from '@/app/agent-details-server';
import type { Language } from '@/lib/i18n.mjs';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/globals.css';
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

const chat = ({ agent = lead, empty, writer = true, width = 1440, language = 'en', agents, details = null }: { agent?: typeof lead, empty: EmptyChat, writer?: boolean, width?: number, language?: Language, agents?: ComponentProps<typeof AgentChat>['agents'], details?: ComponentProps<typeof AgentChat>['details'] }) =>
 page.viewport(width, 900).then(() => render(<div className="gw" dir={language === 'ar' ? 'rtl' : 'ltr'}><LanguageProvider language={language}>
  <AgentChat slug="rs-learning" company="co-1" agent={agent} details={details} writer={writer} team empty={empty} agents={agents}/>
 </LanguageProvider></div>));
const suggestions = (screen: Awaited<ReturnType<typeof chat>>) => [...screen.container.querySelectorAll<HTMLButtonElement>('.suggest button')];
const chips = (screen: Awaited<ReturnType<typeof chat>>) => [...screen.container.querySelectorAll<HTMLButtonElement>('.agent-picker .chip')];
const box = (button: Element) => button.getBoundingClientRect();

const paragraphs: [EmptyChat, string][] = [
 [{ state: 'main', reader: 'alone', owners: [] }, 'Your main point of contact. Need a new agent? Tell it in your own words and it makes it.'],
 [{ state: 'main', reader: 'owner', owners: [] }, 'The team’s main point of contact. Need a new agent? Tell it in your own words and it makes it.'],
 [{ state: 'main', reader: 'member', owners: ['Omar'] }, 'The team’s main point of contact. Need a new agent? Tell it and it prepares the request for Omar.'],
 [{ state: 'main', reader: 'member', owners: [] }, 'The team’s main point of contact. Need a new agent? Tell it and it prepares the request for the Owner.'],
];
for (const [empty, paragraph] of paragraphs) test(`the main Agent's empty chat speaks to its reader (${empty.state === 'main' && `${empty.reader}${empty.owners.length ? ' of ' + empty.owners.join(', ') : ''}`}), with three suggestions in two columns, one on a phone`, async () => {
  const wide = await chat({ empty });
  await expect.element(wide.getByRole('heading', { level: 2 })).toHaveTextContent('LeadMain');
  await expect.element(wide.getByText(paragraph, { exact: true })).toBeVisible();
  const [first, second, third] = suggestions(wide);
  expect(suggestions(wide).map(button => button.textContent)).toEqual(['A new SEO articleOn what your customers search for',
   `${empty.state === 'main' && empty.reader === 'member' ? 'Ask for a new agent' : 'Make a new agent'}In your words: one for social`, 'Who is waiting on what?What is stuck today']);
  expect(box(first).top).toBe(box(second).top);
  for (const button of suggestions(wide)) for (const line of button.querySelectorAll('b, span')) expect(box(line).left - box(button).left, 'each line starts at the button\'s start padding').toBe(16);
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

for (const reader of ['owner', 'member'] as const) test(`pressing each suggestion as ${reader === 'owner' ? 'the Owner' : 'a Contributor'} puts its sentence in the composer, each on its own line after the last, focused, and sends nothing`, async () => {
 const screen = await chat({ empty: { state: 'main', reader, owners: ['Omar'] } });
 const field = screen.getByRole('textbox', { name: 'Message' });
 const sentences = {
  'A new SEO article': 'I need an SEO article on something our customers search for, linking to the right page on our site',
  [reader === 'owner' ? 'Make a new agent' : 'Ask for a new agent']: 'I want someone to handle our social media: posts and reels for our page',
  'Who is waiting on what?': 'Who is waiting on what today, and is anything stuck?',
 };
 const pressed: string[] = [];
 for (const [title, sentence] of Object.entries(sentences)) {
  await screen.getByRole('button', { name: title, exact: false }).click();
  pressed.push(sentence);
  await expect.element(field).toHaveValue(pressed.join('\n'));
  await expect.element(field).toHaveFocus();
 }
 expect(fetches).not.toHaveBeenCalled();
 expect(push).not.toHaveBeenCalled();
});

test('with no Owner to name, asking for an Agent and the first-run line say the request goes to the Owner', async () => {
 const hint = await page.viewport(1440, 900).then(() => render(<div className="gw"><LanguageProvider language="en">
  <AgentChat slug="rs-learning" company="co-1" agent={lead} details={null} writer team empty={{ state: 'main', reader: 'member', owners: [] }} newAgent askOf={[]}/>
 </LanguageProvider></div>));
 await expect.element(hint.getByText('Tell Lead what you need an agent for, and it prepares the request for the Owner.', { exact: true })).toBeVisible();
 hint.unmount();
 const welcome = await page.viewport(1440, 900).then(() => render(<div className="gw"><LanguageProvider language="en">
  <AgentChat slug="rs-learning" company="co-1" agent={lead} details={null} writer team empty={{ state: 'fresh' }} askOf={[]}/>
 </LanguageProvider></div>));
 await expect.element(welcome.getByText('I’m Lead and I run your marketing work with you. Need an agent for any job? Tell me in your own words and I’ll prepare the request for the Owner.', { exact: true })).toBeVisible();
});

test('once a message is sent, the box takes no second message or suggestion while the page moves to its Conversation', async () => {
 fetches.mockImplementation(async () => new Response('{}', { status: 200 }));
 const screen = await chat({ empty: { state: 'main', reader: 'owner', owners: [] } });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await field.fill('Plan next week');
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => push.mock.calls.length).toBe(1);
 await screen.getByRole('button', { name: 'Who is waiting on what?', exact: false }).click();
 await expect.element(field).toHaveValue('Plan next week');
 await userEvent.click(field);
 await userEvent.keyboard('{Enter}');
 await new Promise(resolve => setTimeout(resolve, 100));
 expect(fetches).toHaveBeenCalledTimes(1);
});

test('a suggestion keeps the text already typed and adds its sentence on the next line, focused at its end', async () => {
 const screen = await chat({ empty: { state: 'main', reader: 'owner', owners: [] } });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await field.fill('First, the numbers');
 await screen.getByRole('button', { name: 'Who is waiting on what?', exact: false }).click();
 const both = 'First, the numbers\nWho is waiting on what today, and is anything stuck?';
 await expect.element(field).toHaveValue(both);
 await expect.element(field).toHaveFocus();
 expect((field.element() as HTMLTextAreaElement).selectionStart).toBe(both.length);
 expect(fetches).not.toHaveBeenCalled();
});

test('a suggestion pressed while a message is on its way leaves the composer that is sending it, and once the send fails it follows the unsent text', async () => {
 let answer: (response: Response) => void = () => {};
 fetches.mockImplementation(() => new Promise<Response>(resolve => { answer = resolve; }));
 const screen = await chat({ empty: { state: 'main', reader: 'owner', owners: [] } });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await field.fill('Plan next week');
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => fetches.mock.calls.length).toBe(1);
 await screen.getByRole('button', { name: 'A new SEO article', exact: false }).click();
 await expect.element(field).toHaveValue('Plan next week');
 answer(new Response(JSON.stringify({ error: 'conversationFailed' }), { status: 500 }));
 await expect.poll(() => screen.container.querySelector('textarea')?.readOnly).toBe(false);
 await screen.getByRole('button', { name: 'A new SEO article', exact: false }).click();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Plan next week\nI need an SEO article on something our customers search for, linking to the right page on our site');
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

// The known empty chat (#171): the faces of every Agent this Member sees, the heading, the line, a chip for each Agent
// (the main one first, the opened one pressed) and the reference's two general suggestions. Picking a chip turns the page
// into that Agent's empty chat with no navigation: the title, the details, the placeholder and the suggestion follow, and
// the chip keeps the focus. Nothing is sent until a message is.
const seo = { id: 'ag-3', connection_id: 'c-3', name: 'SEO', speciality: 'Writes the blog', main: false };
const knownMeta: EmptyChat = { state: 'known', example: 'Plan a Meta campaign for our next offer, with a budget you suggest' };
const knownSeo: EmptyChat = { state: 'known', example: 'Suggest five articles about the accountancy course' };
const mainMember: EmptyChat = { state: 'main', reader: 'member', owners: ['Omar'] };
const seoNew: EmptyChat = { state: 'new', works: 'team', line: 'Writes the blog.', handoff: null, example: 'Suggest five articles about the accountancy course', made: null };
const detailsOf = (name: string) => ({ status: 'idle', tab: 'activity', tabs: { activity: <p>Activity of {name}</p>, tasks: null, files: null, log: null } } as unknown as AgentDetailsView);
// Every Agent this Member sees, the main Agent first, each with its own state and details, as the page hands them over.
const seen = [
 { agent: lead, empty: mainMember, details: detailsOf('Lead') },
 { agent: seo, empty: seoNew, details: detailsOf('SEO') },
 { agent: metaAds, empty: knownMeta, details: detailsOf('Meta Ads') },
];
const seenKnown = [{ agent: lead, empty: mainMember, details: detailsOf('Lead') }, { agent: seo, empty: knownSeo, details: detailsOf('SEO') }, { agent: metaAds, empty: knownMeta, details: detailsOf('Meta Ads') }];

test('an Agent the Member already writes to shows the faces of every Agent they see, what this chat asks, and one chip each, the main Agent first and its own chip pressed', async () => {
 const screen = await chat({ agent: metaAds, empty: knownMeta, agents: seen, details: detailsOf('Meta Ads') });
 await expect.element(screen.getByRole('heading', { level: 2 })).toHaveTextContent('What should we work on today?');
 const line = screen.container.querySelector('.empty-chat p')!;
 expect(line.textContent).toBe('Pick the agent you want to talk to, or type @ in your message to call any of them.');
 expect(line.querySelector('bdi')?.textContent).toBe('@');
 expect(screen.container.querySelectorAll('.empty-chat__faces .face')).toHaveLength(3);
 expect(chips(screen).map(chip => chip.textContent)).toEqual(['Lead', 'SEO', 'Meta Ads']);
 expect(chips(screen).map(chip => chip.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
 expect(screen.container.querySelector('.agent-picker')?.getAttribute('aria-label')).toBe('Pick an agent');
 expect(suggestions(screen).map(button => button.textContent)).toEqual(['Tell me what you can doand the tools you need', 'Start with a first jobPlan a Meta campaign for our next offer, with a budget you suggest']);
 // A chip carries a face of its own, hidden from the reader who hears the Agent's name beside it.
 expect(chips(screen).every(chip => chip.querySelector('.chip__face[aria-hidden="true"] .face'))).toBe(true);
});

test('a Viewer sees the faces, the line and the picker of the known empty chat, and no suggestions', async () => {
 const screen = await chat({ agent: metaAds, empty: knownMeta, agents: seen, details: detailsOf('Meta Ads'), writer: false });
 expect(screen.container.querySelector('.suggest')).toBeNull();
 expect(chips(screen)).toHaveLength(3);
 expect(screen.container.querySelector('textarea')).toBeNull();
 await expect.element(screen.getByRole('note').filter({ hasText: 'view-only' })).toBeVisible();
 await screen.getByRole('button', { name: 'Lead', exact: true }).click();
 await expect.element(screen.getByRole('heading', { level: 2 })).toHaveTextContent('LeadMain');
});

test('picking an Agent the Member writes to turns the page into that Agent\'s empty chat: its chip pressed and focused, and the title, the details and the placeholder follow it', async () => {
 const screen = await chat({ agent: seo, empty: knownSeo, agents: seenKnown, details: detailsOf('SEO') });
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Write to SEO…');
 await expect.element(screen.getByRole('button', { name: 'New chat · Details: SEO' })).toBeVisible();
 const meta = screen.getByRole('button', { name: 'Meta Ads', exact: true });
 await meta.click();
 await expect.element(meta).toHaveAttribute('aria-pressed', 'true');
 await expect.element(meta).toHaveFocus();
 await expect.element(screen.getByRole('button', { name: 'New chat · Details: Meta Ads' })).toBeVisible();
 await expect.element(screen.getByRole('complementary', { name: 'Details: Meta Ads' })).toBeVisible();
 expect(screen.container.querySelector('.dp-sections')?.textContent).toBe('Activity of Meta Ads');
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Write to Meta Ads…');
 await expect.element(screen.getByRole('heading', { level: 2 })).toHaveTextContent('What should we work on today?');
 expect(suggestions(screen)[1].textContent).toBe('Start with a first jobPlan a Meta campaign for our next offer, with a budget you suggest');
});

test('picking the main Agent shows its own empty chat, and picking an Agent not written to yet shows the new Agent\'s', async () => {
 const screen = await chat({ agent: metaAds, empty: knownMeta, agents: seen, details: detailsOf('Meta Ads') });
 await screen.getByRole('button', { name: 'Lead', exact: true }).click();
 await expect.element(screen.getByText('The team’s main point of contact. Need a new agent? Tell it and it prepares the request for Omar.', { exact: true })).toBeVisible();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Write to Lead…');
 await expect.element(screen.getByRole('heading', { level: 2 }), { message: 'the focus moves into the empty chat the pick opened' }).toHaveFocus();
 expect(screen.container.querySelector('.agent-picker'), 'the main Agent draws no picker').toBeNull();
 screen.unmount();
 const other = await chat({ agent: metaAds, empty: knownMeta, agents: seen, details: detailsOf('Meta Ads') });
 await other.getByRole('button', { name: 'SEO', exact: true }).click();
 await expect.element(other.getByRole('heading', { level: 2 })).toHaveTextContent('SEO');
 await expect.element(other.getByText('Writes the blog · Works with the whole team', { exact: true })).toBeVisible();
 await expect.element(other.getByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Write to SEO…');
 await expect.element(other.getByRole('complementary', { name: 'Details: SEO' })).toBeVisible();
 await expect.element(other.getByRole('heading', { level: 2 })).toHaveFocus();
 expect(other.container.querySelector('.agent-picker')).toBeNull();
});

test('the two general suggestions fill the composer with the title, a colon and the second line, and send nothing', async () => {
 const screen = await chat({ agent: metaAds, empty: knownMeta, agents: seen, details: detailsOf('Meta Ads') });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await screen.getByRole('button', { name: 'Tell me what you can do', exact: false }).click();
 await expect.element(field).toHaveValue('Tell me what you can do: and the tools you need');
 await expect.element(field).toHaveFocus();
 await screen.getByRole('button', { name: 'Start with a first job', exact: false }).click();
 await expect.element(field).toHaveValue('Tell me what you can do: and the tools you need\nStart with a first job: Plan a Meta campaign for our next offer, with a budget you suggest');
 expect(fetches).not.toHaveBeenCalled();
 expect(push).not.toHaveBeenCalled();
});

test('an Agent with no first sentence of its own says what to write, and a Viewer is offered neither suggestion', async () => {
 const screen = await chat({ agent: metaAds, empty: { state: 'known', example: null }, agents: seen, details: detailsOf('Meta Ads') });
 expect(suggestions(screen).map(button => button.textContent)).toEqual(['Tell me what you can doand the tools you need', 'Start with a first jobWrite it what you need']);
 await screen.getByRole('button', { name: 'Start with a first job', exact: false }).click();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Start with a first job: Write it what you need');
 screen.unmount();
 const viewer = await chat({ agent: metaAds, empty: knownMeta, agents: seen, details: detailsOf('Meta Ads'), writer: false });
 expect(viewer.container.querySelector('.suggest')).toBeNull();
});

test('a message sent after picking starts the Conversation with the picked Agent', async () => {
 fetches.mockImplementation(async () => new Response('{}', { status: 200 }));
 const screen = await chat({ agent: seo, empty: knownSeo, agents: seenKnown, details: detailsOf('SEO') });
 await screen.getByRole('button', { name: 'Meta Ads', exact: true }).click();
 const field = screen.getByRole('textbox', { name: 'Message' });
 await field.fill('Plan the June campaign');
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => fetches.mock.calls.length).toBe(1);
 const body = JSON.parse(String(fetches.mock.calls[0][1].body));
 expect(body.agent).toBe('ag-2');
 await expect.poll(() => push.mock.calls.length).toBe(1);
 expect(String(push.mock.calls[0][0])).toMatch(/^\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
});

test('a send that failed for one Agent retries into the Agent picked after it, in a Conversation of its own, keeping the text', async () => {
 let attempt = 0;
 fetches.mockImplementation(async () => ++attempt === 1
  ? new Response(JSON.stringify({ error: 'conversationFailed' }), { status: 500 })
  : new Response('{}', { status: 200 }));
 const screen = await chat({ agent: seo, empty: knownSeo, agents: seenKnown, details: detailsOf('SEO') });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await field.fill('Plan next week');
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => screen.container.querySelector('textarea')?.readOnly).toBe(false);
 const first = JSON.parse(String(fetches.mock.calls[0][1].body));
 expect(first.agent).toBe('ag-3');
 await screen.getByRole('button', { name: 'Meta Ads', exact: true }).click();
 await expect.element(field).toHaveValue('Plan next week');
 await userEvent.click(field);
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => fetches.mock.calls.length).toBe(2);
 const second = JSON.parse(String(fetches.mock.calls[1][1].body));
 expect(second.agent).toBe('ag-2');
 expect(second.conversation).toMatch(/^[0-9a-f-]{36}$/);
 expect(second.conversation).not.toBe(first.conversation);
});

test('returning to an Agent whose send failed reuses its Conversation and retry key', async () => {
 let attempt = 0;
 fetches.mockImplementation(async () => ++attempt === 1
  ? new Response(JSON.stringify({ error: 'conversationFailed' }), { status: 500 })
  : new Response('{}', { status: 200 }));
 const screen = await chat({ agent: seo, empty: knownSeo, agents: seenKnown, details: detailsOf('SEO') });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await field.fill('Plan next week');
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => screen.container.querySelector('textarea')?.readOnly).toBe(false);
 const first = JSON.parse(String(fetches.mock.calls[0][1].body));
 expect(first.agent).toBe('ag-3');
 // A → B → A: coming back to SEO keeps the Conversation and the send key its failed send used.
 await screen.getByRole('button', { name: 'Meta Ads', exact: true }).click();
 await expect.element(field).toHaveValue('Plan next week');
 await screen.getByRole('button', { name: 'SEO', exact: true }).click();
 await expect.element(field).toHaveValue('Plan next week');
 await userEvent.click(field);
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => fetches.mock.calls.length).toBe(2);
 const second = JSON.parse(String(fetches.mock.calls[1][1].body));
 expect(second.agent).toBe('ag-3');
 expect(second.conversation).toBe(first.conversation);
 expect(second.sendKey).toBe(first.sendKey);
});

test('a pick while a send is on its way is ignored, so the pending send still opens its own Conversation', async () => {
 let answer: (response: Response) => void = () => {};
 fetches.mockImplementation(() => new Promise<Response>(resolve => { answer = resolve; }));
 const screen = await chat({ agent: seo, empty: knownSeo, agents: seenKnown, details: detailsOf('SEO') });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await field.fill('Plan next week');
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => fetches.mock.calls.length).toBe(1);
 const body = JSON.parse(String(fetches.mock.calls[0][1].body));
 expect(body.agent).toBe('ag-3');
 const meta = screen.getByRole('button', { name: 'Meta Ads', exact: true });
 const seoChip = screen.getByRole('button', { name: 'SEO', exact: true });
 expect(meta.element().getAttribute('aria-disabled')).toBe('true');
 expect(seoChip.element().getAttribute('aria-disabled')).toBe('true');
 await act(async () => { meta.element().dispatchEvent(new MouseEvent('click', { bubbles: true })); });
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Write to SEO…');
 await expect.element(screen.getByRole('button', { name: 'New chat · Details: SEO' })).toBeVisible();
 answer(new Response('{}', { status: 200 }));
 await expect.poll(() => push.mock.calls.length).toBe(1);
 expect(String(push.mock.calls[0][0])).toMatch(/^\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
});

test('in Arabic the known empty chat speaks Egyptian Arabic, its picker and its two suggestions read right to left', async () => {
 const screen = await chat({ agent: metaAds, empty: { state: 'known', example: 'خطط حملة ميتا للعرض الجاي، بميزانية تقترحها' }, agents: seen, details: detailsOf('Meta Ads'), language: 'ar' });
 await expect.element(screen.getByRole('heading', { level: 2 })).toHaveTextContent('تحب نشتغل على إيه النهارده؟');
 expect(screen.container.querySelector('.empty-chat p')?.textContent).toBe('اختار الوكيل اللي هتكلمه، أو اكتب @ في الرسالة عشان تنادي أي حد فيهم.');
 expect(screen.container.querySelector('.agent-picker')?.getAttribute('aria-label')).toBe('اختار الوكيل');
 expect(suggestions(screen).map(button => button.textContent)).toEqual(['قولي بتعرف تعمل إيهوالأدوات اللي محتاجها', 'ابدأ بأول شغلانةخطط حملة ميتا للعرض الجاي، بميزانية تقترحها']);
 expect(box(chips(screen)[0]).left).toBeGreaterThan(box(chips(screen)[1]).left);
 await screen.getByRole('button', { name: 'قولي بتعرف تعمل إيه', exact: false }).click();
 await expect.element(screen.getByRole('textbox')).toHaveValue('قولي بتعرف تعمل إيه: والأدوات اللي محتاجها');
});
