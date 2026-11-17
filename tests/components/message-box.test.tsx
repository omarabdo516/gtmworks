import { afterEach, expect, test, vi } from 'vitest';
import { act, createRef, type Ref } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { render } from 'vitest-browser-react';
import { cdp, page, userEvent } from 'vitest/browser';
// Gives cdp() Playwright's session type (its send), as the config's provider does at run time.
import type {} from '@vitest/browser-playwright';
import { MessageBox, postMessage, type MessageBoxHandle } from '@/app/conversation-composer';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/tokens.css';
import '@/app/shell.css';

afterEach(() => { vi.unstubAllGlobals(); });
type Send = (text: string, sendKey: string) => Promise<string | null>;
const box = (props: { send: Send, stop?: { label: string, run: () => Promise<string | null> }, ref?: Ref<MessageBoxHandle> }, language: Language = 'en') =>
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

test('a sentence put in the box shows there, focused; dictation says Soon', async () => {
 const handle = createRef<MessageBoxHandle>();
 const screen = await box({ send: async () => null, ref: handle });
 await act(() => handle.current?.insert('Make an Agent'));
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Make an Agent');
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
 await expect.element(screen.getByRole('button', { name: 'Voice dictation · Soon' })).toHaveAttribute('aria-disabled', 'true');
});

test('in Arabic the box speaks Arabic and its text keeps its own direction', async () => {
 const screen = await box({ send: async () => null }, 'ar');
 const message = screen.getByRole('textbox', { name: 'الرسالة' });
 await expect.element(message).toHaveAttribute('dir', 'auto');
 await expect.element(screen.getByRole('button', { name: 'ابعت' })).toBeDisabled();
 await expect.element(screen.getByRole('button', { name: 'إملاء بالصوت · قريبًا' })).toBeVisible();
});

test('text typed into the server-drawn box before the page hydrates is kept, and Send sends it', async () => {
 const send = vi.fn<Send>(async () => null);
 const page = <LanguageProvider language="en"><MessageBox placeholder="Write" send={send}/></LanguageProvider>;
 const host = document.body.appendChild(document.createElement('div'));
 host.innerHTML = renderToString(page);
 host.querySelector('textarea')!.value = 'typed early';
 const root = await act(async () => hydrateRoot(host, page));
 try {
  const sendButton = host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
  await expect.poll(() => sendButton.disabled).toBe(false);
  expect(host.querySelector('textarea')!.value).toBe('typed early');
  await act(async () => sendButton.click());
  await expect.poll(() => send.mock.calls.length).toBe(1);
  expect(send.mock.calls[0][0]).toBe('typed early');
 } finally { act(() => root.unmount()); host.remove(); }
});

test('when the server cannot reach the agent engine the box keeps the text and says the message was not sent', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'conversationHermesFailed' }, { status: 502 })));
 const screen = await box({ send: (message, sendKey) => postMessage({ company: 'co-1', conversation: 'cv-1', message, sendKey }) });
 await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Are you there?');
 await screen.getByRole('button', { name: 'Send' }).click();
 await expect.element(screen.getByRole('alert')).toHaveTextContent('The agent engine could not be reached. Your message was not sent; it is still in the box.');
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Are you there?');
});

test('on a phone the send arrow is the reference\'s 28px circle, and a tap anywhere in the 44px square around it lands on it', async () => {
 await page.viewport(390, 900);
 const screen = await render(<div className="gw"><div className="composer-area"><LanguageProvider language="en"><MessageBox placeholder="Write" send={async () => null}/></LanguageProvider></div></div>);
 const arrow = screen.getByRole('button', { name: 'Send' }).element();
 const circle = arrow.getBoundingClientRect();
 expect([circle.width, circle.height]).toEqual([28, 28]);
 const [x, y] = [circle.left + circle.width / 2, circle.top + circle.height / 2];
 const misses = [[-21, -21], [0, -21], [21, -21], [-21, 0], [21, 0], [-21, 21], [0, 21], [21, 21]].filter(([dx, dy]) => !document.elementFromPoint(x + dx, y + dy)?.closest('button')?.isSameNode(arrow));
 expect(misses, 'taps inside the 44px square that miss the send arrow').toEqual([]);
});

// The button's transform while a person holds it down: the mouse pressed at its centre, its transitions run to their end.
const held = async (button: Element) => {
 const box = button.getBoundingClientRect();
 const at = { x: box.left + box.width / 2, y: box.top + box.height / 2, button: 'left', clickCount: 1 } as const;
 await cdp().send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
 try {
  button.getAnimations().forEach(animation => animation.finish());
  return getComputedStyle(button).transform;
 } finally { await cdp().send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at }); }
};
const fades = 'background-color 0.15s cubic-bezier(0.2, 0, 0, 1), transform 0.15s cubic-bezier(0.2, 0, 0, 1)';
const gwBox = (props: Parameters<typeof box>[0]) => render(<div className="gw"><div className="composer-area"><LanguageProvider language="en"><MessageBox placeholder="Write" {...props}/></LanguageProvider></div></div>);

test('the send arrow fades its colour and size over 150ms and gives to 94% while held, but not while the box is empty', async () => {
 const screen = await gwBox({ send: vi.fn<Send>(async () => null) });
 const arrow = screen.getByRole('button', { name: 'Send' });
 expect(getComputedStyle(arrow.element()).transition).toBe(fades);
 expect(await held(arrow.element())).toBe('none');
 await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'hello');
 await expect.element(arrow).toBeEnabled();
 expect(getComputedStyle(arrow.element()).transition).toBe(fades);
 expect(await held(arrow.element())).toBe('matrix(0.94, 0, 0, 0.94, 0, 0)');
});

test('the stop square fades and gives to 94% while held, as the send arrow does', async () => {
 const screen = await gwBox({ send: async () => null, stop: { label: 'Stop', run: vi.fn(async () => null) } });
 const stop = screen.getByRole('button', { name: 'Stop' }).element();
 expect(getComputedStyle(stop).transition).toBe(fades);
 expect(await held(stop)).toBe('matrix(0.94, 0, 0, 0.94, 0, 0)');
});
