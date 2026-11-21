import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #205: an Agent's details list its own Routines in the Activity tab, read from its own Engine profile, with #31's row.
// RS Learning: Lead (the main Agent, on the Company's profile) and Ads and SEO (each on a profile of its own, as #120
// makes one). The fake Engine holds Routines for Lead and for Ads, none for SEO. The Owner switches one, runs one now and
// adds one by writing one sentence; a sentence with no time asks for one first and nothing is made until it is given
// (Omar, 2026-11-18). With no Routine, "Try writing" puts the example in the chat's field. A Contributor and a Viewer
// read the rows; the route refuses their changes. Under a reply in which Ads made a Routine, the Conversation shows it
// with the way to it in the details.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const reviewer='20000000-0000-0000-0000-000000000003';
const viewer='20000000-0000-0000-0000-000000000004';
const profile=`co-${company.replaceAll('-','')}`;
const [lead,ads,seo]=[randomUUID(),randomUUID(),randomUUID()];
const own=(agent:string)=>`ag-${agent.replaceAll('-','')}`;
let fake:Awaited<ReturnType<typeof laneHermes>>;
const tomorrowAt9=()=>`${new Date(Date.now()+864e5).toISOString().slice(0,10)}T09:00:00.000Z`;
const job=(jobId:string,name:string,expr:string,extra:object={})=>({id:jobId,name,prompt:name,skills:[],skill:null,schedule:{kind:'cron',expr,display:expr},schedule_display:expr,
 repeat:{times:null,completed:0},enabled:true,state:'scheduled',paused_at:null,paused_reason:null,created_at:'2026-11-20T08:00:00Z',
 next_run_at:tomorrowAt9(),last_run_at:null,last_status:null,last_error:null,deliver:'local',origin:null,timezone:'UTC',...extra});
const jobs=(agent:string)=>fake.settings.cron.get(agent===lead?profile:own(agent))!;
const logRows=(act:string)=>rows(`select actor_id,agent_id,details->>'routine' as routine,details->>'schedule' as schedule from public.company_log where company_id='${company}' and action='${act}' order by id`);

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 for(const name of [profile,own(ads),own(seo)]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.cron.set(profile,[job('aa00000000a1','Morning brief','0 8 * * *')]);
 fake.settings.cron.set(own(ads),[job('bb00000000b1','Ads summary','0 9 * * *'),job('bb00000000b2','Spend check','0 * * * *',{enabled:false,state:'paused',next_run_at:null})]);
 fake.settings.cron.set(own(seo),[]);
 query(`update public.people set language='en' where id in ('${omar}','${reviewer}','${viewer}')`);
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  query(`do $$ begin
   set local session_replication_role=replica;
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
    ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}'),
    ('${ads}','${company}','${randomUUID()}','Ads','Runs the Meta ads.',false,'${own(ads)}'),
    ('${seo}','${company}','${randomUUID()}','SEO','Writes the articles.',false,'${own(seo)}');
   insert into public.company_profiles(company_id,profile,tools_level,tools_policy) select id,'${profile}',agent_level,public.engine_tool_policy() from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
   insert into public.company_profile_keepers(company_id,agent_id) values ('${company}','${lead}') on conflict (company_id) do update set agent_id=excluded.agent_id;
   insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy) select a,'${company}',agent_level,public.engine_tool_policy() from public.companies, unnest(array['${ads}','${seo}']::uuid[]) a where id='${company}';
   insert into public.member_agent_access(company_id,person_id,agent_id) select '${company}',p,a from unnest(array['${reviewer}','${viewer}']::uuid[]) p, unnest(array['${ads}','${seo}']::uuid[]) a on conflict do nothing;
   set local session_replication_role=origin;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const details=(page:Page,name:string)=>page.getByRole('complementary',{name:`Details: ${name}`,exact:true});
const routines=(page:Page,name:string)=>details(page,name).locator('#dp-routines');
const row=(page:Page,name:string,title:string)=>routines(page,name).locator('.rt-row').filter({hasText:title});
const titles=(page:Page,name:string)=>routines(page,name).locator('.rt-row .panel-row__t');

test('the Owner sees this Agent\'s Routines alone with #31\'s row, and switches one and runs one now as in Settings',async({page})=>{
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${ads}`);
 const section=routines(page,'Ads');
 await expect(section.locator('.dp-label')).toHaveText(/^Routines\s*2\s*Add$/);
 await expect(titles(page,'Ads')).toHaveText(['Ads summary','Spend check']);
 await expect(row(page,'Ads','Ads summary').locator('.panel-row__d')).toHaveText('Every day · 9:00 AM');
 await expect(row(page,'Ads','Ads summary').locator('.rt-next')).toHaveText('Next run: Tomorrow 9:00 AM');
 await expect(row(page,'Ads','Spend check').locator('.rt-next')).toHaveText('Paused · won’t run until you turn it back on');
 await expect(row(page,'Ads','Spend check').getByRole('button',{name:'Run “Spend check” now'})).toHaveCount(0);

 // Switch one on: the Engine's job in Ads' profile follows, and the change is one log row.
 await row(page,'Ads','Spend check').getByRole('switch',{name:'Spend check'}).click();
 await expect(row(page,'Ads','Spend check').getByRole('switch',{name:'Spend check'})).toHaveAttribute('aria-checked','true');
 await expect(row(page,'Ads','Spend check').locator('.rt-next')).toHaveText(/^Next run: /);
 expect(jobs(ads)[1].state).toBe('scheduled');
 // Run now: it runs once and its last run shows.
 await row(page,'Ads','Ads summary').getByRole('button',{name:'Run “Ads summary” now'}).click();
 await expect(page.locator('.toast')).toContainText('“Ads summary” ran');
 await expect(row(page,'Ads','Ads summary').locator('.panel-row__d')).toHaveText(/^Every day · 9:00 AM · Last run (Today|Yesterday) /);
 expect(jobs(ads)[0].last_status).toBe('ok');
 expect(jobs(lead).map(each=>each.state),'Lead\'s Routine untouched').toEqual(['scheduled']);
 expect(logRows('routine_resumed')).toEqual([{actor_id:omar,agent_id:ads,routine:'Spend check',schedule:null}]);
 expect(logRows('routine_run')).toEqual([{actor_id:omar,agent_id:ads,routine:'Ads summary',schedule:null}]);
 // Lead's details list Lead's alone.
 await page.goto(`/c/rs-learning/chat/${lead}`);
 await expect(titles(page,'Lead')).toHaveText(['Morning brief']);
});

test('Add opens the field; an empty one is refused, Escape and Cancel close it, and a sentence makes a Routine that appears last and flashes',async({page})=>{
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${ads}`);
 const section=routines(page,'Ads');
 const add=section.getByRole('button',{name:'Add',exact:true}).first();
 await expect(titles(page,'Ads')).toHaveCount(2);
 await add.click();
 const field=section.getByLabel('New routine');
 await expect(field).toBeFocused();
 await expect(field).toHaveAttribute('placeholder','For example: leads summary every day at 8 in the morning');
 // Escape closes it and gives the focus back to Add; the panel stays.
 await field.press('Escape');
 await expect(field).toHaveCount(0);
 await expect(add).toBeFocused();
 await expect(details(page,'Ads')).toBeVisible();
 await add.click();
 await section.locator('.rt-add').getByRole('button',{name:'Cancel'}).click();
 await expect(field).toHaveCount(0);
 await expect(add).toBeFocused();
 // An empty field says why and makes nothing.
 await add.click();
 await section.locator('.rt-add').getByRole('button',{name:'Add',exact:true}).click();
 await expect(section.locator('#dp-rt-err')).toHaveText('Write the routine first, even a short sentence.');
 await expect(field).toHaveAttribute('aria-invalid','true');
 await expect(field).toBeFocused();
 expect(jobs(ads)).toHaveLength(2);
 // One sentence, Enter: made on Ads' profile with its schedule, the row last and flashing, the toast, a log row.
 const sentence='Send me the leads summary every day at 8 in the morning';
 await field.fill(sentence);
 await field.press('Enter');
 await expect(page.locator('.toast')).toContainText(`“${sentence}” is on`);
 await expect(titles(page,'Ads')).toHaveText(['Ads summary','Spend check','Leads summary']);
 await expect(row(page,'Ads','Leads summary')).toHaveClass(/is-flash/);
 await expect(row(page,'Ads','Leads summary').locator('.panel-row__d')).toHaveText('Every day · 8:00 AM');
 await expect(row(page,'Ads','Leads summary')).not.toHaveClass(/is-flash/,{timeout:4000});
 await expect(add).toBeFocused();
 await expect(section.locator('.dp-label')).toHaveText(/^Routines\s*3\s*Add$/);
 const made=jobs(ads).at(-1)!;
 expect([made.name,made.prompt,made.schedule.expr]).toEqual(['Leads summary','Send me the leads summary','0 8 * * *']);
 expect(jobs(seo),'another Agent\'s profile got nothing').toHaveLength(0);
 expect(logRows('routine_created')).toEqual([{actor_id:omar,agent_id:ads,routine:'Leads summary',schedule:'0 8 * * *'}]);
});

test('a sentence that does not say when asks for a time, and no Routine is made until one is given',async({page})=>{
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${ads}`);
 const section=routines(page,'Ads');
 await expect(titles(page,'Ads')).toHaveCount(3);
 const before=jobs(ads).length;
 const creates=()=>fake.settings.managementRequests.filter(request=>request.method==='POST'&&String(request.path).startsWith('/api/cron/jobs?')).length;
 const asked=creates();
 await section.getByRole('button',{name:'Add',exact:true}).first().click();
 await section.getByLabel('New routine').fill('Send me the competitors’ new ads');
 await section.getByLabel('New routine').press('Enter');
 await expect(section.locator('.rt-ask')).toHaveText('When should it run? Each run uses the Company’s subscription.');
 expect(creates(),'no cron job is made before a time is chosen').toBe(asked);
 expect(jobs(ads)).toHaveLength(before);
 // Cancel goes back to the sentence; asking again and choosing a time makes it.
 await section.locator('.rt-asked').getByRole('button',{name:'Cancel'}).click();
 await expect(section.getByLabel('New routine')).toBeFocused();
 await section.getByLabel('New routine').press('Enter');
 await section.locator('#dp-rt-n-kind').selectOption('weekly');
 await section.locator('#dp-rt-n-day').selectOption({label:'Monday'});
 await section.locator('#dp-rt-n-time').fill('10:30');
 await section.locator('.rt-asked').getByRole('button',{name:'Add',exact:true}).click();
 await expect(page.locator('.toast')).toContainText('“Send me the competitors’ new ads” is on');
 await expect(row(page,'Ads','Competitors’ new ads').locator('.panel-row__d')).toHaveText('Every Monday · 10:30 AM');
 expect(jobs(ads).at(-1)!.schedule.expr).toBe('30 10 * * 1');
});

for(const width of [1440,390]) test(`with no Routine the section says how to make one, and Try writing puts the example in the chat's field and sends nothing, at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${seo}`);
 if(width<1024) await page.locator('#btn-details').click();
 const section=routines(page,'SEO');
 await expect(section.locator('.panel-empty')).toHaveText('No routines yet. Write what you want repeated in the chat, and SEO sets it up on its own.');
 await expect(section.locator('.dp-label')).toHaveText(/^Routines\s*Add$/);
 const runs=fake.settings.runs.length;
 await section.getByRole('button',{name:/^Try writing/}).click();
 const example='Send me a summary of what you did every Thursday at 4 in the afternoon';
 const box=page.getByLabel('Message',{exact:true});
 await expect(box).toHaveValue(example);
 await expect(box).toBeFocused();
 expect(await box.evaluate((field:HTMLTextAreaElement)=>[field.selectionStart,field.selectionEnd])).toEqual([example.length,example.length]);
 if(width<1024) await expect(page.locator('#details')).not.toHaveClass(/is-open/);
 else await expect(details(page,'SEO')).toBeVisible();
 expect(fake.settings.runs.length,'nothing is sent').toBe(runs);
 await page.screenshot({path:test.info().outputPath(`try-writing-${width}.png`)});
});

test('a Contributor and a Viewer read the rows On or Off, with nothing to change, and the route refuses them',async({page})=>{
 for(const email of ['reviewer@example.com','viewer@example.com']) {
  await page.context().clearCookies();
  await signIn(page,email,`/c/rs-learning/chat/${ads}`);
  const section=routines(page,'Ads');
  await expect(titles(page,'Ads')).toHaveText(['Ads summary','Spend check','Leads summary','Competitors’ new ads']);
  await expect(section.locator('.rt-row > .panel-row__meta')).toHaveText(['On','On','On','On']);
  await expect(section.getByRole('switch')).toHaveCount(0);
  await expect(section.getByRole('button')).toHaveCount(0);
  const refused=await page.request.post('/api/agent-routines',{data:{company,agent:ads,action:'pause',routine:'bb00000000b1'}});
  expect(refused.status(),email).toBe(403);
  expect(jobs(ads)[0].state).toBe('scheduled');
  // With no Routine the empty line shows; "Try writing" is for a person who may write in the chat.
  await page.goto(`/c/rs-learning/chat/${seo}`);
  await expect(routines(page,'SEO').locator('.panel-empty')).toBeVisible();
  await expect(routines(page,'SEO').getByRole('button',{name:/^Try writing/})).toHaveCount(email==='viewer@example.com'?0:1);
 }
});

test('under a reply in which the Agent made a Routine the Conversation says so, and See it in details opens it on Activity with the focus on its switch',async({page})=>{
 const conversation=randomUUID(); const session=`session-${conversation.slice(0,8)}`; const run=`rt-${conversation.slice(0,8)}`;
 const sent=Date.parse('2026-11-21T10:12:00Z')/1000;
 query(`do $$ begin
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${ads}','Ads','${session}');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id,created_at) values ('${company}','${conversation}','person','${omar}','Omar','Send me the cost per lead every Sunday at 9','${randomUUID()}','${run}','2026-11-21T10:12:00Z');
  insert into public.conversation_messages(company_id,conversation_id,author,agent_id,author_name,body,run_id,created_at) values ('${company}','${conversation}','agent','${ads}','Ads','Done. I will send it every Sunday.','${run}','2026-11-21T10:12:20Z');
 end $$;`);
 const call={id:'call_1',type:'function',function:{name:'cronjob_manage',arguments:JSON.stringify({action:'create',name:'Cost per lead',schedule:'0 9 * * 0',prompt:'Send the cost per lead'})}};
 fake.settings.sessions.set(session,{profile:own(ads),messages:[
  {role:'user',content:'Send me the cost per lead every Sunday at 9',timestamp:sent+1},
  {role:'assistant',content:'',tool_calls:[call],timestamp:sent+3},
  {role:'tool',tool_call_id:'call_1',tool_name:'cronjob_manage',content:JSON.stringify({success:true,job_id:'cc00000000c1',name:'Cost per lead',schedule:'0 9 * * 0'}),timestamp:sent+5},
  {role:'assistant',content:'Done. I will send it every Sunday.',timestamp:sent+8}]});
 jobs(ads).push(job('cc00000000c1','Cost per lead','0 9 * * 0'));
 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
 const line=page.locator('.turns .note[data-kind="routine"]');
 await expect(line).toHaveText('Routine created: Cost per lead · Every Sunday · 9:00 AMSee it in details');
 // The panel is hidden first, so the link has to open it.
 await page.locator('#btn-details').click();
 await expect(page.locator('#details')).toBeHidden();
 await line.getByRole('button',{name:'See it in details'}).click();
 await expect(details(page,'Ads')).toBeVisible();
 await expect(page.getByRole('tab',{name:'Activity'})).toHaveAttribute('aria-selected','true');
 await expect(row(page,'Ads','Cost per lead').getByRole('switch',{name:'Cost per lead'})).toBeFocused();
 await expect(routines(page,'Ads')).toBeInViewport();
 await page.screenshot({path:test.info().outputPath('routine-created-line.png')});
});
