import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import AgentChat from '@/app/c/[slug]/chat/[[...agent]]/agent-chat';
import { LanguageProvider } from '@/lib/i18n-client';
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
