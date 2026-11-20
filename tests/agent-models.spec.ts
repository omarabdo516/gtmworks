import { test, expect, freshSeed, type Locator, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #29, on the app: the Owner gives a provider key, chooses the Company's default model and one Agent's own, and turns
// sub-agents on for that Agent; each Engine write names the profile it belongs to and is logged. A Manager and a
// Contributor read every value with no control, and the server refuses them too.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const space=`cs-${hex}`; const co=`co-${hex}`; const writer='e9100000-0000-0000-0000-000000000002'; const writerProfile=`ag-${writer.replaceAll('-','')}`;
const key='sk-ant-playwright-never-drawn-0123456789abcdef';
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 const profile=(provider:string,model:string)=>({soul:'',provider,model,key:fake.settings.key,config:{},credentials:{},env:{OPENROUTER_API_KEY:key}});
 fake.settings.profiles.set(space,profile('openrouter','openai/gpt-5.5'));
 fake.settings.profiles.set(co,profile('openrouter','openai/gpt-5.5'));
 fake.settings.profiles.set(writerProfile,profile('openrouter','openai/gpt-5.5'));
 // The Engine's schema and defaults for the sub-agent settings, as the pinned release serves them (#125).
 fake.settings.configDefaults={delegation:{model:'',provider:'',max_concurrent_children:10,reasoning_effort:'',max_spawn_depth:1}};
 fake.settings.configSchema={fields:{
  'delegation.model':{type:'string'},'delegation.provider':{type:'string'},
  'delegation.max_concurrent_children':{type:'number'},'delegation.max_spawn_depth':{type:'number'},
  'delegation.reasoning_effort':{type:'select',options:['','minimal','low','medium','high','xhigh','max','ultra']},
 },category_order:[]};
 query(`do $$ begin
  insert into public.agent_profiles(agent_id,company_id,tools_confirmed) values ('${writer}','${company}',true);
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('e9100000-0000-0000-0000-000000000001','${company}','e9100000-0000-0000-0000-000000000011','Lead','General',true,'${co}'),
   ('${writer}','${company}','e9100000-0000-0000-0000-000000000012','Writer','Writing',false,'${writerProfile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) values ('${company}','${co}',true,true);
  insert into public.company_shared_spaces(company_id,folder) values ('${company}','/opt/data/profiles/${space}/skills');
  -- The Manager and the Contributor are shown the Writer, so they read its own model and switch (#15).
  insert into public.member_agent_access(company_id,person_id,agent_id) values
   ('${company}','20000000-0000-0000-0000-000000000002','${writer}'),
   ('${company}','20000000-0000-0000-0000-000000000003','${writer}');
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

const language=(sql:string)=>query(sql);
const openModels=(page:Page,email:string)=>signIn(page,email,'/c/rs-learning/settings?section=models');
// "Give a key" opens the field; a click before React has hydrated does nothing, so it is repeated until the field opens.
// A click before React hydrated the switch does nothing: wait until it has its handlers.
const hydrated=(page:Page)=>page.waitForFunction(()=>{
 const control=document.querySelector('[id^="mdl-sub-"]');
 return !!control&&Object.getOwnPropertyNames(control).some(name=>name.startsWith('__reactFiber$')||name.startsWith('__reactProps$'));
});
const openKeyField=(row:Locator)=>expect(async()=>{
 if(!await row.locator('#mdl-key-anthropic-value').count()) await row.getByRole('button',{name:'Give a key'}).click();
 await expect(row.locator('#mdl-key-anthropic-value')).toBeVisible({timeout:2000});
}).toPass({timeout:30000});

test('the Owner gives a provider key and the Engine holds it; the page never draws it', async({page})=>{
 language(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
 await openModels(page,'omar@example.com');
 const row=page.locator('#mdl-key-row-anthropic');
 await expect(row.locator('#mdl-key-anthropic-state')).toHaveText('No key yet');
 await openKeyField(row);
 await page.locator('#mdl-key-anthropic-value').fill(key);
 await row.getByRole('button',{name:'Save key'}).click();
 await expect(row.locator('#mdl-key-anthropic-state')).toHaveText('A key is set');
 await expect(page.locator('#mdl-key-anthropic-value')).toHaveCount(0);
 expect(fake.settings.profiles.get(space)?.env?.ANTHROPIC_API_KEY).toBe(key);
 expect(await page.content()).not.toContain(key);
 expect(await page.content()).not.toContain(key.slice(-6));
});

test('the Owner chooses the Company default and one Agent\'s own model, each read back and logged', async({page})=>{
 language(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
 await openModels(page,'omar@example.com');
 // The model rows are drawn by the same section that holds the switch: a click before React has hydrated them does
 // nothing, so the default model is chosen only once it has its handlers.
 await hydrated(page);
 // OpenRouter's entry (`anthropic/claude-opus-4.6`), not Anthropic's own `claude-opus-4-6` the same test's key adds.
 await page.getByRole('radio',{name:/^anthropic\/claude-opus-4\.6/}).click();
 await expect.poll(()=>fake.settings.profiles.get(space)?.model).toBe('anthropic/claude-opus-4.6');
 expect(fake.settings.profiles.get(co)?.model).toBe('anthropic/claude-opus-4.6');
 await page.getByRole('combobox',{name:'Model for Writer'}).selectOption({label:'anthropic/claude-opus-4.6'});
 await expect.poll(()=>fake.settings.profiles.get(writerProfile)?.model).toBe('anthropic/claude-opus-4.6');
 // The page shows the Agent's own choice once the whole save has answered; the record and the log row follow it.
 await expect(page.locator(`#mdl-agent-${writer}-model`)).toContainText('Its own choice');
 expect(JSON.parse(query(`select coalesce(model_choice,'-') as choice from public.agent_profiles where agent_id='${writer}'`))[0].choice).toBe('openrouter/anthropic/claude-opus-4.6');
 const rows=JSON.parse(query(`select details->>'setting' as setting from public.company_log where source='hermes_agent_audit' and action='agent_setting_changed' order by id`)) as {setting:string}[];
 expect(rows.map(row=>row.setting)).toContain('model');
});

test('the Owner turns sub-agents on for one Agent; the profile waits for the toolset and a member reads the switch', async({page,browser})=>{
 language(`update public.people set language='en' where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000004')`);
 await openModels(page,'omar@example.com');
 await hydrated(page);
 const toggle=page.getByRole('switch',{name:'Sub-agents'});
 await expect(toggle).toHaveAttribute('aria-checked','false');
 await toggle.click();
 await expect(toggle).toHaveAttribute('aria-checked','true');
 const state=JSON.parse(query(`select jsonb_build_object('subagents',subagents,'pending',tools_pending) as state from public.agent_profiles where agent_id='${writer}'`))[0].state;
 expect(state).toEqual({subagents:true,pending:true});
 await expect(page.getByLabel('Sub-agent effort')).toBeVisible();
 await expect(page.getByText('The agent engine’s default is 10 at once.')).toBeVisible();
 // A Manager reads the switches and gets no control, and the server refuses the change.
 const manager=await browser.newContext(); const reader=await manager.newPage();
 await openModels(reader,'manager@example.com');
 await expect(reader.getByRole('switch',{name:'Sub-agents'})).toHaveCount(0);
 await expect(reader.locator('#mdl-sub-'+writer+'-state')).toHaveText('On');
 const refused=await reader.request.post('/api/agent-settings',{data:{company,agent:writer,setting:'subagents',value:false}});
 expect(refused.status()).toBe(403);
 await manager.close();
 // A Contributor reads the key states, the models and the switch, with no control. A Viewer has no company section at all
 // (#26 and the reference's sovSecs keep "Subscription and models" from a Viewer), and settings-overlay.spec proves that.
 const contributor=await browser.newContext(); const see=await contributor.newPage();
 await openModels(see,'reviewer@example.com');
 // The section's parts arrive in streamed segments that hydrate into place: wait for the key row to be shown.
 await expect(see.locator('#mdl-key-row-anthropic')).toBeVisible();
 await expect(see.locator('#mdl-key-anthropic-state')).toHaveText('A key is set');
 await expect(see.getByRole('button',{name:'Save key'})).toHaveCount(0);
 await expect(see.getByRole('combobox',{name:'Model for Writer'})).toHaveCount(0);
 await expect(see.locator('#mdl-agent-'+writer+'-model')).toContainText('Its own choice');
 await contributor.close();
});
