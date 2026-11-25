import { test, expect, freshSeed, laneRows } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import type { Browser } from '@playwright/test';
import { signIn } from './sign-in';

// #675, archiving a team channel (design-reference-card: renderTeamDetails' "Archive the channel", cwConfirm, cvArchive,
// cwUndo). RS Learning's team channel "Spring launch" holds the Manager and a Contributor, with Ads in it; the Owner is
// outside it. A step Ads handed the team waits there, so archiving asks once and names it. Every Role, another Company,
// the Runs stopped and the log's readers are proven in supabase/tests/channel_archive.sql.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const channel='6c750000-0000-0000-0000-000000000011';
const agent='6c750000-0000-0000-0000-000000000001';
const path=`/c/rs-learning/channels/${channel}`;

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo);
 query(`do $$ declare m bigint; begin
  update public.people set language='en' where id::text like '20000000-%';
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('${agent}','${company}','6c750000-0000-0000-0000-000000000002','Ads','Runs the ads.',false,'archive-ads');
  insert into public.channels(id,company_id,kind,name,created_by,create_key) values
   ('${channel}','${company}','team','Spring launch','20000000-0000-0000-0000-000000000002','6c750000-0000-0000-0000-000000000003');
  insert into public.channel_people(channel_id,company_id,person_id,added_by) values
   ('${channel}','${company}','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002'),
   ('${channel}','${company}','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002');
  insert into public.channel_agents(channel_id,company_id,agent_id,added_by) values ('${channel}','${company}','${agent}','20000000-0000-0000-0000-000000000002');
  insert into public.channel_messages(company_id,channel_id,author,person_id,author_name,body,send_key)
   values ('${company}','${channel}','person','20000000-0000-0000-0000-000000000002','مدير','@Ads publish the post','6c750000-0000-0000-0000-000000000004') returning id into m;
  insert into public.channel_runs(message_id,ordinal,company_id,channel_id,agent_id,agent_name,session,input,run_id,profile,attempts,attempted_at,outcome,closed_at)
   values (m,1,'${company}','${channel}','${agent}','Ads',gen_random_uuid(),'publish','run-archive-hand','archive-ads',1,now(),'completed',now());
  insert into public.reply_cards(company_id,channel_message_id,channel_ordinal,run_id,call_id,kind,title,content,state)
   values ('${company}',m,1,'run-archive-hand','call-archive-hand','hand','Publish the post','{"app":"WordPress","line":"The draft is ready","rows":[]}','open');
 end $$;`);
});
async function as(browser:Browser,email:string,at:string) {
 const context=await browser.newContext(); const page=await context.newPage();
 await signIn(page,email,at);
 return {page,close:()=>context.close()};
}

test('the Manager archives a team channel after one confirmation naming what waits there, and Undo brings it back',async({page})=>{
 await signIn(page,'manager@example.com',path);
 const sidebar=page.locator('.sidebar .ch-item');
 await expect(sidebar).toHaveText(['general','Spring launch']);
 const details=page.getByRole('complementary',{name:'Channel details'});
 const archive=details.getByRole('button',{name:'Archive the channel'});
 await expect(async()=>{
  if(!await page.getByRole('dialog',{name:'Archive the channel?'}).count()) await archive.click();
  await expect(page.getByRole('dialog',{name:'Archive the channel?'})).toBeVisible({timeout:2000});
 }).toPass({timeout:30000});
 const confirm=page.getByRole('dialog',{name:'Archive the channel?'});
 await expect(confirm.getByRole('button',{name:'Cancel'})).toBeFocused();
 await expect(confirm.getByRole('listitem')).toHaveText(['The step Ads handed the team, “Publish the post”, stops waiting']);
 await confirm.getByRole('button',{name:'Archive and stop'}).click();
 await expect(page.locator('.toast')).toContainText('Archived');
 await expect(sidebar).toHaveText(['general']);
 await expect(page.locator('.arc-line')).toHaveText('This channel is archived. Nobody writes in it until it is restored.');
 await expect(page.getByRole('textbox',{name:'Write your message in the channel'})).toHaveCount(0);
 // Read on the lane's database at once (laneRows): Undo lasts only as long as its toast (app/toast.tsx), and a read
 // through the Supabase CLI took up to 8 s on a loaded runner, past it (#746).
 expect(laneRows(`select archived_by::text by from public.channels where id='${channel}'`)).toEqual([{by:'20000000-0000-0000-0000-000000000002'}]);
 await page.locator('.toast').getByRole('button',{name:'Undo'}).click();
 await expect(page.locator('.toast')).toContainText('Restored');
 await expect(sidebar).toHaveText(['general','Spring launch']);
 await expect(page.locator('.arc-line')).toHaveCount(0);
 expect(rows(`select archived_at from public.channels where id='${channel}'`)).toEqual([{archived_at:null}]);
});

test('with nothing waiting it archives without asking; its Members read it and cannot write; the Owner outside it sees nothing; the Manager restores it',async({page,browser})=>{
 await signIn(page,'manager@example.com',path);
 const details=page.getByRole('complementary',{name:'Channel details'});
 // The first archive closed the handed step and nothing works there now, so archiving asks nothing.
 // A click before hydration does nothing and is made again; a click that reached the server is waited for, so a second
 // one never restores what the first archived (#746).
 await expect(async()=>{
  if(!await details.getByRole('button',{name:'Restore the channel'}).count()) await details.getByRole('button',{name:'Archive the channel'}).click();
  await expect(details.getByRole('button',{name:'Restore the channel'})).toBeVisible({timeout:10000});
 }).toPass({timeout:30000});
 await expect(page.getByRole('dialog',{name:'Archive the channel?'})).toHaveCount(0);
 await expect(page.locator('.toast')).toContainText('Archived');

 const contributor=await as(browser,'reviewer@example.com',path);
 try {
  await expect(contributor.page.locator('.arc-line')).toBeVisible();
  await expect(contributor.page.getByText('@Ads publish the post')).toBeVisible();
  await expect(contributor.page.getByRole('textbox',{name:'Write your message in the channel'})).toHaveCount(0);
  await expect(contributor.page.getByRole('button',{name:/channel$/})).toHaveCount(0);
  await expect(contributor.page.locator('.sidebar .ch-item')).toHaveText(['general']);
  // All conversations lists it under Archived, and no longer under Current (design-reference-card: renderConvos).
  await contributor.page.goto('/c/rs-learning/conversations?tab=archived');
  await expect(contributor.page.getByRole('list',{name:'Archived'}).getByRole('link',{name:/Spring launch/})).toBeVisible();
  await contributor.page.goto('/c/rs-learning/conversations');
  await expect(contributor.page.getByRole('link',{name:/Spring launch/})).toHaveCount(0);
  await contributor.page.goto('/c/rs-learning/log');
  await expect(contributor.page.getByText('archived the channel').first()).toBeVisible();
 } finally { await contributor.close(); }

 const owner=await as(browser,'omar@example.com','/c/rs-learning/log');
 try {
  await expect(owner.page.getByRole('heading',{name:'Activity log'})).toBeVisible();
  await expect(owner.page.getByText('archived the channel')).toHaveCount(0);
  const response=await owner.page.goto(path);
  expect(response?.status()).toBe(404);
 } finally { await owner.close(); }

 await details.getByRole('button',{name:'Restore the channel'}).click();
 await expect(page.locator('.toast')).toContainText('Restored');
 await expect(page.getByRole('textbox',{name:'Write your message in the channel'})).toBeVisible();
 expect(rows(`select count(*)::int n from public.channel_runs where channel_id='${channel}' and outcome is null`)[0].n).toBe(0);
});

test('the general channel has no Archive',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/channels/69000000-0000-0000-0000-000000000001');
 await expect(page.getByRole('complementary',{name:'Channel details'}).getByRole('heading',{name:'Members'})).toBeAttached();
 await expect(page.getByRole('button',{name:'Archive the channel'})).toHaveCount(0);
});
