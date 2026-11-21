import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { toolConfig } from '../lib/agent-toolsets.mjs';

// #183: the morning message. The Owner switches the main Agent's daily message on at a time in Settings, which makes one
// job on its own Engine profile (#182). Each run of the job is read
// back by the worker: a Member with anything in a part of the card gets a new Conversation with the main Agent titled
// "Good morning · {day}", holding the run's reply and the card; a Member with nothing gets none. The card is read from
// gtmworks's records when the Conversation is read, as its reader. RS Learning: Lead, the main Agent, and Ads; 1 Owner,
// 2 Manager, 3 Contributor (works with Ads), 4 Viewer (works with Ads), 5 Contributor. The Engine is the fake.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const id=(n:number)=>`6b000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [lead,ads]=[1,2].map(id);
const own=(agent:string)=>`ag-${agent.replaceAll('-','')}`;
const person=(n:number)=>`20000000-0000-0000-0000-00000000000${n}`;
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000,timezoneId:'Africa/Cairo'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 for(const name of [profile,own(ads)]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:toolConfig({profile:name}),credentials:{}});
 query(`update public.people set language='en' where id::text like '20000000%'`);
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  query(`do $$ begin
   set local session_replication_role=replica;
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
    ('${lead}','${company}','${id(4)}','Lead','General',true,'${profile}'),
    ('${ads}','${company}','${id(5)}','Ads','Runs the Meta ads.',false,'${own(ads)}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${company}','${profile}',true)
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.company_profile_keepers(company_id,agent_id) values ('${company}','${lead}') on conflict (company_id) do update set agent_id=excluded.agent_id;
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${company}');
   insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${person(3)}','${ads}'),('${company}','${person(4)}','${ads}') on conflict do nothing;
   set local session_replication_role=origin;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const settings=(page:Page)=>page.getByRole('dialog',{name:'Settings'});
// A press before React hydrated the switch does nothing: wait until it has its handlers (as tests/settings-morning.spec.ts).
const hydrated=(page:Page)=>page.waitForFunction(()=>{
 const control=document.querySelector('#set-ck-on');
 return !!control&&Object.getOwnPropertyNames(control).some(name=>name.startsWith('__reactFiber$')||name.startsWith('__reactProps$'));
});
const job=()=>fake.settings.cron.get(profile)?.[0];
// The fake Engine's management listener, asked from the runner (the browser's own requests are held offline).
const engine=(path:string,body?:object)=>fetch(`${fake.managementAddress}${path}`,{method:'POST',headers:{Authorization:`Bearer ${fake.settings.key}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const morningOf=(n:number)=>rows(`select id from public.conversations where person_id='${person(n)}' and good_morning is not null order by created_at desc limit 1`)[0]?.id as string|undefined;

test('the Owner switches Good morning on at a time on the main Agent\'s page (#182): its one job is on the main Agent\'s profile',async({page})=>{
 await signIn(page,'omar@example.com',`/c/rs-learning/settings?agent=${lead}`);
 const overlay=settings(page);
 await hydrated(page);
 await overlay.getByRole('switch',{name:'Send me a morning summary every day'}).click();
 await overlay.getByRole('combobox',{name:'Time'}).selectOption('8:30');
 await page.locator('#set-save').click();
 // Saved once the bar goes: the draft is what the Engine holds.
 await expect(page.locator('#dp-savebar')).toBeHidden({timeout:30000});
 expect([job()?.name,job()?.schedule.expr,job()?.timezone,job()?.state]).toEqual(['Good morning','30 8 * * *','Africa/Cairo','scheduled']);
 expect(fake.settings.cron.get(own(ads))??[],'nothing on another Agent\'s profile').toEqual([]);
});

test('a run of the job opens one Conversation for each Member with anything in their card, and none for a Member with nothing',async({page})=>{
 test.setTimeout(120000);
 // Ads ran a Routine overnight; something waits on the Contributor 5, who does not see Ads.
 query(`do $$ begin insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('c2000000-0000-0000-0000-000000000005','${company}','${person(5)}','${lead}','Lead');
  insert into public.waiting_items(company_id,person_id,kind,title,asked_by,conversation_id) values ('${company}','${person(5)}','question','Which offer goes first?','Lead','c2000000-0000-0000-0000-000000000005'); end $$;`);
 const before=rows(`select count(*)::int as n from public.conversations where good_morning is not null`)[0].n;
 expect(before).toBe(0);
 const routine=await (await engine(`/api/cron/jobs?profile=${own(ads)}`,{name:'Ad-pause routine',prompt:'Pause an ad past EGP 50 a lead',schedule:'0 * * * *',deliver:'local'})).json();
 fake.settings.cronReply=each=>each.name==='Ad-pause routine'?'Paused the Video 2 ad when cost per lead hit EGP 52':'Good morning, team.';
 const run=(jobId:string,where:string)=>engine(`/api/cron/jobs/${jobId}/trigger?profile=${where}`);
 await run(routine.id,own(ads));
 await page.waitForTimeout(50);
 await run(job()!.id,profile);
 await expect.poll(()=>rows(`select count(*)::int as n from public.good_mornings where company_id='${company}'`)[0].n,{timeout:60000}).toBe(1);
 const opened=rows(`select person_id from public.conversations where good_morning is not null order by person_id`).map(row=>row.person_id);
 expect(opened).toEqual([person(1),person(3),person(4),person(5)]);
 expect(opened,'the Manager, who sees no Ads and has nothing waiting, gets none').not.toContain(person(2));
 // A run is read once: the worker's next passes open nothing more.
 await page.waitForTimeout(12000);
 expect(rows(`select count(*)::int as n from public.conversations where good_morning is not null`)[0].n).toBe(4);
 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${morningOf(1)}`);
 await expect(page.locator('.msg[data-author=agent] .bubble')).toHaveText('Good morning, team.');
 await expect(page.locator('.ckcard .card__title')).toHaveText(/^Good morning · \w{3}, \w{3} \d{1,2}$/);
 await expect(page.locator('.sidebar')).toContainText(/Good morning · /);
});

test('Ran overnight lists only results of Agents the reader sees, and a row opens their chat with that Agent',async({page})=>{
 await signIn(page,'reviewer@example.com',`/c/rs-learning/conversations/${morningOf(3)}`);
 const night=page.locator('.ck-sec').filter({hasText:'Ran overnight'});
 await expect(night.getByRole('link')).toHaveText([/Paused the Video 2 ad when cost per lead hit EGP 52\s*Ads · .* · Ad-pause routine/]);
 await night.getByRole('link').click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/chat/${ads}`));
 await page.context().clearCookies();
 await signIn(page,'multi@example.com',`/c/rs-learning/conversations/${morningOf(5)}`);
 await expect(page.locator('.ckcard')).toBeVisible();
 await expect(page.locator('.ck-sec').filter({hasText:'Ran overnight'})).toHaveCount(0);
});

test('Waiting on you lists the reader\'s own items, each opens its place, and a settled item leaves the card',async({page})=>{
 await signIn(page,'multi@example.com',`/c/rs-learning/conversations/${morningOf(5)}`);
 const waiting=page.locator('.ck-sec').filter({hasText:'Waiting on you'});
 await expect(waiting.locator('.ck-label')).toHaveText(/Waiting on you\s*1/);
 await expect(waiting.getByRole('link',{name:/Which offer goes first\?/})).toHaveAttribute('href','/c/rs-learning/conversations/c2000000-0000-0000-0000-000000000005');
 query(`update public.waiting_items set resolved_at=now() where conversation_id='c2000000-0000-0000-0000-000000000005'`);
 await page.reload();
 await expect(page.locator('.ck-empty')).toHaveText('Nothing waiting on you right now. All agents are running on their own.');
 await expect(page.locator('.ckcard .card__sub')).toHaveText(/^Nothing waiting on you · /);
});

test('each Role reads its card: a Viewer waits on the team, only the Owner and a Manager change the time, which opens Time',async({page})=>{
 // The Manager has something waiting now, so they get the next morning too.
 query(`do $$ begin insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('c2000000-0000-0000-0000-000000000002','${company}','${person(2)}','${lead}','Lead');
  insert into public.waiting_items(company_id,person_id,kind,title,asked_by,conversation_id) values ('${company}','${person(2)}','question','Which audience next?','Lead','c2000000-0000-0000-0000-000000000002'); end $$;`);
 await engine(`/api/cron/jobs/${job()!.id}/trigger?profile=${profile}`);
 await expect.poll(()=>morningOf(2)??null,{timeout:60000}).not.toBeNull();
 for(const [email,n,label,changes] of [['viewer@example.com',4,'Waiting on the team',false],['reviewer@example.com',3,'Waiting on you',false],['manager@example.com',2,'Waiting on you',true],['omar@example.com',1,'Waiting on you',true]] as const) {
  await page.context().clearCookies();
  await signIn(page,email,`/c/rs-learning/conversations/${morningOf(n)}`);
  await expect(page.locator('.ckcard .ck-label').first(),email).toContainText(label);
  await expect(page.locator('.ck-foot'),email).toContainText('Arrives every day at 8:30 AM.');
  await expect(page.getByRole('link',{name:'Change the time'}),email).toHaveCount(changes?1:0);
 }
 await page.getByRole('link',{name:'Change the time'}).click();
 await expect(page).toHaveURL(new RegExp(`/settings\\?agent=${lead}&focus=time`));
 await expect(settings(page).getByRole('combobox',{name:'Time'})).toBeFocused();
});

test('switched off, no morning is recorded, and the card says it will not arrive tomorrow',async({page})=>{
 test.setTimeout(90000);
 await signIn(page,'omar@example.com',`/c/rs-learning/settings?agent=${lead}`);
 await hydrated(page);
 await settings(page).getByRole('switch',{name:'Send me a morning summary every day'}).click();
 await page.locator('#set-save').click();
 await expect(page.locator('#dp-savebar')).toBeHidden({timeout:30000});
 await expect.poll(()=>job()?.state).toBe('paused');
 const mornings=rows(`select count(*)::int as n from public.good_mornings where company_id='${company}'`)[0].n;
 // A run made while it is off (a run now) is never recorded.
 await engine(`/api/cron/jobs/${job()!.id}/trigger?profile=${profile}`);
 await engine(`/api/cron/jobs/${job()!.id}/pause?profile=${profile}`);
 await page.waitForTimeout(15000);
 expect(rows(`select count(*)::int as n from public.good_mornings where company_id='${company}'`)[0].n).toBe(mornings);
 await page.goto(`/c/rs-learning/conversations/${morningOf(1)}`);
 await expect(page.locator('.ck-foot')).toContainText('Good morning is off, so it won’t arrive tomorrow.');
});
