import { test, expect, type Page } from '@playwright/test';
import { tapOverlaps } from './tap-overlaps';

// The overlap check (tests/tap-overlaps.ts) clips a target only where the browser clips it (#48).
const show = (page: Page, html: string) => page.setContent(`<!doctype html><html><body style="margin:0;font:16px sans-serif">${html}</body></html>`);
const target = (style: string, text: string) => `<a class="t" href="#" style="display:block;width:200px;height:44px;${style}">${text}</a>`;

test('a fixed footer over a list item overlaps it, even inside a box that clips its other children', async ({ page }) => {
  await show(page, `<div style="height:50px;overflow:hidden">${target('position:fixed;left:0;top:300px', 'Fixed footer')}</div>
    <div style="height:400px;overflow:auto">${target('margin-top:260px', 'List item')}</div>`);
  expect(await tapOverlaps(page.locator('.t'))).toEqual(['Fixed footer / List item']);
});

test('an absolute child escaping a non-positioned clipping parent overlaps what lies under it', async ({ page }) => {
  await show(page, `<div style="position:relative;height:300px"><div style="height:50px;overflow:hidden">${target('position:absolute;left:0;top:100px', 'Escaped')}</div>
    ${target('position:absolute;left:0;top:110px', 'Below')}</div>`);
  expect(await tapOverlaps(page.locator('.t'))).toEqual(['Escaped / Below']);
});

test('overflow-x:clip with a visible y overflow lets a target overlap vertically', async ({ page }) => {
  // Tall reaches 30px below its 50px box, and only there does Under meet it.
  await show(page, `<div style="position:relative;height:300px"><div style="height:50px;overflow-x:clip;overflow-y:visible">${target('height:80px', 'Tall')}</div>
    ${target('position:absolute;left:0;top:60px', 'Under')}</div>`);
  expect(await tapOverlaps(page.locator('.t'))).toEqual(['Tall / Under']);
});

test('a list item scrolled under the footer is cut off by its list and overlaps nothing', async ({ page }) => {
  await show(page, `<div style="display:grid;grid-template-rows:200px 44px;height:244px">
    <div style="overflow:auto;min-height:0">${target('margin-top:180px', 'Half hidden')}${target('', 'Hidden')}</div>
    ${target('', 'Footer')}</div>`);
  expect(await page.locator('.t').nth(1).evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThan(200); // under the footer on paper
  expect(await tapOverlaps(page.locator('.t'))).toEqual([]);
});
