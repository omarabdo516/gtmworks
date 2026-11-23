import { test, expect, freshSeed, type Locator, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { readFile } from 'node:fs/promises';
import { serverLogOf } from './lane.mjs';

// #29, on the app: the Owner gives a provider key, chooses the Company's default model and one Agent's own, and turns
// sub-agents on for that Agent; each Engine write names the profile it belongs to and is logged. A Manager and a
// Contributor read every value with no control, and the server refuses them too.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const space=`cs-${hex}`; const co=`co-${hex}`; const lead='e9100000-0000-0000-0000-000000000001'; const writer='e9100000-0000-0000-0000-000000000002'; const writerProfile=`ag-${writer.replaceAll('-','')}`;
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
 // A provider with no key is connected from the Providers list's last row (#617).
 await expect(async()=>{ await page.locator('#pv-row-add').click(); await expect(page.locator('#pv-d-add')).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 const row=page.locator('#mdl-key-row-anthropic');
 await expect(row.locator('#mdl-key-anthropic-state')).toHaveText('No key yet');
 await openKeyField(row);
 await page.locator('#mdl-key-anthropic-value').fill(key);
 await row.getByRole('button',{name:'Save key'}).click();
 // The key is then a Provider of its own, whose details open in the row's place, with no field left.
 await expect(page.locator('#pv-d-key-anthropic #mdl-key-anthropic-state')).toHaveText('A key is set');
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
 await page.getByRole('radiogroup',{name:/default/i}).getByRole('radio',{name:/^anthropic\/claude-opus-4\.6/}).click();
 await expect.poll(()=>fake.settings.profiles.get(space)?.model).toBe('anthropic/claude-opus-4.6');
 // The Company's own profile is written after its shared space, so it is waited for as the space is.
 await expect.poll(()=>fake.settings.profiles.get(co)?.model).toBe('anthropic/claude-opus-4.6');
 await page.getByRole('combobox',{name:'Model for Writer'}).selectOption({label:'anthropic/claude-opus-4.6'});
 await expect.poll(()=>fake.settings.profiles.get(writerProfile)?.model).toBe('anthropic/claude-opus-4.6');
 // The page shows the Agent's own choice once the whole save has answered; the record and the log row follow it.
 await expect(page.locator(`#mdl-agent-${writer}-model`)).toContainText('Its own choice');
 expect(JSON.parse(query(`select coalesce(model_choice,'-') as choice from public.agent_profiles where agent_id='${writer}'`))[0].choice).toBe('openrouter/anthropic/claude-opus-4.6');
 const rows=JSON.parse(query(`select details->>'setting' as setting from public.company_log where source='hermes_agent_audit' and action='agent_setting_changed' order by id`)) as {setting:string}[];
 expect(rows.map(row=>row.setting)).toContain('model');
});

test('the Owner changes the main Agent\'s model from its own page; the Engine holds it on `co-` and a new default leaves it', async({page})=>{
 language(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
 // #425: Lead keeps the Company's `co-` profile, and that profile is its own (ADR 0016).
 await signIn(page,'omar@example.com',`/c/rs-learning/settings?agent=${lead}`);
 const models=page.getByRole('radiogroup',{name:/Lead/});
 await expect(models).toBeVisible();
 await expect(async()=>{
  await models.getByRole('radio',{name:/^openai\/gpt-5\.5/}).click();
  await expect.poll(()=>fake.settings.profiles.get(co)?.model,{timeout:3000}).toBe('openai/gpt-5.5');
 }).toPass({timeout:30000});
 await expect.poll(()=>JSON.parse(query(`select coalesce(model_choice,'-') as choice from public.company_profiles where company_id='${company}'`))[0].choice).toBe('openrouter/openai/gpt-5.5');
 // A new Company default reaches the shared space and leaves Lead on its own choice.
 await page.goto('/c/rs-learning/settings?section=models');
 await hydrated(page);
 await page.getByRole('radiogroup',{name:/default/i}).getByRole('radio',{name:/^anthropic\/claude-opus-4\.6/}).click();
 await expect(page.locator(`#mdl-agent-${lead}-model`)).toContainText('Its own choice');
 await expect.poll(()=>fake.settings.profiles.get(space)?.model).toBe('anthropic/claude-opus-4.6');
 expect(fake.settings.profiles.get(co)?.model).toBe('openai/gpt-5.5');
});

test('the Owner turns sub-agents on for one Agent; the profile waits for the toolset and a member reads the switch', async({page,browser})=>{
 language(`update public.people set language='en' where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000004')`);
 await openModels(page,'omar@example.com');
 await hydrated(page);
 // The main Agent has its own switch now (#425): the Writer's is the one this test turns on.
 const toggle=page.locator(`#mdl-sub-${writer}`);
 await expect(toggle).toHaveAttribute('aria-checked','false');
 await toggle.click();
 await expect(toggle).toHaveAttribute('aria-checked','true');
 const state=JSON.parse(query(`select jsonb_build_object('subagents',subagents,'pending',tools_pending) as state from public.agent_profiles where agent_id='${writer}'`))[0].state;
 expect(state).toEqual({subagents:true,pending:true});
 // The Engine's sub-agent settings wait under Advanced, closed until the Owner opens it (#614).
 const advanced=page.locator(`#mdl-sub-${writer}-advanced`);
 await expect(advanced).not.toHaveAttribute('open');
 await expect(page.getByLabel('Sub-agent effort')).toBeHidden();
 await advanced.getByText('Advanced',{exact:true}).click();
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
 await expect(async()=>{ await see.locator('#pv-row-key-anthropic').click(); await expect(see.locator('#mdl-key-row-anthropic')).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 await expect(see.locator('#mdl-key-anthropic-state')).toHaveText('A key is set');
 await expect(see.getByRole('button',{name:'Save key'})).toHaveCount(0);
 await expect(see.getByRole('combobox',{name:'Model for Writer'})).toHaveCount(0);
 await expect(see.locator('#mdl-agent-'+writer+'-model')).toContainText('Its own choice');
 await contributor.close();
});

// #424: each provider key row and both subscriptions show their logo, drawn from this install only, in the light and the
// dark theme, the dark one in Arabic so the mirrored rows are seen too; the screenshots are attached to the run.
test('every provider and subscription shows its logo from the install, in both themes', async({page},testInfo)=>{
 language(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
 const origin=new URL(testInfo.project.use.baseURL!).origin;
 const outside:string[]=[];
 page.on('request',request=>{ if(request.resourceType()==='image'&&new URL(request.url()).origin!==origin) outside.push(request.url()); });
 await openModels(page,'omar@example.com');
 for(const theme of ['light','dark'] as const) {
  await page.emulateMedia({colorScheme:theme});
  if(theme==='dark') { language(`update public.people set language='ar' where id='20000000-0000-0000-0000-000000000001'`); await page.reload(); }
  // What is not connected yet, under the Providers list's last row (#617): each subscription and provider by its mark.
  const add=page.locator('#pv-d-add');
  await expect(async()=>{ await page.locator('#pv-row-add').click(); await expect(add).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
  const rows=add.locator(':is(.md-key, .sub-row)');
  await expect(rows.first()).toBeVisible();
  for(const row of await rows.all()) {
   const name=await row.locator('.panel-row__t').textContent();
   await expect(row.getByRole('img',{name:name!,exact:true})).toBeVisible();
  }
  await expect.poll(()=>add.locator('img.tool-logo').evaluateAll(images=>images.length>0&&images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0))).toBe(true);
  // A held one shows its mark in its details' header.
  const held=page.locator('.pv-row[id^="pv-row-key-"], .pv-row[id^="pv-row-sub-"]');
  for(const row of await held.all()) {
   await row.click();
   const name=(await row.locator('.panel-row__t').textContent())!;
   await expect(page.getByRole('region',{name,exact:true}).locator('.pv-head').getByRole('img',{name,exact:true}).locator('.tool-logo')).toBeVisible();
  }
  await page.locator('#md-providers').scrollIntoViewIfNeeded();
  await testInfo.attach(`models-${theme}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
 }
 expect(outside).toEqual([]);
});

// #661: a model choice shows at once. With the Engine's write held back 3 s, the chosen row is marked and says "Saving"
// within 150 ms of the click, nothing goes grey, and once the Engine answers the row is confirmed with no read of the
// page: neither the chat behind the window nor any other settings section is read again.
const writerPage=(page:Page)=>signIn(page,'omar@example.com',`/c/rs-learning/settings?agent=${writer}`);
const modelRow=(page:Page,model:string)=>page.getByRole('radiogroup',{name:/Writer/}).getByRole('radio',{name:new RegExp(`^${model.replaceAll('.','\\.').replaceAll('/','\\/')}`)});
// Clicks the row in the page itself and times, frame by frame, how long until it is marked and says Saving.
const markedWithin=(page:Page,model:string)=>page.evaluate(model=>new Promise<number>(resolve=>{
 const row=document.getElementById(`set-model-openrouter-${model}`)!;
 const start=performance.now(); row.click();
 const check=()=>{ if(row.getAttribute('aria-checked')==='true'&&row.querySelector('.is-saving')) resolve(performance.now()-start); else requestAnimationFrame(check); };
 check();
}),model);
// Every page read the router makes (an RSC request), from the moment it is started.
const pageReads=(page:Page)=>{ const reads:string[]=[]; page.on('request',request=>{ if(request.headers()['rsc']==='1'||request.url().includes('_rsc=')) reads.push(request.url()); }); return reads; };

test('a model choice is marked and says Saving at once while the Engine writes it, then is confirmed with no page read', async({page})=>{
 language(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
 await writerPage(page);
 const before=fake.settings.profiles.get(writerProfile)?.model;
 const next=before==='openai/gpt-5.5'?'anthropic/claude-opus-4.6':'openai/gpt-5.5';
 await expect(modelRow(page,before!)).toHaveAttribute('aria-checked','true');
 // A click before React has hydrated the rows does nothing.
 await page.waitForFunction(()=>Object.getOwnPropertyNames(document.querySelector('#set-model [role=radio]')||{}).some(name=>name.startsWith('__reactProps$')));
 await page.waitForLoadState('networkidle');
 const reads=pageReads(page);
 fake.settings.modelWriteDelay=3000;
 try {
  expect(await markedWithin(page,next)).toBeLessThan(150);
  await expect(page.locator('#set-model-saving')).toHaveText('Saving…');
  await expect(page.locator('#set-model [role=radio]:disabled')).toHaveCount(0);
  await expect(modelRow(page,before!)).toHaveAttribute('aria-checked','false');
  // Confirmed once the Engine answers and the route has read the model back: the mark stays and Saving goes.
  await expect(page.locator('#set-model-saving')).toHaveCount(0,{timeout:10000});
  await expect(modelRow(page,next)).toHaveAttribute('aria-checked','true');
  expect(fake.settings.profiles.get(writerProfile)?.model).toBe(next);
  await page.waitForTimeout(1500);
  expect(reads,'no page is read again after the save').toEqual([]);
 } finally { fake.settings.modelWriteDelay=0; }
 // The save's steps are one line of the web log (docs/production-logs.md: agent_setting_saved), the Engine's 3 s in its
 // write step, and no value in it.
 const saved=async()=>(await readFile(serverLogOf(),'utf8').catch(()=>'')).split('\n').filter(entry=>entry.includes('"agent_setting_saved"')&&entry.includes(company)).map(entry=>JSON.parse(entry.slice(entry.indexOf('{'))) as {setting:string,status:number,ms:Record<string,number>}).find(entry=>entry.ms.engineWrite>=3000);
 await expect.poll(saved).toMatchObject({setting:'model',status:200});
 const steps=(await saved())!.ms;
 expect(Object.keys(steps)).toEqual(expect.arrayContaining(['signIn','allowed','queue','owner','reads','engineWrite','record','done']));
 expect(JSON.stringify(await saved())).not.toContain(next);
 // Opened again, the page reads what the Engine holds.
 await page.reload();
 await expect(modelRow(page,next)).toHaveAttribute('aria-checked','true');
});

test('a model save the Engine refuses puts the row back on the old model and says why', async({page})=>{
 language(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
 await writerPage(page);
 const before=fake.settings.profiles.get(writerProfile)?.model??'';
 const next=before==='openai/gpt-5.5'?'anthropic/claude-opus-4.6':'openai/gpt-5.5';
 await page.waitForFunction(()=>Object.getOwnPropertyNames(document.querySelector('#set-model [role=radio]')||{}).some(name=>name.startsWith('__reactProps$')));
 fake.settings.modelWriteDelay=1000; fake.settings.failStep='model';
 try {
  await modelRow(page,next).click();
  await expect(page.locator('#set-model-saving')).toHaveText('Saving…');
  await expect(page.locator('#set-model').getByRole('alert')).toHaveText('Couldn’t save that model. Try again.',{timeout:10000});
  await expect(modelRow(page,before)).toHaveAttribute('aria-checked','true');
  await expect(modelRow(page,next)).toHaveAttribute('aria-checked','false');
  await expect(page.locator('#set-model-saving')).toHaveCount(0);
 } finally { fake.settings.modelWriteDelay=0; fake.settings.failStep=''; }
 expect(fake.settings.profiles.get(writerProfile)?.model).toBe(before);
});
