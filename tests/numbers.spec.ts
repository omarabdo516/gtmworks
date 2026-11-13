import { test, expect, type Page } from '@playwright/test';
import { signIn } from './sign-in';
import { i18n } from '../lib/i18n.mjs';

// The Numbers page (#35). No app is connected in the seed, so the page shows the empty state and no numbers; the
// waiting list and the agents' week are gtmworks's own records.
const t=(page:Page)=>page.evaluate(()=>document.documentElement.lang).then(lang=>i18n(lang==='ar'?'ar':'en').t);

test('with no app connected the Numbers page shows the empty state and no numbers',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/numbers');
 await expect(page).toHaveURL(/\/c\/rs-learning\/numbers$/);
 const tr=await t(page);
 await expect(page.getByRole('heading',{level:1,name:tr('numbers')})).toBeVisible();
 await expect(page.locator('.sb-item[aria-current="page"]')).toHaveText(tr('numbers'));
 const tiles=page.locator('.kpi');
 await expect(tiles).toHaveCount(4);
 await expect(page.locator('.kpis')).toHaveAttribute('data-connected','false');
 expect(await page.locator('.kpi__label').allInnerTexts()).toEqual(['numbersSpend','numbersLeads','numbersCostPerLead','numbersRevenue'].map(key=>tr(key)));
 for(const value of await page.locator('.kpi__val').all()) { await expect(value).toHaveText('—'); await expect(value).toHaveAttribute('aria-label',tr('unavailable')); }
 for(const note of await page.locator('.kpi__delta').allInnerTexts()) expect(note).toBe(tr('numbersNoSource'));
 // The chart and the channel table show the empty state with a way to connect an app, and no figure.
 await expect(page.locator('.dash-empty')).toHaveCount(2);
 for(const empty of await page.locator('.dash-empty').all()) {
  await expect(empty).toContainText(tr('numbersNoApp'));
  await expect(empty.getByRole('link',{name:tr('numbersConnect')})).toHaveAttribute('href','/c/rs-learning/connections');
 }
 expect((await page.locator('.kpis, .chart-empty, .table tbody').allInnerTexts()).join(' ')).not.toMatch(/\d/);
 // The period switch keeps the empty state.
 await page.getByRole('link',{name:tr('numbersLast30')}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/numbers\?period=30$/);
 await expect(page.getByRole('link',{name:tr('numbersLast30')})).toHaveAttribute('aria-current','true');
 await expect(page.locator('.kpis')).toHaveAttribute('data-connected','false');
});

test('the Numbers page lists what waits on its reader from their own list',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/numbers');
 const tr=await t(page);
 const panel=page.locator('.panel--wait');
 await expect(panel.getByRole('heading',{name:tr('numbersWaitingYou')})).toBeVisible();
 const rows=panel.locator('.panel-row');
 const empty=panel.locator('.wait-empty');
 await expect(rows.or(empty).first()).toBeVisible();
 await expect(panel.locator('.panel__h .muted')).toHaveText(String(await rows.count()));
});
