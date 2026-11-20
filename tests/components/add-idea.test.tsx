import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { userEvent } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { card, ideasSent, sent, showWork, workProps } from './work-page';

const { toast, replace } = vi.hoisted(() => ({ toast: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace, prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board' }));
vi.mock('@/app/toast', () => ({ toast }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ decideAgentRule: vi.fn(), answerAgentRequest: vi.fn() }));
vi.mock('@/app/note-actions', () => ({ editNote: vi.fn() }));
afterEach(() => { toast.mockReset(); replace.mockReset(); });

// The Company's Agents as the board reads them (#190): the main Agent first. Both are shown to the reader.
const lead = { id: 'h-lead', connection_id: 'c-lead', name: 'Lead', speciality: 'General', is_default: true };
const ads = { id: 'h-ads', connection_id: 'c-ads', name: 'Ads', speciality: 'Meta ads', is_default: false };
const withAgents = (more: Parameters<typeof workProps>[0] = {}) => workProps({ cardAgents: [lead, ads], ...more });

test('+ on Ideas opens the form in the column with the focus in Idea; Cancel, Escape and a second press close it with the focus back on +', async () => {
 const screen = await showWork(withAgents());
 const add = screen.getByRole('button', { name: 'Add an idea' });
 await add.click();
 await expect.element(screen.getByLabelText('Idea')).toHaveFocus();
 await expect.element(add).toHaveAttribute('aria-expanded', 'true');
 expect(document.querySelector('.col[data-column="ideas"] .col__body')!.firstElementChild!.id).toBe('add-idea');
 await screen.getByRole('button', { name: 'Cancel' }).click();
 expect(document.querySelector('#idea-title')).toBeNull();
 await expect.element(add).toHaveFocus();
 await expect.element(add).toHaveAttribute('aria-expanded', 'false');
 await add.click();
 await expect.element(screen.getByLabelText('Idea')).toHaveFocus();
 await userEvent.keyboard('{Escape}');
 expect(document.querySelector('#idea-title')).toBeNull();
 await expect.element(add).toHaveFocus();
 await add.click();
 await expect.element(screen.getByLabelText('Idea')).toHaveFocus();
 await add.click();
 expect(document.querySelector('#idea-title')).toBeNull();
 await expect.element(add).toHaveFocus();
});

test('an empty Idea shows the reference error and sends nothing; the error leaves when the person types', async () => {
 const props = withAgents();
 const screen = await showWork(props);
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 await screen.getByRole('button', { name: 'Add', exact: true }).click();
 await expect.element(screen.getByText('Write the idea first, even a short sentence.')).toBeVisible();
 await expect.element(screen.getByLabelText('Idea')).toHaveAttribute('aria-invalid', 'true');
 expect(ideasSent(props)).toEqual([]);
 await userEvent.fill(screen.getByLabelText('Idea'), 'A');
 await expect.element(screen.getByText('Write the idea first, even a short sentence.')).not.toBeVisible();
 await expect.element(screen.getByLabelText('Idea')).not.toHaveAttribute('aria-invalid');
});

test('Add sends one idea with its title, the Ideas stage and the chosen Agent', async () => {
 const props = withAgents();
 const screen = await showWork(props);
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 await userEvent.fill(screen.getByLabelText('Idea'), 'LinkedIn post about the new cohort');
 await userEvent.selectOptions(screen.getByLabelText('Agent'), 'h-ads');
 await screen.getByRole('button', { name: 'Add', exact: true }).click();
 await expect.poll(() => ideasSent(props)).toEqual([{ key: expect.stringMatching(/^[0-9a-f-]{36}$/), company: 'co-1', slug: 'rs-learning', stage: '1', title: 'LinkedIn post about the new cohort', agent: 'h-ads' }]);
 expect(sent(props)).toEqual([]);
});

test('Enter in the Idea field sends one idea with the main Agent chosen first', async () => {
 const props = withAgents();
 const screen = await showWork(props);
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 await userEvent.fill(screen.getByLabelText('Idea'), 'A short idea');
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => ideasSent(props)).toEqual([{ key: expect.stringMatching(/^[0-9a-f-]{36}$/), company: 'co-1', slug: 'rs-learning', stage: '1', title: 'A short idea', agent: 'h-lead' }]);
});

test('Enter that confirms an input method\'s composition sends nothing; the idea stays to be finished', async () => {
 const props = withAgents();
 const screen = await showWork(props);
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 await userEvent.fill(screen.getByLabelText('Idea'), 'فكرة لسه');
 const field = document.querySelector<HTMLInputElement>('#idea-title')!;
 field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
 await new Promise(resolve => setTimeout(resolve, 100));
 expect(ideasSent(props)).toEqual([]);
 await expect.element(screen.getByLabelText('Idea')).toHaveValue('فكرة لسه');
});

test('the Agent list is the Company Agents the reader sees, the main Agent first and the board filter chosen when it is one of them', async () => {
 const screen = await showWork(withAgents());
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 const select = screen.getByLabelText('Agent');
 expect([...document.querySelectorAll<HTMLOptionElement>('#idea-agent option')].map(option => option.textContent)).toEqual(['Lead', 'Ads']);
 expect((select.element() as HTMLSelectElement).value).toBe('h-lead');
 await screen.getByRole('button', { name: 'Cancel' }).click();
 await screen.getByRole('button', { name: 'Ads' }).click();
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 expect((screen.getByLabelText('Agent').element() as HTMLSelectElement).value).toBe('h-ads');
});

test('a Viewer has no + on the Ideas column', async () => {
 await showWork(withAgents({ canCreate: false }));
 expect(document.querySelector('.col[data-column="ideas"] .add-btn')).toBeNull();
});

test('a new idea Card shows its Agent face and name on the foot and "New idea from {first name}"', async () => {
 const props = workProps({
  cards: [card({ id: 9, title: 'LinkedIn post about the new cohort', agent_id: 'h-ads' })],
  cardAgents: [lead, ads],
  members: [{ person_id: 'p-1', people: { name: 'Omar Hassan' } }],
  activity: [{ id: 1, card_id: 9, action: 'idea_added', details: {}, created_at: '2026-11-18T10:00:00Z', actor_id: 'p-1', evidence: null }],
 });
 await showWork(props);
 const idea = document.querySelector('.kcard[data-card-id="9"]')!;
 expect(idea.querySelector('.kcard__foot')!.textContent).toContain('Ads');
 expect(idea.querySelector('.kcard__t')!.textContent).toBe('New idea from Omar');
});

test('the toast says the idea was added once the board comes back with it', async () => {
 await showWork(withAgents({ ideaAdded: true }));
 await expect.poll(() => toast.mock.calls).toEqual([['Idea added']]);
});

test('an idea that could not be sent says so under it with its words kept, and Add works again', async () => {
 const addIdea = vi.fn(async (): Promise<{ card: number }> => { throw new Error('down'); });
 const screen = await showWork(withAgents({ addIdea }));
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 await userEvent.fill(screen.getByLabelText('Idea'), 'A post about the new cohort');
 await screen.getByRole('button', { name: 'Add', exact: true }).click();
 await expect.element(screen.getByRole('alert')).toHaveTextContent('Could not add the idea. Try again.');
 await expect.element(screen.getByLabelText('Idea')).toHaveValue('A post about the new cohort');
 expect(screen.getByRole('button', { name: 'Add', exact: true }).element()).toBeEnabled();
 expect(addIdea).toHaveBeenCalledTimes(1);
 // The failure leaves when the person writes again, and the form is still the one they were in.
 await userEvent.fill(screen.getByLabelText('Idea'), 'A post about the next cohort');
 await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
 await expect.element(screen.getByLabelText('Idea')).toHaveFocus();
});

test('an idea the server took closes the form back onto the column\'s "+", so no Add is left in an open form', async () => {
 const props = withAgents();
 const screen = await showWork(props);
 const add = screen.getByRole('button', { name: 'Add an idea' });
 await add.click();
 await userEvent.fill(screen.getByLabelText('Idea'), 'A post about the next cohort');
 await screen.getByRole('button', { name: 'Add', exact: true }).click();
 await expect.poll(() => document.querySelector('#idea-title')).toBeNull();
 await expect.element(add).toHaveAttribute('aria-expanded', 'false');
 await expect.element(add).toHaveFocus();
 expect(document.querySelector('[role="alert"]')).toBeNull();
 // The board comes back on the new Card, which says the idea was added (#452: the action answers, it does not redirect).
 expect(replace).toHaveBeenCalledWith('/c/rs-learning/work/board?show=9&idea=1', { scroll: false });
});

test('an idea the server refused says so under it and leaves the form open', async () => {
 const props = withAgents({ addIdea: vi.fn(async () => ({ failed: true as const })) });
 const screen = await showWork(props);
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 await userEvent.fill(screen.getByLabelText('Idea'), 'A post about the new cohort');
 await screen.getByRole('button', { name: 'Add', exact: true }).click();
 await expect.element(screen.getByRole('alert')).toHaveTextContent('Could not add the idea. Try again.');
 await expect.element(screen.getByLabelText('Idea')).toHaveValue('A post about the new cohort');
 expect(replace).not.toHaveBeenCalled();
});

test('a retry after an answer that never came sends the same request key, so the server makes one Card (#452)', async () => {
 const addIdea = vi.fn<(form: FormData) => Promise<{ card: number }>>().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({ card: 9 });
 const props = withAgents({ addIdea });
 const screen = await showWork(props);
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 await userEvent.fill(screen.getByLabelText('Idea'), 'A post about the new cohort');
 await screen.getByRole('button', { name: 'Add', exact: true }).click();
 await expect.element(screen.getByRole('alert')).toBeVisible();
 await screen.getByRole('button', { name: 'Add', exact: true }).click();
 await expect.poll(() => document.querySelector('#idea-title')).toBeNull();
 const [first, second] = ideasSent(props);
 expect(second.key).toBe(first.key);
});

test('an idea edited after an answer that never came is sent again under a new request key (#452)', async () => {
 const addIdea = vi.fn<(form: FormData) => Promise<{ card: number }>>().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({ card: 9 });
 const props = withAgents({ addIdea });
 const screen = await showWork(props);
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 await userEvent.fill(screen.getByLabelText('Idea'), 'A post about the new cohort');
 await screen.getByRole('button', { name: 'Add', exact: true }).click();
 await expect.element(screen.getByRole('alert')).toBeVisible();
 await userEvent.fill(screen.getByLabelText('Idea'), 'A post about the next cohort');
 await screen.getByRole('button', { name: 'Add', exact: true }).click();
 await expect.poll(() => ideasSent(props).length).toBe(2);
 const [first, second] = ideasSent(props);
 expect(second.key).not.toBe(first.key);
 expect(second.title).toBe('A post about the next cohort');
});

test('another Agent after an answer that never came is sent again under a new request key (#452)', async () => {
 const addIdea = vi.fn<(form: FormData) => Promise<{ card: number }>>().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({ card: 9 });
 const props = withAgents({ addIdea });
 const screen = await showWork(props);
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 await userEvent.fill(screen.getByLabelText('Idea'), 'A post about the new cohort');
 await screen.getByRole('button', { name: 'Add', exact: true }).click();
 await expect.element(screen.getByRole('alert')).toBeVisible();
 await userEvent.selectOptions(screen.getByLabelText('Agent'), 'h-ads');
 await screen.getByRole('button', { name: 'Add', exact: true }).click();
 await expect.poll(() => ideasSent(props).length).toBe(2);
 const [first, second] = ideasSent(props);
 expect(second.key).not.toBe(first.key);
 expect(second.agent).toBe('h-ads');
});

test('an answer that comes after its form closed leaves the form now open alone, with its idea and no move to the board (#452)', async () => {
 let answer!: (result: { card: number }) => void;
 const props = withAgents({ addIdea: vi.fn(() => new Promise<{ card: number }>(resolve => { answer = resolve; })) });
 const screen = await showWork(props);
 const add = screen.getByRole('button', { name: 'Add an idea' });
 await add.click();
 await userEvent.fill(screen.getByLabelText('Idea'), 'A post about the new cohort');
 await screen.getByRole('button', { name: 'Add', exact: true }).click();
 await screen.getByRole('button', { name: 'Cancel' }).click();
 await add.click();
 await userEvent.fill(screen.getByLabelText('Idea'), 'idea B');
 answer({ card: 9 });
 await new Promise(resolve => setTimeout(resolve, 100));
 expect(document.querySelector('#idea-title')).not.toBeNull();
 await expect.element(screen.getByLabelText('Idea')).toHaveValue('idea B');
 expect(replace).not.toHaveBeenCalled();
});

test('Add pressed twice while the first is on its way sends one idea', async () => {
 let answer!: (result: { card: number }) => void;
 const props = withAgents({ addIdea: vi.fn(() => new Promise<{ card: number }>(resolve => { answer = resolve; })) });
 const screen = await showWork(props);
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 await userEvent.fill(screen.getByLabelText('Idea'), 'A post about the new cohort');
 await userEvent.keyboard('{Enter}');
 await userEvent.keyboard('{Enter}');
 expect(ideasSent(props)).toHaveLength(1);
 answer({ card: 9 });
 await expect.poll(() => document.querySelector('#idea-title')).toBeNull();
});
