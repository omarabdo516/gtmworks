import { afterEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import FirstRunChoice, { FirstRunGate, type FirstRunState } from '@/app/first-run-choice';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import { untilDrawn, fakeClock } from './fake-clock';
import '@/app/tokens.css';
import '@/app/first-run-choice.css';

// #186, #953: first run's second step, "Who’s on your team?", as the approved reference draws it (design-reference/app.js:
// frHTML, frRow), now making an Invite link for each Person instead of an email invitation. The action is a prop, so the
// test needs no server.
const push = vi.hoisted(() => vi.fn<(href: string) => void>());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }));
const finish = vi.fn<(state: FirstRunState, form: FormData) => Promise<FirstRunState>>();
afterEach(() => { vi.useRealTimers(); finish.mockReset(); finish.mockResolvedValue({}); push.mockReset(); vi.unstubAllGlobals(); });

const show = (language: Language = 'en') => render(<LanguageProvider language={language}>
 <FirstRunChoice slug="acme-abcd1234" company="10000000-0000-0000-0000-000000000090" companyName="Acme" personName="Omar"
  lead={{ id: 'f0000000-0000-0000-0000-000000000090', name: 'Lead' }} brand={<>gtm<span>works</span></>} mark={<span/>} finish={finish}/>
</LanguageProvider>);
const fields = () => [...document.querySelectorAll<HTMLInputElement>('.fr-row input[type=text]')];
const roles = () => [...document.querySelectorAll<HTMLSelectElement>('.fr-row select')];
const removeButtons = () => [...document.querySelectorAll<HTMLButtonElement>('.fr-row__rm')].filter(button => button.tagName === 'BUTTON');
const choice = (name: string) => document.querySelector<HTMLInputElement>(`input[value="${name}"]`)!;
const showStepTwo = async (screen: Awaited<ReturnType<typeof show>>) => {
 await screen.getByRole('radio', { name: 'With a team' }).click();
 await screen.getByRole('button', { name: 'Continue' }).click();
};

test('"With a team" turns the button into Continue, which opens step two with the focus in the first name field; Back and Escape return to the question with the team chosen and nothing made', async () => {
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

// The cloud journey's "Alone", picked on the server-drawn question before React took it over, stayed checked with the
// button disabled, and picking it again changed nothing (scripts/cloud-verify.mjs).
test('"Alone" picked on the server-drawn question before the page hydrates is kept, and opens the workspace', async () => {
 const question = <LanguageProvider language="en">
  <FirstRunChoice slug="acme-abcd1234" company="10000000-0000-0000-0000-000000000090" companyName="Acme" personName="Omar"
   lead={{ id: 'f0000000-0000-0000-0000-000000000090', name: 'Lead' }} brand={<>gtm<span>works</span></>} mark={<span/>} finish={finish}/>
 </LanguageProvider>;
 const host = document.body.appendChild(document.createElement('div'));
 host.innerHTML = renderToString(question);
 host.querySelector<HTMLInputElement>('input[value="alone"]')!.click();
 const root = await act(async () => hydrateRoot(host, question));
 try {
  const open = host.querySelector<HTMLButtonElement>('#fr-go')!;
  await expect.poll(() => open.disabled).toBe(false);
  expect(host.querySelector<HTMLInputElement>('input[value="alone"]')!.checked).toBe(true);
  await act(async () => open.click());
  await expect.poll(() => finish.mock.calls.length).toBe(1);
  expect(finish.mock.calls[0][1].get('choice')).toBe('alone');
 } finally { act(() => root.unmount()); host.remove(); }
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

test('only rows with a name are sent, trimmed, with their Roles; an empty row is ignored', async () => {
 const screen = await show();
 await showStepTwo(screen);
 await screen.getByRole('button', { name: 'Add a member' }).click();
 await screen.getByRole('button', { name: 'Add a member' }).click();
 await userEvent.type(fields()[0], '  Nour Salah ');
 await userEvent.selectOptions(roles()[0], 'manager');
 await userEvent.type(fields()[2], 'Karim Adel');
 await userEvent.selectOptions(roles()[2], 'viewer');
 await screen.getByRole('button', { name: 'Open the workspace' }).click();
 await expect.poll(() => finish.mock.calls.length).toBe(1);
 expect(JSON.parse(String(finish.mock.calls[0][1].get('rows')))).toEqual([
  { id: 0, label: 'Nour Salah', role: 'manager' },
  { id: 2, label: 'Karim Adel', role: 'viewer' },
 ]);
});

// #953: the links are made by the action and shown once, each in full with a copy button; the question stays until the
// Owner has copied them and presses "Open the workspace".
test('the made Invite links are shown once to copy, and the question leaves only when the Owner opens the workspace', async () => {
 const copied: string[] = [];
 vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (text: string) => { copied.push(text); } } });
 const links = [{ label: 'Nour Salah', link: `http://127.0.0.1:3000/join#code=${'a'.repeat(64)}` }, { label: 'Karim Adel', link: `http://127.0.0.1:3000/join#code=${'b'.repeat(64)}` }];
 finish.mockResolvedValue({ opened: '/c/acme-abcd1234/conversations/cv-1?first=team&invites=2', links });
 const screen = await show();
 await showStepTwo(screen);
 await userEvent.type(fields()[0], 'Nour Salah');
 await screen.getByRole('button', { name: 'Open the workspace' }).click();
 await expect.element(screen.getByRole('dialog', { name: 'Your invite links' })).toBeVisible();
 const linkFields = [...document.querySelectorAll<HTMLInputElement>('.fr-row input[type=text]')];
 expect(linkFields.map(field => field.value)).toEqual(links.map(link => link.link));
 expect(linkFields.every(field => field.readOnly)).toBe(true);
 await expect.element(screen.getByLabelText('Invite link for Nour Salah')).toBeVisible();
 await screen.getByRole('button', { name: 'Copy the link' }).first().click();
 expect(copied).toEqual([links[0].link]);
 await expect.element(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
 // Nothing has navigated: the links are the point of the step.
 fakeClock();
 (screen.getByRole('button', { name: 'Open the workspace' }).element() as HTMLButtonElement).click();
 await untilDrawn(() => !!document.querySelector('.fr')?.classList.contains('is-closing'), 'the leave');
 expect(push).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(190);
 expect(push.mock.calls).toEqual([['/c/acme-abcd1234/conversations/cv-1?first=team&invites=2']]);
});

test('in Arabic the second step keeps its words, the name field follows the name, and the link step reads as the reference words it', async () => {
 const screen = await show('ar');
 await screen.getByRole('radio', { name: 'مع تيم' }).click();
 await screen.getByRole('button', { name: 'كمّل' }).click();
 expect(document.querySelector('.fr__eyebrow')?.textContent).toBe('مع تيم · الخطوة 2 من 2');
 expect(fields()[0].getAttribute('dir')).toBe('auto');
 expect(screen.getByRole('button', { name: 'اتخطى' }).element()).toBeVisible();
 expect(screen.getByRole('button', { name: 'افتح المساحة' }).element()).toBeVisible();
});

test('Enter in a name field opens the links, never Skip, the form\'s first submit button', async () => {
 const screen = await show();
 await showStepTwo(screen);
 await userEvent.fill(fields()[0], 'نور');
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
 // The leave is timed on a fake clock (#501), and pressed in the page so no driver round trip runs inside it.
 fakeClock();
 (screen.getByRole('button', { name: 'Open the workspace' }).element() as HTMLButtonElement).click();
 await untilDrawn(() => !!document.querySelector('.fr')?.classList.contains('is-closing'), 'the leave');
 await vi.advanceTimersByTimeAsync(189);
 expect(document.querySelector<HTMLElement>('.fr-root')?.hidden).toBe(false);
 expect(push).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);
 expect(push.mock.calls).toEqual([['/c/acme-abcd1234/conversations/cv-1?first=alone']]);
 // useLeave marks the question gone and navigates in one callback; React draws it gone on its next render.
 await untilDrawn(() => document.querySelector<HTMLElement>('.fr-root')?.hidden === true, 'the question gone');
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

// #789: the Shell is drawn once by the Company's layout, around the gate. Saving the answer can draw the layout again
// with no question before the question has left; the question stays, plays its exit and opens the Conversation, and
// only then gives the workspace back.
test('an answer whose save draws the layout again without the question still opens the Conversation, then frees the workspace', async () => {
 finish.mockResolvedValue({ opened: '/c/acme-abcd1234/conversations/c1' });
 const question = <FirstRunChoice slug="acme-abcd1234" company="10000000-0000-0000-0000-000000000090" companyName="Acme" personName="Omar"
  lead={{ id: 'f0000000-0000-0000-0000-000000000090', name: 'Lead' }} brand={<>gtm<span>works</span></>} mark={<span/>} finish={finish}/>;
 const gate = (asked: boolean) => <LanguageProvider language="en"><FirstRunGate question={asked ? question : null}><main data-testid="workspace">Workspace</main></FirstRunGate></LanguageProvider>;
 const screen = await render(gate(true));
 const workspace = () => document.querySelector('[data-testid="workspace"]')!.parentElement!;
 expect(workspace().inert).toBe(true);
 await screen.getByRole('radio', { name: 'Alone' }).click();
 await screen.getByRole('button', { name: 'Open the workspace' }).click();
 await expect.poll(() => finish.mock.calls.length).toBe(1);
 // The layout is drawn again as the answer is saved: the Shell no longer asks.
 await screen.rerender(gate(false));
 await expect.poll(() => push.mock.calls.map(([href]) => href)).toEqual(['/c/acme-abcd1234/conversations/c1']);
 await expect.poll(() => workspace().inert).toBe(false);
 expect(document.querySelector('[role="dialog"]')).toBeNull();
});

// #953: when the links were made but the answer could not be saved, the screen keeps the links and its next press only
// saves the answer, so a retry never makes a second batch.
test('a save that fails after the links were made keeps them on screen, and the next press only saves the answer', async () => {
 const links = [{ label: 'Nour Salah', link: `http://127.0.0.1:3000/join#code=${'c'.repeat(64)}` }];
 finish.mockResolvedValueOnce({ error: 'firstRunFailed', links }).mockResolvedValueOnce({ opened: '/c/acme-abcd1234/conversations/cv-1?first=team&invites=1' });
 const screen = await show();
 await showStepTwo(screen);
 await userEvent.type(fields()[0], 'Nour Salah');
 await screen.getByRole('button', { name: 'Open the workspace' }).click();
 await expect.element(screen.getByLabelText('Invite link for Nour Salah')).toHaveValue(links[0].link);
 await expect.element(screen.getByRole('alert')).toHaveTextContent('Your answer wasn’t saved. Try again.');
 await expect.element(screen.getByRole('button', { name: 'Copy the link' })).toBeVisible();
 await screen.getByRole('button', { name: 'Open the workspace' }).click();
 await expect.poll(() => finish.mock.calls.length).toBe(2);
 const form = finish.mock.calls[1][1];
 expect(form.get('choice')).toBe('save');
 expect(form.get('made')).toBe('1');
 await expect.poll(() => push.mock.calls.length).toBe(1);
 expect(push.mock.calls[0][0]).toBe('/c/acme-abcd1234/conversations/cv-1?first=team&invites=1');
});
