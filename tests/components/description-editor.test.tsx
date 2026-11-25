import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import DescriptionEditor, { type DescriptionSaved, type PictureUploaded } from '@/app/description-editor';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/card-window.css';

// #680: the description written where it is read (design-reference-card: deEdit, the "/" menu).
const save = vi.fn<(body: string, base: number) => Promise<DescriptionSaved>>(async (body, base) => ({ version: base + 1, body, merged: false, conflicted: false }));
const upload = vi.fn<(form: FormData) => Promise<PictureUploaded>>(async () => ({ url: '/c/rs-learning/files/41', name: 'logo.png' }));
const done = vi.fn();
afterEach(() => { save.mockReset(); save.mockImplementation(async (body, base) => ({ version: base + 1, body, merged: false, conflicted: false })); upload.mockClear(); done.mockClear(); });

const brief = '# Brief\n\nSome **bold** text and [a link](https://example.com).\n\n* [ ] Write the hook\n* [x] Pick the format\n  * Nested note\n\n> A quote\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```\nnpm run\n```\n\n![Logo](/c/rs-learning/files/12)';
const people = [{ id: 'p-2', name: 'Salma', kind: 'person' as const }, { id: 'ads', name: 'Ads', kind: 'agent' as const }];
async function show(body = brief) {
 const screen = await render(<LanguageProvider language="en"><div className="gw"><section className="cw-desc-sec">
  <DescriptionEditor body={body} version={4} slug="rs-learning" company="co-1" card={7} people={people} save={save} upload={upload} onDone={done}/>
 </section></div></LanguageProvider>);
 const editor = document.querySelector<HTMLElement>('.de--edit .ProseMirror')!;
 await expect.poll(() => editor && editor.isConnected && editor.textContent?.length).toBeGreaterThanOrEqual(body ? 1 : 0);
 return { screen, editor };
}
const lastSaved = async () => { await expect.poll(() => save.mock.calls.length, { timeout: 4000 }).toBeGreaterThan(0); return save.mock.lastCall![0]; };
const caretAtEnd = (editor: HTMLElement) => { editor.focus(); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); };

test('what is written saves as Markdown and reads back the same, every block kept', async () => {
 const { editor } = await show();
 expect(editor.querySelector('h1')?.textContent).toBe('Brief');
 expect(editor.querySelectorAll('li[data-item-type="task"]')).toHaveLength(2);
 expect(editor.querySelector('table')).not.toBeNull();
 caretAtEnd(editor);
 await userEvent.keyboard('{Enter}Added line');
 const saved = await lastSaved();
 expect(save.mock.lastCall![1]).toBe(4);
 for (const part of ['# Brief', '**bold**', '[a link](https://example.com)', '[ ] Write the hook', '[x] Pick the format', 'Nested note', '> A quote', '| A | B |', 'npm run', '![Logo](/c/rs-learning/files/12)', 'Added line']) expect(saved).toContain(part);
 // Saved twice over, the text is the same: the editor reads back what it wrote.
 const { editor: again } = await show(saved.replace('\nAdded line', ''));
 expect(again.querySelectorAll('li[data-item-type="task"]')).toHaveLength(2);
});

test('"/" at a line\'s start opens the blocks, filtered as typed, and Enter puts a to-do there', async () => {
 const { screen, editor } = await show('First');
 caretAtEnd(editor);
 await userEvent.keyboard('{Enter}/');
 await expect.element(screen.getByRole('listbox', { name: 'Blocks' })).toBeVisible();
 await userEvent.keyboard('to');
 await expect.element(screen.getByRole('option', { name: 'To-do' })).toHaveAttribute('aria-selected', 'true');
 await userEvent.keyboard('{Enter}Ship it');
 await expect.poll(() => editor.querySelector('li[data-item-type="task"]')?.textContent).toBe('Ship it');
 expect(await lastSaved()).toMatch(/\[ \] Ship it/);
 expect(editor.textContent).not.toContain('/to');
});

test('typed shortcuts make headings, lists and quotes, and Tab nests a list item', async () => {
 const { editor } = await show('Start');
 caretAtEnd(editor);
 await userEvent.keyboard('{Enter}## Part{Enter}- one{Enter}two');
 await userEvent.keyboard('{Tab}');
 await expect.poll(() => editor.querySelector('h2')?.textContent).toBe('Part');
 await expect.poll(() => editor.querySelector('ul ul li')?.textContent).toBe('two');
 const saved = await lastSaved();
 expect(saved).toMatch(/## Part/);
 expect(saved).toMatch(/\n {2,4}[-*] two/);
});

test('@ calls a Member or an Agent by name', async () => {
 const { screen, editor } = await show('Ask');
 caretAtEnd(editor);
 await userEvent.keyboard(' @Sa');
 await expect.element(screen.getByRole('option', { name: 'Salma' })).toBeVisible();
 await userEvent.keyboard('{Enter}');
 expect(await lastSaved()).toBe('Ask @Salma ');
});

test('Alt+Shift+Up and Down move a line among its neighbours', async () => {
 const { editor } = await show('One\n\nTwo\n\nThree');
 caretAtEnd(editor);
 await userEvent.keyboard('{Alt>}{Shift>}{ArrowUp}{/Shift}{/Alt}');
 await expect.poll(() => [...editor.querySelectorAll('p')].map(p => p.textContent)).toEqual(['One', 'Three', 'Two']);
});

test('a paste mixing plain and formatted text loses nothing', async () => {
 const { editor } = await show('Pasted:');
 caretAtEnd(editor);
 const data = new DataTransfer();
 data.setData('text/html', 'plain words <b>bold words</b> and <i>slanted</i> end');
 data.setData('text/plain', 'plain words bold words and slanted end');
 editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
 const saved = await lastSaved();
 expect(saved).toContain('plain words');
 expect(saved).toContain('**bold words**');
 expect(saved).toContain('slanted');
 expect(saved).toContain('end');
});

test('a save merged with another writer\'s shows the merged text and says both were kept', async () => {
 save.mockImplementation(async (body, base) => ({ version: base + 2, body: `Their line\n\n${body}`, merged: true, conflicted: true }));
 const { screen, editor } = await show('Mine');
 caretAtEnd(editor);
 await userEvent.keyboard(' too');
 await expect.poll(() => [...editor.querySelectorAll('p')].map(p => p.textContent)).toEqual(['Their line', 'Mine too']);
 await expect.element(screen.getByRole('status')).toHaveTextContent('You and someone else changed the same line; both are kept');
});

test('each line takes its own direction while writing, and HTML stays its own text', async () => {
 const { editor } = await show('اكتب الخطاف\n\nWrite the caption\n\n<b>raw</b>');
 const lines = [...editor.querySelectorAll('p')];
 expect(lines.slice(0, 2).map(p => p.getAttribute('dir'))).toEqual(['auto', 'auto']);
 expect(editor.querySelector('b')).toBeNull();
 expect(editor.textContent).toContain('<b>raw</b>');
});

test('Done closes the editor after saving what is left', async () => {
 const { screen, editor } = await show('Last');
 caretAtEnd(editor);
 await userEvent.keyboard('!');
 await screen.getByRole('button', { name: 'Done' }).click();
 expect(done).toHaveBeenCalled();
 expect(await lastSaved()).toBe('Last!');
});
