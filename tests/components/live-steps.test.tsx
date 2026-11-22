import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { render } from 'vitest-browser-react';
import { cdp } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { ConversationTurns } from '@/app/conversation-thread';
import ChannelView from '@/app/c/[slug]/channels/[id]/channel';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ConversationRecord } from '@/lib/conversation-record';
import type { ChannelMessage, ChannelRecord } from '@/lib/channels';
import type { LiveLine } from '@/lib/live-steps.mjs';
import '@/app/tokens.css';
import '@/app/shell.css';

// #646: while an Agent works, the line under the transcript names the step it is on now and the turn's steps list fills
// in, from the Run's calls as a fake Engine streams them (app/api/run-steps); when the stream cannot be read, the page
// keeps its plain line, and the reply still lands.
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/conversations/cv-1', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('@/app/channel-actions', () => ({ changeChannel: vi.fn(), channelChoices: vi.fn() }));
const reducedMotion = (on: boolean) => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
afterEach(async () => { vi.unstubAllGlobals(); await reducedMotion(false); });

// The fake Engine's stream, line by line, as the route passes it on; every other read waits for ever.
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
const chat = (language: 'en' | 'ar', record: ConversationRecord) => page(language, <ConversationTurns slug="rs-learning" company="co-1" record={record} writer asked={() => {}}/>);
const line = () => document.querySelector('.activity');
const step = () => document.querySelector('.activity__t');
const live = () => document.querySelector('li[data-live]');

test.each([
 ['en', 'Thinking…', 'meta_ads · campaign results August to October…', 'Writing the reply…', 'Used 1 tool', 'Used 2 tools · 41 sec'],
 ['ar', 'بيفكر…', 'meta_ads · campaign results August to October…', 'بيكتب الرد…', 'استخدم 1 أداة', 'استخدم 2 أداة · 41 ثانية'],
] as const)('in the %s interface, the line names the Agent and its step now, the steps list fills in, and the reply takes its place', async (language, thinking, now, writing, one, two) => {
 const fake = engine();
 const screen = await render(chat(language, working));
 await expect.poll(() => fake.asked).toContain('/api/run-steps?company=co-1&conversation=cv-1');
 // Before the stream answers, the plain line.
 await expect.element(screen.getByRole('status')).toHaveTextContent(language === 'en' ? 'Ads is working on a reply…' : 'Ads يكتب الرد…');
 fake.send({ run: 'run_1', steps: [], now: null });
 await expect.poll(() => step()?.textContent).toBe(thinking);
 expect(line()?.querySelector('.dot--working')).not.toBeNull();
 expect(line()?.querySelector('.activity__who')?.textContent).toBe('Ads');
 expect(line()?.getAttribute('role')).toBe('status');
 expect(step()?.classList.contains('is-swap'), 'the first step does not rise in').toBe(false);
 fake.send({ run: 'run_1', steps: [], now: { tool: 'meta_ads', preview: 'campaign results August to October' } });
 await expect.poll(() => step()?.textContent).toBe(now);
 expect(step()?.classList.contains('is-swap'), 'each new step rises in').toBe(true);
 expect(live(), 'no list before a step ended').toBeNull();
 fake.send({ run: 'run_1', steps: [found], now: null });
 await expect.poll(() => step()?.textContent).toBe(writing);
 await expect.element(screen.getByRole('button', { name: one, exact: true })).toBeVisible();
 expect(live()?.querySelector('.sender')?.textContent).toBe('Ads');
 await screen.getByRole('button', { name: one, exact: true }).click();
 expect(live()?.querySelector('.step__label')?.textContent).toBe('meta_ads · campaign results August to October');
 fake.send({ run: 'run_1', steps: [found], now: { tool: 'sheets', preview: null } });
 await expect.poll(() => step()?.textContent).toBe('sheets…');
 // The reply lands: the live turn and its line go, and the reply's list is the session's, drawn once, still open, and
 // the turn does not rise in again.
 fake.end();
 await screen.rerender(chat(language, landed));
 await expect.element(screen.getByRole('button', { name: two, exact: true })).toBeVisible();
 expect(live()).toBeNull();
 expect(line()).toBeNull();
 expect(document.querySelectorAll('.steps').length).toBe(1);
 await expect.element(screen.getByRole('button', { name: two, exact: true })).toHaveAttribute('aria-expanded', 'true');
 expect(document.querySelector('[data-author="agent"]')?.classList.contains('msg-in')).toBe(false);
});

test('a reader who opens the chat mid-Run sees the step now and the steps so far at once, not an empty line', async () => {
 const fake = engine();
 const screen = await render(chat('en', working));
 await expect.poll(() => fake.asked.length).toBeGreaterThan(0);
 fake.send({ run: 'run_1', steps: [found, { tool: 'ga4', preview: null, state: 'failed' }], now: { tool: 'sheets', preview: 'budget split over 30 days' } });
 await expect.poll(() => step()?.textContent).toBe('sheets · budget split over 30 days…');
 await screen.getByRole('button', { name: 'Used 2 tools', exact: true }).click();
 expect([...live()!.querySelectorAll('.step')].map(item => item.className)).toEqual(['step step--done', 'step step--skipped']);
});

test.each<[string, () => Promise<Response>]>([
 ['the Engine cannot be read', () => Promise.resolve(new Response(`${JSON.stringify({ end: 'unreachable' })}\n`))],
 ['the route fails', () => Promise.resolve(new Response('{"error":"conversationFailed"}', { status: 500 }))],
 ['the network is down', () => Promise.reject(new TypeError('Failed to fetch'))],
])('when %s, the page keeps its "is working on a reply" line, and the reply still lands', async (_, answer) => {
 const reads = vi.fn(answer);
 vi.stubGlobal('fetch', (url: string) => url.startsWith('/api/run-steps?') ? reads() : new Promise<Response>(() => {}));
 const screen = await render(chat('en', working));
 await expect.poll(() => reads.mock.calls.length).toBeGreaterThan(0);
 await expect.element(screen.getByRole('status')).toHaveTextContent('Ads is working on a reply…');
 expect(line()).toBeNull();
 // It reads again while the Agent works, and the line stays as it was meanwhile.
 await expect.poll(() => reads.mock.calls.length, { timeout: 4000 }).toBeGreaterThan(1);
 await expect.element(screen.getByRole('status')).toHaveTextContent('Ads is working on a reply…');
 await screen.rerender(chat('en', landed));
 await expect.element(screen.getByText('I read the last three campaigns.')).toBeVisible();
 await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
});

test('with reduced motion the step does not breathe or rise in: text only', async () => {
 await reducedMotion(true);
 const fake = engine();
 await render(chat('en', working));
 await expect.poll(() => fake.asked.length).toBeGreaterThan(0);
 fake.send({ run: 'run_1', steps: [], now: { tool: 'meta_ads', preview: null } });
 await expect.poll(() => step()?.textContent).toBe('meta_ads…');
 fake.send({ run: 'run_1', steps: [], now: { tool: 'sheets', preview: null } });
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
 await expect.element(screen.getByRole('status')).toHaveTextContent('Lead is working on a reply…');
 fake.send({ run: 'run_9', steps: [{ tool: 'calendar', preview: 'this week', state: 'done' }], now: { tool: 'web_search', preview: 'holidays in Egypt' } });
 await expect.poll(() => step()?.textContent).toBe('web_search · holidays in Egypt…');
 expect(line()?.querySelector('.activity__who')?.textContent).toBe('Lead');
 await expect.element(screen.getByRole('button', { name: 'Used 1 tool', exact: true })).toBeVisible();
 expect(live()?.closest('ol')?.getAttribute('aria-label')).toBe('Messages in #general');
});

test('a queued turn: once the first Run\'s reply lands its live steps go at once, and the next Run\'s are drawn when read', async () => {
 const fake = engine();
 const screen = await render(chat('en', working));
 await expect.poll(() => fake.asked.length).toBeGreaterThan(0);
 fake.send({ run: 'run_1', steps: [found], now: null });
 await expect.poll(() => live()).not.toBeNull();
 fake.send({ end: 'ended' }); fake.end();
 // Nothing on screen says the Run's events ended: the page is given a moment to read the end.
 await new Promise(resolve => setTimeout(resolve, 200));
 // The reply to the first message lands while the queued one keeps the Conversation waiting.
 const next = { id: 3, author: 'person' as const, author_name: 'Omar', body: 'And the budget?', created_at: at };
 await screen.rerender(chat('en', { ...landed, pending: true, messages: [...landed.messages, next] }));
 await expect.element(screen.getByText('I read the last three campaigns.')).toBeVisible();
 expect(live(), 'no second list beside the reply').toBeNull();
 expect(document.querySelectorAll('.steps').length).toBe(1);
 expect(document.querySelector('[data-author="agent"]')?.classList.contains('msg-in')).toBe(false);
 await expect.element(screen.getByRole('status')).toHaveTextContent('Ads is working on a reply…');
 await expect.poll(() => fake.asked.length, { timeout: 4000 }).toBe(2);
 fake.send({ run: 'run_2', steps: [], now: { tool: 'sheets', preview: 'budget' } });
 await expect.poll(() => step()?.textContent).toBe('sheets · budget…');
});

test('a Run still streaming stays drawn when a reply or a decision lands meanwhile, and its list stays open across a read again', async () => {
 const fake = engine();
 const screen = await render(chat('en', working));
 await expect.poll(() => fake.asked.length).toBe(1);
 fake.send({ run: 'run_2', steps: [found], now: { tool: 'sheets', preview: null } });
 await screen.getByRole('button', { name: 'Used 1 tool', exact: true }).click();
 // The first Run's reply reaches the page only now, after the next Run's stream began; and an Owner's decision lands.
 const decided = { id: 4, author: 'agent' as const, author_name: 'Ads', body: '', created_at: at, kind: 'decided' as const, decided: { kind: 'request' as const, by: 'Omar', name: 'Writer', at, made: true as const } };
 await screen.rerender(chat('en', { ...landed, pending: true, messages: [...landed.messages, { id: 3, author: 'person', author_name: 'Omar', body: 'And the budget?', created_at: at }, decided] }));
 await expect.element(screen.getByText('I read the last three campaigns.')).toBeVisible();
 expect(step()?.textContent).toBe('sheets…');
 expect(live()).not.toBeNull();
 // The stream is cut and read again: the same Run comes back with nothing, then its steps, and its list is still open.
 fake.end();
 await expect.poll(() => fake.asked.length, { timeout: 4000 }).toBe(2);
 fake.send({ run: 'run_2', steps: [], now: null });
 fake.send({ run: 'run_2', steps: [found], now: { tool: 'sheets', preview: null } });
 await expect.poll(() => live()?.querySelector('.steps__toggle')?.getAttribute('aria-expanded')).toBe('true');
});
