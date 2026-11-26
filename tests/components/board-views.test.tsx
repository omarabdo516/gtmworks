import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import type {} from '@vitest/browser-playwright';
import BoardViews from '@/app/c/[slug]/[[...section]]/board-views';
import type { BoardCard } from '@/app/c/[slug]/[[...section]]/board';
import { LanguageProvider } from '@/lib/i18n-client';
import { LooksProvider } from '@/lib/agent-looks-client';
import { Frame, PageFrame } from '@/app/frame';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/list' }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));

// The list and the calendar (spec #831, #845) read the same board answer the board reads (/api/board): the list sorts
// and filters it by Assignee, status and Project, the calendar places a Card on its publishing date and lists the
// undated ones beside it. A Card's date is set through the board's own route, and the views draw the answer it gives.
// The board's live socket is stood in for by one that never opens: the views read on their own.
class Socket extends EventTarget { readyState = 0; close() { this.readyState = 3; } }
// Each test is its own Company's page: the browser keeps the last good read per Company, as the board keeps it.
let company = '';
let companies = 0;
const card = (more: Partial<BoardCard> & { id: string, title: string }): BoardCard =>
 ({ column: 'planned', symbol: null, agent: null, person: null, comments: 0, project: null, publishOn: null, ...more });
const ads = { id: '3b000000-0000-0000-0000-000000000011', name: 'Ads' };
const mona = { id: '20000000-0000-0000-0000-000000000002', name: 'Mona' };
const cards = [
 card({ id: 't_reel', title: 'Launch reel', column: 'progress', agent: ads, project: 'Spring course', publishOn: '2026-12-03' }),
 card({ id: 't_copy', title: 'December ad copy', agent: ads, publishOn: '2026-12-24' }),
 card({ id: 't_shoot', title: 'Shoot at the office', person: mona, project: 'Spring course' }),
 card({ id: 't_idea', title: 'Ideas for Ramadan', column: 'ideas', publishOn: '2026-11-30' }),
];
const answer = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
type Engine = { reads: number, sent: Record<string, unknown>[], down: boolean, hold?: Promise<void> };
function engine(start: BoardCard[] = cards): Engine {
 let board = start.map(found => ({ ...found }));
 const state: Engine = { reads: 0, sent: [], down: false };
 vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
  if (url.startsWith('/api/board/cards') && init?.method === 'PATCH') {
   const body = JSON.parse(String(init.body)); state.sent.push(body);
   board = board.map(found => found.id === body.card ? { ...found, publishOn: body.publishOn || null } : found);
   return answer({ dated: body.card, cards: board, main: null });
  }
  if (url === `/api/board?company=${company}`) {
   state.reads++; await state.hold;
   return state.down ? answer({ error: 'boardUnreachable' }, 503) : answer({ cards: board, main: null });
  }
  return answer({}, 404);
 });
 return state;
}
beforeEach(() => { company = `10000000-0000-0000-0000-${String(++companies).padStart(12, '0')}`; vi.stubGlobal('WebSocket', Socket); vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-12-10T10:00:00Z') }); });
afterEach(async () => { vi.unstubAllGlobals(); vi.useRealTimers(); Object.assign(document.documentElement, { lang: 'en', dir: 'ltr' }); await page.viewport(1440, 900); });
// As the app draws them: inside the shell's frame, with the page's language and direction (app/layout.tsx).
const show = (view: 'list' | 'calendar', { writer = true, language = 'en' as Language } = {}) => {
 Object.assign(document.documentElement, { lang: language, dir: language === 'ar' ? 'rtl' : 'ltr' });
 return render(<LanguageProvider language={language}><LooksProvider looks={{ agents: {}, requests: {}, removed: {} }}><Frame sidebar={null}><PageFrame title="Work"><main className="content">
  <BoardViews company={company} slug="rs-learning" view={view} writer={writer}/></main></PageFrame></Frame></LooksProvider></LanguageProvider>);
};
const rows = () => [...document.querySelectorAll('.table tbody tr')].map(row => row.querySelector('td')!.textContent!.trim());

test('the list shows every Card the board read returned, with its status, Assignee, Project and publishing date, each opening its Card', async () => {
 engine();
 const screen = await show('list');
 await expect.poll(rows).toEqual(['Launch reel', 'December ad copy', 'Shoot at the office', 'Ideas for Ramadan']);
 const reel = screen.getByRole('row', { name: /Launch reel/ });
 await expect.poll(() => reel.element().textContent).toContain('In progress');
 await expect.poll(() => reel.element().textContent).toContain('Ads');
 await expect.poll(() => reel.element().textContent).toContain('Spring course');
 await expect.element(screen.getByLabelText('Publishing date of Launch reel')).toHaveValue('2026-12-03');
 await expect.element(screen.getByLabelText('Publishing date of Shoot at the office')).toHaveValue('');
 await expect.poll(() => screen.getByRole('row', { name: /Shoot at the office/ }).element().textContent).toContain('Mona');
 await expect.poll(() => screen.getByRole('row', { name: /Ideas for Ramadan/ }).element().textContent).toContain('No one');
 await expect.element(screen.getByRole('link', { name: 'Launch reel' })).toHaveAttribute('href', '/c/rs-learning/work/board?card=t_reel');
});

test('the list filters by Assignee, status and Project, together, and All brings every Card back', async () => {
 engine();
 const screen = await show('list');
 await expect.poll(rows).toHaveLength(4);
 await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Assignee' }), 'Ads');
 await expect.poll(rows).toEqual(['Launch reel', 'December ad copy']);
 await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'Spring course');
 await expect.poll(rows).toEqual(['Launch reel']);
 await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Assignee' }), 'All');
 await expect.poll(rows).toEqual(['Launch reel', 'Shoot at the office']);
 await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Planned');
 await expect.poll(rows).toEqual(['Shoot at the office']);
 await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'All projects');
 await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Assignee' }), 'No one');
 await expect.poll(rows).toEqual([]);
 await expect.element(screen.getByText('No cards to display.')).toBeVisible();
 await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'All');
 await expect.poll(rows).toEqual(['Ideas for Ramadan']);
});

test('the list sorts by a column, and a second press turns it round; an undated Card sorts after every dated one', async () => {
 engine();
 const screen = await show('list');
 await expect.poll(rows).toHaveLength(4);
 await screen.getByRole('button', { name: /Publishing date/ }).click();
 await expect.poll(rows).toEqual(['Ideas for Ramadan', 'Launch reel', 'December ad copy', 'Shoot at the office']);
 expect(screen.getByRole('button', { name: /Publishing date/ }).element().closest('th')!.getAttribute('aria-sort')).toBe('ascending');
 await screen.getByRole('button', { name: /Publishing date/ }).click();
 await expect.poll(rows).toEqual(['December ad copy', 'Launch reel', 'Ideas for Ramadan', 'Shoot at the office']);
 await screen.getByRole('button', { name: /Title/ }).click();
 await expect.poll(rows).toEqual(['December ad copy', 'Ideas for Ramadan', 'Launch reel', 'Shoot at the office']);
});

test('the calendar places each Card on its publishing day in the month shown, and lists the undated Cards beside it', async () => {
 engine();
 const screen = await show('calendar');
 await expect.element(screen.getByRole('heading', { name: 'December 2026' })).toBeVisible();
 const day = (title: string) => screen.getByRole('link', { name: title }).element().closest('.day')?.querySelector('.day__n')?.textContent;
 await expect.poll(() => day('Launch reel')).toBe('3');
 expect(day('December ad copy')).toBe('24');
 // November's Card is not in December's grid; the undated one is beside it.
 expect(document.querySelector('.calendar')!.textContent).not.toContain('Ideas for Ramadan');
 const undated = screen.getByRole('region', { name: 'No publishing date' });
 await expect.element(undated.getByRole('link', { name: 'Shoot at the office' })).toBeVisible();
 expect(document.querySelector('.calendar')!.textContent).not.toContain('Shoot at the office');
 await userEvent.fill(screen.getByLabelText('Month'), '2026-11');
 await expect.poll(() => day('Ideas for Ramadan')).toBe('30');
 await expect.element(screen.getByRole('heading', { name: 'November 2026' })).toBeVisible();
});

test('changing a Card\'s publishing date sends it on the board\'s route and moves the Card on the calendar, the frame staying as it was', async () => {
 const state = engine();
 const screen = await show('calendar');
 const frame = document.querySelector('.board-view');
 await expect.element(screen.getByRole('link', { name: 'Launch reel' })).toBeVisible();
 const field = screen.getByLabelText('Publishing date of Launch reel');
 await userEvent.fill(field, '2026-12-17');
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => state.sent).toEqual([{ company, card: 't_reel', publishOn: '2026-12-17' }]);
 await expect.poll(() => screen.getByRole('link', { name: 'Launch reel' }).element().closest('.day')?.querySelector('.day__n')?.textContent).toBe('17');
 // An undated Card given a date leaves the list beside the calendar for its day.
 await userEvent.fill(screen.getByLabelText('Publishing date of Shoot at the office'), '2026-12-05');
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => screen.getByRole('link', { name: 'Shoot at the office' }).element().closest('.day')?.querySelector('.day__n')?.textContent).toBe('5');
 await expect.element(screen.getByRole('region', { name: 'No publishing date' }).getByRole('link')).not.toBeInTheDocument();
 // Clearing it puts the Card back beside the calendar.
 await userEvent.clear(screen.getByLabelText('Publishing date of Shoot at the office'));
 await userEvent.keyboard('{Enter}');
 await expect.element(screen.getByRole('region', { name: 'No publishing date' }).getByRole('link', { name: 'Shoot at the office' })).toBeVisible();
 expect(state.sent.at(-1)).toEqual({ company, card: 't_shoot', publishOn: '' });
 expect(document.querySelector('.board-view')).toBe(frame);
});

test('a Viewer reads both views and is offered no date to change', async () => {
 engine();
 const screen = await show('calendar', { writer: false });
 await expect.element(screen.getByRole('link', { name: 'Launch reel' })).toBeVisible();
 expect(screen.getByLabelText(/^Publishing date of/).elements()).toHaveLength(0);
 await screen.unmount();
 const list = await show('list', { writer: false });
 await expect.poll(rows).toHaveLength(4);
 expect(list.getByLabelText(/^Publishing date of/).elements()).toHaveLength(0);
 await expect.poll(() => list.getByRole('row', { name: /Launch reel/ }).element().textContent).toContain('Dec 3, 2026');
});

test('both views draw their frame before the board answers, and keep the last good read when it stops answering', async () => {
 const state = engine();
 let answerNow = () => {};
 state.hold = new Promise(done => { answerNow = done; });
 const screen = await show('calendar');
 await expect.element(screen.getByRole('heading', { name: 'Marketing board', level: 1 })).toBeVisible();
 await expect.element(screen.getByRole('status')).toHaveTextContent('Reading the board…');
 expect(document.querySelectorAll('.calendar .day__n')).toHaveLength(31);
 answerNow();
 await expect.element(screen.getByRole('link', { name: 'Launch reel' })).toBeVisible();
 state.down = true; state.hold = undefined;
 window.dispatchEvent(new Event('focus'));
 await expect.element(screen.getByRole('status')).toHaveTextContent('Couldn’t refresh the board. Showing what it last read.');
 await expect.element(screen.getByRole('link', { name: 'Launch reel' })).toBeVisible();
 await screen.unmount();
 const list = await show('list');
 await expect.poll(rows).toHaveLength(4);
 await expect.element(list.getByRole('status')).toHaveTextContent('Couldn’t refresh the board. Showing what it last read.');
});

test('in Arabic the views name their filters and the undated list in Arabic, and fit a phone\'s width', async () => {
 engine();
 {
  const screen = await show('calendar', { language: 'ar' });
  await expect.element(screen.getByRole('region', { name: 'من غير موعد نشر' }).getByRole('link', { name: 'Shoot at the office' })).toBeVisible();
  await expect.element(screen.getByLabelText('موعد نشر Launch reel')).toBeVisible();
  await screen.unmount();
  const list = await show('list', { language: 'ar' });
  await expect.element(list.getByRole('combobox', { name: 'المسؤول' })).toBeVisible();
  await expect.element(list.getByRole('combobox', { name: 'الحالة' })).toBeVisible();
  await page.viewport(390, 900);
  await expect.poll(rows).toHaveLength(4);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  await list.unmount();
  await show('calendar', { language: 'ar' });
  await expect.poll(() => document.querySelectorAll('.calendar .authored-title').length).toBe(2);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
 }
});
