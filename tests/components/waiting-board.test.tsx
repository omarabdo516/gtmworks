import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import Board, { type BoardCard } from '@/app/c/[slug]/[[...section]]/board';
import { LanguageProvider } from '@/lib/i18n-client';
import { LooksProvider } from '@/lib/agent-looks-client';
import type { WaitingItem } from '@/lib/approval-queue';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/approvals', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ answerAgentAccess: vi.fn(), decideAgentRule: vi.fn(), answerAgentRequest: vi.fn(), answerAgentChange: vi.fn() }));

// "Waiting on you" (/approvals, spec #831, #846) is the Engine's board opened on its first column, which holds the reader's
// own list: the board's Cards that wait on them and their other rows. The board's other waiting Cards are not drawn there,
// so select mode's "Select all shown" takes none of them (an archive of what was selected would archive what was never
// shown). The board's live socket is stood in for by one that never opens.
class Socket extends EventTarget { readyState = 0; close() { this.readyState = 3; } }
let company = '';
let companies = 0;
const card = (more: Partial<BoardCard> & { id: string, title: string }): BoardCard =>
 ({ column: 'planned', symbol: null, agent: null, person: null, comments: 0, project: null, publishOn: null, ...more });
const mine = card({ id: 't_mine', title: 'Which month?', column: 'waiting', symbol: { kind: 'question' }, waits: { mine: true, person: null } });
const theirs = card({ id: 't_theirs', title: 'Mona decides the copy', column: 'waiting', symbol: { kind: 'question' }, waits: { mine: false, person: { id: 'p-2', name: 'Mona' } } });
const planned = card({ id: 't_plan', title: 'December ad copy' });
const item: WaitingItem = { kind: 'test_kind', id: 9, title: 'Another kind', body: '', asked_by: '', card_id: null, conversation_id: null, created_at: '2026-12-10T09:00:00Z' };
beforeEach(() => {
 company = `10000000-0000-0000-0000-${String(++companies).padStart(12, '0')}`;
 vi.stubGlobal('WebSocket', Socket);
 vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify(url === `/api/board?company=${company}` ? { cards: [mine, theirs, planned], main: null } : {}), { status: url.startsWith('/api/board?') ? 200 : 404, headers: { 'Content-Type': 'application/json' } }));
});
afterEach(() => { vi.unstubAllGlobals(); });
const show = (own: boolean) => render(<LanguageProvider language="en"><LooksProvider looks={{ agents: {}, requests: {}, removed: {} }}><main className="content">
 <Board company={company} slug="rs-learning" writer reviewer me="p-1" own={own ? { items: [item], people: { slug: 'rs-learning', company, lead: 'Lead', alone: false, myNames: ['Omar'] } } : undefined}/>
</main></LooksProvider></LanguageProvider>);
const waiting = () => document.querySelector('.col[data-column="waiting"]')!;

test('opened on Waiting on you, the first column holds the reader\'s own Cards and rows, and counts them', async () => {
 const screen = await show(true);
 await expect.element(screen.getByRole('article', { name: /^Which month\?/ })).toBeVisible();
 await expect.poll(() => waiting().querySelector('.col__count')?.textContent).toBe('2');
 expect(waiting().textContent).toContain('Another kind');
 expect(waiting().textContent).not.toContain('Mona decides the copy');
});

test('"Select all shown" on Waiting on you takes only the Cards drawn, none waiting on someone else', async () => {
 const screen = await show(true);
 await expect.element(screen.getByRole('article', { name: /^December ad copy/ })).toBeVisible();
 await screen.getByRole('button', { name: 'Select several cards' }).click();
 await screen.getByRole('button', { name: 'Select all shown' }).click();
 await expect.poll(() => document.querySelector('.bsel__n b')?.textContent).toBe('1');
});

test('the board itself still draws every waiting Card, and "Select all shown" takes each', async () => {
 const screen = await show(false);
 await expect.element(screen.getByRole('article', { name: /^Mona decides the copy/ })).toBeVisible();
 await screen.getByRole('button', { name: 'Select several cards' }).click();
 await screen.getByRole('button', { name: 'Select all shown' }).click();
 await expect.poll(() => document.querySelector('.bsel__n b')?.textContent).toBe('3');
});
