import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import ReadyMade from '@/app/ready-made';
import { LanguageProvider } from '@/lib/i18n-client';
import { readyRoles } from '@/lib/ready-roles';
import type { Language } from '@/lib/i18n.mjs';

const replace = vi.fn<(href: string) => void>();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }));
// The composer's settings link is the app's Link, which needs Next's router; a plain link stands in.
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

let answer: (response: Response) => void = () => {};
const sent = vi.fn<(body: { conversation: string, message: string }) => void>();
afterEach(() => { replace.mockReset(); sent.mockReset(); vi.unstubAllGlobals(); });
const gallery = async ({ owner = true, owners = [], language = 'en' }: { owner?: boolean, owners?: string[], language?: Language } = {}) => {
 vi.stubGlobal('fetch', (_: string, init: RequestInit) => { sent(JSON.parse(String(init.body))); return new Promise<Response>(resolve => { answer = resolve; }); });
 const lead = language === 'ar' ? 'ليد' : 'Lead';
 return render(<LanguageProvider language={language}><ReadyMade slug="rs-learning" company="c-1" agent="lead-1" companyName="RS Learning" alone={false} lead={lead} roles={readyRoles(language, false)} owner={owner} owners={owners}/></LanguageProvider>);
};

test('Add it asks Lead for the role and opens the Conversation once the message is sent', async () => {
 const screen = await gallery();
 await expect.element(screen.getByText('Pick a role and add it to the team in a minute. This list is private to the RS Learning workspace. Nobody outside the team can see it.')).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'Add SEO content writer' })).toHaveTextContent('Add it');
 await screen.getByRole('button', { name: 'Add SEO content writer' }).click();
 await expect.poll(() => sent.mock.calls.length).toBe(1);
 expect(sent.mock.calls[0][0].message).toBe('Make me a “SEO content writer” agent like the ready-made one');
 answer(new Response('{}', { status: 200 }));
 await expect.poll(() => replace.mock.calls.length).toBe(1);
 expect(replace.mock.calls[0][0]).toBe(`/c/rs-learning/conversations/${sent.mock.calls[0][0].conversation}`);
});

test('the Owner\'s foot keeps "Start from scratch", which returns to Lead\'s chat', async () => {
 const screen = await gallery();
 await expect.element(screen.getByRole('button', { name: 'Start from scratch' })).toBeVisible();
 await screen.getByRole('button', { name: 'Start from scratch' }).click();
 await expect.poll(() => replace.mock.calls).toEqual([['/c/rs-learning/chat?new=agent']]);
 expect(sent).not.toHaveBeenCalled();
});

test('the Owner\'s empty search keeps "Start from scratch" too', async () => {
 const screen = await gallery();
 await screen.getByRole('searchbox', { name: 'Search ready-made agents' }).fill('zzz');
 await expect.element(screen.getByText('No ready-made agent matches “zzz”', { exact: true })).toBeVisible();
 await screen.getByRole('button', { name: 'Start from scratch' }).first().click();
 await expect.poll(() => replace.mock.calls).toEqual([['/c/rs-learning/chat?new=agent']]);
});

test('a Manager or a Contributor asks for a role: every card says "Ask for it", and the line names Lead and the Owner', async () => {
 const screen = await gallery({ owner: false, owners: ['Omar'] });
 await expect.element(screen.getByText('Pick a role and ask Lead. It prepares a proposal, and the agent is only created when Omar approves. This list is private to the RS Learning workspace.', { exact: true })).toBeVisible();
 for (const role of ['Meta ads manager', 'Ad critic', 'SEO content writer', 'Numbers analyst', 'Website coding agent']) {
  await expect.element(screen.getByRole('button', { name: `Ask for ${role}` })).toHaveTextContent('Ask for it');
 }
 await screen.getByRole('button', { name: 'Ask for SEO content writer' }).click();
 await expect.poll(() => sent.mock.calls.length).toBe(1);
 expect(sent.mock.calls[0][0].message).toBe('Make me a “SEO content writer” agent like the ready-made one');
 answer(new Response('{}', { status: 200 }));
 await expect.poll(() => replace.mock.calls.length).toBe(1);
 expect(replace.mock.calls[0][0]).toBe(`/c/rs-learning/conversations/${sent.mock.calls[0][0].conversation}`);
});

test('a second press or a retry asks once: the same Conversation and the same message', async () => {
 const screen = await gallery({ owner: false, owners: ['Omar'] });
 const button = screen.getByRole('button', { name: 'Ask for SEO content writer' });
 const field = button.element() as HTMLButtonElement;
 // Two presses before the first can answer; a press while it is on its way is blocked, and a retry keeps the same ask.
 field.click(); field.click();
 await expect.poll(() => sent.mock.calls.length).toBeGreaterThan(0);
 const [first] = sent.mock.calls.map(([body]) => body);
 await expect.element(button).toBeDisabled();
 answer(new Response(JSON.stringify({ error: 'conversationFailed' }), { status: 500 }));
 await expect.element(screen.getByRole('alert')).toHaveTextContent('Could not send the message. Try again.');
 await expect.element(button).not.toBeDisabled();
 const before = sent.mock.calls.length;
 await button.click();
 await expect.poll(() => sent.mock.calls.length).toBeGreaterThan(before);
 for (const [body] of sent.mock.calls) expect(body).toEqual(first);
 answer(new Response('{}', { status: 200 }));
 await expect.poll(() => replace.mock.calls.length).toBe(1);
 expect(replace.mock.calls[0][0]).toBe(`/c/rs-learning/conversations/${first.conversation}`);
});

test('"Ask Lead" in the foot closes the gallery and returns to Lead\'s chat', async () => {
 const screen = await gallery({ owner: false, owners: ['Omar'] });
 await expect.element(screen.getByRole('button', { name: 'Ask Lead', exact: true })).toBeVisible();
 await screen.getByRole('button', { name: 'Ask Lead', exact: true }).click();
 await expect.poll(() => replace.mock.calls).toEqual([['/c/rs-learning/chat?new=agent']]);
 expect(sent).not.toHaveBeenCalled();
});

test('"Ask Lead" in the empty search closes the gallery too', async () => {
 const screen = await gallery({ owner: false, owners: ['Omar'] });
 await screen.getByRole('searchbox', { name: 'Search ready-made agents' }).fill('zzz');
 await expect.element(screen.getByText('No ready-made agent matches “zzz”', { exact: true })).toBeVisible();
 await screen.getByRole('button', { name: 'Ask Lead', exact: true }).first().click();
 await expect.poll(() => replace.mock.calls).toEqual([['/c/rs-learning/chat?new=agent']]);
});

test('in Arabic a Member asks for a role and the line names the Owner too', async () => {
 const screen = await gallery({ owner: false, owners: ['عمر'], language: 'ar' });
 await expect.element(screen.getByText('اختار دور واطلبه من ليد. هيجهّز اقتراح، والوكيل بيتعمل بس لما عمر يوافق. القايمة دي خاصة بمساحة RS Learning.', { exact: true })).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'اطلب كاتب محتوى SEO' })).toHaveTextContent('اطلبه');
 await expect.element(screen.getByRole('button', { name: 'اطلبه من ليد', exact: true }).first()).toBeVisible();
});

test('a send still on its way when the gallery closes does not move the page that took its place', async () => {
 const screen = await gallery();
 await screen.getByRole('button', { name: 'Add SEO content writer' }).click();
 await expect.poll(() => sent.mock.calls.length).toBe(1);
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => replace.mock.calls.length).toBe(1);
 answer(new Response('{}', { status: 200 }));
 await new Promise(resolve => setTimeout(resolve, 100));
 expect(replace.mock.calls.map(([href]) => href)).toEqual(['/c/rs-learning/chat?new=agent']);
});

// #130: the gallery leaves with the dialog's exit (design-reference: closeModal) and the page moves only once it has run.
test('closing keeps the gallery and its scrim in the page while its leave runs, then the gallery is gone and the address moves once', async () => {
 const screen = await gallery();
 const dialog = screen.getByRole('dialog');
 await expect.element(dialog).toBeVisible();
 await screen.getByRole('button', { name: 'Close' }).click();
 expect(dialog.element()).toHaveClass('is-closing');
 // Nothing in it can be pressed while it leaves: an Add then would ask for a role nobody sees opened.
 expect((dialog.element() as HTMLElement).inert).toBe(true);
 expect(document.querySelector('[data-slot="dialog-overlay"]')).not.toBeNull();
 expect(replace).not.toHaveBeenCalled();
 // A second way out during the leave adds nothing.
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => replace.mock.calls).toEqual([['/c/rs-learning/chat?new=agent']]);
 // useLeave marks the gallery gone and navigates in one callback; React draws it gone on its next render.
 await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull();
 await expect.poll(() => document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
 await new Promise(resolve => setTimeout(resolve, 250));
 expect(replace).toHaveBeenCalledOnce();
});

test('after Add the gallery leaves first and the new Conversation opens after it', async () => {
 const screen = await gallery();
 await screen.getByRole('button', { name: 'Add SEO content writer' }).click();
 await expect.poll(() => sent.mock.calls.length).toBe(1);
 answer(new Response('{}', { status: 200 }));
 await expect.poll(() => document.querySelector('[role="dialog"]')?.classList.contains('is-closing')).toBe(true);
 expect(replace).not.toHaveBeenCalled();
 await expect.poll(() => replace.mock.calls.length).toBe(1);
 expect(replace.mock.calls[0][0]).toBe(`/c/rs-learning/conversations/${sent.mock.calls[0][0].conversation}`);
});
