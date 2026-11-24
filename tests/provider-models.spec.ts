import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #620 (spec #611), on the app: RS Learning holds two Providers of one kind, its Claude subscription (on its Engine's root
// profile) and an Anthropic key (in its shared space), each offering Claude Opus and Claude Sonnet. The Owner turns
// Sonnet off on the subscription, then on the key too: the chat's "+" menu and Lead's model choice offer it once, with
// Claude's mark, while one Provider has it on, and not at all once none does, also after a reload. The switches are kept
// in the database; a Manager reads them and the server refuses their change.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const space=`cs-${hex}`; const co=`co-${hex}`;
const omar='20000000-0000-0000-0000-000000000001'; const manager='20000000-0000-0000-0000-000000000002';
const lead=randomUUID();
const models=['claude-opus-4-6','claude-sonnet-4-6'];
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0||testInfo.repeatEachIndex>0);
 fake=await laneHermes();
 const profile=()=>({soul:'',provider:'anthropic',model:'claude-opus-4-6',key:fake.settings.key,config:{},credentials:{},env:{ANTHROPIC_API_KEY:'sk-ant-playwright-test-only-0123456789'}});
 fake.settings.profiles.set(space,profile());
 fake.settings.profiles.set(co,profile());
 fake.settings.defaultCredentials.anthropic='test-only-claude-oauth';
 fake.settings.subscriptionModels.anthropic=models;
 fake.settings.providerModels.anthropic=models;
 query(`update public.people set language='en' where id in ('${omar}','${manager}')`);
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${co}');
  insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) values ('${company}','${co}',true,true)
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false,skills_shared=true;
  -- The Company's shared space, where its keys are written (company_key_profiles names it).
  insert into public.company_shared_spaces(company_id,folder) values ('${company}','/opt/data/profiles/${space}/skills') on conflict do nothing;
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${manager}','${lead}');
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

const field=(page:Page)=>page.locator('.composer__input');
const plus=(page:Page)=>page.locator('.composer .composer__btn[aria-haspopup="menu"]');
async function conversation(page:Page) {
 await page.goto(`/c/rs-learning/chat/${lead}`);
 await field(page).fill('Plan the launch');
 await field(page).press('Enter');
 await page.waitForURL(/\/conversations\/[0-9a-f-]{36}$/);
 return page.url();
}
// The chat's "+" menu: each model choice it offers, and whether each draws Claude's mark.
async function chatPicks(page:Page,at:string) {
 await page.goto(at);
 await expect(async()=>{ await plus(page).click(); await expect(page.getByRole('menu').getByRole('menuitemradio').first()).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 const items=page.getByRole('menu').getByRole('menuitemradio');
 const picks=await items.evaluateAll(nodes=>nodes.map(node=>({text:(node as HTMLElement).innerText.replace(/\s+/g,' ').trim(),claude:!!node.querySelector('.tool-tile svg path[fill="#D97757"]')})));
 await page.keyboard.press('Escape');
 return picks;
}
// Lead's own model choice on its Settings page, with the same marks.
async function agentPicks(page:Page) {
 await page.goto(`/c/rs-learning/settings?agent=${lead}`);
 const group=page.getByRole('radiogroup',{name:/Lead/});
 await expect(group.getByRole('radio').first()).toBeVisible();
 return group.getByRole('radio').evaluateAll(nodes=>nodes.map(node=>({text:(node as HTMLElement).innerText.replace(/\s+/g,' ').trim(),claude:!!node.querySelector('.tool-tile svg path[fill="#D97757"]')})));
}
const offered=(picks:{text:string,claude:boolean}[])=>picks.map(pick=>pick.text.split(' ')[0]);
// One Provider's switch for a model, in its details on Settings.
async function turn(page:Page,entry:string,row:RegExp,model:string,name:string,on:boolean) {
 await page.goto('/c/rs-learning/settings?section=models');
 await expect(async()=>{ await page.getByRole('button',{name:row}).first().click(); await expect(page.locator(`#pv-d-${entry}`)).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 const toggle=page.locator(`#pv-d-${entry}`).getByRole('switch',{name:`${model} on ${name}`});
 await expect(toggle).toHaveAttribute('aria-checked',on?'false':'true');
 await expect(async()=>{ await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked',on?'true':'false',{timeout:2000}); }).toPass({timeout:30000});
 await expect(page.locator('.toast')).toBeVisible();
 await expect.poll(()=>rows(`select enabled from public.company_provider_models where company_id='${company}' and entry='${entry}' and model='${model}'`)[0]?.enabled).toBe(on);
}

// One test per Provider state (#665): the journey as one test made about ten page loads and ran close to its 60 s limit on
// loaded CI shards. The tests run in order and share the conversation and the switches each leaves behind.
let chat='';
test.describe('a model stays offered once, with its mark, while either Provider has it on, and is gone from both pickers once neither does',()=>{
 test('both Providers are listed, each with both models on, and both pickers offer each model once with Claude\'s mark', async({page},testInfo)=>{
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  chat=await conversation(page);
  await page.goto('/c/rs-learning/settings?section=models');
  await expect(page.locator('#pv-row-sub-anthropic')).toBeVisible();
  await expect(page.locator('#pv-row-key-anthropic')).toBeVisible();
  const picks=await chatPicks(page,chat);
  expect(offered(picks)).toEqual(models);
  expect(picks.every(pick=>pick.claude)).toBe(true);
  const own=await agentPicks(page);
  expect(offered(own)).toEqual(models);
  expect(own.every(pick=>pick.claude)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('agent-picker-both-on.png')});
 });

 test('off on the subscription: the key still has it on, so both pickers still offer it, once', async({page},testInfo)=>{
  await signIn(page,'omar@example.com','/c/rs-learning/settings?section=models');
  await turn(page,'sub-anthropic',/^Claude/,'claude-sonnet-4-6','Claude',false);
  await page.screenshot({path:testInfo.outputPath('provider-switch-off.png')});
  await page.reload();
  await expect(page.locator('#pv-d-sub-anthropic').getByRole('switch',{name:'claude-sonnet-4-6 on Claude'})).toHaveAttribute('aria-checked','false');
  expect(offered(await chatPicks(page,chat))).toEqual(models);
  expect(offered(await agentPicks(page))).toEqual(models);
 });

 test('off on the key too: neither picker offers it, a choice of it is refused, and the Engine is never asked to change a model', async({page},testInfo)=>{
  await signIn(page,'omar@example.com','/c/rs-learning/settings?section=models');
  await turn(page,'key-anthropic',/^Anthropic/,'claude-sonnet-4-6','Anthropic',false);
  const picks=await chatPicks(page,chat);
  expect(offered(picks)).toEqual(['claude-opus-4-6']);
  expect(picks[0].claude).toBe(true);
  const own=await agentPicks(page);
  expect(offered(own)).toEqual(['claude-opus-4-6']);
  await page.screenshot({path:testInfo.outputPath('agent-picker-one-left.png')});
  // A choice of it sent anyway is refused by both writers, and nothing changes.
  const picked=await page.request.post('/api/conversations',{data:{company,conversation:chat.split('/').pop(),intent:'model',choice:{provider:'anthropic',model:'claude-sonnet-4-6'}}});
  expect([picked.status(),(await picked.json()).error]).toEqual([409,'conversationModelNotEnabled']);
  const written=await page.request.post('/api/agent-settings',{data:{company,agent:lead,setting:'model',value:'anthropic/claude-sonnet-4-6'}});
  expect([written.status(),(await written.json()).error]).toEqual([409,'settingModelNotEnabled']);
  expect(fake.settings.profiles.get(co)?.model).toBe('claude-opus-4-6');
  expect(rows(`select count(*)::int as n from public.conversations where company_id='${company}' and model is not null`)[0].n).toBe(0);
 });

 test('on again on the key: both pickers offer it again', async({page})=>{
  await signIn(page,'omar@example.com','/c/rs-learning/settings?section=models');
  await turn(page,'key-anthropic',/^Anthropic/,'claude-sonnet-4-6','Anthropic',true);
  expect(offered(await chatPicks(page,chat))).toEqual(models);
  expect(offered(await agentPicks(page))).toEqual(models);
 });
});

test('a Manager reads each Provider\'s switches and cannot change one', async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/settings?section=models');
 await expect(async()=>{ await page.locator('#pv-row-sub-anthropic').click(); await expect(page.locator('#pv-d-sub-anthropic')).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 const list=page.locator('#pv-d-sub-anthropic-models');
 await expect(list.getByRole('listitem')).toHaveText([/claude-opus-4-6\s*On/,/claude-sonnet-4-6\s*Off/]);
 await expect(page.getByRole('switch',{name:/ on Claude$/})).toHaveCount(0);
 const before=rows(`select entry,model,enabled from public.company_provider_models where company_id='${company}' order by entry,model`);
 const refused=await page.request.post('/api/provider-models',{data:{company,entry:'sub-anthropic',model:'claude-sonnet-4-6',enabled:true}});
 expect(refused.status()).toBe(403);
 expect(rows(`select entry,model,enabled from public.company_provider_models where company_id='${company}' order by entry,model`)).toEqual(before);
});
