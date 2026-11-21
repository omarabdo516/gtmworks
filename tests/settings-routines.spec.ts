import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { toolConfig } from '../lib/agent-toolsets.mjs';

// #31: Recurring tasks lists every Routine of every Agent the reader sees, read from each Agent's own Engine profile,
// with its schedule, next run and last result. The Owner pauses and resumes one, runs one now, changes when it runs,
// adds one and deletes one, each a request to that Agent's profile and one row of the Company log; a Contributor reads
// them and changes nothing; and a Routine the main Agent makes in chat with the Engine's own scheduling tool, which every
// Agent is offered (ADR 0018, spec #389), shows here. RS Learning: Lead, the main Agent, and Ads. The Engine is the fake.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const id=(n:number)=>`6a000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [lead,ads]=[1,2].map(id);
const own=(agent:string)=>`ag-${agent.replaceAll('-','')}`;
let fake:Awaited<ReturnType<typeof laneHermes>>;
// Tomorrow at 9:00 UTC, as the Engine works out "0 9 * * *" for a Routine that runs in UTC: one time basis for the fixture
// and the words it is read back in, whatever the season.
const tomorrowAt9=()=>`${new Date(Date.now()+864e5).toISOString().slice(0,10)}T09:00:00.000Z`;
const job=(jobId:string,name:string,expr:string,extra:object={})=>({id:jobId,name,prompt:name,skills:[],skill:null,schedule:{kind:'cron',expr,display:expr},schedule_display:expr,
 repeat:{times:null,completed:0},enabled:true,state:'scheduled',paused_at:null,paused_reason:null,created_at:'2026-11-20T08:00:00Z',
 next_run_at:tomorrowAt9(),last_run_at:null,last_status:null,last_error:null,deliver:'local',origin:null,timezone:'UTC',...extra});
const logRows=(act:string)=>rows(`select actor_id,agent_id,details from public.company_log where company_id='${company}' and action='${act}' order by id`);

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 for(const name of [profile,own(ads)]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:toolConfig({profile:name}),credentials:{}});
 fake.settings.cron.set(profile,[job('aa00000000a1','Morning brief','0 8 * * *',{last_run_at:new Date(Date.now()-3600e3).toISOString(),last_status:'ok'})]);
 fake.settings.cron.set(own(ads),[job('bb00000000b1','Ads summary','0 9 * * *')]);
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
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${company}');
   insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','20000000-0000-0000-0000-000000000003','${ads}') on conflict do nothing;
   set local session_replication_role=origin;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const section=(page:Page)=>page.getByRole('dialog',{name:'Settings'});
const row=(page:Page,name:string)=>section(page).locator('.rt-row').filter({hasText:name});

test('the Owner sees each Agent\'s Routines and pauses, resumes, runs now, reschedules, adds and deletes one, each logged',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=routines');
 const overlay=section(page);
 await expect(overlay.getByRole('heading',{name:'Recurring tasks',level:3})).toBeVisible();
 await expect(overlay.locator('.sov-sub')).toContainText('2 on out of 2 · across 2 agents.');
 await expect(overlay.locator('.dp-sec .dp-label')).toHaveText([/Lead\s*1/,/Ads\s*1/]);
 await expect(row(page,'Morning brief').locator('.panel-row__d')).toHaveText(/^Every day · 8:00 AM · Last run (Today|Yesterday) /);
 await expect(row(page,'Ads summary').locator('.panel-row__d')).toHaveText('Every day · 9:00 AM');
 await expect(row(page,'Ads summary').locator('.rt-next')).toHaveText(/^Next run: Tomorrow 9:00 AM$/);

 // Pause, then resume: the Engine's job follows, and each is one row of the log.
 const ad=row(page,'Ads summary');
 await ad.getByRole('switch',{name:'Ads summary'}).click();
 await expect(ad.getByRole('switch',{name:'Ads summary'})).toHaveAttribute('aria-checked','false');
 await expect(ad.locator('.rt-next')).toHaveText('Paused · won’t run until you turn it back on');
 expect(fake.settings.cron.get(own(ads))![0].state).toBe('paused');
 await expect(ad.getByRole('button',{name:'Run “Ads summary” now'})).toHaveCount(0);
 await ad.getByRole('switch',{name:'Ads summary'}).click();
 await expect(ad.getByRole('switch',{name:'Ads summary'})).toHaveAttribute('aria-checked','true');
 expect(fake.settings.cron.get(own(ads))![0].state).toBe('scheduled');

 // Run now: the Engine runs it once, and its last run shows.
 await ad.getByRole('button',{name:'Run “Ads summary” now'}).click();
 await expect(page.locator('.toast')).toContainText('“Ads summary” ran');
 await expect(ad.locator('.panel-row__d')).toHaveText(/^Every day · 9:00 AM · Last run (Today|Yesterday) /);
 expect(fake.settings.cron.get(own(ads))![0].last_status).toBe('ok');

 // Change time: every Thursday at 4:30 PM, in the person's own zone.
 await ad.getByRole('button',{name:'Change when “Ads summary” runs'}).click();
 await ad.getByLabel('When').selectOption('weekly');
 await ad.getByLabel('Day').selectOption({label:'Thursday'});
 await ad.getByLabel('Time').fill('16:30');
 await ad.getByRole('button',{name:'Save'}).click();
 await expect(ad.locator('.panel-row__d')).toHaveText(/^Every Thursday · 4:30 PM/);
 expect(fake.settings.cron.get(own(ads))![0].schedule.expr).toBe('30 16 * * 4');
 const changes=fake.settings.managementRequests.filter(request=>request.method!=='GET'&&String(request.path).startsWith('/api/cron/jobs/bb00000000b1'));
 expect(changes.map(request=>new URL(String(request.path),'http://m').searchParams.get('profile'))).toEqual(Array(changes.length).fill(own(ads)));

 // Add a task for Ads, with an empty sentence refused first.
 // Every Agent has a Routine, so each adds from its own section, and the head offers no second way.
 await expect(overlay.locator('#rt-add')).toHaveCount(0);
 await overlay.locator('.dp-sec').filter({has:page.locator('.dp-label',{hasText:'Ads'})}).getByRole('button',{name:'Add a task'}).click();
 await overlay.getByRole('button',{name:'Add',exact:true}).click();
 await expect(overlay.locator('#rt-err')).toHaveText('Write the task first, even a short sentence.');
 await overlay.getByLabel('Agent').selectOption({label:'Ads'});
 await overlay.getByLabel('What to do').fill('Send me the cost per lead');
 await overlay.locator('#rt-n-time').fill('08:15');
 await overlay.getByRole('button',{name:'Add',exact:true}).click();
 await expect(row(page,'Send me the cost per lead').locator('.panel-row__d')).toHaveText('Every day · 8:15 AM');
 await expect(overlay.locator('.sov-sub')).toContainText('3 on out of 3 · across 2 agents.');
 expect(fake.settings.cron.get(own(ads))!.map(each=>each.schedule.expr)).toEqual(['30 16 * * 4','15 8 * * *']);
 expect(fake.settings.cron.get(profile)!.length,'the main Agent\'s profile got nothing').toBe(1);

 // Delete it again.
 const added=row(page,'Send me the cost per lead');
 await added.getByRole('button',{name:'Change when “Send me the cost per lead” runs'}).click();
 await added.getByRole('button',{name:'Delete “Send me the cost per lead”'}).click();
 await expect(row(page,'Send me the cost per lead')).toHaveCount(0);
 expect(fake.settings.cron.get(own(ads))!.length).toBe(1);

 // Every change is one row of the Company log, naming the Owner, Ads and the Routine.
 const omar='20000000-0000-0000-0000-000000000001';
 for(const [act,routine,schedule] of [['routine_paused','Ads summary',undefined],['routine_resumed','Ads summary',undefined],['routine_run','Ads summary',undefined],['routine_changed','Ads summary','30 16 * * 4'],['routine_created','Send me the cost per lead','15 8 * * *'],['routine_deleted','Send me the cost per lead',undefined]] as const)
  expect(logRows(act),act).toEqual([{actor_id:omar,agent_id:ads,details:{agent_name:'Ads',routine,...(schedule?{schedule}:{}),change:expect.stringMatching(/^[0-9a-f-]{36}$/)}}]);
 // The log reads them in words, the Routine as the object.
 await page.goto('/c/rs-learning/log');
 await expect(page.getByText('paused a recurring task of Ads').first()).toBeVisible();
});

test('a Contributor reads the Routines of the Agents shown to them, On or Off, with nothing to change, and the route refuses them',async({page})=>{
 await signIn(page,'reviewer@example.com','/c/rs-learning/settings?section=routines');
 const overlay=section(page);
 await expect(row(page,'Ads summary')).toBeVisible();
 await expect(row(page,'Ads summary').locator('.panel-row__meta')).toHaveText('On');
 await expect(overlay.getByRole('switch')).toHaveCount(0);
 await expect(overlay.getByRole('button',{name:/Run|Change|Add a task/})).toHaveCount(0);
 const refused=await page.request.post('/api/agent-routines',{data:{company,agent:ads,action:'pause',routine:'bb00000000b1'}});
 expect(refused.status()).toBe(403);
 expect(fake.settings.cron.get(own(ads))![0].state).toBe('scheduled');
 // A Viewer is not shown the Company's sections at all: the address opens their first section instead.
 await page.context().clearCookies();
 await signIn(page,'viewer@example.com','/c/rs-learning/settings?section=routines');
 await expect(section(page).getByRole('heading',{name:'Recurring tasks',level:3})).toHaveCount(0);
});

test('a Routine asked for in the main Agent\'s chat is made in its own profile and shows in Recurring tasks',async({page})=>{
 test.setTimeout(90000);
 fake.settings.routineAsks=input=>/every day at 7/.test(input)?{name:'Lead summary',prompt:'Send me the new leads',schedule:'0 7 * * *'}:null;
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const text='Send me the new leads every day at 7';
 await page.locator('.sidebar').getByRole('link',{name:'New chat',exact:true}).click();
 await page.getByLabel('Message',{exact:true}).fill(text);
 await page.getByLabel('Message',{exact:true}).press('Enter');
 await expect(page.locator('.msg[data-author=agent]')).toContainText(`Reply to: ${text}`,{timeout:30000});
 // The Run was offered the Engine's scheduling tool, and the job is in Lead's own profile alone.
 expect(fake.settings.cron.get(profile)!.map(each=>each.name)).toEqual(['Morning brief','Lead summary']);
 expect(fake.settings.cron.get(own(ads))!.map(each=>each.name)).not.toContain('Lead summary');
 await page.goto('/c/rs-learning/settings?section=routines');
 await expect(row(page,'Lead summary').locator('.panel-row__d')).toHaveText('Every day · 7:00 AM');
 await expect(section(page).locator('.dp-sec .dp-label').first()).toHaveText(/Lead\s*2/);
});
