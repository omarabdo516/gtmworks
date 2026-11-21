import { vi } from 'vitest';

// A leave timed on a fake clock (#501): the whole component suite runs in one busy browser, where a wall-clock wait can
// see a 190 ms leave end before it looked, or not end before it gave up. Only the page's timers are faked; React draws
// on its own task queue, so it still renders while the clock stands still.
export const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

// Waits for what React draws next without moving the fake clock, as expect.poll would (it advances fake timers by its
// interval). It yields to the page's tasks and gives up after five seconds of real time.
export const drawn = async (seen: () => boolean, what = 'the change') => {
 const deadline = performance.now() + 5000;
 while (!seen()) {
  if (performance.now() > deadline) throw new Error(`${what} was never drawn`);
  await new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = resolve; channel.port2.postMessage(0); });
 }
};
