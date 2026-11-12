import { test, expect } from '@playwright/test';

// The approved prototype lives in design-reference/ for builders only; the product never serves it (#285).
test('the production build answers 404 for the design reference', async ({ request }) => {
  // Next drops a trailing slash with a permanent redirect to the same path, which must itself be missing.
  const folder = await request.get('/design-reference/', { maxRedirects: 0 });
  expect([308, 404]).toContain(folder.status());
  if (folder.status() === 308) expect(folder.headers().location).toBe('/design-reference');
  for (const path of ['/design-reference', '/design-reference/index.html', '/design-reference/app.js', '/design-reference/SHA256SUMS']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
  }
});
