import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { ReviewDecision } from '@/app/review-decision';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/card-window.css';

// #681: a review decided in the Card window (design-reference-card: cwCalloutHTML's review, cwApprove, cwSendBack).
const send = vi.fn<(form: FormData) => Promise<void>>(async () => {});
afterEach(() => send.mockClear());
const show = (language: Language = 'en', version: number | null = 41) => render(<LanguageProvider language={language}><div className="gw"><section className="cw-call">
 <ReviewDecision slug="rs-learning" company="co-1" card={7} version={version} send={send}/></section></div></LanguageProvider>);
const sent = () => Object.fromEntries(send.mock.lastCall![0].entries());

test('Approve sends the decision on the exact Version the review was asked on', async () => {
 const screen = await show();
 await screen.getByRole('button', { name: 'Approve' }).click();
 await expect.poll(() => send.mock.calls.length).toBe(1);
 expect(sent()).toMatchObject({ op: 'approve', card: '7', version: '41', company: 'co-1' });
});

test('a review of a Card with no Version yet is decided as it is', async () => {
 const screen = await show('en', null);
 await screen.getByRole('button', { name: 'Approve' }).click();
 await expect.poll(() => send.mock.calls.length).toBe(1);
 expect(sent()).toMatchObject({ op: 'approve', version: '' });
});

test('Send back asks for the reason, refuses an empty one, and sends it', async () => {
 const screen = await show();
 await screen.getByRole('button', { name: 'Send back' }).click();
 const reason = screen.getByRole('textbox', { name: 'The reason' });
 await expect.element(reason).toHaveFocus();
 await screen.getByRole('button', { name: 'Send back' }).click();
 expect(send).not.toHaveBeenCalled();
 await expect.element(reason).toHaveAttribute('aria-invalid', 'true');
 await expect.element(screen.getByText('Write the reason so whoever works on the card knows what to change.')).toBeVisible();
 await reason.fill('Shorter caption');
 await expect.element(reason).not.toHaveAttribute('aria-invalid');
 await screen.getByRole('button', { name: 'Send back' }).click();
 await expect.poll(() => send.mock.calls.length).toBe(1);
 expect(sent()).toMatchObject({ op: 'send-back', reason: 'Shorter caption', version: '41' });
});

test('Cancel and Escape go back to Approve and Send back without sending', async () => {
 const screen = await show();
 await screen.getByRole('button', { name: 'Send back' }).click();
 await screen.getByRole('button', { name: 'Cancel' }).click();
 await expect.element(screen.getByRole('button', { name: 'Approve' })).toBeVisible();
 await screen.getByRole('button', { name: 'Send back' }).click();
 await userEvent.keyboard('{Escape}');
 await expect.element(screen.getByRole('button', { name: 'Approve' })).toBeVisible();
 expect(send).not.toHaveBeenCalled();
});

test('in Arabic the decision reads in Arabic', async () => {
 const screen = await show('ar');
 await expect.element(screen.getByRole('button', { name: 'وافق' })).toBeVisible();
 await screen.getByRole('button', { name: 'رجّعها' }).click();
 await expect.element(screen.getByRole('textbox', { name: 'السبب' })).toHaveAttribute('placeholder', 'إيه اللي يتغيّر؟');
});
