import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

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
 freshSeed(testInfo);
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
 await expect(page.locator('#lbl-ch')).toHaveCount(0);

 await page.goto('/c/rs-consultations/settings');
 await expect(page.getByText('Alone · just you and the agents')).toBeVisible();
 // The Invite link for the first Member is on Members (#612, #953).
 await page.goto('/c/rs-consultations/settings?section=members');
 await page.getByRole('button',{name:'Make an invite link'}).click();
 await expect(page.locator('#lnk-role')).toHaveValue('contributor');
 await expect(page.locator('#lnk-role-d')).toHaveText('Contributor: Writes with the agents you choose for them.');
 await page.locator('#lnk-role').selectOption('viewer');
 await expect(page.locator('#lnk-role-d')).toHaveText('Viewer: Reads only, without writing or approving.');
 await expect(page.getByRole('heading',{name:'Members and the agents they work with'})).toHaveCount(0);
 await expect(page.getByRole('switch')).toHaveCount(0);

 await page.goto('/c/rs-consultations/settings?section=agents');
 await expect(page.locator('.sov-page--agents')).toBeVisible();
 await expect(page.getByRole('switch')).toHaveCount(0);

 // The legacy members page holds the Member permissions; alone it opens the settings overlay instead.
 await page.goto('/c/rs-consultations/settings/members');
 await expect(page).toHaveURL(/\/c\/rs-consultations\/settings\?section=members$/);
 await expect(page.locator('.member-form')).toHaveCount(0);
});

test('the first Person who joins with an Invite link makes the Company a team and every earlier Conversation, Card and log row is unchanged',async({page,browser})=>{
 const label='Alone Person', email=`alone-${Date.now()}@example.com`;
 await signIn(page,'omar@example.com','/c/rs-consultations/settings?section=members');
 await page.getByRole('button',{name:'Make an invite link'}).click();
 await page.locator('#lnk-label').fill(label);
 await page.getByRole('button',{name:'Make the link'}).click();
 const field=page.getByLabel(`Invite link for ${label}`);
 await expect(field).toHaveValue(/\/join#code=[a-f0-9]{64}$/);
 const link=await field.inputValue();
 await page.locator('section[aria-labelledby="lnk-h"]').getByRole('button',{name:'Done'}).click();
 // A link is not a Member yet: the Company stays alone until its Person joins.
 await page.goto('/c/rs-consultations/settings');
 await expect(page.getByText('Alone · just you and the agents')).toBeVisible();
 expect(rows(`select work_mode from public.companies where id='${company}'`)[0].work_mode).toBe('alone');

 const fresh=await browser.newContext(); const person=await fresh.newPage();
 await person.goto(link);
 await person.getByLabel('Your name').fill(label);
 await person.getByLabel('Email').fill(email);
 await person.getByLabel('Password',{exact:true}).fill('alone-joined-password');
 await person.getByLabel('Confirm password').fill('alone-joined-password');
 await person.getByRole('button',{name:'Join and sign in'}).click();
 await expect(person).toHaveURL(/\/c\/rs-consultations\/home$/);
 await fresh.close();
 expect(rows(`select work_mode from public.companies where id='${company}'`)[0].work_mode).toBe('team');

 // Omar's own page is still signed in: the new Person joined in a separate context.
 await page.goto('/c/rs-consultations/home');
 await expect(channels(page)).toBeVisible();
 await page.goto('/c/rs-consultations/settings');
 await expect(page.getByText('With a team · 2 members')).toBeVisible();
 await page.goto('/c/rs-consultations/settings?section=members');
 await expect(page.getByRole('heading',{name:'Members and the agents they work with'})).toBeVisible();

 expect(counts()).toEqual(before);
 const last=Number(earlierLog.at(-1)?.id ?? 0);
 expect(logRows(last)).toEqual(earlierLog);
});
