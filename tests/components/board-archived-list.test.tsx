import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { page, userEvent } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { card, showWork, workProps, workView } from './work-page';
import type { ReadArchived } from '@/app/c/[slug]/[[...section]]/archived-list';
import type { Card } from '@/app/c/[slug]/[[...section]]/work';

// #705: the board's archive list is read a page at a time, newest archived first, and searched by title in the database,
// as All conversations is: the server's first page shows, "Show more" adds the next page after it, and a search asks
// the database for every archived title, not only those shown.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board' }));
vi.mock('@/app/toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ decideAgentRule: vi.fn(), answerAgentRequest: vi.fn() }));
vi.mock('@/app/note-actions', () => ({ editNote: vi.fn() }));

afterEach(() => { vi.restoreAllMocks(); });

const archived = (id: number, title: string): Card => card({ id, title, status: 'progress', archived_at: `2026-11-${String(30 - id).padStart(2, '0')}T09:00:00Z`, archived_by: 'p-1' });
const rows = () => [...document.querySelectorAll('.arch-list .arch-t')].map(el => el.textContent);
const board = (read: ReadArchived<Card>) => workProps({ readArchived: read, archiveCards: vi.fn(async () => ({ state: 'refused' as const })),
 archived: { first: { items: [archived(1, 'Weekly report'), archived(2, 'June ads')], next: { at: '2026-11-28T09:00:00Z', id: 2 } }, total: 3, named: [] } });

test('the archive list shows the server\'s first page with the whole count, and "Show more" adds the next page after it', async () => {
 const read = vi.fn<ReadArchived<Card>>(async () => ({ items: [archived(3, 'مُهمّة الأسعار')], next: null }));
 await showWork(board(read));
 await page.getByRole('button', { name: 'Archived · 3' }).click();
 await expect.poll(rows).toEqual(['Weekly report', 'June ads']);
 await page.getByRole('button', { name: 'Show more' }).click();
 await expect.poll(rows).toEqual(['Weekly report', 'June ads', 'مُهمّة الأسعار']);
 expect(read).toHaveBeenCalledExactlyOnceWith('co-1', { q: '', agent: null, project: null }, { at: '2026-11-28T09:00:00Z', id: 2 });
 await expect.element(page.getByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
});

test('a search asks the database for every archived title, and an empty answer says nothing matches', async () => {
 const read = vi.fn<ReadArchived<Card>>(async (_company, want) => ({ items: want.q === 'مهمه' ? [archived(3, 'مُهمّة الأسعار')] : [], next: null }));
 await showWork(board(read));
 await page.getByRole('button', { name: 'Archived · 3' }).click();
 await page.getByRole('button', { name: 'Search archived cards' }).click();
 await userEvent.type(page.getByRole('searchbox', { name: 'Search archived cards' }), 'مهمه');
 await expect.poll(rows).toEqual(['مُهمّة الأسعار']);
 expect(read).toHaveBeenLastCalledWith('co-1', { q: 'مهمه', agent: null, project: null }, null);
 await userEvent.clear(page.getByRole('searchbox', { name: 'Search archived cards' }));
 await userEvent.type(page.getByRole('searchbox', { name: 'Search archived cards' }), 'nothing');
 await expect.element(page.getByText('No archived cards match these filters')).toBeVisible();
 // Cleared, the server's first page shows again.
 await userEvent.clear(page.getByRole('searchbox', { name: 'Search archived cards' }));
 await expect.poll(rows).toEqual(['Weekly report', 'June ads']);
});

test('the board read again with the same first page keeps the pages "Show more" added, and a new first page shows instead', async () => {
 const read = vi.fn<ReadArchived<Card>>(async () => ({ items: [archived(3, 'مُهمّة الأسعار')], next: null }));
 const props = board(read);
 const screen = await showWork(props);
 await page.getByRole('button', { name: 'Archived · 3' }).click();
 await page.getByRole('button', { name: 'Show more' }).click();
 await expect.poll(rows).toEqual(['Weekly report', 'June ads', 'مُهمّة الأسعار']);
 // A refresh (a move, an Agent at work) hands the same Cards in new objects.
 await screen.rerender(workView({ ...props, archived: structuredClone(props.archived) }));
 await expect.poll(rows).toEqual(['Weekly report', 'June ads', 'مُهمّة الأسعار']);
 // A Card archived meanwhile changes the first page: it shows, newest first.
 await screen.rerender(workView({ ...props, archived: { first: { items: [archived(0, 'Just archived'), archived(1, 'Weekly report')], next: { at: '2026-11-29T09:00:00Z', id: 1 } }, total: 4, named: [] } }));
 await expect.poll(rows).toEqual(['Just archived', 'Weekly report']);
});

test('a Card restored from the list leaves it at once, before the board is read again', async () => {
 const props = { ...board(vi.fn<ReadArchived<Card>>(async () => null)), archiveCards: vi.fn(async () => ({ state: 'done' as const, done: [2] })) };
 await showWork(props);
 await page.getByRole('button', { name: 'Archived · 3' }).click();
 await page.getByRole('button', { name: 'Restore June ads' }).click();
 await expect.poll(rows).toEqual(['Weekly report']);
});
