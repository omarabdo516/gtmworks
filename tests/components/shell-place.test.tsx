import { expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { PageMarks, ShellPlace, placeOf, useShellPlace } from '@/app/shell-place';
import { SidebarEntry } from '@/app/sidebar-entry';

// The segments the Company's layout has below it, as the app's router gives them (useSelectedLayoutSegments).
const route = vi.hoisted(() => ({ segments: [] as string[] }));
vi.mock('next/navigation', () => ({ useSelectedLayoutSegments: () => route.segments, usePathname: () => `/c/rs-learning/${route.segments.join('/')}` }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

// #789: the Shell is drawn once by the Company's layout, so which page is open comes from the segments under it.
test('a page\'s place is read from its segments, an optional catch-all whole or in parts', () => {
 expect(placeOf([])).toEqual({ section: 'home' });
 expect(placeOf(['work/board'])).toEqual({ section: 'work/board' });
 expect(placeOf(['work', 'board', '12'])).toEqual({ section: 'work/board' });
 expect(placeOf(['work/board/12'])).toEqual({ section: 'work/board' });
 expect(placeOf(['approvals'])).toEqual({ section: 'approvals' });
 expect(placeOf(['settings/members'])).toEqual({ section: 'settings/members' });
 expect(placeOf(['chat'])).toEqual({ section: 'chat', agent: undefined });
 expect(placeOf(['chat', 'a1'])).toEqual({ section: 'chat', agent: 'a1' });
 expect(placeOf(['conversations'])).toEqual({ section: 'all-conversations' });
 expect(placeOf(['conversations', 'c1'])).toEqual({ section: 'conversations', conversation: 'c1' });
 expect(placeOf(['channels', 'h1'])).toEqual({ section: 'channels', channel: 'h1' });
 expect(placeOf(['log', '__PAGE__?{"who":"s"}'])).toEqual({ section: 'log' });
 expect(placeOf(['__DEFAULT__'])).toEqual({ section: 'settings' });
});

function Marked() {
 const place = useShellPlace();
 return <p data-testid="place">{JSON.stringify(place)}</p>;
}
const shell = (marks?: ComponentProps<typeof PageMarks>) => <ShellPlace lead="lead" chatAgents={{ c1: 'ads' }}>
 <nav>{[['chat', 'Chats'], ['work/board', 'Marketing board'], ['numbers', 'Numbers'], ['log', 'Activity log']].map(([entry, name]) => <SidebarEntry key={entry} href={`/c/rs-learning/${entry}`} entry={entry}>{name}</SidebarEntry>)}</nav>
 {marks && <PageMarks {...marks}/>}<Marked/>
</ShellPlace>;
const current = () => [...document.querySelectorAll('[aria-current="page"]')].map(link => link.textContent);
const place = () => JSON.parse(document.querySelector('[data-testid="place"]')!.textContent!);

test('the sidebar marks the page shown, the Agent of its chat or Conversation, and what the page names of itself', async () => {
 route.segments = ['work', 'list'];
 const screen = await render(shell());
 expect(current()).toEqual(['Marketing board']);
 route.segments = ['numbers'];
 await screen.rerender(shell());
 expect(current()).toEqual(['Numbers']);
 // Lead's chat at /chat, and a listed Conversation's Agent, are known before the page says so.
 route.segments = ['chat'];
 await screen.rerender(shell());
 expect(current()).toEqual(['Chats']);
 expect(place()).toMatchObject({ section: 'chat', chat: true, agent: 'lead' });
 route.segments = ['conversations', 'c1'];
 await screen.rerender(shell());
 expect(place()).toMatchObject({ conversation: 'c1', agent: 'ads' });
 // A Conversation the sidebar does not list names its Agent, and the board the Card it opens.
 route.segments = ['conversations', 'c2'];
 await screen.rerender(shell({ agent: 'writer' }));
 await expect.poll(place).toMatchObject({ conversation: 'c2', agent: 'writer', chat: true });
 route.segments = ['work/board'];
 await screen.rerender(shell({ card: 7 }));
 await expect.poll(place).toMatchObject({ section: 'work/board', card: 7, chat: false });
 // A mark belongs to the page that named it: the next page starts without it.
 route.segments = ['log'];
 await screen.rerender(shell());
 expect(place()).toEqual({ section: 'log', chat: false });
 expect(current()).toEqual(['Activity log']);
});
