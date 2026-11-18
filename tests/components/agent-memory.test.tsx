import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { AgentMemory, type AgentMemoryProps } from '@/app/agent-memory';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/shell.css';

// The Memory tab (#350; design-reference: memoryHTML): one Agent's notes from its own Engine profile, or the empty
// state, the main Agent's line (#121), and the Owner's Reset, which asks before it sends anything. Editing, forgetting
// and searching are later tickets (#191, #192) and are absent here.
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });

const notes = [
 { id: 'memory:memory:0:4d2c1b0a9f8e', text: 'Prefers short subject lines.' },
 { id: 'memory:profile:1:7a1b2c3d4e5f', text: 'Omar works in Cairo.' },
];
const drawn = (props: Partial<AgentMemoryProps> = {}, language: 'en' | 'ar' = 'en') => render(<LanguageProvider language={language}>
 <div className="gw"><div className="details is-open" dir={language === 'ar' ? 'rtl' : 'ltr'}>
  <div className="dp-sections"><AgentMemory company="co-1" agent={{ id: 'ag-1', name: 'Ads' }} notes={notes} main={false} canReset={false} {...props}/></div>
 </div></div>
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
 const send = vi.fn(async () => new Response(JSON.stringify({ reset: true }), { status: 200 }));
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
 const send = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ reset: true }), { status: 200 }));
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
