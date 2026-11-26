import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { Frame, PageFrame } from '@/app/frame';
import NewChatKey from '@/app/new-chat-key';
import { MessageBox } from '@/app/conversation-composer';
import { LanguageProvider } from '@/lib/i18n-client';
// The composer's settings link is the app's Link, which needs Next's router; a plain link stands in.
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

const push = vi.hoisted(() => vi.fn());
const address = vi.hoisted(() => ({ pathname: '/c/rs-learning/work/board', search: '' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => address.pathname, useSearchParams: () => new URLSearchParams(address.search) }));
// The test page's own address, put back after a test that stands on the new chat.
const start = location.href;
afterEach(() => { push.mockReset(); address.pathname = '/c/rs-learning/work/board'; address.search = ''; history.replaceState(history.state, '', start); });

const chat = '/c/rs-learning/chat';
// The "N" key by its place: on an Arabic layout it types «ى».
const pressN = (target: Element = document.body, held: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN', key: 'ى', bubbles: true, cancelable: true, ...held }));
const composer = () => <LanguageProvider language="en"><MessageBox placeholder="Write" send={async () => null}/></LanguageProvider>;

test('"N" on an Arabic layout opens the new chat, whose composer takes the focus', async () => {
 await render(<NewChatKey href={chat}/>);
 pressN();
 expect(push.mock.calls).toEqual([[chat]]);
 address.pathname = chat;
 const screen = await render(composer());
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
});

test('on Lead\'s chat opened for a new Agent (?new=agent), "N" leaves the focus for the plain new chat\'s composer', async () => {
 history.replaceState(history.state, '', `${chat}?new=agent`);
 address.pathname = chat; address.search = 'new=agent';
 const screen = await render(<><NewChatKey href={chat}/><LanguageProvider language="en"><MessageBox key="agent" placeholder="Write" send={async () => null}/></LanguageProvider></>);
 pressN();
 expect(push.mock.calls).toEqual([[chat]]);
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).not.toHaveFocus();
 address.search = '';
 await screen.rerender(<><NewChatKey href={chat}/><LanguageProvider language="en"><MessageBox key="plain" placeholder="Write" send={async () => null}/></LanguageProvider></>);
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
});

test('already on the new chat, "N" focuses its composer and opens nothing', async () => {
 history.replaceState(history.state, '', chat);
 address.pathname = chat;
 const screen = await render(<><NewChatKey href={chat}/>{composer()}</>);
 pressN();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
 expect(push).not.toHaveBeenCalled();
});

test('on a phone, "N" pressed in the open drawer on the new chat closes the drawer and focuses the composer', async () => {
 history.replaceState(history.state, '', chat);
 address.pathname = chat;
 await page.viewport(390, 900);
 const screen = await render(<LanguageProvider language="en"><Frame sidebar={<nav aria-label="Navigation"><NewChatKey href={chat}/><a href="#board">Marketing board</a></nav>}><PageFrame title="Chats">{composer()}</PageFrame></Frame></LanguageProvider>);
 const menu = screen.getByRole('button', { name: 'Open menu' });
 await menu.click();
 await expect.element(screen.getByRole('link', { name: 'Marketing board' })).toHaveFocus();
 pressN(document.activeElement!);
 await expect.element(menu).toHaveAttribute('aria-expanded', 'false');
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
 expect(push).not.toHaveBeenCalled();
 await page.viewport(1440, 900);
});

for (const [field, element] of [['a field', <input key="f" aria-label="field"/>], ['a text area', <textarea key="f" aria-label="field"/>], ['a select', <select key="f" aria-label="field"><option>One</option></select>]] as const) test(`"N" typed in ${field} does nothing`, async () => {
 const screen = await render(<><NewChatKey href={chat}/>{element}</>);
 pressN(screen.getByLabelText('field').element());
 expect(push).not.toHaveBeenCalled();
});

for (const held of ['ctrlKey', 'altKey', 'metaKey'] as const) test(`"N" with ${held.replace('Key', '')} held does nothing`, async () => {
 await render(<NewChatKey href={chat}/>);
 pressN(document.body, { [held]: true });
 expect(push).not.toHaveBeenCalled();
});

for (const [layer, element] of [
 ['a sheet', <dialog key="l" open aria-label="Card"/>],
 ['the settings overlay', <div key="l" role="dialog" aria-modal="true" aria-label="Settings"/>],
 ['a dialog', <div key="l" role="dialog" aria-label="New channel"/>],
] as const) test(`"N" does nothing while ${layer} is open`, async () => {
 await render(<><NewChatKey href={chat}/>{element}</>);
 pressN();
 expect(push).not.toHaveBeenCalled();
});
