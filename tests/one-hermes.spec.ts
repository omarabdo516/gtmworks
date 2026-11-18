import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #342: the bundled Hermes is the only Hermes. A conversation, a Card note and a channel message that call Lead each
// start their Run on the Company's own profile of the Hermes the app and the worker are given (scripts/web.sh), with
// no Connection anywhere.
const company='10000000-0000-0000-0000-000000000001';
const channel='69000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});

test('a conversation, a Card note and a channel message each start their Run on the Company\'s own profile of the bundled Hermes',async({page})=>{
 test.setTimeout(120000);
 const fake=await laneHermes(); fake.settings.pendingReads=1e9;
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 const lead=randomUUID();
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,name,speciality,is_default,profile) values ('${lead}','${company}','Lead','General',true,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_level,tools_policy,skills_shared) select id,'${profile}',agent_level,public.engine_tool_policy(),true from public.companies where id='${company}'
   on conflict (company_id) do update set tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false,skills_shared=true;
 end $$;`);
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const talk=await page.request.post('/api/conversations',{data:{company,conversation:randomUUID(),sendKey:randomUUID(),agent:lead,message:'Plan the launch week'}});
  expect(talk.status()).toBe(200);
  const said=await page.request.post('/api/channels',{data:{company,channel,sendKey:randomUUID(),message:'@Lead plan the teaser posts'}});
  expect(said.status()).toBe(200);
  // A note that calls Lead on a Card: the worker starts its Run.
  query(`do $$ begin perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
   perform public.change_work_card('${company}',4,'comment','{"body":"@Lead draft the caption"}'::jsonb); end $$;`);
  const runs=()=>fake.settings.requests.filter(request=>request.method==='POST'&&/\/v1\/runs$/.test(request.path??'')).map(request=>request.path);
  await expect.poll(()=>runs().length,{timeout:60000}).toBe(3);
  expect(runs()).toEqual(Array(3).fill(`/p/${profile}/v1/runs`));
  const inputs=fake.settings.runs.map(run=>run.input);
  for(const asked of ['Plan the launch week','@Lead draft the caption','@Lead plan the teaser posts']) expect(inputs.filter(input=>input.includes(asked)),asked).toHaveLength(1);
 } finally {
  query(`delete from public.hermes_agents where id='${lead}'`);
  await fake.close();
 }
});
