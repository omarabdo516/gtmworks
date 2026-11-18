import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { fakeHermes } from './fake-hermes.mjs';
import { signIn } from './sign-in';
import { lane } from './lane.mjs';
import { keepSharedSkills } from '../lib/shared-skills.mjs';

// #343: a lesson an Agent learned reaches every Agent as the Company's shared skill team-lessons in Hermes, never a
// skill row in gtmworks. A Contributor's lasting rule is sent to the Owner as a suggestion (agent_save_rule, as closing
// the run does); the Owner makes it team-wide from "Waiting on you", and the worker's pass writes it into the shared
// skill in a fake Engine, read by the Company's own profile. A suggestion still waiting is not written.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
const company='10000000-0000-0000-0000-000000000001';
const [omar,reviewer]=['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003'];
const hex=company.replaceAll('-','');
const [profile,space]=[`co-${hex}`,`cs-${hex}`];
const id=(n:number)=>`69430000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [connection,ads,theirs]=[1,2,3].map(id);
const approved='From now on, open every hook with a number';
const waiting='From now on, never name a price in a hook';
let fake:Awaited<ReturnType<typeof fakeHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await fakeHermes({host:`127.0.0.${100+lane}`});
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`do $$ begin
  insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${connection}','${company}','${omar}','http://127.0.0.1:9/p/lessons','lessons-ads','no-key','unreachable');
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${ads}','${company}','${connection}','Ads','Runs the ads.');
  insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${ads}' from public.members where company_id='${company}' and removed_at is null and role<>'owner';
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${theirs}','${company}','${reviewer}','${ads}','Ads');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at) values
   ('${company}','${theirs}','person','${reviewer}',null,'مراجع','${approved}','${id(7)}','lesson-1',now()-interval '10 minutes'),
   ('${company}','${theirs}','person','${reviewer}',null,'مراجع','${waiting}','${id(8)}','lesson-2',now()-interval '8 minutes');
  perform public.agent_save_rule('${theirs}','lesson-1','call-0','${approved}');
  perform public.agent_save_rule('${theirs}','lesson-2','call-0','${waiting}');
  insert into public.company_profiles(company_id,profile,tools_level,tools_policy) select id,'${profile}',agent_level,public.engine_tool_policy() from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

test('an approved lesson reaches the shared skill team-lessons in Hermes', async ({page}) => {
 await signIn(page,'omar@example.com','/c/rs-learning/approvals');
 const suggestion=(rule:string)=>page.getByRole('group',{name:'A rule for Ads, told by مراجع'}).filter({hasText:rule});
 await suggestion(approved).getByRole('button',{name:'Make it team-wide'}).click();
 await expect(suggestion(approved)).toHaveCount(0);
 await expect(suggestion(waiting)).toBeVisible();
 // The worker's pass, against the fake Engine.
 const value=status();
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 await keepSharedSkills(service,{hermes:{address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:fake.settings.key}});
 const lessons=fake.settings.skills.get(space)?.get('team-lessons');
 expect(lessons).toContain(`- ${approved}\n`);
 expect(lessons).not.toContain(waiting);
 expect(fake.settings.profiles.get(profile)?.config?.skills?.external_dirs).toEqual([`/opt/data/profiles/${space}/skills`]);
});
