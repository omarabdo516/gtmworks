import { afterEach, expect, test, vi } from 'vitest';
import { act, createRef, type Ref } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { render } from 'vitest-browser-react';
import { cdp, page, userEvent } from 'vitest/browser';
// Gives cdp() Playwright's session type (its send), as the config's provider does at run time.
import type {} from '@vitest/browser-playwright';
import { CallableAgentsProvider, MessageBox, postMessage, type Callable, type CallableAgent, type MessageBoxHandle } from '@/app/conversation-composer';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/tokens.css';
import '@/app/shell.css';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
type Send = (text: string, sendKey: string, files: File[]) => Promise<string | null>;
const box = (props: { send: Send, stop?: { label: string, run: () => Promise<string | null> }, ref?: Ref<MessageBoxHandle>, call?: Callable, seen?: CallableAgent[] }, language: Language = 'en') =>
 render(<LanguageProvider language={language}><CallableAgentsProvider agents={props.seen ?? []}><MessageBox placeholder="Write" {...props}/></CallableAgentsProvider></LanguageProvider>);

// #154, the "@" and "/" suggestion list (design-reference: tokenAtCaret, updatePop, mentionMenu, the composer's keys).
const agents: CallableAgent[] = [{ id: 'a1', connection_id: 'c1', name: 'Lead', speciality: 'General' }, { id: 'a2', connection_id: 'c2', name: 'Reach', speciality: 'Runs Meta ads', status: 'working' }];
const list = (screen: Awaited<ReturnType<typeof box>>) => screen.getByRole('listbox', { name: 'Suggestions' });
const marked = (field: HTMLTextAreaElement) => document.getElementById(field.getAttribute('aria-activedescendant') ?? '')?.textContent;

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

// #155: images go with a message. The "+" menu's "Attach a file" opens the picker; each chosen image is a chip above
// the field with a cross that takes it off and gives the focus back; Send is on with a file and no text; and a file the
// Agent cannot read is refused with one line under the box and never becomes a chip.
const image = (name: string) => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' });
const picked = async (files: File[]) => {
 const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
 const carried = new DataTransfer();
 files.forEach(file => carried.items.add(file));
 await act(async () => { input.files = carried.files; input.dispatchEvent(new Event('change', { bubbles: true })); });
};
const menu = async (screen: Awaited<ReturnType<typeof box>>) => {
 await screen.getByRole('button', { name: /^More:/ }).click();
 return screen.getByRole('menuitem', { name: 'Attach a file' });
};

test('the "+" menu attaches a file: two images become chips, one cross takes one off, and Send is on with no text', async () => {
 const send = vi.fn<Send>(async () => null);
 const screen = await box({ send });
 const attach = await menu(screen);
 await expect.element(attach).toBeVisible();
 // The picker is the reference's one hidden input (#file-input), for image kinds only.
 const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
 expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
 expect(input.multiple).toBe(true);
 const opening = vi.spyOn(HTMLInputElement.prototype, 'click');
 await attach.click();
 expect(opening).toHaveBeenCalledTimes(1);
 opening.mockRestore();
 await picked([image('cover.png'), image('logo.png')]);
 await expect.element(screen.getByText('cover.png')).toBeVisible();
 await expect.element(screen.getByText('logo.png')).toBeVisible();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
 await expect.element(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
 await screen.getByRole('button', { name: 'Remove logo.png' }).click();
 await expect.element(screen.getByText('logo.png')).not.toBeInTheDocument();
 await expect.element(screen.getByText('cover.png')).toBeVisible();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
 await screen.getByRole('button', { name: 'Send' }).click();
 await expect.poll(() => send.mock.calls.length).toBe(1);
 expect(send.mock.calls[0][0]).toBe('');
 expect(send.mock.calls[0][2].map(file => file.name)).toEqual(['cover.png']);
 await expect.element(screen.getByText('cover.png')).not.toBeInTheDocument();
});

test('a file the Agent cannot read is refused before anything is added, and the line says why', async () => {
 const send = vi.fn<Send>(async () => null);
 const screen = await box({ send });
 await picked([new File(['a page'], 'brief.pdf', { type: 'application/pdf' })]);
 await expect.element(screen.getByRole('alert')).toHaveTextContent('The agent can’t read that kind of file yet. Attach a PNG, JPEG, GIF or WebP image.');
 await expect.element(screen.getByText('brief.pdf')).not.toBeInTheDocument();
 await expect.element(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
});

test('in Arabic the chips’ crosses are labelled in Arabic, and a refused pick speaks Arabic', async () => {
 const screen = await box({ send: async () => null }, 'ar');
 await picked([image('غلاف.png')]);
 await expect.element(screen.getByRole('button', { name: 'شيل غلاف.png' })).toBeVisible();
 await picked([new File(['a page'], 'brief.pdf', { type: 'application/pdf' })]);
 await expect.element(screen.getByRole('alert')).toHaveTextContent('الوكيل لسه مابيعرفش يقرا النوع ده من الملفات. ارفق صورة PNG أو JPEG أو GIF أو WebP.');
});

test('"@" at the start or after a space offers the Agents this Member sees, with each face, name and the line under it, and narrows with every letter', async () => {
 const screen = await box({ send: async () => null, seen: agents });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await expect.element(field).toHaveAttribute('aria-expanded', 'false');
 await expect.element(field).not.toHaveAttribute('aria-activedescendant');
 await userEvent.type(field, '@');
 await expect.element(list(screen)).toBeVisible();
 await expect.element(field).toHaveAttribute('aria-expanded', 'true');
 expect(screen.getByRole('option').elements().map(option => option.textContent)).toEqual(['LeadGeneral', 'ReachWorking · Runs Meta ads']);
 const markedOption = field.element().getAttribute('aria-activedescendant');
 expect(document.getElementById(markedOption!)?.getAttribute('aria-selected')).toBe('true');
 expect(document.getElementById(markedOption!)?.textContent).toBe('LeadGeneral');
 await userEvent.type(field, 're');
 expect(screen.getByRole('option').elements().map(option => option.textContent)).toEqual(['ReachWorking · Runs Meta ads']);
 await userEvent.type(field, ' ');
 await expect.element(list(screen)).not.toBeInTheDocument();
 await expect.element(field).toHaveAttribute('aria-expanded', 'false');
});

test('"@" inside a word opens nothing, and an Arabic name narrows the list', async () => {
 const screen = await box({ send: async () => null, seen: [...agents, { id: 'a3', connection_id: 'c3', name: 'محتوى', speciality: 'الكتابة' }] });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await userEvent.type(field, 'omar@example');
 await expect.element(list(screen)).not.toBeInTheDocument();
 await userEvent.clear(field);
 await userEvent.type(field, '@م');
 await expect.element(list(screen)).toBeVisible();
 expect(screen.getByRole('option').elements().map(option => option.textContent)).toEqual(['محتوىالكتابة']);
});

test('in a channel the list holds the other Members with their Role, a Viewer marked "reads only", before the channel\'s Agents', async () => {
 const screen = await box({ send: async () => null, call: { people: [{ id: 'p1', name: 'Sara Hassan', role: 'manager' }, { id: 'p2', name: 'Mona Ali', role: 'viewer' }], agents: [agents[1]] } });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await userEvent.type(field, '@');
 const menu = list(screen).element();
 expect([...menu.querySelectorAll('.menu__label')].map(label => label.textContent)).toEqual(['Someone on the team', 'Call an agent']);
 expect(screen.getByRole('option').elements().map(option => option.textContent)).toEqual(['SSara HassanManager@Sara', 'MMona AliViewer · reads only@Mona', 'ReachWorking · Runs Meta ads']);
});

test('"/" offers the Commands, narrowed by what follows it', async () => {
 const screen = await box({ send: async () => null, seen: agents });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await userEvent.type(field, '/a');
 await expect.element(list(screen)).toBeVisible();
 expect(screen.getByRole('option').elements().map(option => option.textContent)).toEqual(['Ask for a new agent/agent']);
 await userEvent.type(field, 'zz');
 await expect.element(list(screen)).not.toBeInTheDocument();
});

// #159, the job commands (design-reference: CMDS): each belongs to the Agent the Member sees that was made from one
// ready-made role, and its line names that Agent; a role with no such Agent has no command, and "/agent" comes last.
const roles: CallableAgent[] = [{ id: 'r1', connection_id: 'd1', name: 'Reach', role: 'meta' }, { id: 'r2', connection_id: 'd2', name: 'Figures', role: 'numbers' },
 { id: 'r3', connection_id: 'd3', name: 'Critic', role: 'hook' }, { id: 'r4', connection_id: 'd4', name: 'Writer', role: 'writer' }, { id: 'r5', connection_id: 'd5', name: 'Lead' }];
const commandsOf = (screen: Awaited<ReturnType<typeof box>>) => screen.getByRole('option').elements().map(option => option.textContent);

test('"/" offers each role\'s command with the name of the Agent it was given, then /agent, and narrows by the command', async () => {
 const screen = await box({ send: async () => null, seen: roles });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await userEvent.type(field, '/');
 await expect.element(list(screen)).toBeVisible();
 expect(commandsOf(screen)).toEqual([
  'New campaign with Reach/campaign',
  'Numbers summary from Figures/report',
  'Send a script to Critic for review/review',
  'New SEO article from Writer/article',
  'Ask for a new agent/agent',
 ]);
 await userEvent.type(field, 'r');
 expect(commandsOf(screen)).toEqual(['Numbers summary from Figures/report', 'Send a script to Critic for review/review']);
 await userEvent.keyboard('{Enter}');
 await expect.element(field).toHaveValue('/report ');
});

test('a role with no Agent this Member sees, or an Agent hidden from them, lists no command', async () => {
 // Writer and Critic are absent, as a hidden Agent never reaches the Member's list from the server.
 const screen = await box({ send: async () => null, seen: [roles[0], roles[1], roles[4]] });
 await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), '/');
 expect(commandsOf(screen)).toEqual(['New campaign with Reach/campaign', 'Numbers summary from Figures/report', 'Ask for a new agent/agent']);
});

test('in Arabic the Commands speak the reference\'s words around the Agent\'s name', async () => {
 const screen = await box({ send: async () => null, seen: [{ id: 'r1', connection_id: 'd1', name: 'محتوى', role: 'writer' }] }, 'ar');
 await userEvent.type(screen.getByRole('textbox', { name: 'الرسالة' }), '/');
 expect(commandsOf(screen)).toEqual(['مقال SEO جديد من محتوى/article', 'اطلب وكيل جديد/agent']);
});

test('Arrow Down and Up move the marked entry and wrap, Enter picks it with one space after, and Enter does not send while the list is open', async () => {
 const send = vi.fn<Send>(async () => null);
 const screen = await box({ send, seen: agents });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await userEvent.type(field, 'hello @');
 const area = field.element() as HTMLTextAreaElement;
 expect(marked(area)).toBe('LeadGeneral');
 await userEvent.keyboard('{ArrowDown}'); await expect.poll(() => marked(area)).toBe('ReachWorking · Runs Meta ads');
 await userEvent.keyboard('{ArrowDown}'); await expect.poll(() => marked(area)).toBe('LeadGeneral');
 await userEvent.keyboard('{ArrowUp}'); await expect.poll(() => marked(area)).toBe('ReachWorking · Runs Meta ads');
 await userEvent.keyboard('{Enter}');
 await expect.element(field).toHaveValue('hello @Reach ');
 expect(send).not.toHaveBeenCalled();
 await expect.element(list(screen)).not.toBeInTheDocument();
 await expect.element(field).toHaveAttribute('aria-expanded', 'false');
 await expect.element(field).toHaveFocus();
 expect([area.selectionStart, area.selectionEnd]).toEqual([13, 13]);
});

test('Tab picks the marked entry too, Escape closes the list and keeps the text', async () => {
 const screen = await box({ send: async () => null, seen: agents });
 const field = screen.getByRole('textbox', { name: 'Message' });
 await userEvent.type(field, '/a');
 await userEvent.keyboard('{Tab}');
 await expect.element(field).toHaveValue('/agent ');
 await userEvent.type(field, 'hi @Re');
 await expect.element(list(screen)).toBeVisible();
 await userEvent.keyboard('{Escape}');
 await expect.element(field).toHaveValue('/agent hi @Re');
 await expect.element(list(screen)).not.toBeInTheDocument();
 await expect.element(field).toHaveFocus();
});

test('opening the list closes the "+" menu, and opening the "+" menu closes the list', async () => {
 const screen = await box({ send: async () => null, seen: agents });
 const field = screen.getByRole('textbox', { name: 'Message' });
 const plus = screen.getByRole('button', { name: 'More: call someone, commands, attach' });
 await userEvent.type(field, '@');
 await expect.element(list(screen)).toBeVisible();
 await plus.click();
 await expect.element(list(screen)).not.toBeInTheDocument();
 await expect.element(plus).toHaveAttribute('aria-expanded', 'true');
 await expect.element(screen.getByRole('menu', { name: 'More' })).toBeVisible();
 await plus.click();
 await expect.element(plus).toHaveAttribute('aria-expanded', 'false');
 await field.click();
 await userEvent.keyboard(' @');
 await expect.element(list(screen)).toBeVisible();
 await expect.element(plus).toHaveAttribute('aria-expanded', 'false');
});

test('in Arabic the list speaks the reference\'s words', async () => {
 const screen = await box({ send: async () => null, call: { people: [{ id: 'p1', name: 'سارة حسن', role: 'viewer' }], agents: [agents[1]] } }, 'ar');
 const field = screen.getByRole('textbox', { name: 'الرسالة' });
 await userEvent.type(field, '@');
 await expect.element(screen.getByRole('listbox', { name: 'اقتراحات' })).toBeVisible();
 const menu = screen.getByRole('listbox').element();
 expect([...menu.querySelectorAll('.menu__label')].map(label => label.textContent)).toEqual(['حد من الفريق', 'نادي وكيل']);
 expect(screen.getByRole('option').elements().map(option => option.textContent)).toEqual(['سسارة حسنمشاهد · بتقرا بس@سارة', 'Reachشغال · Runs Meta ads']);
});
// #160: voice dictation. The browser records, the Engine turns one recording into text for the Agent's own profile, and
// the words go in where the caret was (design-reference: the mic press and click, Escape, the cross, 60 seconds, send,
// the waveform, the dot and clock, insertAtCaret). A fake microphone and a fake recorder stand in for the device, and the
// clock is fake, so a 400 ms hold and a 60 second recording are instant.
type DataEvent = { data?: Blob };
class FakeRecorder {
 static made: FakeRecorder[] = [];
 state = 'inactive'; mimeType: string; ondataavailable: (event: DataEvent) => void = () => {}; onstop: () => void = () => {};
 constructor(public stream: unknown, options?: { mimeType?: string }) { this.mimeType = options?.mimeType ?? 'audio/webm'; FakeRecorder.made.push(this); }
 start() { this.state = 'recording'; }
 stop() {
  if (this.state === 'inactive') return;
  this.state = 'inactive';
  this.ondataavailable({ data: new Blob(['voice sample'], { type: this.mimeType }) });
  this.onstop();
 }
}
const mic = (deny = false) => {
 FakeRecorder.made = [];
 const track = { stop: vi.fn() };
 const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
 const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(deny ? async () => { throw new Error('denied'); } : async () => stream as unknown as MediaStream);
 vi.stubGlobal('MediaRecorder', FakeRecorder);
 return { getUserMedia, track };
};
type DictationReply = { text?: string, state?: string, language?: string | null, deferred?: boolean };
const dictate = (reply: DictationReply = {}) => {
 const calls: { url: string, body: Record<string, unknown> }[] = [];
 let finish: (value: Response) => void = () => {};
 const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method !== 'POST') return Response.json(reply.language === null ? {} : { language: reply.language ?? 'en' });
  calls.push({ url, body: JSON.parse(String(init.body)) });
  if (reply.deferred) return new Promise<Response>(resolve => { finish = resolve; });
  return Response.json(reply.state ? { state: reply.state } : { text: reply.text ?? '' });
 });
 vi.stubGlobal('fetch', fetchMock);
 return { calls, finish: (value: Response) => finish(value), fetchMock };
};
const voice = { company: 'co-1', agent: 'ag-1' };
const voiced = (props: Parameters<typeof box>[0], language: Language = 'en') => render(<LanguageProvider language={language}><MessageBox placeholder="Write" voice={voice} {...props} /></LanguageProvider>);
const pointer = (element: Element, type: string) => act(async () => { element.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1 })); });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
// A hold: pressed, longer than 400 ms, then released, which finishes the recording and keeps its words.
const hold = async (element: Element) => {
 await pointer(element, 'pointerdown'); await flush();
 await act(async () => { await vi.advanceTimersByTimeAsync(500); });
 await pointer(element, 'pointerup'); await flush();
};
const field = (screen: { container: HTMLElement }) => screen.container.querySelector('textarea')!;
const boxOf = (screen: Awaited<ReturnType<typeof voiced>>) => screen.container.querySelector<HTMLButtonElement>('.composer__mic')!;

test('holding the microphone longer than 400 ms records until release and keeps the words at the caret', async () => {
 vi.useFakeTimers(); mic(); const engine = dictate({ text: 'hello from the Engine' });
 const send = vi.fn<Send>(async () => null); const screen = await voiced({ send });
 const message = screen.getByRole('textbox', { name: 'Message' });
 await userEvent.type(message, 'Plan the launch');
 const button = boxOf(screen);
 await pointer(button, 'pointerdown'); await flush();
 expect(FakeRecorder.made[0].state).toBe('recording');
 await act(async () => { await vi.advanceTimersByTimeAsync(500); });
 await expect.element(screen.getByText('Listening · English · release the button when you’re done')).toBeVisible();
 const bars = () => Array.from(screen.container.querySelectorAll<HTMLElement>('.wave__bar')).map(bar => bar.style.transform);
 expect(bars()).toHaveLength(28);
 const moving = bars();
 await act(async () => { await vi.advanceTimersByTimeAsync(140); });
 expect(bars()).not.toEqual(moving);
 await expect.element(screen.getByRole('button', { name: 'Finish recording' })).toHaveAttribute('aria-pressed', 'true');
 await expect.element(screen.getByRole('button', { name: 'Finish recording' })).toHaveAttribute('title', 'Finish recording');
 await expect.element(screen.getByRole('button', { name: 'Cancel recording' })).toBeVisible();
 expect(screen.container.querySelector('.rec-dot')).not.toBeNull();
 expect(screen.container.querySelector('.composer__rec')?.textContent).toBe('0:00');
 // The recording came from the microphone and went to the Engine as one audio data URL.
 await pointer(button, 'pointerup'); await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
 await expect.poll(() => engine.calls.length).toBe(1);
 expect(engine.calls[0].url).toBe('/api/dictation');
 expect(engine.calls[0].body).toMatchObject({ company: 'co-1', agent: 'ag-1', mimeType: 'audio/webm' });
 expect(String(engine.calls[0].body.dataUrl)).toMatch(/^data:audio\/webm;base64,/);
 await expect.element(message).toHaveValue('Plan the launch hello from the Engine');
 await expect.element(message).toHaveFocus();
 expect(send).not.toHaveBeenCalled();
});

test('a quick click starts and a second click finishes; Escape and the cross cancel and insert nothing', async () => {
 vi.useFakeTimers(); mic(); const engine = dictate({ text: 'never used' });
 const screen = await voiced({ send: async () => null }); const button = boxOf(screen);
 // A click is a short press: it records in click mode, with its own hint.
 await pointer(button, 'pointerdown'); await flush(); await pointer(button, 'pointerup'); await flush();
 await expect.element(screen.getByText('Listening · English · click again when you’re done, or Esc to cancel')).toBeVisible();
 expect(screen.container.querySelector('.rec-dot')).not.toBeNull();
 await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
 expect(screen.container.querySelector('.composer__rec')?.textContent).toBe('0:01');
 await pointer(button, 'pointerdown'); await pointer(button, 'pointerup'); await flush();
 // Escape cancels: the recording is dropped, the field comes back and nothing is sent.
 await pointer(button, 'pointerdown'); await flush();
 act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); await flush();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
 expect(engine.calls).toEqual([]);
 // The cross cancels the same way.
 await pointer(button, 'pointerdown'); await flush();
 await expect.element(screen.getByRole('button', { name: 'Cancel recording' })).toBeVisible();
 await screen.getByRole('button', { name: 'Cancel recording' }).click(); await flush();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
 expect(engine.calls).toEqual([]);
});

test('recording stops by itself at 60 seconds and keeps the words', async () => {
 vi.useFakeTimers(); mic(); const engine = dictate({ text: 'the long thought' });
 const screen = await voiced({ send: async () => null }); const button = boxOf(screen);
 await pointer(button, 'pointerdown'); await flush(); await pointer(button, 'pointerup'); await flush();
 await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
 await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
 await expect.poll(() => engine.calls.length).toBe(1);
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('the long thought');
 await expect.element(screen.getByRole('button', { name: 'Voice dictation: hold and talk, or click once to start' })).toBeVisible();
});

test('the waveform stands still with reduced motion', async () => {
 vi.useFakeTimers(); mic();
 vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
 const screen = await voiced({ send: async () => null }); const button = boxOf(screen);
 await pointer(button, 'pointerdown'); await flush();
 const bars = () => Array.from(screen.container.querySelectorAll<HTMLElement>('.wave__bar')).map(bar => bar.style.transform);
 const still = bars();
 expect(still).toHaveLength(28);
 await act(async () => { await vi.advanceTimersByTimeAsync(700); });
 expect(bars()).toEqual(still);
});

test('a finished recording writes "Writing what you said…" then puts the words in at the caret, with a space before them, and focuses the field', async () => {
 vi.useFakeTimers(); mic(); const engine = dictate({ deferred: true });
 const screen = await voiced({ send: async () => null });
 const message = screen.getByRole('textbox', { name: 'Message' });
 await userEvent.type(message, 'Plan the launch'); field(screen).setSelectionRange(4, 4);
 await hold(boxOf(screen));
 await expect.element(message).toHaveAttribute('placeholder', 'Writing what you said…');
 await act(async () => { engine.finish(Response.json({ text: 'hello world' })); await Promise.resolve(); await Promise.resolve(); });
 await expect.element(message).toHaveValue('Plan hello world the launch');
 await expect.element(message).toHaveFocus();
 expect(field(screen).selectionStart).toBe(16);
});

test('silence inserts nothing and restores the placeholder', async () => {
 vi.useFakeTimers(); mic(); dictate({ text: '   ' });
 const screen = await voiced({ send: async () => null });
 await hold(boxOf(screen));
 await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Write');
});

test('a refused microphone leaves the typed text untouched and says so under the composer', async () => {
 vi.useFakeTimers(); mic(true); dictate();
 const screen = await voiced({ send: async () => null });
 await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'still here');
 await pointer(boxOf(screen), 'pointerdown'); await flush();
 await expect.element(screen.getByRole('alert')).toHaveTextContent('The microphone could not be opened. Allow it in the browser and try again.');
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('still here');
 expect(screen.container.querySelector('.composer')?.classList.contains('is-rec')).toBe(false);
});

test('an Engine with no speech-to-text provider leaves the text untouched, says which piece is missing and quiets the microphone', async () => {
 vi.useFakeTimers(); mic(); dictate({ state: 'unavailable' });
 const screen = await voiced({ send: async () => null });
 await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'still here');
 await hold(boxOf(screen));
 await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
 await expect.element(screen.getByRole('alert')).toHaveTextContent('Voice dictation is unavailable: the Engine has no speech-to-text provider.');
 await expect.element(screen.getByRole('button', { name: 'Voice dictation is unavailable: the Engine has no speech-to-text provider.' })).toHaveAttribute('aria-disabled', 'true');
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('still here');
});

test('sending a message while recording ends the recording and sends the typed text', async () => {
 const send = vi.fn<Send>(async () => null);
 const screen = await voiced({ send });
 await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Send this now');
 vi.useFakeTimers(); mic(); dictate();
 await pointer(boxOf(screen), 'pointerdown'); await flush();
 await screen.getByRole('button', { name: 'Send' }).click(); await flush();
 await expect.poll(() => send.mock.calls.length).toBe(1);
 expect(send.mock.calls[0][0]).toBe('Send this now');
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
 await expect.element(screen.getByRole('button', { name: 'Voice dictation: hold and talk, or click once to start' })).toBeVisible();
});
