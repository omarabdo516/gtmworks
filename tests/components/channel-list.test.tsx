import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import ChannelList from '@/app/channel-list';
import { ShellPageProvider } from '@/app/shell-page';
import { SidebarLive } from '@/app/sidebar-live';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ChannelSummary } from '@/lib/channels';

const place = vi.hoisted(() => ({ segments: [] as string[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => '/c/rs/home', useSelectedLayoutSegments: () => place.segments, useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('@/app/channel-actions', () => ({ channelChoices: vi.fn(() => new Promise(() => {})), createChannel: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const general: ChannelSummary = { kind: 'general', id: 'ch-g', unread: 2 };
const launch: ChannelSummary = { kind: 'team', name: 'Launch week', id: 'ch-t', unread: 1 };
// The open channel is the one in the layout's address (app/shell-page).
const list = ({ initial = [general, launch], ...props }: Partial<ComponentProps<typeof ChannelList>> & { initial?: ChannelSummary[] } = {}, language: 'en' | 'ar' = 'en', open?: string) => { place.segments = open ? ['channels', open] : []; return render(<LanguageProvider language={language}>
 <ShellPageProvider company={{ name: 'RS', slug: 'rs' }} approvals={Promise.resolve(0)}><SidebarLive person="p-1" company="co-1" channels={initial} states={{}}><ChannelList slug="rs" company="co-1" person="p-1" manage={false} {...props}/></SidebarLive></ShellPageProvider>
</LanguageProvider>); };

test('each channel shows how many messages are new, and the one being read shows none', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await list({}, 'en', 'ch-t');
 const links = screen.getByRole('link');
 await expect.element(links.nth(0)).toHaveAttribute('href', '/c/rs/channels/ch-g');
 await expect.element(links.nth(0)).toHaveClass(/is-unread/);
 await expect.element(screen.getByLabelText('2 new messages')).toHaveTextContent('2');
 await expect.element(links.nth(1)).toHaveTextContent('Launch week');
 await expect.element(links.nth(1)).not.toHaveClass(/is-unread/);
 await expect.element(links.nth(1)).toHaveAttribute('aria-current', 'true');
 await expect.element(screen.getByLabelText('1 new message')).not.toBeInTheDocument();
});

test('in Arabic the general channel is عام and the count says رسالة جديدة', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await list({ initial: [{ ...general, unread: 1 }] }, 'ar');
 await expect.element(screen.getByRole('link').getByText('عام', { exact: true })).toBeVisible();
 await expect.element(screen.getByLabelText('1 رسالة جديدة')).toBeVisible();
});

test('the counts are asked again while the page shows, so a new message raises them', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const asked = vi.fn<(url: string) => void>();
 vi.stubGlobal('fetch', async (url: string) => { asked(url); return new Response(JSON.stringify({ channels: [{ ...general, unread: 3 }, launch], agents: {} })); });
 const screen = await list();
 expect(asked).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(5000);
 expect(asked.mock.calls[0][0]).toBe('/api/sidebar?company=co-1&person=p-1');
 await expect.element(screen.getByLabelText('3 new messages')).toBeVisible();
});

test('only an Owner or a Manager has "+", which opens New channel', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const reader = await list();
 await expect.element(reader.getByRole('button', { name: 'New channel' })).not.toBeInTheDocument();
 await reader.unmount();
 const manager = await list({ manage: true });
 await manager.getByRole('button', { name: 'New channel' }).click();
 await expect.element(manager.getByRole('dialog', { name: 'New channel' })).toBeVisible();
});

test('a Company worked alone has no channel group', async () => {
 vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
 const screen = await list({ initial: [], manage: true });
 expect(screen.container.textContent).toBe('');
});
