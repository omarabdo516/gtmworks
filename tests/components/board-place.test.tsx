import { expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { userEvent } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { card, sent, showWork, workProps } from './work-page';

// #174: Shift with Up or Down places a Card one place down its own column, and a place inside one column is not a move
// to announce. The board's own action is a spy, so the form is what the page sends.
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board' }));
vi.mock('@/app/toast', () => ({ toast }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ decideAgentRule: vi.fn(), answerAgentRequest: vi.fn() }));
vi.mock('@/app/note-actions', () => ({ editNote: vi.fn() }));

// Three Cards of the Ideas column, in the order the database gave them a place.
const column = [card({ id: 1, title: 'First', board_order: 1 }), card({ id: 2, title: 'Second', board_order: 2 }), card({ id: 3, title: 'Third', board_order: 3 })];
const link = (id: number) => document.querySelector<HTMLElement>(`#board-cols .kcard[data-card-id="${id}"] a`)!;

test('Shift with Up or Down places the focused Card one place in its column, and nothing happens at either end', async () => {
 const props = workProps({ cards: column });
 await showWork(props);
 // Up: above the Card before it, and the focus stays on it.
 link(2).focus();
 await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}');
 await expect.poll(() => sent(props)).toEqual([{ op: 'place', company: 'co-1', slug: 'rs-learning', card: '2', column: 'ideas', before: '1' }]);
 expect(document.activeElement).toBe(link(2));
 expect(toast, 'a place inside one column is not announced').not.toHaveBeenCalled();
 // Down: above the Card after the next one.
 vi.mocked(props.workAction).mockClear();
 link(2).focus();
 await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
 await expect.poll(() => sent(props)).toEqual([{ op: 'place', company: 'co-1', slug: 'rs-learning', card: '2', column: 'ideas', before: '' }]);
 // At the top and at the bottom nothing is sent.
 vi.mocked(props.workAction).mockClear();
 link(1).focus();
 await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}');
 link(3).focus();
 await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
 await new Promise(resolve => setTimeout(resolve, 50));
 expect(sent(props)).toEqual([]);
});

test('Shift with Left and Right still moves a Card to the next column, and that move is announced', async () => {
 const props = workProps({ cards: column });
 await showWork(props);
 link(2).focus();
 await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
 await expect.poll(() => sent(props)).toEqual([{ op: 'place', company: 'co-1', slug: 'rs-learning', card: '2', column: 'planned', before: '' }]);
 await expect.poll(() => toast).toHaveBeenCalledWith('Moved to “Planned”', { action: { label: 'Undo', run: expect.any(Function) } });
});
