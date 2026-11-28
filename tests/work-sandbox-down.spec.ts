import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #398: a Company whose work sandbox is not running says so once in Settings, in both languages, and stops saying it when
// the sandbox answers; a reply whose tool could not run shows one plain error under it while the Conversation still
// answers, and a reply that needed no tool says nothing extra.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const omar='20000000-0000-0000-0000-000000000001';
const english='This Company’s work sandbox is not running. Ask the install owner to start it.';
const arabic='صندوق الشغل بتاع الشركة دي مش شغال. اسأل صاحب التثبيت يشغّله.';
const call=(id:string,name:string,args:object)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
let fake:Awaited<ReturnType<typeof laneHermes>>;
let lead:string;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 lead=randomUUID();
 query(`update public.people set language='en' where id='${omar}'`);
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

test('Settings names a work sandbox that is not running in English and Arabic, and stops when it answers again',async({page})=>{
 fake.settings.sandboxDown=true;
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  await page.goto('/c/rs-learning/settings?section=company');
  await expect(page.locator('#co-sandbox')).toHaveText(english);
  query(`update public.people set language='ar' where id='${omar}'`);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','ar');
  await expect(page.locator('#co-sandbox')).toHaveText(arabic);
  // The sandbox answers again: the same read says nothing, with no restart and nothing else changed.
  fake.settings.sandboxDown=false;
  query(`update public.people set language='en' where id='${omar}'`);
  await page.reload();
  await expect(page.locator('#co-sandbox')).toHaveCount(0);
  await expect(page.locator('section[aria-labelledby="co-h-tools"]')).toContainText('Every agent of the company works in its work sandbox');
 } finally { query(`update public.people set language='en' where id='${omar}'`); }
});

test('a reply whose command could not run because the sandbox is down says so under the reply, and a reply that needed no tool does not',async({page})=>{
 const conversation=randomUUID(); const session=`sandbox-${conversation.slice(0,8)}`;
 const sent=Date.parse('2026-11-16T10:12:00Z')/1000;
 query(`do $$ begin
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${lead}','Lead','${session}');
 end $$;`);
 fake.settings.sessions.set(session,{profile,messages:[
  {role:'user',content:'Trim the clip',timestamp:sent+1},
  {role:'assistant',content:'',tool_calls:[call('call_1','terminal',{command:'ffmpeg -version'})],timestamp:sent+3},
  // What the pinned Engine answers when its ssh backend cannot reach the sandbox (tools/terminal_tool.py _degraded_result).
  {role:'tool',tool_call_id:'call_1',tool_name:'terminal',content:JSON.stringify({output:'',exit_code:-1,status:'degraded',reason:'SSH connection failed',error:'Terminal backend degraded: SSH connection failed'}),timestamp:sent+5},
  {role:'assistant',content:'I could not run that.',timestamp:sent+42}]});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await page.goto(`/c/rs-learning/conversations/${conversation}`);
 await expect(page.locator('.msg[data-author=agent] .bubble').last()).toHaveText('I could not run that.');
 await expect(page.locator('[data-outcome=sandbox]')).toHaveText(english);

 // A message that needs no tool is answered as usual, with no such line.
 const plain=randomUUID(); const plainSession=`plain-${plain.slice(0,8)}`;
 query(`do $$ begin
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${plain}','${company}','${omar}','${lead}','Lead','${plainSession}');
 end $$;`);
 fake.settings.sessions.set(plainSession,{profile,messages:[
  {role:'user',content:'Say hello',timestamp:Date.parse('2026-11-16T11:12:00Z')/1000+1},
  {role:'assistant',content:'Hello.',timestamp:Date.parse('2026-11-16T11:12:00Z')/1000+2}]});
 await page.goto(`/c/rs-learning/conversations/${plain}`);
 await expect(page.locator('.msg[data-author=agent] .bubble').last()).toHaveText('Hello.');
 await expect(page.locator('[data-outcome=sandbox]')).toHaveCount(0);
});
