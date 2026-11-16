import { expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { userEvent } from 'vitest/browser';
import { card, showWork, workProps } from './work-page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board' }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ decideAgentRule: vi.fn(), answerAgentRequest: vi.fn() }));
vi.mock('@/app/note-actions', () => ({ editNote: vi.fn() }));

// Card 1 is dated in November 2026; card 2 has no date, and a month filter keeps it.
const cards = [card({ go_live: '2026-11-12T12:00:00+00:00' }), card({ id: 2, title: 'Undated', go_live: null })];

test('the board\'s month filter hides a Card dated in another month and keeps an undated one; clearing it brings the Card back', async () => {
 const screen = await showWork(workProps({ cards }));
 const dated = () => document.querySelectorAll('#board-cols .kcard[data-card-id="1"]').length;
 expect(dated()).toBe(1);
 await userEvent.fill(screen.getByLabelText('Month'), '2000-01');
 await expect.poll(dated).toBe(0);
 expect(document.querySelectorAll('#board-cols .kcard[data-card-id="2"]')).toHaveLength(1);
 await userEvent.fill(screen.getByLabelText('Month'), '');
 await expect.poll(dated).toBe(1);
});

test('the List filters by month too, and a row\'s title opens its Card', async () => {
 const screen = await showWork(workProps({ section: 'work/list', cards }));
 const row = () => document.querySelectorAll('.table tbody tr a[href="/c/rs-learning/work/board/1"]').length;
 await expect.element(screen.getByRole('link', { name: 'أفكار لمحتوى الشهر' })).toHaveAttribute('href', '/c/rs-learning/work/board/1');
 await userEvent.fill(screen.getByLabelText('Month'), '2000-01');
 await expect.poll(row).toBe(0);
 await userEvent.fill(screen.getByLabelText('Month'), '');
 await expect.poll(row).toBe(1);
});

test('the Calendar shows a Card on its publishing day in its month, linking to the Card', async () => {
 const screen = await showWork(workProps({ section: 'work/calendar', cards }));
 await userEvent.fill(screen.getByLabelText('Month'), '2026-11');
 const link = screen.getByRole('link', { name: 'أفكار لمحتوى الشهر' });
 await expect.element(link).toHaveAttribute('href', '/c/rs-learning/work/board/1');
 expect(link.element().closest('.day')!.firstChild!.textContent).toBe('12');
});

test('Work settings name every stage\'s and every label\'s fields for what they change', async () => {
 const screen = await showWork(workProps({ section: 'settings/work' }));
 for (const name of ['Stage name أفكار', 'Stage order أفكار', 'Label name static', 'Label color static']) await expect.element(screen.getByLabelText(name, { exact: true })).toBeVisible();
});
