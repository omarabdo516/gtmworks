import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { AgentMemory, type AgentMemoryProps } from '@/app/agent-memory';
import { ToastHost } from '@/app/toast';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/shell.css';

// The Memory tab (#350; design-reference: memoryHTML): one Agent's notes from its own Engine profile, or the empty
// state, the main Agent's line (#121), and the Owner's Reset, which asks before it sends anything. An Owner and a
// Manager edit a note in place and the Owner forgets one with Undo (#191); no "Add" is drawn for anyone, and searching
// is #192.
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
const responder=(body:unknown,status=200)=>vi.fn(async (url:string,init:RequestInit)=>{ void url; void init; return new Response(JSON.stringify(body),{status}); });
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); refresh.mockClear(); });

const notes = [
 { id: 'memory:memory:0:4d2c1b0a9f8e', text: 'Prefers short subject lines.' },
 { id: 'memory:profile:1:7a1b2c3d4e5f', text: 'Omar works in Cairo.' },
];
const drawn = (props: Partial<AgentMemoryProps> = {}, language: 'en' | 'ar' = 'en') => render(<LanguageProvider language={language}>
 <div className="gw"><div className="details is-open" dir={language === 'ar' ? 'rtl' : 'ltr'}>
  <div className="dp-sections"><AgentMemory company="co-1" agent={{ id: 'ag-1', name: 'Ads' }} notes={notes} main={false} canReset={false} canEdit={false} canForget={false} {...props}/></div>
 </div></div>
 <ToastHost/>
</LanguageProvider>);

test('an Agent with notes shows each note as its own row, under the heading with their count', async () => {
 const screen = await drawn();
 await expect.element(screen.getByRole('heading', { name: 'What Ads remembers 2' })).toBeVisible();
 const rows = [...screen.container.querySelectorAll('.panel-card .mem-note')];
 expect(rows.map(row => [row.getAttribute('data-mem-row'), row.textContent])).toEqual([
  ['memory:memory:0:4d2c1b0a9f8e', 'Prefers short subject lines.'],
  ['memory:profile:1:7a1b2c3d4e5f', 'Omar works in Cairo.'],
 ]);
 // Neither the Add form of the reference nor its search: those are #191 and #192.
 expect(screen.container.querySelector('#mem-new, #mem-q')).toBeNull();
 expect(screen.container.querySelectorAll('button')).toHaveLength(0);
});

test('an Agent with no notes shows the empty state, naming the Agent', async () => {
 const screen = await drawn({ notes: [] });
 await expect.element(screen.getByRole('heading', { name: 'What Ads remembers 0' })).toBeVisible();
 await expect.element(screen.getByText('Nothing yet. What Ads learns from its work shows here.')).toBeVisible();
 expect(screen.container.querySelectorAll('.mem-note')).toHaveLength(0);
});

test('the main Agent says its memory still holds what the company’s agents remembered before each got a profile (#121)', async () => {
 const screen = await drawn({ main: true });
 await expect.element(screen.getByText('This is the main agent. Its memory also holds what the company’s agents remembered before each agent got its own profile.')).toBeVisible();
 const other = await drawn({ main: false });
 expect(other.container.textContent).not.toContain('This is the main agent.');
});

test('only the Owner is offered Reset memory, and it asks first: Cancel sends nothing', async () => {
 const send = responder({ reset: true });
 vi.stubGlobal('fetch', send);
 const reader = await drawn();
 expect(reader.container.textContent).not.toContain('Reset memory');
 const screen = await drawn({ canReset: true });
 const reset = screen.getByRole('button', { name: 'Reset memory' });
 await reset.click();
 await expect.element(screen.getByText('Reset the memory of Ads? Its notes are deleted and can’t be brought back.')).toBeVisible();
 await screen.getByRole('button', { name: 'Cancel' }).click();
 expect(send).not.toHaveBeenCalled();
 await expect.element(screen.getByRole('button', { name: 'Reset memory' })).toHaveFocus();
});

test('the Owner confirms, the route is asked once with the Company and the Agent, and the page is drawn again', async () => {
 const send = responder({ reset: true });
 vi.stubGlobal('fetch', send);
 const screen = await drawn({ canReset: true });
 await screen.getByRole('button', { name: 'Reset memory' }).click();
 await screen.getByRole('button', { name: 'Reset memory' }).click();
 await expect.poll(() => send.mock.calls.length).toBe(1);
 const [url, init] = send.mock.calls[0];
 expect([url, init.method, String(init.body)]).toEqual(['/api/agent-memory', 'POST', JSON.stringify({ company: 'co-1', agent: 'ag-1' })]);
 await expect.poll(() => refresh.mock.calls.length).toBe(1);
});

test('a reset the server refuses says so and keeps the notes on the page', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'agentMemoryNotAllowed' }), { status: 403 })));
 const screen = await drawn({ canReset: true });
 await screen.getByRole('button', { name: 'Reset memory' }).click();
 await screen.getByRole('button', { name: 'Reset memory' }).click();
 await expect.element(screen.getByRole('alert')).toHaveTextContent('The memory wasn’t reset. Try again.');
 expect(screen.container.querySelectorAll('.mem-note')).toHaveLength(2);
 expect(refresh).not.toHaveBeenCalled();
});

test('in Arabic the tab reads as the reference words it', async () => {
 const screen = await drawn({ canReset: true }, 'ar');
 await expect.element(screen.getByRole('heading', { name: /^اللي Ads فاكره 2/ })).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'امسح الذاكرة' })).toBeVisible();
 await expect.element(screen.getByText('Prefers short subject lines.')).toBeVisible();
 await userEvent.click(screen.getByRole('button', { name: 'امسح الذاكرة' }));
 await expect.element(screen.getByText('تمسح ذاكرة Ads؟ الملاحظات هتتمسح ومش هترجع تاني.')).toBeVisible();
});

// #191: an Owner and a Manager edit a note in place; the Owner alone forgets one, with Undo. No "Add" is drawn for
// anyone, because the Engine has no route that adds one.
test('an Owner and a Manager are offered Edit, only the Owner Forget this, and no one is offered Add', async () => {
 const reader = await drawn();
 expect(reader.container.textContent).not.toContain('Edit');
 expect(reader.container.textContent).not.toContain('Forget this');
 const manager = await drawn({ canEdit: true });
 expect(manager.container.querySelectorAll('[aria-label^="Edit:"]')).toHaveLength(2);
 expect(manager.container.querySelectorAll('[aria-label^="Forget this:"]')).toHaveLength(0);
 const owner = await drawn({ canEdit: true, canForget: true });
 expect(owner.container.querySelectorAll('[aria-label^="Edit:"]')).toHaveLength(2);
 expect(owner.container.querySelectorAll('[aria-label^="Forget this:"]')).toHaveLength(2);
 for (const screen of [manager, owner]) expect(screen.container.textContent).not.toContain('Add');
});

test('Edit opens a field with the cursor at its end; an empty note says so and sends nothing; Cancel restores it', async () => {
 const send = vi.fn(async () => new Response(JSON.stringify({ edited: true }), { status: 200 }));
 vi.stubGlobal('fetch', send);
 const screen = await drawn({ canEdit: true });
 await screen.getByRole('button', { name: /^Edit: Prefers short/ }).click();
 const field = screen.getByRole('textbox', { name: 'Edit note' });
 await expect.element(field).toHaveFocus();
 expect((field.element() as HTMLTextAreaElement).selectionStart).toBe('Prefers short subject lines.'.length);
 await userEvent.fill(field, '   ');
 await screen.getByRole('button', { name: 'Save' }).click();
 await expect.element(screen.getByText('A note can’t be empty. If you don’t need it, press “Forget this”.')).toBeVisible();
 expect(send).not.toHaveBeenCalled();
 await screen.getByRole('button', { name: 'Cancel' }).click();
 await expect.element(screen.getByRole('button', { name: /^Edit: Prefers short/ })).toHaveFocus();
 expect(screen.container.querySelectorAll('.mem-note__t')[0].textContent).toBe('Prefers short subject lines.');
});

test('Save rewrites the note by its Engine id, shows "Note updated", and gives the focus back to Edit', async () => {
 const send = responder({ edited: true });
 vi.stubGlobal('fetch', send);
 const screen = await drawn({ canEdit: true });
 await screen.getByRole('button', { name: /^Edit: Omar works/ }).click();
 await userEvent.fill(screen.getByRole('textbox', { name: 'Edit note' }), 'Omar works in Cairo, Egypt.');
 await screen.getByRole('button', { name: 'Save' }).click();
 await expect.poll(() => send.mock.calls.length).toBe(1);
 const [url, init] = send.mock.calls[0];
 expect([url, init.method, String(init.body)]).toEqual(['/api/agent-memory', 'PUT', JSON.stringify({ company: 'co-1', agent: 'ag-1', note: 'memory:profile:1:7a1b2c3d4e5f', text: 'Omar works in Cairo, Egypt.' })]);
 await expect.element(screen.getByRole('status')).toHaveTextContent('Note updated');
 await expect.element(screen.getByRole('button', { name: /^Edit: Omar works/ })).toHaveFocus();
 await expect.poll(() => refresh.mock.calls.length).toBe(1);
});

test('a note the Engine refuses as too long shows one line saying so, and stays in the editor', async () => {
 vi.stubGlobal('fetch', responder({ error: 'agentMemoryRefused' }, 400));
 const screen = await drawn({ canEdit: true });
 await screen.getByRole('button', { name: /^Edit: Prefers short/ }).click();
 await userEvent.fill(screen.getByRole('textbox', { name: 'Edit note' }), 'x'.repeat(3000));
 await screen.getByRole('button', { name: 'Save' }).click();
 await expect.element(screen.getByText('That note is too long for the memory. Make it shorter.')).toBeVisible();
 await expect.element(screen.getByRole('textbox', { name: 'Edit note' })).toHaveFocus();
 expect(refresh).not.toHaveBeenCalled();
});

test('Forget this hides the note at once, gives the focus to the next Forget this, and removes it when the toast ends', async () => {
 const send = responder({ forgotten: true });
 vi.stubGlobal('fetch', send);
 const screen = await drawn({ canEdit: true, canForget: true });
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 await screen.getByRole('button', { name: /^Forget this: Prefers short/ }).click();
 expect([...screen.container.querySelectorAll('.mem-note__t')].map(node => node.textContent)).toEqual(['Omar works in Cairo.']);
 expect(screen.container.querySelector('.dp-label .num')?.textContent).toBe('1');
 await expect.poll(() => document.querySelector('.toast')?.textContent).toContain('Ads forgot this note');
 expect(document.querySelector('.toast__act')?.textContent).toBe('Undo');
 await expect.element(screen.getByRole('button', { name: /^Forget this: Omar works/ })).toHaveFocus();
 expect(send).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(5999);
 expect(send).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);
 await expect.poll(() => send.mock.calls.length).toBe(1);
 const [url, init] = send.mock.calls[0];
 expect([url, init.method, String(init.body)]).toEqual(['/api/agent-memory', 'DELETE', JSON.stringify({ company: 'co-1', agent: 'ag-1', note: 'memory:memory:0:4d2c1b0a9f8e' })]);
 await expect.poll(() => refresh.mock.calls.length).toBe(1);
});

test('Undo puts the note back in its place with "Note restored", and nothing is removed from the Engine', async () => {
 const send = responder({ forgotten: true });
 vi.stubGlobal('fetch', send);
 const screen = await drawn({ canEdit: true, canForget: true });
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 await screen.getByRole('button', { name: /^Forget this: Prefers short/ }).click();
 (document.querySelector('.toast__act') as HTMLButtonElement).click();
 await expect.poll(() => document.querySelector('.toast')?.textContent).toContain('Note restored');
 expect([...screen.container.querySelectorAll('.mem-note__t')].map(node => node.textContent)).toEqual(['Prefers short subject lines.', 'Omar works in Cairo.']);
 await expect.element(screen.getByRole('button', { name: /^Forget this: Prefers short/ })).toHaveFocus();
 await vi.advanceTimersByTimeAsync(10000);
 expect(send).not.toHaveBeenCalled();
});

test('leaving the page removes a note whose toast never ended', async () => {
 const send = responder({ forgotten: true });
 vi.stubGlobal('fetch', send);
 const screen = await drawn({ canForget: true });
 await screen.getByRole('button', { name: /^Forget this: Prefers short/ }).click();
 expect(send).not.toHaveBeenCalled();
 window.dispatchEvent(new Event('pagehide'));
 await expect.poll(() => send.mock.calls.length).toBe(1);
 expect(send.mock.calls[0][1].keepalive).toBe(true);
});

test('in Arabic the note actions read as the reference words them', async () => {
 const screen = await drawn({ canEdit: true, canForget: true }, 'ar');
 await expect.element(screen.getByRole('button', { name: /^عدّل: Prefers/ })).toBeVisible();
 await expect.element(screen.getByRole('button', { name: /^انسى ده: Prefers/ })).toBeVisible();
 await screen.getByRole('button', { name: /^انسى ده: Prefers/ }).click();
 await expect.poll(() => document.querySelector('.toast')?.textContent).toContain('Ads نسي الملاحظة دي');
 expect(document.querySelector('.toast__act')?.textContent).toBe('رجّعها');
});
