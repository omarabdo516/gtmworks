import { test, expect, type Page } from './offline-browser';

// The browser reaches nothing outside this machine (#266): every request to an outside host is aborted, and a test that
// made one fails naming the host. A page of its own, so these need no app page.
const probe = (page: Page) => page.setContent('<img src="https://outside.example.org/probe.png">').then(() => page.waitForLoadState('load'));

test('a page\'s outside request is aborted and its host is reported', async ({ page, outsideRequests }) => {
  const failed = page.waitForEvent('requestfailed');
  await probe(page);
  expect((await failed).url()).toBe('https://outside.example.org/probe.png');
  expect(outsideRequests.splice(0)).toEqual(['outside.example.org']);
});

test('a context the test opens itself is guarded the same way', async ({ browser, outsideRequests }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const failed = page.waitForEvent('requestfailed');
    await probe(page);
    expect((await failed).failure()?.errorText).toMatch(/^net::ERR_BLOCKED_BY_CLIENT/);
    expect(outsideRequests.splice(0)).toEqual(['outside.example.org']);
  } finally { await context.close(); }
});

test('a test that leaves an outside request fails', async ({ page }) => {
  test.fail();
  await probe(page);
});
