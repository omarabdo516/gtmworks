import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { MessageBox } from '@/app/conversation-composer';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';

type Send = (text: string, sendKey: string) => Promise<string | null>;
const box = (props: { send: Send, stop?: { label: string, run: () => Promise<string | null> }, draft?: string }, language: Language = 'en') =>
 render(<LanguageProvider language={language}><MessageBox placeholder="Write" {...props}/></LanguageProvider>);

test('Enter sends the typed text once and empties the box; Shift+Enter adds a line', async () => {
 const send = vi.fn<Send>(async () => null);
 const screen = await box({ send });
 const message = screen.getByRole('textbox', { name: 'Message' });
 await userEvent.type(message, 'first line{Shift>}{Enter}{/Shift}second line');
 expect(send).not.toHaveBeenCalled();
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => send.mock.calls.length).toBe(1);
 expect(send.mock.calls[0][0]).toBe('first line\nsecond line');
 await expect.element(message).toHaveValue('');
 await expect.element(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

test('a failed send keeps the text, shows why, and a retry reuses the same send key', async () => {
 const send = vi.fn<Send>().mockResolvedValueOnce('conversationFailed').mockResolvedValueOnce(null);
 const screen = await box({ send });
 await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'hello');
 await screen.getByRole('button', { name: 'Send' }).click();
 await expect.element(screen.getByRole('alert')).toHaveTextContent('Could not send the message. Try again.');
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('hello');
 await screen.getByRole('button', { name: 'Send' }).click();
 await expect.poll(() => send.mock.calls.length).toBe(2);
 expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
 await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
});

test('a new text gets a new send key', async () => {
 const send = vi.fn<Send>(async () => null);
 const screen = await box({ send });
 const message = screen.getByRole('textbox', { name: 'Message' });
 await userEvent.type(message, 'one{Enter}');
 await expect.poll(() => send.mock.calls.length).toBe(1);
 await userEvent.type(message, 'one{Enter}');
 await expect.poll(() => send.mock.calls.length).toBe(2);
 expect(send.mock.calls[1][1]).not.toBe(send.mock.calls[0][1]);
});

test('a double click while sending runs one send', async () => {
 let finish: (failure: string | null) => void = () => {};
 const send = vi.fn<Send>(() => new Promise(resolve => { finish = resolve; }));
 const screen = await box({ send });
 await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'once');
 await screen.getByRole('button', { name: 'Send' }).dblClick();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('aria-busy', 'true');
 finish(null);
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
 expect(send).toHaveBeenCalledTimes(1);
});

test('while the Agent works an empty box offers stop, and typed text still sends', async () => {
 const send = vi.fn<Send>(async () => null);
 const run = vi.fn(async () => null);
 const screen = await box({ send, stop: { label: 'Stop', run } });
 await screen.getByRole('button', { name: 'Stop' }).click();
 expect(run).toHaveBeenCalledTimes(1);
 await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'next');
 await expect.element(screen.getByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
 await screen.getByRole('button', { name: 'Send' }).click();
 await expect.poll(() => send.mock.calls.length).toBe(1);
});

test('a draft starts in the box, focused; extras and dictation say Soon', async () => {
 const screen = await box({ send: async () => null, draft: 'Make an Agent' });
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Make an Agent');
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
 await expect.element(screen.getByRole('button', { name: 'More · Soon' })).toHaveAttribute('aria-disabled', 'true');
});

test('in Arabic the box speaks Arabic and its text keeps its own direction', async () => {
 const screen = await box({ send: async () => null }, 'ar');
 const message = screen.getByRole('textbox', { name: 'الرسالة' });
 await expect.element(message).toHaveAttribute('dir', 'auto');
 await expect.element(screen.getByRole('button', { name: 'ابعت' })).toBeDisabled();
 await expect.element(screen.getByRole('button', { name: 'إضافات · قريبًا' })).toBeVisible();
});
