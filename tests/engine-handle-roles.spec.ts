import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #782: a Conversation's Run and session reads reach the Engine through the handle, on the Agent's profile as the reader
// may see it. For each Role, the reader an Agent is shown to reads their Conversation's steps from its session and asks
// for its live Steps; once the Agent is hidden from them, both answer "not found", and the Engine is not asked. The
// Owner sees every Agent. The database side of who sees an Agent is proven in supabase/tests/member_agent_visibility.sql.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID(), quill=randomUUID();
const people={owner:['omar@example.com','20000000-0000-0000-0000-000000000001'],manager:['manager@example.com','20000000-0000-0000-0000-000000000002'],
 contributor:['reviewer@example.com','20000000-0000-0000-0000-000000000003'],viewer:['viewer@example.com','20000000-0000-0000-0000-000000000004']} as const;
const talks=Object.fromEntries(Object.keys(people).map(role=>[role,randomUUID()])) as Record<keyof typeof people,string>;
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 const at=Date.now()/1000;
 for(const [role,talk] of Object.entries(talks)) fake.settings.sessions.set(`s-${talk}`,{profile,input_tokens:40,output_tokens:4,messages:[
  {role:'user',content:`Plan the week (${role})`,timestamp:at-5},{role:'assistant',content:'Done.',timestamp:at}]});
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}'),
   ('${quill}','${company}','${randomUUID()}','Quill','Articles',false,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  insert into public.member_agent_access(company_id,person_id,agent_id) values
   ('${company}','${people.manager[1]}','${quill}'),('${company}','${people.contributor[1]}','${quill}'),('${company}','${people.viewer[1]}','${quill}');
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values
   ${Object.entries(talks).map(([role,talk])=>`('${talk}','${company}','${people[role as keyof typeof people][1]}','${quill}','Quill','s-${talk}')`).join(',')};
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

for(const role of Object.keys(people) as (keyof typeof people)[]) {
 test(`the ${role} reads the steps of a Conversation with an Agent shown to them, and an Agent hidden from them is not found`,async({page})=>{
  const talk=talks[role];
  await signIn(page,people[role][0],'/c/rs-learning/chat');
  const steps=()=>page.request.get(`/api/conversations?company=${company}&conversation=${talk}&intent=steps`);
  const live=()=>page.request.get(`/api/run-steps?company=${company}&conversation=${talk}`);
  const sessionReads=()=>fake.settings.managementRequests.filter(request=>request.path?.startsWith(`/api/sessions/s-${talk}/messages`)).length;

  const read=await steps();
  expect(read.status()).toBe(200);
  expect((await read.json()).usage).toMatchObject({input:40,output:4});
  expect(sessionReads(),'the session is read on the Agent\'s profile').toBeGreaterThan(0);
  const open=await live();
  expect(open.status()).toBe(200);
  expect(await open.text()).toBe('{"end":"none"}\n');

  // Hidden from them: the Owner still sees every Agent; anyone else is answered "not found", and the Engine is not asked.
  query(`delete from public.member_agent_access where company_id='${company}' and person_id='${people[role][1]}' and agent_id='${quill}'`);
  const before=sessionReads();
  const hidden=[await steps(),await live()];
  if(role==='owner') expect(hidden.map(answer=>answer.status())).toEqual([200,200]);
  else {
   expect(hidden.map(answer=>answer.status())).toEqual([404,404]);
   expect(await Promise.all(hidden.map(answer=>answer.json()))).toEqual([{error:'conversationNotFound'},{error:'conversationNotFound'}]);
   expect(sessionReads(),'nothing is read for a hidden Agent').toBe(before);
  }
 });
}
