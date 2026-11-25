import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #619, on the app: a Company holds two ChatGPT subscriptions, a Claude one and an API key. The Owner moves the key to
// the top and switches the first ChatGPT off, reloads, and both stay, in the page and the database; switching it on
// again needs no new sign-in, and no credential moves in the Engine. A Manager reads the order and the switch with no
// control, and the server refuses their change; another Company's list is its own.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const space=`cs-${hex}`; const co=`co-${hex}`;
const key='sk-or-playwright-order-never-drawn-0123456789';
const tokens=['codex-token-playwright-order-first-0123','codex-token-playwright-order-second-0123','sk-ant-oat01-playwright-order-claude-0123'];
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 const profile={soul:'',provider:'openrouter',model:'openai/gpt-5.5',key:fake.settings.key,config:{},credentials:{},env:{OPENROUTER_API_KEY:key}};
 fake.settings.profiles.set(space,{...profile,env:{...profile.env}});
 fake.settings.profiles.set(co,{...profile,env:{...profile.env}});
 fake.settings.defaultCredentials['openai-codex']=tokens[0];
 fake.settings.defaultPool['openai-codex']=[
  {id:'c0dex1',label:'said@example.com',auth_type:'oauth',source:'device_code',priority:0,access_token:tokens[0]},
  {id:'c0dex2',label:'omar@example.com',auth_type:'oauth',source:'manual:device_code',priority:1,access_token:tokens[1]}];
 fake.settings.defaultPool.anthropic=[{id:'c1aude',label:'team@example.com',auth_type:'oauth',source:'manual:hermes_pkce',priority:0,access_token:tokens[2]}];
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('e9190000-0000-0000-0000-000000000001','${company}','e9190000-0000-0000-0000-000000000011','Lead','General',true,'${co}');
  insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) values ('${company}','${co}',true,true);
  insert into public.company_shared_spaces(company_id,folder) values ('${company}','/opt/data/profiles/${space}/skills');
  update public.people set language='en' where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

const openModels=(page:Page,email:string)=>signIn(page,email,'/c/rs-learning/settings?section=models');
const rows=(page:Page)=>page.locator('#md-providers .pv-row').evaluateAll(found=>found.map(row=>(row as HTMLElement).innerText.replace(/\s+/g,' ').trim()));
const kept=()=>JSON.parse(query(`select company_id,provider,account,place,enabled from public.provider_order order by company_id,place nulls last,provider,account`)) as {company_id:string,provider:string,account:string,place:number|null,enabled:boolean}[];
const pool=()=>({codex:fake.settings.defaultPool['openai-codex'].map(row=>[row.id,row.access_token]),claude:fake.settings.defaultPool.anthropic.map(row=>[row.id,row.access_token]),
 singleton:fake.settings.defaultCredentials['openai-codex']});
const engineBefore={codex:[['c0dex1',tokens[0]],['c0dex2',tokens[1]]],claude:[['c1aude',tokens[2]]],singleton:tokens[0]};
const signInsAsked=()=>fake.settings.managementRequests.filter(request=>(request.path??'').startsWith('/api/providers/oauth')&&request.method!=='GET').length;
const ordered=['OpenRouter API key · Key saved','ChatGPT Subscription · Switched off','ChatGPT 2 Subscription · Connected','Claude Subscription · Connected'];

test('the Owner moves the key first and switches a ChatGPT off; both stay after a reload, and switching it on needs no new sign-in', async({page},testInfo)=>{
 await openModels(page,'omar@example.com');
 await expect.poll(()=>rows(page),{timeout:30000}).toEqual(['ChatGPT Subscription · Connected','ChatGPT 2 Subscription · Connected','Claude Subscription · Connected',
  'OpenRouter API key · Key saved','Connect a provider']);
 const asked=signInsAsked();
 await expect(async()=>{ await page.locator('#pv-row-key-openrouter').click(); await expect(page.locator('#pv-d-key-openrouter')).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 await testInfo.attach('order-before',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
 const keyDetail=page.locator('#pv-d-key-openrouter');
 await expect(keyDetail.locator('#pv-d-key-openrouter-place')).toHaveText('4 of 4');
 await expect(keyDetail.getByRole('button',{name:'Move OpenRouter down'})).toBeDisabled();
 // Three moves up, each saved and read again before the next.
 for(const place of ['3 of 4','2 of 4','1 of 4']) {
  await keyDetail.getByRole('button',{name:'Move OpenRouter up'}).click();
  await expect(keyDetail.locator('#pv-d-key-openrouter-place')).toHaveText(place);
 }
 await expect(keyDetail.getByRole('button',{name:'Move OpenRouter up'})).toBeDisabled();
 // The first ChatGPT, switched off.
 await page.locator('#pv-row-sub-openai-codex-c0dex1').click();
 const first=page.locator('#pv-d-sub-openai-codex-c0dex1');
 await first.getByRole('switch',{name:'Use ChatGPT'}).click();
 await expect(page.locator('#pv-row-sub-openai-codex-c0dex1')).toContainText('Switched off');

 await page.reload();
 await expect.poll(()=>rows(page),{timeout:30000}).toEqual([...ordered,'Connect a provider']);
 expect(kept()).toEqual([
  {company_id:company,provider:'openrouter',account:'key',place:0,enabled:true},{company_id:company,provider:'openai-codex',account:'c0dex1',place:1,enabled:false},
  {company_id:company,provider:'openai-codex',account:'c0dex2',place:2,enabled:true},{company_id:company,provider:'anthropic',account:'c1aude',place:3,enabled:true}]);
 await page.locator('#pv-row-sub-openai-codex-c0dex1').click();
 await expect(first.getByRole('switch',{name:'Use ChatGPT'})).toHaveAttribute('aria-checked','false');
 // Still connected in the Engine: the switch moved no credential and asked for no sign-in.
 await expect(first.locator('#sub-openai-codex-c0dex1-state')).toHaveText('Connected');
 expect(pool()).toEqual(engineBefore);
 const html=await page.content();
 for(const secret of [key,...tokens]) { expect(html).not.toContain(secret); expect(html).not.toContain(secret.slice(-6)); }
 expect(html).not.toContain('example.com');
 await testInfo.attach('order-after',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});

 await first.getByRole('switch',{name:'Use ChatGPT'}).click();
 await expect(page.locator('#pv-row-sub-openai-codex-c0dex1')).toContainText('Connected');
 await page.reload();
 await expect.poll(()=>rows(page),{timeout:30000}).toEqual(['OpenRouter API key · Key saved','ChatGPT Subscription · Connected','ChatGPT 2 Subscription · Connected','Claude Subscription · Connected','Connect a provider']);
 expect(kept().find(row=>row.account==='c0dex1')).toEqual({company_id:company,provider:'openai-codex',account:'c0dex1',place:1,enabled:true});
 expect(pool()).toEqual(engineBefore);
 expect(signInsAsked()).toBe(asked);
 // Leave it switched off for the Manager to read.
 await page.locator('#pv-row-sub-openai-codex-c0dex1').click();
 await first.getByRole('switch',{name:'Use ChatGPT'}).click();
 await expect(page.locator('#pv-row-sub-openai-codex-c0dex1')).toContainText('Switched off');
});

test('a Manager reads the order and the switch with no control, and the server refuses their change', async({browser})=>{
 const context=await browser.newContext(); const page=await context.newPage();
 try {
  await openModels(page,'manager@example.com');
  await expect.poll(()=>rows(page),{timeout:30000}).toEqual(ordered);
  await page.locator('#pv-row-sub-openai-codex-c0dex1').click();
  const first=page.locator('#pv-d-sub-openai-codex-c0dex1');
  await expect(first.locator('#pv-d-sub-openai-codex-c0dex1-place')).toHaveText('2 of 4');
  await expect(first.locator('#pv-d-sub-openai-codex-c0dex1-place-state')).toHaveText('Switched off');
  await expect(page.locator('#md-providers [role="switch"], #md-providers .pv-move')).toHaveCount(0);
  const before=kept();
  const reorder=await page.request.post('/api/provider-order',{data:{company,intent:'order',entries:[{provider:'anthropic',account:'c1aude'}]}});
  expect(reorder.status()).toBe(403);
  const turn=await page.request.post('/api/provider-order',{data:{company,intent:'switch',provider:'openai-codex',account:'c0dex1',enabled:true}});
  expect(turn.status()).toBe(403);
  expect(await turn.json()).toEqual({error:'providerNotAllowed'});
  expect(kept()).toEqual(before);
 } finally { await context.close(); }
});

test('another Company\'s list is its own: the Owner\'s order and switch change nothing there', async({page})=>{
 await signIn(page,'omar@example.com','/c/aleem/settings?section=models');
 await expect(page.locator('#md-providers')).toBeVisible({timeout:30000});
 // This lane's fake Engine serves every Company the same accounts: Aleem's are in the Engine's order, every one on.
 await expect.poll(()=>rows(page),{timeout:30000}).toEqual(['ChatGPT Subscription · Connected','ChatGPT 2 Subscription · Connected','Claude Subscription · Connected','Connect a provider']);
 expect(kept().every(row=>row.company_id===company)).toBe(true);
 // Nor does an Owner of one Company reorder another's by naming it: Omar is no Owner of a Company he is not in.
 const stranger=await page.request.post('/api/provider-order',{data:{company:'10000000-0000-0000-0000-0000000000ff',intent:'switch',provider:'anthropic',account:'key',enabled:false}});
 expect(stranger.status()).toBe(403);
});
