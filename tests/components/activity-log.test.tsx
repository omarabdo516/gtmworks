import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { LogFilters } from '@/app/c/[slug]/log/log-client';
import { LogEmpty } from '@/app/c/[slug]/log/parts';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n } from '@/lib/i18n.mjs';
import { logEmptyNote } from '@/lib/activity-log.mjs';

// The Activity log's filters and its empty note, as the page draws them (moved from activity-log.spec.ts, #218). A
// choice reloads the page with the filter in its address, so the router's push is what a choice does.
const push = vi.hoisted(() => vi.fn<(href: string) => void>());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { push.mockClear(); });

const gone = 'a:ffffffff-ffff-ffff-ffff-ffffffffffff';
const people = [{ value: 'p:20000000-0000-0000-0000-000000000002', label: 'مدير' }];
const agents = [{ value: 'a:30000000-0000-0000-0000-000000000001', label: 'وكيل المحتوى' }];
const cards = [{ value: '1', label: 'Launch post' }];
const log = (who: string, card: string, total: number) => <LanguageProvider language="en">
 <LogFilters slug="rs-learning" who={who} card={card} people={people} agents={agents} cards={cards} count={0}/>
 <div className="lgp-body"><LogEmpty t={i18n('en').t} slug="rs-learning" note={logEmptyNote({ companyRows: total })}/></div>
</LanguageProvider>;
// A frame for the filters' first effect to run, as a page that has finished loading has.
const loaded = () => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));

test('a filter that matches nothing says so, still holds once the page has loaded, and offers everything back', async () => {
 const screen = await render(log(gone, 'all', 12));
 await expect.element(screen.getByText('No entries match these filters. Try “Everyone”, or another card.')).toBeVisible();
 // The filters draw their own Show everything link; the note's is the one inside the note.
 await expect.element(page.elementLocator(document.querySelector('.lgp-empty')!).getByRole('link', { name: 'Show everything' })).toHaveAttribute('href', '/c/rs-learning/log');
 await loaded();
 expect(push).not.toHaveBeenCalled();
 await expect.element(screen.getByLabelText('Who')).toHaveValue(gone);
 screen.unmount();

 // A log with no rows at all says it is empty, and has nothing to offer back.
 const empty = await render(log('all', 'all', 0));
 await expect.element(empty.getByText(/^Nothing in the log yet\./)).toBeVisible();
 expect(document.querySelector('.lgp-empty a')).toBeNull();
});

test('a filter whose person or Agent is no longer listed shows as such, and Everyone clears only it', async () => {
 const screen = await render(log(gone, '1', 12));
 const who = screen.getByLabelText('Who');
 await expect.element(who).toHaveValue(gone);
 expect((who.element() as HTMLSelectElement).selectedOptions[0].textContent).toBe('No longer listed');
 await loaded();
 expect(push).not.toHaveBeenCalled();
 await who.selectOptions('all');
 expect(push.mock.calls).toEqual([['/c/rs-learning/log?card=1']]);
 await screen.rerender(log('all', '1', 12));
 await expect.element(screen.getByLabelText('Who')).toHaveValue('all');
 await expect.element(screen.getByLabelText('Card')).toHaveValue('1');
});
