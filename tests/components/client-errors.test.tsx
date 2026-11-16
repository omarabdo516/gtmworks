import { afterEach, expect, test, vi } from 'vitest';
import '@/lib/client-errors';

afterEach(() => { vi.unstubAllGlobals(); });

// Nothing is rendered: the reporter listens from the moment its module loads, so an error thrown before the page
// hydrates (as on a slow phone right after load) is still reported.
test('an error thrown in the page is sent to the server log endpoint with its message, stack and page, before anything renders', async () => {
 const sent = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
 vi.stubGlobal('fetch', sent);
 setTimeout(() => { throw new Error('forced page error'); });
 await expect.poll(() => sent.mock.calls.length).toBe(1);
 const [url, init] = sent.mock.calls[0];
 expect([url, init.method]).toEqual(['/api/client-errors', 'POST']);
 const body = JSON.parse(String(init.body));
 expect(body).toMatchObject({ source: 'page', message: 'forced page error', path: location.pathname });
 expect(body.stack).toContain('forced page error');
});
