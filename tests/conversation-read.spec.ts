import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #875: a Conversation opens on its last messages, read from its Agent's Engine session. The page draws its frame, its
// Agent and its composer from the database; the messages are a request of their own, last 50 first and 50 more as the
// person scrolls back, with compacted words still the person's and the Engine's summary marked as the Engine's. A reply's
// steps are the tool calls its own turn holds beside it, never matched by time. The fake Engine serves the session's
// messages as the pinned release's management listener does (tests/fake-hermes.mjs).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
let fake:Awaited<ReturnType<typeof fakeHermes>>;
let stopped=false;
const stopFake=async()=>{ if(!stopped&&fake) { stopped=true; await fake.close(); } };

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id='${omar}'`);
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
 end $$;`);
});
test.afterAll(async()=>{ await stopFake(); });

// A Conversation of Omar's on its own Engine session, with the messages the fake Engine holds for it.
function talk(messages:Record<string,unknown>[]) {
 const conversation=randomUUID(); const session=`session-${conversation.slice(0,8)}`;
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${lead}','Lead','${session}')`);
 fake.settings.sessions.set(session,{profile,messages});
 return {conversation,session};
}
const open=(page:Page,conversation:string)=>page.goto(`/c/rs-learning/conversations/${conversation}`,{waitUntil:'commit'});
const user=(timestamp:number,content:string,more:object={})=>({role:'user',content,timestamp,...more});
const replied=(timestamp:number,content:string)=>({role:'assistant',content,timestamp});

test('a Conversation of 2 000 messages opens on its last 50, and scrolling back reads 50 more each time until the first',async({page})=>{
 test.setTimeout(300000);
 const messages:Record<string,unknown>[]=[];
 for(let n=0;n<1000;n++) messages.push(user(n*2+1,`Message ${n*2}`),replied(n*2+2,`Reply ${n*2}`));
 const {conversation}=talk(messages);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await open(page,conversation);
 const rows=page.locator('.msg');
 await expect(rows).toHaveCount(50,{timeout:20000});
 await expect(rows.last()).toContainText('Reply 1998');
 await expect(page.getByText('Message 1950')).toBeVisible();
 // The 50 before, then the 50 before that, and on until the first: each page starts where the last one ended.
 for(let count=100;count<=2000;count+=50) {
  await page.locator('.transcript').evaluate(element=>{ element.scrollTop=0; });
  await expect(rows).toHaveCount(count,{timeout:20000});
 }
 await expect(page.getByText('Message 0',{exact:true})).toBeVisible();
});

test('the frame, the Agent and the composer are in the first response; the messages arrive on a request of their own',async({page})=>{
 test.setTimeout(120000);
 const {conversation}=talk([user(1,'Plan the launch'),replied(2,'Here is the plan.')]);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 fake.settings.sessionDelay=3000;
 try {
  const opened=Date.now();
  await open(page,conversation);
  await expect(page.getByLabel('Message',{exact:true})).toBeVisible({timeout:2000});
  expect(Date.now()-opened,'the composer is drawn without the Engine').toBeLessThan(3000);
  expect(await page.locator('.msg').count(),'the messages are not in the first content').toBe(0);
  await expect(page.locator('.msg')).toHaveCount(2,{timeout:10000});
  await expect(page.locator('.msg[data-author=agent]')).toContainText('Here is the plan.');
 } finally { fake.settings.sessionDelay=0; }
});

test('a compacted session shows the person\'s older words as theirs and the Engine\'s summary marked as the Engine\'s',async({page})=>{
 test.setTimeout(120000);
 const summary='[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted for this session.';
 const {conversation}=talk([
  user(1,'Long message 0. words words words',{compacted:1}),replied(2,'Reply 0.'),
  user(3,'Long message 1. words words words',{compacted:1}),replied(4,'Reply 1.'),
  user(5,summary),replied(6,'Something from before the summary.'),
  user(7,'What next?'),replied(8,'Next.')]);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await open(page,conversation);
 const people=page.locator('.msg[data-author=person]');
 await expect(people).toHaveCount(3);
 await expect(people.first()).toContainText('Long message 0. words words words');
 await expect(people.nth(1)).toContainText('Long message 1. words words words');
 const engine=page.locator('[data-author=engine][data-kind=summary]');
 await expect(engine).toHaveCount(1);
 await expect(engine).toContainText('The Engine’s summary of earlier messages');
 await expect(engine).toContainText('Earlier turns were compacted for this session.');
 await expect(people.filter({hasText:'CONTEXT COMPACTION'})).toHaveCount(0);
});

test('each reply lists the tool calls its own turn holds, with no matching by time',async({page})=>{
 test.setTimeout(120000);
 const call=(id:string,name:string,args:object)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
 const {conversation}=talk([
  user(100,'Plan the ads'),
  {role:'assistant',content:'',tool_calls:[call('call_1','web_search',{query:'accounting courses Cairo'})],timestamp:101},
  {role:'tool',tool_call_id:'call_1',tool_name:'web_search',content:'{"results":[]}',timestamp:102},
  // The reply's own stamp is before its turn began: it is still the reply of the turn its session order puts it after.
  replied(90,'Here is the plan.'),
  user(200,'And the budget?'),replied(201,'15,000 a month.')]);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await open(page,conversation);
 const replies=page.locator('.msg[data-author=agent]');
 await expect(replies).toHaveCount(2);
 await expect(replies.first().locator('.steps__toggle')).toHaveText('Used 1 tool · 2 sec');
 await expect(replies.nth(1).locator('.steps__toggle')).toHaveCount(0);
 await replies.first().locator('.steps__toggle').click();
 await expect(replies.first().locator('.steps__list .step')).toHaveText(['web_search · accounting courses CairoDone']);
});

test('with the Engine stopped after one good read, the Conversation keeps what it last read and says it could not refresh',async({page})=>{
 test.setTimeout(120000);
 const {conversation}=talk([user(1,'Plan the launch'),replied(2,'Here is the plan.')]);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await open(page,conversation);
 await expect(page.locator('.msg[data-author=agent]')).toContainText('Here is the plan.');
 await stopFake();
 // The page opens again: the last good read is still drawn, and the read that asks the Engine again says it failed.
 await open(page,conversation);
 await expect(page.locator('.msg[data-author=agent]')).toContainText('Here is the plan.',{timeout:10000});
 await expect(page.locator('[data-refresh]')).toContainText('Couldn’t refresh. Showing what was last read.');
});
