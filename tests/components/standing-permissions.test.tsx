import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import type { ComponentProps } from 'react';
import { StandingPermissions } from '@/app/standing-permissions';
import { ToastHost } from '@/app/toast';
import { LanguageProvider } from '@/lib/i18n-client';
import type { StandingPermission } from '@/lib/standing-permissions.mjs';
import '@/app/shell.css';

// #166 (design-reference: permsHTML and the click case revoke): one row per standing entry of the Agent's own profile,
// the app and the tool on its first line and who allowed it and when on its second, left out when gtmworks has no
// record; no section for an empty list. Revoke is drawn only for an Owner or a Manager, sends the entry once, drops the
// row, says the Agent will ask again and moves the focus as the reference does.
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
afterEach(() => { vi.unstubAllGlobals(); refresh.mockClear(); });
const permissions: StandingPermission[] = [
 { entry: 'mcp:meta-ads/create_campaign', app: { key: 'meta-ads', name: 'Meta Ads' }, tool: 'create_campaign', allowedBy: 'Omar', allowedAt: '2026-06-10T10:05:00Z' },
 { entry: 'recursive delete', app: null, tool: null, allowedBy: null, allowedAt: null },
];
const view = (props: { canRevoke?: boolean, permissions?: StandingPermission[], returnTo?: string } = {}, language: 'en' | 'ar' = 'en') => render(<LanguageProvider language={language}>
 <div className="gw" dir={language === 'ar' ? 'rtl' : 'ltr'}><button type="button" id="dp-settings">Settings</button>
  <div className="dp-sections"><StandingPermissions company="co-1" agent="ag-1" permissions={props.permissions ?? permissions} canRevoke={props.canRevoke ?? false} returnTo={props.returnTo}/></div>
 </div><ToastHost/></LanguageProvider>);

test('each entry is one row: the app and the tool, then who allowed it and when; an entry with no record has one line; no Revoke for a reader', async () => {
 const screen = await view();
 const section = screen.getByRole('region', { name: 'Standing permissions' });
 await expect.element(section).toBeVisible();
 const rows = section.element().querySelectorAll('.sp-row');
 expect(rows).toHaveLength(2);
 expect(rows[0].querySelector('.panel-row__t')?.textContent).toBe('Meta Ads · create_campaign');
 expect(rows[0].querySelector('.panel-row__d')?.textContent).toMatch(/^Allowed by Omar · /);
 expect(rows[1].querySelector('.panel-row__t')?.textContent).toBe('recursive delete');
 expect(rows[1].querySelector('.panel-row__d')).toBeNull();
 expect(section.element().querySelectorAll('button')).toHaveLength(0);
});

test('an empty list draws no section', async () => {
 const screen = await view({ permissions: [], canRevoke: true });
 expect(screen.container.querySelector('.sp')).toBeNull();
 expect(screen.container.textContent).not.toContain('Standing permissions');
});

test('in Arabic the section reads as the reference words it', async () => {
 const screen = await view({ canRevoke: true }, 'ar');
 const section = screen.getByRole('region', { name: 'صلاحيات دايمة' });
 await expect.element(section.getByRole('button', { name: 'إلغاء: Meta Ads · create_campaign' })).toBeVisible();
 expect(section.element().querySelector('.panel-row__d')?.textContent).toMatch(/^سمح بيها Omar · /);
});

test('Revoke sends the entry once, drops the row, says the Agent will ask again and gives the focus to the next Revoke, then to the settings tab', async () => {
 const send = vi.fn(async (url: string, init: RequestInit) => { void url; void init; return new Response(JSON.stringify({ revoked: true }), { status: 200 }); });
 vi.stubGlobal('fetch', send);
 const screen = await render(<LanguageProvider language="en"><a href="#s" id="sov-tab-settings">Settings</a>
  <StandingPermissions company="co-1" agent="ag-1" permissions={permissions} canRevoke/><ToastHost/></LanguageProvider>);
 await screen.getByRole('button', { name: 'Revoke: Meta Ads · create_campaign' }).click();
 await expect.element(screen.getByText('Permission revoked. The agent will ask you again')).toBeVisible();
 expect(send).toHaveBeenCalledTimes(1);
 expect(send.mock.calls[0][0]).toBe('/api/agent-permissions');
 expect(JSON.parse(String(send.mock.calls[0][1].body))).toEqual({ company: 'co-1', agent: 'ag-1', entry: 'mcp:meta-ads/create_campaign' });
 expect(screen.container.querySelectorAll('.sp-row')).toHaveLength(1);
 await expect.element(screen.getByRole('button', { name: 'Revoke: recursive delete' })).toHaveFocus();
 expect(refresh).toHaveBeenCalled();
 await screen.getByRole('button', { name: 'Revoke: recursive delete' }).click();
 await expect.poll(() => screen.container.querySelector('.sp')).toBeNull();
 await expect.element(screen.getByRole('link', { name: 'Settings' })).toHaveFocus();
});

test('in the details panel the focus goes to its settings button, as the reference\'s does', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revoked: true }), { status: 200 })));
 const screen = await view({ canRevoke: true, returnTo: 'dp-settings' });
 await screen.getByRole('button', { name: 'Revoke: recursive delete' }).click();
 await expect.element(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
});

test('a revoke the server refuses keeps the row and says it could not be done', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'agentPermissionNotAllowed' }), { status: 403 })));
 const screen = await view({ canRevoke: true });
 await screen.getByRole('button', { name: 'Revoke: Meta Ads · create_campaign' }).click();
 await expect.element(screen.getByRole('alert')).toHaveTextContent('Couldn’t revoke it. Try again.');
 expect(screen.container.querySelectorAll('.sp-row')).toHaveLength(2);
 expect(refresh).not.toHaveBeenCalled();
});
