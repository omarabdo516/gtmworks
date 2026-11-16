import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import AgentChat from '@/app/c/[slug]/chat/[[...agent]]/agent-chat';
import NewChatKey from '@/app/new-chat-key';
import { detailsTabs } from '@/app/agent-details-tabs';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n } from '@/lib/i18n.mjs';
import '@/app/shell.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

const mona = { id: 'ag-1', connection_id: 'c-1', name: 'Mona', speciality: 'Marketing', main: true };
const tabs = { activity: <p>Nothing yet</p>, tasks: <p>No cards</p>, files: <p>No files</p>, log: <p>No log</p> };
const panel = (screen: Awaited<ReturnType<typeof render>>) => screen.getByRole('complementary', { includeHidden: true, name: 'Details: Mona' });
const chat = (width: number) => page.viewport(width, 900).then(() => render(<div className="gw"><LanguageProvider language="en">
 <AgentChat slug="rs-learning" company="co-1" agent={mona} details={{ status: 'idle', actions: true, tab: 'activity', tabs }} writer/>
</LanguageProvider></div>));

test('beside the chat the details start open, named for the Agent; the title pill hides and shows them, and Close gives the focus back to it', async () => {
 const screen = await chat(1440);
 const pill = screen.getByRole('button', { name: 'New chat · Details: Mona' });
 const details = panel(screen);
 await expect.element(details).toBeVisible();
 await expect.element(pill).toHaveAttribute('aria-expanded', 'true');
 expect(details.element().textContent).toContain('MonaMainMarketing\u00a0·\u00a0Idle');
 await expect.element(details.getByRole('link', { name: 'Settings for Mona' })).toHaveAttribute('href', '/c/rs-learning/agents');
 await expect.element(details.getByRole('tab', { name: 'Memory · Soon' })).toHaveAttribute('aria-disabled', 'true');
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

// An Agent with no run, Card, file or log row yet, drawn with the tabs the server builds.
const seo = { id: 'ag-2', connection_id: 'c-2', name: 'SEO', speciality: 'Writes the blog.', main: false };
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
 <AgentChat slug="rs-learning" company="co-1" agent={seo} details={{ status: 'idle', actions: true, tab: 'activity', tabs: detailsTabs({ t: i18n('en').t, slug: 'rs-learning', agent: seo.id, fileCount: 0, logCount: 0 }) }} writer/>
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
 await details.getByRole('tab', { name: 'Log', exact: true }).click();
 await expect.element(panel.getByRole('heading', { name: /^Log 0/ })).toBeVisible();
 await expect.element(panel.getByText('Nothing in this agent’s log yet.')).toBeVisible();
 await expect.element(panel.getByText('Nothing in the log is ever deleted, not even by the Owner.')).toBeVisible();
});
