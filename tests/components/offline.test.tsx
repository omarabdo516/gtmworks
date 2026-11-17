import { expect, test } from 'vitest';
import { commands } from 'vitest/browser';

// The component tests' browser reaches nothing outside this machine (#266, tests/components/offline-setup.ts): a request
// to an outside host is aborted, and a test that made one fails naming the host.
test('a fetch to an outside host is refused, and the host is reported', async () => {
  await expect(fetch('https://outside.example.org/probe.json')).rejects.toThrow(TypeError);
  expect(await commands.outsideRequests()).toEqual(['outside.example.org']);
});

test.fails('a test that leaves an outside request fails', async () => {
  await fetch('https://outside.example.org/probe.json').catch(() => undefined);
});
