import { test, expect, freshSeed, type Page } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #347 (decision 0042): token use is Hermes's own, never counted by gtmworks. RS Learning and Aleem run on their own
// profiles in a fake Engine whose management listener answers a session's totals and a profile's usage analytics as
// the pinned release does; RS Learning's Writer has a profile of its own. A chat shows its session's tokens, and the
// usage screens show each Agent's profile's numbers to the Owner of its Company.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rs='10000000-0000-0000-0000-000000000001';
const aleem='10000000-0000-0000-0000-000000000003';
const omar='20000000-0000-0000-0000-000000000001';
const manager='20000000-0000-0000-0000-000000000002';
const profileOf=(company:string)=>`co-${company.replaceAll('-','')}`;
const [rsLead,aleemLead,writer]=[randomUUID(),randomUUID(),randomUUID()];
const writerProfile=`ag-${writer.replaceAll('-','')}`;
let fake:Awaited<ReturnType<typeof fakeHermes>>;

// The Company's Lead on its own profile of the bundled Engine, as chat-steps.spec.ts sets it up.
async function bundled(page:Page,company:string,lead:string) {
 const connection=randomUUID();
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${connection}','Lead','General',true,'${profileOf(company)}');
  insert into public.company_profiles(company_id,profile,tools_level,tools_policy) select id,'${profileOf(company)}',agent_level,public.engine_tool_policy() from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
 end $$;`);
}

test.describe.configure({mode:'serial'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file);
 fake=await laneHermes();
 for(const profile of [profileOf(rs),profileOf(aleem),writerProfile]) fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id in ('${omar}','${manager}')`);
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  await bundled(page,rs,rsLead); await bundled(page,aleem,aleemLead);
  // Writer moved to its own profile (ADR 0016), as connected-tools.spec.ts sets it up: its profile's record first.
  const own=randomUUID();
  query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy) select '${writer}',id,agent_level,public.engine_tool_policy() from public.companies where id='${rs}';
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${writer}','${rs}','${own}','Writer','Writing',false,'${writerProfile}');
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

test('a chat shows its Hermes session\'s token use, and none while Hermes does not know the session',async({page})=>{
 const [known,unknown]=[randomUUID(),randomUUID()]; const session=`session-${known.slice(0,8)}`;
 for(const [conversation,id] of [[known,session],[unknown,`gone-${unknown.slice(0,8)}`]]) query(`do $$ begin
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${rs}','${omar}','${rsLead}','Lead','${id}');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values ('${rs}','${conversation}','person','${omar}','Omar','Plan the launch week','${randomUUID()}','run-${conversation.slice(0,8)}');
  insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id) values ('${rs}','${conversation}','agent','${rsLead}','Lead','Here is the week.','run-${conversation.slice(0,8)}');
 end $$;`);
 // Started long ago, so the usage screens' periods below do not count it.
 fake.settings.sessions.set(session,{profile:profileOf(rs),messages:[],input_tokens:29000,output_tokens:32,started_at:Date.now()/1000-100*86400});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await page.goto(`/c/rs-learning/conversations/${known}`);
 await expect(page.locator('[data-usage]')).toHaveText('29,032 tokens used (29,000 in, 32 out)');
 expect(fake.settings.managementRequests.some(request=>request.path===`/api/sessions/${session}?profile=${profileOf(rs)}`),'read from the Agent\'s own profile').toBe(true);
 await page.goto(`/c/rs-learning/conversations/${unknown}`);
 await expect(page.getByText('Here is the week.')).toBeVisible();
 await expect(page.locator('[data-usage]'),'usage Hermes cannot read is never shown as zero').toHaveCount(0);
});

test('an Owner of several companies sees each Agent\'s tokens from Hermes, and an Owner of one company only their own',async({page,browser})=>{
 const now=Date.now()/1000;
 fake.settings.sessions.set(`u-${randomUUID()}`,{profile:profileOf(rs),messages:[],input_tokens:1200,output_tokens:34,started_at:now-3600});
 fake.settings.sessions.set(`u-${randomUUID()}`,{profile:profileOf(rs),messages:[],input_tokens:800,output_tokens:6,started_at:now-2*86400});
 fake.settings.sessions.set(`u-${randomUUID()}`,{profile:writerProfile,messages:[],input_tokens:5000,output_tokens:60,started_at:now-3600});
 fake.settings.sessions.set(`u-${randomUUID()}`,{profile:writerProfile,messages:[],input_tokens:9000,output_tokens:90,started_at:now-20*86400});
 fake.settings.sessions.set(`u-${randomUUID()}`,{profile:profileOf(aleem),messages:[],input_tokens:700,output_tokens:7,started_at:now-3600});
 const row=(viewer:Page,company:string,agent:string)=>viewer.getByRole('row').filter({hasText:company}).filter({has:viewer.getByRole('cell',{name:agent,exact:true})});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await page.goto('/c/rs-learning/settings');
 await page.getByRole('link',{name:'Usage',exact:true}).click();
 // Usage is a section of the settings overlay (#26): the last 7 days by default, each Agent's profile's own count.
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings\?section=usage$/);
 await expect(row(page,'RS Learning','Lead').getByRole('cell')).toHaveText(['RS Learning','Lead','2,000','40','2']);
 await expect(row(page,'RS Learning','Writer').getByRole('cell')).toHaveText(['RS Learning','Writer','5,000','60','1']);
 await expect(row(page,'Aleem','Lead').getByRole('cell')).toHaveText(['Aleem','Lead','700','7','1']);
 await expect(page.locator('.use-kpis .kpi__val')).toHaveText(['7,100','3','0']);
 expect(fake.settings.managementRequests.some(request=>request.path===`/api/analytics/usage?profile=${writerProfile}&days=7`),'read from the Agent\'s own profile').toBe(true);
 await page.getByRole('link',{name:'Last 30 days'}).click();
 await expect(row(page,'RS Learning','Writer').getByRole('cell')).toHaveText(['RS Learning','Writer','14,000','150','2']);
 query(`update public.members set role='owner' where company_id='${rs}' and person_id='${manager}'`);
 const context=await browser.newContext(); const owner=await context.newPage();
 try {
  await signIn(owner,'manager@example.com','/c/rs-learning/usage');
  await expect(row(owner,'RS Learning','Writer').getByRole('cell')).toHaveText(['RS Learning','Writer','14,000','150','2']);
  await expect(owner.getByRole('row').filter({hasText:'Aleem'})).toHaveCount(0);
  expect((await owner.goto('/c/aleem/usage'))!.status()).toBe(404);
 } finally { await context.close(); query(`update public.members set role='manager' where company_id='${rs}' and person_id='${manager}'`); }
});
