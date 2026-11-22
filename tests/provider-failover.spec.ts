import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #621 (spec #611), on the app: RS Learning holds three ChatGPT subscriptions on its Engine, and Lead runs on ChatGPT. The
// first has no quota left and the Owner switched the second off in Settings. A message to Lead is one request: the Engine
// tries the first, finds it out of quota and goes on with the same model call on the third, skipping the second. The
// person gets one reply and no word of the move; the Engine was asked once per account and the second never; the
// Company's log holds one entry by gtmworks naming both accounts, and Settings shows the first out of quota. The next
// message runs on the third alone and logs nothing; once every account switched on has run out, a request fails and
// logs no move: an exhausted account alone is no move.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=<T,>(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as T[]; };
const company='10000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const co=`co-${hex}`;
const omar='20000000-0000-0000-0000-000000000001';
const lead=randomUUID();
const tokens=['codex-token-playwright-failover-first-0123','codex-token-playwright-failover-second-0123','codex-token-playwright-failover-third-0123'];
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 fake.settings.profiles.set(co,{soul:'',provider:'openai-codex',model:'gpt-5.5',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.defaultCredentials['openai-codex']=tokens[0];
 fake.settings.defaultPool['openai-codex']=[
  {id:'c0dex1',label:'said@example.com',auth_type:'oauth',source:'device_code',priority:0,access_token:tokens[0]},
  {id:'c0dex2',label:'omar@example.com',auth_type:'oauth',source:'manual:device_code',priority:1,access_token:tokens[1]},
  {id:'c0dex3',label:'team@example.com',auth_type:'oauth',source:'manual:device_code',priority:2,access_token:tokens[2]}];
 // The first account answers with its usage limit; the others have quota.
 fake.settings.outOfQuota=new Set(['c0dex1']);
 query(`update public.people set language='en' where id='${omar}'`);
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${co}');
  insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) values ('${company}','${co}',true,true)
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false,skills_shared=true;
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

const providerRows=(page:Page)=>page.locator('#md-providers .pv-row').evaluateAll(found=>found.map(row=>(row as HTMLElement).innerText.replace(/\s+/g,' ').trim()));
const moves=()=>rows<{actor_kind:string,actor_id:string|null,details:Record<string,string>}>(
 `select actor_kind,actor_id,details from public.company_log where company_id='${company}' and action='provider_switched' order by id`);
const field=(page:Page)=>page.locator('.composer__input');
const callsOf=(run:string)=>fake.settings.modelCalls.filter(call=>call.run===run).map(call=>call.account);

test('one request goes on on the next account switched on: one reply, no word of it in the chat, one entry in the log', async({page},testInfo)=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=models');
 await expect.poll(()=>providerRows(page),{timeout:30000}).toEqual(['ChatGPT Subscription · Connected','ChatGPT 2 Subscription · Connected','ChatGPT 3 Subscription · Connected','Connect a provider']);
 // The Owner switches the second account off; the Engine takes the switch at once.
 await expect(async()=>{ await page.locator('#pv-row-sub-openai-codex-c0dex2').click(); await expect(page.locator('#pv-d-sub-openai-codex-c0dex2')).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 await page.locator('#pv-d-sub-openai-codex-c0dex2').getByRole('switch').click();
 await expect(page.locator('#pv-row-sub-openai-codex-c0dex2')).toContainText('Switched off');
 await expect.poll(()=>fake.settings.defaultPool['openai-codex'].map(row=>[row.id,row.off===true]),{timeout:15000})
  .toEqual([['c0dex1',false],['c0dex2',true],['c0dex3',false]]);
 await testInfo.attach('providers-before',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});

 const before=fake.settings.runs.length;
 await page.goto(`/c/rs-learning/chat/${lead}`);
 await field(page).fill('Plan the launch');
 await field(page).press('Enter');
 await page.waitForURL(/\/conversations\/[0-9a-f-]{36}$/);
 const conversation=page.url().split('/').at(-1)!;
 await expect(page.locator('.turn--agent').filter({hasText:'Reply to: Plan the launch'})).toHaveCount(1,{timeout:30000});
 // One request: one Run, which asked the first account, then the third, and never the switched-off second.
 expect(fake.settings.runs.length).toBe(before+1);
 const run=fake.settings.runs.at(-1)!.id;
 expect(callsOf(run)).toEqual(['c0dex1','c0dex3']);
 expect(fake.settings.answeredOn.get(run)).toBe('c0dex3');
 expect(fake.settings.switches.map(move=>[move.from,move.to])).toEqual([['c0dex1','c0dex3']]);
 // After Lead's greeting the chat holds the person's message and the one reply, and nothing about the move.
 await expect(page.locator('.turn--user')).toHaveCount(1);
 await expect(page.locator('.turn--agent').filter({hasText:'Reply to:'})).toHaveCount(1);
 const said=await page.locator('main').innerText();
 for(const word of ['ChatGPT','quota','account','c0dex']) expect(said).not.toContain(word);
 expect(rows<{author:string,body:string}>(`select author,body from public.conversation_messages where conversation_id='${conversation}'
  and id>=(select min(id) from public.conversation_messages where conversation_id='${conversation}' and author='person') order by id`))
  .toEqual([{author:'person',body:'Plan the launch'},{author:'agent',body:'Reply to: Plan the launch'}]);
 await testInfo.attach('chat-one-reply',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});

 // The worker copies the move into the Company's log once, as gtmworks's own entry, by the accounts' names in Settings.
 await expect.poll(()=>moves(),{timeout:30000}).toEqual([{actor_kind:'system',actor_id:null,details:{provider:'openai-codex',from_name:'ChatGPT',to_name:'ChatGPT 3'}}]);
 await page.goto('/c/rs-learning/log');
 const entry=page.locator('.lgp-body .lg-row').filter({hasText:'continued a request on the next account of'});
 await expect(entry).toHaveCount(1);
 await expect(entry).toContainText('gtmworks');
 await expect(entry).toContainText('ChatGPT 3');
 await testInfo.attach('activity-log',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
 // Settings shows the first account out of quota, still connected; no credential or Engine label is drawn anywhere.
 await page.goto('/c/rs-learning/settings?section=models');
 await expect.poll(()=>providerRows(page),{timeout:30000}).toEqual(['ChatGPT Subscription · Out of quota','ChatGPT 2 Subscription · Switched off','ChatGPT 3 Subscription · Connected','Connect a provider']);
 await testInfo.attach('providers-after',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
 for(const at of ['/c/rs-learning/settings?section=models','/c/rs-learning/log',`/c/rs-learning/conversations/${conversation}`]) {
  await page.goto(at);
  const html=await page.content();
  for(const secret of tokens) { expect(html).not.toContain(secret); expect(html).not.toContain(secret.slice(-6)); }
  expect(html).not.toContain('example.com');
 }
});

test('the next request runs on the account that answered and logs nothing; one with no account left logs no move', async({page})=>{
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${lead}`);
 await field(page).fill('Write the teaser');
 await field(page).press('Enter');
 await page.waitForURL(/\/conversations\/[0-9a-f-]{36}$/);
 await expect(page.locator('.turn--agent').filter({hasText:'Reply to: Write the teaser'})).toHaveCount(1,{timeout:30000});
 expect(callsOf(fake.settings.runs.at(-1)!.id)).toEqual(['c0dex3']);
 // Now the third runs out too, and the second is still off: the request fails, and the Engine recorded no move.
 fake.settings.outOfQuota.add('c0dex3');
 const before=fake.settings.runs.length;
 await page.goto(`/c/rs-learning/chat/${lead}`);
 await field(page).fill('Draft the email');
 await field(page).press('Enter');
 await page.waitForURL(/\/conversations\/[0-9a-f-]{36}$/);
 await expect.poll(()=>fake.settings.runs.length,{timeout:30000}).toBe(before+1);
 const failed=fake.settings.runs.at(-1)!.id;
 // The app closed the Run as failed, with no reply, before anything else is read.
 await expect.poll(()=>rows<{outcome:string}>(`select outcome from public.conversation_run_ends where run_id='${failed}'`),{timeout:30000}).toEqual([{outcome:'failed'}]);
 expect(rows<{n:number}>(`select count(*)::int as n from public.conversation_messages where author='agent' and run_id='${failed}'`)).toEqual([{n:0}]);
 expect(callsOf(failed)).toEqual(['c0dex3']);
 await expect(page.locator('.turn--agent').filter({hasText:'Reply to: Draft the email'})).toHaveCount(0);
 expect(fake.settings.switches).toHaveLength(1);
 // A worker pass later, the log still holds the one move. (This lane's fake Engine serves every Company, so it is not
 // where one Company's moves are kept from another's: each Company has an Engine of its own, ADR 0018, and
 // supabase/tests/provider_switches.sql proves a Member reads their own Company's moves only.)
 await page.waitForTimeout(12000);
 expect(moves()).toHaveLength(1);
 await page.goto('/c/rs-learning/settings?section=models');
 await expect.poll(()=>providerRows(page),{timeout:30000}).toEqual(['ChatGPT Subscription · Out of quota','ChatGPT 2 Subscription · Switched off','ChatGPT 3 Subscription · Out of quota','Connect a provider']);
});
