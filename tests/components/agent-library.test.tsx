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

// #194, #353, design-reference: libraryHTML, libThumb, libDownload, fname, filesWord, the .lib-* rules. The Library reads
// the Agent's own Engine profile through GET /api/agent-files, after the panel is drawn: its work folder and, as the first
// row of the root, the images it generated (read by its own root) — a folder's row counts its files and the day of the
// newest, a folder opens in place and a file downloads with the reference's toast; the empty and unreadable states say so
// in both languages. Only the Owner and Managers are drawn one.
type Row = { name: string, isFolder: boolean, size: number | null, time: string | null, files: number | null, latest: string | null };
const at = '2026-11-18T09:37:00.000Z';
const work: Record<string, Row[]> = {
 '': [{ name: 'reports', isFolder: true, size: null, time: null, files: 2, latest: at }, { name: 'drafts', isFolder: true, size: null, time: null, files: 1, latest: at }, { name: 'empty', isFolder: true, size: null, time: null, files: 0, latest: null }, { name: 'brief.md', isFolder: false, size: 2048, time: at, files: null, latest: null }],
 reports: [{ name: '2026', isFolder: true, size: null, time: null, files: 1, latest: at }, { name: 'q3.csv', isFolder: false, size: 12, time: at, files: null, latest: null }],
 'reports/2026': [{ name: 'q3.csv', isFolder: false, size: 12, time: at, files: null, latest: null }],
 empty: [],
};
// The reader's folders, as the route answers them: a folder it does not have is not found; null is a Library it cannot
// read at all. The generated images folder is its own root, read at the Library's root beside the work folder's listing.
const folders = (read: Record<string, Row[] | null>, images: Row[] | null = []) => {
 const asked: string[] = [];
 vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
  const url = new URL(String(input), 'http://localhost');
  const root = url.searchParams.get('root') ?? 'work';
  const folder = url.searchParams.get('folder') ?? '';
  asked.push(`${root}:${folder}`);
  const entries = root === 'images' ? images : read[folder];
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
 // The Agent's generated images lead the list, and a Library with none generated says Empty in its own row (#353).
 await expect.element(screen.getByRole('button', { name: /^Generated images/ })).toHaveAccessibleName(/^Generated images Empty$/);
 expect(screen.container.querySelector('li.lib-file')?.textContent).toContain('Generated images');
 // The file's time is the Engine's, drawn as the log draws one, and its download is the route beside it.
 expect(section.element().querySelector('time')?.getAttribute('datetime')).toBe(at);
 await expect.element(screen.getByRole('link', { name: 'Download brief.md' })).toHaveAttribute('href', '/c/rs-learning/agent-files/ag-1?name=brief.md');
 // The hint names the Agent and describes the Library, promising nothing the Engine does not do.
 expect(section.element().textContent).toContain('Files in Lead’s folder in the company’s work folder, and the images it generated, show here.');
 // The work folder is the Company's (#395): a line in the hint's own style says every Agent of it can read and change it.
 const hints = [...section.element().querySelectorAll('.lib-hint')].map(hint => hint.textContent);
 expect(hints).toEqual(['Files in Lead’s folder in the company’s work folder, and the images it generated, show here. You can view and download them, and ask for edits in the chat.', 'Every agent of the company can read and change these files.']);
 expect(screen.container.textContent).not.toContain('/opt/');
 expect(asked).toEqual(['work:', 'images:']);
});

test('the Library leads with the Agent\'s generated images, counts their files, and opens them as a folder of the Library', async () => {
 const generated: Row[] = [
  { name: 'promo.png', isFolder: false, size: 4096, time: at, files: null, latest: null },
  { name: 'logo.jpg', isFolder: false, size: 2048, time: '2026-11-17T09:37:00.000Z', files: null, latest: null },
 ];
 const asked = folders(work, generated);
 const screen = await drawn();
 // The heading counts the work folder's files and the images the Agent generated.
 await expect.element(screen.getByRole('region', { name: 'Library of Lead 6' })).toBeVisible();
 const row = screen.getByRole('button', { name: /^Generated images/ });
 await expect.element(row).toHaveAccessibleName(/^Generated images 2 files · latest /);
 expect(screen.container.querySelector('li.lib-file')?.textContent).toContain('Generated images');
 // Opening it reads the images root and lists its pictures as any folder's files, each with its own download and preview.
 await row.click();
 await expect.element(screen.getByRole('heading', { name: 'Generated images 2' })).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'Library of Lead' })).toHaveFocus();
 await expect.element(screen.getByRole('link', { name: 'Download promo.png' })).toHaveAttribute('href', '/c/rs-learning/agent-files/ag-1?root=images&name=promo.png');
 const picture = screen.container.querySelector<HTMLImageElement>('li.lib-file .lib-thumb img');
 expect(picture?.getAttribute('src')).toBe('/c/rs-learning/agent-files/ag-1?root=images&name=promo.png');
 // The way back is the Library, and the images row has the keyboard again.
 await screen.getByRole('button', { name: 'Library of Lead' }).click();
 await expect.element(screen.getByRole('heading', { name: 'Library of Lead 6' })).toBeVisible();
 await expect.element(row).toHaveFocus();
 expect(asked).toEqual(['work:', 'images:', 'images:', 'work:', 'images:']);
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
 expect(asked).toEqual(['work:', 'images:', 'work:reports']);
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
 // The files' rows, beside the generated images row the Library leads with.
 const rows = [...screen.container.querySelectorAll('li.lib-file')].filter(row => !row.querySelector('.lib-folder'));
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
 const name = [...screen.container.querySelectorAll('li.lib-file')].at(-1)!.querySelector('.panel-row__t');
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
 await expect.element((await drawn()).getByText('Nothing here yet. Files Lead makes in its folder of the company’s work folder, and the images it generates, will show here.')).toBeVisible();
 folders({ '': null });
 await expect.element((await drawn()).getByText('The Library can’t be read right now. Try again in a minute.')).toBeVisible();
});

test('in Arabic the Library reads as the reference words it, and the folder chevron turns with the direction', async () => {
 folders(work);
 const screen = await drawn('ar');
 await expect.element(screen.getByRole('region', { name: 'مكتبة Lead 4' })).toBeVisible();
 expect(screen.container.textContent).toContain('ملفات Lead اللي في فولدره جوّه فولدر شغل الشركة، والصور اللي عملها، بتظهر هنا.');
 expect(screen.container.textContent).toContain('كل وكيل في الشركة يقدر يقرا الملفات دي ويغيّرها.');
 await expect.element(screen.getByRole('button', { name: /^reports/ })).toHaveAccessibleName(/^reports ملفين · آخر واحد/);
 await expect.element(screen.getByRole('button', { name: /^الصور اللي عملها/ })).toHaveAccessibleName(/^الصور اللي عملها فاضي$/);
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
