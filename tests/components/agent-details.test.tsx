import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { act, type ComponentProps } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import AgentChat from '@/app/c/[slug]/chat/[[...agent]]/agent-chat';
import NewChatKey from '@/app/new-chat-key';
import { detailsTabs } from '@/app/agent-details-tabs';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n } from '@/lib/i18n.mjs';
import '@/app/shell.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

const mona = { id: 'ag-1', connection_id: 'c-1', name: 'Mona', speciality: 'Marketing', main: true };
const tabs = { activity: <p>Nothing yet</p>, tasks: <p>No cards</p>, files: <p>No files</p>, memory: <p>No notes</p>, log: <p>No log</p> };
const panel = (screen: Awaited<ReturnType<typeof render>>) => screen.getByRole('complementary', { includeHidden: true, name: 'Details: Mona' });
const chat = (width: number) => page.viewport(width, 900).then(() => render(<div className="gw"><LanguageProvider language="en">
 <AgentChat slug="rs-learning" company="co-1" agent={mona} details={{ status: 'idle', tab: 'activity', tabs }} writer/>
</LanguageProvider></div>));

test('beside the chat the details start open, named for the Agent; the title pill hides and shows them, and Close gives the focus back to it', async () => {
 const screen = await chat(1440);
 const pill = screen.getByRole('button', { name: 'New chat · Details: Mona' });
 const details = panel(screen);
 await expect.element(details).toBeVisible();
 await expect.element(pill).toHaveAttribute('aria-expanded', 'true');
 expect(details.element().textContent).toContain('MonaMainMarketing\u00a0·\u00a0Idle');
 await expect.element(details.getByRole('link', { name: 'Settings for Mona' })).toHaveAttribute('href', '/c/rs-learning/settings?agent=ag-1');
 // Memory opens now that it shows the Agent's own notes (#350).
 await expect.element(details.getByRole('tab', { name: 'Memory', exact: true })).toHaveAttribute('aria-selected', 'false');
 await pill.click();
 await expect.element(details).not.toBeVisible();
 await expect.element(pill).toHaveAttribute('aria-expanded', 'false');
 await pill.click();
 await expect.element(details).toBeVisible();
 await details.getByRole('button', { name: 'Close details' }).click();
 await expect.element(details).not.toBeVisible();
 await expect.element(pill).toHaveFocus();
});

test('below 1024px the details start closed and open over the chat with the focus on Close; Escape closes them', async () => {
 const screen = await chat(900);
 const pill = screen.getByRole('button', { name: 'New chat · Details: Mona' });
 const details = panel(screen);
 await expect.element(details).not.toBeVisible();
 await pill.click();
 await expect.element(details).toBeVisible();
 await expect.element(details.getByRole('button', { name: 'Close details' })).toHaveFocus();
 await userEvent.keyboard('{Escape}');
 await expect.element(details).not.toBeVisible();
 await expect.element(pill).toHaveFocus();
});

test('the gear opens the Agent\'s settings as a dialog and remembers the chat and itself to return to', async () => {
 const start = location.href;
 history.replaceState(history.state, '', '/c/rs-learning/conversations/cv-1');
 try {
  sessionStorage.clear();
  const screen = await chat(1440);
  const gear = panel(screen).getByRole('link', { name: 'Settings for Mona' });
  await expect.element(gear).toHaveAttribute('aria-haspopup', 'dialog');
  gear.element().addEventListener('click', event => event.preventDefault());
  await gear.click();
  expect(JSON.parse(sessionStorage.getItem('gw-settings-from')!)).toEqual({ from: '/c/rs-learning/conversations/cv-1', focus: 'dp-settings' });
 } finally { history.replaceState(history.state, '', start); sessionStorage.clear(); }
});

for (const [width, where] of [[1440, 'beside the chat'], [900, 'below 1024px, where the panel starts closed']] as const) test(`back from the settings ${where} the gear has the focus once, with the details open`, async () => {
 sessionStorage.setItem('gw-return-focus', 'dp-settings');
 try {
  const screen = await chat(width);
  const details = panel(screen);
  await expect.element(details).toBeVisible();
  await expect.element(details.getByRole('link', { name: 'Settings for Mona' })).toHaveFocus();
  expect(sessionStorage.getItem('gw-return-focus')).toBeNull();
 } finally { sessionStorage.clear(); }
});

// A full page load: the first hydrated render reads the window as wide, as the server drew it, before the real width.
test('back from the settings on a full page load below 1024px, the details open over the chat and the gear has the focus', async () => {
 await page.viewport(900, 900);
 sessionStorage.setItem('gw-return-focus', 'dp-settings');
 const chatPage = <div className="gw"><LanguageProvider language="en"><AgentChat slug="rs-learning" company="co-1" agent={mona} details={{ status: 'idle', tab: 'activity', tabs }} writer/></LanguageProvider></div>;
 const container = document.createElement('div'); document.body.append(container);
 container.innerHTML = renderToString(chatPage);
 const root = await act(async () => hydrateRoot(container, chatPage, { onRecoverableError: () => {} }));
 try {
  await expect.poll(() => container.querySelector('#details')?.classList.contains('is-open')).toBe(true);
  await expect.poll(() => document.activeElement?.id).toBe('dp-settings');
  expect(sessionStorage.getItem('gw-return-focus')).toBeNull();
 } finally { act(() => root.unmount()); container.remove(); sessionStorage.clear(); }
});

test('another page\'s return focus is left for that page', async () => {
 sessionStorage.setItem('gw-return-focus', 'sov-ag-ag-1');
 try {
  const screen = await chat(900);
  await expect.element(panel(screen)).not.toBeVisible();
  expect(sessionStorage.getItem('gw-return-focus')).toBe('sov-ag-ag-1');
 } finally { sessionStorage.clear(); }
});

// An Agent with no run, Card, file or log row yet, drawn with the tabs the server builds.
const seo = { id: 'ag-2', connection_id: 'c-2', name: 'SEO', speciality: 'Writes the blog.', main: false };
test('the arrow keys move from the tab that has the focus, so a press that lands as the tabs change still moves on from it', async () => {
 const screen = await chat(1440);
 const details = panel(screen);
 const tab = (name: string) => details.getByRole('tab', { name, exact: true });
 await tab('Tasks').click();
 await expect.element(tab('Tasks')).toHaveAttribute('aria-selected', 'true');
 // A press has moved the focus on to Files while the panel has not drawn that change yet, so the state still says Tasks.
 await act(async () => { (tab('Files').element() as HTMLElement).focus(); });
 await userEvent.keyboard('{ArrowRight}');
 await expect.element(tab('Memory')).toHaveAttribute('aria-selected', 'true');
 await expect.element(tab('Memory')).toHaveFocus();
 await userEvent.keyboard('{ArrowLeft}');
 await expect.element(tab('Files')).toHaveAttribute('aria-selected', 'true');
 await expect.element(tab('Files')).toHaveFocus();
});

test('below 1024px "N" pressed in the details over the new chat closes them and focuses the composer', async () => {
 const start = location.href;
 history.replaceState(history.state, '', '/c/rs-learning/chat');
 try {
  const screen = await chat(900);
  await render(<NewChatKey href="/c/rs-learning/chat"/>);
  await screen.getByRole('button', { name: 'New chat · Details: Mona' }).click();
  const details = panel(screen);
  await expect.element(details.getByRole('button', { name: 'Close details' })).toHaveFocus();
  await userEvent.keyboard('n');
  await expect.element(details).not.toBeVisible();
  await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
 } finally { history.replaceState(history.state, '', start); }
});

const nothingYet = () => page.viewport(1440, 900).then(() => render(<div className="gw"><LanguageProvider language="en">
 <AgentChat slug="rs-learning" company="co-1" agent={seo} details={{ status: 'idle', tab: 'activity', tabs: detailsTabs({ t: i18n('en').t, slug: 'rs-learning', agent: seo.id, fileCount: 0, logCount: 0 }) }} writer/>
</LanguageProvider></div>));

test('the Activity tab starts with the Agent\'s screen, asleep: the engine shows none, and nothing on it can be pressed', async () => {
 const screen = await nothingYet();
 const asleep = screen.getByRole('complementary', { name: 'Details: SEO' }).getByRole('tabpanel').getByRole('region', { name: 'Agent’s screen' });
 await expect.element(asleep.getByRole('heading', { level: 3, name: 'Agent’s screen' })).toBeVisible();
 await expect.element(asleep.getByText('Nothing is running on the screen right now.')).toBeVisible();
 expect(asleep.element().querySelectorAll('button, a, [tabindex]')).toHaveLength(0);
});

test('an Agent with nothing yet shows the reference\'s empty line on every tab', async () => {
 const screen = await nothingYet();
 const details = screen.getByRole('complementary', { name: 'Details: SEO' });
 const panel = details.getByRole('tabpanel');
 expect(details.element().textContent).toContain('Writes the blog.\u00a0·\u00a0Idle');
 await expect.element(panel.getByText('Nothing done this week yet. Send it a message and it’ll start.')).toBeVisible();
 await details.getByRole('tab', { name: 'Tasks', exact: true }).click();
 await expect.element(panel.getByText('No cards on the board for this agent yet.')).toBeVisible();
 expect(panel.getByRole('heading').elements()).toHaveLength(0);
 await details.getByRole('tab', { name: 'Files', exact: true }).click();
 await expect.element(panel.getByRole('heading', { name: 'Files 0' })).toBeVisible();
 await expect.element(panel.getByText('No files yet. Files from its cards and from your chats with it show here.')).toBeVisible();
 await details.getByRole('tab', { name: 'Memory', exact: true }).click();
 await expect.element(panel.getByText('Its memory can’t be read right now.')).toBeVisible();
 await details.getByRole('tab', { name: 'Log', exact: true }).click();
 await expect.element(panel.getByRole('heading', { name: /^Log 0/ })).toBeVisible();
 await expect.element(panel.getByText('Nothing in this agent’s log yet.')).toBeVisible();
 await expect.element(panel.getByText('Nothing in the log is ever deleted, not even by an Administrator.')).toBeVisible();
});
