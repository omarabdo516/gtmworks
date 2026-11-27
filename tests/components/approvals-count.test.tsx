import { expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import ApprovalsCount from '@/app/approvals-count';

vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
// The Engine board's live stream (#840) is not followed here; a change is a read of /api/board again (the window's focus).
vi.mock('@/app/board-live', () => ({ followBoard: () => () => {} }));

// The sidebar's approvals pill (app/shell.tsx). Numbers hands it a count still being read beside its figures (#172).
test('a count still being read holds the pill\'s place empty, named Approvals, and then shows the count', async () => {
 let counted!: (count: number) => void;
 const count = new Promise<number>(resolve => { counted = resolve; });
 const screen = await render(<div className="gw"><ApprovalsCount slug="rs-learning" current={false} count={count}/></div>);
 const pill = screen.getByRole('link', { name: 'Approvals' });
 await expect.element(pill).toHaveAttribute('href', '/c/rs-learning/approvals');
 expect(pill.element().textContent).toBe('');
 counted(3);
 const shown = screen.getByRole('link', { name: '3 things waiting on you' });
 await expect.element(shown).toHaveTextContent('3');
 await expect.element(shown).toHaveClass('sb-count');
 await expect.element(pill).not.toBeInTheDocument();
});

test('a count read before the page is drawn shows at once, and none waiting reads so', async () => {
 const screen = await render(<div className="gw"><ApprovalsCount slug="rs-learning" current count={0}/></div>);
 const pill = screen.getByRole('link', { name: 'Nothing waiting on you' });
 await expect.element(pill).toHaveTextContent('0');
 await expect.element(pill).toHaveAttribute('aria-current', 'page');
 await expect.element(pill).toHaveClass('sb-count sb-count--none');
});

// #841: in a Company the pill also counts the Cards of the Engine's board that wait on the reader, from the board read in
// the browser: it waits, empty, for that read, and while the Engine does not answer keeps the Cards of the last good one.
test('in a Company the pill adds the board\'s Cards that wait on the reader once the board is read, and keeps them while the Engine does not answer', async () => {
 const card = (id: string, mine: boolean) => ({ id, title: id, column: 'waiting', symbol: { kind: 'question' }, agent: null, waits: { mine, person: null }, comments: 0 });
 let answer: () => Response = () => new Response(null, { status: 503 });
 let release!: () => void; const first = new Promise<void>(resolve => { release = resolve; });
 const fetched = vi.spyOn(window, 'fetch').mockImplementation(async () => { await first; return answer(); });
 try {
  answer = () => new Response(JSON.stringify({ cards: [card('t_1', true), card('t_2', false), card('t_3', true)], main: null }), { headers: { 'content-type': 'application/json' } });
  const screen = await render(<div className="gw"><ApprovalsCount slug="rs-learning" company="co-841-pill" count={2}/></div>);
  const pill = screen.getByRole('link', { name: 'Approvals' });
  await expect.element(pill).toBeInTheDocument();
  expect(pill.element().textContent).toBe('');
  release();
  await expect.element(screen.getByRole('link', { name: '4 things waiting on you' })).toHaveTextContent('4');
  // The Engine stops answering: a read again (the window comes back to the page) is refused, and the count stays.
  answer = () => new Response(JSON.stringify({ error: 'boardUnreachable' }), { status: 503, headers: { 'content-type': 'application/json' } });
  const calls = fetched.mock.calls.length;
  window.dispatchEvent(new Event('focus'));
  await expect.poll(() => fetched.mock.calls.length).toBeGreaterThan(calls);
  await new Promise(resolve => setTimeout(resolve, 50));
  await expect.element(screen.getByRole('link', { name: '4 things waiting on you' })).toHaveTextContent('4');
 } finally { fetched.mockRestore(); }
});

test('in a Company with no board to read, the pill counts the list\'s rows alone', async () => {
 const fetched = vi.spyOn(window, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ error: 'boardNoEngine' }), { status: 503, headers: { 'content-type': 'application/json' } }));
 try {
  const screen = await render(<div className="gw"><ApprovalsCount slug="rs-learning" company="co-841-none" count={1}/></div>);
  await expect.element(screen.getByRole('link', { name: '1 things waiting on you' })).toHaveTextContent('1');
 } finally { fetched.mockRestore(); }
});
