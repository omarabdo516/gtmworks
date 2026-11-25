import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { SidebarLive, AgentTile } from '@/app/sidebar-live';
import ChannelList from '@/app/channel-list';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ChannelSummary } from '@/lib/channels';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/c/rs/home', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('@/app/channel-actions', () => ({ channelChoices: vi.fn(() => new Promise(() => {})), createChannel: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const visibility = (state: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
afterEach(() => visibility('visible'));

// The sidebar of a Company worked alone: no channels, one Agent the reader sees, idle when the page was drawn.
const sidebar = (language: 'en' | 'ar' = 'en', channels: ChannelSummary[] = []) => render(<LanguageProvider language={language}>
 <SidebarLive person="p-1" company="co-1" channels={channels} states={{ reach: 'idle' }}>
  <ul><li><AgentTile agent="reach" href="/c/rs/chat/reach" named={['Reach', 'Runs the ads.']} title="Reach"><bdi>Reach</bdi></AgentTile></li></ul>
  <ChannelList slug="rs" company="co-1" person="p-1" manage={false}/>
 </SidebarLive>
</LanguageProvider>);
const answer = (agents: Record<string, string>, channels: ChannelSummary[] = []) => new Response(JSON.stringify({ channels, agents }));

test('an Agent that fails while the page shows looks stuck in the sidebar within 5 seconds, with no page move', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const asked = vi.fn<(url: string) => void>();
 vi.stubGlobal('fetch', async (url: string) => { asked(url); return answer({ reach: 'stuck' }); });
 const screen = await sidebar();
 const tile = screen.getByRole('link', { name: 'Reach · Runs the ads. · Idle' });
 await expect.element(tile).toBeVisible();
 await vi.advanceTimersByTimeAsync(5000);
 expect(asked.mock.calls[0][0]).toBe('/api/sidebar?company=co-1');
 await expect.element(screen.getByRole('link', { name: 'Reach · Runs the ads. · Stuck' })).toBeVisible();
 expect(screen.container.querySelector('.agent-tile .dot')?.className).toBe('dot dot--stuck');
});

test('asleep and stuck have their own words in Arabic', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 let next = 'asleep';
 vi.stubGlobal('fetch', async () => answer({ reach: next }));
 const screen = await sidebar('ar');
 await vi.advanceTimersByTimeAsync(5000);
 await expect.element(screen.getByRole('link', { name: 'Reach · Runs the ads. · نايم' })).toBeVisible();
 expect(screen.container.querySelector('.agent-tile .dot')?.className).toBe('dot dot--asleep');
 next = 'stuck';
 await vi.advanceTimersByTimeAsync(5000);
 await expect.element(screen.getByRole('link', { name: 'Reach · Runs the ads. · وقف' })).toBeVisible();
});

test('a hidden tab asks nothing, and asks again once it shows', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const asked = vi.fn();
 vi.stubGlobal('fetch', async () => { asked(); return answer({ reach: 'working' }); });
 visibility('hidden');
 const screen = await sidebar();
 await vi.advanceTimersByTimeAsync(15000);
 expect(asked).not.toHaveBeenCalled();
 visibility('visible');
 await vi.advanceTimersByTimeAsync(5000);
 expect(asked).toHaveBeenCalledTimes(1);
 await expect.element(screen.getByRole('link', { name: 'Reach · Runs the ads. · Working' })).toBeVisible();
});

test('one poll carries the channels\' counts and the Agents\' states', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const asked = vi.fn();
 const general: ChannelSummary = { kind: 'general', id: 'ch-g', unread: 1 };
 vi.stubGlobal('fetch', async () => { asked(); return answer({ reach: 'waiting' }, [{ ...general, unread: 4 }]); });
 const screen = await sidebar('en', [general]);
 await vi.advanceTimersByTimeAsync(5000);
 expect(asked).toHaveBeenCalledTimes(1);
 await expect.element(screen.getByLabelText('4 new messages')).toBeVisible();
 await expect.element(screen.getByRole('link', { name: 'Reach · Runs the ads. · Waiting on you' })).toBeVisible();
});

// #776: a page whose read of the channels failed, and a poll that failed, keep the channels the sidebar shows, what an
// earlier poll brought among them.
test('a failed read of the channels keeps the ones the sidebar shows, a poll\'s among them, from the next page and from a poll', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const general: ChannelSummary = { kind: 'general', id: 'ch-1', unread: 0 };
 vi.stubGlobal('fetch', async () => answer({}, [{ ...general, unread: 4 }]));
 const drawn = (channels: ChannelSummary[] | null) => <LanguageProvider language="en"><SidebarLive person="p-1" company="co-kept" channels={channels} states={{}}><ChannelList slug="rs" company="co-kept" person="p-1" manage={false}/></SidebarLive></LanguageProvider>;
 const first = await render(drawn([general]));
 await expect.element(first.getByRole('link', { name: 'general' })).toBeVisible();
 await vi.advanceTimersByTimeAsync(5000);
 await expect.element(first.getByLabelText('4 new messages')).toBeVisible();
 first.unmount();
 vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'channelNotRead' }), { status: 503 }));
 const next = await render(drawn(null));
 await expect.element(next.getByLabelText('4 new messages')).toBeVisible();
 await vi.advanceTimersByTimeAsync(5000);
 await expect.element(next.getByLabelText('4 new messages')).toBeVisible();
 next.unmount();
});
