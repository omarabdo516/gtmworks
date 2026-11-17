import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signIn, openNavigation } from './sign-in';

// #15, which Agents each Member sees: the Owner turns a switch in Company settings, and the Contributor (مراجع) finds
// the Agent in their list; an Agent not allowed to them is absent, and its address is a page that does not exist.
// The database side (every Role, the log, Conversations, the main Agent) is proven in supabase/tests/member_agent_visibility.sql.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const id=(n:number)=>`67000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [lead,ads,seo]=[1,2,3].map(n=>id(10+n));

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo.file);
 query(`do $$ begin
  update public.people set language='en' where id in ('${omar}','20000000-0000-0000-0000-000000000003');
  insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values
   ('${id(1)}','${company}','${omar}','http://127.0.0.1:9/p/lead','seen-lead','no-key','unreachable'),
   ('${id(2)}','${company}','${omar}','http://127.0.0.1:9/p/ads','seen-ads','no-key','unreachable'),
   ('${id(3)}','${company}','${omar}','http://127.0.0.1:9/p/seo','seen-seo','no-key','unreachable');
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default) values
   ('${lead}','${company}','${id(1)}','Lead','General',true),
   ('${ads}','${company}','${id(2)}','Meta Ads','Runs the Meta ads.',false),
   ('${seo}','${company}','${id(3)}','SEO','Writes the blog.',false);
 end $$;`);
});

test('the Owner shows an Agent to a Member, who then sees it while a hidden one stays absent, even by its address',async({page,browser})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings');
 const row=page.locator('.ta-table tbody tr').filter({hasText:'مراجع'});
 const toggle=row.getByRole('switch',{name:'مراجع · Meta Ads'});
 await expect(row.getByText('Shown to all')).toBeVisible();
 await expect(toggle).toHaveAttribute('aria-checked','false');
 await expect(row.getByRole('switch',{name:'مراجع · SEO'})).toHaveAttribute('aria-checked','false');
 await expect(page.locator('.ta-table tbody tr').filter({hasText:'Owner'}).getByText('The Owner sees every agent')).toBeVisible();
 await toggle.click();
 await expect(toggle).toHaveAttribute('aria-checked','true');
 await expect(toggle).toBeEnabled();
 await page.reload();
 await expect(page.locator('.ta-table tbody tr').filter({hasText:'مراجع'}).getByRole('switch',{name:'مراجع · Meta Ads'})).toHaveAttribute('aria-checked','true');

 const context=await browser.newContext(); const member=await context.newPage();
 try {
  await signIn(member,'reviewer@example.com','/c/rs-learning/chat');
  await openNavigation(member);
  await expect(member.locator('.sidebar .agent-tile:not(.agent-tile--new) .agent-tile__name')).toHaveText(['Lead','Meta Ads']);
  expect((await member.goto(`/c/rs-learning/chat/${seo}`))!.status()).toBe(404);
  await expect(member.getByRole('heading',{name:'Page not found'})).toBeVisible();
  const refused=await member.request.post('/api/conversations',{data:{company,conversation:randomUUID(),agent:seo,message:'Hello',sendKey:randomUUID()}});
  expect(refused.status()).toBe(404);
  expect((await member.goto(`/c/rs-learning/chat/${ads}`))!.status()).toBe(200);

  // Hidden again: gone from the list at the next page, and its address is not found.
  await row.getByRole('switch',{name:'مراجع · Meta Ads'}).click();
  await expect(page.locator('.ta-table tbody tr').filter({hasText:'مراجع'}).getByRole('switch',{name:'مراجع · Meta Ads'})).toHaveAttribute('aria-checked','false');
  await expect(page.locator('.ta-table tbody tr').filter({hasText:'مراجع'}).getByRole('switch',{name:'مراجع · Meta Ads'})).toBeEnabled();
  expect((await member.goto(`/c/rs-learning/chat/${ads}`))!.status()).toBe(404);
  await member.goto('/c/rs-learning/chat');
  await openNavigation(member);
  await expect(member.locator('.sidebar .agent-tile:not(.agent-tile--new) .agent-tile__name')).toHaveText(['Lead']);
 } finally { await context.close(); }
});

// #190: the board's chips and Cards follow the same switches. Meta Ads is shown to the Contributor again, SEO to
// nobody; SEO, then Meta Ads, wrote on the Meta Ads Card. The board's read itself is proven in supabase/tests/board_cards.sql.
test('the board shows a Member chips and Cards of the Agents they see only, and a Viewer filters by them too',async({page,browser})=>{
 query(`do $$ declare stage bigint; card bigint; begin
  update public.people set language='en' where id='20000000-0000-0000-0000-000000000004';
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','20000000-0000-0000-0000-000000000003','${ads}') on conflict do nothing;
  select id into stage from public.work_stages where company_id='${company}' and board_column='ideas' order by position limit 1;
  insert into public.work_cards(company_id,stage_id,title,channel,agent_id) values
   ('${company}',stage,'Lead plans the month','Instagram','${lead}'),('${company}',stage,'SEO drafts the blog','Blog','${seo}');
  insert into public.work_cards(company_id,stage_id,title,channel,agent_id) values ('${company}',stage,'Ads runs the launch','Meta','${ads}') returning id into card;
  insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,card_id,agent_id,action,body,source,source_id,created_at) values
   ('${company}','${seo}','agent','SEO','card',card,'${seo}','note_reply','Keywords','note_runs',9190101,now()-interval '2 hours'),
   ('${company}','${ads}','agent','Meta Ads','card',card,'${ads}','note_reply','Audience','note_runs',9190102,now()-interval '1 hour');
 end $$;`);
 const chips=(on:typeof page)=>on.getByRole('group',{name:'Filter by agent'}).getByRole('button');
 const card=(on:typeof page,title:string)=>on.locator('#board-cols .kcard').filter({hasText:title});

 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 await expect(chips(page)).toHaveText(['All','Lead','Meta Ads','SEO']);
 await expect(card(page,'Ads runs the launch').locator('.kcard__crew-t')).toHaveText('Worked on it: SEO, Meta Ads');
 await expect(page.getByRole('link',{name:'Ads runs the launch · Worked on it: SEO, Meta Ads',exact:true})).toBeVisible();
 await expect(card(page,'Lead plans the month').locator('.kcard__crew')).toHaveCount(0);

 for(const [email,seen] of [['reviewer@example.com',['All','Lead','Meta Ads']],['viewer@example.com',['All','Lead']]] as [string,string[]][]) {
  const context=await browser.newContext(); const member=await context.newPage();
  try {
   await signIn(member,email,'/c/rs-learning/work/board');
   await expect(chips(member)).toHaveText(seen);
   await expect(card(member,'Lead plans the month')).toHaveCount(1);
   await expect(card(member,'SEO drafts the blog')).toHaveCount(0);
   await expect(card(member,'Ads runs the launch')).toHaveCount(seen.includes('Meta Ads')?1:0);
   await expect(card(member,'Ads runs the launch').locator('.kcard__crew')).toHaveCount(0);
   const leadChip=chips(member).filter({hasText:'Lead'});
   await leadChip.click();
   await expect(leadChip).toHaveAttribute('aria-pressed','true');
   await expect(leadChip).toBeFocused();
   await expect(member.locator('#board-cols .kcard')).toHaveText([/Lead plans the month/]);
   await chips(member).filter({hasText:'All'}).click();
   await expect(card(member,'Lead plans the month')).toHaveCount(1);
  } finally { await context.close(); }
 }
});
