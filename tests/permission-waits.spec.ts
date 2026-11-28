import { test, expect } from './fresh-seed';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { laneEngineRecords } from './spec-engine-records';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { driveChannelRuns, postChannelMessage } from '../lib/channel-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { signIn } from './sign-in';
test.beforeAll(()=>laneEngineRecords());

// #165: a pending permission request (#163) in a channel is one item in "Waiting on you" of the Member who called the
// Agent, who decides it under the Agent's turn. A Conversation's request is the live Run's own since #883, decided on the
// page (tests/conversation-steer.spec.ts) and never an item of Waiting on you. Runs go to the fake engine
// (tests/fake-engine.mjs); the Agent's own Connection refuses connections, so the page's reads leave the Runs to it.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
const company='10000000-0000-0000-0000-000000000001';
const reviewer='20000000-0000-0000-0000-000000000003';
const general='69000000-0000-0000-0000-000000000001';
// The install's Hermes as these runs are given it: the fake engine answers in its place (#342).

function attachAgent() {
 const [connection,agent]=[randomUUID(),randomUUID()];
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('${agent}','${company}','${connection}','Faye','Marketing','fake-${connection.slice(0,8)}')`);
 query(`insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${agent}' from public.members where company_id='${company}' and removed_at is null and role<>'owner'`);
 return {agent,detach:()=>{ query(`delete from public.hermes_agents where id='${agent}'`); }};
}
async function memberClient(email:string) {
 const value=status();
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const person=createClient(value('API_URL'),value('ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:link,error:linked}=await service.auth.admin.generateLink({type:'magiclink',email});
 expect(linked).toBeNull();
 expect((await person.auth.verifyOtp({type:'email',token_hash:link.properties!.hashed_token})).error).toBeNull();
 return {service,person};
}
const asked:Record<string,string>={exports:'delete the old exports',backups:'delete the old backups',drafts:'delete the old drafts'};
const scripted=()=>{
 const fake=fakeEngine();
 fake.settings.permissions=input=>Object.entries(asked).filter(([word])=>input.endsWith(`Clean up the ${word}`)).map(([word,description])=>({description,command:`rm -r /srv/${word}`}));
 fake.settings.reply=(input,_answers,choices)=>`Reply to: ${input} (${choices.map(choice=>choice??'not allowed').join(', ')})`;
 return fake;
};

test('integration: in a channel the request sits under the Agent\'s turn; the Member who called it decides from Waiting on you, another Member and a Viewer read the team\'s wait line, and the database refuses anyone else',async({page,browser})=>{
 test.setTimeout(240000);
 const fake=scripted(); const {detach}=attachAgent();
 const others:Page[]=[];
 try {
  const caller=await memberClient('reviewer@example.com');
  const manager=await memberClient('manager@example.com');
  const drive=()=>withEngineContract(fake.engineFor,()=>driveChannelRuns(caller.service,{channel:general}));
  const sent=await withEngineContract(fake.engineFor,()=>postChannelMessage(caller.person,caller.service,{channel:general,sendKey:randomUUID(),message:'@Faye Clean up the exports'})) as {message:number};
  expect(await drive()).toEqual({started:0,closed:0});
  const [{id:request}]=JSON.parse(query(`select id from public.channel_permissions where message_id=${sent.message}`)) as {id:number}[];

  // The caller has one item, which opens the channel at the card under the Agent's turn.
  await page.setViewportSize({width:1440,height:900});
  await signIn(page,'reviewer@example.com','/c/rs-learning/approvals');
  const item=page.locator('.col[data-column="waiting"] a.mcard[data-kind="channel_permission"]');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.mcard__who')).toHaveText('Faye');
  await expect(item.locator('.mcard__q')).toHaveText('delete the old exports');
  await expect(item).toHaveAttribute('href',`/c/rs-learning/channels/${general}#permission-${request}`);
  await item.click();
  const card=page.locator(`#permission-${request}`);
  await expect(card).toBeInViewport();
  await expect(card).toBeFocused();
  const turn=page.locator('.turns > li.turn--agent').filter({has:card});
  await expect(turn.locator('.sender')).toHaveText('Faye');
  await expect(card.getByRole('button')).toHaveText(['Don’t allow','Allow once']);

  // Another Member and a Viewer read the request with the team's wait line, no button, and no item of their own.
  for(const email of ['manager@example.com','viewer@example.com']) {
   const other=await browser.newPage(); others.push(other);
   await other.setViewportSize({width:1440,height:900});
   await signIn(other,email,`/c/rs-learning/channels/${general}`);
   const theirs=other.locator(`#permission-${request}`);
   await expect(theirs.locator('.card__outcome'),email).toHaveText('Waiting for someone on the team to approve');
   await expect(theirs.getByRole('button'),email).toHaveCount(0);
   await other.goto('/c/rs-learning/approvals');
   await expect(other.locator('a.mcard[data-kind="channel_permission"]'),email).toHaveCount(0);
  }
  // The database refuses another Member's decision, even a Manager's.
  expect((await manager.person.rpc('decide_channel_permission',{c:company,request,choice:'once'})).error?.code).toBe('42501');

  // The caller allows it once: the item leaves, the choice goes once to the same Run, and its reply follows.
  await card.getByRole('button',{name:'Allow once'}).click();
  await expect(card.locator('.card__outcome')).toHaveText(/^Allowed once · /);
  await page.goto('/c/rs-learning/approvals');
  await expect(item).toHaveCount(0);
  await expect.poll(async()=>{ await drive(); return fake.permits.length; }).toBe(1);
  expect(fake.permits).toEqual([{run:fake.runs[0].id,permission:`${fake.runs[0].id}_p1`,choice:'once'}]);
  await expect.poll(async()=>{ await drive(); return JSON.parse(query(`select body from public.channel_messages where reply_to=${sent.message}`)); }).toEqual([{body:expect.stringMatching(/Clean up the exports \(once\)$/)}]);
  await page.goto('/c/rs-learning/approvals');
  await expect(item).toHaveCount(0);
 } finally { for(const other of others) await other.close(); detach(); }
});
