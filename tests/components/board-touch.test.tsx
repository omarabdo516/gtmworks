import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cdp } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { placed, showWork, workProps } from './work-page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board' }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ decideAgentRule: vi.fn(), answerAgentRequest: vi.fn() }));
vi.mock('@/app/note-actions', () => ({ editNote: vi.fn() }));
afterEach(async () => { vi.useRealTimers(); await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: false }); });

// A finger on the phone's screen, as the browser receives it: the page scrolls under it unless the board takes it.
const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) => cdp().send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
// The page's timers are the test's, so time on the board passes only when the test says: a swipe takes its 192ms however
// slow the machine, and a hold is exact.
const props = workProps();
const phoneBoard = async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
 vi.mocked(props.placeMove).mockClear();
 await showWork(props, { width: 390 });
 return document.querySelector<HTMLElement>('.board')!;
};
// The board's position once two frames read the same, so a scroll still being laid out is not taken for where it stands.
const settled = async (board: HTMLElement) => { let last = Number.NaN; while (board.scrollLeft !== last) { last = board.scrollLeft; await new Promise(requestAnimationFrame); } return last; };
const column = (name: string) => document.querySelector(`.col[data-column="${name}"]`)!.getBoundingClientRect();

test('on a phone a swipe that starts on a card scrolls the board and moves no card', async () => {
 const board = await phoneBoard();
 const card = document.querySelector('.kcard[data-card-id="1"]')!.getBoundingClientRect();
 const x = (Math.max(card.left, 0) + Math.min(card.right, 390)) / 2, y = card.top + 12;
 await touch('touchStart', x, y);
 for (let step = 1; step <= 12; step++) { vi.advanceTimersByTime(16); await touch('touchMove', x - step * 14, y); }
 await touch('touchEnd');
 await expect.poll(() => board.scrollLeft, { message: 'the board scrolled under the swipe' }).toBeGreaterThan(0);
 expect(placed(props)).toEqual([]);
 expect(document.querySelector('.board-status')).toBeNull();
});

test('on a phone a card held for a moment is carried to the next list and moved there, while the board holds still under the finger', async () => {
 const board = await phoneBoard();
 // dnd-kit scrolls the board by itself, on real time, while the finger is within 20% of its edge (78px at 390). The finger
 // starts and ends outside those bands, so only the browser could move the board, which is what the test is about.
 const edge = board.getBoundingClientRect(), band = edge.width * 0.2 + 12;
 board.scrollLeft += column('planned').left - (edge.right - band - 48);
 const scrolled = await settled(board);
 let cancels = 0;
 window.addEventListener('pointercancel', () => { cancels++; }, true);
 const card = document.querySelector('.kcard[data-card-id="1"]')!.getBoundingClientRect();
 const from = { x: Math.max(card.left, edge.left + band) + 10, y: card.top + 12 };
 const aim = () => { const box = column('planned'); return { x: Math.min(box.left + box.width / 2, edge.right - band - 4), y: box.top + 140 }; };
 expect([from.x, aim().x].every(x => x >= edge.left + band && x <= edge.right - band), 'the finger stays out of the bands where the board scrolls by itself').toBe(true);
 await touch('touchStart', from.x, from.y);
 vi.advanceTimersByTime(300);
 for (let step = 1; step <= 15; step++) { const to = aim(); await touch('touchMove', from.x + (to.x - from.x) * step / 15, from.y + (to.y - from.y) * step / 15); }
 expect(board.scrollLeft, 'the board holds still under the finger').toBe(scrolled);
 await touch('touchEnd');
 await expect.poll(() => placed(props)).toEqual([{ company: 'co-1', slug: 'rs-learning', card: '1', column: 'planned', before: '' }]);
 expect(cancels, 'no pointercancel ends the drag').toBe(0);
});

test('on a phone a Card held at the board\'s sideways edge scrolls the board by itself', async () => {
 const board = await phoneBoard();
 const edge = board.getBoundingClientRect(), band = edge.width * 0.2 + 12;
 board.scrollLeft += column('planned').left - (edge.right - band - 48);
 const scrolled = await settled(board);
 const card = document.querySelector('.kcard[data-card-id="1"]')!.getBoundingClientRect();
 const from = { x: Math.max(card.left, edge.left + band) + 10, y: card.top + 12 };
 // Held just inside the right band, the board follows the Card: carrying a Card to a column out of view still works.
 const to = { x: edge.right - 20, y: from.y };
 await touch('touchStart', from.x, from.y);
 vi.advanceTimersByTime(300);
 for (let step = 1; step <= 10; step++) {
  await touch('touchMove', from.x + (to.x - from.x) * step / 10, to.y);
  await new Promise(requestAnimationFrame);
 }
 // dnd-kit's auto-scroll runs on a real interval, so the frames above are what let it move the board.
 expect(board.scrollLeft, 'the board scrolls by itself at its edge').toBeGreaterThan(scrolled);
 await touch('touchEnd');
});

test('on a phone a board with a little room to spill downward does not scroll under a Card held in that spill', async () => {
 const board = await phoneBoard();
 const edge = board.getBoundingClientRect(), band = edge.width * 0.2 + 12;
 board.scrollLeft += column('planned').left - (edge.right - band - 48);
 await settled(board);
 // A runner can lay the board a fraction shorter than the columns it holds, which gives it room to scroll down too.
 // It is still the box that scrolls sideways: a held Card must not scroll it up or down, and the sideways edge still
 // scrolls it (the test above). Before #249 a finger in this spill's top band let the drag scroll the board.
 document.querySelector<HTMLElement>('.col[data-column="ideas"]')!.style.minHeight = `${board.clientHeight + 80}px`;
 board.scrollTop = 40;
 await new Promise(requestAnimationFrame);
 const box = board.getBoundingClientRect();
 const card = document.querySelector('.kcard[data-card-id="1"]')!.getBoundingClientRect();
 const from = { x: Math.max(card.left, box.left + band) + 10, y: box.top + 24 };
 const idle = { left: board.scrollLeft, top: board.scrollTop };
 await touch('touchStart', from.x, from.y);
 vi.advanceTimersByTime(300);
 for (let step = 1; step <= 10; step++) {
  await touch('touchMove', from.x, from.y - step * 2);
  await new Promise(requestAnimationFrame);
 }
 expect(board.scrollTop, 'the board holds still up and down under the finger').toBe(idle.top);
 expect(board.scrollLeft, 'the board holds still sideways under the finger').toBe(idle.left);
 await touch('touchEnd');
});
