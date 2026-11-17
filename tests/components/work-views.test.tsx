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

// The board's six columns over the stages (ADR 0013): card 5 is in the review stage, which is Waiting on you, and waits
// for the reader's approval; card 1 is in أفكار, the Ideas column's one stage.
test('the board shows the six columns of the approved design, Waiting on you first, each Card in its stage\'s column', async () => {
 const screen = await showWork(workProps({ cards: [card(), card({ id: 5, title: 'Review the reel', stage_id: 4 })], approvableIds: [5] }));
 const columns = () => [...document.querySelectorAll('#board-cols > .col')].map(column => column.getAttribute('data-column'));
 expect(columns()).toEqual(['waiting', 'ideas', 'planned', 'progress', 'live', 'done']);
 await expect.element(screen.getByRole('heading', { level: 2, name: 'Waiting on you', exact: true })).toBeVisible();
 expect(document.querySelectorAll('.col[data-column="waiting"] .kcard[data-card-id="5"]')).toHaveLength(1);
 expect(document.querySelectorAll('.col[data-column="ideas"] .column[data-stage-name="أفكار"] .kcard[data-card-id="1"]')).toHaveLength(1);
});

// Two Agents the Company granted, each assigned its own Cards; the filter keeps one Agent's Cards and All brings back the rest.
test('the Agent filter shows only that Agent\'s cards, and All brings the others back', async () => {
 const members = [{ person_id: 'ag-w', people: { name: 'Writer' } }, { person_id: 'ag-d', people: { name: 'Designer' } }];
 const agents = [{ person_id: 'ag-w', role: 'writer', granted: true }, { person_id: 'ag-d', role: 'designer', granted: true }];
 const assignees = [{ card_id: 1, person_id: 'ag-w' }, { card_id: 2, person_id: 'ag-d' }, { card_id: 3, person_id: 'ag-w' }];
 const screen = await showWork(workProps({ cards: [card(), card({ id: 2, title: 'Design' }), card({ id: 3, title: 'Script', stage_id: 2 })], members, agents, assignees }));
 const tools = screen.getByRole('group', { name: 'Filter by agent' });
 const shown = () => [...document.querySelectorAll('#board-cols .kcard')].map(item => item.getAttribute('data-card-id')).sort();
 expect(shown()).toEqual(['1', '2', '3']);
 await tools.getByRole('button', { name: 'Writer', exact: true }).click();
 await expect.element(tools.getByRole('button', { name: 'Writer', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await expect.poll(shown).toEqual(['1', '3']);
 expect([...document.querySelectorAll('#board-cols .kcard .kcard__agent bdi')].map(name => name.textContent)).toEqual(['Writer', 'Writer']);
 await tools.getByRole('button', { name: 'All', exact: true }).click();
 await expect.poll(shown).toEqual(['1', '2', '3']);
});
