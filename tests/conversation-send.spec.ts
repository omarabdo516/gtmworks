import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { startSessionRun } from '../lib/engine/runs.mjs';

// #876: a sent message becomes one Run on the Conversation's own Engine session, and its reply arrives live. The send is
// checked on the server, a new Conversation's row is written first on a session id gtmworks chose, the Member's own note
// goes as the Run's instructions, and gtmworks's web server relays the Run's event stream to the person's browser: the
// reply as it is written and each Step as it starts and ends. Nothing of the message, the reply or a Step is stored in
// gtmworks's database. The fake Engine plays a Run on a chosen session as the pinned release does (tests/fake-hermes.mjs).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>JSON.parse(query(sql)) as Record<string,unknown>[]|{rows:Record<string,unknown>[]};
const list=(sql:string)=>{ const read=rows(sql); return Array.isArray(read)?read:read.rows; };
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const manager='20000000-0000-0000-0000-000000000002';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
const hidden=randomUUID();
let fake:Awaited<ReturnType<typeof fakeHermes>>;
let stopped=false;
const stopFake=async()=>{ if(!stopped&&fake) { stopped=true; await fake.close(); } };
// Every table of the old Conversation record a message, a reply or a Step was ever written to.
const oldRecord=['conversation_messages','conversation_attachments','conversation_notes','conversation_queued_turns','conversation_run_reservations','conversation_run_ends','conversation_run_notes','conversation_run_ran_out','conversation_run_resets','reply_cards'];
const counted=()=>list(`select ${oldRecord.map(table=>`(select count(*) from public.${table}) as ${table}`).join(',')}`)[0];

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id in ('${omar}','${manager}')`);
 // RS Learning is switched over: its new Conversations start on the Engine (companies.engine_conversations, until #883).
 query(`do $$ begin
  update public.companies set engine_conversations=true where id='${company}';
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${hidden}','${company}','${randomUUID()}','Hidden','Ads',false,'${profile}');
  insert into public.member_notes(company_id,person_id,note) values ('${company}','${omar}','Omar likes short tables.'),('${company}','${manager}','The Manager writes in Arabic.')
   on conflict do nothing;
 end $$;`);
});
test.afterAll(async()=>{ await stopFake(); });
test.afterEach(()=>{
 fake.settings.liveHold=false; fake.settings.livePace=10; fake.settings.liveSteps=()=>[]; fake.settings.runsAtOnce=0; fake.settings.sessionQueueLimit=32;
 for(const run of fake.settings.runs) if(!run.released) fake.settings.release(run.id);
});

const send=async(page:Page,text:string)=>{ const box=page.getByLabel('Message',{exact:true}); await box.fill(text); await box.press('Enter'); };

test('a first message makes the Conversation\'s row on a session gtmworks chose, then its Run; the reply and its Step arrive live and stay on a reload',async({page})=>{
 test.setTimeout(180000);
 const before=counted();
 // The browser reaches gtmworks alone: no request goes to the Engine, and no answer holds its key.
 const engineHosts=[fake.address,fake.managementAddress].map(address=>new URL(address).host);
 const reached:string[]=[]; const keyed:string[]=[];
 page.on('request',request=>{ if(engineHosts.includes(new URL(request.url()).host)) reached.push(request.url()); });
 page.on('response',async response=>{ if(!response.url().includes('/api/conversation')) return; const body=await response.text().catch(()=>''); if(body.includes(fake.settings.key)) keyed.push(response.url()); });
 fake.settings.liveHold=true; fake.settings.livePace=1200;
 fake.settings.liveSteps=input=>input.includes('launch')?[{tool:'web_search',preview:'accounting courses Cairo'}]:[];
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${lead}`);
 await send(page,'Plan the launch');
 await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/,{timeout:30000});
 const conversation=page.url().split('/').at(-1)!;
 // The message is drawn at once, while the Run has not begun.
 await expect(page.locator('.msg[data-author=person]')).toHaveText(/Plan the launch/);
 const row=list(`select hermes_session_id,open_runs,person_id from public.conversations where id='${conversation}'`)[0];
 const run=fake.settings.runs.at(-1)!;
 expect(row.hermes_session_id).toMatch(/^gtmworks-[0-9a-f-]{36}$/);
 expect(run.sessionId,'the Run is on the session the row names').toBe(row.hermes_session_id);
 expect(row.person_id).toBe(omar);
 expect(row.open_runs,'the row holds the open Run').toEqual([run.id]);
 expect(run.instructions).toContain('Omar likes short tables.');
 expect(run.instructions,'another Member\'s note never goes').not.toContain('Arabic');
 fake.settings.release(run.id);
 // Each Step as it starts, then as it ends; then the reply as it is written, a word at a time.
 const now=page.locator('[data-live] .activity__t');
 await expect(now).toHaveText('web_search · accounting courses Cairo…',{timeout:20000});
 const live=page.locator('li[data-live]');
 await expect(live.locator('.steps__toggle')).toHaveText('Used 1 tool',{timeout:20000});
 const writing=live.locator('[data-writing]');
 await expect(writing).toHaveText('Reply to:',{timeout:20000});
 await expect(writing).toHaveText('Reply to: Plan',{timeout:20000});
 // Once the Run ends the reply is the session's, drawn once, with its Step.
 const reply=page.locator('.msg[data-author=agent]');
 await expect(reply).toHaveText(/Reply to: Plan the launch/,{timeout:30000});
 await expect(live).toHaveCount(0);
 await expect(reply).toHaveCount(1);
 await expect(reply.locator('.steps__toggle')).toContainText('Used 1 tool');
 await expect.poll(()=>list(`select open_runs from public.conversations where id='${conversation}'`)[0].open_runs,{timeout:10000}).toEqual([]);
 await page.reload();
 await expect(page.locator('.msg[data-author=person]')).toHaveText(/Plan the launch/,{timeout:20000});
 await expect(page.locator('.msg[data-author=agent]')).toHaveText(/Reply to: Plan the launch/);
 await expect(page.locator('.msg[data-author=agent] .steps__toggle')).toContainText('Used 1 tool');
 expect(reached,'no browser request reached the Engine').toEqual([]);
 expect(keyed,'no answer held the Engine\'s key').toEqual([]);
 expect(counted(),'nothing of the message, the reply or the Step was written to the database').toEqual(before);
});

test('in an open Conversation each message is drawn the moment it is sent, and each reply arrives live, one after the other',async({page})=>{
 test.setTimeout(180000);
 const conversation=randomUUID(); const session=`gtmworks-${randomUUID()}`;
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${lead}','Lead','${session}')`);
 fake.settings.sessions.set(session,{profile,messages:[{role:'user',content:'Hello',timestamp:1},{role:'assistant',content:'Hi Omar.',timestamp:2}]});
 const before=counted();
 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
 await expect(page.locator('.msg[data-author=agent]')).toHaveText(/Hi Omar\./,{timeout:20000});
 fake.settings.liveHold=true;
 const starts=fake.settings.counts().runStart??0;
 await send(page,'And the budget?');
 await expect(page.locator('.msg[data-author=person]').last()).toHaveText(/And the budget\?/,{timeout:3000});
 await expect.poll(()=>fake.settings.counts().runStart??0).toBe(starts+1);
 const first=fake.settings.runs.at(-1)!.id;
 // A second message while the first Run works is drawn at once too, and its own Run is followed once the first ends.
 await send(page,'And the dates?');
 await expect(page.locator('.msg[data-author=person]').last()).toHaveText(/And the dates\?/,{timeout:3000});
 await expect.poll(()=>fake.settings.counts().runStart??0).toBe(starts+2);
 const second=fake.settings.runs.at(-1)!.id;
 fake.settings.release(first);
 await expect(page.locator('.msg[data-author=agent]').nth(1)).toHaveText(/Reply to: And the budget\?/,{timeout:30000});
 // The second Run waits its turn in the Engine's queue; its message stays drawn while the session does not hold it yet.
 await expect(page.locator('.msg[data-author=person]')).toHaveCount(3);
 await expect(page.locator('.msg[data-author=person]').last()).toHaveText(/And the dates\?/);
 fake.settings.release(second);
 await expect(page.locator('.msg[data-author=agent]').last()).toHaveText(/Reply to: And the dates\?/,{timeout:30000});
 await expect(page.locator('.msg[data-author=person]')).toHaveCount(3);
 expect(counted()).toEqual(before);
});

test('three quick sends: each Run is followed live in the order it was started, the middle one included',async({page})=>{
 test.setTimeout(180000);
 const conversation=randomUUID(); const session=`gtmworks-${randomUUID()}`;
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${lead}','Lead','${session}')`);
 fake.settings.sessions.set(session,{profile,messages:[]});
 const before=counted();
 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
 await expect(page.getByLabel('Message',{exact:true})).toBeVisible({timeout:20000});
 fake.settings.liveHold=true; fake.settings.livePace=600;
 const starts=fake.settings.counts().runStart??0;
 for(const [at,words] of [[1,'One'],[2,'Two'],[3,'Three']] as const) {
  await send(page,words);
  await expect.poll(()=>fake.settings.counts().runStart??0).toBe(starts+at);
 }
 const runs=fake.settings.runs.slice(-3).map(run=>run.id);
 expect(list(`select open_runs from public.conversations where id='${conversation}'`)[0].open_runs,'held in the order they were started').toEqual(runs);
 const writing=page.locator('li[data-live] [data-writing]');
 fake.settings.release(runs[0]);
 await expect(page.locator('.msg[data-author=agent]').first()).toHaveText(/Reply to: One/,{timeout:30000});
 // The middle Run's reply is written live, before the last one starts.
 fake.settings.release(runs[1]);
 await expect(writing).toHaveText(/^Reply to:/,{timeout:20000});
 await expect(page.locator('.msg[data-author=agent]').nth(1)).toHaveText(/Reply to: Two/,{timeout:30000});
 fake.settings.release(runs[2]);
 await expect(page.locator('.msg[data-author=agent]').nth(2)).toHaveText(/Reply to: Three/,{timeout:30000});
 await expect(page.locator('.msg[data-author=person]')).toHaveCount(3);
 expect(counted()).toEqual(before);
});

// #877: a message sent while the Agent works waits its turn in the Engine's own queue, and one the Engine cannot take is
// never lost: it stays in the box with why it was not sent and Try again.
const openConversation=async(page:Page,messages:{role:string,content:string,timestamp:number}[]=[])=>{
 const conversation=randomUUID(); const session=`gtmworks-${randomUUID()}`;
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${lead}','Lead','${session}')`);
 fake.settings.sessions.set(session,{profile,messages});
 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
 await expect(page.getByLabel('Message',{exact:true})).toBeVisible({timeout:20000});
 return {conversation,session};
};
// Another Conversation's Run, held working, so the Engine's cap of Runs at once is reached.
const blocker=async()=>{
 const run=await startSessionRun({address:fake.address,profile,key:fake.settings.key,session:`gtmworks-${randomUUID()}`,input:'Elsewhere',idempotencyKey:randomUUID()});
 if(typeof run!=='string') throw new Error('no blocking Run');
 return run;
};
const runsOf=(input:string)=>fake.settings.runs.filter(run=>run.input===input).length;
const person=(page:Page)=>page.locator('.msg[data-author=person]');
const waiting='It’ll read this after the current reply';

test('two messages sent while the Agent works run in order, and each shows waiting until its turn',async({page})=>{
 test.setTimeout(180000);
 await openConversation(page);
 fake.settings.liveHold=true;
 const starts=fake.settings.counts().runStart??0;
 await send(page,'First');
 await expect.poll(()=>fake.settings.counts().runStart??0).toBe(starts+1);
 await send(page,'Second');
 await expect.poll(()=>fake.settings.counts().runStart??0).toBe(starts+2);
 await send(page,'Third');
 await expect.poll(()=>fake.settings.counts().runStart??0).toBe(starts+3);
 const [first,second,third]=fake.settings.runs.slice(-3).map(run=>run.id);
 await expect(person(page).filter({hasText:'First'})).not.toContainText(waiting);
 await expect(person(page).filter({hasText:'Second'})).toContainText(waiting,{timeout:10000});
 await expect(person(page).filter({hasText:'Third'})).toContainText(waiting);
 fake.settings.release(first);
 await expect(page.locator('.msg[data-author=agent]').first()).toHaveText(/Reply to: First/,{timeout:30000});
 await expect(person(page).filter({hasText:'Second'})).not.toContainText(waiting,{timeout:20000});
 await expect(person(page).filter({hasText:'Third'})).toContainText(waiting);
 fake.settings.release(second);
 await expect(page.locator('.msg[data-author=agent]').nth(1)).toHaveText(/Reply to: Second/,{timeout:30000});
 await expect(person(page).filter({hasText:'Third'})).not.toContainText(waiting,{timeout:20000});
 fake.settings.release(third);
 await expect(page.locator('.msg[data-author=agent]').nth(2)).toHaveText(/Reply to: Third/,{timeout:30000});
 await expect(person(page)).toHaveCount(3);
 await expect(page.getByText(waiting)).toHaveCount(0);
});

test('a send the Engine answers "retry" for is tried again, and goes through once the Engine takes it',async({page})=>{
 test.setTimeout(180000);
 await openConversation(page);
 fake.settings.liveHold=true; fake.settings.runsAtOnce=1;
 const other=await blocker();
 await send(page,'Are you there?');
 await expect(person(page).last()).toHaveText(/Are you there\?/,{timeout:3000});
 await page.waitForTimeout(2500);
 expect(runsOf('Are you there?'),'no Run while the Engine has no room').toBe(0);
 fake.settings.release(other); fake.settings.liveHold=false;
 await expect(page.locator('.msg[data-author=agent]')).toHaveText(/Reply to: Are you there\?/,{timeout:30000});
 expect(runsOf('Are you there?')).toBe(1);
 await expect(page.getByLabel('Message',{exact:true})).toHaveValue('');
 await expect(page.locator('.composer-error')).toHaveCount(0);
});

test('a send the Engine answers "retry" for past the short time stays in the box, not sent, and Try again sends it once',async({page})=>{
 test.setTimeout(180000);
 await openConversation(page);
 fake.settings.liveHold=true; fake.settings.runsAtOnce=1;
 const other=await blocker();
 await send(page,'Hold on');
 const line=page.locator('.composer-error');
 await expect(line).toHaveText(/Not sent: the agent engine is already working on as many replies as it takes/,{timeout:30000});
 await expect(page.getByLabel('Message',{exact:true})).toHaveValue('Hold on');
 await expect(person(page),'nothing is drawn as sent').toHaveCount(0);
 expect(runsOf('Hold on')).toBe(0);
 fake.settings.release(other); fake.settings.liveHold=false;
 await line.getByRole('button',{name:'Try again'}).click();
 await expect(page.locator('.msg[data-author=agent]')).toHaveText(/Reply to: Hold on/,{timeout:30000});
 await expect(person(page)).toHaveCount(1);
 expect(runsOf('Hold on'),'sent once').toBe(1);
 await expect(page.getByLabel('Message',{exact:true})).toHaveValue('');
});

test('the Engine\'s own queue limit, once reached, leaves the message not sent and says why',async({page})=>{
 test.setTimeout(180000);
 await openConversation(page);
 fake.settings.liveHold=true; fake.settings.sessionQueueLimit=1;
 const starts=fake.settings.counts().runStart??0;
 await send(page,'Queue one');
 await expect.poll(()=>fake.settings.counts().runStart??0).toBe(starts+1);
 await send(page,'Queue two');
 await expect.poll(()=>fake.settings.counts().runStart??0).toBe(starts+2);
 await send(page,'Queue three');
 const line=page.locator('.composer-error');
 await expect(line).toHaveText(/Not sent: too many messages are already waiting for this agent/,{timeout:20000});
 await expect(line.getByRole('button',{name:'Try again'})).toBeVisible();
 await expect(page.getByLabel('Message',{exact:true})).toHaveValue('Queue three');
 await expect(person(page)).toHaveCount(2);
 expect(runsOf('Queue three')).toBe(0);
});

test('a double press sends one message',async({page})=>{
 test.setTimeout(180000);
 await openConversation(page);
 await page.getByLabel('Message',{exact:true}).fill('Only once');
 await page.getByRole('button',{name:'Send',exact:true}).dblclick();
 await expect(page.locator('.msg[data-author=agent]')).toHaveText(/Reply to: Only once/,{timeout:30000});
 await page.waitForTimeout(1500);
 await expect(person(page)).toHaveCount(1);
 expect(runsOf('Only once')).toBe(1);
});

test('a Conversation whose last message is the person\'s, with no Run open, says no reply, and Try again runs it again, holding the words once',async({page})=>{
 test.setTimeout(180000);
 const {session}=await openConversation(page,[{role:'user',content:'Hello',timestamp:1},{role:'assistant',content:'Hi Omar.',timestamp:2},{role:'user',content:'Plan the week',timestamp:3}]);
 const line=page.locator('[data-outcome=no-reply]');
 await expect(line).toHaveText(/No reply/,{timeout:20000});
 await line.getByRole('button',{name:'Try again'}).click();
 await expect(page.locator('.msg[data-author=agent]').last()).toHaveText(/Reply to: Plan the week/,{timeout:30000});
 await expect(line).toHaveCount(0);
 expect(runsOf('Plan the week')).toBe(1);
 // The words are the Conversation's already (#980): one drawn message, the Engine's session holds them once, and the
 // box is empty.
 await expect(person(page).filter({hasText:'Plan the week'})).toHaveCount(1);
 expect(fake.settings.sessions.get(session)!.messages.filter(message=>message.role==='user'&&message.content==='Plan the week'),'the session holds the words once').toHaveLength(1);
 await expect(page.getByLabel('Message',{exact:true})).toHaveValue('');
});

test('a double press on Try again starts one Run',async({page})=>{
 test.setTimeout(180000);
 await openConversation(page,[{role:'user',content:'Hello',timestamp:1},{role:'assistant',content:'Hi Omar.',timestamp:2},{role:'user',content:'Ship the brief',timestamp:3}]);
 const line=page.locator('[data-outcome=no-reply]');
 await expect(line).toHaveText(/No reply/,{timeout:20000});
 // Two presses before the page can draw the first: both are sent, and the same send key makes the Engine replay one Run.
 await line.getByRole('button',{name:'Try again'}).evaluate(button=>{ const press=button as HTMLElement; press.click(); press.click(); });
 await expect(page.locator('.msg[data-author=agent]').last()).toHaveText(/Reply to: Ship the brief/,{timeout:30000});
 expect(runsOf('Ship the brief'),'one message, one Run, however fast the second press').toBe(1);
 await expect(person(page).filter({hasText:'Ship the brief'})).toHaveCount(1);
});

test('a Viewer, another Member\'s Conversation and an Agent the sender may not talk to are refused on the server, and no Run starts',async({browser})=>{
 test.setTimeout(180000);
 const conversation=randomUUID(); const session=`gtmworks-${randomUUID()}`;
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${lead}','Lead','${session}')`);
 const starts=fake.settings.counts().runStart??0;
 const post=(page:Page,body:object)=>page.request.post('/api/conversations',{headers:{'Content-Type':'application/json',Origin:new URL(page.url()).origin},data:{company,sendKey:randomUUID(),message:'Hello',...body}});
 const as=async(email:string)=>{ const context=await browser.newContext(); const page=await context.newPage(); await signIn(page,email,'/c/rs-learning/home'); return {page,context}; };
 const viewer=await as('viewer@example.com');
 expect((await post(viewer.page,{conversation:randomUUID(),agent:lead})).status()).toBe(403);
 await viewer.context.close();
 const member=await as('manager@example.com');
 expect((await post(member.page,{conversation})).status(),'another Member\'s Conversation').toBe(404);
 const fresh=randomUUID();
 expect((await post(member.page,{conversation:fresh,agent:hidden})).status(),'an Agent they may not talk to').toBe(404);
 expect(list(`select count(*)::int as n from public.conversations where id='${fresh}'`)[0].n).toBe(0);
 await member.context.close();
 expect(fake.settings.counts().runStart??0,'no Run started').toBe(starts);
});

// Last: it stops the fake Engine.
test('with the Engine stopped, the text stays in the box and nothing is drawn as sent',async({page})=>{
 test.setTimeout(180000);
 await openConversation(page,[{role:'user',content:'Hello',timestamp:1},{role:'assistant',content:'Hi Omar.',timestamp:2}]);
 await expect(page.locator('.msg[data-author=agent]')).toHaveText(/Hi Omar\./,{timeout:20000});
 await stopFake();
 await send(page,'Still there?');
 const line=page.locator('.composer-error');
 await expect(line).toHaveText(/could not be reached\. Your message was not sent/,{timeout:30000});
 await expect(line.getByRole('button',{name:'Try again'})).toBeVisible();
 await expect(page.getByLabel('Message',{exact:true})).toHaveValue('Still there?');
 await expect(person(page)).toHaveCount(1);
 await expect(person(page)).toHaveText(/Hello/);
});
