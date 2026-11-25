import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { userEvent } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { card, placed, showWork, workProps, workView } from './work-page';

// #168: a move to another column is told with "Undo" for six seconds, and "Undo" puts the Card back in the column it
// left, with the keyboard on it and the reference's landing motion (none for a person who wants less motion).
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board' }));
vi.mock('@/app/toast', () => ({ toast }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ decideAgentRule: vi.fn(), answerAgentRequest: vi.fn() }));
vi.mock('@/app/note-actions', () => ({ editNote: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); });

const link = (id: number) => document.querySelector<HTMLElement>(`#board-cols .kcard[data-card-id="${id}"] a`)!;
const landing = (id: number) => document.querySelector(`#board-cols .kcard[data-card-id="${id}"]`)!.classList.contains('is-landing');
// Each time the board starts a Card's landing, counted from the class it gains, so a test waits for a landing to have
// started rather than guessing when it will (#426: a keyboard move lands one animation frame after its toast).
const landings = (id: number) => {
 let count = 0;
 const watch = new MutationObserver(changes => {
  for (const change of changes) {
   const el = change.target as HTMLElement;
   if (el.matches(`.kcard[data-card-id="${id}"]`) && el.classList.contains('is-landing') && !change.oldValue?.split(' ').includes('is-landing')) count += 1;
  }
 });
 watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
 onTestFinished(() => watch.disconnect());
 return () => count;
};
// Two animation frames: a landing the board asked for in the frame before (as a keyboard move's is) has started by then.
const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const options = () => vi.mocked(toast).mock.calls.at(-1)![1] as { icon?: string, action?: { label: string, run: () => void } } | undefined;
const undone = (props: ReturnType<typeof workProps>) => Object.fromEntries(vi.mocked(props.undoMove).mock.calls.at(-1)![0]);
// The board as the server's answer to the move draws it (#131): the Card in Planned, where it lands.
const inPlanned = (props: ReturnType<typeof workProps>) => ({ ...props, cards: props.cards.map(each => each.id === 1 ? { ...each, stage_id: 2, status: 'planned' } : each) });
// A Card in Ideas, drawn where the database put it.
const ideas = () => workProps({ cards: [card({ id: 1, title: 'Launch post', stage_id: 1, board_order: 1 })], undoMove: vi.fn(async () => ({ state: 'undone' as const, column: 'ideas' })) });

test('a move to another column is told with Undo, and Undo puts the Card back where it was, focused and landing', async () => {
 const props = ideas();
 const screen = await showWork(props);
 const landed = landings(1);
 link(1).focus();
 await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
 await expect.poll(() => placed(props)).toEqual([{ company: 'co-1', slug: 'rs-learning', card: '1', column: 'planned', before: '' }]);
 // The move is told with "Undo", and nothing happens until it is pressed.
 await expect.poll(() => toast).toHaveBeenCalledWith('Moved to “Planned”', { action: { label: 'Undo', run: expect.any(Function) } });
 expect(props.undoMove).not.toHaveBeenCalled();
 // The move's own landing starts once the Card is drawn in Planned, and ends first, so the landing checked after "Undo"
 // is the Undo's own.
 await screen.rerender(workView(inPlanned(props)));
 await expect.poll(landed).toBe(1);
 await expect.poll(() => landing(1), { timeout: 1500 }).toBe(false);
 options()!.action!.run();
 // The server is asked to undo exactly this Card, and its answer names the column the Card is back in.
 await expect.poll(() => vi.mocked(props.undoMove).mock.calls.length).toBe(1);
 expect(undone(props)).toEqual({ company: 'co-1', slug: 'rs-learning', card: '1' });
 await expect.poll(() => toast).toHaveBeenLastCalledWith('Back in “Ideas”');
 // The board draws the Card in that column again: it lands there and takes the keyboard.
 await screen.rerender(workView(props));
 // A second landing started: the Undo's own (its class may already be gone again on a slow machine).
 await expect.poll(landed).toBe(2);
 expect(document.activeElement).toBe(link(1));
 await expect.poll(() => landing(1), { timeout: 1500 }).toBe(false);
});

test('with reduced motion the Card comes back at once, still focused and with no landing motion', async () => {
 vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
 const props = ideas();
 const screen = await showWork(props);
 link(1).focus();
 await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
 await expect.poll(() => toast).toHaveBeenCalledWith('Moved to “Planned”', { action: { label: 'Undo', run: expect.any(Function) } });
 options()!.action!.run();
 await expect.poll(() => toast).toHaveBeenLastCalledWith('Back in “Ideas”');
 await screen.rerender(workView(props));
 await expect.poll(() => document.activeElement === link(1)).toBe(true);
 expect(landing(1)).toBe(false);
});

test('a Card that moved on stays where it is, and the toast says so with no landing', async () => {
 const props = workProps({ cards: [card({ id: 1, title: 'Launch post', stage_id: 1, board_order: 1 })], undoMove: vi.fn(async () => ({ state: 'gone' as const })) });
 const screen = await showWork(props);
 const landed = landings(1);
 link(1).focus();
 await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
 await expect.poll(() => toast).toHaveBeenCalledWith('Moved to “Planned”', { action: { label: 'Undo', run: expect.any(Function) } });
 const run = options()!.action!.run;
 // The move's own landing starts and ends before "Undo" is pressed: it starts once the Card is drawn in Planned, so the
 // test waits for it to start before it waits for it to end.
 await screen.rerender(workView(inPlanned(props)));
 await expect.poll(landed).toBe(1);
 await expect.poll(() => landing(1), { timeout: 1500 }).toBe(false);
 run();
 await expect.poll(() => toast).toHaveBeenLastCalledWith('The card moved on, so it stayed where it is', { icon: 'x' });
 await screen.rerender(workView(inPlanned(props)));
 await frames();
 // No second landing: the Card stayed where it is.
 expect(landed()).toBe(1);
 expect(landing(1)).toBe(false);
});

test('a move the board refuses is told with no Undo', async () => {
 // A Card waiting for a decision leaves "Waiting on you" by the decision, never by a key.
 const props = workProps({ cards: [card({ id: 1, title: 'Waiting post', stage_id: 4, board_order: 1 }), card({ id: 2, title: 'Idea post', stage_id: 1, board_order: 1 })] });
 await showWork(props);
 link(1).focus();
 await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
 await expect.poll(() => toast).toHaveBeenCalledWith('This card is waiting for your decision. Decide in the chat first', { icon: 'hand' });
 expect(options()?.action).toBeUndefined();
 expect(placed(props)).toEqual([]);
 // Nothing drops into "Waiting on you" either: it fills up by itself.
 vi.mocked(toast).mockClear();
 link(2).focus();
 await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
 await expect.poll(() => toast).toHaveBeenCalledWith('“Waiting on you” fills up on its own when an agent needs your OK', { icon: 'clock' });
 expect(options()?.action).toBeUndefined();
 expect(placed(props)).toEqual([]);
});
