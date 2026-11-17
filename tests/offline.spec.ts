import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect, type BrowserContext, type Page } from './offline-browser';

// The browser reaches nothing outside this machine (#266): every request to an outside host fails, and a test that
// made one fails naming the host. A page of its own, so these need no app page. The failure is the proxy's own, not a
// name that does not resolve, so each request was stopped by the guard before it could reach its address.
const stopped = /^net::ERR_PROXY_CONNECTION_FAILED/;
const probe = (page: Page) => page.setContent('<img src="https://outside.example.org/probe.png">').then(() => page.waitForLoadState('load'));

test('a page\'s outside request is aborted and its host is reported', async ({ page, outsideRequests }) => {
  const failed = page.waitForEvent('requestfailed');
  await probe(page);
  expect((await failed).url()).toBe('https://outside.example.org/probe.png');
  expect((await failed).failure()?.errorText).toMatch(stopped);
  expect(outsideRequests.splice(0)).toEqual(['outside.example.org']);
});

test('a context the test opens itself is guarded the same way', async ({ browser, outsideRequests }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const failed = page.waitForEvent('requestfailed');
    await probe(page);
    expect((await failed).url()).toBe('https://outside.example.org/probe.png');
    expect((await failed).failure()?.errorText).toMatch(stopped);
    expect(outsideRequests.splice(0)).toEqual(['outside.example.org']);
  } finally { await context.close(); }
});

test('an outside WebSocket is closed before it connects, and its host is reported', async ({ page, outsideRequests }) => {
  await page.setContent('<p>socket</p>');
  await page.evaluate(() => new Promise(done => { new WebSocket('wss://socket.example.org/live').onclose = done; }));
  expect(outsideRequests.splice(0)).toEqual(['socket.example.org']);
});

test('a local address that redirects to an outside one is stopped there and reported', async ({ page, outsideRequests }) => {
  const server = createServer((_, response) => response.writeHead(302, { location: 'https://redirected.example.org/probe.png' }).end());
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  try {
    const failed = page.waitForEvent('requestfailed', request => request.url() === 'https://redirected.example.org/probe.png');
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`).catch(() => undefined);
    expect((await failed).failure()?.errorText).toMatch(stopped);
    expect(outsideRequests.splice(0)).toEqual(['redirected.example.org']);
  } finally { server.close(); }
});

test('a test\'s own requests to this machine still answer, from its page and its API requests', async ({ page }) => {
  const server = createServer((_, response) => response.end('here'));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  try {
    const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    expect(await (await page.request.get(local)).text()).toBe('here');
    await page.goto(local);
    await expect(page.locator('body')).toHaveText('here');
  } finally { server.close(); }
});

test.describe('a hook', () => {
  let opened: BrowserContext;
  test.beforeAll(async ({ browser }) => { opened = await browser.newContext(); await probe(await opened.newPage()); });
  test.afterAll(() => opened.close());
  test('an outside request a beforeAll made is kept for the worker, with the test before it, and fails no test', async ({ outsideBetweenTests }) => {
    expect(outsideBetweenTests.splice(0)).toEqual([expect.stringMatching(/^outside\.example\.org \(between tests, after "/)]);
  });
});

test('a test that leaves an outside request fails', async ({ page }) => {
  test.fail();
  await probe(page);
});
