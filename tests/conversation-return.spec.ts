import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes, usageLimitFirstError } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #879: work does not depend on the person's browser. A person who closes the page while the Agent works finds the
// finished reply when they come back; one who comes back sooner sees the Agent still working, live; a reply that did not
// finish says so, with Try again, and one that ran out of usage says when it resets. The row's open Run is let go once
// its end is seen, or once the Engine no longer knows it. The fake Engine plays a Run on a chosen session as the pinned
// release does (tests/fake-hermes.mjs).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>JSON.parse(query(sql)) as Record<string,unknown>[]|{rows:Record<string,unknown>[]};
const list=(sql:string)=>{ const read=rows(sql); return Array.isArray(read)?read:read.rows; };
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
let fake:Awaited<ReturnType<typeof fakeHermes>>;
const openRuns=(conversation:string)=>list(`select open_runs from public.conversations where id='${conversation}'`)[0].open_runs;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id='${omar}'`);
 query(`do $$ begin
  update public.companies set engine_conversations=true where id='${company}';
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });
test.afterEach(()=>{ Object.assign(fake.settings,{liveHold:false,livePace:10,liveSteps:()=>[],ending:'completed',failure:undefined,loseStarts:0}); });

// A Conversation already on the Engine, with one exchange in its session.
const conversationOnEngine=()=>{
 const conversation=randomUUID(); const session=`gtmworks-${randomUUID()}`;
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${lead}','Lead','${session}')`);
 fake.settings.sessions.set(session,{profile,messages:[{role:'user',content:'Hello',timestamp:1},{role:'assistant',content:'Hi Omar.',timestamp:2}]});
 return {conversation,session};
};
const open=async(page:Page,conversation:string)=>{
 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
 await expect(page.locator('.msg[data-author=agent]').first()).toHaveText(/Hi Omar\./,{timeout:20000});
};
const send=async(page:Page,text:string)=>{ const box=page.getByLabel('Message',{exact:true}); await box.fill(text); await box.press('Enter'); };
const sent=async(page:Page,text:string)=>{
 const starts=fake.settings.counts().runStart??0;
 await send(page,text);
 await expect.poll(()=>fake.settings.counts().runStart??0).toBe(starts+1);
 return fake.settings.runs.at(-1)!;
};

test('closing the page mid-reply and coming back after the Run ended shows the whole reply and its Step, and lets the Run go',async({browser})=>{
 test.setTimeout(180000);
 const {conversation}=conversationOnEngine();
 fake.settings.liveHold=true; fake.settings.livePace=400;
 fake.settings.liveSteps=()=>[{tool:'web_search',preview:'accounting courses Cairo'}];
 const first=await browser.newContext(); const page=await first.newPage();
 await open(page,conversation);
 const run=await sent(page,'Plan the launch');
 fake.settings.release(run.id);
 await expect(page.locator('li[data-live] [data-writing]')).toHaveText(/^Reply to:/,{timeout:20000});
 // The page closes while the reply is being written; the Run goes on without it.
 await first.close();
 await expect.poll(()=>fake.settings.runs.find(each=>each.id===run.id)?.liveDone,{timeout:30000}).toBe(true);
 // Nobody saw the end: the row still holds the Run until the next open reads its end, or until the worker, which asks
 // the Engine how each held Run is once a minute, lets it go (#882). Either way the reply is the session's.
 const back=await browser.newContext(); const again=await back.newPage();
 await open(again,conversation);
 const reply=again.locator('.msg[data-author=agent]');
 await expect(reply.last()).toHaveText(/Reply to: Plan the launch/,{timeout:20000});
 await expect(reply).toHaveCount(2);
 await expect(reply.last().locator('.steps__toggle')).toContainText('Used 1 tool');
 await expect(again.locator('li[data-live]')).toHaveCount(0);
 await expect(again.locator('[data-outcome]')).toHaveCount(0);
 await expect.poll(()=>openRuns(conversation),{timeout:10000}).toEqual([]);
 await back.close();
});

test('coming back while the Run still works shows the Agent working, and the reply goes on live with no part drawn twice',async({browser})=>{
 test.setTimeout(180000);
 const {conversation}=conversationOnEngine();
 fake.settings.liveHold=true; fake.settings.livePace=700;
 fake.settings.liveSteps=()=>[{tool:'web_search',preview:'accounting courses Cairo'}];
 const first=await browser.newContext(); const page=await first.newPage();
 await open(page,conversation);
 const run=await sent(page,'Plan the launch');
 fake.settings.release(run.id);
 await expect(page.locator('[data-live] .activity__t')).toHaveText('web_search · accounting courses Cairo…',{timeout:20000});
 await first.close();
 const back=await browser.newContext(); const again=await back.newPage();
 await open(again,conversation);
 // The Agent is working, its face too, and the person's message is drawn once, from the session.
 await expect(again.locator('#btn-details .face')).toHaveAttribute('data-state',/^(thinking|working)$/,{timeout:20000});
 await expect(again.locator('.msg[data-author=person]').filter({hasText:'Plan the launch'})).toHaveCount(1);
 const live=again.locator('li[data-live]');
 await expect(live.locator('.steps__toggle')).toHaveText('Used 1 tool',{timeout:20000});
 const writing=live.locator('[data-writing]');
 await expect(writing).toHaveText(/^Reply to:/,{timeout:20000});
 // The words written so far are drawn once: the reply never starts again over itself.
 for(let look=0;look<6;look++) {
  const text=await writing.textContent().catch(()=>null)??'';
  expect(text.split('Reply to:').length-1,`once, not "${text}"`).toBeLessThanOrEqual(1);
  await again.waitForTimeout(300);
 }
 const reply=again.locator('.msg[data-author=agent]');
 await expect(reply.last()).toHaveText(/Reply to: Plan the launch/,{timeout:30000});
 await expect(reply).toHaveCount(2);
 await expect(live).toHaveCount(0);
 await expect(again.locator('.msg[data-author=person]').filter({hasText:'Plan the launch'})).toHaveCount(1);
 await expect.poll(()=>openRuns(conversation),{timeout:10000}).toEqual([]);
 await back.close();
});

test('a Run that failed says it did not finish under the person\'s message, a reload says no reply came, and Try again sends it again',async({page})=>{
 test.setTimeout(180000);
 const {conversation}=conversationOnEngine();
 await open(page,conversation);
 fake.settings.ending='failed'; fake.settings.failure='Something went wrong on the provider\'s side.';
 await sent(page,'Plan the launch');
 const line=page.locator('[data-outcome=unfinished]');
 await expect(line).toHaveText(/This reply didn’t finish\.\s*Try again/,{timeout:30000});
 // It is under the person's message: the last thing drawn is their words, then the line.
 await expect(page.locator('.msg').last()).toHaveAttribute('data-author','person');
 await expect(page.locator('#btn-details .face')).not.toHaveAttribute('data-state',/^(thinking|working)$/);
 await expect.poll(()=>openRuns(conversation),{timeout:10000}).toEqual([]);
 await page.reload();
 await expect(page.locator('[data-outcome=no-reply]')).toHaveText(/No reply\s*Try again/,{timeout:20000});
 fake.settings.ending='completed'; fake.settings.failure=undefined;
 const starts=fake.settings.counts().runStart??0;
 await page.locator('[data-outcome=no-reply]').getByRole('button',{name:'Try again'}).click();
 await expect.poll(()=>fake.settings.counts().runStart??0).toBe(starts+1);
 expect(fake.settings.runs.at(-1)?.input,'the same words again').toBe('Plan the launch');
 await expect(page.locator('.msg[data-author=agent]').last()).toHaveText(/Reply to: Plan the launch/,{timeout:30000});
 await expect(page.locator('[data-outcome]')).toHaveCount(0);
});

test('a Run that ran out of usage says so and when it resets',async({page})=>{
 test.setTimeout(180000);
 const {conversation}=conversationOnEngine();
 await open(page,conversation);
 fake.settings.ending='failed'; fake.settings.failure=usageLimitFirstError;
 await sent(page,'Plan the launch');
 const line=page.locator('[data-outcome] time');
 await expect(line).toHaveText(/^The usage resets on /,{timeout:30000});
 const at=Date.parse(await line.getAttribute('datetime')??'')-Date.now();
 expect(at,'about 121 hours from now, as the Engine said').toBeGreaterThan(120*3600e3);
 expect(at).toBeLessThan(121*3600e3);
 await expect(page.locator('[data-outcome=unfinished],[data-outcome=no-reply]')).toHaveCount(0);
 await expect.poll(()=>openRuns(conversation),{timeout:10000}).toEqual([]);
});

test('a Run the Engine no longer knows is let go, and the Conversation shows what the session holds',async({page})=>{
 test.setTimeout(180000);
 const {conversation,session}=conversationOnEngine();
 fake.settings.sessions.get(session)!.messages.push({role:'user',content:'And the budget?',timestamp:3});
 query(`update public.conversations set open_runs=array['run_lost_${randomUUID().slice(0,8)}'] where id='${conversation}'`);
 await open(page,conversation);
 await expect(page.locator('.msg[data-author=person]').last()).toHaveText(/And the budget\?/);
 await expect(page.locator('[data-outcome=no-reply]')).toHaveText(/No reply/,{timeout:20000});
 await expect(page.locator('li[data-live]')).toHaveCount(0);
 await expect.poll(()=>openRuns(conversation),{timeout:10000}).toEqual([]);
});

test('Try again whose answer was lost keeps its send key, so pressing it again replays that Run and starts no second',async({page})=>{
 test.setTimeout(180000);
 const {conversation,session}=conversationOnEngine();
 fake.settings.sessions.get(session)!.messages.push({role:'user',content:'And the budget?',timestamp:3});
 await open(page,conversation);
 const again=page.locator('[data-outcome=no-reply]').getByRole('button',{name:'Try again'});
 await expect(again).toBeVisible({timeout:20000});
 const runs=fake.settings.runs.length;
 // Every answer to the start is lost: the Run is made, but the send is refused as not known.
 fake.settings.loseStarts=1_000;
 await again.click();
 await expect.poll(()=>fake.settings.runs.length,{timeout:30000}).toBe(runs+1);
 await expect(again).toBeEnabled({timeout:30000});
 expect(fake.settings.runs.length,'the lost start made its Run').toBe(runs+1);
 fake.settings.loseStarts=0;
 await again.click();
 await expect(page.locator('.msg[data-author=agent]').last()).toHaveText(/Reply to: And the budget\?/,{timeout:30000});
 expect(fake.settings.runs.length,'the same key replayed that Run').toBe(runs+1);
});
