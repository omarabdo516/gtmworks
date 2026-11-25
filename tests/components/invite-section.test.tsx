import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { InviteSection } from '@/app/invite-section';
import { ToastHost } from '@/app/toast';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/tokens.css';
import '@/app/settings.css';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/settings' }));
const send = vi.fn<(email: string, role: string) => Promise<{ error?: string }>>();
afterEach(() => { send.mockReset(); refresh.mockReset(); });

const roles = [
 { key: 'manager', name: 'Manager', description: 'Chooses the agents for each member, and writes and approves everywhere.' },
 { key: 'contributor', name: 'Contributor', description: 'Writes with the agents you choose for them.' },
 { key: 'viewer', name: 'Viewer', description: 'Reads only, without writing or approving.' },
];
const show = (mode: 'table' | 'alone', language: Language = 'en') => render(<LanguageProvider language={language}>
 <div className="gw"><div className="sov"><InviteSection mode={mode} roles={roles} send={send}/></div></div><ToastHost/>
</LanguageProvider>);
const email = () => document.getElementById('inv-email') as HTMLInputElement;
const error = () => document.getElementById('inv-email-err') as HTMLElement;
const toggle = () => document.getElementById('inv-toggle');
// What a finger can reach and what the eye sees: the control's box grown by the invisible ring drawn around it, and the
// control's own height (app/log.css's 44px field, app/settings.css's rings for the small controls).
const tapArea = (node: Element) => {
 const own = node.getBoundingClientRect(), ring = getComputedStyle(node, '::before');
 const grow = ring.content === 'none' ? 0 : -(parseFloat(ring.top) || 0) - (parseFloat(ring.bottom) || 0);
 return { reach: own.height + Math.max(0, grow), seen: node.clientHeight };
};

test('"Invite a member" opens the form in place with the focus in the email field; Cancel closes it with the focus back on the button', async () => {
 const screen = await show('table');
 const address = location.href;
 expect(email()).toBeNull();
 await screen.getByRole('button', { name: 'Invite a member' }).click();
 await expect.element(screen.getByRole('heading', { name: 'Invite a member Cancel' })).toBeVisible();
 await expect.poll(() => document.activeElement).toBe(email());
 await expect.element(screen.getByLabelText('Role')).toHaveValue('contributor');
 await expect.element(screen.getByText('Contributor: Writes with the agents you choose for them.')).toBeVisible();
 await screen.getByRole('button', { name: 'Cancel' }).click();
 expect(email()).toBeNull();
 await expect.poll(() => document.activeElement).toBe(toggle());
 expect(toggle()?.textContent).toBe('Invite a member');
 expect(location.href).toBe(address);
});

test('an empty or malformed email shows its error under the field and sends nothing; a taken one shows the server\'s answer', async () => {
 const screen = await show('table');
 await screen.getByRole('button', { name: 'Invite a member' }).click();
 await screen.getByRole('button', { name: 'Invite', exact: true }).click();
 await expect.element(screen.getByText('Write the member’s email.')).toBeVisible();
 expect(email().getAttribute('aria-invalid')).toBe('true');
 expect(email().getAttribute('aria-describedby')).toBe('inv-email-err');
 await userEvent.type(email(), 'nour@rslearning');
 await screen.getByRole('button', { name: 'Invite', exact: true }).click();
 await expect.element(screen.getByText('This email is missing something. Write it in full, like nour@rslearning.com')).toBeVisible();
 expect([...error().querySelectorAll('bdi')].map(run => [run.getAttribute('dir'), run.textContent])).toEqual([['ltr', 'nour@rslearning.com']]);
 await expect.poll(() => document.activeElement).toBe(email());
 expect(send).not.toHaveBeenCalled();
 send.mockResolvedValue({ error: 'inviteEmailTaken' });
 await userEvent.type(email(), '.com');
 await screen.getByRole('button', { name: 'Invite', exact: true }).click();
 await expect.element(screen.getByText('This email has already been invited.')).toBeVisible();
 expect(send).toHaveBeenCalledWith('nour@rslearning.com', 'contributor');
 await expect.poll(() => document.activeElement).toBe(email());
 expect(email().value).toBe('nour@rslearning.com');
});

test('the error leaves while typing as soon as the email is right', async () => {
 const screen = await show('table');
 await screen.getByRole('button', { name: 'Invite a member' }).click();
 await userEvent.type(email(), 'nour@');
 await screen.getByRole('button', { name: 'Invite', exact: true }).click();
 expect(error().hidden).toBe(false);
 await userEvent.type(email(), 'rslearning.c');
 expect(error().hidden).toBe(false);
 await userEvent.type(email(), 'o');
 expect(error().hidden).toBe(true);
 expect(email().hasAttribute('aria-invalid')).toBe(false);
 expect(send).not.toHaveBeenCalled();
});

test('a send closes the form, puts the focus back on the button, says "Invite sent to" the email and refreshes the table', async () => {
 const screen = await show('table');
 send.mockResolvedValue({});
 await screen.getByRole('button', { name: 'Invite a member' }).click();
 await userEvent.type(email(), ' nour@rslearning.com ');
 await userEvent.selectOptions(screen.getByLabelText('Role').element(), 'manager');
 await expect.element(screen.getByText('Manager: Chooses the agents for each member, and writes and approves everywhere.')).toBeVisible();
 await screen.getByRole('button', { name: 'Invite', exact: true }).click();
 await expect.element(screen.getByRole('status')).toHaveTextContent('Invite sent to nour@rslearning.com');
 expect(send).toHaveBeenCalledWith('nour@rslearning.com', 'manager');
 expect(email()).toBeNull();
 await expect.poll(() => document.activeElement).toBe(toggle());
 expect(refresh).toHaveBeenCalledOnce();
 await screen.getByRole('button', { name: 'Invite a member' }).click();
 await expect.element(screen.getByLabelText('Role')).toHaveValue('contributor');
 expect(email().value).toBe('');
});

test('a send that never answers says it failed and gives the form back', async () => {
 const screen = await show('alone');
 send.mockRejectedValue(new TypeError('Failed to fetch'));
 await userEvent.type(email(), 'nour@rslearning.com');
 await screen.getByRole('button', { name: 'Invite', exact: true }).click();
 await expect.element(screen.getByText('Couldn’t send the invite. Try again.')).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'Invite', exact: true })).toBeEnabled();
 expect(email().value).toBe('nour@rslearning.com');
});

test('a Company worked alone keeps the form open: a send empties it and keeps the focus in the email field', async () => {
 const screen = await show('alone');
 send.mockResolvedValue({});
 await expect.element(screen.getByRole('heading', { name: 'Invite a member', level: 4 })).toBeVisible();
 expect(toggle()).toBeNull();
 await screen.getByRole('button', { name: 'Invite', exact: true }).click();
 await expect.element(screen.getByText('Write the member’s email.')).toBeVisible();
 expect(send).not.toHaveBeenCalled();
 await userEvent.type(email(), 'nour@rslearning.com');
 await screen.getByRole('button', { name: 'Invite', exact: true }).click();
 await expect.element(screen.getByRole('status')).toHaveTextContent('Invite sent to nour@rslearning.com');
 expect(email().value).toBe('');
 await expect.poll(() => document.activeElement).toBe(email());
});

test('in Arabic the errors are the reference\'s, with the email kept left to right', async () => {
 const screen = await show('table', 'ar');
 await screen.getByRole('button', { name: 'اعزم عضو' }).click();
 await screen.getByRole('button', { name: 'اعزم', exact: true }).click();
 await expect.element(screen.getByText('اكتب إيميل العضو.')).toBeVisible();
 await userEvent.type(email(), 'nour');
 await screen.getByRole('button', { name: 'اعزم', exact: true }).click();
 await expect.poll(() => error().textContent).toBe('الإيميل ده ناقصه حاجة. اكتبه كامل، زي nour@rslearning.com');
 expect(error().querySelector('bdi')?.getAttribute('dir')).toBe('ltr');
 await screen.getByRole('button', { name: 'إلغاء' }).click();
 await expect.poll(() => document.activeElement).toBe(toggle());
 send.mockResolvedValue({});
 await screen.getByRole('button', { name: 'اعزم عضو' }).click();
 await userEvent.type(email(), 'nour.hassan@rslearning.com');
 await screen.getByRole('button', { name: 'اعزم', exact: true }).click();
 await expect.element(screen.getByRole('status')).toHaveTextContent('اتبعتت دعوة لـ nour.hassan@rslearning.com');
 expect([...document.querySelectorAll('[role=status] bdi')].map(run => [run.getAttribute('dir'), run.textContent])).toEqual([['ltr', 'nour.hassan@rslearning.com']]);
});

// #313, from app.spec.ts "member and invitation controls have mobile touch targets" (#257 removed the compared screens): on a
// phone the invitation form's controls reach 44px under a finger, and its small controls keep their 22px size.
for (const [language, invite, cancel] of [['en', 'Invite a member', 'Cancel'], ['ar', 'اعزم عضو', 'إلغاء']] as const) test(`on a phone in ${language} the invitation form's controls reach 44px, and its small controls keep their 22px size`, async () => {
 await page.viewport(390, 900);
 const screen = await show('table', language);
 const closed = tapArea(toggle()!);
 expect(closed.reach, '"Invite a member" reaches 44px').toBeGreaterThanOrEqual(44);
 expect(closed.seen, '"Invite a member" keeps at least 22px').toBeGreaterThanOrEqual(22);
 await screen.getByRole('button', { name: invite }).click();
 await expect.element(screen.getByRole('button', { name: cancel })).toBeVisible();
 const fields = [...document.querySelectorAll('.inv-sec .inv :is(input[type=email], select, button)')];
 expect(fields).toHaveLength(3);
 for (const field of fields) {
  const area = tapArea(field);
  expect(area.reach, `${field.tagName} ${field.id || field.textContent} reaches 44px`).toBeGreaterThanOrEqual(44);
  expect(area.seen, `${field.tagName} ${field.id || field.textContent} keeps at least 22px`).toBeGreaterThanOrEqual(22);
 }
 const small = tapArea(screen.getByRole('button', { name: cancel }).element());
 expect(small.reach, '"Cancel" reaches 44px').toBeGreaterThanOrEqual(44);
 expect(small.seen, '"Cancel" keeps at least 22px').toBeGreaterThanOrEqual(22);
});
