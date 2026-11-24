import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { cdp, userEvent } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { AgentFace } from '@/components/agent-face';
import { Birth, Greeting } from '@/components/face-moments';
import { MadeCard } from '@/app/agent-card';
import { CallableAgentsProvider, MessageBox, type CallableAgent } from '@/app/conversation-composer';
import { LanguageProvider } from '@/lib/i18n-client';
import { LooksProvider } from '@/lib/agent-looks-client';
import type { CompanyLooks } from '@/lib/agent-looks';
import type { MadeAgent } from '@/lib/conversations';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';

vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

// The three moments (#701; design-reference-orb section 4): birth for the person who asked, a greeting the first time a
// day on this device, and perking up when its name is written after @. What is seen: the face plays the moment or not.
const reducedMotion = (on: boolean) => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
beforeEach(() => { try { localStorage.clear(); } catch { /* blocked */ } });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await reducedMotion(false); });

const looks: CompanyLooks = { agents: {}, requests: {} };
const Company = ({ children }: { children: React.ReactNode }) => <div className="gw"><LanguageProvider language="en"><LooksProvider looks={looks}>{children}</LooksProvider></LanguageProvider></div>;
const faceOf = (selector: string) => document.querySelector<HTMLElement>(`${selector} .face--live`)!;
// A moment plays: the face carries it, and its body moves (with reduced motion, still frames instead and nothing moves).
const plays = (face: HTMLElement | null, moment: string) => face?.dataset.moment === moment;
const moves = (face: HTMLElement) => face.querySelector('.f-act')!.getAnimations().length > 0;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Greeting: the chat's head and its empty chat greet the first time a day that chat is opened on this device.
let opened = 0;
function Chat({ agent }: { agent: string }) {
 return <Company><div key={opened} className="chat">
  <span id="head" data-greet aria-hidden="true"><AgentFace agent={agent} size={32}/></span>
  <div id="empty" data-greet aria-hidden="true"><AgentFace agent={agent} size={96}/></div>
  <span id="other" aria-hidden="true"><AgentFace agent={agent} size={56}/></span>
  <Greeting agent={agent}/>
 </div></Company>;
}
const openChat = async (agent: string) => { opened++; const screen = await render(<Chat agent={agent}/>); return screen; };

test('an Agent greets the first time a day its chat is opened on this device, on the head and the empty chat only', async () => {
 const first = await openChat('g1');
 await expect.poll(() => plays(faceOf('#head'), 'greet')).toBe(true);
 expect(plays(faceOf('#empty'), 'greet')).toBe(true);
 expect(moves(faceOf('#head'))).toBe(true);
 expect(faceOf('#other').dataset.moment).toBeUndefined();
 await first.unmount();
 // Opened again the same day: no greeting.
 await openChat('g1');
 await wait(50);
 expect(faceOf('#head').dataset.moment).toBeUndefined();
});

test('the next day the same chat greets again', async () => {
 vi.useFakeTimers({ toFake: ['Date'] });
 vi.setSystemTime(new Date(2026, 10, 24, 23, 58));
 const today = await openChat('g2');
 await expect.poll(() => plays(faceOf('#head'), 'greet')).toBe(true);
 await today.unmount();
 vi.setSystemTime(new Date(2026, 10, 25, 0, 3));
 await openChat('g2');
 await expect.poll(() => plays(faceOf('#head'), 'greet')).toBe(true);
});

test('with browser storage blocked an Agent greets at most once in the page', async () => {
 vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
 vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
 const first = await openChat('g3');
 await expect.poll(() => plays(faceOf('#head'), 'greet')).toBe(true);
 await first.unmount();
 await openChat('g3');
 await wait(50);
 expect(faceOf('#head').dataset.moment).toBeUndefined();
});

test('with reduced motion the greeting shows its still frames and nothing moves', async () => {
 await reducedMotion(true);
 await openChat('g4');
 await expect.poll(() => plays(faceOf('#head'), 'greet')).toBe(true);
 await expect.poll(() => faceOf('#head').classList.contains('is-look')).toBe(true);
 expect(moves(faceOf('#head'))).toBe(false);
});

// --- Birth: once for the person who asked, on the made Agent's card and its sidebar tile.
const made = (id: string, fresh: boolean): MadeAgent => ({ id, connection_id: id, name: 'Reach', job: 'Runs Meta ads', apps: [], fresh, created_at: '2026-11-24T10:00:00Z' });
// The server's one-time record: the first ask from the Agent's requester is answered true, every later one false.
function server() {
 const born = new Set<string>(); const asks: string[] = [];
 vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
  const { agent } = JSON.parse(String(init.body)) as { agent: string };
  asks.push(`${url} ${agent}`);
  const first = !born.has(agent); born.add(agent);
  return new Response(JSON.stringify({ born: first }), { headers: { 'content-type': 'application/json' } });
 }));
 return asks;
}
// The page: the Conversation's made card, and the sidebar's tile while it is new for this person.
function Page({ agent, fresh }: { agent: string, fresh: boolean }) {
 return <Company>
  <a id="tile" className="agent-tile" data-agent={agent} data-birth href="#"><AgentFace agent={agent} size={56}/>{fresh&&<Birth agent={agent}/>}</a>
  <div id="card"><MadeCard slug="rs" agent={made(agent, fresh)}/></div>
 </Company>;
}

test('a made Agent is born once for the person who asked, on its card and its tile; a reload mid-birth does not play it again', async () => {
 const asks = server();
 const first = await render(<Page agent="b1" fresh/>);
 await expect.poll(() => plays(faceOf('#card'), 'birth')).toBe(true);
 expect(plays(faceOf('#tile'), 'birth')).toBe(true);
 expect(moves(faceOf('#card'))).toBe(true);
 // One ask for the page, whatever the places.
 expect(asks).toEqual(['/api/agent-born b1']);
 // A reload while it is being born: the record was kept when the server answered, so nothing plays.
 await first.unmount();
 // The page loaded again: the moments' module starts afresh and asks again.
 const again = '../../components/face-moments.tsx?reload';
 const reloaded = await import(/* @vite-ignore */ again) as typeof import('@/components/face-moments');
 await render(<Company>
  <a id="tile2" data-birth href="#"><AgentFace agent="b1" size={56}/><reloaded.Birth agent="b1"/></a>
  <div id="card2"><MadeCard slug="rs" agent={made('b1', true)}/></div>
 </Company>);
 await expect.poll(() => asks.length).toBe(2);
 await wait(50);
 expect(faceOf('#card2').dataset.moment).toBeUndefined();
 expect(faceOf('#tile2').dataset.moment).toBeUndefined();
});

test('another Member, for whom the Agent is not new, sees no birth and asks nothing', async () => {
 const asks = server();
 await render(<Page agent="b2" fresh={false}/>);
 await wait(100);
 expect(asks).toEqual([]);
 expect(faceOf('#card').dataset.moment).toBeUndefined();
 expect(faceOf('#tile').dataset.moment).toBeUndefined();
});

test('with reduced motion a birth shows its still frames and nothing moves', async () => {
 server();
 await reducedMotion(true);
 await render(<Page agent="b3" fresh/>);
 await expect.poll(() => plays(faceOf('#card'), 'birth')).toBe(true);
 await expect.poll(() => ['is-shut', 'is-look'].some(frame => faceOf('#card').classList.contains(frame))).toBe(true);
 expect(moves(faceOf('#card'))).toBe(false);
});

// --- Perk: in the @ list, each time an Agent's name is written after @, in a Conversation and in a channel.
const agents: CallableAgent[] = [{ id: 'p1', connection_id: 'p1', name: 'Reach', speciality: 'Runs Meta ads' }, { id: 'p2', connection_id: 'p2', name: 'Meta Ads', speciality: 'Ads' }];
const rowFace = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(row => row.textContent?.includes(name))?.querySelector<HTMLElement>('.face--live') ?? null;
const composer = (channel: boolean) => render(<Company><CallableAgentsProvider agents={agents}>
 <MessageBox placeholder="Write" send={async () => null} call={channel ? { people: [], agents } : undefined}/>
</CallableAgentsProvider></Company>);

for (const channel of [false, true]) test(`an Agent perks up in the @ list each time its name is written after @ (${channel ? 'a channel' : 'a Conversation'})`, async () => {
 const screen = await composer(channel);
 const field = screen.getByRole('textbox');
 await userEvent.type(field, '@Rea');
 await expect.poll(() => rowFace('Reach')).not.toBeNull();
 expect(rowFace('Reach')!.dataset.moment).toBeUndefined();
 await userEvent.type(field, 'ch');
 await expect.poll(() => plays(rowFace('Reach'), 'perk')).toBe(true);
 expect(moves(rowFace('Reach')!)).toBe(true);
 // Written again: it perks again.
 await expect.poll(() => rowFace('Reach')?.dataset.moment, { timeout: 3000 }).toBeUndefined();
 await userEvent.type(field, '{Backspace}');
 await userEvent.type(field, 'h');
 await expect.poll(() => plays(rowFace('Reach'), 'perk')).toBe(true);
 // A name of two words perks on its first word, all that can be written before the space.
 await userEvent.clear(field);
 await userEvent.type(field, '@meta');
 await expect.poll(() => plays(rowFace('Meta Ads'), 'perk')).toBe(true);
});

test('the @ list tells a screen reader the Agent it points at', async () => {
 const screen = await composer(false);
 const field = screen.getByRole('textbox');
 await userEvent.type(field, '@');
 await expect.element(field).toHaveAttribute('aria-activedescendant');
 const active = () => document.getElementById(field.element().getAttribute('aria-activedescendant')!);
 expect(active()?.getAttribute('aria-selected')).toBe('true');
 expect(active()?.textContent).toContain('Reach');
 expect(field.element().getAttribute('aria-controls')).toBe(active()?.closest('[role="listbox"]')?.id);
});
