import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';
import { i18n } from '../lib/i18n.mjs';

// One log for the Company (#11): the Activity log page filters by person or Agent and by Card, a Card opens from its
// rows, and a Member reads only their own Company's log. The seed's Card activity is made by its role Agents.
const writer='30000000-0000-0000-0000-000000000001';
// Supabase CLI targets the local test database by default; never pass --remote.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const t=(page:Page)=>page.evaluate(()=>document.documentElement.lang).then(lang=>i18n(lang==='ar'?'ar':'en').t);

test('the Activity log filters by who and by Card, and opens a Card',async({page})=>{
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

 // One Agent: only its own rows remain, and the address carries the filter.
 await page.locator('#lg-who').selectOption(`a:${writer}`);
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/log\\?who=a%3A${writer}$`));
 await expect(rows.first()).toBeVisible();
 const names=await page.locator('.lgp-body .lg-row .lg-name').allInnerTexts();
 expect(names.length).toBeGreaterThan(0);
 expect(names.length).toBeLessThan(everyone);
 expect(new Set(names).size).toBe(1);
 await expect(page.locator('.lgp-count')).toHaveText(tr(names.length===1?'logEntry':'logEntries',names.length));

 // One Card, everyone: every row names that Card.
 await page.getByRole('link',{name:tr('logShowAll')}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/log$/);
 const option=page.locator('#lg-card option').nth(1);
 const [card,title]=[await option.getAttribute('value'),(await option.textContent())!.trim()];
 await page.locator('#lg-card').selectOption(card!);
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/log\\?card=${card}$`));
 await expect(rows.first()).toBeVisible();
 const cards=await page.locator('.lgp-body .lg-row .lg-card').allInnerTexts();
 expect(cards.length).toBe(await rows.count());
 for(const name of cards) expect(name.trim()).toBe(title);

 // A row's Card link opens that Card.
 await page.locator('.lgp-body .lg-row .lg-card').first().click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/work/board/${card}$`));
});

test('the Activity log filters by a person, and an opened Card shows only its own rows',async({page})=>{
 // Two Cards of the seed, each given a comment of its own by the Manager, so each has rows no other Card has.
 const manager='20000000-0000-0000-0000-000000000002';
 const stamp=Date.now(), [own,other]=[2,3], mine=`Only on card ${own} ${stamp}`, theirs=`Only on card ${other} ${stamp}`;
 await signIn(page,'manager@example.com',`/c/rs-learning/work/board/${own}`);
 const tr=await t(page);
 for(const [card,body] of [[own,mine],[other,theirs]] as const) {
  await page.goto(`/c/rs-learning/work/board/${card}`);
  await page.getByLabel(tr('comment'),{exact:true}).fill(body);
  await page.getByRole('button',{name:tr('send'),exact:true}).click();
  await expect(page.locator('.comment-body').filter({hasText:body})).toBeVisible();
 }

 // One person: only their rows remain, both comments among them, and the address carries the filter.
 await page.goto('/c/rs-learning/log');
 const rows=page.locator('.lgp-body .lg-row');
 await expect(rows.first()).toBeVisible();
 const everyone=await rows.count();
 await page.locator('#lg-who').selectOption(`p:${manager}`);
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/log\\?who=p%3A${manager}$`));
 await expect(rows.filter({hasText:mine})).toHaveCount(1);
 await expect(rows.filter({hasText:theirs})).toHaveCount(1);
 const names=await page.locator('.lgp-body .lg-row .lg-name').allInnerTexts();
 expect(names.length).toBeLessThan(everyone);
 expect(new Set(names)).toEqual(new Set(['مدير']));
 await expect(page.locator('.lgp-count')).toHaveText(tr(names.length===1?'logEntry':'logEntries',names.length));

 // The person and one Card: only that Card's rows.
 await page.locator('#lg-card').selectOption(String(own));
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/log\\?who=p%3A${manager}&card=${own}$`));
 await expect(rows.filter({hasText:mine})).toHaveCount(1);
 await expect(rows.filter({hasText:theirs})).toHaveCount(0);

 // The opened Card shows its own rows and none of the other Card's.
 await rows.filter({hasText:mine}).locator('.lg-card').click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/work/board/${own}$`));
 await expect(page.locator('.modal .comment-body').filter({hasText:mine})).toBeVisible();
 await expect(page.locator('.modal').getByText(theirs)).toHaveCount(0);
});

test('older rows are reached page by page in a stable order, each row once',async({page})=>{
 // A Company of its own, so its 302 rows weigh on no other test: one Card with 302 comments at four moments, so the
 // first page (300 rows) ends inside a run of rows with the same time and the next page has to split them by id.
 // The Viewer reads it and is removed again at the end, which hides the Company from everyone.
 const stamp=Date.now(), slug=`paged-${stamp}`, title=`Paged log ${stamp}`, viewer='20000000-0000-0000-0000-000000000004';
 const company=rows(`insert into public.companies(id,slug,name) values (gen_random_uuid(),'${slug}','Paged ${stamp}') returning id`)[0].id as string;
 query(`insert into public.members(company_id,person_id,role) values ('${company}','${viewer}','viewer')`);
 try {
  query(`with card as (insert into public.work_cards(company_id,stage_id,title) select '${company}',id,'${title}' from public.work_stages where company_id='${company}' and kind='ideas' order by position limit 1 returning id)
   insert into public.work_comments(company_id,card_id,body,author_id,created_at) select '${company}',card.id,'Paged row '||g,'${viewer}',timestamptz '2026-01-01T00:00:00Z'+(g/100)*interval '1 minute' from card,generate_series(1,302) g`);
  const card=Number(rows(`select id from public.work_cards where title='${title}'`)[0].id);
  await signIn(page,'viewer@example.com',`/c/${slug}/log?card=${card}`);
  const tr=await t(page);
  const entries=page.locator('.lgp-body .lg-row');
  await expect(page.locator('.lgp-count')).toHaveText(tr('logEntries',303)); // the card's creation and its 302 comments
  await expect(entries).toHaveCount(300);
  await expect(page.locator('.lg-pages .lg-more')).toHaveText(tr('logShowing',300));
  const first=await entries.evaluateAll(list=>list.map(row=>row.getAttribute('data-entry')));
  await page.getByRole('link',{name:tr('logOlder')}).click();
  await expect(page).toHaveURL(new RegExp(`/c/${slug}/log\\?card=${card}&before=`));
  await expect(entries).toHaveCount(3);
  await expect(page.locator('.lgp-count')).toHaveText(tr('logEntries',303));
  await expect(page.locator('.lg-pages .lg-more')).toHaveText(tr('logShowingOlder',3));
  await expect(page.getByRole('link',{name:tr('logOlder')})).toHaveCount(0);
  const second=await entries.evaluateAll(list=>list.map(row=>row.getAttribute('data-entry')));
  // Both pages together are the card's log in its order (time, then id, newest first), each row once.
  const expected=rows(`select id from public.company_log where card_id=${card} order by created_at desc,id desc`).map(row=>String(row.id));
  expect([...first,...second]).toEqual(expected);
  await page.getByRole('link',{name:tr('logNewest')}).click();
  await expect(page).toHaveURL(new RegExp(`/c/${slug}/log\\?card=${card}$`));
  await expect(entries).toHaveCount(300);
 } finally {
  query(`update public.members set removed_at=now() where company_id='${company}' and person_id='${viewer}'`);
 }
});

test('a filter that matches nothing says so and offers everything back',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/log?who=a:ffffffff-ffff-ffff-ffff-ffffffffffff');
 const tr=await t(page);
 await expect(page.locator('.lgp-empty')).toContainText(tr('logNoMatch'));
 await expect(page.locator('.lgp-body .lg-row')).toHaveCount(0);
});

test('a Member reads only the log of their own Company',async({page})=>{
 await signIn(page,'viewer@example.com','/c/rs-learning/log');
 await expect(page.locator('.lgp-body .lg-row').first()).toBeVisible();
 expect((await page.goto('/c/rs-consultations/log'))!.status()).toBe(404);
});
