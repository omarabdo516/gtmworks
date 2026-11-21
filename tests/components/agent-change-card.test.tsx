import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { ChangeCard } from '@/app/change-card';
import { ChangeBoardCard, OwnerChangeCard } from '@/app/c/[slug]/[[...section]]/agent-change-card';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ChangeProposalView } from '@/lib/conversations';

const answered = vi.hoisted(() => vi.fn<(form: FormData) => Promise<void>>(async () => {}));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ answerAgentChange: answered }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
// The card reads the Agent's settings from /api/agent-change (#484); a test that does not answer it reads nothing.
const reads = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ error: 'notFound' }), { status: 404 })));
vi.stubGlobal('fetch', (url: string) => reads(url));
afterEach(() => { answered.mockClear(); reads.mockClear(); });
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
 for (const text of ['Proposed change to the settings of Analyst', 'Lead proposed it for Analyst · nothing changes before the Owner’s OK', 'New model: gemini-2.5-pro', 'google',
  'After the OK', 'The 90-day report reads a lot of numbers and runs late.', 'Waiting for Omar or Sara’s OK. Until then, the agent’s settings stay as they are.'])
  expect(proposal.element().textContent).toContain(text);
 expect(proposal.element().querySelectorAll('button, a')).toHaveLength(0);
 await waiting.unmount();

 const approved = await card({ ...model, state: 'approved', answeredBy: 'Omar', at: '2026-06-10T10:05:00Z' });
 const approvedCard = approved.getByRole('group', { name: 'Proposed change: Analyst' });
 await expect.element(approvedCard.getByText('Approved', { exact: true })).toBeVisible();
 expect(approvedCard.element().textContent).toContain('Analyst now thinks with gemini-2.5-pro.');
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
 expect(approved.element().textContent).toContain('New model: gemini-8');
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

// #484 (design-reference: chgHTML's "Now" row, chg-edit, chg-model, the c-chg-* board cards): the card reads the Agent's
// value now from its Engine profile, and the Owner edits the proposed value in the field for its kind before approving.
const context = (now: unknown, edit: unknown) => reads.mockImplementation(async () => new Response(JSON.stringify({ state: 'found', now, edit }), { status: 200 }));
const models = { kind: 'model', options: [{ provider: 'openai', providerName: 'OpenAI', model: 'gpt-5.5' }, { provider: 'google', providerName: 'Google', model: 'gemini-7' }, { provider: 'anthropic', providerName: 'Anthropic', model: 'claude-opus-5-5' }] };
const owned = (id: number, change: Record<string, unknown> = {}) => ({ ...item(id), ...('body' in change ? { body: String(change.body) } : {}), change: { ...item(id).change, ...change } });
const sentEdit = (call: number) => { const form = answered.mock.calls[call][0]; return { intent: form.get('intent'), proposal: form.get('proposal'), edited: JSON.parse(String(form.get('edited'))) }; };

test('the card shows the value the Agent has now, read from its profile, and the model by the name and provider its Engine lists', async () => {
 context('openai/gpt-5.5', models);
 const screen = await render(<LanguageProvider language="en"><OwnerChangeCard slug="rs-learning" company="co-1" item={item(7)}/></LanguageProvider>);
 onTestFinished(() => screen.unmount());
 const proposal = screen.getByRole('group', { name: 'Proposed change: Analyst' });
 await expect.element(proposal.getByText('Now', { exact: true })).toBeVisible();
 expect(reads).toHaveBeenCalledWith('/api/agent-change?company=co-1&proposal=7');
 const rows = [...proposal.element().querySelectorAll('.kv__row')].map(row => row.textContent);
 expect(rows).toEqual(['ChangeNew model: gemini-7Google', 'Nowgpt-5.5', 'After the OKgemini-7', 'WhyFaster on big numbers.']);
 // Its mark is the provider's logo, not the Agent's face.
 expect(proposal.element().querySelector('.card__head .tool-tile')).not.toBeNull();
});

test('the person in the chat reads the value now too, with nothing to edit; an Engine that cannot be read leaves the row out', async () => {
 context(false, null);
 const waiting = await card({ ...model, change: 'toolset', setting: 'delegation', value: true, by: analyst, state: 'waiting', owners: ['Omar'] });
 const proposal = waiting.getByRole('group', { name: 'Proposed change: Analyst' });
 expect(reads).not.toHaveBeenCalled();
 await waiting.unmount();
 const read = await render(<LanguageProvider language="en"><ChangeCard company="co-1" change={{ ...model, change: 'toolset', setting: 'delegation', value: true, by: analyst, state: 'waiting', owners: ['Omar'] }}/></LanguageProvider>);
 const chat = read.getByRole('group', { name: 'Proposed change: Analyst' });
 await expect.element(chat.getByText('Now', { exact: true })).toBeVisible();
 expect([...chat.element().querySelectorAll('.kv__row')].map(row => row.textContent)).toContain('NowOff');
 expect(chat.element().querySelectorAll('button')).toHaveLength(0);
 void proposal; await read.unmount();
 reads.mockImplementation(async () => new Response(JSON.stringify({ state: 'found', now: null, edit: null }), { status: 200 }));
 const away = await render(<LanguageProvider language="en"><ChangeCard company="co-1" change={{ ...model, state: 'waiting', owners: ['Omar'] }}/></LanguageProvider>);
 onTestFinished(() => away.unmount());
 await expect.poll(() => reads.mock.calls.length).toBe(2);
 expect(away.getByRole('group', { name: 'Proposed change: Analyst' }).element().textContent).not.toContain('Now');
});

test('the Owner edits the model among the ones the Engine lists, by click or arrow keys, and approves with changes; Cancel keeps the proposal', async () => {
 context('openai/gpt-5.5', models);
 const screen = await render(<LanguageProvider language="en"><OwnerChangeCard slug="rs-learning" company="co-1" item={item(7)}/></LanguageProvider>);
 onTestFinished(() => screen.unmount());
 const proposal = screen.getByRole('group', { name: 'Proposed change: Analyst' });
 const edit = proposal.getByRole('button', { name: 'Edit, then approve' });
 await expect.element(edit).not.toHaveAttribute('aria-disabled');
 await edit.click();
 const editing = screen.getByRole('group', { name: 'Edit the proposal for Analyst' });
 const group = editing.getByRole('radiogroup', { name: 'Model' });
 await expect.element(group.getByRole('radio', { name: 'gemini-7' })).toHaveAttribute('aria-checked', 'true');
 await expect.element(group.getByRole('radio', { name: 'gemini-7' })).toHaveFocus();
 expect(editing.element().textContent).not.toContain('After the OK');
 await editing.getByRole('button', { name: 'Cancel' }).click();
 await expect.element(proposal.getByRole('button', { name: 'Edit, then approve' })).toHaveFocus();
 expect(answered).not.toHaveBeenCalled();
 await proposal.getByRole('button', { name: 'Edit, then approve' }).click();
 await group.getByRole('radio', { name: 'gemini-7' }).element().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
 await expect.element(group.getByRole('radio', { name: 'claude-opus-5-5' })).toHaveAttribute('aria-checked', 'true');
 await group.getByRole('radio', { name: 'gpt-5.5' }).click();
 await editing.getByRole('button', { name: 'Approve with changes' }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(1);
 expect(sentEdit(0)).toEqual({ intent: 'approve', proposal: '7', edited: 'openai/gpt-5.5' });
});

test('the instructions, the sub-agents switch and each listed setting are edited in their own field, and a value that cannot be approved is said', async () => {
 const soul = owned(1, { body: 'instructions', value: 'You write long posts.' });
 const sub = owned(2, { body: 'toolset', setting: 'delegation', value: true });
 const size = owned(3, { body: 'setting', setting: 'memory.memory_char_limit', value: 4000 });
 const zone = owned(4, { body: 'setting', setting: 'timezone', value: 'Africa/Cairo' });
 const fields: Record<string, unknown> = {
  '1': { now: 'You write short posts.', edit: { kind: 'instructions', limit: 20000 } },
  '2': { now: false, edit: { kind: 'switch' } },
  '3': { now: 2200, edit: { kind: 'setting', type: 'number', choices: null, limits: { min: 1, integer: true }, default: 2200 } },
  '4': { now: 'UTC', edit: { kind: 'setting', type: 'select', choices: ['UTC', 'Africa/Cairo', 'Europe/London'], limits: null, default: '' } },
 };
 reads.mockImplementation(async url => new Response(JSON.stringify({ state: 'found', ...(fields[new URL(url, 'http://x').searchParams.get('proposal')!] as object) }), { status: 200 }));
 const screen = await render(<LanguageProvider language="en">{[size, zone, sub, soul].map(entry => <OwnerChangeCard key={entry.id} slug="rs-learning" company="co-1"
  item={{ ...entry, title: `Agent ${entry.id}`, change: { ...entry.change, agent: { ...analyst, name: `Agent ${entry.id}` } } }}/>)}</LanguageProvider>);
 onTestFinished(() => screen.unmount());
 const open = async (id: number) => { const edit = screen.getByRole('group', { name: `Proposed change: Agent ${id}` }).getByRole('button', { name: 'Edit, then approve' });
  await expect.element(edit).not.toHaveAttribute('aria-disabled'); await edit.click(); return screen.getByRole('group', { name: `Edit the proposal for Agent ${id}` }); };

 const limit = await open(3);
 const number = limit.getByRole('spinbutton', { name: 'Memory size' });
 await expect.element(number).toHaveValue(4000);
 await expect.element(limit.getByText('A whole number from 1.')).toBeVisible();
 await number.fill('0');
 await limit.getByRole('button', { name: 'Approve with changes' }).click();
 await expect.element(limit.getByText('This setting doesn’t take that number.')).toBeVisible();
 await expect.element(number).toHaveAttribute('aria-invalid', 'true');
 expect(answered).not.toHaveBeenCalled();
 await number.fill('3000');
 await limit.getByRole('button', { name: 'Approve with changes' }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(1);
 expect(sentEdit(0)).toEqual({ intent: 'approve', proposal: '3', edited: 3000 });

 const timezone = await open(4);
 await timezone.getByRole('combobox', { name: 'Time zone' }).selectOptions('Europe/London');
 await timezone.getByRole('button', { name: 'Approve with changes' }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(2);
 expect(sentEdit(1)).toEqual({ intent: 'approve', proposal: '4', edited: 'Europe/London' });

 const subagents = await open(2);
 const toggle = subagents.getByRole('switch', { name: 'Sub-agents' });
 await expect.element(toggle).toHaveAttribute('aria-checked', 'true');
 await toggle.click();
 await expect.element(toggle).toHaveAttribute('aria-checked', 'false');
 await subagents.getByRole('button', { name: 'Approve with changes' }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(3);
 expect(sentEdit(2)).toEqual({ intent: 'approve', proposal: '2', edited: false });

 const instructions = await open(1);
 const text = instructions.getByRole('textbox', { name: 'Core instructions' });
 await expect.element(text).toHaveValue('You write long posts.');
 await text.fill('  ');
 await instructions.getByRole('button', { name: 'Approve with changes' }).click();
 await expect.element(instructions.getByText('Write a value, so there is something to approve.')).toBeVisible();
 await text.fill('You write posts of three lines.');
 await instructions.getByRole('button', { name: 'Approve with changes' }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(4);
 expect(sentEdit(3)).toEqual({ intent: 'approve', proposal: '1', edited: 'You write posts of three lines.' });
});

test('with no field to edit in, the card offers Approve and Decline alone', async () => {
 context('openai/gpt-5.5', null);
 const screen = await render(<LanguageProvider language="en"><OwnerChangeCard slug="rs-learning" company="co-1" item={item(7)}/></LanguageProvider>);
 onTestFinished(() => screen.unmount());
 const proposal = screen.getByRole('group', { name: 'Proposed change: Analyst' });
 await expect.element(proposal.getByText('Now', { exact: true })).toBeVisible();
 expect([...proposal.element().querySelectorAll('button')].map(button => button.textContent)).toEqual(['Decline', 'Approve']);
});

test('an approval the Owner edited says so, with the value the Agent proposed beside the one approved', async () => {
 const approved = await card({ ...model, approved: 'anthropic/claude-opus-5-5', state: 'approved', answeredBy: 'Omar', at: '2026-06-10T10:05:00Z' });
 onTestFinished(() => approved.unmount());
 const proposal = approved.getByRole('group', { name: 'Proposed change: Analyst' });
 expect([...proposal.element().querySelectorAll('.kv__row')].map(row => row.textContent)).toEqual(['ChangeNew model: claude-opus-5-5anthropic', 'After the OKclaude-opus-5-5', 'Proposedgemini-2.5-pro', 'WhyThe 90-day report reads a lot of numbers and runs late.']);
 expect(proposal.element().textContent).toContain('Omar approved with changes');
 expect(proposal.element().textContent).toContain('Analyst now thinks with claude-opus-5-5.');
});

test('"Waiting on you" draws the proposal as a board card that opens it, in English and Arabic', async () => {
 context('openai/gpt-5.5', models);
 const screen = await render(<LanguageProvider language="en"><ChangeBoardCard slug="rs-learning" company="co-1" item={item(7)}/>
  <ChangeBoardCard slug="rs-learning" company="co-1" item={owned(8, { body: 'toolset', setting: 'delegation', value: true, by: analyst })}/></LanguageProvider>);
 const board = screen.getByRole('button', { name: 'Analyst on gemini-7?' });
 await expect.element(board).toHaveAttribute('aria-haspopup', 'dialog');
 const cardOf = board.element().closest('.kcard')!;
 expect(cardOf.textContent).toContain('Waiting on you');
 expect(cardOf.textContent).toContain('Lead proposed it for Analyst · waiting for your OK');
 expect(cardOf.textContent).toContain('Lead· Settings');
 expect(screen.getByRole('button', { name: 'Sub-agents on for Analyst?' }).element().closest('.kcard')!.textContent).toContain('A change to its settings · waiting for your OK');
 expect(reads).not.toHaveBeenCalled();
 await board.click();
 const dialog = screen.getByRole('dialog', { name: 'Proposed change to the settings of Analyst' });
 await expect.element(dialog.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
 await expect.element(dialog.getByText('Now', { exact: true })).toBeVisible();
 // Escape closes it and the keyboard is back on the card that opened it.
 await userEvent.keyboard('{Escape}');
 await expect.element(board).toHaveFocus();
 await board.click();
 await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(1);
 expect(['proposal', 'intent', 'edited'].map(name => answered.mock.calls[0][0].get(name))).toEqual(['7', 'approve', null]);
 await screen.unmount();

 const arabic = await render(<LanguageProvider language="ar"><ChangeBoardCard slug="rs-learning" company="co-1" item={item(7)}/></LanguageProvider>);
 onTestFinished(() => arabic.unmount());
 const ar = arabic.getByRole('button', { name: 'Analyst على gemini-7؟' });
 expect(ar.element().closest('.kcard')!.textContent).toContain('Lead اقترحه لـ Analyst · مستني موافقتك');
});

test('a listed setting that is a switch, text, or the sub-agents\' model from the Engine\'s list is edited in that field', async () => {
 const memory = owned(1, { body: 'setting', setting: 'memory.memory_enabled', value: false });
 const personality = owned(2, { body: 'setting', setting: 'display.personality', value: 'concise' });
 const submodel = owned(3, { body: 'setting', setting: 'delegation.model', value: 'gpt-5.5' });
 const fields: Record<string, unknown> = {
  '1': { now: true, edit: { kind: 'setting', type: 'boolean', choices: null, limits: null, default: true } },
  '2': { now: 'kawaii', edit: { kind: 'setting', type: 'string', choices: null, limits: null, default: '' } },
  '3': { now: '', edit: { kind: 'setting', type: 'select', choices: ['gpt-5.5', 'gemini-7', 'claude-opus-5-5'], limits: null, default: '' } },
 };
 reads.mockImplementation(async url => new Response(JSON.stringify({ state: 'found', ...(fields[new URL(url, 'http://x').searchParams.get('proposal')!] as object) }), { status: 200 }));
 const screen = await render(<LanguageProvider language="en">{[submodel, personality, memory].map(entry => <OwnerChangeCard key={entry.id} slug="rs-learning" company="co-1"
  item={{ ...entry, title: `Agent ${entry.id}`, change: { ...entry.change, agent: { ...analyst, name: `Agent ${entry.id}` } } }}/>)}</LanguageProvider>);
 onTestFinished(() => screen.unmount());
 const open = async (id: number) => { const edit = screen.getByRole('group', { name: `Proposed change: Agent ${id}` }).getByRole('button', { name: 'Edit, then approve' });
  await expect.element(edit).not.toHaveAttribute('aria-disabled'); await edit.click(); return screen.getByRole('group', { name: `Edit the proposal for Agent ${id}` }); };

 const sub = await open(3);
 await sub.getByRole('combobox', { name: 'Sub-agent model' }).selectOptions('gemini-7');
 await sub.getByRole('button', { name: 'Approve with changes' }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(1);
 expect(sentEdit(0)).toEqual({ intent: 'approve', proposal: '3', edited: 'gemini-7' });

 const text = await open(2);
 const box = text.getByRole('textbox', { name: 'Personality' });
 await expect.element(box).toHaveValue('concise');
 await box.fill('teacher');
 await text.getByRole('button', { name: 'Approve with changes' }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(2);
 expect(sentEdit(1)).toEqual({ intent: 'approve', proposal: '2', edited: 'teacher' });

 const on = await open(1);
 const toggle = on.getByRole('switch', { name: 'Memory' });
 await expect.element(toggle).toHaveAttribute('aria-checked', 'false');
 await toggle.click();
 await on.getByRole('button', { name: 'Approve with changes' }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(3);
 expect(sentEdit(2)).toEqual({ intent: 'approve', proposal: '1', edited: true });
});
