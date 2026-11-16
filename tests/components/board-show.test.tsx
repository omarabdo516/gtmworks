import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import Work, { type WorkProps } from '@/app/c/[slug]/[[...section]]/work';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/shell.css';

const replace = vi.fn<(href: string, options?: { scroll?: boolean }) => void>();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { scroll?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'scroll'))}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/work-actions', () => ({ workAction: vi.fn() }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ decideAgentRule: vi.fn(), answerAgentRequest: vi.fn() }));
vi.mock('@/app/note-actions', () => ({ editNote: vi.fn() }));
afterEach(() => { replace.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// RS Learning's board: the Writer's idea, and the Card Ads's chat put In progress (#144).
const card = (id: number, title: string, stage: number, more: Partial<WorkProps['cards'][number]> = {}): WorkProps['cards'][number] => ({ id, title, stage_id: stage, channel: '', format: '', go_live: null, offering: '',
 segment: '', hook: '', goal: '', caption: '', next_actor: null, mode: null, approval_step_id: null, rejection_reason: null, project_id: null, ...more });
const board = (show?: number): WorkProps => ({
 slug: 'rs-learning', company: 'co-1', section: 'work/board', canCreate: true, initialCreating: false, approvableIds: [], projects: [], labels: [], items: [], activity: [], creatives: [], versions: [],
 cardLabels: [], attachments: [], waiting: [],
 stages: [{ id: 1, name: 'أفكار', position: 1, board_column: 'ideas' }, { id: 3, name: 'كتابة', position: 3, board_column: 'progress' }],
 cards: [card(1, 'Launch post', 1), card(7, 'Plan the June campaign', 3, { agent_id: 'ha-1' })],
 assignees: [{ card_id: 1, person_id: 'ag-1' }],
 agents: [{ person_id: 'ag-1', role: 'writer', granted: true }],
 members: [{ person_id: 'ag-1', agent_role: 'writer', people: { name: 'Writer' } }],
 cardAgents: [{ id: 'ha-1', connection_id: 'c-1', name: 'Ads', speciality: 'Runs the Meta ads.' }],
 show,
});
const view = (props: WorkProps) => <LanguageProvider language="en"><div className="gw"><Work {...props}/></div></LanguageProvider>;
const shownCard = () => document.querySelector<HTMLElement>('#board-cols .kcard[data-card-id="7"]');

test('the pill opens the board on its Card: an Agent filter hiding it goes back to all, and the Card scrolls into view, takes the keyboard and flashes once', async () => {
 const scrolled = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
 const screen = await render(view(board()));
 const filters = screen.getByRole('group', { name: 'Filter by agent' });
 await filters.getByRole('button', { name: /Writer/ }).click();
 await expect.element(screen.getByRole('link', { name: 'Plan the June campaign' })).not.toBeInTheDocument();

 await screen.rerender(view(board(7)));
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
 const screen = await render(view(board(7)));
 await expect.element(screen.getByRole('link', { name: 'Plan the June campaign' })).toHaveFocus();
 expect(scrolled).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
});

test('a chat\'s Card shows its Agent and the Agent\'s job on its foot', async () => {
 await render(view(board()));
 const foot = shownCard()!.querySelector('.kcard__foot')!;
 expect(foot.querySelector('.kcard__agent bdi')!.textContent).toBe('Ads');
 expect(foot.querySelector('.kcard__agent .agent-face')!.getAttribute('aria-label')).toBe('Ads');
 expect(foot.textContent).toBe('Ads· Runs the Meta ads.');
 expect(replace).not.toHaveBeenCalled();
});
