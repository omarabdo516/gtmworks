import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { AgentLibrary } from '@/app/agent-library';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/shell.css';

vi.mock('@/lib/link', () => ({ default: (props: { children?: unknown }) => <a {...props as object}/> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/app/toast', () => ({ toast }));

// #195, design-reference: openPreview, previewBodyHTML, the #preview close handler, closeDlg, toast. A file's row opens a
// read-only dialog with the keyboard on Download; a raster is a picture, text and Markdown are plain text, a CSV is a
// table, and a vector image or a page is never drawn. The close button, Escape and a press on the backdrop each close it
// and give the row its keyboard back, and the download is the row's own file with the reference's toast.
type Row = { name: string, isFolder: boolean, size: number | null, time: string | null, files: number | null, latest: string | null };
type Body = { name: string, kind: 'image' | 'text' | 'table' | 'none', type: string, byteSize: number, truncated: boolean, text: string | null };
const at = '2026-11-18T09:37:00.000Z';
const script = '# Notes\n\n<script>alert("x")</script>\n';
const rows: Row[] = [
 { name: 'brief.md', isFolder: false, size: 19, time: at, files: null, latest: null },
 { name: 'notes.md', isFolder: false, size: script.length, time: at, files: null, latest: null },
 { name: 'long.txt', isFolder: false, size: 614400, time: at, files: null, latest: null },
 { name: 'q3.csv', isFolder: false, size: 26, time: at, files: null, latest: null },
 { name: 'shot.png', isFolder: false, size: 4096, time: at, files: null, latest: null },
 { name: 'logo.svg', isFolder: false, size: 29, time: at, files: null, latest: null },
];
const bodies: Record<string, Body> = {
 'brief.md': { name: 'brief.md', kind: 'text', type: 'text/markdown', byteSize: 19, truncated: false, text: '# Brief\n\nSell more.\n' },
 'notes.md': { name: 'notes.md', kind: 'text', type: 'text/markdown', byteSize: script.length, truncated: false, text: script },
 'long.txt': { name: 'long.txt', kind: 'text', type: 'text/plain', byteSize: 614400, truncated: true, text: 'a'.repeat(512 * 1024) },
 'q3.csv': { name: 'q3.csv', kind: 'table', type: 'text/csv', byteSize: 26, truncated: false, text: 'name,spend\nA,10\nB,20\n' },
 'shot.png': { name: 'shot.png', kind: 'image', type: 'image/png', byteSize: 4096, truncated: false, text: null },
 'logo.svg': { name: 'logo.svg', kind: 'none', type: 'image/svg+xml', byteSize: 29, truncated: false, text: null },
};
const engine = () => vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
 const url = new URL(String(input), 'http://localhost');
 if (url.pathname === '/api/agent-files/preview') {
  const body = bodies[url.searchParams.get('name') ?? ''];
  return body ? new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
   : new Response(JSON.stringify({ error: 'agentLibraryMissing' }), { status: 404 });
 }
 return new Response(JSON.stringify({ folder: '', entries: rows }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}));
afterEach(() => { vi.unstubAllGlobals(); toast.mockClear(); });

const drawn = (language: 'en' | 'ar' = 'en') => render(<LanguageProvider language={language}>
 <div className="gw" dir={language === 'ar' ? 'rtl' : 'ltr'}><div className="details is-open">
  <AgentLibrary company="co-1" slug="rs-learning" agent="ag-1" name="Lead"/>
 </div></div>
</LanguageProvider>);
const dialog = () => document.querySelector<HTMLDialogElement>('dialog.pv');
const fileRow = (screen: Awaited<ReturnType<typeof drawn>>, name: string) => screen.getByRole('button', { name: new RegExp(`^${name.replaceAll('.', '\\.')}`) });
const open = async (screen: Awaited<ReturnType<typeof drawn>>, name: string) => {
 const row = fileRow(screen, name);
 await expect.element(row).toBeVisible();
 await row.click();
 await expect.element(screen.getByRole('dialog')).toBeVisible();
 return row;
};
// The reference's leave is drawn first, then the dialog is gone and the row has the keyboard.
const closedBack = async (screen: Awaited<ReturnType<typeof drawn>>, name: string) => {
 const row = fileRow(screen, name);
 await expect.poll(() => dialog()).toBeNull();
 await expect.element(row).toHaveFocus();
};

test('a file\'s row opens the preview with the keyboard on Download, and the close button, Escape and a press on the backdrop each give it back to the row', async () => {
 await page.viewport(1280, 900);
 engine();
 const screen = await drawn();
 const row = await open(screen, 'brief.md');
 // Its head is the file over the Agent, its time and its size; its foot says it is read-only, beside Download.
 await expect.element(screen.getByRole('heading', { name: 'brief.md' })).toBeVisible();
 expect(dialog()!.textContent).toContain('Lead');
 expect(dialog()!.textContent).toContain('19 B');
 await expect.element(screen.getByText('Read only. For edits, ask Lead in the chat.')).toBeVisible();
 await expect.element(screen.getByRole('link', { name: 'Download' })).toHaveFocus();
 await screen.getByRole('button', { name: 'Close' }).click();
 expect(dialog()!.classList.contains('is-closing'), 'the leave is drawn first').toBe(true);
 await closedBack(screen, 'brief.md');
 // The same row opens it again, and Escape closes it.
 await row.click();
 await expect.element(screen.getByRole('link', { name: 'Download' })).toHaveFocus();
 await userEvent.keyboard('{Escape}');
 await closedBack(screen, 'brief.md');
 // And a press on the backdrop, which is the part of the window the dialog does not cover.
 await fileRow(screen, 'brief.md').click();
 await expect.element(screen.getByRole('dialog')).toBeVisible();
 await page.elementLocator(dialog()!).click({ position: { x: -20, y: 20 } });
 await closedBack(screen, 'brief.md');
});

test('Escape in the preview closes it without reaching the details panel behind it', async () => {
 await page.viewport(1280, 900);
 engine();
 const screen = await drawn();
 // A listener where the details panel keeps its own Escape (DetailsShell).
 const seen: string[] = [];
 const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') seen.push(event.key); };
 document.addEventListener('keydown', listener);
 try {
  await open(screen, 'brief.md');
  await userEvent.keyboard('{Escape}');
  await closedBack(screen, 'brief.md');
  expect(seen, 'the dialog kept its Escape').toHaveLength(0);
 } finally { document.removeEventListener('keydown', listener); }
});

test('a PNG is drawn as a picture from its download route, in the dialog and in its head, while a vector image is never drawn: its icon and Download only', async () => {
 engine();
 const screen = await drawn();
 await open(screen, 'shot.png');
 const image = screen.getByRole('img', { name: 'shot.png' });
 await expect.element(image).toBeVisible();
 expect(image.element().getAttribute('src')).toBe('/c/rs-learning/agent-files/ag-1?name=shot.png');
 expect(dialog()!.querySelector('pre, table')).toBeNull();
 // The head draws the same picture, as the reference's libThumb does for a raster.
 const head = dialog()!.querySelector<HTMLImageElement>('.modal__head .lib-thumb img');
 expect(head?.getAttribute('src')).toBe('/c/rs-learning/agent-files/ag-1?name=shot.png');
 await screen.getByRole('button', { name: 'Close' }).click();
 await expect.poll(() => dialog()).toBeNull();
 // An SVG carries no content at all: no image, no text, just the icon and Download.
 await open(screen, 'logo.svg');
 await expect.poll(() => dialog()!.querySelector('.pv-none')?.textContent).toBe('logo.svg');
 expect(dialog()!.querySelector('img, pre, table, svg.pv-img')).toBeNull();
 expect(dialog()!.querySelector('.modal__head .lib-thumb svg')).not.toBeNull();
 await expect.element(screen.getByRole('link', { name: 'Download' })).toBeVisible();
});

test('text and Markdown are plain text in their own direction, a script tag stays text, and a file over the limit says how big it is', async () => {
 engine();
 const screen = await drawn();
 await open(screen, 'brief.md');
 await expect.poll(() => dialog()!.querySelector('pre.pv-text')?.textContent).toBe('# Brief\n\nSell more.\n');
 const brief = dialog()!.querySelector('pre.pv-text');
 expect(brief?.getAttribute('dir')).toBe('auto');
 expect(dialog()!.querySelector('.pv-more')).toBeNull();
 await screen.getByRole('button', { name: 'Close' }).click();
 await expect.poll(() => dialog()).toBeNull();
 // Markdown holding a script tag is never drawn as HTML.
 await open(screen, 'notes.md');
 await expect.poll(() => dialog()!.querySelector('pre.pv-text')?.textContent).toBe(script);
 expect(dialog()!.querySelector('script')).toBeNull();
 await screen.getByRole('button', { name: 'Close' }).click();
 await expect.poll(() => dialog()).toBeNull();
 // Over the Engine's limit, the body ends by saying this is the first part and how big the whole file is.
 await open(screen, 'long.txt');
 await expect.element(screen.getByText('This is the first part. The whole file is 600 KB.')).toBeVisible();
 expect(dialog()!.querySelector('pre.pv-text')?.textContent).toHaveLength(512 * 1024);
});

test('a CSV is drawn as a table of its first rows', async () => {
 engine();
 const screen = await drawn();
 await open(screen, 'q3.csv');
 await expect.poll(() => dialog()!.querySelectorAll('table th').length).toBe(2);
 const table = dialog()!.querySelector('table');
 expect([...table!.querySelectorAll('th')].map(cell => cell.textContent)).toEqual(['name', 'spend']);
 expect([...table!.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))).toEqual([['A', '10'], ['B', '20']]);
 await expect.element(screen.getByRole('link', { name: 'Download' })).toBeVisible();
});

test('Download in the dialog saves the same file as the row\'s button, with the reference\'s toast', async () => {
 engine();
 const screen = await drawn();
 const rowLink = screen.getByRole('link', { name: 'Download brief.md' });
 await expect.element(rowLink).toBeVisible();
 const rowHref = rowLink.element().getAttribute('href');
 await open(screen, 'brief.md');
 const download = screen.getByRole('link', { name: 'Download' });
 expect(download.element().getAttribute('href')).toBe(rowHref);
 expect(download.element().getAttribute('href')).toBe('/c/rs-learning/agent-files/ag-1?name=brief.md');
 await download.click();
 expect(toast).toHaveBeenCalledWith('Downloading “brief.md”', { icon: 'download' });
});

test('in Arabic the preview reads as the reference words it', async () => {
 engine();
 const screen = await drawn('ar');
 await open(screen, 'brief.md');
 await expect.element(screen.getByText('للقراية بس. لو عايز تعديل، اطلبه من Lead في الشات.')).toBeVisible();
 await expect.element(screen.getByRole('link', { name: 'نزّل' })).toBeVisible();
 await screen.getByRole('button', { name: 'اقفل' }).click();
 await expect.poll(() => dialog()).toBeNull();
 await open(screen, 'long.txt');
 await expect.element(screen.getByText('ده أول جزء بس. الملف كامل 600 KB.')).toBeVisible();
});
