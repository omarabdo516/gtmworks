import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { useState } from 'react';
import { followBoard, useCardChanges } from '@/app/board-live';

// #840: the board's live changes in the browser. One socket to gtmworks's own /api/board/events for each Company while
// anything on the page follows its board; an open Card is read again when the Engine reports a change of that Card. The
// socket is the browser's WebSocket, stood in for here by one the test drives as gtmworks's web server would.
class Socket extends EventTarget {
 static opened: Socket[] = [];
 readyState = 0;
 constructor(public url: string) { super(); Socket.opened.push(this); }
 say(message: object) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
 end(code: number) { this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code })); }
 close() { this.readyState = 3; }
}
const company = '10000000-0000-0000-0000-000000000001';
beforeEach(() => { Socket.opened = []; vi.stubGlobal('WebSocket', Socket); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function OpenCard({ card }: { card: string }) {
 const [reads, setReads] = useState(0);
 useCardChanges(company, card, () => setReads(n => n + 1));
 return <p data-testid="reads">{reads}</p>;
}

test('an open Card is read again when the stream opens and when it changes, never for another Card, on the board\'s own socket', async () => {
 const board = vi.fn();
 const unfollow = followBoard(company, { changed: board });
 const screen = await render(<OpenCard card="t_0000aaaa"/>);
 expect(Socket.opened).toHaveLength(1);
 expect(new URL(Socket.opened[0].url).pathname).toBe('/api/board/events');
 expect(new URL(Socket.opened[0].url).searchParams.get('company')).toBe(company);
 const socket = Socket.opened[0];
 socket.say({ stream: 'open' });
 await expect.element(screen.getByTestId('reads')).toHaveTextContent('1');
 socket.say({ changed: ['t_0000bbbb'] });
 socket.say({ changed: ['t_0000aaaa', 't_0000bbbb'] });
 await expect.element(screen.getByTestId('reads')).toHaveTextContent('2');
 expect(board).toHaveBeenCalledWith(['t_0000bbbb']);
 // The socket stays while the board follows, and closes with the last follower.
 await screen.unmount();
 expect(socket.readyState).toBe(0);
 unfollow();
 expect(socket.readyState).toBe(3);
});

test('a socket that drops opens again after a pause and says the stream is down meanwhile; one closed for a person no longer a Member does not', async () => {
 vi.useFakeTimers();
 const live: boolean[] = []; const changed = vi.fn();
 const unfollow = followBoard(company, { changed, live: on => live.push(on) });
 Socket.opened[0].say({ stream: 'open' });
 Socket.opened[0].end(1006);
 expect(live).toEqual([true, false]);
 expect(Socket.opened).toHaveLength(1);
 vi.advanceTimersByTime(1000);
 expect(Socket.opened).toHaveLength(2);
 Socket.opened[1].say({ stream: 'down' });
 Socket.opened[1].say({ stream: 'open' });
 expect(live).toEqual([true, false, true]);
 // The person's membership ended: the board reads once more, and nothing opens again.
 changed.mockClear();
 Socket.opened[1].end(4404);
 expect(changed).toHaveBeenCalledWith(null);
 vi.advanceTimersByTime(60_000);
 expect(Socket.opened).toHaveLength(2);
 unfollow();
});
