import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import TeamDialog, { type TeamActions } from '@/app/team-dialog';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/settings.css';
import '@/app/team-dialog.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board' }));

// #187: the Team dialog's backdrop closes it, as the reference's native dialog does, but a press that started inside the
// panel is the person's own (a text selection dragged out of it) and leaves the dialog open.
const actions=():TeamActions=>({
 load: async () => ({ members: [{ person_id: 'p-1', role: 'owner', people: { name: 'Omar' } }], ended: [], links: [], agents: [{ id: 'a-1', connection_id: 'c-1', name: 'Lead', is_default: true }, { id: 'a-2', connection_id: 'c-2', name: 'Meta Ads', is_default: false }], allowed: [], candidates: [] }),
 save: async () => '', makeLink: async () => ({}), cancelLink: async () => '', add: async () => ({}), makePasswordLink: async () => ({}),
});
const reducedMotion = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
const press = (element: Element, type: 'mousedown' | 'mouseup') => element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
const click = (element: Element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

test('a press that starts inside the panel and ends on the dialog surface leaves the dialog open; one that starts and ends there closes it', async () => {
 reducedMotion();
 const close = vi.fn();
 await render(<LanguageProvider language="en"><TeamDialog company="co-1" alone={false} userId="p-1" owner={false} role="owner" personName="Omar" actions={actions()} close={close}/></LanguageProvider>);
 const dialog = document.querySelector('dialog#team')!;
 await expect.poll(() => dialog.querySelector('.ta-table')).not.toBeNull();
 const panel = dialog.querySelector('.modal__inner')!;
 // The browser aims the click of a drag that leaves the panel at the dialog both ends share.
 press(panel, 'mousedown');
 press(dialog, 'mouseup');
 click(dialog);
 await new Promise(resolve => setTimeout(resolve, 50));
 expect(close, 'the press began in the panel, so the dialog stays').not.toHaveBeenCalled();
 expect(dialog.hasAttribute('open')).toBe(true);
 press(dialog, 'mousedown');
 press(dialog, 'mouseup');
 click(dialog);
 await expect.poll(() => close).toHaveBeenCalled();
 expect(dialog.hasAttribute('open')).toBe(false);
});

// #951: a Company worked alone draws no Team table, so its pending Invite link waits in a short list with the same Cancel.
test('a Company worked alone lists its pending Invite link and cancels it', async () => {
 const cancelLink = vi.fn(async () => '');
 const loaded = { members: [{ person_id: 'p-1', role: 'owner', people: { name: 'Omar' } }], ended: [{ id: 'i-1', email: 'ended-953@example.test', role: 'viewer' }], links: [{ id: 'l-1', label: 'Nour Salah', role: 'viewer', made_by_name: 'Omar', ends_at: '2026-12-04T10:00:00+00:00' }], agents: [{ id: 'a-1', connection_id: 'c-1', name: 'Lead', is_default: true }], allowed: [], candidates: [] };
 const screen = await render(<LanguageProvider language="en"><TeamDialog company="co-1" alone={true} userId="p-1" owner={true} role="owner" personName="Omar" actions={{ ...actions(), load: async () => loaded, cancelLink }} close={vi.fn()}/></LanguageProvider>);
 const ended = screen.getByRole('list', { name: 'Email invite ended' });
 await expect.element(ended.getByText('Email invite ended', { exact: true })).toBeVisible();
 await expect.element(ended.getByText('Viewer · ended-953@example.test')).toBeVisible();
 const row = screen.getByRole('listitem').filter({ hasText: 'Nour Salah' });
 await expect.element(row.getByText('Viewer · Made by Omar · Ends Dec 4')).toBeVisible();
 await screen.getByRole('button', { name: 'Cancel Nour Salah’s invite link' }).click();
 expect(cancelLink).toHaveBeenCalledWith('l-1');
});
