import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #878: a person steers the Agent's work from a Conversation whose messages are the Engine's: stops it, answers its
// question, and allows or refuses an action it asks to take, each through the Run's own routes on the Engine, relayed by
// gtmworks's web server. "Always allow" is an Owner's and a Manager's alone, refused on the server for anyone else; a card
// the Engine stopped waiting on shows as not allowed; a card answered in one tab closes in the other. Nothing of it is
// written to the database. The fake Engine pauses a Run on a chosen session as the pinned release does
// (tests/fake-hermes.mjs).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>JSON.parse(query(sql)) as Record<string,unknown>[]|{rows:Record<string,unknown>[]};
const list=(sql:string)=>{ const read=rows(sql); return Array.isArray(read)?read:read.rows; };
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const contributor='20000000-0000-0000-0000-000000000003';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
let fake:Awaited<ReturnType<typeof fakeHermes>>;
const oldRecord=['conversation_messages','conversation_queued_turns','conversation_run_reservations','conversation_run_ends','reply_cards'];
const counted=()=>list(`select ${oldRecord.map(table=>`(select count(*) from public.${table}) as ${table}`).join(',')}`)[0];

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id in ('${omar}','${contributor}')`);
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Ads','Ads',false,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${contributor}','${lead}');
 end $$;`);
});
test.afterAll(async()=>{ await fake.close(); });
test.afterEach(()=>{ Object.assign(fake.settings,{questions:()=>[],approvals:()=>[],liveSteps:()=>[],livePace:10,liveHold:false,reply:(input:string)=>`Reply to: ${input}`}); });

// A Conversation of `person` already on the Engine, opened on its empty session.
const opened=async(page:Page,{person=omar,email='omar@example.com'}={})=>{
 const conversation=randomUUID(); const session=`gtmworks-${randomUUID()}`;
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${person}','${lead}','Ads','${session}')`);
 fake.settings.sessions.set(session,{profile,messages:[]});
 await signIn(page,email,`/c/rs-learning/conversations/${conversation}`);
 await expect(page.getByLabel('Message',{exact:true})).toBeVisible({timeout:20000});
 return conversation;
};
// The same on a session that already holds `turns` exchanges, so the transcript scrolls.
const openedLong=async(page:Page,turns:number)=>{
 const conversation=randomUUID(); const session=`gtmworks-${randomUUID()}`;
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${lead}','Ads','${session}')`);
 fake.settings.sessions.set(session,{profile,messages:Array.from({length:turns},(_,at)=>[{role:'user',content:`Question ${at}`,timestamp:at*2+1},{role:'assistant',content:`Answer ${at}\n\nwith a second paragraph to take some room.`,finish_reason:'stop',timestamp:at*2+2}]).flat()});
 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
 await expect(page.locator('.msg[data-author=agent]').last()).toHaveText(/Answer \d+/,{timeout:20000});
};
const send=async(page:Page,text:string)=>{ const box=page.getByLabel('Message',{exact:true}); await box.fill(text); await box.press('Enter'); };
const reply=(page:Page)=>page.locator('.msg[data-author=agent]').last();

test('Stop ends the open Run and the reply shows as stopped',async({page})=>{
 test.setTimeout(120000);
 const conversation=await opened(page);
 fake.settings.livePace=400;
 fake.settings.reply=()=>'One two three four five six seven eight nine ten';
 await send(page,'Write the long plan');
 const writing=page.locator('li[data-live] [data-writing]');
 await expect(writing).toHaveText(/^One two/,{timeout:20000});
 await page.getByRole('button',{name:'Stop Ads'}).click();
 const stoppedLine=page.locator('[data-outcome=stopped]');
 await expect(stoppedLine).toContainText('Stopped. Ads stopped mid-reply',{timeout:20000});
 // As any reply that did not finish (#879), it offers to send the message again.
 await expect(stoppedLine.getByRole('button',{name:'Try again'})).toBeVisible();
 expect(fake.settings.runs.at(-1)!.stopped).toBe(true);
 await expect.poll(()=>list(`select open_runs from public.conversations where id='${conversation}'`)[0].open_runs,{timeout:10000}).toEqual([]);
 // The next message is a new Run, and the stopped line goes.
 fake.settings.reply=input=>`Reply to: ${input}`;
 await send(page,'Short one');
 await expect(reply(page)).toHaveText(/Reply to: Short one/,{timeout:30000});
 await expect(page.locator('[data-outcome=stopped]')).toHaveCount(0);
});

test('the Agent\'s question appears as its card, a pick or typed words reach that Run, and the Agent goes on',async({page})=>{
 test.setTimeout(120000);
 const before=counted();
 await opened(page);
 fake.settings.questions=input=>input.includes('city')?[{question:'Which city?',choices:['Cairo','Giza']}]:input.includes('name')?[{question:'What is the course called?'}]:[];
 fake.settings.reply=(input,answers)=>`${input}: ${answers.join(', ')}`;
 await send(page,'Pick a city');
 const card=page.getByRole('group',{name:'Which city?'});
 await expect(card).toBeVisible({timeout:20000});
 await card.getByRole('button',{name:/Giza/}).click();
 await expect(card).toHaveAttribute('aria-label','Which city?: Answered');
 await expect(reply(page)).toHaveText(/Pick a city: Giza/,{timeout:30000});
 // A question with no choices is answered in the message; the words go to the Run, not to a new one.
 await send(page,'Now the name');
 await expect(page.getByRole('group',{name:'What is the course called?'})).toBeVisible({timeout:20000});
 const starts=fake.settings.counts().runStart??0;
 await send(page,'Accounting 101');
 await expect(reply(page)).toHaveText(/Now the name: Accounting 101/,{timeout:30000});
 expect(fake.settings.counts().runStart??0,'the answer started no Run').toBe(starts);
 expect(counted(),'nothing of it was written to the database').toEqual(before);
});

test('a request to act offers "Allow once" and "Don\'t allow", "Always allow" to an Owner; each reaches the Run',async({page})=>{
 test.setTimeout(120000);
 await opened(page);
 fake.settings.approvals=input=>input.includes('clean')?[{description:'recursive delete',command:'rm -rf build'}]:[];
 fake.settings.reply=(input,answers,choices)=>`${input}: ${choices.join(', ')}`;
 await send(page,'Please clean up');
 const card=page.getByRole('group',{name:'Approval request: recursive delete'});
 await expect(card).toBeVisible({timeout:20000});
 await expect(card.getByRole('button')).toHaveText(['Don’t allow','Always allow','Allow once']);
 await card.getByRole('button',{name:'Allow once'}).click();
 await expect(card.locator('.card__outcome')).toContainText('Allowed once');
 await expect(reply(page)).toHaveText(/Please clean up: once/,{timeout:30000});
 await send(page,'Again clean up');
 const again=page.getByRole('group',{name:'Approval request: recursive delete'});
 await expect(again).toBeVisible({timeout:20000});
 await again.getByRole('button',{name:'Don’t allow'}).click();
 await expect(again.locator('.card__outcome')).toContainText('Not allowed');
 await expect(reply(page)).toHaveText(/Again clean up: deny/,{timeout:30000});
});

test('"Always allow" is not offered to a Contributor and is refused on the server',async({page})=>{
 test.setTimeout(120000);
 const conversation=await opened(page,{person:contributor,email:'reviewer@example.com'});
 fake.settings.approvals=input=>input.includes('clean')?[{description:'recursive delete',command:'rm -rf build'}]:[];
 fake.settings.reply=(input,answers,choices)=>`${input}: ${choices.join(', ')}`;
 await send(page,'Please clean up');
 const card=page.getByRole('group',{name:'Approval request: recursive delete'});
 await expect(card).toBeVisible({timeout:20000});
 await expect(card.getByRole('button')).toHaveText(['Don’t allow','Allow once']);
 const run=fake.settings.runs.at(-1)!;
 const permits=fake.settings.permits.length;
 const pressed=await page.request.post('/api/conversations',{headers:{'Content-Type':'application/json',Origin:new URL(page.url()).origin},
  data:{company,conversation,intent:'permit',run:run.id,permission:run.approvals[0].request_id,choice:'always'}});
 expect(pressed.status()).toBe(403);
 expect(fake.settings.permits.length,'the Engine was never asked').toBe(permits);
 await card.getByRole('button',{name:'Allow once'}).click();
 await expect(reply(page)).toHaveText(/Please clean up: once/,{timeout:30000});
});

test('a request left unanswered until the Engine stops waiting shows as not allowed, and a question as closed',async({page})=>{
 test.setTimeout(120000);
 await opened(page);
 fake.settings.approvals=input=>input.includes('clean')?[{description:'recursive delete',command:'rm -rf build'}]:[];
 fake.settings.questions=input=>input.includes('city')?[{question:'Which city?',choices:['Cairo','Giza']}]:[];
 await send(page,'Please clean up');
 const card=page.getByRole('group',{name:'Approval request: recursive delete'});
 await expect(card).toBeVisible({timeout:20000});
 expect(fake.settings.expireApproval(fake.settings.runs.at(-1)!.id)).toBe(true);
 await expect(card.locator('.card__outcome')).toContainText('Not allowed',{timeout:20000});
 await expect(card.getByRole('button')).toHaveCount(0);
 await expect(reply(page)).toHaveText(/Reply to: Please clean up/,{timeout:30000});
 await send(page,'Pick a city');
 const asked=page.getByRole('group',{name:'Which city?'});
 await expect(asked).toBeVisible({timeout:20000});
 expect(fake.settings.expire(fake.settings.runs.at(-1)!.id)).toBe(true);
 await expect(asked).toContainText('This question can no longer be answered',{timeout:20000});
});

test('a card answered in one tab closes in the person\'s other tab',async({page,context})=>{
 test.setTimeout(120000);
 const conversation=await opened(page);
 const other=await context.newPage();
 await other.goto(`/c/rs-learning/conversations/${conversation}`);
 await expect(other.getByLabel('Message',{exact:true})).toBeVisible({timeout:20000});
 fake.settings.approvals=input=>input.includes('clean')?[{description:'recursive delete',command:'rm -rf build'}]:[];
 fake.settings.liveHold=true;
 await send(page,'Please clean up');
 await expect.poll(()=>fake.settings.runs.at(-1)?.input).toBe('Please clean up');
 // The other tab follows the same Run once it reads the row again.
 await other.reload();
 fake.settings.release(fake.settings.runs.at(-1)!.id);
 const here=page.getByRole('group',{name:'Approval request: recursive delete'});
 const there=other.getByRole('group',{name:'Approval request: recursive delete'});
 await expect(here).toBeVisible({timeout:20000});
 await expect(there).toBeVisible({timeout:20000});
 await here.getByRole('button',{name:'Allow once'}).click();
 await expect(there.locator('.card__outcome')).toContainText('Allowed once',{timeout:20000});
 await expect(there.getByRole('button')).toHaveCount(0);
 // A question too: picked in this tab, its card shows the pick in the other.
 fake.settings.approvals=()=>[];
 fake.settings.questions=input=>input.includes('city')?[{question:'Which city?',choices:['Cairo','Giza']}]:[];
 await expect(reply(page)).toHaveText(/Reply to: Please clean up/,{timeout:30000});
 await send(page,'Pick a city');
 await expect.poll(()=>fake.settings.runs.at(-1)?.input).toBe('Pick a city');
 await other.reload();
 fake.settings.release(fake.settings.runs.at(-1)!.id);
 const asked=other.getByRole('group',{name:'Which city?'});
 await expect(asked).toBeVisible({timeout:20000});
 await page.getByRole('group',{name:'Which city?'}).getByRole('button',{name:/Cairo/}).click();
 await expect(asked).toHaveAttribute('aria-label','Which city?: Answered',{timeout:20000});
 await expect(asked).toContainText('Cairo');
 await other.close();
});

test('a card that arrives while the reader is at the bottom of a long Conversation comes into view',async({page})=>{
 test.setTimeout(120000);
 await openedLong(page,20);
 fake.settings.questions=input=>input.includes('city')?[{question:'Which city?',choices:['Cairo','Giza']}]:[];
 await send(page,'Pick a city');
 const card=page.getByRole('group',{name:'Which city?'});
 await expect(card).toBeVisible({timeout:20000});
 await expect(card.getByRole('button',{name:/Giza/})).toBeInViewport();
 await card.getByRole('button',{name:/Giza/}).click();
 await expect(reply(page)).toHaveText(/Reply to: Pick a city/,{timeout:30000});
});
