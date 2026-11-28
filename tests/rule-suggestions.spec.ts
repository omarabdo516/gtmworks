import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #25, what people see: in a team a direct Conversation says it is private, and worked alone it does not. Each
// Conversation is its Agent's Engine session on the lane's fake Hermes (#883). A Contributor's lasting rule sent as a
// suggestion was a card of the old Conversation record, gone with #883 (spec #926 takes rules on).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const [rsLearning,rsConsultations]=['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'];
const [omar,reviewer]=['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003'];
const id=(n:number)=>`69000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [connection,ads,theirs,elsewhere,alone,omars]=[1,2,3,4,5,6].map(id);
const profileOf=(agent:string)=>`ag-${agent.replaceAll('-','')}`;
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
// A serial file's retry starts again from its first test, and its beforeAll from the seed (#451, tests/fresh-seed.ts).
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 for(const [agent,conversation,words] of [[ads,theirs,'Write the Saudi ads'],[alone,omars,'Plan the week']]) {
  fake.settings.profiles.set(profileOf(agent),{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
  fake.settings.sessions.set(`gtmworks-${conversation}`,{profile:profileOf(agent),messages:[{role:'user',content:words,timestamp:1},{role:'assistant',content:'Done.',timestamp:2}]});
 }
 query(`do $$ begin
  -- Each Company's own Engine profile, as the worker leaves it, so its Agents' Engine is found.
  insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'co-'||replace(id::text,'-',''),true from public.companies where id in ('${rsLearning}','${rsConsultations}')
   on conflict (company_id) do update set tools_confirmed=true,tools_pending=false;
  insert into public.agent_profiles(agent_id,company_id,tools_confirmed) values ('${ads}','${rsLearning}',true),('${alone}','${rsConsultations}',true);
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('${ads}','${rsLearning}','${connection}','Ads','Runs the ads.','${profileOf(ads)}'),('${alone}','${rsConsultations}','${elsewhere}','Ads','Runs the ads.','${profileOf(alone)}');
  insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${ads}' from public.members where company_id='${rsLearning}' and removed_at is null and role<>'owner';
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${theirs}','${rsLearning}','${reviewer}','${ads}','Ads','gtmworks-${theirs}'),('${omars}','${rsConsultations}','${omar}','${alone}','Ads','gtmworks-${omars}');
 end $$;`);
});
test.afterAll(async()=>{ query(`update public.companies set work_mode='team' where id='${rsConsultations}'`); await fake?.close(); });

test('in a team a direct Conversation says it is private; worked alone it does not',async({page})=>{
 await signIn(page,'reviewer@example.com',`/c/rs-learning/conversations/${theirs}`);
 await expect(page.locator('.priv-line')).toHaveText('This chat is just between you and Ads');
 await page.goto(`/c/rs-learning/chat/${ads}`);
 await expect(page.locator('.priv-line')).toHaveText('This chat is just between you and Ads');
 await page.context().clearCookies();

 query(`update public.companies set work_mode='alone' where id='${rsConsultations}'`);
 await signIn(page,'omar@example.com',`/c/rs-consultations/conversations/${omars}`);
 await expect(page.locator('.msg')).not.toHaveCount(0,{timeout:20000});
 await expect(page.locator('.priv-line')).toHaveCount(0);
 await page.goto(`/c/rs-consultations/chat/${alone}`);
 await expect(page.locator('.empty-chat')).toBeVisible();
 await expect(page.locator('.priv-line')).toHaveCount(0);
 query(`update public.companies set work_mode='team' where id='${rsConsultations}'`);
 await page.goto(`/c/rs-consultations/conversations/${omars}`);
 await expect(page.locator('.priv-line')).toHaveText('This chat is just between you and Ads');
});
