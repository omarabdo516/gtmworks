import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { readFile } from 'node:fs/promises';
import { serverLogOf } from './lane.mjs';

// #346: a reply's steps are read from the Agent's Hermes session when the chat opens, never kept by gtmworks. RS Learning
// runs on its own profile in a fake Engine whose management listener serves a session's messages as the pinned release
// does; Lead keeps that profile. The Conversation holds Omar's message and Lead's reply, and the session holds the turn
// between them with its tool calls. Opening the chat shows the session's steps within one second (decision 0042).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
let fake:Awaited<ReturnType<typeof fakeHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id='${omar}'`);
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const connection=randomUUID();
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${connection}','Lead','General',true,'${profile}');
   insert into public.company_profiles(company_id,profile,tools_level,tools_policy) select id,'${profile}',agent_level,public.engine_tool_policy() from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

test('a reply\'s steps on screen are its Hermes session\'s, and the chat shows them within one second of opening',async({page})=>{
 const conversation=randomUUID(); const session=`session-${conversation.slice(0,8)}`; const run=`steps-${conversation.slice(0,8)}`;
 const sent=Date.parse('2026-11-16T10:12:00Z')/1000;
 query(`do $$ begin
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${lead}','Lead','${session}');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values ('${company}','${conversation}','person','${omar}','Omar','Plan the Meta campaign','${randomUUID()}','${run}','2026-11-16T10:12:00Z');
  insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id,created_at) values ('${company}','${conversation}','agent','${lead}','Lead','Here is the plan.','${run}','2026-11-16T10:14:00Z');
 end $$;`);
 const call=(id:string,name:string,args:object)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
 fake.settings.sessions.set(session,{profile,messages:[
  {role:'user',content:'Plan the Meta campaign',timestamp:sent+1},
  {role:'assistant',content:'',tool_calls:[call('call_1','web_search',{query:'accounting courses Cairo'}),call('call_2','read_file',{path:'campaigns.csv'})],timestamp:sent+3},
  {role:'tool',tool_call_id:'call_1',tool_name:'web_search',content:'{"results":[]}',timestamp:sent+10},
  {role:'tool',tool_call_id:'call_2',tool_name:'read_file',content:'{"success":false,"error":"not found"}',timestamp:sent+12},
  {role:'assistant',content:'Here is the plan.',timestamp:sent+42}]});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const toggle=page.locator('.steps__toggle');
 const opened=Date.now();
 await page.goto(`/c/rs-learning/conversations/${conversation}`);
 await expect(toggle).toHaveText('Used 2 tools · 41 sec');
 const took=Date.now()-opened;
 console.log(`chat open to steps visible: ${took} ms`);
 // Where the time went, read after the clock stops: the browser's own timing of the page, and the server's chat_opened
 // line for this open (docs/production-logs.md), written once its response has gone.
 const nav=await page.evaluate(()=>{ const entry=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming; return {firstByte:Math.round(entry.responseStart),domContentLoaded:Math.round(entry.domContentLoadedEventEnd),load:Math.round(entry.loadEventEnd)}; });
 console.log(`  browser: ${JSON.stringify(nav)}`);
 const line=async()=>(await readFile(serverLogOf(),'utf8').catch(()=>'')).split('\n').find(entry=>entry.includes('"chat_opened"')&&entry.includes(conversation));
 await expect.poll(line,{timeout:5000}).toBeTruthy().catch(()=>{});
 console.log(`  server: ${await line()??'no chat_opened line'}`);
 test.info().annotations.push({type:'open-to-steps-visible-ms',description:String(took)});
 expect(took,'the chat opens with its steps within one second').toBeLessThan(1000);
 await toggle.click();
 await expect(page.locator('.steps__list .step')).toHaveText(['web_search · accounting courses CairoDone','read_file · campaigns.csvSkipped']);
 expect(fake.settings.managementRequests.some(request=>request.path?.startsWith(`/api/sessions/${session}/messages?profile=${profile}`)),'read from the Agent\'s own profile').toBe(true);
});
