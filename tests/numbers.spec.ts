import { test, expect, type Locator, type Page } from './fresh-seed';
import { signIn } from './sign-in';
import { holdPages, watchPlaceholders, whileSlow } from './slow-reads';
import { i18n } from '../lib/i18n.mjs';

// The Numbers page (#35). No app is connected in the seed, so the page shows the empty state and no numbers; the
// waiting list and the agents' week are gtmworks's own records.
const t=(page:Page)=>page.evaluate(()=>document.documentElement.lang).then(lang=>i18n(lang==='ar'?'ar':'en').t);

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

const numbersPath='/c/rs-learning/numbers';
const where=async(locator:Locator)=>{ const box=(await locator.boundingBox())!; return {x:Math.round(box.x),y:Math.round(box.y),width:Math.round(box.width)}; };

test('while its figures are slow Numbers keeps its title and period switch over the placeholder, also after a period change, with the focus on the chosen period',async({page})=>{
 test.setTimeout(90000);
 const placeholders=await watchPlaceholders(page);
 // Only the figures read the log (Figures in app/c/[slug]/numbers/page.tsx); the page's frame and the sidebar never do.
 const week=await holdPages(page,url=>url.pathname===numbersPath&&!url.searchParams.has('period'));
 const month=await holdPages(page,url=>url.pathname===numbersPath&&url.searchParams.get('period')==='30');
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const tr=await t(page);
  const placeholder=page.locator('.numbers-page [aria-busy="true"]');
  const tiles=page.locator('.kpis .kpi');
  const switcher=page.getByRole('group',{name:tr('numbersPeriod')});
  await whileSlow('company_log',3,async()=>{
   await page.locator(`.nav a[href="${numbersPath}"]`).click(); week.letGo();
   await expect(placeholder).toBeVisible();
   await expect(placeholder).toHaveAttribute('aria-label',tr('numbersLoading'));
   await expect(placeholder.locator('.kpis > .sk')).toHaveCount(4);
   await expect(page).toHaveURL(/\/c\/rs-learning\/numbers$/);
   await expect(page.locator('.sidebar')).toBeVisible();
   await expect(page.getByRole('heading',{level:1,name:tr('numbers')})).toBeVisible();
   await expect(switcher).toBeVisible();
   const tile=await where(placeholder.locator('.kpis > .sk').first());
   await expect(tiles).toHaveCount(4,{timeout:15000});
   await expect(placeholder).toHaveCount(0);
   expect(await where(tiles.first()),'the first tile keeps its place').toEqual(tile);

   const last30=switcher.getByRole('link',{name:tr('numbersLast30')});
   await last30.focus(); await page.keyboard.press('Enter'); month.letGo();
   await expect(placeholder).toBeVisible();
   await expect(page).toHaveURL(/\/c\/rs-learning\/numbers\?period=30$/);
   await expect(page.getByRole('heading',{level:1,name:tr('numbers')})).toBeVisible();
   await expect(last30).toHaveAttribute('aria-current','true');
   await expect(last30).toBeFocused();
   await expect(tiles).toHaveCount(4,{timeout:15000});
   await expect(placeholder).toHaveCount(0);
   await expect(last30).toBeFocused();
  });
  expect(await placeholders.seen()).toEqual([tr('numbersLoading'),tr('numbersLoading')]);
 } finally { week.letGo(); month.letGo(); await week.stop(); await month.stop(); }
});

test('on the seeded data Numbers never shows its placeholder: opened, reached from the sidebar, or for another period',async({page})=>{
 const placeholders=await watchPlaceholders(page);
 await signIn(page,'omar@example.com',numbersPath);
 const tr=await t(page);
 const tiles=page.locator('.kpis .kpi');
 await page.reload();
 await expect(tiles).toHaveCount(4);
 await page.locator('.nav a[href$="/work/board"]').click();
 await expect(page.locator('.board')).toBeVisible();
 await page.locator(`.nav a[href="${numbersPath}"]`).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/numbers$/);
 await expect(tiles).toHaveCount(4);
 const last30=page.getByRole('link',{name:tr('numbersLast30')});
 await last30.click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/numbers\?period=30$/);
 await expect(last30).toHaveAttribute('aria-current','true');
 await expect(tiles).toHaveCount(4);
 await expect.poll(placeholders.waiting).toBe(0);
 expect(await placeholders.seen()).toEqual([]);
});
