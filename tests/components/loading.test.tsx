import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { cdp, page } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import ConversationView, { EngineLoaded } from '@/app/c/[slug]/conversations/[id]/conversation';
import { ChatPlaceholder } from '@/app/conversation-thread';
import { NumbersPlaceholder, PeriodSwitch } from '@/app/c/[slug]/numbers/numbers-client';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ConversationRecord } from '@/lib/conversation-frame';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/conversations/cv-2', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/conversation-archive-actions', () => ({ archiveConversations: vi.fn() }));
// Links stay on the test page: a new page is the test drawing the next one.
vi.mock('@/lib/link', () => ({ default: ({ onClick, ...props }: ComponentProps<'a'>) => <a {...props} onClick={event => { onClick?.(event); event.preventDefault(); }}/> }));

const reducedMotion = (on: boolean) => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
afterEach(async () => { vi.unstubAllGlobals(); await reducedMotion(false); });
// The app's stylesheets in the order it loads them, app/globals.css with its reduced-motion rule among them.
beforeAll(async () => {
 const files = ['app/globals.css', 'app/tokens.css', 'app/shell.css', 'app/log.css', 'app/numbers.css'];
 const sheets: string[] = await Promise.all(files.map(async file => (await import(/* @vite-ignore */ `/${file}?inline`)).default));
 document.head.append(...sheets.map(css => Object.assign(document.createElement('style'), { textContent: css })));
});

const box = (element: Element) => element.getBoundingClientRect();
const chat = (language: 'en' | 'ar') => render(<LanguageProvider language={language}><div className="gw" dir={language === 'ar' ? 'rtl' : 'ltr'}>
 <div className="chat" style={{ height: 900 }}><ChatPlaceholder/></div>
</div></LanguageProvider>);
const visibility = (element: Element) => getComputedStyle(element).visibility;
// The placeholder as assistive technology reads it: a busy region whose one line of text, kept off the screen, says
// what is loading, and whose grey blocks it skips.
const busyRegion = (label: string) => {
 const text = page.getByText(label, { exact: true }).element();
 const region = text.parentElement!;
 expect([region.getAttribute('aria-busy'), region.getAttribute('role'), region.getAttribute('aria-label')]).toEqual(['true', null, null]);
 expect(region.textContent).toBe(label);
 expect([box(text).width, box(text).height]).toEqual([1, 1]);
 const blocks = [...region.children].filter(child => child !== text);
 expect(blocks.map(block => block.getAttribute('aria-hidden'))).toEqual(blocks.map(() => 'true'));
 return { region, blocks };
};

for (const [language, label, end] of [['en', 'Loading the chat', 'right'], ['ar', 'بيحمّل المحادثة', 'left']] as const) test(`in ${language} the chat's placeholder is a busy region that reads "${label}" and skips its grey blocks, and draws the person's message on the end side, a reply with its face and a reply with a card`, async () => {
 await page.viewport(1440, 900);
 await chat(language);
 const { region, blocks: [column] } = busyRegion(label);
 expect(region.classList.contains('transcript')).toBe(true);
 const blocks = [...column.children]; const width = box(column).width;
 expect(blocks.map(block => Math.round(box(block).width / width * 100))).toEqual([55, 80, 90]);
 expect(Math.round(box(blocks[0])[end])).toBe(Math.round(box(column)[end]));
 expect(blocks.map(block => [...block.children].map(part => Math.round(box(part).height)))).toEqual([[14, 14], [20, 14, 14, 14], [14, 14, 180]]);
 const [face] = blocks[1].children; const card = blocks[2].children[2];
 expect([Math.round(box(face).width), getComputedStyle(face).borderRadius]).toEqual([20, '50%']);
 expect([Math.round(box(card).width), getComputedStyle(card).borderRadius]).toEqual([Math.round(box(blocks[2]).width), '24px']);
 expect(getComputedStyle(blocks[0].children[0]).borderRadius).toBe('8px');
});

test('each grey block shimmers as the reference\'s .sk does, once every 1.2s without end, and holds still under reduced motion', async () => {
 await chat('en');
 const shimmer = () => { const { animationName, animationDuration, animationIterationCount } = getComputedStyle(document.querySelector('.sk')!, '::after'); return [animationName, animationDuration, animationIterationCount]; };
 expect(shimmer()).toEqual(['gw-shimmer', '1.2s', 'infinite']);
 await reducedMotion(true);
 expect(shimmer()[0]).toBe('none');
});

for (const reduced of [false, true]) test(`the placeholder stays hidden for its first 400ms, so a page that arrives at once never shows it${reduced ? ', with reduced motion too' : ''}`, async () => {
 await reducedMotion(reduced);
 await chat('en');
 const { region: column } = busyRegion('Loading the chat');
 // The placeholder's own clock, stopped and moved by the test.
 const [hold] = column.getAnimations();
 hold.pause();
 hold.currentTime = 0;
 expect(visibility(column)).toBe('hidden');
 hold.currentTime = 399;
 expect(visibility(column)).toBe('hidden');
 hold.currentTime = 400;
 expect(visibility(column)).toBe('visible');
});

const at = '2026-06-10T09:41:00Z';
const asked = { id: 1, author: 'person' as const, author_name: 'Omar', body: 'Draft the long launch plan', created_at: at };
const reply = { id: 2, author: 'agent' as const, author_name: 'Mona', body: 'On it.', created_at: at };
// Each test opens a Conversation of its own: the page keeps the last read of a Conversation in this browser.
let opens = 0;
const frame = (): ConversationRecord => ({
 conversation: { id: `cv-2-${++opens}`, agent_id: null, agent_name: 'Mona', face: 'c-2' }, messages: [], usage: null, pending: false, failed: false, working: null, canStop: false,
});
type Messages = ConversationRecord['messages'];
const found = (messages: Messages) => Response.json({ state: 'found', messages, nextOffset: messages.length, hasMore: false });
// The Engine's side as gtmworks's routes answer it (#875, #876): the first read of the session's messages waits until
// `arrive` (later ones answer `later`, or the same), the usage read answers none, the open Run's live read ends at once,
// and a send (a POST) is answered by `post`.
function held({ post = async () => Response.json({}), later }: { post?: (init: RequestInit) => Promise<Response>, later?: Messages } = {}) {
 let arrive!: (messages: Messages) => void;
 const first = new Promise<Messages>(resolve => { arrive = resolve; });
 const reads: string[] = [];
 vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
  if (init?.method === 'POST') return post(init);
  if (url.includes('&intent=read')) { reads.push(url); const messages = await first; return found(reads.length > 1 && later ? later : messages); }
  if (url.startsWith('/api/conversation-live?')) return new Response(`${JSON.stringify({ end: 'ended' })}\n`);
  if (url.includes('&intent=usage')) return Response.json({});
  return new Promise<Response>(() => {});
 });
 return { arrive, reads };
}
const chatPage = (initial: ConversationRecord) => <LanguageProvider language="en"><div className="gw" style={{ height: 900 }}>
 <ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={initial.conversation} title="Draft the long launch plan" writer><EngineLoaded initial={initial} team={false}/></ConversationView>
</div></LanguageProvider>;
const opened = (initial: ConversationRecord) => render(chatPage(initial));
const tops = () => ['.transcript__col', '.composer-area'].map(selector => Math.round(box(document.querySelector(selector)!).top));

test('while the messages are on their way the chat keeps its title and composer around the placeholder; the messages take its place without moving it, and what was typed stays in the box', async () => {
 await page.viewport(1440, 900);
 const { arrive } = held();
 const screen = await opened(frame());
 const placeholder = screen.getByText('Loading the chat', { exact: true });
 // Its 400ms hold is the hold test's; here it is ended on the placeholder's own clock.
 busyRegion('Loading the chat').region.getAnimations().forEach(animation => animation.finish());
 expect(visibility(placeholder.element())).toBe('visible');
 await expect.element(screen.getByRole('heading')).toHaveTextContent('Draft the long launch plan');
 const field = screen.getByRole('textbox', { name: 'Message' });
 await field.fill('And the budget');
 (field.element() as HTMLTextAreaElement).setSelectionRange(4, 7);
 const before = tops();
 arrive([asked, reply]);
 await expect.element(screen.getByText('On it.')).toBeVisible();
 await expect.element(placeholder).not.toBeInTheDocument();
 expect(tops()).toEqual(before);
 await expect.element(field).toHaveValue('And the budget');
 const loaded = field.element() as HTMLTextAreaElement;
 expect([document.activeElement === loaded, loaded.selectionStart, loaded.selectionEnd]).toEqual([true, 4, 7]);
});

test('text typed while the chat loads stays in the box without taking the focus from where the person moved it', async () => {
 const { arrive } = held();
 const initial = frame();
 const screen = await render(<LanguageProvider language="en"><button type="button">Elsewhere</button><div className="gw" style={{ height: 900 }}>
  <ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={initial.conversation} title="Draft the long launch plan" writer><EngineLoaded initial={initial} team={false}/></ConversationView>
 </div></LanguageProvider>);
 await screen.getByRole('textbox', { name: 'Message' }).fill('And the budget');
 const elsewhere = screen.getByRole('button', { name: 'Elsewhere' }).element() as HTMLElement;
 elsewhere.focus();
 arrive([asked, reply]);
 await expect.element(screen.getByText('On it.')).toBeVisible();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('And the budget');
 expect(document.activeElement).toBe(elsewhere);
});

test('a message sent before the messages arrive is posted at once, and once the chat is loaded its reply is followed and shown', async () => {
 const sent: unknown[] = [];
 const { arrive } = held({ post: async init => { sent.push(JSON.parse(String(init.body))); return Response.json({}); },
  later: [asked, { id: 3, author: 'person', author_name: 'Omar', body: 'And the budget', created_at: at }, { ...reply, id: 4, body: 'Reply to: And the budget' }] });
 const initial = frame();
 const screen = await opened(initial);
 const field = screen.getByRole('textbox', { name: 'Message' });
 await field.fill('And the budget');
 await screen.getByRole('button', { name: 'Send' }).click();
 await expect.poll(() => sent).toEqual([expect.objectContaining({ company: 'co-1', conversation: initial.conversation.id, message: 'And the budget' })]);
 await expect.element(field).toHaveValue('');
 arrive([asked]);
 await expect.element(screen.getByText('Reply to: And the budget'), { timeout: 3000 }).toBeVisible();
 expect(screen.getByText('And the budget', { exact: true }).elements(), 'the message is drawn once').toHaveLength(1);
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
});

test('a message sent while the chat loads whose answer is lost after it loaded comes back in the box, and sending it again is the same send', async () => {
 const keys: string[] = [];
 let lose!: () => void;
 const { arrive } = held({ post: async init => {
  keys.push(JSON.parse(String(init.body)).sendKey);
  if (keys.length === 1) await new Promise<void>(resolve => { lose = resolve; }).then(() => { throw new TypeError('Failed to fetch'); });
  return Response.json({});
 } });
 const screen = await opened(frame());
 await screen.getByRole('textbox', { name: 'Message' }).fill('And the budget');
 await screen.getByRole('button', { name: 'Send' }).click();
 await expect.poll(() => keys.length).toBe(1);
 arrive([asked]);
 await expect.element(screen.getByText('Loading the chat', { exact: true })).not.toBeInTheDocument();
 lose();
 const field = screen.getByRole('textbox', { name: 'Message' });
 await expect.element(field).toHaveValue('And the budget');
 await screen.getByRole('button', { name: 'Send' }).click();
 await expect.poll(() => keys.length).toBe(2);
 expect(keys[1]).toBe(keys[0]);
});

test('text typed into the server-drawn composer before the page is ready stays in the box once the chat is loaded', async () => {
 const { arrive } = held();
 const chat = chatPage(frame());
 const container = document.createElement('div'); document.body.append(container);
 container.innerHTML = renderToString(chat);
 const typed = container.querySelector('textarea')!;
 typed.value = 'Typed before the page was ready';
 const root = await act(async () => hydrateRoot(container, chat, { onRecoverableError: () => {} }));
 try {
  await act(async () => { arrive([asked, reply]); });
  await expect.poll(() => container.textContent).toContain('On it.');
  expect(container.querySelector('textarea')).toBe(typed);
  expect(typed.value).toBe('Typed before the page was ready');
 } finally { act(() => root.unmount()); container.remove(); }
});

const numbers = (language: 'en' | 'ar') => render(<LanguageProvider language={language}><div className="gw" dir={language === 'ar' ? 'rtl' : 'ltr'}>
 <main className="numbers-page"><div className="dash"><NumbersPlaceholder/></div></main>
</div></LanguageProvider>);

for (const [language, label] of [['en', 'Loading the numbers'], ['ar', 'بيحمّل الأرقام']] as const) test(`in ${language} the Numbers placeholder is a busy region that reads "${label}" and skips its grey blocks, with four 118px tiles in a row, then panels of 340 and 220, and 280 and 280`, async () => {
 await page.viewport(1440, 900);
 await numbers(language);
 const { region: inner, blocks: [tiles, ...rows] } = busyRegion(label);
 expect(inner.classList.contains('dash__inner')).toBe(true);
 expect([...tiles.children].map(tile => [Math.round(box(tile).height), Math.round(box(tile).top), getComputedStyle(tile).borderRadius])).toEqual(Array(4).fill([118, Math.round(box(tiles).top), '16px']));
 expect(rows.map(row => [...row.children].map(panel => Math.round(box(panel).height)))).toEqual([[340, 220], [280, 280]]);
});

test('after a period change the focus stays on the period chosen; a switch drawn without one leaves the focus where it is', async () => {
 const screen = await render(<LanguageProvider language="en"><PeriodSwitch key="7" slug="rs-learning" period="7"/></LanguageProvider>);
 await screen.getByRole('link', { name: 'Last 30 days' }).click();
 await screen.rerender(<LanguageProvider language="en"><PeriodSwitch key="30" slug="rs-learning" period="30"/></LanguageProvider>);
 const chosen = screen.getByRole('link', { name: 'Last 30 days' });
 await expect.element(chosen).toHaveAttribute('aria-current', 'true');
 expect(document.activeElement).toBe(chosen.element());
 (document.activeElement as HTMLElement).blur();
 await screen.rerender(<LanguageProvider language="en"><PeriodSwitch key="30 again" slug="rs-learning" period="30"/></LanguageProvider>);
 expect(document.activeElement).toBe(document.body);
});

test('a period chosen while the person moves the focus elsewhere leaves the focus where they moved it', async () => {
 const drawn = (period: '7' | '30') => <LanguageProvider language="en"><button type="button">Elsewhere</button><PeriodSwitch key={period} slug="rs-learning" period={period}/></LanguageProvider>;
 const screen = await render(drawn('7'));
 await screen.getByRole('link', { name: 'Last 30 days' }).click();
 const elsewhere = screen.getByRole('button', { name: 'Elsewhere' }).element() as HTMLElement;
 elsewhere.focus();
 await screen.rerender(drawn('30'));
 await expect.element(screen.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute('aria-current', 'true');
 expect(document.activeElement).toBe(elsewhere);
});
