import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { onTestFinished } from 'vitest';
import type { ComponentProps } from 'react';
import { CardWindow, type CardWindowCard, type CardWindowData } from '@/app/card-window';
import type { SaveResult } from '@/app/c/[slug]/[[...section]]/work';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import { fakeClock } from './fake-clock';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';

// #678: a Card opens in one window over the board (design-reference-card: openCard, renderCardWin).
const push = vi.fn<(href: string, options?: { scroll?: boolean }) => void>();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
const send = vi.fn<(form: FormData) => Promise<void>>(async () => {});
const save = vi.fn<(form: FormData) => Promise<SaveResult>>(async form => ({ saved: String(form.get('value')) }));
const move = vi.fn<(column: string) => Promise<boolean>>(async () => true);
afterEach(() => { vi.useRealTimers(); push.mockReset(); refresh.mockReset(); send.mockClear(); save.mockClear(); move.mockClear(); });

const data = (more: Partial<CardWindowData> = {}): CardWindowData => ({ id: 7, working: false, comments: <p>Shorter please</p>, commentCount: 1, activity: <p>Omar moved the card</p>, activityCount: 3,
 runs: [], files: [], creative: null, versions: [], made: { from: 'board', by: 'Omar', at: '2026-11-20T10:00:00Z' }, waits: [], ...more });
const card = (more: Partial<CardWindowCard> = {}): CardWindowCard => ({ id: 7, title: 'Launch post', status: 'planned', go_live: '2026-11-12T00:00:00+00:00', project_id: null, assignee: '', ...more });
const columnName = (column: string) => ({ waiting: 'Waiting on you', ideas: 'Ideas', planned: 'Planned', progress: 'In progress', live: 'Live', done: 'Done' })[column] ?? column;
type Props = Partial<ComponentProps<typeof CardWindow>>;
async function show(more: Props = {}, { language = 'en', width = 1440 }: { language?: Language, width?: number } = {}) {
 const { lang, dir } = document.documentElement;
 Object.assign(document.documentElement, { lang: language, dir: language === 'ar' ? 'rtl' : 'ltr' });
 onTestFinished(() => { Object.assign(document.documentElement, { lang, dir }); });
 await page.viewport(width, 800);
 return render(<LanguageProvider language={language}><div className="gw">
  <div id="board-cols"><div className="kcard" data-card-id="7"><a href="#card-7">Launch post</a></div></div>
  <CardWindow slug="rs-learning" company="co-1" me="p-me" card={card()} data={data()} symbol="" canWrite alone={false} columnName={columnName}
   assignees={{ agents: [{ id: 'ads', name: 'Ads' }], people: [{ id: 'p-me', name: 'Omar Abdo' }, { id: 'p-2', name: 'Salma' }] }}
   projects={[{ id: 3, name: 'Spring launch' }]} send={send} save={save} move={move} {...more}/>
 </div></LanguageProvider>);
}
const sent = (spy: typeof save | typeof send) => spy.mock.calls.map(([form]) => Object.fromEntries(form));

test('a Card opens in one modal window named by its title, with the keyboard on the title, on its Comments', async () => {
 const screen = await show();
 await expect.element(screen.getByRole('dialog', { name: 'Launch post' })).toBeVisible();
 expect(document.querySelector('dialog')!.matches(':modal')).toBe(true);
 await expect.element(screen.getByRole('heading', { name: 'Launch post' })).toHaveFocus();
 await expect.element(screen.getByRole('tab', { name: 'Comments 1' })).toHaveAttribute('aria-selected', 'true');
 await expect.element(screen.getByRole('tabpanel')).toHaveTextContent('Shorter please');
 await screen.getByRole('tab', { name: 'Activity 3' }).click();
 await expect.element(screen.getByRole('tabpanel')).toHaveTextContent('Omar moved the card');
 await expect.element(screen.getByRole('textbox', { name: 'Write a comment' })).not.toBeInTheDocument();
 await screen.getByRole('tab', { name: 'Runs 0' }).click();
 await expect.element(screen.getByRole('tabpanel')).toHaveTextContent('No runs yet');
});

test('Close lets the window leave first, then the board comes back with the keyboard on the tile', async () => {
 fakeClock();
 const screen = await show();
 (screen.getByRole('button', { name: 'Close the card' }).element() as HTMLButtonElement).click();
 await vi.advanceTimersByTimeAsync(0);
 expect(document.querySelector('dialog')!.classList.contains('is-closing')).toBe(true);
 await vi.advanceTimersByTimeAsync(190);
 expect(document.querySelector('dialog')!.open).toBe(false);
 await expect.poll(() => push.mock.calls).toEqual([['/c/rs-learning/work/board', { scroll: false }]]);
 await expect.element(screen.getByRole('link', { name: 'Launch post' })).toHaveFocus();
});

test('Escape closes the window back to the board', async () => {
 await show();
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => push.mock.calls.length).toBe(1);
});

test('the title saves as it changes, over the title the window read; an empty one is refused in words', async () => {
 const screen = await show();
 await screen.getByRole('button', { name: 'Launch post' }).click();
 const field = screen.getByRole('textbox', { name: 'Card title' });
 await expect.element(field).toHaveFocus();
 await field.fill('   ');
 await userEvent.keyboard('{Enter}');
 await expect.element(screen.getByRole('alert')).toHaveTextContent('A card needs a title, even two words.');
 expect(save).not.toHaveBeenCalled();
 await field.fill('Launch post for June');
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => sent(save)).toEqual([{ company: 'co-1', slug: 'rs-learning', card: '7', field: 'title', value: 'Launch post for June', seen: 'Launch post' }]);
 await expect.element(screen.getByRole('button', { name: 'Launch post for June' })).toHaveFocus();
});

test('a save someone else\'s change overtook is refused, and the newer value shows with a line saying so', async () => {
 save.mockImplementationOnce(async () => ({ stale: 'Launch post, by Salma' }));
 const screen = await show();
 await screen.getByRole('button', { name: 'Launch post' }).click();
 await screen.getByRole('textbox', { name: 'Card title' }).fill('Mine');
 await userEvent.keyboard('{Enter}');
 await expect.element(screen.getByRole('alert')).toHaveTextContent('Someone changed this meanwhile. It now reads: Launch post, by Salma');
 await expect.element(screen.getByRole('heading', { name: 'Launch post, by Salma' })).toBeVisible();
});

test('the assignee menu offers Assign to me, the Agents, the Members and no one, and saves the one picked', async () => {
 const screen = await show();
 await screen.getByRole('button', { name: 'Assignee: No one yet' }).click();
 const menu = screen.getByRole('menu', { name: 'Assignee: No one yet' });
 await expect.element(menu.getByRole('menuitem', { name: 'Assign to me' })).toHaveFocus();
 expect(menu.getByRole('menuitem').elements().map(item => item.querySelector('.menu__t')?.textContent)).toEqual(['Assign to me', 'Ads', 'Omar Abdo', 'Salma', 'No one yet']);
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => sent(save)).toEqual([{ company: 'co-1', slug: 'rs-learning', card: '7', field: 'assignee', value: 'p:p-me', seen: '' }]);
 await expect.element(screen.getByRole('button', { name: 'Assignee: Omar Abdo' })).toHaveFocus();
});

test('the publishing date and the Project save as they change', async () => {
 const screen = await show();
 await screen.getByLabelText('Publishing date').fill('2026-11-20');
 await screen.getByRole('button', { name: 'Project: None' }).click();
 await screen.getByRole('menuitemradio', { name: 'Spring launch' }).click();
 await expect.poll(() => sent(save).map(({ field, value, seen }) => [field, value, seen])).toEqual([['go_live', '2026-11-20', '2026-11-12'], ['project', '3', '']]);
});

test('the status is a menu of the six columns; Waiting on you is filled by itself, and a choice moves the Card', async () => {
 const screen = await show({ symbol: 'onyou' });
 await screen.getByRole('button', { name: 'Status: Planned · On you' }).click();
 await expect.element(screen.getByRole('menuitemradio', { name: 'Planned' })).toHaveAttribute('aria-checked', 'true');
 await expect.element(screen.getByRole('menuitemradio', { name: 'Waiting on you' })).toHaveAttribute('aria-disabled', 'true');
 await screen.getByRole('menuitemradio', { name: 'Live' }).click();
 expect(move.mock.calls).toEqual([['live']]);
});

test('a comment is posted with Enter, with its files, and the field is empty again', async () => {
 const screen = await show();
 const field = screen.getByRole('textbox', { name: 'Write a comment' });
 await field.fill('Shorter please');
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => sent(send).map(({ op, card: id, body, view }) => ({ op, card: id, body, view }))).toEqual([{ op: 'comment', card: '7', body: 'Shorter please', view: 'sheet' }]);
 await expect.element(field).toHaveValue('');
});

test('the comment field offers the team and the Agents with "@"', async () => {
 const screen = await show({ people: [{ id: 'p-2', name: 'Salma', role: 'manager' }], agents: [{ id: 'ads', name: 'Ads', connection_id: 'c-ads' } as never] });
 await screen.getByRole('textbox', { name: 'Write a comment' }).fill('@');
 await expect.element(screen.getByRole('listbox')).toBeVisible();
 expect(screen.getByRole('listbox').getByRole('option').elements().map(option => option.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Salma'), expect.stringContaining('Ads')]));
});

test('Versions are uploaded and opened under Result, newest first', async () => {
 const screen = await show({ data: data({ creative: 4, versions: [{ id: 2, n: 2, name: 'post-v2.png', url: 'https://storage/v2', at: '2026-11-21T10:00:00Z' }, { id: 1, n: 1, name: 'post.png', url: 'https://storage/v1', at: '2026-11-20T10:00:00Z' }] }) });
 const versions = screen.getByRole('list', { name: 'Versions' });
 expect(versions.getByRole('link').elements().map(link => [link.getAttribute('aria-label'), link.getAttribute('href')])).toEqual([['Open version 2: post-v2.png', 'https://storage/v2'], ['Open version 1: post.png', 'https://storage/v1']]);
 await screen.getByLabelText('Upload a version').upload(new File(['x'], 'post-v3.png', { type: 'image/png' }));
 await expect.poll(() => sent(send).map(({ op, creative, view }) => ({ op, creative, view }))).toEqual([{ op: 'upload', creative: '4', view: 'sheet' }]);
});

test('files are added to the Card itself as they are chosen', async () => {
 const screen = await show();
 await screen.getByLabelText('Add files').upload(new File(['x'], 'brief.pdf', { type: 'application/pdf' }));
 await expect.poll(() => sent(send).map(({ op, card: id }) => ({ op, card: id }))).toEqual([{ op: 'files', card: '7' }]);
});

test('a Card made in another Member\'s private chat shows who made it and a lock, and nothing that was said', async () => {
 const screen = await show({ data: data({ made: { from: 'chat-private', by: 'Salma', person: 'Salma', at: '2026-11-20T10:00:00Z' } }) });
 await expect.element(screen.getByRole('img', { name: 'A private chat of Salma' })).toBeVisible();
 await expect.element(screen.getByRole('link', { name: 'Open the conversation' })).not.toBeInTheDocument();
 await expect.poll(() => screen.getByRole('complementary', { name: 'Card details' }).element().textContent).toContain('Made by: Salma');
});

test('a Card made in the reader\'s own chat links to it', async () => {
 const screen = await show({ data: data({ made: { from: 'chat', by: 'Omar', href: '/c/rs-learning/conversations/c-1', at: '2026-11-20T10:00:00Z' } }) });
 await expect.element(screen.getByRole('link', { name: 'Open the conversation' })).toHaveAttribute('href', '/c/rs-learning/conversations/c-1');
});

test('a Viewer reads everything with no control drawn, and nothing drawn for an empty property', async () => {
 const screen = await show({ canWrite: false, symbol: 'review', card: card({ status: 'waiting', go_live: null }) });
 await expect.element(screen.getByRole('img', { name: 'Read only' })).toBeVisible();
 await expect.element(screen.getByRole('img', { name: 'Needs review' })).toBeVisible();
 const dialog = screen.getByRole('dialog');
 expect(dialog.getByRole('button').elements().map(button => button.getAttribute('aria-label'))).toEqual(['Close the card']);
 expect(document.querySelectorAll('dialog input, dialog textarea, dialog [role="menu"]').length).toBe(0);
 await expect.element(screen.getByText('Publishing date', { exact: false })).not.toBeInTheDocument();
 await expect.poll(() => screen.getByRole('complementary', { name: 'Card details' }).element().textContent).toContain('Assignee:No one yet');
});

test('each symbol and icon-only control has a tooltip and an accessible name, shown on keyboard focus', async () => {
 const screen = await show({ symbol: 'onyou' });
 await expect.element(screen.getByRole('button', { name: 'Status: Planned · On you' })).toBeVisible();
 for (const tipped of document.querySelectorAll<HTMLElement>('dialog [data-tip]')) {
  const named = tipped.getAttribute('aria-label') || tipped.closest('[aria-label]')?.getAttribute('aria-label') || tipped.querySelector('.sr-only')?.textContent || tipped.closest('.cwp')?.querySelector('.sr-only')?.textContent || tipped.textContent;
  expect(named, tipped.outerHTML).toBeTruthy();
 }
 await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
 await expect.element(screen.getByRole('button', { name: 'Close the card' })).toHaveFocus();
 await expect.element(screen.getByRole('tooltip')).toHaveTextContent('Close');
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => document.querySelector<HTMLElement>('.gtip')!.hidden).toBe(true);
});

for (const language of ['en', 'ar'] as const) test(`in ${language} on a phone the window is full screen and Tab follows what is seen: title, properties, then comments`, async () => {
 const screen = await show({}, { language, width: 390 });
 const box = document.querySelector('dialog')!.getBoundingClientRect();
 expect([Math.round(box.width), Math.round(box.height)]).toEqual([390, 800]);
 const at = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top;
 expect(at('.cw-title')).toBeLessThan(at('.cw-side'));
 expect(at('.cw-side')).toBeLessThan(at('.cw-feed'));
 const order = [...document.querySelectorAll<HTMLElement>('dialog button, dialog input, dialog textarea, dialog a')].filter(el => !el.closest('[hidden]'));
 const title = order.findIndex(el => el.id === 'cw-title-btn'); const assignee = order.findIndex(el => el.getAttribute('aria-label')?.startsWith(language === 'en' ? 'Assignee' : 'المسؤول')); const comment = order.findIndex(el => el.id === 'ta-note');
 expect(title).toBeLessThan(assignee); expect(assignee).toBeLessThan(comment);
 void screen;
});

test('a long title never hides the details: they are reached by scrolling the window', async () => {
 await show({ card: card({ title: 'A very long title '.repeat(80) }) }, { width: 1440 });
 const body = document.querySelector<HTMLElement>('.cw-body')!;
 expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
 body.scrollTop = body.scrollHeight;
 const side = document.querySelector('.cw-side')!.getBoundingClientRect(); const view = body.getBoundingClientRect();
 expect(side.top).toBeLessThan(view.bottom);
 expect(document.querySelector('.cw-head')!.getBoundingClientRect().height).toBeLessThan(80);
});

// #682: a Card waits for other Cards; each side shows the other, a released one ticked, a hidden one unnamed.
test('the Cards a Card waits for and those waiting for it are chips that open them; a writer adds and takes off a wait', async () => {
 const waits = [
  { side: 'waits_for' as const, other: 3, title: 'Design', status: 'progress', open: true },
  { side: 'waits_for' as const, other: 4, title: 'Copy', status: 'done', open: false },
  { side: 'waits_for' as const, other: 5, title: null, status: null, open: true },
  { side: 'waited_by' as const, other: 9, title: 'Launch', status: 'planned', open: true },
 ];
 const screen = await show({ data: data({ waits }), waitChoices: [{ id: 3, title: 'Design', status: 'progress' }, { id: 6, title: 'Research', status: 'ideas' }, { id: 8, title: 'Old', status: 'done' }, { id: 7, title: 'Launch post', status: 'planned' }] });
 const design = screen.getByRole('link', { name: 'Design · In progress' });
 await expect.element(design).toHaveAttribute('href', '/c/rs-learning/work/board?card=3');
 await expect.element(screen.getByRole('link', { name: 'Copy · Done' })).toBeVisible();
 expect(document.querySelector('a[aria-label="Copy · Done"] .dot')).toBeNull();
 await expect.element(screen.getByText('A hidden card')).toBeVisible();
 await expect.element(screen.getByRole('link', { name: 'Launch · Planned' })).toBeVisible();
 // Taking a wait off.
 await screen.getByRole('button', { name: 'Stop waiting for Design' }).click();
 expect(Object.fromEntries(send.mock.lastCall![0].entries())).toMatchObject({ op: 'wait-remove', card: '7', waits_for: '3' });
 // Adding one: the Card itself, one it already waits for and a Done one are not offered.
 await screen.getByRole('button', { name: 'Wait for another card' }).click();
 const items = screen.getByRole('menuitem');
 expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(1);
 await screen.getByRole('menuitem', { name: 'Research' }).click();
 expect(Object.fromEntries(send.mock.lastCall![0].entries())).toMatchObject({ op: 'wait-add', card: '7', waits_for: '6' });
});

test('a Viewer reads the waits with no control', async () => {
 const screen = await show({ canWrite: false, data: data({ waits: [{ side: 'waits_for', other: 3, title: 'Design', status: 'progress', open: true }] }), waitChoices: [{ id: 6, title: 'Research', status: 'ideas' }] });
 await expect.element(screen.getByRole('link', { name: 'Design · In progress' })).toBeVisible();
 expect(document.querySelector('.cw-chip__x')).toBeNull();
 expect(screen.container.querySelector('[aria-label="Wait for another card"]')).toBeNull();
});
