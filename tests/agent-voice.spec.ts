import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #162: the Voice section of an Agent's page shows its own Engine profile's speaking language, voice and speed. The Owner
// and a Manager change them and save with the page's bar; the Engine then holds the new values and the log has one row.
// A Contributor and a Viewer read the same rows with no control, and the server refuses their save and their Listen.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
let fake:Awaited<ReturnType<typeof fakeHermes>>;
test.describe.configure({mode:'serial'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 // The Engine's own defaults for the voice settings, merged over what the profile saves, as get_config answers.
 fake.settings.configDefaults={stt:{language:'en'},tts:{provider:'edge',edge:{voice:'en-US-AriaNeural'}}};
 // The main Agent keeps the Company's own profile: it is the Agent's own profile, so its settings are written there.
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{},
  display_name:'Lead',description:'Runs the team.',description_auto:false,bot_title:'Marketing lead'});
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','Marketing lead',true,'${profile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const agentPage=(email:string,page:Page)=>signIn(page,email,`/c/rs-learning/settings?agent=${lead}`);
// A click before React hydrated the button does nothing: wait until Listen's handlers are attached.
const hydrated=(page:Page)=>page.waitForFunction(()=>{
 const button=document.querySelector('#set-voice-play');
 return !!button&&Object.getOwnPropertyNames(button).some(name=>name.startsWith('__reactFiber$')||name.startsWith('__reactProps$'));
});
// The sample Listen speaks carries the reader's own first name as the database holds it (the seed's Omar is «عمر»).
const sample='Hi عمر, I finished the December campaign analysis and I have three new angles.';

test('the Owner changes the speaking language and the speed, saves, and the Engine and the log hold them; Listen plays the saved voice',async({page})=>{
 await agentPage('omar@example.com',page);
 await hydrated(page);
 const overlay=page.getByRole('dialog',{name:'Settings'});
 const language=overlay.locator('#set-voice-lang'), speed=overlay.locator('#set-speed-2'), bar=overlay.locator('#dp-savebar');
 // The profile's real values: English, the Engine's default voice, normal speed, and the line on who speaks the sample.
 await expect(language).toHaveValue('en');
 await expect(overlay.locator('#set-voice')).toHaveValue('en-US-AriaNeural');
 await expect(overlay.locator('#set-voice')).toBeDisabled();
 await expect(overlay.getByText('The agent engine offers no list of voices for this provider, so the saved voice stays.')).toBeVisible();
 await expect(overlay.getByText('“Listen” sends the sample text to Microsoft to be spoken.')).toBeVisible();
 await expect(speed).toHaveAttribute('aria-checked','true');
 await expect(bar).toBeHidden();
 // Listen asks the Engine for the sample with the reader's own first name and plays it; the button reads Stop.
 await overlay.getByRole('button',{name:'Listen',exact:true}).click();
 await expect(overlay.getByRole('button',{name:'Stop',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(overlay.locator('#set-voice-hint')).toContainText('Hi عمر, I finished the December campaign analysis');
 await overlay.getByRole('button',{name:'Stop',exact:true}).click();
 await expect(overlay.getByRole('button',{name:'Listen',exact:true})).toHaveAttribute('aria-pressed','false');
 // The Engine was given the server's own sentence, the reader's first name in English, not anything the browser chose.
 const spoken=()=>fake.settings.managementRequests.filter(request=>request.path?.startsWith('/api/audio/speak')).at(-1);
 expect(spoken()?.body).toEqual({text:sample});
 const direct=await page.request.post('/api/agent-speak',{data:{company,agent:lead,text:'Say something else entirely.'}});
 expect(direct.ok()).toBe(true);
 expect(spoken()?.body.text).toContain('Hi عمر, I finished');
 expect(spoken()?.body.text).not.toContain('Say something else entirely.');
 // A change of language and of speed (in Advanced since #615), saved with the bar; Listen is off while they are unsaved.
 await language.selectOption('ar');
 await overlay.getByText('Advanced',{exact:true}).click();
 await overlay.getByRole('radio',{name:'1.25×'}).click();
 await expect(bar).toBeVisible();
 await expect(overlay.getByRole('button',{name:'Listen',exact:true})).toBeDisabled();
 await expect(overlay.getByText('Save your changes first: “Listen” plays the saved voice.')).toBeVisible();
 await overlay.getByRole('button',{name:'Save',exact:true}).click();
 await expect(bar).toBeHidden();
 await expect(page.locator('.toast')).toContainText('Saved. Lead will use the new settings from the next message');
 // The Engine's profile holds both, and the log has one row naming the section.
 const held=fake.settings.profiles.get(profile)?.config;
 expect(held?.stt?.language).toBe('ar');
 expect(held?.tts?.speed).toBe(1.25);
 expect(JSON.parse(query(`select jsonb_build_object('field',details->>'field','agent',details->>'agent_name','actor',actor_id) as row
  from public.company_log where action='agent_setting_changed' and details->>'field'='voice' order by id desc limit 1`))[0].row)
  .toEqual({field:'voice',agent:'Lead',actor:'20000000-0000-0000-0000-000000000001'});
 // Reloaded, the page shows what the Engine now holds.
 await page.reload();
 await expect(language).toHaveValue('ar');
 await overlay.getByText('Advanced',{exact:true}).click();
 await expect(overlay.getByRole('radio',{name:'1.25×'})).toHaveAttribute('aria-checked','true');
 await expect(overlay.locator('#set-voice-lang-hint')).toHaveText('It understands you in this language when you dictate.');
});

test('a Contributor and a Viewer read the voice rows with no control, and the server refuses their save and their Listen',async({page})=>{
 for(const email of ['reviewer@example.com','viewer@example.com']){
  await page.context().clearCookies();
  await agentPage(email,page);
  const overlay=page.getByRole('dialog',{name:'Settings'});
  await expect(overlay.locator('#set-voice-lang-val')).toHaveText('Arabic');
  await expect(overlay.locator('#set-voice-val')).toHaveText('en-US-AriaNeural');
  // The speed is read in Advanced (#615), as text.
  await overlay.getByText('Advanced',{exact:true}).click();
  await expect(overlay.locator('#set-speed-val')).toHaveText('1.25×');
  await expect(overlay.locator('#set-voice-lang')).toHaveCount(0);
  await expect(overlay.locator('#set-voice')).toHaveCount(0);
  await expect(overlay.locator('#set-speed-l')).toHaveCount(0);
  await expect(overlay.locator('#dp-savebar')).toHaveCount(0);
  for(const [path,body] of [['/api/agent-page',{company,agent:lead,changes:{voice:{language:'en'}}}],['/api/agent-speak',{company,agent:lead}]] as const){
   const refused=await page.request.post(path,{data:body});
   expect(refused.status(),path).toBe(403);
   expect(await refused.json()).toEqual({error:path.endsWith('speak')?'voiceNotAllowed':'agentPageNotAllowed'});
  }
 }
 // Nothing they sent reached the Engine.
 expect(fake.settings.profiles.get(profile)?.config?.stt?.language).toBe('ar');
 expect(fake.settings.managementRequests.filter(request=>request.path?.startsWith('/api/audio/speak')).length).toBe(2);
});
