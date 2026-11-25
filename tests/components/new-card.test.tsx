import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cdp, userEvent } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { cardsSent, showWork, workProps } from './work-page';

// #683: one New card form, for the toolbar's button (Planned) and the Ideas column's "+" (Ideas) (design-reference-card:
// ncOpen): a title, a description written as in a Card, an assignee or no one, files; made once per request key.
const push = vi.hoisted(() => vi.fn<(href: string) => void>());
const replace = vi.hoisted(() => vi.fn<(href: string, options?: unknown) => void>());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace, prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ decideAgentRule: vi.fn(), answerAgentRequest: vi.fn() }));
vi.mock('@/app/note-actions', () => ({ editNote: vi.fn() }));
afterEach(async () => { push.mockReset(); replace.mockReset(); await cdp().send('Emulation.setEmulatedMedia', { features: [] }); });

type Screen = Awaited<ReturnType<typeof showWork>>;
const dialog = (screen: Screen) => screen.getByRole('dialog');

test('New card opens the one form with the title ready; Escape closes it; the Ideas "+" opens the same form', async () => {
 const screen = await showWork(workProps());
 await screen.getByRole('button', { name: 'New card' }).click();
 await expect.element(dialog(screen)).toBeVisible();
 await expect.element(dialog(screen).getByRole('textbox', { name: 'Title' })).toHaveFocus();
 await expect.element(dialog(screen).getByLabelText('Description')).toBeVisible();
 await userEvent.keyboard('{Escape}');
 await expect.element(dialog(screen)).not.toBeInTheDocument();
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 await expect.element(dialog(screen).getByRole('textbox', { name: 'Title' })).toBeVisible();
 expect(push).not.toHaveBeenCalled();
});

test('a title is needed; a Card is sent with its description, assignee and status, once per key, and the board shows it', async () => {
 const props = workProps({ cardAgents: [{ id: 'ads', connection_id: 'c-1', name: 'Ads', speciality: 'Meta ads' }] });
 const screen = await showWork(props);
 await screen.getByRole('button', { name: 'New card' }).click();
 await dialog(screen).getByRole('button', { name: 'Add card' }).click();
 await expect.element(dialog(screen).getByText('Write a title for the card, even two words.')).toBeVisible();
 expect(props.newCard).not.toHaveBeenCalled();
 await dialog(screen).getByRole('textbox', { name: 'Title' }).fill('Spring launch post');
 const editor = document.querySelector<HTMLElement>('.nc .ProseMirror')!;
 await expect.poll(() => document.querySelector('.nc .ProseMirror')).not.toBeNull();
 document.querySelector<HTMLElement>('.nc .ProseMirror')!.focus();
 await userEvent.keyboard('- [[ ] Hook');
 await expect.poll(() => editor?.isConnected ?? true).toBe(true);
 await dialog(screen).getByRole('button', { name: /^Assignee:/ }).click();
 await screen.getByRole('menuitemradio', { name: 'Ads' }).click();
 await new Promise(done => setTimeout(done, 900));
 await dialog(screen).getByRole('button', { name: 'Add card' }).click();
 await expect.poll(() => cardsSent(props).length).toBe(1);
 expect(cardsSent(props)[0]).toMatchObject({ title: 'Spring launch post', status: 'planned', assignee: 'a:ads', description: '* [ ] Hook' });
 expect(cardsSent(props)[0].key).toMatch(/^[0-9a-f-]{36}$/);
 await expect.poll(() => replace.mock.calls[0]?.[0]).toBe('/c/rs-learning/work/board?show=9&added=1');
});

test('from the Ideas "+" a Card is sent into Ideas, and a refusal keeps the form open with its reason', async () => {
 const props = workProps({ newCard: vi.fn(async () => ({ error: 'The card could not be added.' })) });
 const screen = await showWork(props);
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 await dialog(screen).getByRole('textbox', { name: 'Title' }).fill('An idea');
 await dialog(screen).getByRole('button', { name: 'Add card' }).click();
 await expect.element(dialog(screen).getByRole('alert')).toHaveTextContent('The card could not be added.');
 expect(Object.fromEntries(vi.mocked(props.newCard).mock.calls[0][0])).toMatchObject({ title: 'An idea', status: 'ideas', assignee: '' });
});

test('the dialog opened at /work/new goes to the board when it closes', async () => {
 const screen = await showWork(workProps({ section: 'work/new', initialCreating: true }));
 await expect.element(dialog(screen)).toBeVisible();
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => push.mock.calls).toEqual([['/c/rs-learning/work/board']]);
});

for (const language of ['en', 'ar'] as const) for (const width of [1440, 390]) test(`in ${language} at ${width}px the dialog opened at /work/new fits the window, and Close closes it`, async () => {
 await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
 const screen = await showWork(workProps({ section: 'work/new', initialCreating: true }), { language, width });
 await expect.element(dialog(screen)).toBeInViewport({ ratio: 1 });
 await expect.poll(() => { const box = dialog(screen).element().getBoundingClientRect(); return box.left >= 0 && box.top >= 0 && box.right <= width && box.bottom <= 900; }).toBe(true);
 await dialog(screen).getByRole('button', { name: language === 'en' ? 'Close' : 'إغلاق', exact: true }).click();
 await expect.element(dialog(screen)).not.toBeInTheDocument();
});
