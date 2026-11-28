import { afterEach, expect, test, vi } from 'vitest';
import { act, type ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { cdp } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import ConversationView, { EngineLoaded } from '@/app/c/[slug]/conversations/[id]/conversation';
import ChannelView from '@/app/c/[slug]/channels/[id]/channel';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ConversationRecord } from '@/lib/conversation-frame';
import type { ChannelMessage, ChannelRecord } from '@/lib/channels';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/globals.css';

// #756: a sent message is drawn in the transcript the moment its person presses Send, with its text and its files, before
// the send is answered, and the line under the transcript reads "Thinking" from then; a refused send takes the message
// back to the box with its error; the message the Engine's session holds, once read after its Run, takes the drawn
// one's place, once and without rising in again. A channel's composer does the same.
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/conversation-archive-actions', () => ({ archiveConversations: vi.fn() }));
vi.mock('@/app/channel-actions', () => ({ changeChannel: vi.fn(), channelChoices: vi.fn() }));
vi.mock('@/app/channel-archive-actions', () => ({ archiveChannels: vi.fn() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
const reducedMotion = (on: boolean) => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
afterEach(async () => { vi.unstubAllGlobals(); await reducedMotion(false); });

const never = () => new Promise<Response>(() => {});
const found = (messages: ConversationRecord['messages']) => Response.json({ state: 'found', messages, nextOffset: messages.length, hasMore: false });
// The send (a POST) is answered by `post`, each read of the session's messages by `read`, and the open Run's live read
// (#876) ends at once when `ends`, else it waits for ever, as the live steps' read of a channel (#646) does.
const routes = ({ post, read = never, ends = false }: { post: (init: RequestInit) => Promise<Response>, read?: () => Promise<Response>, ends?: boolean }) => {
 const posts: RequestInit[] = [];
 vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
  if (String(url).startsWith('/api/run-steps?')) return never();
  if (String(url).startsWith('/api/conversation-live?')) return ends ? Promise.resolve(new Response(`${JSON.stringify({ end: 'ended' })}\n`)) : never();
  if (init?.method === 'POST') { posts.push(init); return post(init); }
  if (String(url).includes('&intent=usage')) return Promise.resolve(Response.json({}));
  return read();
 });
 return posts;
};

const at = '2026-06-10T09:41:00Z';
const before = { id: 1, author: 'person' as const, author_name: 'Omar', body: 'Hello', created_at: at };
const hello = { id: 2, author: 'agent' as const, author_name: 'Mona', body: 'Hi, Omar.', created_at: at };
// Each test opens a Conversation of its own: the page keeps the last read of a Conversation in this browser.
let opens = 0;
const talk = (messages: ConversationRecord['messages'], more: Partial<ConversationRecord> = {}): ConversationRecord => ({
 conversation: { id: `cv-2-${++opens}`, agent_id: null, agent_name: 'Mona', face: 'c-2' }, messages, usage: { input: 0, output: 0 }, pending: false, failed: false, working: null, canStop: false, ...more,
});
// The page draws the Conversation's frame at once and reads its messages from the Engine's session (#875): unless the
// test answers the read itself, the session holds the record's messages.
const conversation = (initial: ConversationRecord, language: 'en' | 'ar' = 'en') => render(<div className="gw"><LanguageProvider language={language}>
 <ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={initial.conversation} title="" writer><EngineLoaded initial={{ ...initial, messages: [] }} team={false}/></ConversationView></LanguageProvider></div>);
const session = (messages: ConversationRecord['messages']) => async () => found(messages);
const userTurns = () => [...document.querySelectorAll('.turns > li.turn--user')];
const turnOf = (text: string) => userTurns().filter(turn => turn.textContent?.includes(text));
const image = (name: string) => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' });
const pick = async (files: File[]) => {
 const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
 const carried = new DataTransfer(); files.forEach(file => carried.items.add(file));
 await act(async () => { input.files = carried.files; input.dispatchEvent(new Event('change', { bubbles: true })); });
};

test.each([
 ['en', 'Message', 'Send', 'MonaThinking…'],
 ['ar', 'الرسالة', 'ابعت', 'Monaبيفكر…'],
] as const)('in the %s interface, with a send that is never answered, the message and its file are in the transcript and the line reads "Thinking"', async (language, label, send, thinking) => {
 const posts = routes({ post: never, read: session([before, hello]) });
 const screen = await conversation(talk([before, hello]), language);
 const box = screen.getByRole('textbox', { name: label, exact: true });
 await box.fill('Plan the December campaign');
 await pick([image('brief.png')]);
 await screen.getByRole('button', { name: send, exact: true }).click();
 await expect.poll(() => turnOf('Plan the December campaign').length).toBe(1);
 expect(posts).toHaveLength(1);
 const [sent] = turnOf('Plan the December campaign');
 expect(sent.getAttribute('data-kind')).toBe('sending');
 expect(sent.getAttribute('aria-busy'), 'marked as sending until the send is answered').toBe('true');
 expect(sent.classList.contains('is-sending')).toBe(true);
 expect(sent.querySelector('.file-chip')?.textContent).toBe('brief.png');
 expect(userTurns().at(-1), 'after everything already said').toBe(sent);
 await expect.element(screen.getByRole('status')).toHaveTextContent(thinking);
 expect(document.querySelector('.thinking'), 'not the "is working on a reply" line').toBeNull();
 // The box let the message go; the composer has no chip left.
 await expect.element(box).toHaveValue('');
 expect(document.querySelector('.composer__files')).toBeNull();
});

test('a refused send takes the drawn message out, puts its words and file back in the box, and says why', async () => {
 routes({ post: async () => Response.json({ error: 'conversationFailed' }, { status: 502 }), read: session([before, hello]) });
 const screen = await conversation(talk([before, hello]));
 const box = screen.getByRole('textbox', { name: 'Message', exact: true });
 await box.fill('Plan the December campaign');
 await pick([image('brief.png')]);
 await screen.getByRole('button', { name: 'Send', exact: true }).click();
 await expect.element(screen.getByRole('alert')).toHaveTextContent('Could not send the message. Try again.');
 expect(turnOf('Plan the December campaign')).toHaveLength(0);
 await expect.element(box).toHaveValue('Plan the December campaign');
 expect(document.querySelector('.composer__files .file-chip')?.textContent).toBe('brief.png');
 expect(document.querySelector('[role="status"]'), 'nothing works').toBeNull();
});

test('the message the session holds takes the drawn one\'s place once read: one bubble, in the same place, no second rise', async () => {
 const stored = { id: 3, author: 'person' as const, author_name: 'Omar', body: 'Plan the December campaign', created_at: at };
 let answer: (response: Response) => void = () => {};
 // The first read is the session before the send; once the Run ends, the read holds the message and its reply.
 const reads = [[before, hello], [before, hello, stored, { id: 4, author: 'agent' as const, author_name: 'Mona', body: 'Here is the plan.', created_at: at }]];
 routes({ post: () => new Promise<Response>(resolve => { answer = resolve; }), read: async () => found(reads.length > 1 ? reads.shift()! : reads[0]), ends: true });
 const screen = await conversation(talk([before, hello]));
 await expect.element(screen.getByText('Hi, Omar.')).toBeVisible();
 await screen.getByRole('textbox', { name: 'Message', exact: true }).fill('Plan the December campaign');
 await screen.getByRole('button', { name: 'Send', exact: true }).click();
 await expect.poll(() => turnOf('Plan the December campaign').length).toBe(1);
 const [drawn] = turnOf('Plan the December campaign');
 expect(drawn.classList.contains('msg-in'), 'the message rises in as it is sent').toBe(true);
 answer(Response.json({ conversation: 'cv-2' }));
 // Answered: no longer marked as sending.
 await expect.poll(() => turnOf('Plan the December campaign')[0]?.getAttribute('aria-busy')).toBeNull();
 expect(turnOf('Plan the December campaign')[0]?.classList.contains('is-sending')).toBe(false);
 await expect.poll(() => turnOf('Plan the December campaign')[0]?.getAttribute('data-kind'), { timeout: 4000 }).toBeNull();
 const [kept] = turnOf('Plan the December campaign');
 expect(turnOf('Plan the December campaign'), 'drawn once').toHaveLength(1);
 expect(kept.classList.contains('msg-in'), 'the stored message does not rise in again').toBe(false);
 expect(userTurns().indexOf(kept), 'in the same place').toBe(1);
 await expect.element(screen.getByText('Here is the plan.'), { timeout: 4000 }).toBeVisible();
 expect(turnOf('Plan the December campaign')).toHaveLength(1);
});

test('with reduced motion the drawn message keeps the rule every message has: no time to its rise', async () => {
 await reducedMotion(true);
 routes({ post: never, read: session([before, hello]) });
 const screen = await conversation(talk([before, hello]));
 await screen.getByRole('textbox', { name: 'Message', exact: true }).fill('Plan the December campaign');
 await screen.getByRole('button', { name: 'Send', exact: true }).click();
 await expect.poll(() => turnOf('Plan the December campaign').length).toBe(1);
 // globals.css: under reduced motion every animation lasts no time.
 expect(getComputedStyle(turnOf('Plan the December campaign')[0]).animationDuration).toBe('0s');
});

// A channel: the reader's message calls Lead, which reads "Thinking" at once; a refused send gives the words back.
const omar: ChannelMessage = { id: 1, author: 'person', mine: true, name: 'Omar', role: 'owner', body: 'Morning all', at, files: [], mention: null };
const team = (messages: ChannelMessage[]): ChannelRecord => ({
 channel: { id: 'ch-1', company: 'co-1', kind: 'general' },
 members: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }],
 agents: [{ id: 'a-1', connection_id: 'c-1', name: 'Lead', speciality: 'General', main: true, only: false, state: 'idle' }],
 writer: true, manage: false, managers: [], may: ['once', 'always', 'deny'], messages, handoffs: [], open: false, handover: false,
});
const channel = (initial: ChannelRecord) => render(<div className="gw"><LanguageProvider language="en"><ChannelView slug="rs-learning" person="p-1" initial={initial}/></LanguageProvider></div>);

test('in a channel, a message that calls an Agent is drawn at once with the Agent thinking, and a refused one goes back to the box', async () => {
 let answer: (response: Response) => void = () => {};
 routes({ post: () => new Promise<Response>(resolve => { answer = resolve; }), read: async () => Response.json(team([omar])) });
 const screen = await channel(team([omar]));
 const box = screen.getByRole('textbox', { name: 'Write your message in the channel' });
 await box.fill('Hey @Lead, what is due today?');
 await screen.getByRole('button', { name: 'Send', exact: true }).click();
 await expect.poll(() => turnOf('what is due today?').length).toBe(1);
 const [sent] = turnOf('what is due today?');
 expect(sent.getAttribute('aria-busy')).toBe('true');
 expect(sent.querySelector('.mention')?.textContent, 'the called Agent is marked as the stored message marks it').toBe('@Lead');
 await expect.element(screen.getByRole('status')).toHaveTextContent('LeadThinking…');
 await expect.element(box).toHaveValue('');
 answer(Response.json({ error: 'conversationFailed' }, { status: 502 }));
 await expect.element(screen.getByRole('alert')).toHaveTextContent('Could not send the message. Try again.');
 expect(turnOf('what is due today?')).toHaveLength(0);
 await expect.element(box).toHaveValue('Hey @Lead, what is due today?');
 expect(document.querySelector('[role="status"]')).toBeNull();
});

test('in a channel, ordinary talk that calls no Agent is drawn at once with no working line', async () => {
 routes({ post: never });
 const screen = await channel(team([omar]));
 await screen.getByRole('textbox', { name: 'Write your message in the channel' }).fill('Lunch at one?');
 await screen.getByRole('button', { name: 'Send', exact: true }).click();
 await expect.poll(() => turnOf('Lunch at one?').length).toBe(1);
 expect(document.querySelector('[role="status"]')).toBeNull();
});
