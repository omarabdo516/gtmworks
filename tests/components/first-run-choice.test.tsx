import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import FirstRunChoice, { type FirstRunState } from '@/app/first-run-choice';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/tokens.css';
import '@/app/first-run-choice.css';

// #186: first run's second step, "Who’s on your team?", as the approved reference draws it (design-reference/app.js:
// frHTML, frRow). The action is a prop, so the test needs no server.
const push = vi.hoisted(() => vi.fn<(href: string) => void>());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }));
const finish = vi.fn<(state: FirstRunState, form: FormData) => Promise<FirstRunState>>();
afterEach(() => { finish.mockReset(); finish.mockResolvedValue({}); push.mockReset(); });

const show = (language: Language = 'en') => render(<LanguageProvider language={language}>
 <FirstRunChoice slug="acme-abcd1234" company="10000000-0000-0000-0000-000000000090" companyName="Acme" personName="Omar"
  lead={{ name: 'Lead', connection_id: 'f0000000-0000-0000-0000-000000000090' }} brand={<>gtm<span>works</span></>} mark={<span/>} finish={finish}/>
</LanguageProvider>);
const fields = () => [...document.querySelectorAll<HTMLInputElement>('.fr-row input[type=email]')];
const roles = () => [...document.querySelectorAll<HTMLSelectElement>('.fr-row select')];
const removeButtons = () => [...document.querySelectorAll<HTMLButtonElement>('.fr-row__rm')].filter(button => button.tagName === 'BUTTON');
const errors = () => [...document.querySelectorAll<HTMLElement>('.fr-row .set-err')];
const choice = (name: string) => document.querySelector<HTMLInputElement>(`input[value="${name}"]`)!;
const showStepTwo = async (screen: Awaited<ReturnType<typeof show>>) => {
 await screen.getByRole('radio', { name: 'With a team' }).click();
 await screen.getByRole('button', { name: 'Continue' }).click();
};

test('"With a team" turns the button into Continue, which opens step two with the focus in the first email field; Back and Escape return to the question with the team chosen and nothing sent', async () => {
 const screen = await show();
 expect(screen.getByRole('button', { name: 'Open the workspace' }).element()).toBeDisabled();
 await screen.getByRole('radio', { name: 'With a team' }).click();
 const go = screen.getByRole('button', { name: 'Continue' });
 expect(go.element()).toBeEnabled();
 await go.click();
 expect(screen.getByRole('dialog', { name: 'Who’s on your team?' }).element()).toBeVisible();
 expect(document.querySelector('.fr__eyebrow')?.textContent).toBe('With a team · Step 2 of 2');
 expect(fields()).toHaveLength(1);
 await expect.poll(() => document.activeElement).toBe(fields()[0]);
 expect(roles()[0].value).toBe('contributor');
 expect(document.querySelector('.fr-roles')?.textContent).toContain('ManagerChooses the agents for each member');
 expect(finish).not.toHaveBeenCalled();

 await screen.getByRole('button', { name: 'Back' }).click();
 expect(choice('team').checked).toBe(true);
 await expect.poll(() => document.activeElement).toBe(choice('team'));
 expect(screen.getByRole('button', { name: 'Continue' }).element()).toBeVisible();
 expect(finish).not.toHaveBeenCalled();

 await screen.getByRole('button', { name: 'Continue' }).click();
 await userEvent.keyboard('{Escape}');
 expect(choice('team').checked).toBe(true);
 expect(screen.getByRole('button', { name: 'Continue' }).element()).toBeVisible();
 expect(finish).not.toHaveBeenCalled();
});

test('picking "Alone" opens the workspace as one step, sending alone and no row', async () => {
 const screen = await show();
 await screen.getByRole('radio', { name: 'Alone' }).click();
 expect(screen.getByRole('button', { name: 'Open the workspace' }).element()).toBeEnabled();
 await screen.getByRole('button', { name: 'Open the workspace' }).click();
 await expect.poll(() => finish.mock.calls.length).toBe(1);
 const form = finish.mock.calls[0][1];
 expect(form.get('choice')).toBe('alone');
 expect(form.get('mode')).toBe('alone');
 expect(form.get('rows')).toBe('[]');
});

test('"Add a member" adds a focused row that starts as Contributor; a row can be removed only while there is more than one', async () => {
 const screen = await show();
 await showStepTwo(screen);
 expect(removeButtons()).toHaveLength(0);
 await screen.getByRole('button', { name: 'Add a member' }).click();
 expect(fields()).toHaveLength(2);
 expect(roles().map(select => select.value)).toEqual(['contributor', 'contributor']);
 await expect.poll(() => document.activeElement).toBe(fields()[1]);
 expect(removeButtons().map(button => button.getAttribute('aria-label'))).toEqual(['Remove member 1', 'Remove member 2']);
 await screen.getByRole('button', { name: 'Remove member 2' }).click();
 expect(fields()).toHaveLength(1);
 expect(removeButtons()).toHaveLength(0);
});

test('a malformed email and the same email twice show their errors under their rows, the first takes the focus, and nothing is sent; an empty row is ignored', async () => {
 const screen = await show();
 await showStepTwo(screen);
 await screen.getByRole('button', { name: 'Add a member' }).click();
 await screen.getByRole('button', { name: 'Add a member' }).click();
 await screen.getByRole('button', { name: 'Add a member' }).click();
 await userEvent.type(fields()[1], 'nour@rslearning');
 await userEvent.type(fields()[2], 'karim@example.test');
 await userEvent.type(fields()[3], 'KARIM@example.test');
 await screen.getByRole('button', { name: 'Open the workspace' }).click();
 await expect.poll(() => errors()[1].hidden).toBe(false);
 expect(errors()[1].textContent).toBe('This email is missing something. Write it in full, like nour@rslearning.com');
 await expect.poll(() => errors()[3].hidden).toBe(false);
 expect(errors()[3].textContent).toBe('This email has already been invited.');
 expect(errors()[0].hidden).toBe(true);
 await expect.poll(() => document.activeElement).toBe(fields()[1]);
 expect(finish).not.toHaveBeenCalled();

 // Fixing the first still leaves the duplicate: the first bad row left takes the focus, and still nothing is sent.
 await userEvent.clear(fields()[1]);
 await userEvent.type(fields()[1], 'nour@example.test');
 await screen.getByRole('button', { name: 'Open the workspace' }).click();
 await expect.poll(() => document.activeElement).toBe(fields()[3]);
 expect(finish).not.toHaveBeenCalled();

 // With the duplicate gone, only the rows with an email are sent.
 await userEvent.clear(fields()[3]);
 await screen.getByRole('button', { name: 'Open the workspace' }).click();
 await expect.poll(() => finish.mock.calls.length).toBe(1);
 expect(JSON.parse(String(finish.mock.calls[0][1].get('rows')))).toEqual([
  { id: 1, email: 'nour@example.test', role: 'contributor' },
  { id: 2, email: 'karim@example.test', role: 'contributor' },
 ]);
});

test('an email already invited comes back under its row with the focus there and the step still open', async () => {
 finish.mockResolvedValue({ rowErrors: { 0: 'inviteEmailTaken' }, firstError: 0, sent: [] });
 const screen = await show();
 await showStepTwo(screen);
 await userEvent.type(fields()[0], 'nour@example.test');
 await screen.getByRole('button', { name: 'Open the workspace' }).click();
 await expect.poll(() => errors()[0].hidden).toBe(false);
 expect(errors()[0].textContent).toBe('This email has already been invited.');
 await expect.poll(() => document.activeElement).toBe(fields()[0]);
 expect(screen.getByRole('dialog', { name: 'Who’s on your team?' }).element()).toBeVisible();
 expect(JSON.parse(String(finish.mock.calls[0][1].get('rows')))).toEqual([{ id: 0, email: 'nour@example.test', role: 'contributor' }]);
});

test('a refusal stays on its own email when the row above it is removed', async () => {
 finish.mockImplementation(async (_state, form) => {
  const sent = JSON.parse(String(form.get('rows'))) as { id: number, email: string }[];
  return { rowErrors: { [sent[1].id]: 'inviteEmailTaken' }, firstError: sent[1].id, sent: [] };
 });
 const screen = await show();
 await showStepTwo(screen);
 await screen.getByRole('button', { name: 'Add a member' }).click();
 await userEvent.type(fields()[0], 'nour@example.test');
 await userEvent.type(fields()[1], 'karim@example.test');
 await screen.getByRole('button', { name: 'Open the workspace' }).click();
 await expect.poll(() => errors()[1].hidden).toBe(false);
 expect(errors()[1].textContent).toBe('This email has already been invited.');
 await expect.poll(() => document.activeElement).toBe(fields()[1]);
 // The row above goes: the refusal and the focus stay with Karim's email, not with a place.
 await screen.getByRole('button', { name: 'Remove member 1' }).click();
 expect(fields()).toHaveLength(1);
 expect(fields()[0].value).toBe('karim@example.test');
 await expect.poll(() => errors()[0].hidden).toBe(false);
 expect(errors()[0].textContent).toBe('This email has already been invited.');
 expect(document.activeElement).toBe(fields()[0]);
});

test('in Arabic the second step keeps its words, its email field left to right and the example the invite form uses', async () => {
 const screen = await show('ar');
 await screen.getByRole('radio', { name: 'مع تيم' }).click();
 await screen.getByRole('button', { name: 'كمّل' }).click();
 expect(document.querySelector('.fr__eyebrow')?.textContent).toBe('مع تيم · الخطوة 2 من 2');
 expect(fields()[0].getAttribute('dir')).toBe('ltr');
 expect(fields()[0].placeholder).toBe('nour@rslearning.com');
 expect(screen.getByRole('button', { name: 'اتخطى' }).element()).toBeVisible();
 expect(screen.getByRole('button', { name: 'افتح المساحة' }).element()).toBeVisible();
});

test('Enter in an email field opens the workspace with its invitations, never Skip, the form\'s first submit button', async () => {
 const screen = await show();
 await showStepTwo(screen);
 await userEvent.fill(fields()[0], 'nour@example.com');
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => finish.mock.calls.length).toBe(1);
 expect(finish.mock.calls[0][1].get('choice')).toBe('open');
});

test('Back\'s chevron points the way the reference draws it: left in English', async () => {
 const screen = await show();
 await showStepTwo(screen);
 expect(document.querySelector('#fr-back svg path')!.getAttribute('d'), 'English Back points left, as icon(\'chevronRight\') flips').toBe('M15 6l-6 6 6 6');
});

test('Back\'s chevron in Arabic points right, as the reference\'s chevronRight does', async () => {
 const screen = await show('ar');
 await screen.getByRole('radio', { name: 'مع تيم' }).click();
 await screen.getByRole('button', { name: 'كمّل' }).click();
 expect(document.querySelector('#fr-back svg path')!.getAttribute('d')).toBe('M9 6l6 6-6 6');
});

// #130: once the answer is saved the question leaves with the dialog's exit (design-reference: closeDlg), then Lead's
// Conversation opens; a save that fails keeps it with its error.
test('a saved answer leaves with the exit, then opens the Conversation the server named', async () => {
 finish.mockResolvedValue({ opened: '/c/acme-abcd1234/conversations/cv-1?first=alone' });
 const screen = await show();
 await screen.getByRole('radio', { name: 'Alone' }).click();
 await screen.getByRole('button', { name: 'Open the workspace' }).click();
 await expect.poll(() => document.querySelector('.fr')?.classList.contains('is-closing')).toBe(true);
 expect(push).not.toHaveBeenCalled();
 await expect.poll(() => push.mock.calls).toEqual([['/c/acme-abcd1234/conversations/cv-1?first=alone']]);
 expect(document.querySelector<HTMLElement>('.fr-root')?.hidden).toBe(true);
});

test('a save that fails keeps the question with its error and never leaves', async () => {
 finish.mockResolvedValue({ error: 'firstRunFailed' });
 const screen = await show();
 await screen.getByRole('radio', { name: 'Alone' }).click();
 await screen.getByRole('button', { name: 'Open the workspace' }).click();
 await expect.element(screen.getByRole('alert')).toBeVisible();
 await new Promise(resolve => setTimeout(resolve, 250));
 expect(document.querySelector('.fr.is-closing')).toBeNull();
 expect(push).not.toHaveBeenCalled();
});
