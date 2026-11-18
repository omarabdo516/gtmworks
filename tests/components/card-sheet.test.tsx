import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { CardSheet, type CardSheetData } from '@/app/card-sheet';
import type { ConversationRecord } from '@/lib/conversation-record';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/tokens.css';
import '@/app/shell.css';

const push = vi.fn<(href: string, options?: { scroll?: boolean }) => void>();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
const sent = vi.fn<(form: FormData) => Promise<unknown>>();
afterEach(() => { vi.useRealTimers(); push.mockReset(); refresh.mockReset(); sent.mockReset(); vi.unstubAllGlobals(); });

const sheet = (more: Partial<CardSheetData> = {}): CardSheetData => ({ id: 7, log: <p>Omar moved the card</p>, count: 3, working: false, chat: { kind: 'none' }, ...more });
// The board behind the sheet holds the Card's link, where the keyboard goes back when the sheet closes.
const show = (value: CardSheetData, canWrite = true, more: Pick<ComponentProps<typeof CardSheet>, 'people' | 'agents'> = {}) => render(<LanguageProvider language="en">
 <div id="board-cols"><div className="kcard" data-card-id="7"><a href="#card-7">Launch post</a></div></div>
 <CardSheet slug="rs-learning" company="co-1" title="Launch post" face={null} who={<bdi>Ads</bdi>} badge={<span className="badge">Ideas</span>} sheet={value} canWrite={canWrite} alone={false} send={sent} {...more}/>
</LanguageProvider>);
const dialog = () => document.querySelector('dialog')!;
const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

test('a Card opens as a modal sheet on its Log, with the count, the note field ready and the Card page one link away', async () => {
 const screen = await show(sheet());
 await expect.element(screen.getByRole('dialog', { name: 'Launch post' })).toBeVisible();
 expect(dialog().matches(':modal')).toBe(true);
 await expect.element(screen.getByRole('tab', { name: 'Log 3' })).toHaveAttribute('aria-selected', 'true');
 await expect.element(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-disabled', 'true');
 await expect.element(screen.getByRole('tabpanel', { name: 'Log 3' })).toHaveTextContent('Omar moved the card');
 await expect.element(screen.getByRole('textbox', { name: 'Write a note in the card’s log' })).toHaveFocus();
 await expect.element(screen.getByRole('link', { name: 'Card details' })).toHaveAttribute('href', '/c/rs-learning/work/board/7');
 await expect.element(screen.getByRole('link', { name: 'Open in Chats' })).not.toBeInTheDocument();
});

test('Close slides the sheet out before it closes, then the board comes back with the keyboard on the Card', async () => {
 fakeClock();
 const screen = await show(sheet());
 // Pressed in the page itself, since a driver click moves a fake clock by its own wall time; React then renders.
 (screen.getByRole('button', { name: 'Close', exact: true }).element() as HTMLButtonElement).click();
 await vi.advanceTimersByTimeAsync(0);
 expect(dialog().open).toBe(true);
 expect(dialog().classList.contains('is-closing')).toBe(true);
 expect(push).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(189);
 expect(dialog().open).toBe(true);
 expect(dialog().classList.contains('is-closing')).toBe(true);
 expect(push).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);
 expect(dialog().open).toBe(false);
 await expect.poll(() => push.mock.calls).toEqual([['/c/rs-learning/work/board', { scroll: false }]]);
 await expect.element(screen.getByRole('link', { name: 'Launch post' })).toHaveFocus();
});

test('with reduced motion the sheet closes at once', async () => {
 vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
 const screen = await show(sheet());
 await screen.getByRole('button', { name: 'Close', exact: true }).click();
 expect(dialog().open).toBe(false);
 expect(dialog().classList.contains('is-closing')).toBe(false);
 await expect.poll(() => push.mock.calls).toEqual([['/c/rs-learning/work/board', { scroll: false }]]);
});

test('Escape closes the sheet and returns to the board', async () => {
 await show(sheet());
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => push.mock.calls).toEqual([['/c/rs-learning/work/board', { scroll: false }]]);
 expect(dialog().open).toBe(false);
});

test('a note is sent from the Log tab with Enter, then the field is empty again', async () => {
 sent.mockResolvedValue(undefined);
 const screen = await show(sheet());
 const field = screen.getByRole('textbox', { name: 'Write a note in the card’s log' });
 const send = screen.getByRole('button', { name: 'Add the note' });
 await expect.element(send).toBeDisabled();
 await userEvent.type(field, 'Ready for review{Enter}');
 await expect.poll(() => sent.mock.calls.length).toBe(1);
 const form = sent.mock.calls[0][0];
 expect(Object.fromEntries(form)).toEqual({ op: 'comment', slug: 'rs-learning', company: 'co-1', card: '7', view: 'sheet', body: 'Ready for review' });
 await expect.element(field).toHaveValue('');
 await expect.element(send).toBeDisabled();
});

test('the note field offers the team and the Agents with "@", never Commands, and Enter picks instead of sending the note', async () => {
 const people = [{ id: 'p-2', name: 'Sara Hassan', role: 'manager' as const }, { id: 'p-4', name: 'Mona Ali', role: 'viewer' as const }];
 const agents = [{ id: 'a-1', connection_id: 'c-1', name: 'Ads', speciality: 'Marketing' }];
 const screen = await show(sheet(), true, { people, agents });
 const field = screen.getByRole('textbox', { name: 'Write a note in the card’s log' });
 await expect.element(field).toHaveAttribute('aria-expanded', 'false');
 await userEvent.type(field, '@');
 await expect.element(screen.getByRole('listbox', { name: 'Call someone' })).toBeVisible();
 await expect.element(field).toHaveAttribute('aria-expanded', 'true');
 expect(screen.getByRole('option').elements().map(option => option.textContent)).toEqual(['SSara HassanManager@Sara', 'MMona AliViewer · reads only@Mona', 'AdsMarketing']);
 await userEvent.keyboard('{Enter}');
 await expect.element(field).toHaveValue('@Sara ');
 expect(sent).not.toHaveBeenCalled();
 await userEvent.type(field, '/a');
 await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument();
 await userEvent.type(field, '{Backspace}{Backspace}@Mo');
 await expect.element(screen.getByRole('listbox', { name: 'Call someone' })).toBeVisible();
 expect(screen.getByRole('option').elements().map(option => option.textContent)).toEqual(['MMona AliViewer · reads only@Mona']);
 await userEvent.keyboard('{Tab}');
 await expect.element(field).toHaveValue('@Sara @Mona ');
 expect(sent).not.toHaveBeenCalled();
 await userEvent.type(field, '@');
 await expect.element(screen.getByRole('listbox')).toBeVisible();
 await userEvent.keyboard('{Escape}');
 await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument();
 await expect.element(field).toHaveValue('@Sara @Mona @');
 expect(dialog().open, 'Escape closes the list, not the sheet').toBe(true);
});

test('a Viewer reads the log with no note field', async () => {
 const screen = await show(sheet(), false);
 await expect.element(screen.getByRole('tabpanel', { name: 'Log 3' })).toBeVisible();
 await expect.element(screen.getByRole('textbox')).not.toBeInTheDocument();
 await expect.element(screen.getByText('Your account is view-only: you can read the whole log, without writing notes.')).toBeVisible();
});

const at = '2026-06-10T10:00:00Z';
const ads = { id: 'a-1', name: 'Ads', connection_id: 'c-1' };
const own = (more: Partial<ConversationRecord> = {}): ConversationRecord => ({
 conversation: { id: 'c0ffee00-0000-0000-0000-000000000001', agent_id: null, agent_name: 'Ads', face: 'c-1' },
 messages: [
  { id: 1, author: 'person', author_name: 'Omar', body: 'Plan three ads for the course', created_at: at },
  { id: 2, author: 'agent', author_name: 'Ads', body: 'On it: the audience first, then three ads.', created_at: at },
 ],
 usage: { input: 10, output: 2 }, pending: false, failed: false, working: null, canStop: false, board: { card: 7, column: 'progress' }, ...more,
});
const chatPanel = (screen: Awaited<ReturnType<typeof show>>) => screen.getByRole('tabpanel', { name: 'Chat' });

test('the reader\'s own chat on a Card opens on Chat with its messages and composer, and links to it in Chats', async () => {
 const screen = await show(sheet({ chat: { kind: 'own', record: own() } }));
 await expect.element(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
 await expect.element(screen.getByRole('tab', { name: 'Chat' })).not.toHaveAttribute('aria-disabled');
 await expect.element(chatPanel(screen).getByText('Plan three ads for the course')).toBeVisible();
 await expect.element(chatPanel(screen).getByText('On it: the audience first, then three ads.')).toBeVisible();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Write to Ads…');
 await expect.element(screen.getByRole('link', { name: 'Open in Chats' })).toHaveAttribute('href', '/c/rs-learning/conversations/c0ffee00-0000-0000-0000-000000000001');
 expect(document.querySelector('[data-usage]')).toBeNull();
 await screen.getByRole('tab', { name: 'Log 3' }).click();
 await expect.element(screen.getByRole('textbox', { name: 'Write a note in the card’s log' })).toBeVisible();
});

test('a message written in the sheet goes into the Card\'s chat and its reply shows there', async () => {
 const replied = own({ messages: [...own().messages, { id: 3, author: 'person', author_name: 'Omar', body: 'Make the first one shorter', created_at: at }, { id: 4, author: 'agent', author_name: 'Ads', body: 'Shorter it is.', created_at: at }] });
 const asks = vi.fn(async (_: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({ conversation: replied.conversation.id }) : Response.json(replied));
 vi.stubGlobal('fetch', asks);
 const screen = await show(sheet({ chat: { kind: 'own', record: own() } }));
 await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Make the first one shorter{Enter}');
 await expect.element(chatPanel(screen).getByText('Shorter it is.')).toBeVisible();
 const posted = JSON.parse(String(asks.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body));
 expect(posted).toMatchObject({ company: 'co-1', conversation: 'c0ffee00-0000-0000-0000-000000000001', message: 'Make the first one shorter' });
 expect(posted).not.toHaveProperty('card');
});

test('a message still on its way when the reader turns to Log lands in the chat they come back to, with its reply', async () => {
 const replied = own({ messages: [...own().messages, { id: 3, author: 'person', author_name: 'Omar', body: 'Make the first one shorter', created_at: at }, { id: 4, author: 'agent', author_name: 'Ads', body: 'Shorter it is.', created_at: at }] });
 let arrive = () => {};
 const asks = vi.fn((_: string, init?: RequestInit) => init?.method === 'POST' ? new Promise<Response>(resolve => { arrive = () => resolve(Response.json({ conversation: replied.conversation.id })); }) : Promise.resolve(Response.json(replied)));
 vi.stubGlobal('fetch', asks);
 const screen = await show(sheet({ chat: { kind: 'own', record: own() } }));
 await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Make the first one shorter{Enter}');
 await expect.poll(() => asks.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
 await screen.getByRole('tab', { name: 'Log 3' }).click();
 await expect.element(screen.getByRole('tabpanel', { name: 'Log 3' })).toBeVisible();
 arrive();
 await expect.poll(() => asks.mock.calls.some(([, init]) => init?.method !== 'POST')).toBe(true);
 await screen.getByRole('tab', { name: 'Chat' }).click();
 await expect.element(chatPanel(screen).getByText('Shorter it is.')).toBeVisible();
});

test('another Member\'s chat opens the Card on Log; its Chat tab is a lock with the way back to the log and nothing of the chat', async () => {
 const screen = await show(sheet({ chat: { kind: 'theirs', agent: ads, person: 'Youssef' } }));
 await expect.element(screen.getByRole('tab', { name: 'Log 3' })).toHaveAttribute('aria-selected', 'true');
 await expect.element(screen.getByRole('textbox', { name: 'Write a note in the card’s log' })).toHaveFocus();
 await expect.element(screen.getByRole('link', { name: 'Open in Chats' })).not.toBeInTheDocument();
 await screen.getByRole('tab', { name: 'Chat' }).click();
 await expect.element(chatPanel(screen).getByRole('heading', { name: 'This chat is between Youssef and Ads only' })).toBeVisible();
 await expect.element(chatPanel(screen).getByText('The shared work on this card is its status and its log. If you have something to say, write it as a note in the log and everyone sees it.')).toBeVisible();
 await expect.element(screen.getByRole('textbox')).not.toBeInTheDocument();
 expect(document.querySelector('.turns')).toBeNull();
 await chatPanel(screen).getByRole('button', { name: 'Open the log' }).click();
 await expect.element(screen.getByRole('tab', { name: 'Log 3' })).toHaveAttribute('aria-selected', 'true');
 await expect.element(screen.getByRole('tab', { name: 'Log 3' })).toHaveFocus();
});

test('a Card with an Agent and no chat opens on Chat; the first message starts the Card\'s chat and shows it at once', async () => {
 const asks = vi.fn(async (_: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({ conversation: JSON.parse(String(init.body)).conversation }) : Response.json(own()));
 vi.stubGlobal('fetch', asks);
 const screen = await show(sheet({ chat: { kind: 'empty', agent: ads } }));
 await expect.element(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
 await expect.element(chatPanel(screen).getByRole('heading', { name: 'No chat on this card yet' })).toBeVisible();
 await expect.element(chatPanel(screen).getByText('Write to Ads below and it’ll start working on it and keep the card updated.')).toBeVisible();
 await expect.element(screen.getByRole('link', { name: 'Open in Chats' })).not.toBeInTheDocument();
 const field = screen.getByRole('textbox', { name: 'Message' });
 await expect.element(field).toHaveFocus();
 await userEvent.type(field, 'Plan three ads for the course{Enter}');
 await expect.element(chatPanel(screen).getByText('Plan three ads for the course')).toBeVisible();
 await expect.element(screen.getByText('Ads is working on a reply…')).toBeVisible();
 const posted = JSON.parse(String(asks.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body));
 expect(posted).toMatchObject({ company: 'co-1', card: 7, message: 'Plan three ads for the course' });
 expect(posted.conversation).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 expect(refresh).toHaveBeenCalled();
 await expect.element(chatPanel(screen).getByText('On it: the audience first, then three ads.')).toBeVisible();
 expect(asks.mock.calls.filter(([url]) => String(url).includes(`conversation=${posted.conversation}`)).length).toBeGreaterThan(0);
});

test('when another Member started the Card\'s chat first, the sheet says so and reads the Card again', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'sheetChatTaken' }, { status: 409 })));
 const screen = await show(sheet({ chat: { kind: 'empty', agent: ads } }));
 await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Plan three ads{Enter}');
 await expect.element(screen.getByRole('alert').filter({ hasText: 'Someone else started the chat on this card just now.' })).toBeVisible();
 expect(refresh).toHaveBeenCalled();
});

test('a Viewer sees the empty state with the view-only line and no composer', async () => {
 const screen = await show(sheet({ chat: { kind: 'empty', agent: ads } }), false);
 await expect.element(chatPanel(screen).getByRole('heading', { name: 'No chat on this card yet' })).toBeVisible();
 await expect.element(screen.getByRole('textbox')).not.toBeInTheDocument();
 await expect.element(screen.getByText('Your account is view-only: you can read everything you’re allowed to, without writing, approving or changing anything.')).toBeVisible();
});

// The reference's motion (design-reference/index.html: .sheet[open], .sheet.is-closing, sheetIn/sheetOut and their
// LTR twins): in over 280ms easing out, out over 190ms easing in, each 24px from the inline end with the opacity.
const motion = () => { const style = getComputedStyle(dialog()); const [move] = document.getAnimations().filter(a => (a.effect as KeyframeEffect | null)?.target === dialog());
 return { name: style.animationName, duration: style.animationDuration, easing: style.animationTimingFunction, frames: (move?.effect as KeyframeEffect | undefined)?.getKeyframes().map(k => [k.transform, k.opacity]) }; };
for (const [dir, shift, suffix] of [['rtl', '-24px', ''], ['ltr', '24px', 'Ltr']] as const) test(`in ${dir} the sheet slides in and out as the reference does`, async () => {
 fakeClock();
 document.documentElement.dir = dir;
 const screen = await render(<div className="gw"><LanguageProvider language={dir === 'rtl' ? 'ar' : 'en'}><CardSheet slug="rs-learning" company="co-1" title="Launch post" face={null} who={null} badge={null} sheet={sheet()} canWrite alone={false} send={sent}/></LanguageProvider></div>);
 expect(motion()).toEqual({ name: `sheetIn${suffix}`, duration: '0.28s', easing: 'cubic-bezier(0.2, 0, 0, 1)', frames: [[`translateX(${shift})`, '0'], ['none', '1']] });
 // Pressed in the page itself, since a driver click moves a fake clock by its own wall time; the leave is read a frame later.
 (screen.getByRole('button', { name: dir === 'rtl' ? 'اقفل' : 'Close', exact: true }).element() as HTMLButtonElement).click();
 await new Promise(requestAnimationFrame);
 expect(motion()).toEqual({ name: `sheetOut${suffix}`, duration: '0.19s', easing: 'cubic-bezier(0.4, 0, 1, 1)', frames: [['none', '1'], [`translateX(${shift})`, '0']] });
 expect(getComputedStyle(dialog(), '::backdrop').animationName).toBe('none');
 document.documentElement.dir = '';
});

// The title sits at the interface's start, beside the face, whatever language it is written in (design-reference:
// renderSheetHead, bx); inside its <bdi> it keeps its own direction.
for (const [dir, language, title] of [['ltr', 'en', 'أفكار لمحتوى الشهر'], ['rtl', 'ar', 'Launch post for June']] as const) test(`a ${dir === 'ltr' ? 'Arabic title in the English' : 'English title in the Arabic'} interface starts beside the face`, async () => {
 document.documentElement.dir = dir;
 await render(<div className="gw" dir={dir}><LanguageProvider language={language}><CardSheet slug="rs-learning" company="co-1" title={title} face={<span data-face style={{ display: 'inline-block', width: 28, height: 28 }}/>} who={null} badge={null} sheet={sheet()} canWrite alone={false} send={sent}/></LanguageProvider></div>);
 const heading = document.querySelector('#sheet-title')!, text = heading.querySelector('bdi')!.getBoundingClientRect(), box = heading.getBoundingClientRect(), face = document.querySelector('[data-face]')!.getBoundingClientRect();
 expect(getComputedStyle(heading).direction).toBe(dir);
 if (dir === 'ltr') { expect(Math.abs(text.left - box.left)).toBeLessThan(1); expect(box.left).toBeGreaterThanOrEqual(face.right); }
 else { expect(Math.abs(text.right - box.right)).toBeLessThan(1); expect(box.right).toBeLessThanOrEqual(face.left); }
 document.documentElement.dir = '';
});
