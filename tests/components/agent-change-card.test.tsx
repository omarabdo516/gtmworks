import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { ChangeCard } from '@/app/change-card';
import { OwnerChangeCard } from '@/app/c/[slug]/[[...section]]/agent-change-card';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ChangeProposalView } from '@/lib/conversations';

const answered = vi.hoisted(() => vi.fn<(form: FormData) => Promise<void>>(async () => {}));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ answerAgentChange: answered }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { answered.mockClear(); });
// An answer still on its way: the action resolves only when the test lets it.
const held = () => { let send = () => {}; answered.mockImplementationOnce(() => new Promise<void>(resolve => { send = resolve; })); return () => send(); };

// #19 (design-reference: chgHTML): Lead proposed a new model for Analyst; Analyst proposed its own sub-agents.
const analyst = { id: 'agent-analyst', connection_id: 'connection-analyst', name: 'Analyst' };
const lead = { id: 'agent-lead', connection_id: 'connection-lead', name: 'Lead' };
const model = { id: 7, change: 'model' as const, setting: null, value: 'google/gemini-2.5-pro', reason: 'The 90-day report reads a lot of numbers and runs late.', agent: analyst, by: lead };
const card = (change: ChangeProposalView, language: 'en' | 'ar' = 'en') => render(<LanguageProvider language={language}><ChangeCard change={change}/></LanguageProvider>);

test('the person in the chat sees the proposal wait for the Owners, change nothing, then the answer in place', async () => {
 const waiting = await card({ ...model, state: 'waiting', owners: ['Omar', 'Sara'] });
 const proposal = waiting.getByRole('group', { name: 'Proposed change: Analyst' });
 await expect.element(proposal.getByText('Waiting for Omar or Sara’s OK')).toBeVisible();
 for (const text of ['Proposed change to the settings of Analyst', 'Lead proposed it for Analyst · nothing changes before the Owner’s OK', 'New model: google/gemini-2.5-pro',
  'After the OK', 'The 90-day report reads a lot of numbers and runs late.', 'Waiting for Omar or Sara’s OK. Until then, the agent’s settings stay as they are.'])
  expect(proposal.element().textContent).toContain(text);
 expect(proposal.element().querySelectorAll('button, a')).toHaveLength(0);
 await waiting.unmount();

 const approved = await card({ ...model, state: 'approved', answeredBy: 'Omar', at: '2026-06-10T10:05:00Z' });
 const approvedCard = approved.getByRole('group', { name: 'Proposed change: Analyst' });
 await expect.element(approvedCard.getByText('Approved', { exact: true })).toBeVisible();
 expect(approvedCard.element().textContent).toContain('Analyst now thinks with google/gemini-2.5-pro.');
 expect(approvedCard.element().classList.contains('is-resolved')).toBe(true);
 await approved.unmount();

 const declined = await card({ ...model, change: 'toolset', setting: 'delegation', value: true, by: analyst, state: 'declined', answeredBy: 'عمر', at: '2026-06-10T10:05:00Z', answer: 'خلّيه زي ما هو الشهر ده.' }, 'ar');
 const declinedCard = declined.getByRole('group', { name: 'اقتراح تغيير: Analyst' });
 await expect.element(declinedCard.getByText('اترفض')).toBeVisible();
 for (const text of ['Analyst اقترحه لنفسه', 'الوكلاء المساعدين', 'شغّال', 'مفيش حاجة اتغيّرت. السبب: «خلّيه زي ما هو الشهر ده.»']) expect(declinedCard.element().textContent).toContain(text);
});

test('a proposal of something that cannot be proposed says so and waits on nobody', async () => {
 const refused = await card({ ...model, change: 'setting', setting: 'terminal.backend', value: 'local', by: analyst, state: 'refused' });
 onTestFinished(() => refused.unmount());
 const proposal = refused.getByRole('group', { name: 'Proposed change: Analyst' });
 await expect.element(proposal.getByText('Can’t be proposed')).toBeVisible();
 expect(proposal.element().textContent).toContain('This isn’t a setting an agent can propose, so nothing changed and it waits on nobody.');
 expect(proposal.element().textContent).toContain('terminal.backend');
});

// Both of the Owner's answers in one render: after a form action has run, this browser window draws no new root.
// So the proposal whose details did not load, which runs no action, comes first.
const item = (id: number) => ({ kind: 'agent_change', id, title: 'Analyst', body: 'model', asked_by: 'Lead', card_id: null, conversation_id: null, created_at: '2026-06-10T09:41:00Z',
 change: { setting: null, value: `google/gemini-${id}`, reason: 'Faster on big numbers.', agent: analyst, by: lead } });
test('a proposal whose details did not load shows none of them and cannot be answered until they do', async () => {
 const screen = await render(<LanguageProvider language="en"><OwnerChangeCard slug="rs-learning" company="co-1" item={{ ...item(9), change: null }}/></LanguageProvider>);
 const proposal = screen.getByRole('group', { name: 'Proposed change: Analyst' });
 await expect.element(proposal.getByRole('note')).toHaveTextContent('Part of this proposal didn’t load, so it can’t be answered yet. Reload the page to try again.');
 for (const text of ['Waiting on you', 'Lead proposed it for Analyst', 'Main model']) expect(proposal.element().textContent).toContain(text);
 for (const text of ['After the OK', 'Why']) expect(proposal.element().textContent).not.toContain(text);
 await expect.element(proposal.getByRole('button', { name: 'Approve' })).toBeDisabled();
 await expect.element(proposal.getByRole('button', { name: 'Decline' })).toBeDisabled();
 expect(answered).not.toHaveBeenCalled();
});

test('the Owner approves one at once, and declines another only with a reason in a team, which goes to the log and the chat', async () => {
 const screen = await render(<LanguageProvider language="en">{[7, 8].map(id => <OwnerChangeCard key={id} slug="rs-learning" company="co-1" item={{ ...item(id), title: `Analyst ${id}`, change: { ...item(id).change, agent: { ...analyst, name: `Analyst ${id}` } } }}/>)}</LanguageProvider>);
 const approved = screen.getByRole('group', { name: 'Proposed change: Analyst 8' });
 await expect.element(approved.getByText('Waiting on you')).toBeVisible();
 expect(approved.element().textContent).toContain('New model: google/gemini-8');
 const approveSent = held();
 await approved.getByRole('button', { name: 'Approve' }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(1);
 await expect.element(approved.getByRole('button', { name: 'Approve' })).toBeDisabled();
 await expect.element(approved.getByRole('button', { name: 'Approve' })).toHaveAttribute('aria-busy', 'true');
 await expect.element(approved.getByRole('button', { name: 'Decline' })).toBeDisabled();
 await expect.element(screen.getByRole('group', { name: 'Proposed change: Analyst 7' }).getByRole('button', { name: 'Approve' })).toBeEnabled();
 approveSent();
 await expect.element(approved.getByRole('button', { name: 'Approve' })).toBeEnabled();
 expect(['proposal', 'intent', 'reason', 'back'].map(name => answered.mock.calls[0][0].get(name))).toEqual(['8', 'approve', null, null]);

 const declined = screen.getByRole('group', { name: 'Proposed change: Analyst 7' });
 await declined.getByRole('button', { name: 'Decline' }).click();
 const why = declined.getByRole('textbox', { name: 'Reason for declining' });
 await expect.element(why).toHaveFocus();
 await expect.element(declined.getByText('The reason goes into the log and the chat it was proposed in.')).toBeVisible();
 await why.fill('   ');
 await declined.getByRole('button', { name: 'Decline' }).click();
 await expect.element(declined.getByText('Write the reason, so the agent knows why.')).toBeVisible();
 await expect.element(why).toHaveAttribute('aria-invalid', 'true');
 expect(answered).toHaveBeenCalledTimes(1);
 await declined.getByRole('button', { name: 'Cancel' }).click();
 await expect.element(declined.getByRole('button', { name: 'Decline' })).toHaveFocus();
 await declined.getByRole('button', { name: 'Decline' }).click();
 await declined.getByRole('textbox', { name: 'Reason for declining' }).fill('Keep it this month.');
 const declineSent = held();
 await declined.getByRole('button', { name: 'Decline' }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(2);
 await expect.element(declined.getByRole('button', { name: 'Cancel' })).toBeDisabled();
 await expect.element(declined.getByRole('textbox', { name: 'Reason for declining' })).toHaveAttribute('readonly');
 declineSent();
 await expect.element(declined.getByRole('button', { name: 'Cancel' })).toBeEnabled();
 expect(Object.fromEntries(['company', 'slug', 'proposal', 'intent', 'reason'].map(name => [name, answered.mock.calls[1][0].get(name)])))
  .toEqual({ company: 'co-1', slug: 'rs-learning', proposal: '7', intent: 'decline', reason: 'Keep it this month.' });
});

test('an Owner working alone may decline with no reason', async () => {
 const screen = await render(<LanguageProvider language="en"><OwnerChangeCard slug="rs-learning" company="co-1" alone item={item(5)}/></LanguageProvider>);
 onTestFinished(() => screen.unmount());
 const proposal = screen.getByRole('group', { name: 'Proposed change: Analyst' });
 await proposal.getByRole('button', { name: 'Decline' }).click();
 await expect.element(proposal.getByRole('textbox', { name: 'Reason for declining (optional)' })).toHaveFocus();
 await proposal.getByRole('button', { name: 'Decline' }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(1);
 expect(['proposal', 'intent', 'reason'].map(name => answered.mock.calls[0][0].get(name))).toEqual(['5', 'decline', '']);
});
