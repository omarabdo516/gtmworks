import { test, expect, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';
import { i18n } from '../lib/i18n.mjs';
import { logPageSize } from '../lib/activity-log.mjs';

// One log for the Company (#11): the Activity log page filters by person or Agent, and a Member reads only their own
// Company's log. The seed's activity is made by five of its Contributors. The old board is switched off (#846): its
// Card filter and its rows' Card links are gone with it, and a Card of the Engine's board keeps its own Activity.
const writer='30000000-0000-0000-0000-000000000001';
// Supabase CLI targets the local test database by default; never pass --remote.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const t=(page:Page)=>page.evaluate(()=>document.documentElement.lang).then(lang=>i18n(lang==='ar'?'ar':'en').t);

test('the Activity log filters by who, and a filter no row matches offers everything back',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/log');
 await expect(page).toHaveURL(/\/c\/rs-learning\/log$/);
 const tr=await t(page);
 await expect(page.getByRole('heading',{level:1,name:tr('activityLog')})).toBeVisible();
 await expect(page.locator('.sb-item[aria-current="page"]')).toHaveText(tr('activityLog'));
 const rows=page.locator('.lgp-body .lg-row');
 await expect(rows.first()).toBeVisible();
 const everyone=await rows.count();
 expect(everyone).toBeGreaterThan(5);
 await expect(page.locator('.lg-forever')).toHaveText(tr('logForever'));

 // One person: only their own rows remain, and the address carries the filter.
 await page.locator('#lg-who').selectOption(`p:${writer}`);
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/log\\?who=p%3A${writer}$`));
 await expect(rows.first()).toBeVisible();
 const names=await page.locator('.lgp-body .lg-row .lg-name').allInnerTexts();
 expect(names.length).toBeGreaterThan(0);
 expect(names.length).toBeLessThan(everyone);
 expect(new Set(names).size).toBe(1);
 await expect(page.locator('.lgp-count')).toHaveText(tr(names.length===1?'logEntry':'logEntries',names.length));

 // A filter no row matches, on a log that has rows: the page reads the Company's whole log, so it says nothing
 // matches and its own link offers everything back (review of #279: the page, not the component, picks the note).
 await page.goto('/c/rs-learning/log?who=a:ffffffff-ffff-ffff-ffff-ffffffffffff');
 const empty=page.locator('.lgp-body .lgp-empty');
 await expect(empty).toContainText(tr('logNoMatch'));
 await expect(empty.getByRole('link',{name:tr('logShowAll')})).toHaveAttribute('href','/c/rs-learning/log');
});

test('older rows are reached page by page in a stable order, each row once',async({page})=>{
 // A Company of its own, so its rows weigh on no other test: a page and two more of the Viewer's rows at a few moments,
 // so the first page ends inside a run of rows with the same time and the next page has to split them by id. The
 // Viewer reads them, filtered to their own, and is removed again at the end, which hides the Company from everyone.
 const stamp=Date.now(), slug=`paged-${stamp}`, viewer='20000000-0000-0000-0000-000000000004';
 const total=logPageSize+2, moment=Math.floor(logPageSize*0.4);
 const company=rows(`with engine as (insert into public.company_engines(address,key_encrypted) values ('http://127.0.0.1:8642','paged') returning id) insert into public.companies(id,slug,name,engine_id) select gen_random_uuid(),'${slug}','Paged ${stamp}',id from engine returning id`)[0].id as string;
 query(`insert into public.members(company_id,person_id,role) values ('${company}','${viewer}','viewer')`);
 try {
  query(`insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,action,details,source,source_id,created_at)
   select '${company}','${viewer}','person','Viewer','company','company_changed',jsonb_build_object('field','name','old','Paged','new','Paged '||g),'company_audit',g,timestamptz '2026-01-01T00:00:00Z'+(g/${moment})*interval '1 minute' from generate_series(1,${total}) g`);
  const expected=rows(`select id,created_at from public.company_log where company_id='${company}' and actor_id='${viewer}' order by created_at desc,id desc`);
  expect(expected).toHaveLength(total);
  // The page boundary falls between two rows of the same moment.
  expect(expected[logPageSize-1].created_at).toBe(expected[logPageSize].created_at);
  await signIn(page,'viewer@example.com',`/c/${slug}/log?who=p:${viewer}`);
  const tr=await t(page);
  const entries=page.locator('.lgp-body .lg-row');
  await expect(page.locator('.lgp-count')).toHaveText(tr('logEntries',total));
  await expect(entries).toHaveCount(logPageSize);
  await expect(page.locator('.lg-pages .lg-more')).toHaveText(tr('logShowing',logPageSize));
  const first=await entries.evaluateAll(list=>list.map(row=>row.getAttribute('data-entry')));
  await page.getByRole('link',{name:tr('logOlder')}).click();
  await expect(page).toHaveURL(new RegExp(`/c/${slug}/log\\?who=p%3A${viewer}&before=`));
  await expect(entries).toHaveCount(total-logPageSize);
  await expect(page.locator('.lgp-count')).toHaveText(tr('logEntries',total));
  await expect(page.locator('.lg-pages .lg-more')).toHaveText(tr('logShowingOlder',total-logPageSize));
  await expect(page.getByRole('link',{name:tr('logOlder')})).toHaveCount(0);
  const second=await entries.evaluateAll(list=>list.map(row=>row.getAttribute('data-entry')));
  // Both pages together are the Viewer's log in its order (time, then id, newest first), each row once.
  expect([...first,...second]).toEqual(expected.map(row=>String(row.id)));
  await page.getByRole('link',{name:tr('logNewest')}).click();
  await expect(page).toHaveURL(new RegExp(`/c/${slug}/log\\?who=p%3A${viewer}$`));
  await expect(entries).toHaveCount(logPageSize);
 } finally {
  query(`update public.members set removed_at=now() where company_id='${company}' and person_id='${viewer}'`);
 }
});
