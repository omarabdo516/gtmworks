import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { toolConfig } from '../lib/agent-toolsets.mjs';

// #622 (spec #611), on the app: RS Learning holds two ChatGPT subscriptions and a Claude one on its Engine, and Lead runs
// on ChatGPT. Both ChatGPT accounts have run out. With the Fallback model at None, the default, a message to Lead asks
// both ChatGPT accounts and never Claude, and the chat says once that Lead is out of access, with nothing left waiting.
// The Owner picks Claude Sonnet as the Fallback model: every profile an Agent runs on holds it, the same request then
// completes on Claude once, and an Agent made afterwards gets the same choice from the worker and completes on it too.
// Once Claude runs out as well, a request asks it once, never loops, and the chat again says once that Lead is out of
// access. A Manager reads the choice and the server refuses their change.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=<T,>(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as T[]; };
const company='10000000-0000-0000-0000-000000000001';
const hex=company.replaceAll('-','');
const space=`cs-${hex}`; const co=`co-${hex}`;
const omar='20000000-0000-0000-0000-000000000001'; const manager='20000000-0000-0000-0000-000000000002';
const lead=randomUUID(); const writer=randomUUID();
const writerProfile=`ag-${writer.replaceAll('-','')}`;
const sonnet={provider:'anthropic',model:'claude-sonnet-4-6'};
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 const profile=()=>({soul:'',provider:'openai-codex',model:'gpt-5.5',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.profiles.set(space,profile());
 fake.settings.profiles.set(co,profile());
 // The Writer's own profile holds the fixed tools every Agent gets, so the worker starts its Runs once it is made.
 fake.settings.profiles.set(writerProfile,{...profile(),config:toolConfig({profile:writerProfile})});
 fake.settings.defaultCredentials['openai-codex']='codex-token-playwright-fallback-first-0123';
 fake.settings.defaultCredentials.anthropic='claude-token-playwright-fallback-0123';
 fake.settings.subscriptionModels['openai-codex']=['gpt-5.5'];
 fake.settings.subscriptionModels.anthropic=['claude-opus-4-6','claude-sonnet-4-6'];
 fake.settings.defaultPool['openai-codex']=[
  {id:'c0dex1',label:'said@example.com',auth_type:'oauth',source:'device_code',priority:0,access_token:'codex-token-playwright-fallback-first-0123'},
  {id:'c0dex2',label:'omar@example.com',auth_type:'oauth',source:'manual:device_code',priority:1,access_token:'codex-token-playwright-fallback-second-0123'}];
 fake.settings.defaultPool.anthropic=[{id:'c1aude',label:'team@example.com',auth_type:'oauth',source:'claude_code',priority:0,access_token:'claude-token-playwright-fallback-0123'}];
 // Both ChatGPT accounts have no quota left; Claude has.
 fake.settings.outOfQuota=new Set(['c0dex1','c0dex2']);
 query(`update public.people set language='en' where id in ('${omar}','${manager}')`);
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${co}');
  insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) values ('${company}','${co}',true,true)
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false,skills_shared=true;
  insert into public.company_shared_spaces(company_id,folder) values ('${company}','/opt/data/profiles/${space}/skills') on conflict do nothing;
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

const field=(page:Page)=>page.locator('.composer__input');
const callsOf=(run:string)=>fake.settings.modelCalls.filter(call=>call.run===run).map(call=>`${call.provider}:${call.account}`);
// The model calls of one Run: any ChatGPT account still holding quota first, then Claude exactly once, last.
const onFallback=(run:string)=>{ const calls=callsOf(run); expect(calls.at(-1)).toBe('anthropic:c1aude'); expect(calls.slice(0,-1).every(call=>call.startsWith('openai-codex:'))).toBe(true); };
const fallbacksOf=(run:string)=>fake.settings.fallbacks.filter(entry=>entry.run===run).map(entry=>`${entry.provider}/${entry.model}`);
const chainAt=(profile:string)=>fake.settings.profiles.get(profile)?.config?.fallback_providers;
const endOf=(run:string)=>rows<{outcome:string}>(`select outcome from public.conversation_run_ends where run_id='${run}'`);
const replies=(run:string)=>rows<{n:number}>(`select count(*)::int as n from public.conversation_messages where author='agent' and run_id='${run}'`)[0].n;
async function send(page:Page,agent:string,text:string) {
 const before=fake.settings.runs.length;
 await page.goto(`/c/rs-learning/chat/${agent}`);
 await field(page).fill(text);
 await field(page).press('Enter');
 await page.waitForURL(/\/conversations\/[0-9a-f-]{36}$/);
 await expect.poll(()=>fake.settings.runs.length,{timeout:30000}).toBe(before+1);
 return fake.settings.runs.at(-1)!.id;
}
// The chat's one out-of-access line, with nothing left waiting and no reply drawn.
async function outOfAccess(page:Page,run:string) {
 await expect.poll(()=>endOf(run),{timeout:30000}).toEqual([{outcome:'no_access'}]);
 const line=page.locator('.convo-status[role="alert"]');
 await expect(line).toHaveCount(1,{timeout:30000});
 await expect(line).toHaveAttribute('data-outcome','no-access');
 await expect(line).toContainText('Lead could not reply: every account it can use has run out of usage for now.');
 await expect(line.getByRole('link',{name:'Add an account or choose a fallback model in Providers'})).toBeVisible();
 await expect(page.locator('.thinking.convo-status')).toHaveCount(0);
 expect(replies(run)).toBe(0);
}

test('with None, a request that ran out of every ChatGPT account asks no other kind of provider and says so once', async({page},testInfo)=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=models');
 const group=page.getByRole('radiogroup',{name:'Fallback model'});
 await expect(group.getByRole('radio',{name:/None/})).toHaveAttribute('aria-checked','true',{timeout:30000});
 await expect(group.getByRole('radio')).toHaveCount(4);
 await testInfo.attach('fallback-none',{body:await page.locator('#md-fallback').screenshot(),contentType:'image/png'});
 expect(rows(`select 1 from public.company_fallback_models where company_id='${company}'`)).toEqual([]);

 const run=await send(page,lead,'Plan the launch');
 await outOfAccess(page,run);
 // Both ChatGPT accounts were asked once each; Claude never was, and no fallback was walked.
 expect(callsOf(run)).toEqual(['openai-codex:c0dex1','openai-codex:c0dex2']);
 expect(fallbacksOf(run)).toEqual([]);
 expect(fake.settings.modelCalls.some(call=>call.provider==='anthropic')).toBe(false);
 // #642: the Engine's text named when the usage resets (in 120h 58m, as measured), so the line says so, in the reader's own zone.
 const resets=rows<{resets_at:string}>(`select resets_at from public.conversation_run_resets where run_id='${run}'`);
 expect(resets).toHaveLength(1);
 expect(Math.abs(Date.parse(resets[0].resets_at)-Date.now()-(120*60+58)*60_000)).toBeLessThan(5*60_000);
 await expect(page.locator('.convo-status[role="alert"] time')).toContainText('The usage resets on');
 await testInfo.attach('chat-out-of-access',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
 // #642: the next message, with both accounts already marked exhausted, makes no model call: the Engine fails it at once
 // with its usage-limit line, and the chat says the same, with when the usage resets (~121h), not "could not finish".
 const again=await send(page,lead,'Plan it again');
 await outOfAccess(page,again);
 expect(callsOf(again)).toEqual([]);
 const later=rows<{resets_at:string}>(`select resets_at from public.conversation_run_resets where run_id='${again}'`);
 expect(Math.abs(Date.parse(later[0].resets_at)-Date.now()-121*3600_000)).toBeLessThan(5*60_000);
 const time=page.locator('.convo-status[role="alert"] time');
 await expect(time).toHaveAttribute('datetime',new Date(later[0].resets_at).toISOString());
 await expect(page.getByText('Send the message again to retry.')).toHaveCount(0);
 await testInfo.attach('chat-out-of-usage-again',{body:await page.locator('.convo-status[role="alert"]').screenshot(),contentType:'image/png'});
});

test('with Claude Sonnet as the Fallback model, the same request completes on it once, for Lead and for an Agent made later', async({page},testInfo)=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=models');
 const group=page.getByRole('radiogroup',{name:'Fallback model'});
 const choice=group.locator('#mdl-fb-anthropic-claude-sonnet-4-6');
 await expect(choice).toBeVisible({timeout:30000});
 // A click before React hydrated the radio does nothing: wait until it has its handlers.
 await page.waitForFunction(()=>{ const radio=document.getElementById('mdl-fb-anthropic-claude-sonnet-4-6'); return !!radio&&Object.getOwnPropertyNames(radio).some(name=>name.startsWith('__reactProps$')); });
 await choice.click();
 await expect(choice).toHaveAttribute('aria-checked','true');
 await expect(page.getByText('Fallback model saved.')).toBeVisible();
 expect(rows(`select provider,model,changed_by from public.company_fallback_models where company_id='${company}'`)).toEqual([{...sonnet,changed_by:omar}]);
 // Lead's profile took it at once; a reload keeps the choice.
 expect(chainAt(co)).toEqual([sonnet]);
 await page.reload();
 await expect(page.getByRole('radiogroup',{name:'Fallback model'}).locator('#mdl-fb-anthropic-claude-sonnet-4-6')).toHaveAttribute('aria-checked','true',{timeout:30000});
 await testInfo.attach('fallback-sonnet',{body:await page.locator('#md-fallback').screenshot(),contentType:'image/png'});

 const run=await send(page,lead,'Write the teaser');
 await expect(page.locator('.turn--agent').filter({hasText:'Reply to: Write the teaser'})).toHaveCount(1,{timeout:30000});
 await expect.poll(()=>endOf(run),{timeout:30000}).toEqual([{outcome:'completed'}]);
 // Only once the ChatGPT accounts had run out did the request move to Claude, through the fallback, once.
 onFallback(run);
 expect(fallbacksOf(run)).toEqual(['anthropic/claude-sonnet-4-6']);
 expect(replies(run)).toBe(1);
 await expect(page.locator('.convo-status[role="alert"]')).toHaveCount(0);
 await testInfo.attach('chat-fallback-reply',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});

 // An Agent made now, on a profile of its own that holds no chain yet, gets the Company's choice from the worker.
 query(`do $$ begin
  insert into public.agent_profiles(agent_id,company_id,tools_confirmed,skills_shared) values ('${writer}','${company}',true,true);
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('${writer}','${company}','${randomUUID()}','Writer','Writing',false,'${writerProfile}');
 end $$;`);
 await expect.poll(()=>chainAt(writerProfile),{timeout:30000}).toEqual([sonnet]);
 const written=await send(page,writer,'Draft the email');
 await expect(page.locator('.turn--agent').filter({hasText:'Reply to: Draft the email'})).toHaveCount(1,{timeout:30000});
 onFallback(written);
 expect(fallbacksOf(written)).toEqual(['anthropic/claude-sonnet-4-6']);
});

test('once the Fallback model runs out too, a request asks it once, never loops, and says so once', async({page})=>{
 fake.settings.outOfQuota.add('c1aude');
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${lead}`);
 const run=await send(page,lead,'Plan the webinar');
 await outOfAccess(page,run);
 expect(callsOf(run)).toEqual(['anthropic:c1aude']);
 expect(fallbacksOf(run)).toEqual(['anthropic/claude-sonnet-4-6']);
 // A while later the request is still one Run, with one line and no reply.
 await page.waitForTimeout(5000);
 expect(fake.settings.runs.filter(one=>one.id===run)).toHaveLength(1);
 expect(callsOf(run)).toHaveLength(1);
 await page.reload();
 await expect(page.locator('.convo-status[role="alert"]')).toHaveCount(1,{timeout:30000});
});

test('a Manager reads the Fallback model with no control, and the server refuses their change', async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/settings?section=models');
 const section=page.locator('#md-fallback');
 await expect(section).toContainText('claude-sonnet-4-6',{timeout:30000});
 await expect(section.getByRole('radio')).toHaveCount(0);
 await expect(section).toContainText('Only the Owner changes a model.');
 const refused=await page.evaluate(async company=>(await fetch('/api/fallback-model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,value:null})})).status,company);
 expect(refused).toBe(403);
 expect(rows(`select provider,model from public.company_fallback_models where company_id='${company}'`)).toEqual([sonnet]);
 for(const at of ['/c/rs-learning/settings?section=models']) {
  await page.goto(at);
  const html=await page.content();
  for(const secret of ['codex-token-playwright','claude-token-playwright']) expect(html).not.toContain(secret);
 }
});
