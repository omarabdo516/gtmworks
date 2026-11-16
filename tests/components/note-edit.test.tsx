import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { NoteText, type EditableNote } from '@/app/note-edit';
import { editNote } from '@/app/note-actions';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';

vi.mock('@/app/note-actions', () => ({ editNote: vi.fn() }));
const saved = vi.mocked(editNote);
beforeEach(() => { saved.mockReset(); });

const writer = 'p-1', reader = 'p-2';
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const note = (more: Partial<EditableNote> = {}): EditableNote => ({ id: 41, body: 'First draft', created_at: ago(60000), edited_at: null, author_id: writer, ...more });
const show = (value: EditableNote, { me = writer, canWrite = true, language = 'en' as Language } = {}) =>
 render(<LanguageProvider language={language}><NoteText note={value} me={me} canWrite={canWrite} company="co-1" slug="rs-learning" drawnAt={Date.now()} surface="log" meta={<time>09:05</time>}/></LanguageProvider>);

test('its writer edits a note in its first five minutes: an empty note is refused, the new text is saved, and the page says so', async () => {
 saved.mockResolvedValue('noteSaved');
 const screen = await show(note());
 await expect.element(screen.getByText('First draft')).toBeVisible();
 await expect.element(screen.getByText(/^You can edit it for 4:\d\d$/)).toBeVisible();
 await expect.element(screen.getByText('Locked')).not.toBeInTheDocument();
 await screen.getByRole('button', { name: 'Edit' }).click();
 const field = screen.getByRole('textbox', { name: 'Edit the note' });
 await expect.element(field).toHaveValue('First draft');
 await expect.element(field).toHaveFocus();
 await userEvent.clear(field);
 await screen.getByRole('button', { name: 'Save' }).click();
 await expect.element(screen.getByText('A note can’t be empty. Write something, or cancel the edit.')).toBeVisible();
 await expect.element(field).toHaveAttribute('aria-invalid', 'true');
 expect(saved).not.toHaveBeenCalled();
 await userEvent.type(field, 'Second draft');
 await screen.getByRole('button', { name: 'Save' }).click();
 await expect.element(screen.getByRole('status')).toHaveTextContent('Note edited; it now carries an “Edited” mark');
 expect(saved).toHaveBeenCalledExactlyOnceWith({ company: 'co-1', slug: 'rs-learning', note: 41, body: 'Second draft' });
 await expect.element(screen.getByRole('textbox')).not.toBeInTheDocument();
 await expect.element(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
});

test('Cancel puts the note back as it was and saves nothing', async () => {
 const screen = await show(note());
 await screen.getByRole('button', { name: 'Edit' }).click();
 await userEvent.type(screen.getByRole('textbox', { name: 'Edit the note' }), ' and more');
 await screen.getByRole('button', { name: 'Cancel' }).click();
 await expect.element(screen.getByText('First draft')).toBeVisible();
 expect(saved).not.toHaveBeenCalled();
});

test.each([['its writer', writer], ['another Member', reader]])('after five minutes a note is locked for %s, and an edited one says so', async (_, me) => {
 const screen = await show(note({ created_at: ago(5 * 60000 + 1000), edited_at: ago(5 * 60000) }), { me });
 await expect.element(screen.getByText('Locked')).toBeVisible();
 await expect.element(screen.getByText('Locked')).toHaveAttribute('title', 'More than 5 minutes have passed, so it can’t be edited');
 await expect.element(screen.getByText('Edited')).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
});

test.each([['another Member', reader, true], ['a Viewer', writer, false]] as const)('%s reads an open note with no Edit and no countdown', async (_, me, canWrite) => {
 const screen = await show(note(), { me, canWrite });
 await expect.element(screen.getByText('First draft')).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
 await expect.element(screen.getByText(/You can edit it for/)).not.toBeInTheDocument();
 await expect.element(screen.getByText('Locked')).not.toBeInTheDocument();
});

test('the time running out while its writer edits locks the note as it was', async () => {
 const screen = await show(note({ created_at: ago(5 * 60000 - 1500) }));
 await screen.getByRole('button', { name: 'Edit' }).click();
 await userEvent.type(screen.getByRole('textbox', { name: 'Edit the note' }), ' too late');
 await expect.element(screen.getByRole('status'), { timeout: 4000 }).toHaveTextContent('The 5 minutes are up; the note is locked as it was');
 await expect.element(screen.getByRole('textbox')).not.toBeInTheDocument();
 await expect.element(screen.getByText('First draft')).toBeVisible();
 await expect.element(screen.getByText('Locked')).toBeVisible();
 expect(saved).not.toHaveBeenCalled();
});

test('a save the database refuses as too late says the note stayed as it was', async () => {
 saved.mockResolvedValue('noteLockedBeforeSave');
 const screen = await show(note());
 await screen.getByRole('button', { name: 'Edit' }).click();
 await userEvent.type(screen.getByRole('textbox', { name: 'Edit the note' }), '!');
 await screen.getByRole('button', { name: 'Save' }).click();
 await expect.element(screen.getByRole('status')).toHaveTextContent('The 5 minutes ran out before you saved; the note is locked as it was');
 await expect.element(screen.getByText('First draft')).toBeVisible();
});

test('a save that fails keeps the field and its text, and says so', async () => {
 saved.mockResolvedValue('couldNotSaveTheChangeCheckPermissionsAnd');
 const screen = await show(note());
 await screen.getByRole('button', { name: 'Edit' }).click();
 await userEvent.type(screen.getByRole('textbox', { name: 'Edit the note' }), ' and more');
 await screen.getByRole('button', { name: 'Save' }).click();
 await expect.element(screen.getByRole('status')).toHaveTextContent('Could not save the change. Check permissions and try again.');
 await expect.element(screen.getByRole('textbox', { name: 'Edit the note' })).toHaveValue('First draft and more');
});

test('in Arabic an open note offers the reference\'s Edit and time left', async () => {
 const screen = await show(note(), { language: 'ar' });
 await expect.element(screen.getByRole('button', { name: 'عدّل' })).toBeVisible();
 await expect.element(screen.getByText(/^تقدر تعدّلها لمدة 4:\d\d$/)).toBeVisible();
});

test('in Arabic a locked, edited note says so in the reference\'s words', async () => {
 const screen = await show(note({ created_at: ago(6 * 60000), edited_at: ago(5 * 60000) }), { language: 'ar' });
 await expect.element(screen.getByText('اتقفلت')).toBeVisible();
 await expect.element(screen.getByText('اتعدّلت')).toBeVisible();
});
