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
const hidden=randomUUID();
const hiddenProfile=`ag-${hidden.replaceAll('-','')}`;
const manager='20000000-0000-0000-0000-000000000002';
let fake:Awaited<ReturnType<typeof fakeHermes>>;
let stopped=false;
const stopFake=async()=>{ if(!stopped&&fake) { stopped=true; await fake.close(); } };

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id in ('${omar}','${manager}')`);
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  insert into public.agent_profiles(agent_id,company_id,tools_confirmed) values ('${hidden}','${company}',true);
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${hidden}','${company}','${randomUUID()}','Hidden','Ads',false,'${hiddenProfile}');
 end $$;`);
});
test.afterAll(async()=>{ await stopFake(); });

// A Conversation of `person`'s with the main Agent, on its own Engine session, with the messages the fake Engine holds.
function talkFor(person:string,messages:Record<string,unknown>[]) {
 const conversation=randomUUID(); const session=`session-${conversation.slice(0,8)}`;
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${person}','${lead}','Lead','${session}')`);
 fake.settings.sessions.set(session,{profile,messages});
 return {conversation,session};
}
// A Conversation of Omar's on its own Engine session, with the messages the fake Engine holds for it.
const talk=(messages:Record<string,unknown>[])=>talkFor(omar,messages);
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
  // Setting the top and dispatching the scroll makes the read start even when the element was already at the top.
  await page.locator('.transcript').evaluate(element=>{ element.scrollTop=0; element.dispatchEvent(new Event('scroll')); });
  await expect(rows).toHaveCount(count,{timeout:20000});
 }
 await expect(page.getByText('Message 0',{exact:true})).toBeVisible();
});

test('the frame, the Agent and the composer are in the first response; the messages arrive on a request of their own',async({page})=>{
 test.setTimeout(120000);
 const {conversation}=talk([user(1,'Plan the launch'),replied(2,'Here is the plan.')]);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 fake.settings.sessionDelay=4000;
 try {
  await open(page,conversation);
  // The Engine's read is held four seconds; the composer is drawn while it is still on its way.
  await expect(page.getByLabel('Message',{exact:true})).toBeVisible({timeout:3000});
  expect(await page.locator('.msg').count(),'the messages are not in the first content').toBe(0);
  await expect(page.locator('.msg')).toHaveCount(2,{timeout:12000});
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
  {role:'assistant',content:'Let me check.',tool_calls:[call('call_1','web_search',{query:'accounting courses Cairo'})],timestamp:101},
  {role:'tool',tool_call_id:'call_1',tool_name:'web_search',content:'{"results":[]}',timestamp:102},
  // The reply's own stamp is before its turn began: it is still the reply of the turn its session order puts it after.
  replied(90,'Here is the plan.\n\n```gtmworks-tool\n{"name":"save_rule","arguments":{"rule":"Audit the ads"}}\n```\n\nMEDIA:/work/co-rs-learning/plan.pdf'),
  user(200,'And the budget?'),replied(201,'15,000 a month.')]);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await open(page,conversation);
 const replies=page.locator('.msg[data-author=agent]');
 await expect(replies).toHaveCount(2);
 await expect(replies.first().locator('.bubble--agent')).toHaveText('Here is the plan.');
 await expect(page.getByText('Let me check.')).toHaveCount(0);
 await expect(page.getByText('gtmworks-tool')).toHaveCount(0);
 await expect(page.getByText(/MEDIA:|\/work\//)).toHaveCount(0);
 await expect(replies.first().locator('.steps__toggle')).toHaveText('Used 1 tool · 2 sec');
 await expect(replies.nth(1).locator('.steps__toggle')).toHaveCount(0);
 await replies.first().locator('.steps__toggle').click();
 await expect(replies.first().locator('.steps__list .step')).toHaveText(['web_search · accounting courses CairoDone']);
});

test('a newest page of only tool calls loads the messages before it, and a page with nothing to draw is passed over',async({page})=>{
 test.setTimeout(120000);
 const call=(id:string)=>({id,type:'function',function:{name:'web_search',arguments:JSON.stringify({query:id})}});
 const messages:Record<string,unknown>[]=[user(1,'The older message'),replied(2,'The older reply')];
 for(let n=0;n<60;n++) messages.push({role:'assistant',content:'',tool_calls:[call(`tool_${n}`)],timestamp:10+n});
 const {conversation}=talk(messages);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await open(page,conversation);
 // The newest 50 are tool calls alone, so the first page has nothing to draw and no scrollbar: the read goes on to the
 // page that holds the person's message and the reply, without the person scrolling.
 await expect(page.getByText('The older message')).toBeVisible({timeout:15000});
 await expect(page.getByText('The older reply')).toBeVisible();
});

test('a Card step of an Agent hidden from the reader names no Card',async({page})=>{
 test.setTimeout(120000);
 const call={id:'call_card',type:'function',function:{name:'kanban_create',arguments:JSON.stringify({title:'Secret card',assignee:hiddenProfile})}};
 const {conversation}=talkFor(manager,[
  user(1,'Plan the ads'),
  {role:'assistant',content:'',tool_calls:[call],timestamp:2},
  {role:'tool',tool_call_id:'call_card',tool_name:'kanban_create',content:JSON.stringify({ok:true,task_id:'t_12345678'}),timestamp:3},
  replied(4,'Here is the plan.')]);
 await signIn(page,'manager@example.com','/c/rs-learning/home');
 await open(page,conversation);
 await expect(page.locator('.msg[data-author=agent]')).toContainText('Here is the plan.');
 // The Card was given to an Agent the Manager does not see: the step is there, its Card's title is not.
 await expect(page.getByText('Secret card')).toHaveCount(0);
});

test('a tab that comes back keeps the pages the person scrolled back through',async({page})=>{
 test.setTimeout(120000);
 const messages:Record<string,unknown>[]=[];
 for(let n=0;n<100;n++) messages.push(user(n*2+1,`Message ${n*2}`),replied(n*2+2,`Reply ${n*2}`));
 const {conversation}=talk(messages);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await open(page,conversation);
 const rows=page.locator('.msg');
 await expect(rows).toHaveCount(50,{timeout:20000});
 await page.locator('.transcript').evaluate(element=>{ element.scrollTop=0; element.dispatchEvent(new Event('scroll')); });
 await expect(rows).toHaveCount(100,{timeout:20000});
 await expect(page.getByText('Message 100')).toBeVisible();
 // Past the debounce, a tab that comes back reads the newest page again. It merges into what is drawn: the page the
 // person scrolled back to stays, and so does its place.
 await page.waitForTimeout(1100);
 await page.evaluate(()=>{ window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
 await expect(rows).toHaveCount(100,{timeout:15000});
 await expect(page.getByText('Message 100')).toBeVisible();
});

test('a reply split across the page boundary is drawn once',async({page})=>{
 test.setTimeout(120000);
 const messages:Record<string,unknown>[]=[];
 for(let n=0;n<30;n++) messages.push(user(n*2+1,`Older ${n*2}`),replied(n*2+2,`Older ${n*2+1}`));
 const call={id:'call_1',type:'function',function:{name:'web_search',arguments:JSON.stringify({query:'ads'})}};
 messages.push(user(1000,'Plan the ads'));
 messages.push({role:'assistant',content:'Let me check.',tool_calls:[call],finish_reason:'tool_calls',timestamp:1001});
 messages.push({role:'tool',tool_call_id:'call_1',tool_name:'web_search',content:'{"results":[]}',timestamp:1002});
 messages.push({role:'assistant',content:'Here is the plan.',finish_reason:'stop',timestamp:1003});
 for(let n=0;n<24;n++) messages.push(user(2000+n*2,`Newer ${n*2}`),replied(2001+n*2,`Newer ${n*2+1}`));
 messages.push(user(2100,'Newer last'));
 const {conversation}=talk(messages);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await open(page,conversation);
 await expect(page.getByText('Here is the plan.')).toBeVisible();
 // The older page holds the interim words beside the call, but its reply is in the page already drawn: the interim is
 // no reply, and the one reply is not drawn twice.
 await page.locator('.transcript').evaluate(element=>{ element.scrollTop=0; element.dispatchEvent(new Event('scroll')); });
 await expect(page.getByText('Older 13',{exact:true})).toBeVisible({timeout:20000});
 await expect(page.getByText('Let me check.')).toHaveCount(0);
 await expect(page.getByText('Here is the plan.')).toBeVisible();
});

test('a tab that comes back after more than a page replaces the window, never leaving a gap',async({page})=>{
 test.setTimeout(120000);
 const messages:Record<string,unknown>[]=[];
 for(let n=0;n<100;n++) messages.push(user(n*2+1,`Message ${n*2}`),replied(n*2+2,`Reply ${n*2}`));
 const {conversation,session}=talk(messages);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await open(page,conversation);
 await expect(page.locator('.msg')).toHaveCount(50,{timeout:20000});
 await expect(page.getByText('Message 150',{exact:true})).toBeVisible();
 // Sixty raw messages arrive while the tab is away: the newest page no longer overlaps what was drawn, so that page is
 // replaced rather than joined to it with a gap (ADR 0030's last read still holds when the Engine does not answer).
 for(let n=0;n<30;n++) fake.settings.sessions.get(session)!.messages.push(user(5000+n*2,`New ${n*2}`),replied(5001+n*2,`New ${n*2+1}`));
 await page.waitForTimeout(1100);
 await page.evaluate(()=>{ window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
 await expect(page.getByText('New 10',{exact:true})).toBeVisible({timeout:15000});
 await expect(page.getByText('Message 150',{exact:true})).toHaveCount(0);
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
