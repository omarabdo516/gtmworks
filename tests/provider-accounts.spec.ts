import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #618, on the app: a Company holds two ChatGPT subscriptions, a Claude one and an API key, each a Provider of its own.
// The Owner names two of them, reloads, and the names stay with the right Provider; nothing secret is drawn. A Manager
// reads the names with no control, and the server refuses their rename and their disconnect; another Company reads none
// of them.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const space=`cs-${hex}`; const co=`co-${hex}`;
const key='sk-or-playwright-never-drawn-0123456789abcdef';
const tokens=['codex-token-playwright-first-0123456789','codex-token-playwright-second-0123456789','sk-ant-oat01-playwright-claude-0123456789'];
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 const profile={soul:'',provider:'openrouter',model:'openai/gpt-5.5',key:fake.settings.key,config:{},credentials:{},env:{OPENROUTER_API_KEY:key}};
 fake.settings.profiles.set(space,{...profile,env:{...profile.env}});
 fake.settings.profiles.set(co,{...profile,env:{...profile.env}});
 // Two ChatGPT accounts as the patched Engine keeps them (scripts/engine-codex-accounts.sh): the first is the singleton's
 // row, the second its own; and a `gtmworks sign-in claude`.
 fake.settings.defaultCredentials['openai-codex']=tokens[0];
 fake.settings.defaultPool['openai-codex']=[
  {id:'c0dex1',label:'said@example.com',auth_type:'oauth',source:'device_code',priority:0,access_token:tokens[0]},
  {id:'c0dex2',label:'omar@example.com',auth_type:'oauth',source:'manual:device_code',priority:1,access_token:tokens[1]}];
 fake.settings.defaultPool.anthropic=[{id:'c1aude',label:'team@example.com',auth_type:'oauth',source:'manual:hermes_pkce',priority:0,access_token:tokens[2]}];
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('e9180000-0000-0000-0000-000000000001','${company}','e9180000-0000-0000-0000-000000000011','Lead','General',true,'${co}');
  insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) values ('${company}','${co}',true,true);
  insert into public.company_shared_spaces(company_id,folder) values ('${company}','/opt/data/profiles/${space}/skills');
  update public.people set language='en' where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

const openModels=(page:Page,email:string)=>signIn(page,email,'/c/rs-learning/settings?section=models');
const rows=(page:Page)=>page.locator('#md-providers .pv-row').evaluateAll(found=>found.map(row=>(row as HTMLElement).innerText.replace(/\s+/g,' ').trim()));
const names=()=>JSON.parse(query(`select provider,account,name from public.provider_names where company_id='${company}' order by provider,account`)) as {provider:string,account:string,name:string}[];

test('the Owner names two subscriptions of one kind and a key apart, and the names stay after a reload', async({page},testInfo)=>{
 await openModels(page,'omar@example.com');
 await expect.poll(()=>rows(page),{timeout:30000}).toEqual(['ChatGPT Subscription · Connected','ChatGPT 2 Subscription · Connected','Claude Subscription · Connected',
  'OpenRouter API key · Key saved','Connect a provider']);
 await testInfo.attach('providers-before',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});

 // The second ChatGPT: its own details, its own name field.
 const second=page.locator('#pv-d-sub-openai-codex-c0dex2');
 await expect(async()=>{ await page.locator('#pv-row-sub-openai-codex-c0dex2').click(); await expect(second).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 const field=second.getByLabel('Display name');
 await expect(field).toHaveValue('ChatGPT 2');
 await field.fill('ChatGPT · Omar');
 await second.getByRole('button',{name:'Save name'}).click();
 await expect(page.locator('#pv-row-sub-openai-codex-c0dex2')).toContainText('ChatGPT · Omar');
 // The key.
 const keyDetail=page.locator('#pv-d-key-openrouter');
 await page.locator('#pv-row-key-openrouter').click();
 await keyDetail.getByLabel('Display name').fill('OpenRouter · Team');
 await keyDetail.getByRole('button',{name:'Save name'}).click();
 await expect(page.locator('#pv-row-key-openrouter')).toContainText('OpenRouter · Team');

 await page.reload();
 await expect.poll(()=>rows(page),{timeout:30000}).toEqual(['ChatGPT Subscription · Connected','ChatGPT · Omar Subscription · Connected','Claude Subscription · Connected',
  'OpenRouter · Team API key · Key saved','Connect a provider']);
 expect(names()).toEqual([{provider:'openai-codex',account:'c0dex2',name:'ChatGPT · Omar'},{provider:'openrouter',account:'key',name:'OpenRouter · Team'}]);
 // Each account is still the Engine's own: renaming moved no credential, and none reached the page.
 expect(fake.settings.defaultPool['openai-codex'].map(row=>row.id)).toEqual(['c0dex1','c0dex2']);
 expect(fake.settings.defaultCredentials['openai-codex']).toBe(tokens[0]);
 const html=await page.content();
 for(const secret of [key,...tokens]) { expect(html).not.toContain(secret); expect(html).not.toContain(secret.slice(-6)); }
 expect(html).not.toContain('example.com');
 await page.locator('#pv-row-sub-openai-codex-c0dex2').click();
 await testInfo.attach('providers-after',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});

test('a Manager reads the names with no control, and the server refuses their rename and their disconnect', async({browser})=>{
 const context=await browser.newContext(); const page=await context.newPage();
 try {
  await openModels(page,'manager@example.com');
  await expect.poll(()=>rows(page),{timeout:30000}).toEqual(['ChatGPT Subscription · Connected','ChatGPT · Omar Subscription · Connected','Claude Subscription · Connected',
   'OpenRouter · Team API key · Key saved']);
  await page.locator('#pv-row-sub-openai-codex-c0dex2').click();
  await expect(page.locator('#pv-d-sub-openai-codex-c0dex2 .pv-fact__v').first()).toHaveText('ChatGPT · Omar');
  await expect(page.locator('#md-providers input')).toHaveCount(0);
  await expect(page.locator('#md-providers').getByRole('button',{name:/Disconnect|Save name/})).toHaveCount(0);
  const rename=await page.request.post('/api/provider-names',{data:{company,provider:'openai-codex',account:'c0dex2',name:'Manager'}});
  expect(rename.status()).toBe(403);
  const disconnect=await page.request.post('/api/company-sign-in',{data:{company,provider:'openai-codex',intent:'disconnect',account:'c0dex2'}});
  expect(disconnect.status()).toBe(403);
  expect(names().find(row=>row.account==='c0dex2')?.name).toBe('ChatGPT · Omar');
  expect(fake.settings.defaultPool['openai-codex'].map(row=>row.id)).toEqual(['c0dex1','c0dex2']);
 } finally { await context.close(); }
});

test('another Company reads none of these names', async({page})=>{
 await signIn(page,'omar@example.com','/c/aleem/settings?section=models');
 await expect(page.locator('#md-providers')).toBeVisible({timeout:30000});
 const html=await page.content();
 for(const name of ['ChatGPT · Omar','OpenRouter · Team']) expect(html).not.toContain(name);
});
