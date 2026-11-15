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
