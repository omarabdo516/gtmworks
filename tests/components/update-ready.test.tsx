import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { LanguageProvider } from '@/lib/i18n-client';
import UpdateReady, { hiddenKey, seenKey } from '@/app/update-ready';
import { whatsNew } from '@/lib/updates.mjs';

// Update ready and What's new (#442), at the foot of the sidebar (app/shell.tsx).
const company = '10000000-0000-0000-0000-000000000001';
const entry = (issue: number) => ({ issue, date: '2026-11-21', en: { title: `Title ${issue}`, body: `Sentence ${issue}.` }, ar: { title: `عنوان ${issue}`, body: `جملة ${issue}.` } });
const update = { version: 'v1.3.0', date: new Date(Date.now() - 3 * 86400000).toISOString(), entries: [1, 2, 3, 4, 5, 6, 7].map(entry) };
const seenAll = () => localStorage.setItem(seenKey, JSON.stringify(whatsNew.map(item => item.issue)));
let answer: () => Promise<Response>;
const asked = vi.fn();
beforeEach(() => {
 localStorage.clear();
 asked.mockReset();
 vi.stubGlobal('fetch', async (url: string) => { asked(url); return answer(); });
});
afterEach(() => { vi.unstubAllGlobals(); });
const answering = (body: object) => { answer = async () => new Response(JSON.stringify(body), { status: 200 }); };
const tree = (owner: boolean, language: 'en' | 'ar' = 'en', key = 0) => <LanguageProvider key={key} language={language}><div className="gw"><UpdateReady company={company} owner={owner}/></div></LanguageProvider>;
const shown = (owner: boolean, language: 'en' | 'ar' = 'en') => render(tree(owner, language));
// Opening gtmworks again: the same place drawn anew, which asks again.
const reopened = async (screen: Awaited<ReturnType<typeof shown>>, times: number) => {
 await screen.rerender(tree(true, 'en', times));
 await vi.waitFor(() => expect(asked).toHaveBeenCalledTimes(times));
 await new Promise(resolve => setTimeout(resolve, 50));
};

test('an Owner on an older version sees Update ready, with its version, the lines since, and the command to copy', async () => {
 seenAll(); answering({ joined: '2026-01-01T00:00:00Z', update });
 const screen = await shown(true);
 await screen.getByRole('button', { name: 'Update ready' }).click();
 const dialog = screen.getByRole('dialog', { name: 'Update ready' });
 await expect.element(dialog).toBeVisible();
 await expect.element(dialog).toMatchTextContent(/gtmworks v1\.3\.0 came out 3 days ago\./);
 await expect.element(dialog).toMatchTextContent(/Title 1 Sentence 1\./);
 await expect.element(dialog).toMatchTextContent(/Title 5 Sentence 5\./);
 await expect.element(dialog).not.toMatchTextContent(/Title 6/);
 await expect.element(dialog).toMatchTextContent(/And 2 more improvements and fixes\./);
 await expect.element(screen.getByText('gtmworks update', { exact: true })).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'Copy the command gtmworks update' })).toBeVisible();
 await expect.element(dialog).toMatchTextContent(/If you didn’t install gtmworks, send this command to whoever did\./);
 expect(asked).toHaveBeenCalledWith(`/api/update?company=${company}`);
});

test('the notice reads in Arabic too', async () => {
 seenAll(); answering({ joined: '2026-01-01T00:00:00Z', update: { ...update, entries: [entry(1)] } });
 const screen = await shown(true, 'ar');
 await screen.getByRole('button', { name: 'في تحديث جاهز' }).click();
 await expect.element(screen.getByRole('dialog')).toMatchTextContent(/عنوان 1 جملة 1\./);
 await expect.element(screen.getByRole('dialog')).toMatchTextContent(/على السيرفر، شغّل:/);
});

test('a Member sees nothing and asks nothing', async () => {
 answering({ joined: '2026-01-01T00:00:00Z', update });
 const screen = await shown(false);
 await new Promise(resolve => setTimeout(resolve, 50));
 expect(asked).not.toHaveBeenCalled();
 expect(screen.container.textContent).toBe('');
});

const failing: [string, () => Promise<Response>][] = [
 ['up to date', async () => new Response(JSON.stringify({ joined: '2026-01-01T00:00:00Z', update: null }), { status: 200 })],
 ['offline', async () => { throw new TypeError('Failed to fetch'); }],
 ['the check failing', async () => new Response('{}', { status: 502 })],
];
test.each(failing)('%s: nothing shows', async (_, reply) => {
 seenAll(); answer = reply;
 const screen = await shown(true);
 await vi.waitFor(() => expect(asked).toHaveBeenCalled());
 await new Promise(resolve => setTimeout(resolve, 50));
 expect(screen.container.textContent).toBe('');
 await expect.element(screen.getByRole('button')).not.toBeInTheDocument();
});

test('hidden stays hidden until a newer version appears', async () => {
 seenAll(); answering({ joined: '2026-01-01T00:00:00Z', update });
 const first = await shown(true);
 await first.getByRole('button', { name: 'Update ready' }).click();
 await first.getByRole('button', { name: 'Hide until the next version' }).click();
 await expect.element(first.getByRole('button', { name: 'Update ready' })).not.toBeInTheDocument();
 await reopened(first, 2);
 await expect.element(first.getByRole('button', { name: 'Update ready' })).not.toBeInTheDocument();
 answering({ joined: '2026-01-01T00:00:00Z', update: { ...update, version: 'v1.4.0' } });
 await reopened(first, 3);
 await expect.element(first.getByRole('button', { name: 'Update ready' })).toBeVisible();
 expect(localStorage.getItem(hiddenKey)).toMatch(/^v1\.3\.0:/);
});

test('after an update What\'s new shows what arrived, once', async () => {
 const before = whatsNew.slice(1).map(item => item.issue);
 localStorage.setItem(seenKey, JSON.stringify(before));
 answering({ joined: '2026-01-01T00:00:00Z', update: null });
 const first = await shown(true);
 const dialog = first.getByRole('dialog', { name: 'What’s new' });
 await expect.element(dialog).toBeVisible();
 expect(dialog.element().textContent).toContain(`${whatsNew[0].en.title} ${whatsNew[0].en.body}`);
 expect(dialog.element().textContent).not.toContain(whatsNew[1].en.body);
 await first.getByRole('button', { name: 'Got it' }).click();
 await expect.element(dialog).not.toBeInTheDocument();
 await reopened(first, 2);
 await expect.element(first.getByRole('dialog')).not.toBeInTheDocument();
});

test('a new Owner on a fresh install is shown no What\'s new', async () => {
 answering({ joined: new Date().toISOString(), update: null });
 const screen = await shown(true);
 await vi.waitFor(() => expect(asked).toHaveBeenCalled());
 await new Promise(resolve => setTimeout(resolve, 50));
 await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
 expect(JSON.parse(localStorage.getItem(seenKey) || '[]')).toEqual(whatsNew.map(item => item.issue));
});
