import { expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import RecentChats from '@/app/recent-chats';
import { LanguageProvider } from '@/lib/i18n-client';
import { SidebarSearchProvider } from '@/app/sidebar-search';
import '@/app/globals.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/c/rs/home', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('@/app/conversation-archive', () => ({ useConversationArchive: () => ({ archive: vi.fn(), confirm: null }) }));
vi.mock('@/app/conversation-rename', () => ({ useConversationRename: () => ({ rename: vi.fn(), dialog: null }) }));

const drawn = (company: string, chats: { id: string, title: string, at: string }[] | null, person = 'p-1') => <LanguageProvider language="en"><SidebarSearchProvider>
 <RecentChats person={person} slug="rs" company={company} chats={chats} lead="Lead"/>
</SidebarSearchProvider></LanguageProvider>;

// #776: a page whose read of the Conversations failed keeps the ones the sidebar showed; a Company never shown, or another reader, gets no list and a line that says so.
test('a failed read of the chats keeps the ones shown last for that Company', async () => {
 const first = await render(drawn('co-1', [{ id: 'c-1', title: 'Plan the launch week', at: new Date().toISOString() }]));
 await expect.element(first.getByText('Plan the launch week')).toBeVisible();
 first.unmount();
 const next = await render(drawn('co-1', null));
 await expect.element(next.getByText('Plan the launch week')).toBeVisible();
 next.unmount();
 // Another account signed in from another tab: this reader's list is never theirs.
 const someoneElse = await render(drawn('co-1', null, 'p-2'));
 await expect.element(someoneElse.getByText('Your chats couldn’t be read just now.')).toBeVisible();
 expect(someoneElse.container.textContent).not.toContain('Plan the launch week');
 someoneElse.unmount();
 const other = await render(drawn('co-2', null));
 await expect.element(other.getByText('Your chats couldn’t be read just now.')).toBeVisible();
});
