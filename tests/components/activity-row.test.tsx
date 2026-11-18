import { afterEach, expect, test, vi } from 'vitest';
import { act, type ComponentProps } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { render } from 'vitest-browser-react';
import { cdp } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { ActivityRow, type WorkActivity } from '@/lib/work-activity';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/globals.css';

vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
const zone = (timezoneId: string) => cdp().send('Emulation.setTimezoneOverride', { timezoneId });
afterEach(() => zone(''));

const row = (activity: Partial<WorkActivity>) => <LanguageProvider language="en">
 <ActivityRow activity={{ id: 1, card_id: 1, action: 'card_created', details: {}, created_at: '2026-11-12T22:30:00Z', actor_id: 'p-1', evidence: null, ...activity }} members={[{ person_id: 'p-1', people: { name: 'Omar' } }]} slug="rs-learning"/>
</LanguageProvider>;

test('a changed publishing date reads as the day it moved to, and a changed Offering as its new text', async () => {
 const screen = await render(<>
  {row({ action: 'card_changed', details: { field: 'go_live', old: '2032-11-10T12:00:00+00:00', new: '2032-11-12T12:00:00+00:00' } })}
  {row({ id: 2, action: 'card_changed', details: { field: 'offering', old: '', new: 'عرض للاختبار' } })}
  {/* "Undo" on a move (#168) reads as the way back, naming both stages. */}
  {row({ id: 3, action: 'card_moved_back', details: { old_name: 'بريف جاهز', new_name: 'كتابة' } })}
 </>);
 await expect.element(screen.getByText('Updated publishing date: November 12', { exact: true })).toBeVisible();
 await expect.element(screen.getByText('Updated Offering: عرض للاختبار', { exact: true })).toBeVisible();
 await expect.element(screen.getByText('Moved the card back from بريف جاهز to كتابة', { exact: true })).toBeVisible();
});

// The server runs in UTC; the viewer is in Cairo, two hours ahead in November, where 22:30 UTC is already the next day.
test('a time the server drew in UTC shows in the viewer\'s own zone once the page hydrates, with no hydration error', async () => {
 await zone('UTC');
 const view = row({});
 const host = document.body.appendChild(document.createElement('div'));
 host.innerHTML = renderToString(view);
 const time = () => host.querySelector('time')!;
 expect(getComputedStyle(time()).visibility, 'hidden until the viewer\'s zone is known').toBe('hidden');
 await zone('Africa/Cairo');
 const recoverable = vi.fn();
 const root = await act(async () => hydrateRoot(host, view, { onRecoverableError: recoverable }));
 try {
  await expect.poll(() => time().textContent).toBe('November 13 at 12:30 AM');
  expect(getComputedStyle(time()).visibility).toBe('visible');
  expect(recoverable).not.toHaveBeenCalled();
 } finally { act(() => root.unmount()); host.remove(); }
});
