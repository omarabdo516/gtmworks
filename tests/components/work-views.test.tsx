import { expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { userEvent } from 'vitest/browser';
import type { WorkProps } from '@/app/c/[slug]/[[...section]]/work';
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

// The Company's Agents (#190): Lead (main) and two Lead made, given in the sidebar's order. Cards 1 and 3 are Ads's,
// card 2 is SEO's, card 4 has no Agent; Ads and SEO both wrote on card 1. The old role agents still hold grants.
const lead = { id: 'h-lead', connection_id: 'c-lead', name: 'Lead', speciality: 'General', is_default: true };
const ads = { id: 'h-ads', connection_id: 'c-ads', name: 'Ads', speciality: 'Meta ads', is_default: false };
const seo = { id: 'h-seo', connection_id: 'c-seo', name: 'SEO', speciality: 'Search', is_default: false };
const crewBoard = (more: Partial<WorkProps> = {}) => workProps({
 cardAgents: [lead, ads, seo],
 agents: [{ person_id: 'ag-w', role: 'writer', granted: true }, { person_id: 'ag-d', role: 'designer', granted: true }],
 members: [{ person_id: 'ag-w', people: { name: 'Writer' } }, { person_id: 'ag-d', people: { name: 'Designer' } }],
 cards: [card({ agent_id: 'h-ads', crew: ['h-seo', 'h-ads'] }), card({ id: 2, title: 'Design', agent_id: 'h-seo', crew: ['h-seo'] }),
  card({ id: 3, title: 'Script', stage_id: 2, agent_id: 'h-ads' }), card({ id: 4, title: 'Untold', channel: 'Facebook' })],
 ...more,
});
const shown = () => [...document.querySelectorAll('#board-cols .kcard')].map(item => item.getAttribute('data-card-id')).sort();
const foot = (id: number) => document.querySelector(`#board-cols .kcard[data-card-id="${id}"] .kcard__foot`)!;

test('the chips are All and the Company\'s Agents, the main Agent first, and no old role agent', async () => {
 const screen = await showWork(crewBoard({ canCreate: false }));
 const tools = screen.getByRole('group', { name: 'Filter by agent' });
 expect(tools.getByRole('button').elements().map(chip => chip.textContent)).toEqual(['All', 'Lead', 'Ads', 'SEO']);
 expect(tools.getByRole('button').elements().slice(1).map(chip => chip.querySelector('.chip__face[aria-hidden="true"] .agent-face')?.getAttribute('aria-label'))).toEqual(['Lead', 'Ads', 'SEO']);
});

// Rewritten for #190 from "the Agent filter shows only that Agent's cards, and All brings the others back": the filter
// now follows a Card's own Agent, and still keeps one Agent's Cards and brings the rest back under All.
test('pressing an Agent\'s chip keeps only its Cards in every column and the focus on the chip; All shows every Card again', async () => {
 const screen = await showWork(crewBoard());
 const tools = screen.getByRole('group', { name: 'Filter by agent' });
 expect(shown()).toEqual(['1', '2', '3', '4']);
 await tools.getByRole('button', { name: 'Ads', exact: true }).click();
 await expect.element(tools.getByRole('button', { name: 'Ads', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await expect.element(tools.getByRole('button', { name: 'Ads', exact: true })).toHaveFocus();
 await expect.poll(shown).toEqual(['1', '3']);
 expect(document.querySelectorAll('.col[data-column="planned"] .kcard[data-card-id="3"]')).toHaveLength(1);
 await tools.getByRole('button', { name: 'Lead', exact: true }).click();
 await expect.poll(shown).toEqual([]);
 await tools.getByRole('button', { name: 'All', exact: true }).click();
 await expect.element(tools.getByRole('button', { name: 'All', exact: true })).toHaveFocus();
 await expect.poll(shown).toEqual(['1', '2', '3', '4']);
});

test('a Card\'s foot shows its Agent\'s face and name before the channel and the date; a Card with no Agent shows the channel and the date alone', async () => {
 await showWork(crewBoard());
 expect(foot(2).querySelector('.kcard__agent .agent-face')!.getAttribute('aria-label')).toBe('SEO');
 expect(foot(2).textContent).toBe('SEO· InstagramJun 4');
 expect(foot(4).querySelector('.kcard__agent')).toBeNull();
 expect(foot(4).textContent).toBe('FacebookJun 4');
});

test('a Card two Agents worked on carries both faces and "Worked on it", and says it in its name; a one-Agent Card has no crew line', async () => {
 const screen = await showWork(crewBoard());
 const crew = document.querySelector('#board-cols .kcard[data-card-id="1"] .kcard__crew')!;
 expect([...crew.querySelectorAll('.fstack[aria-hidden="true"] .agent-face')].map(face => face.getAttribute('aria-label'))).toEqual(['SEO', 'Ads']);
 expect(crew.querySelector('.kcard__crew-t')!.textContent).toBe('Worked on it: SEO, Ads');
 expect(crew.nextElementSibling).toBe(foot(1));
 await expect.element(screen.getByRole('link', { name: 'أفكار لمحتوى الشهر · Worked on it: SEO, Ads', exact: true })).toBeVisible();
 expect(document.querySelectorAll('#board-cols .kcard__crew')).toHaveLength(1);
 await expect.element(screen.getByRole('link', { name: 'Design', exact: true })).toBeVisible();
});

test('in Arabic the crew\'s names are joined with the Arabic comma, each kept in its own direction', async () => {
 const screen = await showWork(crewBoard(), { language: 'ar' });
 const line = document.querySelector('#board-cols .kcard[data-card-id="1"] .kcard__crew-t')!;
 expect(line.textContent).toBe('اشتغل عليها: SEO، Ads');
 expect([...line.querySelectorAll('bdi')].map(name => name.textContent)).toEqual(['SEO', 'Ads']);
 await expect.element(screen.getByRole('link', { name: 'أفكار لمحتوى الشهر · اشتغل عليها SEO، Ads', exact: true })).toBeVisible();
});
