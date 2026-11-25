import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { SidebarSearchProvider, SearchToggle, SearchBox } from '@/app/sidebar-search';
import RecentChats from '@/app/recent-chats';
import { LanguageProvider } from '@/lib/i18n-client';

vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/app/conversation-archive-actions', () => ({ archiveConversations: vi.fn() }));

const now = new Date().toISOString();
const chats = [{ id: 'cv-1', title: 'Search check for June', at: now }, { id: 'cv-2', title: 'Weekly report', at: now }];

test('the magnifier opens a focused field that narrows the recent chats by title; Escape empties it, then closes it', async () => {
 const screen = await render(<LanguageProvider language="en"><SidebarSearchProvider>
  <SearchToggle/><SearchBox/><RecentChats person="p-1" slug="rs-learning" company="10000000-0000-0000-0000-000000000001" chats={chats} lead="Lead"/>
 </SidebarSearchProvider></LanguageProvider>);
 const toggle = screen.getByRole('button', { name: 'Search chats' });
 await expect.element(screen.getByRole('link')).toHaveLength(2);
 await toggle.click();
 const field = screen.getByRole('searchbox', { name: 'Search chats' });
 await expect.element(field).toHaveFocus();
 await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');
 await userEvent.fill(field, 'no chat is called this');
 await expect.element(screen.getByRole('link')).not.toBeInTheDocument();
 await expect.element(screen.getByText('No chats match “no chat is called this”')).toBeVisible();
 await userEvent.fill(field, 'SEARCH CHECK');
 expect(screen.getByRole('link').elements().map(link => link.getAttribute('href'))).toEqual(['/c/rs-learning/conversations/cv-1']);
 await userEvent.keyboard('{Escape}');
 await expect.element(field).toHaveValue('');
 await expect.element(screen.getByRole('link')).toHaveLength(2);
 await userEvent.keyboard('{Escape}');
 await expect.element(field).not.toBeInTheDocument();
 await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
 await expect.element(toggle).toHaveFocus();
});
