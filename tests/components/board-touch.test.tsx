import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cdp } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { sent, showWork, workProps } from './work-page';

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
 vi.mocked(props.workAction).mockClear();
 await showWork(props, { width: 390 });
 return document.querySelector<HTMLElement>('.board')!;
};
const column = (name: string) => document.querySelector(`.col[data-column="${name}"]`)!.getBoundingClientRect();

test('on a phone a swipe that starts on a card scrolls the board and moves no card', async () => {
 const board = await phoneBoard();
 const card = document.querySelector('.kcard[data-card-id="1"]')!.getBoundingClientRect();
 const x = (Math.max(card.left, 0) + Math.min(card.right, 390)) / 2, y = card.top + 12;
 await touch('touchStart', x, y);
 for (let step = 1; step <= 12; step++) { vi.advanceTimersByTime(16); await touch('touchMove', x - step * 14, y); }
 await touch('touchEnd');
 await expect.poll(() => board.scrollLeft, { message: 'the board scrolled under the swipe' }).toBeGreaterThan(0);
 expect(sent(props)).toEqual([]);
 expect(document.querySelector('.board-status')).toBeNull();
});

test('on a phone a card held for a moment is carried to the next list and moved there, while the board holds still under the finger', async () => {
 const board = await phoneBoard();
 board.scrollLeft += column('ideas').left - board.getBoundingClientRect().left + column('ideas').width * 0.6;
 const scrolled = board.scrollLeft;
 let cancels = 0;
 window.addEventListener('pointercancel', () => { cancels++; }, true);
 const card = document.querySelector('.kcard[data-card-id="1"]')!.getBoundingClientRect();
 const from = { x: (Math.max(card.left, 2) + card.right) / 2, y: card.top + 12 };
 const aim = () => { const box = column('planned'); return { x: Math.min(box.left + box.width / 2, 390 - 60), y: box.top + 140 }; };
 await touch('touchStart', from.x, from.y);
 vi.advanceTimersByTime(300);
 for (let step = 1; step <= 15; step++) { const to = aim(); await touch('touchMove', from.x + (to.x - from.x) * step / 15, from.y + (to.y - from.y) * step / 15); }
 await touch('touchEnd');
 await expect.poll(() => sent(props)).toEqual([{ op: 'move-column', company: 'co-1', slug: 'rs-learning', card: '1', column: 'planned' }]);
 expect(cancels, 'no pointercancel ends the drag').toBe(0);
 expect(board.scrollLeft).toBe(scrolled);
});
