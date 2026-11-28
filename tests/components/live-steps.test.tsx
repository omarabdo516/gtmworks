import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { render } from 'vitest-browser-react';
import { cdp } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { ConversationTurns } from '@/app/conversation-thread';
import ConversationView, { EngineLoaded } from '@/app/c/[slug]/conversations/[id]/conversation';
import ChannelView from '@/app/c/[slug]/channels/[id]/channel';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ConversationRecord } from '@/lib/conversation-frame';
import type { ChannelMessage, ChannelRecord } from '@/lib/channels';
import type { LiveLine } from '@/lib/live-steps.mjs';
import type { LiveRun } from '@/app/run-activity';
import '@/app/tokens.css';
import '@/app/shell.css';

// #646: while an Agent works, the line under the transcript names the step it is on now and the turn's steps list fills
// in. A Conversation draws them from the view of its open Run the page reads live (#876, `live`); a channel from the Run's
// calls as a fake Engine streams them (app/api/run-steps). Before any view, the line reads "Thinking" (#763), and the
// reply still lands.
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/conversations/cv-1', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('@/app/channel-actions', () => ({ changeChannel: vi.fn(), channelChoices: vi.fn() }));
vi.mock('@/app/channel-archive-actions', () => ({ archiveChannels: vi.fn() }));
vi.mock('@/app/conversation-archive-actions', () => ({ archiveConversations: vi.fn() }));
const reducedMotion = (on: boolean) => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
afterEach(async () => { vi.unstubAllGlobals(); await reducedMotion(false); });

// The fake Engine's stream for a channel, line by line, as the route passes it on; every other read waits for ever.
function engine() {
 const asked: string[] = [];
 let send: (line: LiveLine) => void = () => {}; let end: () => void = () => {};
 vi.stubGlobal('fetch', (url: string) => {
  asked.push(url);
  if (!url.startsWith('/api/run-steps?')) return new Promise<Response>(() => {});
  return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) {
   send = line => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(line)}\n`));
   end = () => controller.close();
  } }), { headers: { 'Content-Type': 'application/x-ndjson' } }));
 });
 return { asked, send: (line: LiveLine) => send(line), end: () => end() };
}
const at = '2026-06-10T10:14:00Z';
const asked = { id: 1, author: 'person' as const, author_name: 'Omar', body: 'Plan the December campaign', created_at: at };
const working: ConversationRecord = { conversation: { id: 'cv-1', agent_id: 'a-1', agent_name: 'Ads', face: 'c-1' }, messages: [asked], usage: null, pending: true, failed: false, working: null, canStop: true };
const found = { tool: 'meta_ads', preview: 'campaign results August to October', state: 'done' as const };
const landed: ConversationRecord = { ...working, pending: false, working: null, canStop: false, messages: [asked,
 { id: 2, author: 'agent', author_name: 'Ads', body: 'I read the last three campaigns.', created_at: at, steps: { list: [found, { tool: 'sheets', preview: 'budget split', state: 'done' }], seconds: 41 } }] };
const page = (language: 'en' | 'ar', children: ReactNode) => <LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><div className="gw"><div className="chat">{children}</div></div></div></LanguageProvider>;
// The Conversation's transcript with the view of its open Run the page reads live: none yet (null) while it works, and
// nothing works once the reply landed.
const chat = (language: 'en' | 'ar', record: ConversationRecord, view: LiveRun | null = null, working = record.pending) => page(language,
 <ConversationTurns slug="rs-learning" company="co-1" record={record} writer asked={() => {}} live={{ view, reply: '', working }}/>);
const line = () => document.querySelector('.activity');
const step = () => document.querySelector('.activity__t');
const live = () => document.querySelector('li[data-live]');
const run = (steps: LiveRun['steps'], now: LiveRun['now'], id = 'run_1', ended?: true): LiveRun => ({ run: id, steps, now, ...(ended ? { ended } : {}) });

test.each([
 ['en', 'Thinking…', 'meta_ads · campaign results August to October…', 'Writing the reply…', 'Used 1 tool', 'Used 2 tools · 41 sec'],
 ['ar', 'بيفكر…', 'meta_ads · campaign results August to October…', 'بيكتب الرد…', 'استخدم 1 أداة', 'استخدم 2 أداة · 41 ثانية'],
] as const)('in the %s interface, the line names the Agent and its step now, the steps list fills in, and the reply takes its place', async (language, thinking, now, writing, one, two) => {
 const screen = await render(chat(language, working));
 // Before the Run's first view, the line already reads "Thinking" (#756).
 await expect.element(screen.getByRole('status')).toHaveTextContent(`Ads${thinking}`);
 await screen.rerender(chat(language, working, run([], null)));
 await expect.poll(() => step()?.textContent).toBe(thinking);
 expect(line()?.querySelector('.dot--working')).not.toBeNull();
 expect(line()?.querySelector('.activity__who')?.textContent).toBe('Ads');
 expect(line()?.getAttribute('role')).toBe('status');
 expect(step()?.classList.contains('is-swap'), 'the first step does not rise in').toBe(false);
 await screen.rerender(chat(language, working, run([], { tool: 'meta_ads', preview: 'campaign results August to October' })));
 await expect.poll(() => step()?.textContent).toBe(now);
 expect(step()?.classList.contains('is-swap'), 'each new step rises in').toBe(true);
 expect(live()?.querySelector('.sender')?.textContent, 'the reply being worked on shows before any step').toBe('Ads');
 expect(live()?.querySelector('.steps'), 'no list before a step ended').toBeNull();
 await screen.rerender(chat(language, working, run([found], null)));
 await expect.poll(() => step()?.textContent).toBe(writing);
 await expect.element(screen.getByRole('button', { name: one, exact: true })).toBeVisible();
 expect(live()?.querySelector('.sender')?.textContent).toBe('Ads');
 await screen.getByRole('button', { name: one, exact: true }).click();
 expect(live()?.querySelector('.step__label')?.textContent).toBe('meta_ads · campaign results August to October');
 await screen.rerender(chat(language, working, run([found], { tool: 'sheets', preview: null })));
 await expect.poll(() => step()?.textContent).toBe('sheets…');
 // The reply lands: the live turn and its line go, and the reply's list is the session's, drawn once, still open, and
 // the turn does not rise in again.
 await screen.rerender(chat(language, landed));
 await expect.element(screen.getByRole('button', { name: two, exact: true })).toBeVisible();
 expect(live()).toBeNull();
 expect(line()).toBeNull();
 expect(document.querySelectorAll('.steps').length).toBe(1);
 await expect.element(screen.getByRole('button', { name: two, exact: true })).toHaveAttribute('aria-expanded', 'true');
 expect(document.querySelector('[data-author="agent"]')?.classList.contains('msg-in')).toBe(false);
});

test('a reader who opens the chat mid-Run sees the step now and the steps so far at once, not an empty line', async () => {
 const screen = await render(chat('en', working, run([found, { tool: 'ga4', preview: null, state: 'failed' }], { tool: 'sheets', preview: 'budget split over 30 days' })));
 await expect.poll(() => step()?.textContent).toBe('sheets · budget split over 30 days…');
 await screen.getByRole('button', { name: 'Used 2 tools', exact: true }).click();
 expect([...live()!.querySelectorAll('.step')].map(item => item.className)).toEqual(['step step--done', 'step step--skipped']);
});

test('while no view of the Run has been read, the line reads "Thinking", never "is working on a reply" (#763), and the reply still lands', async () => {
 const screen = await render(chat('en', { ...working, pending: false }, null, true));
 await expect.element(screen.getByRole('status')).toHaveTextContent('AdsThinking…');
 expect(document.body.textContent).not.toContain('working on a reply');
 await screen.rerender(chat('en', landed));
 await expect.element(screen.getByText('I read the last three campaigns.')).toBeVisible();
 await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
});

test('a Run whose events ended keeps the step it showed until the reply is drawn (#763)', async () => {
 const screen = await render(chat('en', working, run([found], null)));
 await expect.poll(() => step()?.textContent).toBe('Writing the reply…');
 await screen.rerender(chat('en', working, run([found], null, 'run_1', true)));
 expect(step()?.textContent).toBe('Writing the reply…');
 expect(document.body.textContent).not.toContain('working on a reply');
});

// The Conversation's page follows its open Run on its own live read (app/api/conversation-live, #876): `live` answers each
// read of it, and each read of the session's messages answers the next of `reads` (the last one again). Each page is a
// Conversation of its own, since the page keeps the last read of a Conversation in this browser.
let opens = 0;
function onPage(live: () => Promise<Response>, reads: (() => Promise<Response>)[]) {
 const lives = vi.fn(live); const sessions = vi.fn(async () => (reads.length > 1 ? reads.shift()! : reads[0])());
 vi.stubGlobal('fetch', (url: string) => url.startsWith('/api/conversation-live?') ? lives() : url.includes('&intent=read') ? sessions() : url.includes('&intent=usage') ? Promise.resolve(Response.json({})) : new Promise<Response>(() => {}));
 const frame: ConversationRecord = { ...working, conversation: { ...working.conversation, id: `cv-live-${++opens}` }, messages: [], pending: false };
 return { lives, sessions, page: <LanguageProvider language="en"><div className="gw"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={frame.conversation} title="" writer><EngineLoaded initial={frame} team={false} open/></ConversationView></div></LanguageProvider> };
}
const messages = (list: ConversationRecord['messages']) => async () => Response.json({ state: 'found', messages: list, nextOffset: list.length, hasMore: false });
const lines = (...sent: unknown[]) => new Response(sent.map(line => `${JSON.stringify(line)}\n`).join(''), { headers: { 'Content-Type': 'application/x-ndjson' } });

test.each<[string, () => Promise<Response>]>([
 ['cannot be read', () => Promise.resolve(Response.json({ error: 'conversationFailed' }, { status: 500 }))],
 ['meets a network that is down', () => Promise.reject(new TypeError('Failed to fetch'))],
 ['is cut before the Run ended', () => Promise.resolve(lines())],
])('when the Conversation\'s live read %s, the line still reads "Thinking", never "is working on a reply" (#763), and it is read again', async (_, answer) => {
 const fake = onPage(answer, [messages([asked])]);
 const screen = await render(fake.page);
 await expect.element(screen.getByText('Plan the December campaign')).toBeVisible();
 await expect.element(screen.getByRole('status')).toHaveTextContent('AdsThinking…');
 expect(document.body.textContent).not.toContain('working on a reply');
 await expect.poll(() => fake.lives.mock.calls.length, { timeout: 4000 }).toBeGreaterThan(1);
 await expect.element(screen.getByRole('status')).toHaveTextContent('AdsThinking…');
});

test('when the Run\'s events end, the session is read at once, and the line holds until the reply is drawn (#763)', async () => {
 let land: () => void = () => {};
 const landing = new Promise<void>(resolve => { land = resolve; });
 // The Run's view, then its end; a read after it finds no Run working.
 const runs = [lines({ run: 'run_1', steps: [found], now: null }, { end: 'ended' })];
 const fake = onPage(async () => runs.shift() ?? lines({ end: 'none' }),
  [messages([asked]), async () => { await landing; return messages(landed.messages)(); }]);
 const screen = await render(fake.page);
 await expect.poll(() => fake.sessions.mock.calls.length, { message: 'read at once, at the Run\'s end' }).toBe(2);
 expect(step()?.textContent).toBe('Writing the reply…');
 land();
 await expect.element(screen.getByText('I read the last three campaigns.')).toBeVisible();
 await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
});

test('a turn waiting behind another person\'s Run says whom the Agent works for', async () => {
 const screen = await render(chat('en', { ...working, working: 'Mona Adel', workingFor: 'Mona Adel' }));
 await expect.element(screen.getByRole('status')).toHaveTextContent('AdsThinking…Working for Mona Adel');
});

test('with reduced motion the step does not breathe or rise in: text only', async () => {
 await reducedMotion(true);
 const screen = await render(chat('en', working, run([], { tool: 'meta_ads', preview: null })));
 await expect.poll(() => step()?.textContent).toBe('meta_ads…');
 await screen.rerender(chat('en', working, run([], { tool: 'sheets', preview: null })));
 await expect.poll(() => step()?.textContent).toBe('sheets…');
 expect(step()?.classList.contains('is-swap')).toBe(true);
 expect(getComputedStyle(step()!).animationName).toBe('none');
});

test('a channel shows the same: the called Agent, its step now, and its steps so far', async () => {
 const fake = engine();
 const message: ChannelMessage = { id: 2, author: 'person', mine: true, name: 'Omar', role: 'owner', body: 'Hey @lead, what is due today?', at, files: [], mention: { agent: 'Lead', face: 'c-1', state: 'open', permissions: [], questions: [] } };
 const record: ChannelRecord = { channel: { id: 'ch-1', company: 'co-1', kind: 'general' }, members: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }],
  agents: [{ id: 'a-1', connection_id: 'c-1', name: 'Lead', speciality: 'General', main: true, only: false, state: 'working' }],
  writer: true, manage: false, managers: [], may: ['once', 'always', 'deny'], messages: [message], handoffs: [], open: true, handover: false };
 const screen = await render(<LanguageProvider language="en"><ChannelView slug="rs-learning" person="p-1" initial={record}/></LanguageProvider>);
 await expect.poll(() => fake.asked).toContain('/api/run-steps?company=co-1&channel=ch-1');
 await expect.element(screen.getByRole('status')).toHaveTextContent('LeadThinking…');
 fake.send({ run: 'run_9', steps: [{ tool: 'calendar', preview: 'this week', state: 'done' }], now: { tool: 'web_search', preview: 'holidays in Egypt' } });
 await expect.poll(() => step()?.textContent).toBe('web_search · holidays in Egypt…');
 expect(line()?.querySelector('.activity__who')?.textContent).toBe('Lead');
 await expect.element(screen.getByRole('button', { name: 'Used 1 tool', exact: true })).toBeVisible();
 expect(live()?.closest('ol')?.getAttribute('aria-label')).toBe('Messages in #general');
});

test('a queued turn: once the first Run\'s reply lands its live steps go at once, and the next Run\'s are drawn when read', async () => {
 const screen = await render(chat('en', working, run([found], null)));
 await expect.poll(() => live()?.querySelector('.steps')).toBeTruthy();
 await screen.rerender(chat('en', working, run([found], null, 'run_1', true)));
 // The reply to the first message lands while the queued one keeps the Conversation waiting; the ended Run's view is
 // still the one the page holds.
 const next = { id: 3, author: 'person' as const, author_name: 'Omar', body: 'And the budget?', created_at: at };
 const waiting = { ...landed, pending: true, messages: [...landed.messages, next] };
 await screen.rerender(chat('en', waiting, run([found], null, 'run_1', true)));
 await expect.element(screen.getByText('I read the last three campaigns.')).toBeVisible();
 expect(live()?.querySelector('.steps'), 'no second list beside the reply: the next reply being worked on has none yet').toBeFalsy();
 expect(document.querySelectorAll('.steps').length).toBe(1);
 expect(document.querySelector('[data-author="agent"]')?.classList.contains('msg-in')).toBe(false);
 // The next Run is not read yet: "Thinking", not the plain line (#756).
 await expect.element(screen.getByRole('status')).toHaveTextContent('AdsThinking…');
 await screen.rerender(chat('en', waiting, run([], { tool: 'sheets', preview: 'budget' }, 'run_2')));
 await expect.poll(() => step()?.textContent).toBe('sheets · budget…');
});

test('a Run still streaming stays drawn when a reply or a decision lands meanwhile, and its list stays open across a read again', async () => {
 const screen = await render(chat('en', working, run([found], { tool: 'sheets', preview: null }, 'run_2')));
 await screen.getByRole('button', { name: 'Used 1 tool', exact: true }).click();
 // The first Run's reply reaches the page only now, after the next Run's view began; and an Owner's decision lands.
 const decided = { id: 4, author: 'agent' as const, author_name: 'Ads', body: '', created_at: at, kind: 'decided' as const, decided: { kind: 'request' as const, by: 'Omar', name: 'Writer', at, made: true as const } };
 const later = { ...landed, pending: true, messages: [...landed.messages, { id: 3, author: 'person' as const, author_name: 'Omar', body: 'And the budget?', created_at: at }, decided] };
 await screen.rerender(chat('en', later, run([found], { tool: 'sheets', preview: null }, 'run_2')));
 await expect.element(screen.getByText('I read the last three campaigns.')).toBeVisible();
 expect(step()?.textContent).toBe('sheets…');
 expect(live()).not.toBeNull();
 // The live read is cut and read again: the same Run comes back with nothing, then its steps, and its list is still open.
 await screen.rerender(chat('en', later, run([], null, 'run_2')));
 await screen.rerender(chat('en', later, run([found], { tool: 'sheets', preview: null }, 'run_2')));
 await expect.poll(() => live()?.querySelector('.steps__toggle')?.getAttribute('aria-expanded')).toBe('true');
});
