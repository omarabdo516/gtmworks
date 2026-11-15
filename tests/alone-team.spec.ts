import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn, emailLink } from './sign-in';

// #10: a person working alone sees no channels, no Member permissions and no per-member Agents, and keeps the Activity
// log; when the first invited Member accepts, the Company is a team and nothing earlier is moved or lost. RS
// Consultations, where Omar is the only Member, is set to alone for this file (the seed is put back per file).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000002';
const omar='20000000-0000-0000-0000-000000000001';
const counts=()=>rows(`select (select count(*) from public.conversations where company_id='${company}')::int conversations, (select count(*) from public.work_cards where company_id='${company}')::int cards`)[0];
const logRows=(upTo?:number)=>rows(`select id,actor_id,actor_kind,actor_name,subject,card_id,person_id,agent_id,action,details,body,source,source_id,created_at from public.company_log where company_id='${company}'${upTo===undefined?'':` and id<=${upTo}`} order by id`);
const channels=(page:Page)=>page.getByRole('heading',{name:'Channels',exact:true});

test.describe.configure({mode:'serial'});
let before:Record<string,unknown>; let earlierLog:Record<string,unknown>[];

test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo.file);
 query(`do $$ begin
  update public.companies set work_mode='alone' where id='${company}';
  if not exists(select 1 from public.conversations where company_id='${company}') then
   insert into public.conversations(id,company_id,person_id,agent_name) values (gen_random_uuid(),'${company}','${omar}','Lead');
  end if;
  if not exists(select 1 from public.work_cards where company_id='${company}') then
   insert into public.work_cards(company_id,stage_id,title) select '${company}',id,'Alone card' from public.work_stages where company_id='${company}' order by position limit 1;
  end if;
 end $$;`);
 before=counts(); earlierLog=logRows();
 expect(before).toEqual({conversations:expect.any(Number),cards:expect.any(Number)});
 expect(Number(before.conversations)).toBeGreaterThan(0); expect(Number(before.cards)).toBeGreaterThan(0);
});

test('alone: the sidebar has no channels and keeps the log; settings has no members, permissions or per-member agents',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-consultations/home');
 await expect(page.locator('.home-dashboard')).toBeVisible();
 await expect(page.getByRole('link',{name:'Activity log'}).first()).toBeVisible();
 await expect(channels(page)).toHaveCount(0);
 await expect(page.locator('.thread-group')).toHaveCount(0);

 await page.goto('/c/rs-consultations/settings');
 await expect(page.getByText('Alone · just you and the agents')).toBeVisible();
 await expect(page.getByLabel('Member’s email')).toBeVisible();
 await expect(page.locator('#inv-role')).toHaveValue('contributor');
 await expect(page.locator('#inv-role-d')).toHaveText('Contributor: Writes with the agents you choose for them.');
 await page.locator('#inv-role').selectOption('viewer');
 await expect(page.locator('#inv-role-d')).toHaveText('Viewer: Reads only, without writing or approving.');
 await expect(page.getByRole('heading',{name:'Members and the agents they work with'})).toHaveCount(0);
 await expect(page.getByRole('switch')).toHaveCount(0);

 await page.goto('/c/rs-consultations/settings?section=agents');
 await expect(page.locator('.sov-page--agents')).toBeVisible();
 await expect(page.getByRole('switch')).toHaveCount(0);

 // The legacy members page holds the Member permissions; alone it opens the settings overlay instead.
 await page.goto('/c/rs-consultations/settings/members');
 await expect(page).toHaveURL(/\/c\/rs-consultations\/settings$/);
 await expect(page.locator('.member-form')).toHaveCount(0);
});

test('the first invited Member accepts: the Company is a team and every earlier Conversation, Card and log row is unchanged',async({page,context})=>{
 const email=`alone-${Date.now()}@example.com`;
 await signIn(page,'omar@example.com','/c/rs-consultations/settings');
 await page.getByLabel('Member’s email').fill(email);
 await page.getByRole('button',{name:'Invite',exact:true}).click();
 await expect(page.locator('.inv-sec [role=status]')).toHaveText('An invitation link was sent by email.');
 // An invitation is not a Member yet: the Company stays alone until it is accepted.
 await expect(page.getByText('Alone · just you and the agents')).toBeVisible();
 expect(rows(`select work_mode from public.companies where id='${company}'`)[0].work_mode).toBe('alone');

 const link=await emailLink(page,email);
 await context.clearCookies(); await page.goto(link);
 await page.getByLabel('New password').fill('alone-invited-password'); await page.getByLabel('Confirm password').fill('alone-invited-password');
 await page.getByRole('button',{name:'Save password'}).click();
 await expect(page).toHaveURL(/\/c\/rs-consultations\//);
 expect(rows(`select work_mode from public.companies where id='${company}'`)[0].work_mode).toBe('team');

 await context.clearCookies();
 await signIn(page,'omar@example.com','/c/rs-consultations/home');
 await expect(channels(page)).toBeVisible();
 await page.goto('/c/rs-consultations/settings');
 await expect(page.getByText('With a team · 2 members')).toBeVisible();
 await expect(page.getByRole('heading',{name:'Members and the agents they work with'})).toBeVisible();
 await expect(page.locator('#inv-email')).toHaveCount(0);

 expect(counts()).toEqual(before);
 const last=Number(earlierLog.at(-1)?.id ?? 0);
 expect(logRows(last)).toEqual(earlierLog);
});
