import { afterEach, expect, test, vi } from 'vitest';
import { signInToApp } from '@/app/app-sign-in';

// The Owner's sign-in to an app for one Agent (#203, #204; review of #330): every request to /api/company-apps has its
// own deadline, its answer's body included, so a stalled one settles the caller well inside the fifteen minutes; a
// failed sign-in is cancelled and its window closed; a "waiting" answer is followed by the next poll.
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const vendor = () => { const opened = { close: vi.fn(), location: { href: '' }, opener: {} as unknown }; vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window); return opened; };
const stalled = () => new Promise<Response>(() => {});
// An answer as fetch gives it; its body is read at once (a real Response's body is read on a later task, which the fake
// timers never wait for).
const answer = (body: unknown) => Promise.resolve({ ok: true, json: async () => body } as unknown as Response);
const actions = (calls: unknown[][]) => calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).action);
const given = { company: 'co-1', agent: 'ag-1', app: 'gmail' };

test('a connect that never answers settles as failed, cancels the sign-in and closes its window', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const opened = vendor();
 const fetch = vi.fn((_url: string, init: RequestInit) => JSON.parse(String(init.body)).action === 'connect' ? stalled() : answer({ status: 'cancelled' }));
 vi.stubGlobal('fetch', fetch);
 const outcome = signInToApp(given);
 await vi.advanceTimersByTimeAsync(60_000);
 await expect(outcome).resolves.toEqual({ error: 'connectFailed' });
 expect(actions(fetch.mock.calls)).toEqual(['connect', 'cancel']);
 expect(opened.close).toHaveBeenCalled();
});

test('a poll whose answer\'s body never arrives settles as failed and cancels the sign-in; a waiting answer is polled again first', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const opened = vendor();
 let polls = 0;
 const fetch = vi.fn((_url: string, init: RequestInit) => {
  const { action } = JSON.parse(String(init.body));
  if (action === 'connect') return answer({ url: 'https://vendor.example/sign-in' });
  if (action === 'poll' && ++polls === 1) return answer({ status: 'waiting' });
  if (action === 'poll') return Promise.resolve({ ok: true, json: stalled } as unknown as Response);
  return answer({ status: 'cancelled' });
 });
 vi.stubGlobal('fetch', fetch);
 const outcome = signInToApp(given);
 await vi.advanceTimersByTimeAsync(60_000);
 await expect(outcome).resolves.toEqual({ error: 'connectFailed' });
 expect(opened.location.href).toBe('https://vendor.example/sign-in');
 expect(actions(fetch.mock.calls)).toEqual(['connect', 'poll', 'poll', 'cancel']);
 expect(opened.close).toHaveBeenCalled();
});

test('a sign-in that connects after waiting settles as connected, with nothing cancelled', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const opened = vendor();
 const answers = [{ url: 'https://vendor.example/sign-in' }, { status: 'waiting' }, { status: 'connected' }];
 const fetch = vi.fn(() => answer(answers.shift()));
 vi.stubGlobal('fetch', fetch);
 const outcome = signInToApp(given);
 await vi.advanceTimersByTimeAsync(10_000);
 await expect(outcome).resolves.toEqual({ state: 'connected' });
 expect(actions(fetch.mock.calls)).toEqual(['connect', 'poll', 'poll']);
 expect(opened.close).not.toHaveBeenCalled();
});

test('a caller that has already stopped settles at once: no request waits out its own deadline', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const opened = vendor();
 const fetch = vi.fn((_url: string, init: RequestInit) => JSON.parse(String(init.body)).action === 'connect' ? stalled() : answer({ status: 'cancelled' }));
 vi.stubGlobal('fetch', fetch);
 const stopped = new AbortController(); stopped.abort();
 let settled = false;
 const outcome = signInToApp({ ...given, signal: stopped.signal }).finally(() => { settled = true; });
 await vi.advanceTimersByTimeAsync(0);
 expect(settled).toBe(true);
 await expect(outcome).resolves.toEqual({ error: 'connectFailed' });
 expect(opened.close).toHaveBeenCalled();
});

test('a sign-in still waiting at fifteen minutes settles then: the last wait and poll are cut to the time left', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
 const opened = vendor();
 const fetch = vi.fn((_url: string, init: RequestInit) => {
  const { action } = JSON.parse(String(init.body));
  if (action === 'connect') return answer({ url: 'https://vendor.example/sign-in' });
  // Waiting until a poll that starts with 20 s left, under its own 30 s deadline, which never answers: it is cut to the
  // time left, so the caller settles at fifteen minutes and not ten seconds later.
  if (action === 'poll') return Date.now() < 15 * 60 * 1000 - 20_000 ? answer({ status: 'waiting' }) : stalled();
  return answer({ status: 'cancelled' });
 });
 vi.setSystemTime(0);
 vi.stubGlobal('fetch', fetch);
 let settled = false;
 const outcome = signInToApp(given).finally(() => { settled = true; });
 await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 20_000);
 expect(settled).toBe(false);
 expect(actions(fetch.mock.calls).at(-1)).toBe('poll');
 await vi.advanceTimersByTimeAsync(20_100);
 expect(settled).toBe(true);
 await expect(outcome).resolves.toEqual({ error: 'connectFailed' });
 expect(opened.close).toHaveBeenCalled();
});

test('a no-sign-in app answers with its state alone: connected at the press, with no window and nothing cancelled', async () => {
 const opened = vendor();
 const fetch = vi.fn(() => answer({ status: 'connected' }));
 vi.stubGlobal('fetch', fetch);
 const outcome = signInToApp({ ...given, app: 'context7' });
 await expect(outcome).resolves.toEqual({ state: 'connected' });
 expect(actions(fetch.mock.calls)).toEqual(['connect']);
 expect(opened.close).toHaveBeenCalled();
 expect(opened.location.href).toBe('');
});

test('an app that needs a token or a declared field opens the apps sheet and connects nothing', async () => {
 const opened = vendor();
 const openApp = vi.fn();
 const fetch = vi.fn(() => answer({ needs: 'details' }));
 vi.stubGlobal('fetch', fetch);
 const outcome = signInToApp({ ...given, app: 'asana', openApp });
 await expect(outcome).resolves.toEqual({ state: 'manual' });
 expect(openApp).toHaveBeenCalledWith('asana');
 expect(actions(fetch.mock.calls)).toEqual(['connect']);
 expect(opened.close).toHaveBeenCalled();
});
