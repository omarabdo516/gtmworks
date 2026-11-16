import { afterEach, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { render } from 'vitest-browser-react';
import { ChatCardFoot, useShowCard, type CardAgent } from '@/app/c/[slug]/[[...section]]/board-show';
import '@/app/shell.css';
import '@/app/board.css';

const replace = vi.fn<(href: string, options?: { scroll?: boolean }) => void>();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }));

afterEach(() => { replace.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// RS Learning's board as the board draws it: the Writer's idea, and the Card Ads's chat put In progress (#144), with
// an Agent filter that hides every Card of another Agent.
const ads: CardAgent = { id: 'ha-1', connection_id: 'c-1', name: 'Ads', speciality: 'Runs the Meta ads.' };
const cards = [{ id: 1, title: 'Launch post', agent: 'ag-1' }, { id: 7, title: 'Plan the June campaign', agent: null }];
function Board({ show }: { show?: number }) {
 const [filter, setFilter] = useState('all');
 const asked = cards.find(card => card.id === show);
 useShowCard(show, { hides: !!asked && filter !== 'all' && asked.agent !== filter, showAll: () => setFilter('all'), board: '/c/rs-learning/work/board' });
 return <div className="gw"><div className="board-view">
  <div role="group" aria-label="Filter by agent">{[['all', 'All'], ['ag-1', 'Writer']].map(([id, name]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{name}</button>)}</div>
  <div id="board-cols">{cards.filter(card => filter === 'all' || card.agent === filter).map(card => <div key={card.id} className="kcard card" data-card-id={card.id}>
   <a className="kcard__title" href={`/c/rs-learning/work/board?card=${card.id}`}>{card.title}</a>{card.id === 7 && <ChatCardFoot agent={ads} job={ads.speciality}/>}
  </div>)}</div>
 </div></div>;
}
const shownCard = () => document.querySelector<HTMLElement>('#board-cols .kcard[data-card-id="7"]');

test('the pill opens the board on its Card: an Agent filter hiding it goes back to all, and the Card scrolls into view, takes the keyboard and flashes once', async () => {
 const scrolled = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
 const screen = await render(<Board/>);
 const filters = screen.getByRole('group', { name: 'Filter by agent' });
 await filters.getByRole('button', { name: 'Writer' }).click();
 await expect.element(screen.getByRole('link', { name: 'Plan the June campaign' })).not.toBeInTheDocument();

 await screen.rerender(<Board show={7}/>);
 await expect.element(filters.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await expect.element(screen.getByRole('link', { name: 'Plan the June campaign' })).toHaveFocus();
 expect(scrolled.mock.contexts).toEqual([shownCard()]);
 expect(scrolled).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
 expect(shownCard()!.classList.contains('is-flash')).toBe(true);
 const motion = getComputedStyle(shownCard()!);
 expect([motion.animationName, motion.animationDuration, motion.animationTimingFunction, motion.animationIterationCount]).toEqual(['kcard-flash', '1.4s', 'cubic-bezier(0.2, 0, 0, 1)', '1']);
 expect(replace.mock.calls).toEqual([['/c/rs-learning/work/board', { scroll: false }]]);
 await expect.poll(() => shownCard()!.classList.contains('is-flash'), { timeout: 4000 }).toBe(false);
});

test('with reduced motion the board jumps to the Card instead of gliding', async () => {
 vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
 const scrolled = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
 const screen = await render(<Board show={7}/>);
 await expect.element(screen.getByRole('link', { name: 'Plan the June campaign' })).toHaveFocus();
 expect(scrolled).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
});

test('a chat\'s Card shows its Agent whole and the Agent\'s job on its foot, and a board opened without a Card shows none', async () => {
 await render(<Board/>);
 const foot = shownCard()!.querySelector('.kcard__foot')!;
 expect(foot.querySelector('.kcard__agent bdi')!.textContent).toBe('Ads');
 expect(foot.querySelector('.kcard__agent .agent-face')!.getAttribute('aria-label')).toBe('Ads');
 expect(foot.textContent).toBe('Ads· Runs the Meta ads.');
 expect(replace).not.toHaveBeenCalled();
});
