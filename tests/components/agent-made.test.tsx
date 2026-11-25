import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { act, type ComponentProps } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { render } from 'vitest-browser-react';
import { cdp } from 'vitest/browser';
// Gives cdp() Playwright's session type (its send), as the config's provider does at run time.
import type {} from '@vitest/browser-playwright';
import { AgentMadeToast, ReaderTime } from '@/app/agent-made';
import { ToastHost } from '@/app/toast';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/globals.css';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/conversations/c-1' }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

// #169: the page asks the server whether this Agent's toast is still due. A true answer marks the record, so it is the
// only toast that Agent will raise; an answer that arrives after the effect was cleaned up still raises it, as React's
// development double effect cleans the first effect between its two asks.
type Reply = (response: { ok: boolean, json: () => Promise<{ shown?: boolean }> }) => void;
const answers: Reply[] = [];
const holdFetch = () => { answers.length = 0; vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { answers.push(resolve as Reply); }))); };
const asked = (agent: { id: string, name: string }) => <LanguageProvider language="en"><AgentMadeToast company="co-1" slug="rs-learning" agent={agent}/></LanguageProvider>;
afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); answers.length = 0; });

test('an answer that says the toast is due raises it even when it arrives after the effect was cleaned up, and a later ask adds no second one', async () => {
 holdFetch();
 await render(<LanguageProvider language="en"><ToastHost/></LanguageProvider>);
 const first = await render(asked({ id: 'a-1', name: 'Meta Ads' }));
 await expect.poll(() => answers.length).toBe(1);
 // The first effect is cleaned up before its answer arrives: the record is already marked shown with this answer.
 await first.unmount();
 answers[0]({ ok: true, json: async () => ({ shown: true }) });
 await expect.poll(() => document.querySelector('.toast')?.textContent).toContain('Meta Ads was made and shows in your agents');
 // The second ask, as a reload's, is answered false and raises nothing more.
 const second = await render(asked({ id: 'a-1', name: 'Meta Ads' }));
 await expect.poll(() => answers.length).toBe(2);
 answers[1]({ ok: true, json: async () => ({ shown: false }) });
 await new Promise(resolve => setTimeout(resolve, 50));
 expect(document.querySelectorAll('.toast')).toHaveLength(1);
 expect(document.querySelector('.toast')!.textContent).toContain('Meta Ads was made and shows in your agents');
 expect(push).not.toHaveBeenCalled();
 await second.unmount();
});

// #719: one component draws a time in the reader's own zone for every screen. The server, in UTC, draws it in UTC and
// hidden; once the page hydrates in Cairo it reads Cairo's time, visible, with no hydration error. Asked for its day, it
// gives the time today and the day another day (Cairo is three hours ahead in June, so 22:30 UTC is the next day there).
test('a time the server drew in UTC shows in the reader\'s own zone once it hydrates, and another day its day when asked', async () => {
 const zone = (timezoneId: string) => cdp().send('Emulation.setTimezoneOverride', { timezoneId });
 onTestFinished(async () => { await zone(''); });
 const view = <LanguageProvider language="en"><p><ReaderTime at="2026-11-12T22:30:00Z" className="sender__time"/><ReaderTime at="2025-06-10T22:30:00Z" orDay/></p></LanguageProvider>;
 await zone('UTC');
 const host = document.body.appendChild(document.createElement('div'));
 host.innerHTML = renderToString(view);
 const times = () => [...host.querySelectorAll('time')];
 expect(times().map(time => [time.textContent, time.getAttribute('datetime'), getComputedStyle(time).visibility])).toEqual([['10:30 PM', '2026-11-12T22:30:00Z', 'hidden'], ['Jun 10, 2025', '2025-06-10T22:30:00Z', 'hidden']]);
 expect(times()[0].className).toBe('sender__time');
 await zone('Africa/Cairo');
 const recoverable = vi.fn();
 const root = await act(async () => hydrateRoot(host, view, { onRecoverableError: recoverable }));
 try {
  await expect.poll(() => times().map(time => time.textContent)).toEqual(['12:30 AM', 'Jun 11, 2025']);
  expect(times().map(time => getComputedStyle(time).visibility)).toEqual(['visible', 'visible']);
  expect(recoverable).not.toHaveBeenCalled();
 } finally { act(() => root.unmount()); host.remove(); }
});
