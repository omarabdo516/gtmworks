import { expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import ApprovalsCount from '@/app/approvals-count';

vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

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
