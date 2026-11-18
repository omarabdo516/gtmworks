import { test, expect, type Locator, type Page } from './fresh-seed';
import { signIn } from './sign-in';
import { asAdmin, holdReads, unprefetched, watchPlaceholders, wholePages } from './slow-reads';
import { i18n } from '../lib/i18n.mjs';

// The Numbers page (#35). No app is connected in the seed, so the page shows the empty state and no numbers; the
// waiting list and the agents' week are gtmworks's own records.
const t=(page:Page)=>page.evaluate(()=>document.documentElement.lang).then(lang=>i18n(lang==='ar'?'ar':'en').t);

const numbersPath='/c/rs-learning/numbers';

test('the Numbers page lists what waits on its reader from their own list',async({page})=>{
 const placeholders=await watchPlaceholders(page);
 await wholePages(page,url=>url.pathname===numbersPath);
 await signIn(page,'omar@example.com',numbersPath);
 const tr=await t(page);
 const panel=page.locator('.panel--wait');
 await expect(panel.getByRole('heading',{name:tr('numbersWaitingYou')})).toBeVisible();
 const rows=panel.locator('.panel-row');
 const empty=panel.locator('.wait-empty');
 await expect(rows.or(empty).first()).toBeVisible();
 await expect(panel.locator('.panel__h .muted')).toHaveText(String(await rows.count()));

 // A page that arrives whole shows no placeholder (#172): opened, reached from the sidebar, or for another period.
 const tiles=page.locator('.kpis .kpi');
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
 expect(placeholders.seen()).toEqual([]);
});

// The figures read the Agents' rows of the last 7 days in the log, and a filter is only weighed on rows a read finds: the
// log needs one, of an Agent the reader sees, for the figures to wait. Written with triggers off, taken away after.
const ads=(n:number)=>`6c000000-0000-0000-0000-00000000000${n}`;
const agentWeek={
 set:`  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('${ads(2)}','10000000-0000-0000-0000-000000000001','${ads(1)}','Ads','Runs the ads.','slow-numbers');
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at) values
   ('10000000-0000-0000-0000-000000000001','${ads(2)}','agent','Ads','agent','${ads(2)}','agent_changed','{"agent_name":"Ads"}','hermes_agent_audit',691173,now()-interval '1 hour');`,
 unset:`delete from public.company_log where source='hermes_agent_audit' and source_id=691173;
  delete from public.hermes_agents where id='${ads(2)}';`,
};
const where=async(locator:Locator)=>{ const box=(await locator.boundingBox())!; return {x:Math.round(box.x),y:Math.round(box.y),width:Math.round(box.width)}; };

// The figures' read of the log waits on the test's own lock (holdReads), which the test lets go once it has seen the
// placeholder, so the placeholder is there for as long as the test needs it and no clock decides when the figures come.
// The page opens through the router on the test's own activation (unprefetched), because a prefetched page that is still
// on its way makes the router wait for it whole, and the page that then draws is the figures' with no placeholder.
test('while its figures are slow Numbers keeps its title and period switch over the placeholder, also after a period change, with the focus on the chosen period',async({page})=>{
 const placeholders=await watchPlaceholders(page);
 // Only the figures read the log (Figures in app/c/[slug]/numbers/page.tsx); the page's frame and the sidebar do not.
 const pages=await unprefetched(page);
 asAdmin(agentWeek.unset); asAdmin(agentWeek.set);
 let figures:Awaited<ReturnType<typeof holdReads>>|undefined;
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const tr=await t(page);
  const placeholder=page.locator('.numbers-page [aria-busy="true"]');
  const tiles=page.locator('.kpis .kpi');
  const switcher=page.getByRole('group',{name:tr('numbersPeriod')});
  figures=await holdReads('company_log');
  await pages.hydrated();
  // The activation opens the page through the router, so the frame this case guards is the one the router streams, not
  // a document the browser loaded.
  await page.evaluate(()=>{ (window as unknown as {routerOpened?:number}).routerOpened=1; });
  await page.locator(`.nav a[href="${numbersPath}"]`).focus(); await page.keyboard.press('Enter');
  await expect(placeholder).toBeVisible();
  expect(await page.evaluate(()=>(window as unknown as {routerOpened?:number}).routerOpened),'the page came through the router').toBe(1);
  await expect(placeholder).toHaveText(tr('numbersLoading'));
  await expect(placeholder.locator('.kpis > .sk')).toHaveCount(4);
  await expect(page).toHaveURL(/\/c\/rs-learning\/numbers$/);
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.getByRole('heading',{level:1,name:tr('numbers')})).toBeVisible();
  await expect(switcher).toBeVisible();
  const tile=await where(placeholder.locator('.kpis > .sk').first());
  figures.letGo();
  await expect(tiles).toHaveCount(4);
  await expect(placeholder).toHaveCount(0);
  expect(await where(tiles.first()),'the first tile keeps its place').toEqual(tile);
  // A period change reads the figures again: the log waits on the test once more, until the placeholder is seen.
  await figures.hold();
  const last30=switcher.getByRole('link',{name:tr('numbersLast30')});
  await last30.focus(); await page.keyboard.press('Enter');
  await expect(placeholder).toBeVisible();
  await expect(page).toHaveURL(/\/c\/rs-learning\/numbers\?period=30$/);
  await expect(page.getByRole('heading',{level:1,name:tr('numbers')})).toBeVisible();
  await expect(last30).toHaveAttribute('aria-current','true');
  await expect(last30).toBeFocused();
  figures.letGo();
  await expect(tiles).toHaveCount(4);
  await expect(placeholder).toHaveCount(0);
  await expect(last30).toBeFocused();
  expect(placeholders.seen()).toEqual([tr('numbersLoading'),tr('numbersLoading')]);
 } finally { await figures?.stop(); asAdmin(agentWeek.unset); }
});
