import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { toolConfig } from '../lib/agent-toolsets.mjs';

// #615: an Agent's page in Settings in five groups, Identity, How it works, Thinking, Voice, and Tools and skills, then
// Advanced, closed until opened, with the voice's speed, Pause and Delete. Good morning is one row of How it works with its
// switch and time. Every control is the one it was: the Owner changes one of each kind, saves once with the bar, and the
// Engine and the reopened page hold them; Pause stays Soon and Delete asks for the name; a Manager has the speed but not
// Pause or Delete; a Viewer on a phone opens Advanced with a tap and reads every group with no control. RS Learning: Lead, the main Agent, and Ads. The Engine is
// the fake.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const id=(n:number)=>`6c000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [lead,ads]=[1,2].map(id);
const own=(agent:string)=>`ag-${agent.replaceAll('-','')}`;
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000,timezoneId:'Africa/Cairo'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.configDefaults={stt:{language:'en'},tts:{provider:'edge',edge:{voice:'en-US-AriaNeural'}}};
 fake.settings.profiles.set(profile,{soul:'Lead the team.',provider:'auto',model:'',key:fake.settings.key,config:toolConfig({profile}),credentials:{},
  display_name:'Lead',description:'Runs the team.',description_auto:false,bot_title:'General'});
 fake.settings.profiles.set(own(ads),{soul:'Run the ads.',provider:'auto',model:'',key:fake.settings.key,config:toolConfig({profile:own(ads)}),credentials:{},
  display_name:'Ads',description:'Runs the Meta ads.',description_auto:false});
 query(`update public.people set language='en' where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000004')`);
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
   insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${ads}' from public.members where company_id='${company}' and removed_at is null and role<>'owner';
   set local session_replication_role=origin;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const overlay=(page:Page)=>page.getByRole('dialog',{name:'Settings'});
const agentPage=(agent:string)=>`/c/rs-learning/settings?section=agents&agent=${agent}`;
const groups=['Identity','How it works','Thinking','Voice','Tools and skills','Advanced'];
// The page's group headings, read as a person's screen reader lists them: the five groups, then Advanced.
const groupHeadings=(page:Page,name='Settings')=>page.getByRole('dialog',{name}).getByRole('heading',{level:4});
// A press before React hydrated the page's controls does nothing: wait until Good morning's switch has its handlers.
const hydrated=(page:Page,selector:string)=>page.waitForFunction(found=>{
 const control=document.querySelector(found);
 return !!control&&Object.getOwnPropertyNames(control).some(name=>name.startsWith('__reactFiber$')||name.startsWith('__reactProps$'));
},selector);

test('the Owner finds every control in its group, changes one of each, saves once, and the reopened page and the Engine hold them',async({page})=>{
 await signIn(page,'omar@example.com',agentPage(lead));
 const view=overlay(page);
 await expect(groupHeadings(page)).toHaveText(groups);
 // Good morning is named once on the page, one row with its switch and time, inside How it works.
 const how=view.locator('section.set-group[aria-labelledby="set-h-how"]');
 await expect(how.locator('#set-checkin .panel-row')).toHaveCount(1);
 await expect(view.getByText('Good morning',{exact:true})).toHaveCount(1);
 await expect(how.locator('#rl-h')).toBeVisible();
 // Advanced is closed: the speed, Pause and Delete are there but not shown until it is opened.
 await expect(view.locator('#set-advanced')).not.toHaveAttribute('open');
 await expect(view.locator('#danger-pause')).toBeHidden();
 await expect(view.locator('#set-speed-2')).toBeHidden();
 await hydrated(page,'#set-ck-on');
 await hydrated(page,'#set-speed-2');

 // One change in each group, and the speed in Advanced: one bar, one Save.
 await view.locator('#set-desc').fill('Runs the team and the weekly plan.');
 await view.locator('#set-instr').fill('Lead the team.\nKeep posts short.');
 await how.getByRole('switch',{name:'Good morning'}).click();
 await how.getByRole('combobox',{name:'Time'}).selectOption('8:30');
 await view.locator('#set-effort-high').click();
 await view.locator('#set-voice-lang').selectOption('ar');
 await view.getByText('Advanced',{exact:true}).click();
 await expect(view.locator('#set-advanced')).toHaveAttribute('open','');
 await view.getByRole('radio',{name:'1.25×'}).click();
 await expect(page.locator('#dp-savebar')).toBeVisible();
 await page.locator('#set-save').click();
 await expect(page.locator('#dp-savebar')).toBeHidden({timeout:30000});
 await expect(page.locator('.toast')).toContainText('Saved. Lead will use the new settings from the next message');

 // The Engine holds every one of them.
 const held=fake.settings.profiles.get(profile)!;
 expect(held.description).toBe('Runs the team and the weekly plan.');
 expect(held.soul).toContain('Lead the team.\nKeep posts short.');
 expect(held.config?.agent?.reasoning_effort).toBe('high');
 expect([held.config?.stt?.language,held.config?.tts?.speed]).toEqual(['ar',1.25]);
 const jobs=(fake.settings.cron.get(profile)??[]).filter(job=>job.name==='Good morning');
 expect(jobs.map(job=>[job.schedule.expr,job.state])).toEqual([['30 8 * * *','scheduled']]);
 expect(rows(`select count(*)::int as n from public.company_log where company_id='${company}' and action='agent_setting_changed' and agent_id='${lead}'`)[0].n).toBeGreaterThanOrEqual(5);

 // Reopened, the page reads them back, and Advanced is closed again.
 await page.reload();
 await hydrated(page,'#set-ck-on');
 await expect(view.locator('#set-desc')).toHaveValue('Runs the team and the weekly plan.');
 await expect(view.locator('#set-instr')).toHaveValue('Lead the team.\nKeep posts short.');
 await expect(how.getByRole('switch',{name:'Good morning'})).toHaveAttribute('aria-checked','true');
 await expect(how.getByRole('combobox',{name:'Time'})).toHaveValue('8:30');
 await expect(view.locator('#set-effort-high')).toHaveAttribute('aria-checked','true');
 await expect(view.locator('#set-voice-lang')).toHaveValue('ar');
 await expect(view.locator('#set-advanced')).not.toHaveAttribute('open');
 await view.getByText('Advanced',{exact:true}).click();
 await expect(view.getByRole('radio',{name:'1.25×'})).toHaveAttribute('aria-checked','true');
});

test('Advanced opens from the keyboard; Pause stays Soon, the main Agent cannot be deleted, and Delete asks for the name',async({page})=>{
 await signIn(page,'omar@example.com',agentPage(lead));
 const view=overlay(page);
 await hydrated(page,'#set-ck-on');
 await view.locator('#set-g-advanced').focus();
 await page.keyboard.press('Enter');
 await expect(view.locator('#set-advanced')).toHaveAttribute('open','');
 await expect(view.locator('#danger-pause')).toHaveAttribute('aria-disabled','true');
 await expect(view.locator('#danger-delete')).toHaveCount(0);
 await expect(view.getByText('It can’t be deleted while it’s the main agent. Make another agent main first.')).toBeVisible();

 // Ads: Delete opens its confirmation, which takes the exact name before it acts; cancelled, Ads stays.
 await page.goto(agentPage(ads));
 await hydrated(page,'#set-speed-2');
 await view.getByText('Advanced',{exact:true}).click();
 await view.locator('#danger-delete').click();
 const confirm=view.getByRole('group',{name:'Delete Ads'});
 await expect(confirm).toBeVisible();
 await confirm.locator('#del-confirm').fill('Ad');
 await expect(view.locator('#del-go')).toBeDisabled();
 await confirm.locator('#del-confirm').fill('Ads');
 await expect(view.locator('#del-go')).toBeEnabled();
 await confirm.getByRole('button',{name:'Cancel'}).click();
 await expect(confirm).toHaveCount(0);
 expect(rows(`select count(*)::int as n from public.hermes_agents where id='${ads}'`)[0].n).toBe(1);
});

test('a Manager changes the speed in Advanced but has no Pause or Delete',async({page})=>{
 await signIn(page,'manager@example.com',agentPage(ads));
 const view=overlay(page);
 await expect(groupHeadings(page)).toHaveText(groups);
 await hydrated(page,'#set-speed-2');
 await view.getByText('Advanced',{exact:true}).click();
 await expect(view.locator('#set-h-danger, #danger-pause, #danger-delete')).toHaveCount(0);
 await view.getByRole('radio',{name:'0.85×'}).click();
 await page.locator('#set-save').click();
 await expect(page.locator('#dp-savebar')).toBeHidden({timeout:30000});
 expect(fake.settings.profiles.get(own(ads))?.config?.tts?.speed).toBe(0.85);

});

test('a Viewer on a phone opens Advanced with a tap and reads every group with no control',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,timezoneId:'Africa/Cairo'});
 const page=await context.newPage();
 try {
  await signIn(page,'viewer@example.com',agentPage(ads));
  const view=overlay(page);
  await expect(groupHeadings(page)).toHaveText(groups);
  const advanced=view.locator('details').filter({has:page.getByRole('heading',{name:'Advanced'})});
  await expect(advanced).not.toHaveAttribute('open');
  await view.getByRole('heading',{name:'Advanced'}).tap();
  await expect(advanced).toHaveAttribute('open','');
  await expect(view.getByText('0.85×',{exact:true})).toBeVisible();
  await expect(view.getByRole('radio')).toHaveCount(0);
  await expect(view.getByRole('button',{name:'Pause'})).toHaveCount(0);
  await expect(view.getByRole('button',{name:'Delete'})).toHaveCount(0);
  await expect(view.getByRole('button',{name:'Save',exact:true})).toHaveCount(0);
  // Nothing on the page is wider than the phone.
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  // The server refuses the Viewer's save of the speed, whatever the page offered.
  const refused=await page.request.post('/api/agent-page',{data:{company,agent:ads,changes:{voice:{language:'en',speed:'1.5'}}}});
  expect(refused.status()).toBe(403);
 } finally { await context.close(); }
});

test('in Arabic the groups and Advanced are named in the catalogue\'s words, right to left',async({page})=>{
 query(`update public.people set language='ar' where id='20000000-0000-0000-0000-000000000001'`);
 try {
  await signIn(page,'omar@example.com',agentPage(lead));
  const view=page.getByRole('dialog',{name:'الإعدادات'});
  await expect(groupHeadings(page,'الإعدادات')).toHaveText(['الهوية','طريقة الشغل','التفكير','الصوت','الأدوات والمهارات','متقدم']);
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  await expect(view.getByText('صباح الخير',{exact:true})).toHaveCount(1);
 } finally {
  query(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
 }
});
