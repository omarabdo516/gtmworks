import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { i18n } from '../lib/i18n.mjs';

// Settings → Models part by part (#791, ADR 0030): each part the Engine backs is its own read after the section is drawn.
// RS Learning's Engine holds an Anthropic key and its models. The Engine's sign-in read is held ten seconds: the section
// opens at once with speech-to-text, and the Providers list and the model choices say they are being read until it lands.
// A part whose read then fails keeps its last good read and says it is read again; with none it shows its own line.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const space=`cs-${hex}`; const co=`co-${hex}`;
const omar='20000000-0000-0000-0000-000000000001';
const lead=randomUUID();
const models=['claude-opus-4-6','claude-sonnet-4-6'];
let fake:Awaited<ReturnType<typeof laneHermes>>;
const en=i18n('en').t, ar=i18n('ar').t;
const signInRead=(method:string,path:string)=>method==='GET'&&/^\/api\/credentials\/pool(\?|$)/.test(path);
const modelsRead=(method:string,path:string)=>method==='GET'&&/^\/api\/model\/options(\?|$)/.test(path);

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 const profile=()=>({soul:'',provider:'anthropic',model:'claude-opus-4-6',key:fake.settings.key,config:{},credentials:{},env:{ANTHROPIC_API_KEY:'sk-ant-playwright-test-only-0123456789'}});
 fake.settings.profiles.set(space,profile());
 fake.settings.profiles.set(co,profile());
 fake.settings.providerModels.anthropic=models;
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${co}');
  insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) values ('${company}','${co}',true,true)
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false,skills_shared=true;
  insert into public.company_shared_spaces(company_id,folder) values ('${company}','/opt/data/profiles/${space}/skills') on conflict do nothing;
 end $$;`);
});
test.afterEach(()=>{ fake.settings.managedDelay=null; fake.settings.managedFail=null; query(`update public.people set language='en' where id='${omar}'`); });
test.afterAll(async()=>{ await fake?.close(); });

const section=(page:Page,id:string)=>page.locator(`section[aria-labelledby="${id}"]`);

for(const [language,t] of [['en',en],['ar',ar]] as const) for(const width of [1440,390]) {
 test(`with the sign-in read held, the section opens at once and the other parts fill in (${language}, ${width})`,async({page},testInfo)=>{
  query(`update public.people set language='${language}' where id='${omar}'`);
  await page.setViewportSize({width,height:900});
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  fake.settings.managedDelay=(method,path)=>signInRead(method,path)?10000:null;
  const opened=Date.now();
  await page.goto('/c/rs-learning/settings?section=models');
  // The part the held read does not back fills in long before it answers; the Providers list and the model choices
  // (whose offers read the same accounts) each say they are being read.
  await expect(section(page,'md-h-stt')).toBeVisible({timeout:6000});
  const reading=page.locator('.sov .panel-empty',{hasText:t('settingsPartReading')});
  await expect(reading).toHaveCount(2);
  expect(Date.now()-opened,'the section did not wait for the held read').toBeLessThan(9000);
  await reading.first().scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath(`models-part-reading-${language}-${width}.png`)});
  // The held read lands and each part takes its line's place.
  await expect(reading).toHaveCount(0,{timeout:20000});
  await expect(page.locator('#md-providers, section[aria-labelledby="md-h-pv"]').first()).toBeVisible();
  await expect(section(page,'md-h-default').getByText('claude-opus-4-6').first()).toBeVisible();
 });
}

test('a part whose read fails keeps its last good read and says it is read again; with none it shows its own line',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=models');
 const choices=section(page,'md-h-default');
 await expect(choices.getByText('claude-opus-4-6').first()).toBeVisible({timeout:15000});
 // The model choices stop answering; the section is opened again from another section, in the same visit.
 fake.settings.managedFail=(method,path)=>modelsRead(method,path)?500:null;
 await page.locator('#sov-nav-account').click();
 await expect(page).toHaveURL(/section=account/);
 await page.locator('#sov-nav-models').click();
 await expect(page).toHaveURL(/section=models/);
 await expect(choices.getByText('claude-opus-4-6').first()).toBeVisible();
 await expect(page.getByRole('status').filter({hasText:en('settingsPartReadAgain')})).toBeVisible({timeout:15000});
 // A new visit has no good read: the choices show their own line and the other parts stay.
 await page.reload();
 await expect(page.locator('.sov .panel-empty',{hasText:en('settingsModelsUnread')})).toBeVisible({timeout:15000});
 await expect(section(page,'md-h-stt')).toBeVisible();
 // The Engine answers again and the choices come back without a reload.
 fake.settings.managedFail=null;
 await expect(choices.getByText('claude-opus-4-6').first()).toBeVisible({timeout:20000});
});
