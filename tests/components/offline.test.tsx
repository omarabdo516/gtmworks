import { expect, test } from 'vitest';
import { commands } from 'vitest/browser';

// The component tests' browser reaches nothing outside this machine (#266, tests/components/offline-setup.ts): a request
// to an outside host is aborted, and a test that made one fails naming the host.
// The browser's report of a request reaches Node beside the test's own calls, so it is gathered until it is there.
const reported = (host: string) => { const seen: string[] = []; return expect.poll(async () => (seen.push(...await commands.outsideRequests()), seen)).toEqual([host]); };
const whileLoading = fetch('https://loading.example.org/probe.json').then(() => 'reached', () => 'refused');

test('a request the file makes while it loads is refused and reported too', async () => {
  expect(await whileLoading).toBe('refused');
  await reported('loading.example.org');
});

test('an outside WebSocket is closed before it connects, and its host is reported', async () => {
  const socket = new WebSocket('wss://socket.example.org/live');
  await new Promise(done => { socket.onclose = done; });
  await reported('socket.example.org');
});

test('a fetch to an outside host is refused, and the host is reported', async () => {
  await expect(fetch('https://outside.example.org/probe.json')).rejects.toThrow(TypeError);
  await reported('outside.example.org');
});

test.fails('a test that leaves an outside request fails', async () => {
  await fetch('https://outside.example.org/probe.json').catch(() => undefined);
});
