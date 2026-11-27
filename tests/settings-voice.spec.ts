import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #863 on the app: RS Learning transcribes with OpenAI (its voice key in every profile). The Owner opens Settings → Voice
// and sets the language to Automatic once, then Arabic, the model and the vocabulary: every profile of the Company (its
// shared space, Lead's and the Writer's own) holds each value, and a reload reads them back. A Manager reads the page with
// no control and the server refuses their save; a Contributor has no Voice page. The Writer's page has no language row.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const space=`cs-${hex}`; const co=`co-${hex}`;
const omar='20000000-0000-0000-0000-000000000001'; const manager='20000000-0000-0000-0000-000000000002';
const lead=randomUUID(); const writer=randomUUID();
const own=`ag-${writer.replaceAll('-','')}`;
const profiles=[space,co,own];
const key='sk-voice-playwright-test-only-0123456789';
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 for(const name of profiles) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{stt:{provider:'openai'}},credentials:{},env:{VOICE_TOOLS_OPENAI_KEY:key}});
 query(`update public.people set language='en' where id in ('${omar}','${manager}')`);
 query(`do $$ begin
  insert into public.agent_profiles(agent_id,company_id,tools_confirmed) values ('${writer}','${company}',true);
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${co}'),
   ('${writer}','${company}','${randomUUID()}','Writer','Writing',false,'${own}');
  insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) values ('${company}','${co}',true,true)
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false,skills_shared=true;
  -- The Company's shared space, where its keys and speech options are written (company_key_profiles names it).
  insert into public.company_shared_spaces(company_id,folder) values ('${company}','/opt/data/profiles/${space}/skills') on conflict do nothing;
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

const voicePage=(page:Page,email:string)=>signIn(page,email,'/c/rs-learning/settings?section=voice');
const stt=(name:string)=>fake.settings.profiles.get(name)?.config?.stt??{};
const everywhere=(read:(name:string)=>unknown)=>profiles.map(read);

test('the Owner sets the language to Automatic once and every profile of the Company holds it; Arabic, the model and the vocabulary too',async({page})=>{
 await voicePage(page,'omar@example.com');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay.getByRole('heading',{name:'Voice'})).toBeVisible();
 const language=overlay.getByRole('combobox',{name:'Language'});
 await expect(overlay.getByRole('combobox',{name:'Transcribe with'})).toHaveValue('openai');
 await expect(language).toHaveValue('en');
 await language.selectOption({label:'Automatic'});
 await expect(page.locator('.toast')).toContainText('Voice settings saved.');
 expect(everywhere(name=>stt(name).language)).toEqual(['','','']);
 await language.selectOption({label:'Arabic'});
 await expect.poll(()=>everywhere(name=>stt(name).language)).toEqual(['ar','ar','ar']);
 await overlay.getByRole('combobox',{name:'Model'}).selectOption('gpt-4o-transcribe');
 await expect.poll(()=>everywhere(name=>stt(name).openai?.model)).toEqual(['gpt-4o-transcribe','gpt-4o-transcribe','gpt-4o-transcribe']);
 await overlay.getByRole('textbox',{name:'Vocabulary'}).fill('RS Learning, gtmworks');
 await overlay.getByRole('button',{name:'Save',exact:true}).click();
 await expect.poll(()=>everywhere(name=>stt(name).prompt)).toEqual(Array(3).fill('RS Learning, gtmworks'));
 await overlay.getByRole('switch',{name:'Silence trim'}).click();
 await expect.poll(()=>everywhere(name=>stt(name).cloud_trim_silence)).toEqual([false,false,false]);
 // No key reached the database, and a reload reads every value back from the Engine.
 expect(query(`select count(*) from public.company_log where details::text like '%${key}%'`)).not.toContain(key);
 await page.reload();
 await expect(language).toHaveValue('ar');
 await expect(overlay.getByRole('combobox',{name:'Model'})).toHaveValue('gpt-4o-transcribe');
 await expect(overlay.getByRole('textbox',{name:'Vocabulary'})).toHaveValue('RS Learning, gtmworks');
 await expect(overlay.getByRole('switch',{name:'Silence trim'})).toHaveAttribute('aria-checked','false');
 // The Writer's own page keeps its voice and speed, and has no listening language of its own.
 await page.goto(`/c/rs-learning/settings?agent=${writer}`);
 await expect(page.getByRole('dialog',{name:'Settings'}).locator('#set-h-voice')).toBeVisible();
 await expect(page.locator('#set-voice-lang')).toHaveCount(0);
});

test('a Manager reads the Voice page with no control and the server refuses their save; a Contributor has no Voice page',async({page})=>{
 await voicePage(page,'manager@example.com');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay.getByText('Only an Administrator changes these.')).toBeVisible();
 await expect(overlay.locator('#vc-language-row')).toContainText('Arabic');
 await expect(overlay.getByRole('combobox')).toHaveCount(0);
 const refused=await page.request.post('/api/voice-settings',{data:{company,language:''}});
 expect(refused.status()).toBe(403);
 expect(everywhere(name=>stt(name).language)).toEqual(['ar','ar','ar']);
 await page.context().clearCookies();
 await voicePage(page,'reviewer@example.com');
 await expect(page.getByRole('dialog',{name:'Settings'}).getByRole('heading',{name:'Voice'})).toHaveCount(0);
 expect((await page.request.get(`/api/voice-settings?company=${company}`)).status()).toBe(403);
});
