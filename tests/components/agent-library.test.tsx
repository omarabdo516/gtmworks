import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { renderToString } from 'react-dom/server';
import { AgentLibrary } from '@/app/agent-library';
import { detailsTabs } from '@/app/agent-details-tabs';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n } from '@/lib/i18n.mjs';
import '@/app/shell.css';

vi.mock('@/lib/link', () => ({ default: (props: { children?: unknown }) => <a {...props as object}/> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/app/toast', () => ({ toast }));

// #194, design-reference: libraryHTML, libThumb, libDownload, fname, filesWord, the .lib-* rules. The Library reads one
// folder of the Agent's own Engine profile through GET /api/agent-files, after the panel is drawn; a folder's row counts
// its files and the day of the newest, a folder opens in place and a file downloads with the reference's toast; the empty
// and unreadable states say so in both languages. Only the Owner and Managers are drawn one.
type Row = { name: string, isFolder: boolean, size: number | null, time: string | null, files: number | null, latest: string | null };
const at = '2026-11-18T09:37:00.000Z';
const work: Record<string, Row[]> = {
 '': [{ name: 'reports', isFolder: true, size: null, time: null, files: 2, latest: at }, { name: 'drafts', isFolder: true, size: null, time: null, files: 1, latest: at }, { name: 'empty', isFolder: true, size: null, time: null, files: 0, latest: null }, { name: 'brief.md', isFolder: false, size: 2048, time: at, files: null, latest: null }],
 reports: [{ name: '2026', isFolder: true, size: null, time: null, files: 1, latest: at }, { name: 'q3.csv', isFolder: false, size: 12, time: at, files: null, latest: null }],
 'reports/2026': [{ name: 'q3.csv', isFolder: false, size: 12, time: at, files: null, latest: null }],
 empty: [],
};
// The reader's folders, as the route answers them: a folder it does not have is not found; null is a Library it cannot
// read at all.
const folders = (read: Record<string, Row[] | null>) => {
 const asked: string[] = [];
 vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
  const url = new URL(String(input), 'http://localhost');
  const folder = url.searchParams.get('folder') ?? '';
  asked.push(folder);
  const entries = read[folder];
  return entries ? new Response(JSON.stringify({ folder, entries }), { status: 200, headers: { 'Content-Type': 'application/json' } })
   : new Response(JSON.stringify({ error: 'agentLibraryMissing' }), { status: 404 });
 }));
 return asked;
};
afterEach(() => { vi.unstubAllGlobals(); toast.mockClear(); });

const drawn = (language: 'en' | 'ar' = 'en') => render(<LanguageProvider language={language}>
 <div className="gw" dir={language === 'ar' ? 'rtl' : 'ltr'}><div className="details is-open">
  <AgentLibrary company="co-1" slug="rs-learning" agent="ag-1" name="Lead"/>
 </div></div>
</LanguageProvider>);

test('the Library counts every file of the Agent, and each folder row says how many it holds and when the newest was saved, or Empty', async () => {
 const asked = folders(work);
 const screen = await drawn();
 const section = screen.getByRole('region', { name: 'Library of Lead 4' });
 await expect.element(section).toBeVisible();
 await expect.element(screen.getByRole('button', { name: /^reports/ })).toHaveAccessibleName(/^reports 2 files · latest /);
 await expect.element(screen.getByRole('button', { name: /^drafts/ })).toHaveAccessibleName(/^drafts One file · latest /);
 await expect.element(screen.getByRole('button', { name: /^empty/ })).toHaveAccessibleName(/^empty Empty$/);
 await expect.element(screen.getByText('brief.md')).toBeVisible();
 await expect.element(screen.getByText('2 KB')).toBeVisible();
 // The file's time is the Engine's, drawn as the log draws one, and its download is the route beside it.
 expect(section.element().querySelector('time')?.getAttribute('datetime')).toBe(at);
 await expect.element(screen.getByRole('link', { name: 'Download brief.md' })).toHaveAttribute('href', '/c/rs-learning/agent-files/ag-1?name=brief.md');
 // The hint names the Agent and describes the folder, promising nothing the Engine does not do.
 expect(section.element().textContent).toContain('Files in Lead’s work folder show here.');
 expect(screen.container.textContent).not.toContain('/opt/');
 expect(asked).toEqual(['']);
});

test('a folder opens in place with its own count of files, the focus on the Library crumb, and the way back puts the focus on that folder\'s row', async () => {
 const asked = folders(work);
 const screen = await drawn();
 await screen.getByRole('button', { name: /^reports/ }).click();
 // The heading inside a folder counts its files, not the folder inside it.
 const heading = screen.getByRole('heading', { name: 'reports 1' });
 await expect.element(heading).toBeVisible();
 // The reference puts the focus on the way back (lib-open focuses #lib-root), not on the folder's name.
 await expect.element(screen.getByRole('button', { name: 'Library of Lead' })).toHaveFocus();
 await expect.element(screen.getByRole('button', { name: /^2026/ })).toHaveAccessibleName(/^2026 One file · latest /);
 await expect.element(screen.getByText('q3.csv')).toBeVisible();
 expect(asked).toEqual(['', 'reports']);
 await screen.getByRole('button', { name: 'Library of Lead' }).click();
 await expect.element(screen.getByRole('heading', { name: 'Library of Lead 4' })).toBeVisible();
 await expect.element(screen.getByRole('button', { name: /^reports/ })).toHaveFocus();
 // A folder inside a folder opens the same way, and the way back returns to its row too.
 await screen.getByRole('button', { name: /^reports/ }).click();
 await screen.getByRole('button', { name: /^2026/ }).click();
 await expect.element(screen.getByRole('heading', { name: '2026 1' })).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'Library of Lead' })).toHaveFocus();
 await screen.getByRole('button', { name: 'Library of Lead' }).click();
 await expect.element(screen.getByRole('button', { name: /^2026/ })).toHaveFocus();
});

test('a raster file\'s row is its own picture, drawn through its download route, and another file keeps the icon', async () => {
 folders({ '': [
  { name: 'shot.png', isFolder: false, size: 4096, time: at, files: null, latest: null },
  { name: 'brief.pdf', isFolder: false, size: 2048, time: at, files: null, latest: null },
 ] });
 const screen = await drawn();
 await expect.element(screen.getByText('shot.png')).toBeVisible();
 const rows = [...screen.container.querySelectorAll('li.lib-file')];
 const picture = rows[0].querySelector<HTMLImageElement>('.lib-thumb img');
 expect(picture?.getAttribute('src')).toBe('/c/rs-learning/agent-files/ag-1?name=shot.png');
 expect(picture?.getAttribute('alt')).toBe('');
 expect(rows[1].querySelector('.lib-thumb img')).toBeNull();
 expect(rows[1].querySelector('.lib-thumb svg')).not.toBeNull();
});

test('a file name\'s base takes its direction from its first strong character, and its extension stays left to right', async () => {
 folders({ '': [{ name: '_draft.md', isFolder: false, size: 12, time: at, files: null, latest: null }] });
 const screen = await drawn();
 await expect.element(screen.getByRole('button', { name: /^_draft\.md/ })).toBeVisible();
 const name = screen.container.querySelector('li.lib-file .panel-row__t');
 expect([...name!.querySelectorAll('bdi')].map(part => [part.textContent, part.getAttribute('dir')])).toEqual([['_draft', 'auto'], ['.md', 'ltr']]);
});

test('a download is the reference\'s toast and its own file, and an empty folder says it is empty', async () => {
 folders(work);
 const screen = await drawn();
 await screen.getByRole('button', { name: /^empty/ }).click();
 await expect.element(screen.getByText('This folder is empty.')).toBeVisible();
 await screen.getByRole('button', { name: 'Library of Lead' }).click();
 await screen.getByRole('link', { name: 'Download brief.md' }).click();
 expect(toast).toHaveBeenCalledWith('Downloading “brief.md”', { icon: 'download' });
});

test('an empty Library and a Library that cannot be read each say so', async () => {
 folders({ '': [] });
 await expect.element((await drawn()).getByText('Nothing here yet. The files in Lead’s work folder will show here, and you can download them.')).toBeVisible();
 folders({ '': null });
 await expect.element((await drawn()).getByText('The Library can’t be read right now. Try again in a minute.')).toBeVisible();
});

test('in Arabic the Library reads as the reference words it, and the folder chevron turns with the direction', async () => {
 folders(work);
 const screen = await drawn('ar');
 await expect.element(screen.getByRole('region', { name: 'مكتبة Lead 4' })).toBeVisible();
 expect(screen.container.textContent).toContain('ملفات Lead اللي في فولدر شغله بتظهر هنا.');
 await expect.element(screen.getByRole('button', { name: /^reports/ })).toHaveAccessibleName(/^reports ملفين · آخر واحد/);
 await expect.element(screen.getByRole('link', { name: 'نزّل brief.md' })).toBeVisible();
 await screen.getByRole('button', { name: /^reports/ }).click();
 await expect.element(screen.getByRole('heading', { name: 'reports 1' })).toBeVisible();
 const arrow = screen.container.querySelector<SVGElement>('.lib-crumbs .gw-icon');
 expect(arrow).not.toBeNull();
 expect(getComputedStyle(arrow!).transform).toContain('-1');
});

// The server draws the Library above the Files list for the Owner and Managers, and draws none for anyone below them
// (GET /api/agent-files refuses a Contributor and a Viewer, #194).
test('the Library is above the Files list when the server draws it, and the files tab is the same without it', () => {
 const { t } = i18n('en');
 const html = renderToString(detailsTabs({ t, slug: 'rs-learning', agent: 'ag-1', library: <p className="dp-library">The Library</p>, fileCount: 0, logCount: 0 }).files);
 expect(html.indexOf('The Library')).toBeGreaterThan(-1);
 expect(html.indexOf('The Library')).toBeLessThan(html.indexOf('id="dp-files-h"'));
 expect(renderToString(detailsTabs({ t, slug: 'rs-learning', agent: 'ag-1', fileCount: 0, logCount: 0 }).files)).not.toContain('dp-library');
});
