import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cdp, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import type {} from '@vitest/browser-playwright';
import NewCard from '@/app/c/[slug]/[[...section]]/new-card';
import { LanguageProvider } from '@/lib/i18n-client';
import { MemberPicker } from '@/lib/work-activity';
import { sent, showWork, workProps } from './work-page';

const push = vi.hoisted(() => vi.fn<(href: string) => void>());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board' }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ decideAgentRule: vi.fn(), answerAgentRequest: vi.fn() }));
vi.mock('@/app/note-actions', () => ({ editNote: vi.fn() }));
afterEach(async () => { push.mockReset(); await cdp().send('Emulation.setEmulatedMedia', { features: [] }); });

type Screen = Awaited<ReturnType<typeof showWork>>;
const dialog = (screen: Screen) => screen.getByRole('dialog');

test('on the board, + New card opens the new-card dialog and Escape closes it; + on Ideas opens the idea form instead', async () => {
 const screen = await showWork(workProps());
 await screen.getByRole('button', { name: '+ New card' }).click();
 await expect.element(dialog(screen)).toBeVisible();
 await userEvent.keyboard('{Escape}');
 await expect.element(dialog(screen)).not.toBeInTheDocument();
 await screen.getByRole('button', { name: 'Add an idea' }).click();
 await expect.element(screen.getByLabelText('Idea')).toBeVisible();
 await expect.element(dialog(screen)).not.toBeInTheDocument();
 expect(push).not.toHaveBeenCalled();
});

for (const view of ['list', 'calendar']) test(`on the ${view}, the new-card dialog closes in place with Escape and with Close`, async () => {
 const screen = await showWork(workProps({ section: `work/${view}` }));
 await screen.getByRole('button', { name: '+ New card' }).click();
 await expect.element(dialog(screen)).toBeVisible();
 await userEvent.keyboard('{Escape}');
 await expect.element(dialog(screen)).not.toBeInTheDocument();
 await screen.getByRole('button', { name: '+ New card' }).click();
 await dialog(screen).getByRole('button', { name: 'Close', exact: true }).click();
 await expect.element(dialog(screen)).not.toBeInTheDocument();
 expect(push).not.toHaveBeenCalled();
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

// #174, #188: a Card started in a column's own quick form carries the template it asks for. The board's "+" on Ideas
// opens the column's idea form since #188, so the quick form is mounted here with the Ideas stage, as the board used to
// open it: the form is what this guards, and the template's checklist is supabase/tests/work.sql's.
test('a card started with the reel template asks for that template and sends it', async () => {
 const props = workProps();
 const screen = await render(<LanguageProvider language="en"><NewCard slug="rs-learning" company="co-1" agents={[]} members={[{ person_id: 'p-1', people: { name: 'Omar' } }]} stage={1} fromRoute={false} workAction={props.workAction} onClose={() => {}}/></LanguageProvider>);
 await userEvent.fill(screen.getByLabelText('Card title'), 'اختبار ريل');
 await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Template/ }), 'reel');
 await screen.getByRole('button', { name: 'Create card' }).click();
 await expect.poll(() => sent(props)).toEqual([{ op: 'create', slug: 'rs-learning', company: 'co-1', stage: '1', title: 'اختبار ريل', template: 'reel' }]);
});

// A picker whose saved person was removed from the Company (moved from member-picker.spec.ts, #218; then from
// components/card-detail.test.tsx with the Card page, #678, to the New card form that still uses it): with an empty
// choice it sends nothing, so a save clears them; without one it sends the first member.
for (const empty of ['Not specified', undefined]) test(`a removed MemberPicker default ${empty ? 'leaves the hidden input empty' : 'selects the first member'}`, async () => {
 const screen = await render(<LanguageProvider language="en"><form>
  <MemberPicker members={[{ person_id: 'first', people: { name: 'First member' } }]} name="person" label="Next actor" defaultValue="removed" empty={empty}/>
 </form></LanguageProvider>);
 const shown = screen.getByRole('button', { name: 'Next actor' });
 await expect.element(shown).toBeVisible();
 expect(shown.element().querySelector(':scope > bdi')!.textContent).toBe(empty ?? 'First member');
 expect(new FormData(document.querySelector('form')!).get('person')).toBe(empty ? '' : 'first');
});
