import { test, expect, freshSeed, type Page } from './fresh-seed';
import type { Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Browser } from '@playwright/test';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { faceAnimations } from './navigation-measure';

// #132: the chat moves as the approved reference does, on the lane's fake Hermes holding a Run open. What arrives during
// the visit (the person's own message once sent, the Agent's reply, the card for an Agent Lead made) rises once, and
// asking for the record again never replays it; the live working line's words breathe (#646); what the chat held when it was
// opened moves nothing. A Viewer of the general channel sees the same rise and breathing, and has no send arrow.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const channel='69000000-0000-0000-0000-000000000001';
const general=`/c/rs-learning/channels/${channel}`;
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0||testInfo.repeatEachIndex>0);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id in ('${omar}','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000005')`);
 // Lead, the channel's main Agent, on the Company's profile, shown to every Member.
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}');
  insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${lead}' from public.members where company_id='${company}' and removed_at is null and role<>'owner';
  insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

// Every animation that starts on the page from now on, by its element's words, kept across the page's own navigations.
async function watchStarts(page:Page) {
 await page.evaluate(()=>{
  const seen:{name:string,text:string,cls:string}[]=[]; (window as unknown as {starts:typeof seen}).starts=seen;
  document.addEventListener('animationstart',event=>{ const target=event.target as Element; seen.push({name:event.animationName,text:target.textContent??'',cls:String(target.className)}); });
  const flew:string[]=[]; (window as unknown as {flew:string[]}).flew=flew;
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{ if(node instanceof Element&&(node.matches('.send-fly')||node.querySelector('.send-fly'))) flew.push(node.outerHTML); }))).observe(document.body,{subtree:true,childList:true});
 });
}
const starts=(page:Page,name:string,text:string)=>page.evaluate(([name,text])=>(window as unknown as {starts:{name:string,text:string}[]}).starts.filter(start=>start.name===name&&start.text.includes(text)).length,[name,text]);
const motionOf=(part:Locator)=>part.evaluate(element=>{ const style=getComputedStyle(element); return [style.animationName,style.animationDuration,style.animationTimingFunction,style.animationIterationCount]; });
const motion=(page:Page,selector:string)=>motionOf(page.locator(selector).first());
const rises=['gw-rise','0.2s','cubic-bezier(0.2, 0, 0, 1)','1'];
const breathes=['gw-breathe','1.4s','ease-in-out','infinite'];
// What still runs on the page: every animation in play, by its name. The page's own entrance is left out: a page fades
// in as it opens, a reload too (#135, design-reference setView), and that is the page, not a message moving. So is an
// Agent face's own life, its breath and a state's loop, by name, as the measured navigation leaves it out (#697).
const running=(page:Page)=>page.evaluate(names=>document.getAnimations().filter(animation=>animation.playState==='running')
 .filter(animation=>!(animation instanceof CSSAnimation&&animation.animationName==='gw-fade-in'&&((animation.effect as KeyframeEffect|null)?.target as Element|null)
  ?.matches('.app-content > :not(.convo-page), .app-content > .convo-page .convo > :not(.details, .dp-scrim)')))
 .filter(animation=>!(animation instanceof CSSAnimation&&names.includes(animation.animationName)))
 .map(animation=>(animation as CSSAnimation).animationName??'transition'),faceAnimations);

test('in a Conversation the sent message, the reply and the card for the Agent Lead made rise once, the working line breathes, and a reload moves nothing',async({page})=>{
 test.setTimeout(120000);
 fake.settings.pendingReads=1e9;
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${lead}`);
 await watchStarts(page);
 const text=`Make me an Agent for the Meta ads ${Date.now()}`;
 await page.getByLabel('Message',{exact:true}).fill(text);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 // The arrow's copy leaves the button on send.
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {flew:string[]}).flew.length)).toBe(1);
 await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
 const conversation=page.url().split('/').pop()!;
 const mine=page.locator('.turn--user').filter({hasText:text});
 await expect(mine).toBeVisible();
 expect(await motionOf(mine)).toEqual(rises);
 // While Lead works, the live line's words breathe (#646): its Run has made no call yet.
 await expect(page.locator('.activity .shimmer')).toHaveText('Thinking…');
 await expect(page.locator('.activity .activity__who')).toHaveText('Lead');
 expect(await motion(page,'.activity .shimmer')).toEqual(breathes);
 // Lead makes an Agent during the Run, as lead_create_agent writes it; then the Run ends with its reply. The made Agent is
 // tied to this Conversation by a test-only trigger, in the transaction that writes the reply (close_conversation_run; the
 // app's lead_create_agent writes it itself, during the Run), so the open chat, which
 // keeps asking for the record, reads the card and the reply together: a read in between would draw the card in a turn of
 // its own first, and a card moved into the reply stays still by design (#547).
 const [{run_id:run}]=rows(`select run_id from public.conversation_messages where conversation_id='${conversation}' and author='person'`) as {run_id:string}[];
 const ads=randomUUID();
 query(`do $$ begin
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile,requested_by,created_at) values ('${ads}','${company}','${randomUUID()}','Meta Ads','Runs the Meta ads.','made-${ads.slice(0,8)}','${omar}',now());
  create or replace function public.chat_motion_made_with_reply() returns trigger language plpgsql set search_path='' as $f$ begin
   insert into public.lead_made_agents(conversation_id,run_id,call_id,company_id,agent_id,created_at) values ('${conversation}','${run}','call-0','${company}','${ads}',now());
   return null;
  end $f$;
  drop trigger if exists chat_motion_made_with_reply on public.conversation_messages;
  create trigger chat_motion_made_with_reply after insert on public.conversation_messages for each row
   when (new.conversation_id='${conversation}' and new.run_id='${run}' and new.author='agent') execute function public.chat_motion_made_with_reply();
 end $$;`);
 try {
  fake.settings.pendingReads=0;
  await expect.poll(()=>rows(`select 1 from public.lead_made_agents where agent_id='${ads}'`).length,{timeout:20000}).toBe(1);
 } finally {
  query('do $$ begin drop trigger if exists chat_motion_made_with_reply on public.conversation_messages; drop function if exists public.chat_motion_made_with_reply(); end $$;');
 }
 const reply=page.locator('.turn--agent').filter({hasText:`Reply to: ${text}`});
 await expect(reply).toBeVisible({timeout:20000});
 expect(await motionOf(reply)).toEqual(rises);
 const card=reply.getByRole('group',{name:'Agent made: Meta Ads'});
 await expect(card).toBeVisible();
 expect(await card.evaluate(element=>getComputedStyle(element).animationDuration)).toBe('0.28s');
 // Another message and its Run: the record is asked for again and the page drawn again by the server, and nothing that
 // arrived before rises a second time.
 const read=page.waitForResponse(response=>response.url().includes('/api/conversations?company=')&&response.request().method()==='GET');
 await page.getByLabel('Message',{exact:true}).fill('Thanks');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await read;
 await expect(page.locator('.turn--agent').filter({hasText:'Reply to: Thanks'})).toBeVisible({timeout:20000});
 await expect.poll(()=>starts(page,'gw-rise','Reply to: Thanks')).toBe(1);
 expect(await starts(page,'gw-rise',text)).toBeGreaterThanOrEqual(1);
 expect(await starts(page,'gw-rise',`Reply to: ${text}`)).toBe(1);
 expect(await page.evaluate(([text])=>(window as unknown as {starts:{name:string,text:string,cls:string}[]}).starts.filter(start=>start.name==='gw-rise'&&start.cls.includes('turn--user')&&start.text.includes(text)).length,[text])).toBe(1);
 expect(rows(`select body from public.conversation_messages where conversation_id='${conversation}' order by id`).map(row=>row.body)).toEqual([text,`Reply to: ${text}`,'Thanks','Reply to: Thanks']);
 // Opened again, the Conversation holds the same turns and moves nothing.
 await page.reload();
 await expect(reply).toBeVisible();
 await expect(card).toBeVisible();
 expect(await mine.evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
 expect(await reply.evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
 expect(await card.evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
 expect(await running(page)).toEqual([]);
});

// A Member's own context, as tests/channels.spec.ts opens one.
async function as(browser:Browser,email:string,path:string) {
 const context=await browser.newContext(); const opened=await context.newPage();
 await signIn(opened,email,path);
 return {page:opened,close:()=>context.close()};
}

test('in the general channel a Viewer sees the working line breathe and the reply rise once, and never a send arrow; the caller\'s message rises too',async({page,browser})=>{
 test.setTimeout(120000);
 fake.settings.pendingReads=1e9;
 await signIn(page,'viewer@example.com',general);
 await expect(page.locator('.ch-intro')).toBeVisible();
 await watchStarts(page);
 const caller=await as(browser,'reviewer@example.com',general);
 try {
  await watchStarts(caller.page);
  const text=`@Lead what is due today ${Date.now()}`;
  const box=caller.page.getByRole('textbox',{name:'Write your message in the channel',exact:true});
  await box.fill(text); await box.press('Enter');
  const mine=caller.page.locator('.turn--user').filter({hasText:text.slice(6)});
  await expect(mine).toBeVisible();
  expect(await mine.evaluate(element=>getComputedStyle(element).animationName)).toBe('gw-rise');
  await expect.poll(()=>caller.page.evaluate(()=>(window as unknown as {flew:string[]}).flew.length)).toBe(1);
  // The Viewer: the message rises when it arrives, and the line breathes while Lead works.
  const theirs=page.locator('.turn--peer').filter({hasText:text.slice(6)});
  await expect(theirs).toBeVisible({timeout:20000});
  expect(await theirs.evaluate(element=>getComputedStyle(element).animationName)).toBe('gw-rise');
  await expect(page.locator('.activity .shimmer')).toHaveText('Thinking…',{timeout:20000});
  await expect(page.locator('.activity .activity__who')).toHaveText('Lead');
  expect(await motion(page,'.activity .shimmer')).toEqual(breathes);
  fake.settings.pendingReads=0;
  const reply=page.locator('.turn--agent').filter({hasText:'Reply to:'});
  await expect(reply).toBeVisible({timeout:30000});
  expect(await motionOf(reply)).toEqual(rises);
  // Both pages have the reply and its rise. The caller then writes a plain message (no Agent called, so no Run): both
  // pages drawing it, and its rise, prove each has read the channel again and drawn it; the reply still rose once.
  await expect(caller.page.locator('.turn--agent').filter({hasText:'Reply to:'})).toBeVisible({timeout:30000});
  await expect.poll(()=>starts(page,'gw-rise','Reply to:')).toBe(1);
  await expect.poll(()=>starts(caller.page,'gw-rise','Reply to:')).toBe(1);
  const after=`Thanks, team ${Date.now()}`;
  await box.fill(after); await box.press('Enter');
  for(const on of [page,caller.page]) {
   await expect(on.locator('.turns > li').filter({hasText:after})).toBeVisible({timeout:20000});
   await expect.poll(()=>starts(on,'gw-rise',after)).toBe(1);
  }
  expect(await starts(page,'gw-rise','Reply to:')).toBe(1);
  expect(await starts(caller.page,'gw-rise','Reply to:')).toBe(1);
  await expect(page.locator('.composer__send')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as unknown as {flew:string[]}).flew)).toEqual([]);
  // The database holds the message and Lead's reply to it.
  expect(rows(`select author,body from public.channel_messages where channel_id='${channel}' and (body='${text}' or body like 'Reply to:%') order by id`).map(row=>row.author)).toEqual(['person','agent']);
  // Opened again, nothing moves.
  await page.reload();
  await expect(reply).toBeVisible();
  expect(await reply.evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
  expect(await running(page)).toEqual([]);
 } finally { await caller.close(); }
});

test('with reduced motion the working line\'s words are still and fully drawn',async({browser})=>{
 test.setTimeout(90000);
 fake.settings.pendingReads=1e9;
 const context=await browser.newContext({reducedMotion:'reduce'}); const page=await context.newPage();
 try {
  await signIn(page,'omar@example.com',`/c/rs-learning/chat/${lead}`);
  await page.getByLabel('Message',{exact:true}).fill('Plan the week');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('.activity .shimmer')).toHaveText('Thinking…',{timeout:20000});
  await expect(page.locator('.activity .activity__who')).toHaveText('Lead');
  expect(await page.locator('.activity .shimmer').evaluate(element=>[getComputedStyle(element).animationName,getComputedStyle(element).opacity])).toEqual(['none','1']);
  expect(await page.locator('.send-fly').count()).toBe(0);
 } finally { fake.settings.pendingReads=0; await context.close(); }
});
