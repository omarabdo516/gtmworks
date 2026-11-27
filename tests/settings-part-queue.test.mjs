import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partQueue } from '../lib/settings-part-queue.mjs';

// One Settings page sends at most 4 Engine reads at once (#898), so one page cannot fill the listener's callLimit.
test('ten Engine-backed parts on one page never have more than four reads open at once, and every one is read', async () => {
  const queue = partQueue(4);
  let open = 0, most = 0;
  const held = [];
  const reads = Array.from({ length: 10 }, (_, index) => queue(() => new Promise(resolve => {
    open++; most = Math.max(most, open);
    held.push(() => { open--; resolve(index); });
  })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(open, 4, 'four reads start at once');
  while (held.length) { held.shift()(); await new Promise(resolve => setImmediate(resolve)); }
  assert.deepEqual(await Promise.all(reads), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(most, 4);
});

test('a read that fails frees its place for the next one', async () => {
  const queue = partQueue(1);
  const failed = queue(() => Promise.reject(new Error('timedOut')));
  const next = queue(() => Promise.resolve('read'));
  await assert.rejects(failed, /timedOut/);
  assert.equal(await next, 'read');
});

test('a read no longer wanted before its turn is never sent', async () => {
  const queue = partQueue(1);
  let release; const first = queue(() => new Promise(resolve => { release = resolve; }));
  const stopped = new AbortController(); let sent = false;
  const dropped = queue(() => { sent = true; return Promise.resolve(); }, stopped.signal);
  stopped.abort();
  release();
  await first;
  await assert.rejects(dropped, { name: 'AbortError' });
  assert.equal(sent, false);
});
