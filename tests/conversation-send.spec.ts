import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

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
test.afterEach(()=>{ fake.settings.liveHold=false; fake.settings.livePace=10; fake.settings.liveSteps=()=>[]; });

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
 const row=list(`select hermes_session_id,open_run,person_id from public.conversations where id='${conversation}'`)[0];
 const run=fake.settings.runs.at(-1)!;
 expect(row.hermes_session_id).toMatch(/^gtmworks-[0-9a-f-]{36}$/);
 expect(run.sessionId,'the Run is on the session the row names').toBe(row.hermes_session_id);
 expect(row.person_id).toBe(omar);
 expect(row.open_run,'the row holds the open Run').toBe(run.id);
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
 await expect.poll(()=>list(`select open_run from public.conversations where id='${conversation}'`)[0].open_run,{timeout:10000}).toBeNull();
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
