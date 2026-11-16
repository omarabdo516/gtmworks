import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { CardSheet, type CardSheetData } from '@/app/card-sheet';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/shell.css';

const push = vi.fn<(href: string, options?: { scroll?: boolean }) => void>();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
const sent = vi.fn<(form: FormData) => Promise<unknown>>();
afterEach(() => { push.mockReset(); sent.mockReset(); vi.unstubAllGlobals(); });

const sheet = (more: Partial<CardSheetData> = {}): CardSheetData => ({ id: 7, log: <p>Omar moved the card</p>, count: 3, working: false, chat: null, ...more });
// The board behind the sheet holds the Card's link, where the keyboard goes back when the sheet closes.
const show = (value: CardSheetData, canWrite = true) => render(<LanguageProvider language="en">
 <div id="board-cols"><div className="kcard" data-card-id="7"><a href="#card-7">Launch post</a></div></div>
 <CardSheet slug="rs-learning" company="co-1" title="Launch post" face={null} who={<bdi>Ads</bdi>} badge={<span className="badge">Ideas</span>} sheet={value} canWrite={canWrite} alone={false} send={sent}/>
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

// The reference's motion (design-reference/index.html: .sheet[open], .sheet.is-closing, sheetIn/sheetOut and their
// LTR twins): in over 280ms easing out, out over 190ms easing in, each 24px from the inline end with the opacity.
const motion = () => { const style = getComputedStyle(dialog()); const [move] = document.getAnimations().filter(a => (a.effect as KeyframeEffect | null)?.target === dialog());
 return { name: style.animationName, duration: style.animationDuration, easing: style.animationTimingFunction, frames: (move?.effect as KeyframeEffect | undefined)?.getKeyframes().map(k => [k.transform, k.opacity]) }; };
for (const [dir, shift, suffix] of [['rtl', '-24px', ''], ['ltr', '24px', 'Ltr']] as const) test(`in ${dir} the sheet slides in and out as the reference does`, async () => {
 document.documentElement.dir = dir;
 const screen = await render(<div className="gw"><LanguageProvider language={dir === 'rtl' ? 'ar' : 'en'}><CardSheet slug="rs-learning" company="co-1" title="Launch post" face={null} who={null} badge={null} sheet={sheet()} canWrite alone={false} send={sent}/></LanguageProvider></div>);
 expect(motion()).toEqual({ name: `sheetIn${suffix}`, duration: '0.28s', easing: 'cubic-bezier(0.2, 0, 0, 1)', frames: [[`translateX(${shift})`, '0'], ['none', '1']] });
 // Pressed in the page itself, so the leave is read inside its 190ms rather than after a driver round trip.
 (screen.getByRole('button', { name: dir === 'rtl' ? 'اقفل' : 'Close', exact: true }).element() as HTMLButtonElement).click();
 await new Promise(requestAnimationFrame);
 expect(motion()).toEqual({ name: `sheetOut${suffix}`, duration: '0.19s', easing: 'cubic-bezier(0.4, 0, 1, 1)', frames: [['none', '1'], [`translateX(${shift})`, '0']] });
 expect(getComputedStyle(dialog(), '::backdrop').animationName).toBe('none');
 document.documentElement.dir = '';
});

// The title sits at the interface's start, beside the face, whatever language it is written in (design-reference:
// renderSheetHead, bx); inside its <bdi> it keeps its own direction.
for (const [dir, language, title] of [['ltr', 'en', 'أفكار لمحتوى الشهر'], ['rtl', 'ar', 'Launch post for June']] as const) test(`a ${dir === 'ltr' ? 'Arabic title in the English' : 'English title in the Arabic'} interface starts beside the face`, async () => {
 document.documentElement.dir = dir;
 await render(<div className="gw" dir={dir}><LanguageProvider language={language}><CardSheet slug="rs-learning" company="co-1" title={title} face={<span data-face style={{ display: 'inline-block', width: 28, height: 28 }}/>} who={null} badge={null} sheet={sheet()} canWrite alone={false} send={sent}/></LanguageProvider></div>);
 const heading = document.querySelector('#sheet-title')!, text = heading.querySelector('bdi')!.getBoundingClientRect(), box = heading.getBoundingClientRect(), face = document.querySelector('[data-face]')!.getBoundingClientRect();
 expect(getComputedStyle(heading).direction).toBe(dir);
 if (dir === 'ltr') { expect(Math.abs(text.left - box.left)).toBeLessThan(1); expect(box.left).toBeGreaterThanOrEqual(face.right); }
 else { expect(Math.abs(text.right - box.right)).toBeLessThan(1); expect(box.right).toBeLessThanOrEqual(face.left); }
 document.documentElement.dir = '';
});
