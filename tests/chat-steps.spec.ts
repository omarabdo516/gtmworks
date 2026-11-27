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
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id='${omar}'`);
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const connection=randomUUID();
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${connection}','Lead','General',true,'${profile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

test('a reply\'s steps on screen are its Hermes session\'s, and the chat\'s first byte is under one second',async({page})=>{
 const conversation=randomUUID(); const session=`session-${conversation.slice(0,8)}`;
 const sent=Date.parse('2026-11-16T10:12:00Z')/1000;
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${lead}','Lead','${session}')`);
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
 // The clock stops when the steps are on screen, not at the page's load event (decision 0042, Omar 2026-11-18).
 await page.goto(`/c/rs-learning/conversations/${conversation}`,{waitUntil:'commit'});
 await expect(toggle).toHaveText('Used 2 tools · 41 sec');
 const took=Date.now()-opened;
 // Where the time went, read after the clock stops: the browser's own timing of the page, and the server's chat_opened
 // line for this open (docs/production-logs.md), written once its response has gone.
 const nav=await page.evaluate(()=>{ const entry=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming; return {firstByte:Math.round(entry.responseStart),domContentLoaded:Math.round(entry.domContentLoadedEventEnd),load:Math.round(entry.loadEventEnd)}; });
 console.log(`chat open: first byte ${nav.firstByte} ms, steps visible ${took} ms`);
 console.log(`  browser: ${JSON.stringify(nav)}`);
 const line=async()=>(await readFile(serverLogOf(),'utf8').catch(()=>'')).split('\n').find(entry=>entry.includes('"chat_opened"')&&entry.includes(conversation));
 await expect.poll(line,{timeout:5000}).toBeTruthy().catch(()=>{});
 console.log(`  server: ${await line()??'no chat_opened line'}`);
 test.info().annotations.push({type:'first-byte-ms',description:String(nav.firstByte)},{type:'open-to-steps-visible-ms',description:String(took)});
 // ADR 0030's target: the page's first content, from the database, leaves in under a second. The messages and their
 // steps are the Engine's own request now (#875), so they follow once it answers; the steps are still proved here.
 expect(nav.firstByte,'the chat\'s first byte').toBeLessThan(1000);
 expect(took,'the steps are drawn once the session answers').toBeLessThan(3000);
 await toggle.click();
 await expect(page.locator('.steps__list .step')).toHaveText(['web_search · accounting courses CairoDone','read_file · campaigns.csvSkipped']);
 expect(fake.settings.managementRequests.some(request=>request.path?.startsWith(`/api/sessions/${session}/messages?profile=${profile}`)),'read from the Agent\'s own profile').toBe(true);
});

// #875 (ADR 0030): the page's frame, Agent and composer never wait on the Engine; the messages are the Engine's own
// request now. With the session's read held three seconds, the first byte and the composer are drawn without it, the
// messages and their steps arrive once it answers, and a read that never answers keeps the last good read and says it
// could not refresh.
test('a session read held three seconds holds neither the first byte nor the composer, and the messages and steps arrive after',async({page})=>{
 const conversation=randomUUID(); const session=`session-${conversation.slice(0,8)}`;
 const sent=Date.parse('2026-11-16T11:12:00Z')/1000;
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${lead}','Lead','${session}')`);
 const call={id:'call_1',type:'function',function:{name:'web_search',arguments:JSON.stringify({query:'ad copy'})}};
 fake.settings.sessions.set(session,{profile,messages:[
  {role:'user',content:'Draft the ad copy',timestamp:sent+1},
  {role:'assistant',content:'',tool_calls:[call],timestamp:sent+3},
  {role:'tool',tool_call_id:'call_1',tool_name:'web_search',content:'{"results":[]}',timestamp:sent+10},
  {role:'assistant',content:'Here is the copy.',timestamp:sent+42}]});
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 fake.settings.sessionDelay=3000;
 try {
  const opened=Date.now();
  await page.goto(`/c/rs-learning/conversations/${conversation}`,{waitUntil:'commit'});
  await expect(page.getByLabel('Message',{exact:true})).toBeVisible();
  const composed=Date.now()-opened;
  const firstByte=await page.evaluate(()=>Math.round((performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).responseStart));
  console.log(`chat open with a slow session, composer ${composed} ms, first byte ${firstByte} ms`);
  expect(firstByte,'the first byte is not held by the Engine').toBeLessThan(2000);
  expect(composed,'the composer is not held by the Engine').toBeLessThan(2000);
  // The messages are the Engine's own read (#875): none is drawn until it answers, and then its steps are under the
  // reply without a second wait.
  expect(await page.locator('.msg').count(),'the messages are still on their way').toBe(0);
  await expect(page.getByText('Here is the copy.')).toBeVisible({timeout:10000});
  const took=Date.now()-opened;
  console.log(`chat messages visible: ${took} ms`);
  expect(took,'the messages arrive once the session answers').toBeLessThan(6000);
  await expect(page.locator('.steps__toggle')).toHaveText('Used 1 tool · 41 sec',{timeout:15000});
  await expect(page.locator('.transcript [role="alert"]')).toHaveCount(0);
  // A session read that never answers keeps the last good read, and says it could not refresh (ADR 0030).
  fake.settings.sessionDelay=Infinity;
  await page.reload({waitUntil:'commit'});
  await expect(page.getByText('Here is the copy.')).toBeVisible({timeout:15000});
  await expect(page.locator('[data-refresh]')).toBeVisible({timeout:12000});
 } finally { fake.settings.sessionDelay=0; }
});
