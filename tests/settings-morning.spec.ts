import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { toolConfig } from '../lib/agent-toolsets.mjs';

// #182: Good morning on the main Agent's page. The Owner switches the daily message on and picks its time, saved with
// the page's bar: the Engine holds one job in the main Agent's own profile at that time and in the browser's zone, the
// page reads it back, and each change is one row of the Company log with the old and new value. A Contributor reads
// "Morning summary: Every day at …" and the server refuses their save. Making another Agent the main one moves the job to its profile. RS Learning: Lead, the
// main Agent, and Ads. The Engine is the fake.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const id=(n:number)=>`6b000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [lead,ads]=[1,2].map(id);
const own=(agent:string)=>`ag-${agent.replaceAll('-','')}`;
let fake:Awaited<ReturnType<typeof laneHermes>>;
const morningJobs=(name:string)=>(fake.settings.cron.get(name)??[]).filter(job=>job.name==='Good morning');
const cronWrites=()=>fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/cron/')&&request.method!=='GET');
const logRows=()=>rows(`select actor_id,agent_id,details from public.company_log where company_id='${company}' and action='agent_setting_changed' and details->>'field'='morning' order by id`);

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000,timezoneId:'Africa/Cairo'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 for(const name of [profile,own(ads)]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:toolConfig({profile:name}),credentials:{}});
 query(`update public.people set language='en' where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003')`);
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  query(`do $$ begin
   set local session_replication_role=replica;
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
    ('${lead}','${company}','${id(4)}','Lead','General',true,'${profile}'),
    ('${ads}','${company}','${id(5)}','Ads','Runs the Meta ads.',false,'${own(ads)}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.company_profile_keepers(company_id,agent_id) values ('${company}','${lead}') on conflict (company_id) do update set agent_id=excluded.agent_id;
   insert into public.agent_profiles(agent_id,company_id,tools_confirmed) values ('${ads}','${company}',true);
   set local session_replication_role=origin;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const overlay=(page:Page)=>page.getByRole('dialog',{name:'Settings'});
const agentPage=(agent:string)=>`/c/rs-learning/settings?section=agents&agent=${agent}`;
const morning=(page:Page)=>overlay(page).locator('#set-checkin');
// A press before React hydrated the switch does nothing: wait until it has its handlers, then for the zone line.
const hydrated=async(page:Page)=>{
 await page.waitForFunction(()=>{
  const control=document.querySelector('#set-ck-on');
  return !!control&&Object.getOwnPropertyNames(control).some(name=>name.startsWith('__reactFiber$')||name.startsWith('__reactProps$'));
 });
 await expect(morning(page).locator('#set-ck-zone')).toHaveText('Cairo time');
};

test('the Owner switches the daily message on and changes its time with the save bar; the Engine holds one job, and each change is logged',async({page})=>{
 await signIn(page,'omar@example.com',agentPage(lead));
 const section=morning(page);
 await expect(section.getByRole('heading',{name:'Good morning'})).toBeVisible();
 const toggle=section.getByRole('switch',{name:'Send me a morning summary every day'});
 const time=section.getByRole('combobox',{name:'Time'});
 await expect(toggle).toHaveAttribute('aria-checked','false');
 await expect(time).toBeDisabled();
 await hydrated(page);
 await expect(section.locator('#set-ck-hint')).toHaveText('If there’s nothing new, it won’t send anything.');
 expect(morningJobs(profile)).toHaveLength(0);

 await toggle.click();
 await expect(time).toBeEnabled();
 await time.selectOption('8:30');
 await expect(page.locator('#dp-savebar')).toBeVisible();
 await page.locator('#set-save').click();
 await expect(page.locator('#dp-savebar')).toBeHidden();
 await expect.poll(()=>morningJobs(profile).length).toBe(1);
 const [job]=morningJobs(profile);
 expect([job.schedule.expr,job.timezone,job.deliver,job.state]).toEqual(['30 8 * * *','Africa/Cairo','local','scheduled']);

 // The page reads what the Engine holds.
 await page.reload();
 await hydrated(page);
 await expect(toggle).toHaveAttribute('aria-checked','true');
 await expect(time).toHaveValue('8:30');

 // A new time changes that job; off pauses it; on resumes it. Never a second.
 await time.selectOption('10:00');
 await page.locator('#set-save').click();
 await expect(page.locator('#dp-savebar')).toBeHidden();
 await expect.poll(()=>morningJobs(profile)[0]?.schedule.expr).toBe('0 10 * * *');
 await toggle.click();
 await expect(time).toBeDisabled();
 await page.locator('#set-save').click();
 await expect(page.locator('#dp-savebar')).toBeHidden();
 await expect.poll(()=>morningJobs(profile)[0]?.state).toBe('paused');
 await toggle.click();
 await page.locator('#set-save').click();
 await expect(page.locator('#dp-savebar')).toBeHidden();
 await expect.poll(()=>morningJobs(profile)[0]?.state).toBe('scheduled');
 expect(morningJobs(profile)).toHaveLength(1);
 expect(cronWrites().filter(request=>request.method==='POST'&&String(request.path).startsWith('/api/cron/jobs?'))).toHaveLength(1);

 const logged=logRows();
 expect(logged.map(row=>{ const details=row.details as Record<string,string>; return [row.actor_id,row.agent_id,details.old,details.new]; })).toEqual([
  ['20000000-0000-0000-0000-000000000001',lead,'off','8:30'],['20000000-0000-0000-0000-000000000001',lead,'8:30','10:00'],
  ['20000000-0000-0000-0000-000000000001',lead,'10:00','off'],['20000000-0000-0000-0000-000000000001',lead,'off','10:00']]);
 // The log reads the change as the reference words it.
 await page.goto('/c/rs-learning/log');
 await expect(page.getByText('changed good morning in the settings of Lead').first()).toBeVisible();
});

test('a Contributor reads one row and the server refuses their save',async({page})=>{
 await signIn(page,'reviewer@example.com',agentPage(lead));
 const section=morning(page);
 await expect(section.locator('#set-ck-val')).toHaveText('Every day at 10:00 AM');
 await expect(section.getByRole('switch')).toHaveCount(0);
 await expect(section.getByRole('combobox')).toHaveCount(0);
 const before=cronWrites().length;
 const refused=await page.request.post('/api/agent-page',{data:{company,agent:lead,changes:{morning:{on:false,time:'10:00'}}}});
 expect(refused.status()).toBe(403);
 expect(cronWrites().length).toBe(before);
 expect(morningJobs(profile)[0]?.state).toBe('scheduled');
});


test('making another Agent the main one moves the daily message to its profile with the same time and state, and leaves none behind',async({page})=>{
 await signIn(page,'omar@example.com',agentPage(lead));
 const section=morning(page);
 await hydrated(page);
 // The message is on at 10:00 since the first case; a new time, saved, is what moves.
 await expect(section.getByRole('switch',{name:'Send me a morning summary every day'})).toHaveAttribute('aria-checked','true');
 await section.getByRole('combobox',{name:'Time'}).selectOption('7:30');
 await page.locator('#set-save').click();
 await expect(page.locator('#dp-savebar')).toBeHidden();
 await expect.poll(()=>morningJobs(profile).length).toBe(1);

 await page.goto(agentPage(ads));
 await expect(overlay(page).locator('#set-make-main')).toBeEnabled();
 await overlay(page).locator('#set-make-main').click();
 // The copy is made paused, switched on once the source is read again, and the source then goes: wait for all three.
 await expect.poll(()=>[morningJobs(own(ads)).map(job=>job.state),morningJobs(profile).length]).toEqual([['scheduled'],0]);
 const [moved]=morningJobs(own(ads));
 expect([moved.schedule.expr,moved.timezone,moved.state]).toEqual(['30 7 * * *','Africa/Cairo','scheduled']);
 // The new main Agent's page reads it.
 await page.goto(agentPage(ads));
 await expect(morning(page).getByRole('switch',{name:'Send me a morning summary every day'})).toHaveAttribute('aria-checked','true');
 await expect(morning(page).getByRole('combobox',{name:'Time'})).toHaveValue('7:30');
 // And the old one has none.
 await page.goto(agentPage(lead));
 await expect(overlay(page).locator('#set-make-main')).toBeVisible();
 await expect(morning(page)).toHaveCount(0);
});

test('removing the main Agent with a replacement moves the daily message to the replacement',async({page})=>{
 // Ads is the main Agent now, with the message on at 7:30 (the case above).
 await signIn(page,'omar@example.com',agentPage(ads));
 expect(morningJobs(own(ads))).toHaveLength(1);
 const removed=await page.request.post('/api/hermes-agents',{data:{company,intent:'remove',agent:ads,replacement:lead}});
 expect(removed.status()).toBe(200);
 await expect.poll(()=>[morningJobs(profile).map(job=>job.state),morningJobs(own(ads)).length]).toEqual([['scheduled'],0]);
 expect([morningJobs(profile)[0].schedule.expr,morningJobs(profile)[0].state]).toEqual(['30 7 * * *','scheduled']);
 await page.goto(agentPage(lead));
 await hydrated(page);
 await expect(morning(page).getByRole('combobox',{name:'Time'})).toHaveValue('7:30');
});
