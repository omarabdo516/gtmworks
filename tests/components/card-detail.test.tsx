import { expect, test, vi } from 'vitest';
import { act, type ComponentProps } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { page, userEvent } from 'vitest/browser';
import Work from '@/app/c/[slug]/[[...section]]/work';
import { LanguageProvider } from '@/lib/i18n-client';
import { card, sent, showWork, workProps } from './work-page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board/1' }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ decideAgentRule: vi.fn(), answerAgentRequest: vi.fn() }));
vi.mock('@/app/note-actions', () => ({ editNote: vi.fn() }));

const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
const section = (name: string) => box(`[data-card-section="${name}"]`);

for (const language of ['en', 'ar'] as const) for (const width of [390, 1440]) test(`in ${language} at ${width}px the Card's title reads on one line, and its 44px Close sits in the title's row at the inline end and leads back to the board`, async () => {
 const screen = await showWork(workProps({ cardId: 1 }), { language, width });
 const close = screen.getByRole('link', { name: language === 'en' ? 'Close' : 'إغلاق', exact: true });
 await expect.element(close).toHaveAttribute('href', '/c/rs-learning/work/board');
 await expect.element(close).toBeInViewport({ ratio: 1 });
 await expect.element(screen.getByRole('heading', { level: 2, name: 'أفكار لمحتوى الشهر' })).toBeInViewport({ ratio: 1 });
 const heading = document.querySelector('.card-detail h2')!, range = document.createRange();
 range.selectNodeContents(heading);
 const text = range.getBoundingClientRect(), title = heading.getBoundingClientRect(), x = close.element().getBoundingClientRect();
 expect({ fits: text.left >= title.left && text.right <= title.right, lines: new Set([...range.getClientRects()].map(rect => Math.round(rect.y))).size }).toEqual({ fits: true, lines: 1 });
 expect([x.width, x.height].every(side => side >= 44), 'Close is a 44px target').toBe(true);
 expect(x.top <= title.top && x.bottom > title.top, 'Close starts in the title\'s row').toBe(true);
 expect(language === 'ar' ? x.right <= title.left + 1 : title.right <= x.left + 1, 'Close at the inline end').toBe(true);
});

for (const language of ['en', 'ar'] as const) test(`in ${language} a Card's stage, next actor, assignees and labels come right under the title on a phone, and beside the record on a wide screen`, async () => {
 await showWork(workProps({ cardId: 1 }), { language, width: 390 });
 const title = box('.card-detail h2'), stage = section('stage'), actor = section('next-actor'), assignees = section('assignees'), labels = section('labels'), form = box('.modal-grid > div form');
 const order = [title, stage, actor, assignees, labels, form].map(item => item.y);
 expect(order).toEqual([...order].sort((a, b) => a - b));
 expect(new Set(order).size).toBe(order.length);
 expect(stage.y).toBeGreaterThanOrEqual(title.bottom);
 expect(labels.bottom).toBeLessThanOrEqual(form.y);
 expect(actor.bottom, 'the next actor is on the first screen').toBeLessThanOrEqual(900);
 await page.viewport(1440, 900);
 const wide = section('stage'), record = box('.modal-grid > div form');
 expect(wide.y).toBeLessThanOrEqual(260);
 expect(language === 'ar' ? wide.right <= record.left + 1 : wide.left >= record.right - 1, 'the stage sits beside the record, at its inline end').toBe(true);
 expect(wide.y).toBeLessThan(record.bottom);
});

test('on a phone a Card waiting for my decision keeps the decision after the record, below the edit form', async () => {
 await showWork(workProps({ cardId: 1, cards: [card({ stage_id: 4 })], approvableIds: [1] }), { width: 390 });
 const labels = section('labels'), form = box('.modal-grid > div form'), review = section('review');
 expect(labels.bottom).toBeLessThanOrEqual(form.y);
 expect(review.y).toBeGreaterThan(form.bottom);
});

test('on a phone the stage list and the checklist boxes are 44px tall, every control of the Card is labelled, and the note field is reached by scrolling', async () => {
 const screen = await showWork(workProps({ cardId: 1 }), { width: 390 });
 expect(screen.getByLabelText('Move to list', { exact: true }).element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
 expect(box('.checklist input[type=checkbox]').height).toBeGreaterThanOrEqual(44);
 for (const name of ['Next actor', 'Add assignee', 'Add label', 'New design file', 'Comment']) await expect.element(screen.getByLabelText(name, { exact: true })).toBeVisible();
 const comment = screen.getByLabelText('Comment', { exact: true });
 comment.element().scrollIntoView();
 await expect.element(comment).toBeInViewport({ ratio: 1 });
});

for (const width of [390, 1440]) test(`at ${width}px the caption is a box at least four lines tall that sends every line and reads Arabic right to left; the other fields stay one line`, async () => {
 const props = workProps({ cardId: 1 });
 const screen = await showWork(props, { width });
 const caption = screen.getByLabelText('Caption', { exact: true });
 const field = caption.element() as HTMLTextAreaElement;
 expect([field.tagName, field.name]).toEqual(['TEXTAREA', 'caption']);
 expect(field.getBoundingClientRect().height).toBeGreaterThanOrEqual(parseFloat(getComputedStyle(field).lineHeight) * 4);
 for (const name of ['title', 'offering', 'segment', 'hook', 'channel', 'goal']) expect(document.querySelector(`.modal-grid form [name=${name}]`)!.tagName, `${name} stays one line`).toBe('INPUT');
 const arabic = 'السطر الأول\nالسطر الثاني\nالسطر الثالث';
 await userEvent.fill(caption, arabic);
 expect(getComputedStyle(field).direction).toBe('rtl');
 await screen.getByRole('button', { name: 'Save changes' }).click();
 await expect.poll(() => sent(props).map(form => [form.op, form.caption])).toEqual([['edit', arabic]]);
});

test('the stage list stays disabled until the page hydrates, then a choice moves the Card at once', async () => {
 const props = workProps({ cardId: 1 });
 const view = <LanguageProvider language="en"><Work {...props}/></LanguageProvider>;
 const host = document.body.appendChild(document.createElement('div'));
 host.innerHTML = renderToString(view);
 const stage = () => host.querySelector<HTMLSelectElement>('select[aria-label="Move to list"]')!;
 expect(stage().disabled, 'drawn by the server').toBe(true);
 const root = await act(async () => hydrateRoot(host, view));
 try {
  await expect.poll(() => stage().disabled).toBe(false);
  await userEvent.selectOptions(stage(), 'مراجعة');
  await expect.poll(() => sent(props)).toEqual([{ op: 'move', slug: 'rs-learning', company: 'co-1', card: '1', view: 'card', stage: '4' }]);
 } finally { act(() => root.unmount()); host.remove(); }
});
