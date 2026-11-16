import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import ConversationView from '@/app/c/[slug]/conversations/[id]/conversation';
import { LanguageProvider } from '@/lib/i18n-client';
import { conversationRecord, type ConversationRecord } from '@/lib/conversation-record';
import '@/app/tokens.css';
import '@/app/shell.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { vi.unstubAllGlobals(); });

// Two Runs of the Contributor's chat with Ads, as the database holds them, and the Card the first one put on the board
// when its reply came (or none, or one the chat was started from, made before it), read through the same record the
// page and its route read.
const at = '2026-06-10T09:41:00Z';
const stored = {
 conversation_usage: [{ run_id: 'r1', outcome: 'completed', input_tokens: 10, output_tokens: 2 }, { run_id: 'r2', outcome: 'completed', input_tokens: 10, output_tokens: 2 }],
 conversation_messages: [
  { id: 1, author: 'person', author_name: 'Youssef', body: 'Plan the June campaign', run_id: 'r1', created_at: at },
  { id: 2, author: 'agent', author_name: 'Ads', body: 'On it: audience first.', run_id: 'r1', created_at: at },
  { id: 3, author: 'person', author_name: 'Youssef', body: 'Add a teaser', run_id: 'r2', created_at: at },
  { id: 4, author: 'agent', author_name: 'Ads', body: 'Added.', run_id: 'r2', created_at: at },
 ],
 people: [{ name: 'Youssef' }],
};
const replied = '2026-06-10T09:42:00Z';
type TiedCard = { id: number, column: string, made?: string };
function database(card: TiedCard | null) {
 const rows: Record<string, unknown[]> = { ...stored, work_cards: card ? [{ id: card.id, created_at: card.made ?? replied, work_stages: { board_column: card.column } }] : [] };
 const table = (name: string) => {
  const found = rows[name] ?? [];
  const query: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => resolve({ data: found, error: null }), maybeSingle: async () => ({ data: found[0] ?? null, error: null }) };
  for (const method of ['select', 'eq', 'is', 'in', 'order']) query[method] = () => query;
  return query;
 };
 return { from: table, rpc: async () => ({ data: null, error: null }) } as unknown as Parameters<typeof conversationRecord>[0];
}
const recordWith = (card: TiedCard | null) => conversationRecord(database(card), 'p-3', 'co-1', { id: 'cv-1', agent_id: null, agent_name: 'Ads', hermes_agents: { connection_id: 'c-1' } });
const view = (record: ConversationRecord, { language = 'en', writer = true }: { language?: 'en' | 'ar', writer?: boolean } = {}) => <LanguageProvider language={language}>
 <div className="gw"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={record.conversation} initial={record} writer={writer} team={false}/></div>
</LanguageProvider>;
const show = (...args: Parameters<typeof view>) => render(view(...args));
const pill = () => document.querySelector<HTMLElement>('.corner-pill');

test('the chat says once, under the Agent\'s first reply, that its Card went on the board, and its corner opens that Card on the board', async () => {
 await page.viewport(1440, 900);
 const screen = await show(await recordWith({ id: 7, column: 'progress' }));
 const turns = [...document.querySelectorAll('.turns > li')].map(row => `${row.getAttribute('data-author') ?? ''}:${row.getAttribute('data-kind') ?? ''}`);
 expect(turns).toEqual(['person:', 'agent:', ':boarded', 'person:', 'agent:']);
 await expect.element(screen.getByText('This card was added to the board under “In progress”')).toBeVisible();
 const link = screen.getByRole('link', { name: 'On the board: In progress' });
 await expect.element(link).toHaveAttribute('href', '/c/rs-learning/work/board?show=7');
 await expect.element(link.getByText('On the board:')).toBeVisible();
 await expect.element(link.getByText('In progress')).toBeVisible();
 expect(pill()!.className).toBe('corner-pill');
 expect(pill()!.querySelector('.dot')!.className).toBe('dot dot--idle');
 // The reference's motion: colours and the press ease over the fast duration, and a press gives a little.
 const motion = getComputedStyle(pill()!);
 expect(motion.transitionProperty).toBe('background-color, box-shadow, color, border-color, transform');
 expect(motion.transitionDuration).toBe('0.15s, 0.15s, 0.15s, 0.15s, 0.15s');
 expect(new Set(motion.transitionTimingFunction.split(/,\s*(?=cubic)/))).toEqual(new Set(['cubic-bezier(0.2, 0, 0, 1)']));
});

test('a chat started from its Card (#145) has the pill but no line, since the Card was on the board before it', async () => {
 const screen = await show(await recordWith({ id: 7, column: 'progress', made: '2026-06-09T08:00:00Z' }));
 await expect.element(screen.getByRole('link', { name: 'On the board: In progress' })).toBeVisible();
 expect(document.querySelectorAll('.turns > li[data-kind="boarded"]')).toHaveLength(0);
 expect(document.querySelectorAll('.turns > li')).toHaveLength(4);
});

test('a chat with no Card on the board has no pill and no line', async () => {
 const screen = await show(await recordWith(null));
 await expect.element(screen.getByText('Added.')).toBeVisible();
 expect(document.querySelectorAll('.turns > li')).toHaveLength(4);
 expect(pill()).toBeNull();
});

test('a Card waiting on a decision reads "Waiting on you" for its writer and "Waiting on the team" for a reader who cannot write', async () => {
 const record = await recordWith({ id: 7, column: 'waiting' });
 const screen = await show(record);
 await expect.element(screen.getByRole('link', { name: 'On the board: Waiting on you' })).toBeVisible();
 expect(pill()!.className).toBe('corner-pill is-waiting');
 expect(pill()!.querySelector('.dot')!.className).toBe('dot dot--waiting');
 await screen.rerender(view(record, { writer: false }));
 await expect.element(screen.getByRole('link', { name: 'On the board: Waiting on the team' })).toBeVisible();
});

test('on a phone the pill shows the column alone, in Arabic too', async () => {
 await page.viewport(390, 844);
 try {
  const screen = await show(await recordWith({ id: 7, column: 'progress' }), { language: 'ar' });
  const link = screen.getByRole('link', { name: 'على اللوحة: شغالين عليه' });
  await expect.element(link.getByText('شغالين عليه')).toBeVisible();
  await expect.element(link.getByText('على اللوحة:')).not.toBeVisible();
  await expect.element(screen.getByText('البطاقة دي اتضافت للوحة في «شغالين عليه»')).toBeVisible();
  expect(pill()!.getBoundingClientRect().height).toBe(36);
 } finally { await page.viewport(1440, 900); }
});

test('coming back to the chat after the Card moved on the board shows its new column, and only that', async () => {
 // An answer older than the chat on screen (it left before the last message was sent) moves the pill and nothing else.
 const moved = { ...await recordWith({ id: 7, column: 'live' }), pending: false };
 moved.messages = moved.messages.slice(0, 2);
 const asks = vi.fn(async () => Response.json(moved));
 vi.stubGlobal('fetch', asks);
 const screen = await show(await recordWith({ id: 7, column: 'progress' }));
 await expect.element(screen.getByRole('link', { name: 'On the board: In progress' })).toBeVisible();
 window.dispatchEvent(new Event('focus'));
 await expect.element(screen.getByRole('link', { name: 'On the board: Live' })).toBeVisible();
 expect(asks).toHaveBeenCalledWith('/api/conversations?company=co-1&conversation=cv-1', { cache: 'no-store' });
 await expect.element(screen.getByText('This card was added to the board under “In progress”')).toBeVisible();
 await expect.element(screen.getByText('Added.')).toBeVisible();
});
