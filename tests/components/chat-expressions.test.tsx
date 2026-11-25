import { afterEach, expect, test, vi } from 'vitest';
import { use, type ComponentProps, type ReactNode } from 'react';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import ConversationView, { ConversationLoaded } from '@/app/c/[slug]/conversations/[id]/conversation';
import ChannelView from '@/app/c/[slug]/channels/[id]/channel';
import { SidebarLive, AgentTile } from '@/app/sidebar-live';
import AgentChat from '@/app/c/[slug]/chat/[[...agent]]/agent-chat';
import { CardSheetChat } from '@/app/card-sheet-chat';
import { LanguageProvider } from '@/lib/i18n-client';
import type { AgentFaceState } from '@/lib/agent-face-states';
import type { ConversationRecord } from '@/lib/conversation-record';
import type { ChannelMessage, ChannelRecord } from '@/lib/channels';
import type { LiveLine } from '@/lib/live-steps.mjs';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/globals.css';

// What a person sees of an Agent's expression in the chat they have open (#700, spec #694): the face in the chat's
// head, the sidebar's tile and the reply being worked on carry one state at every moment; it listens while they type
// to it, thinks until its Run's first step, works after it, and is done only when a Run they watched ended well.
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs/conversations/cv-1', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/conversation-archive-actions', () => ({ archiveConversations: vi.fn() }));
vi.mock('@/app/channel-actions', () => ({ changeChannel: vi.fn(), channelChoices: vi.fn() }));
vi.mock('@/app/channel-archive-actions', () => ({ archiveChannels: vi.fn() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { vi.unstubAllGlobals(); });

const at = '2026-11-24T09:41:00Z';
const asked = { id: 1, author: 'person' as const, author_name: 'Omar', body: 'Plan the December campaign', created_at: at };
const replied = { id: 2, author: 'agent' as const, author_name: 'Ads', body: 'Here is the plan.', created_at: at };
const quiet: ConversationRecord = { conversation: { id: 'cv-1', agent_id: 'ads', agent_name: 'Ads', face: 'ads' }, messages: [asked, replied], usage: null, pending: false, failed: false, working: null, canStop: false };
const arrived = (record: ConversationRecord) => Object.assign(Promise.resolve(record), { status: 'fulfilled', value: record });
const Arrived = ({ record }: { record: Promise<ConversationRecord> }) => <ConversationLoaded initial={use(record)} team={false}/>;

// The server parts: the sidebar's poll answers `shared` for every Agent, a send is taken, each read of the record answers
// the next of `reads` (the last one again), and the Run's live steps are the fake Engine's lines.
function server({ shared = { ads: 'idle' } as Record<string, AgentFaceState>, reads = [quiet] as ConversationRecord[], channel = null as ChannelRecord[] | null } = {}) {
 const state = { shared, reads, channel };
 let line: (line: LiveLine) => void = () => {};
 vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
  if (url.startsWith('/api/sidebar?')) return Promise.resolve(Response.json({ channels: [], agents: state.shared }));
  if (url.startsWith('/api/run-steps?')) return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) {
   line = next => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(next)}\n`));
  } }), { headers: { 'Content-Type': 'application/x-ndjson' } }));
  if (init?.method === 'POST') return Promise.resolve(Response.json({ ok: true }));
  if (url.startsWith('/api/conversations?')) return Promise.resolve(Response.json(state.reads.length > 1 ? state.reads.shift() : state.reads[0]));
  if (url.startsWith('/api/channels?') && state.channel) return Promise.resolve(Response.json(state.channel.length > 1 ? state.channel.shift() : state.channel[0]));
  return new Promise<Response>(() => {});
 });
 return { state, step: (next: LiveLine) => line(next) };
}

const Sidebar = ({ children, states = { ads: 'idle' } }: { children: ReactNode, states?: Record<string, AgentFaceState> }) => <LanguageProvider language="en"><div className="gw">
 <SidebarLive company="co-1" channels={[]} states={states}>
  <ul>{Object.keys(states).map(agent => <li key={agent}><AgentTile agent={agent} href={`/c/rs/chat/${agent}`} named={[agent]} title={agent}><bdi>{agent}</bdi></AgentTile></li>)}</ul>
  {children}
 </SidebarLive>
</div></LanguageProvider>;
const conversation = (record: ConversationRecord, states?: Record<string, AgentFaceState>) => <Sidebar states={states}>
 <ConversationView slug="rs" agent={{ id: 'ads', connection_id: 'c-ads', name: 'Ads' } as never} details={null} company="co-1" conversation={record.conversation} title="" writer><Arrived record={arrived(record)}/></ConversationView>
</Sidebar>;

const tile = (agent = 'ads') => document.querySelector<HTMLElement>(`.agent-tile[data-agent="${agent}"] .face`)?.dataset.state;
const head = () => document.querySelector<HTMLElement>('.head-pill .face')?.dataset.state;
const reply = () => document.querySelector<HTMLElement>('li[data-live] .face');
const both = () => ({ head: head(), tile: tile() });
const field = () => document.querySelector<HTMLTextAreaElement>('.composer textarea')!;

test('the Agent listens while the person types to it, and stops when the field is empty', async () => {
 server();
 await render(conversation(quiet));
 expect(both()).toEqual({ head: 'idle', tile: 'idle' });
 await userEvent.type(field(), 'Plan');
 await expect.poll(both).toEqual({ head: 'listening', tile: 'listening' });
 await userEvent.clear(field());
 await expect.poll(both).toEqual({ head: 'idle', tile: 'idle' });
});

test('an asleep Agent listens too; one that waits on the person or works elsewhere does not', async () => {
 server({ shared: { ads: 'asleep' } });
 const screen = await render(conversation(quiet, { ads: 'asleep' }));
 expect(both()).toEqual({ head: 'asleep', tile: 'asleep' });
 await userEvent.type(field(), 'Wake up');
 await expect.poll(both).toEqual({ head: 'listening', tile: 'listening' });
 await screen.unmount();
 for (const shared of ['waiting', 'working', 'stuck'] as const) {
  server({ shared: { ads: shared } });
  const again = await render(conversation(quiet, { ads: shared }));
  await userEvent.type(field(), 'Hello');
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(both()).toEqual({ head: shared, tile: shared });
  await again.unmount();
 }
});

test('sent, it thinks until its Run\'s first step, works after it, and is done when the reply lands well', async () => {
 const running: ConversationRecord = { ...quiet, messages: [asked], pending: true };
 const fake = server({ reads: [running] });
 await render(conversation({ ...quiet, messages: [] }));
 await userEvent.type(field(), 'Plan the December campaign');
 await userEvent.keyboard('{Enter}');
 await expect.poll(both).toEqual({ head: 'thinking', tile: 'thinking' });
 await expect.poll(() => field().value).toBe('');
 // The reply being worked on shows from the start (#694: 24px and moving), thinking before its Run's first step.
 await expect.poll(() => reply()?.dataset.state).toBe('thinking');
 expect(reply()!.classList.contains('face--live')).toBe(true);
 expect(reply()!.getBoundingClientRect().width).toBe(24);
 fake.step({ run: 'run_1', steps: [], now: null });
 await expect.poll(() => reply()?.dataset.state).toBe('thinking');
 fake.step({ run: 'run_1', steps: [], now: { tool: 'meta_ads', preview: null } });
 await expect.poll(both).toEqual({ head: 'working', tile: 'working' });
 fake.step({ run: 'run_1', steps: [{ tool: 'meta_ads', preview: null, state: 'done' }], now: null });
 // The reply being worked on: its face 24px and alive, in the same state.
 await expect.poll(() => reply()?.dataset.state).toBe('working');
 expect(reply()!.classList.contains('face--live')).toBe(true);
 expect(reply()!.getBoundingClientRect().width).toBe(24);
 fake.state.reads = [quiet];
 await expect.poll(both, { timeout: 4000 }).toEqual({ head: 'done', tile: 'done' });
 // Past replies are 20px and still.
 const past = document.querySelector<HTMLElement>('li[data-author="agent"]:not([data-live]) .face')!;
 expect(past.classList.contains('face--still')).toBe(true);
 expect(past.getBoundingClientRect().width).toBe(20);
 await expect.poll(both, { timeout: 4000 }).toEqual({ head: 'idle', tile: 'idle' });
});

test('a Run that failed, was stopped or paused for a question is never done: it shows its own state', async () => {
 const running: ConversationRecord = { ...quiet, messages: [asked], pending: true };
 for (const [ended, shared] of [[{ ...quiet, messages: [asked], failed: true }, 'stuck'], [{ ...quiet, messages: [asked], failed: true }, 'idle'], [{ ...running, asking: true }, 'waiting']] as const) {
  const fake = server({ reads: [running] });
  const screen = await render(conversation(running));
  await expect.poll(both).toEqual({ head: 'thinking', tile: 'thinking' });
  const states: AgentFaceState[] = [];
  const watch = setInterval(() => { const now = head(); if (now) states.push(now as AgentFaceState); }, 20);
  fake.state.shared = { ads: shared };
  fake.state.reads = [ended as ConversationRecord];
  await expect.poll(both, { timeout: 4000 }).toEqual({ head: shared, tile: shared });
  await new Promise(resolve => setTimeout(resolve, 300));
  clearInterval(watch);
  expect(states).not.toContain('done');
  expect(both()).toEqual({ head: shared, tile: shared });
  await screen.unmount();
 }
});

test('in a channel, the Agent named after @ listens, and only it', async () => {
 const record: ChannelRecord = { channel: { id: 'ch-1', company: 'co-1', kind: 'general' }, members: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }],
  agents: [{ id: 'ads', connection_id: 'c-ads', name: 'Ads', speciality: '', main: false, only: false, state: 'idle' }, { id: 'lead', connection_id: 'c-lead', name: 'Lead', speciality: '', main: true, only: false, state: 'idle' }],
  writer: true, manage: false, managers: [], may: ['once', 'always', 'deny'], messages: [], handoffs: [], open: false, handover: false };
 server({ shared: { ads: 'idle', lead: 'idle' }, channel: [record] });
 await render(<Sidebar states={{ ads: 'idle', lead: 'idle' }}><ChannelView slug="rs" person="p-1" initial={record}/></Sidebar>);
 await userEvent.type(field(), 'Hi team');
 await new Promise(resolve => setTimeout(resolve, 50));
 expect([tile('ads'), tile('lead')]).toEqual(['idle', 'idle']);
 await userEvent.type(field(), ' @Lead ');
 await expect.poll(() => [tile('ads'), tile('lead')]).toEqual(['idle', 'listening']);
 await userEvent.clear(field());
 await expect.poll(() => tile('lead')).toBe('idle');
});

test('in a channel, a called Agent thinks, works, and is done when its reply lands', async () => {
 const message: ChannelMessage = { id: 2, author: 'person', mine: true, name: 'Omar', role: 'owner', body: 'Hey @Ads, plan it', at, files: [], mention: { agent: 'Ads', face: 'ads', state: 'open', permissions: [], questions: [] } };
 const open: ChannelRecord = { channel: { id: 'ch-1', company: 'co-1', kind: 'general' }, members: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }],
  agents: [{ id: 'ads', connection_id: 'c-ads', name: 'Ads', speciality: '', main: false, only: false, state: 'working' }],
  writer: true, manage: false, managers: [], may: ['once', 'always', 'deny'], messages: [message], handoffs: [], open: true, handover: false };
 const answered: ChannelRecord = { ...open, open: false, messages: [{ ...message, mention: { ...message.mention!, state: 'answered' } },
  { id: 3, author: 'agent', name: 'Ads', face: 'ads', body: 'Planned.', at } as ChannelMessage] };
 const fake = server({ shared: { ads: 'working' }, channel: [open] });
 await render(<Sidebar states={{ ads: 'working' }}><ChannelView slug="rs" person="p-1" initial={open}/></Sidebar>);
 await expect.poll(() => tile()).toBe('thinking');
 fake.step({ run: 'run_9', steps: [], now: { tool: 'meta_ads', preview: null } });
 await expect.poll(() => tile()).toBe('working');
 fake.state.shared = { ads: 'idle' };
 fake.state.channel = [answered];
 await expect.poll(() => tile(), { timeout: 4000 }).toBe('done');
});

const big = () => document.querySelector<HTMLElement>('.empty-chat__faces .face')?.dataset.state;

test('an empty chat\'s big face shows the state the sidebar does, and listens as the person types', async () => {
 server({ shared: { ads: 'asleep' } });
 await render(<Sidebar states={{ ads: 'asleep' }}><AgentChat slug="rs" company="co-1" agent={{ id: 'ads', connection_id: 'c-ads', name: 'Ads', speciality: 'Runs the ads', main: false } as never} details={null} writer empty={{ state: 'known', example: null }}/></Sidebar>);
 expect({ big: big(), head: head(), tile: tile() }).toEqual({ big: 'asleep', head: 'asleep', tile: 'asleep' });
 await userEvent.type(field(), 'Plan');
 await expect.poll(() => ({ big: big(), head: head(), tile: tile() })).toEqual({ big: 'listening', head: 'listening', tile: 'listening' });
});

test('a Card\'s empty chat shows its Agent\'s state on its face and listens as the person types', async () => {
 server({ shared: { ads: 'asleep' } });
 await render(<Sidebar states={{ ads: 'asleep' }}><CardSheetChat slug="rs" company="co-1" card={4} chat={{ kind: 'empty', agent: { id: 'ads', name: 'Ads', connection_id: 'c-ads' } }} writer shown openLog={() => {}}/></Sidebar>);
 expect([big(), tile()]).toEqual(['asleep', 'asleep']);
 await userEvent.type(field(), 'Plan');
 await expect.poll(() => [big(), tile()]).toEqual(['listening', 'listening']);
});

test('a channel opened in a Card\'s sheet shows its called Agent thinking, working, then done', async () => {
 const message: ChannelMessage = { id: 2, author: 'person', mine: true, name: 'Omar', role: 'owner', body: 'Hey @Ads, plan it', at, files: [], mention: { agent: 'Ads', face: 'ads', state: 'open', permissions: [], questions: [] } };
 const open: ChannelRecord = { channel: { id: 'ch-1', company: 'co-1', kind: 'general' }, members: [{ person: 'p-1', name: 'Omar', role: 'owner', invitation: null, email: null }],
  agents: [{ id: 'ads', connection_id: 'c-ads', name: 'Ads', speciality: '', main: false, only: false, state: 'working' }],
  writer: true, manage: false, managers: [], may: ['once', 'always', 'deny'], messages: [message], handoffs: [], open: true, handover: false };
 const answered: ChannelRecord = { ...open, open: false, messages: [{ ...message, mention: { ...message.mention!, state: 'answered' } },
  { id: 3, author: 'agent', name: 'Ads', face: 'ads', body: 'Planned.', at } as ChannelMessage] };
 const fake = server({ shared: { ads: 'working' }, channel: [open] });
 await render(<Sidebar states={{ ads: 'working' }}><CardSheetChat slug="rs" company="co-1" card={4} chat={{ kind: 'channel', record: open, person: 'p-me' }} writer shown openLog={() => {}}/></Sidebar>);
 await expect.poll(() => tile()).toBe('thinking');
 fake.step({ run: 'run_9', steps: [], now: { tool: 'meta_ads', preview: null } });
 await expect.poll(() => tile()).toBe('working');
 fake.state.shared = { ads: 'idle' };
 fake.state.channel = [answered];
 await expect.poll(() => tile(), { timeout: 5000 }).toBe('done');
});
