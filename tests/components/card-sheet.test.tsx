import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { CardSheet, type CardSheetData } from '@/app/card-sheet';
import { workAction } from '@/app/c/[slug]/[[...section]]/work-actions';
import { LanguageProvider } from '@/lib/i18n-client';

const push = vi.fn<(href: string, options?: { scroll?: boolean }) => void>();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/work-actions', () => ({ workAction: vi.fn() }));
const sent = vi.mocked(workAction);
afterEach(() => { push.mockReset(); sent.mockReset(); vi.unstubAllGlobals(); });

const sheet = (more: Partial<CardSheetData> = {}): CardSheetData => ({ id: 7, log: <p>Omar moved the card</p>, count: 3, working: false, chat: null, ...more });
// The board behind the sheet holds the Card's link, where the keyboard goes back when the sheet closes.
const show = (value: CardSheetData, canWrite = true) => render(<LanguageProvider language="en">
 <div id="board-cols"><div className="kcard" data-card-id="7"><a href="#card-7">Launch post</a></div></div>
 <CardSheet slug="rs-learning" company="co-1" title="Launch post" face={null} who={<bdi>Ads</bdi>} badge={<span className="badge">Ideas</span>} sheet={value} canWrite={canWrite} alone={false}/>
</LanguageProvider>);
const dialog = () => document.querySelector('dialog')!;

test('a Card opens as a modal sheet on its Log, with the count, the note field ready and the Card page one link away', async () => {
 const screen = await show(sheet());
 await expect.element(screen.getByRole('dialog', { name: 'Launch post' })).toBeVisible();
 expect(dialog().matches(':modal')).toBe(true);
 await expect.element(screen.getByRole('tab', { name: 'Log 3' })).toHaveAttribute('aria-selected', 'true');
 await expect.element(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-disabled', 'true');
 await expect.element(screen.getByRole('tabpanel', { name: 'Log 3' })).toHaveTextContent('Omar moved the card');
 await expect.element(screen.getByRole('textbox', { name: 'Write a note in the card’s log' })).toHaveFocus();
 await expect.element(screen.getByRole('link', { name: 'Card details' })).toHaveAttribute('href', '/c/rs-learning/work/board/7');
 await expect.element(screen.getByRole('link', { name: 'Open in Chats' })).not.toBeInTheDocument();
});

test('Close slides the sheet out before it closes, then the board comes back with the keyboard on the Card', async () => {
 const screen = await show(sheet());
 await screen.getByRole('button', { name: 'Close', exact: true }).click();
 expect(dialog().open).toBe(true);
 expect(dialog().classList.contains('is-closing')).toBe(true);
 expect(push).not.toHaveBeenCalled();
 await expect.poll(() => push.mock.calls).toEqual([['/c/rs-learning/work/board', { scroll: false }]]);
 expect(dialog().open).toBe(false);
 await expect.element(screen.getByRole('link', { name: 'Launch post' })).toHaveFocus();
});

test('with reduced motion the sheet closes at once', async () => {
 vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
 const screen = await show(sheet());
 await screen.getByRole('button', { name: 'Close', exact: true }).click();
 expect(dialog().open).toBe(false);
 expect(dialog().classList.contains('is-closing')).toBe(false);
 await expect.poll(() => push.mock.calls).toEqual([['/c/rs-learning/work/board', { scroll: false }]]);
});

test('Escape closes the sheet and returns to the board', async () => {
 await show(sheet());
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => push.mock.calls).toEqual([['/c/rs-learning/work/board', { scroll: false }]]);
 expect(dialog().open).toBe(false);
});

test('a note is sent from the Log tab with Enter, then the field is empty again', async () => {
 sent.mockResolvedValue(undefined);
 const screen = await show(sheet());
 const field = screen.getByRole('textbox', { name: 'Write a note in the card’s log' });
 const send = screen.getByRole('button', { name: 'Add the note' });
 await expect.element(send).toBeDisabled();
 await userEvent.type(field, 'Ready for review{Enter}');
 await expect.poll(() => sent.mock.calls.length).toBe(1);
 const form = sent.mock.calls[0][0];
 expect(Object.fromEntries(form)).toEqual({ op: 'comment', slug: 'rs-learning', company: 'co-1', card: '7', view: 'sheet', body: 'Ready for review' });
 await expect.element(field).toHaveValue('');
 await expect.element(send).toBeDisabled();
});

test('a Viewer reads the log with no note field', async () => {
 const screen = await show(sheet(), false);
 await expect.element(screen.getByRole('tabpanel', { name: 'Log 3' })).toBeVisible();
 await expect.element(screen.getByRole('textbox')).not.toBeInTheDocument();
 await expect.element(screen.getByText('Your account is view-only: you can read the whole log, without writing notes.')).toBeVisible();
});

test('a Card tied to a Conversation opens on Chat and links to it', async () => {
 const screen = await show(sheet({ chat: { conversationId: 'c0ffee00-0000-0000-0000-000000000001' } }));
 await expect.element(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
 await expect.element(screen.getByRole('tab', { name: 'Chat' })).not.toHaveAttribute('aria-disabled');
 await expect.element(screen.getByRole('link', { name: 'Open in Chats' }).first()).toHaveAttribute('href', '/c/rs-learning/conversations/c0ffee00-0000-0000-0000-000000000001');
 await screen.getByRole('tab', { name: 'Log 3' }).click();
 await expect.element(screen.getByRole('textbox', { name: 'Write a note in the card’s log' })).toBeVisible();
});
