import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import InstallUpdate, { type InstallUpdateState } from '@/app/install-update';
import { LanguageProvider } from '@/lib/i18n-client';

// Update now (#443): an Owner asks, is warned first, sees "Updating…" while the updater on the host works, then how it
// ended, in English and Arabic. The browser only records the request and reads back the state the updater writes.
const idle: InstallUpdateState = { button: true, state: 'idle', version: null, changedAt: '2026-11-20T10:00:00Z' };
const shown = (language: 'en'|'ar', props: Parameters<typeof InstallUpdate>[0]) => <LanguageProvider language={language}><div className="gw"><InstallUpdate {...props}/></div></LanguageProvider>;
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
// The text a line holds once it is drawn, its version kept apart from the sentence's direction.
const textOf = (line: { query: () => Element | null }) => () => (line.query()?.textContent ?? '').replace(/[\u2066-\u2069]/g, '');

test('Update now warns that gtmworks stops for a minute, records the request, then reads until the update ends', async () => {
 // gtmworks is down for the first read after the request, then answers with how the update ended.
 const answers: (InstallUpdateState|null)[] = [null, { ...idle, state: 'updated', version: 'v1.4.0', changedAt: '2026-11-20T10:02:00Z' }];
 const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
  ? Response.json({ state: 'requested' })
  : answers[0] === null ? (answers.shift(), new Response('', { status: 502 })) : Response.json(answers.shift()));
 vi.stubGlobal('fetch', fetch);
 const screen = await render(shown('en', { offer: true, initial: idle }));
 await screen.getByRole('button', { name: 'Update now' }).click();
 await expect.element(screen.getByText(/stops for about a minute while it updates/)).toBeVisible();
 expect(fetch).not.toHaveBeenCalled();
 await screen.getByRole('group').getByRole('button', { name: 'Update now' }).click();
 const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
 expect(post?.[1]?.body).toBe('{}');
 await expect.poll(textOf(screen.getByRole('status'))).toContain('Updating gtmworks…');
 await expect.poll(textOf(screen.getByRole('status')), { timeout: 15000 }).toContain('Updated to gtmworks v1.4.0');
 expect(fetch.mock.calls.filter(([, init]) => init?.method !== 'POST')).toHaveLength(2);
 await screen.getByRole('button', { name: 'Close' }).click();
 await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
 await screen.unmount();
}, 30000);

test('a failed update names the version still running, in Arabic too; a main build is named by its digest', async () => {
 const failed: InstallUpdateState = { ...idle, state: 'failed', version: `main@sha256:${'ab12cd3'.padEnd(64, '0')}` };
 const english = await render(shown('en', { initial: failed }));
 await expect.poll(textOf(english.getByRole('alert'))).toContain('The update failed; you are on gtmworks main · ab12cd3');
 await english.unmount();
 const arabic = await render(shown('ar', { initial: { ...failed, version: 'v1.3.1' } }));
 await expect.poll(textOf(arabic.getByRole('alert'))).toContain('التحديث منجحش؛ إنت لسه على gtmworks v1.3.1');
 await arabic.unmount();
});

test('nothing shows with the button off, with nothing offered, or to anyone the database answers nothing for', async () => {
 const screen = await render(<LanguageProvider language="en"><div className="gw">
  <InstallUpdate offer initial={{ ...idle, button: false }}/><InstallUpdate initial={idle}/><InstallUpdate offer initial={null}/>
 </div></LanguageProvider>);
 expect(screen.container.querySelector('.gw')).not.toBeNull();
 expect(screen.container.querySelector('.install-update')).toBeNull();
});

test('a request the server refuses says why, in the conversation\'s error style', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'updateButtonOff' }, { status: 403 })));
 const screen = await render(shown('en', { offer: true, initial: idle }));

 await screen.getByRole('button', { name: 'Update now' }).click();
 await screen.getByRole('group').getByRole('button', { name: 'Update now' }).click();
 await expect.poll(textOf(screen.getByRole('alert'))).toContain('Update now is turned off on this server.');
});
