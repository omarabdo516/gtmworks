import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { closeOpenRuns, sendMessage, startQueuedTurns, stopConversationRun } from '../lib/conversation-runs.mjs';
import { routeAllowed } from '../lib/route-permissions.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { fakeHermes } from './fake-hermes.mjs';
import { signIn } from './sign-in';

// Team-work rules of 2026-11-13 (a, b, c, d, g) on the local database, through the same run layer the conversation
// route and the worker use, with the fake engine (tests/fake-engine.mjs) in place of Hermes. A Conversation stays
// private to its person, so "busy" is that person's own open run.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const manager='20000000-0000-0000-0000-000000000002';
const contributor='20000000-0000-0000-0000-000000000005';
const encryptionKey=process.env.WEBHOOK_ENCRYPTION_KEY||'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

// A Member's own session, signed in by email link, and the service client the route and the worker use.
async function memberClient(email:string) {
 const value=status();
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const person=createClient(value('API_URL'),value('ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:link,error:linked}=await service.auth.admin.generateLink({type:'magiclink',email});
 expect(linked).toBeNull();
 expect((await person.auth.verifyOtp({type:'email',token_hash:link.properties!.hashed_token})).error).toBeNull();
 return {service,person};
}
// An agent whose Connection is never called (its address refuses connections, so the background worker leaves its runs
// open for the fake engine to close).
function attachAgent() {
 const [connection,agent]=[randomUUID(),randomUUID()];
 query(`insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values ('${connection}','${company}','${omar}','http://127.0.0.1:9','fake-${connection.slice(0,8)}','${encryptSecret('fake-engine-key',encryptionKey)}','connected','0.23.0','{run_submission}')`);
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${agent}','${company}','${connection}','Faye','Marketing')`);
 return {agent,detach:()=>{
  query(`delete from public.hermes_agents where id='${agent}'`); query(`delete from public.hermes_connections where id='${connection}'`);
 }};
}
const rows=(conversation:string)=>JSON.parse(query(`select author,person_id,author_name,body from public.conversation_messages where conversation_id='${conversation}' order by id`));

test.describe.configure({mode:'serial'});

// The queue runs on a fake Hermes the background worker can reach as well: whoever closes a run and starts the next turn
// (the worker, or this test as a reader would), the engine's idempotency key keeps each turn one run.
async function attachFakeHermes(fake:Awaited<ReturnType<typeof fakeHermes>>) {
 const [connection,agent]=[randomUUID(),randomUUID()];
 query(`insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state,version,features) values ('${connection}','${company}','${omar}','${fake.address}','queue-${connection.slice(0,8)}','${encryptSecret(fake.settings.key,encryptionKey)}','connected','0.23.0','{run_submission}')`);
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${agent}','${company}','${connection}','Faye','Marketing')`);
 return {agent,detach:()=>{ query(`delete from public.hermes_agents where id='${agent}'`); query(`delete from public.hermes_connections where id='${connection}'`); }};
}

test('integration: two sends while the Agent is busy run as two turns in order, each after the one before ends',async()=>{
 test.setTimeout(120000);
 const fake=await fakeHermes(); fake.settings.pendingReads=1e9;
 const {service,person}=await memberClient('omar@example.com'); const {agent,detach}=await attachFakeHermes(fake);
 try {
  expect((await person.rpc('save_member_note',{c:company,note:'Answer in short points.'})).error).toBeNull();
  const conversation=randomUUID(); const keys=[randomUUID(),randomUUID(),randomUUID()];
  const send=(index:number,message:string)=>sendMessage(person,service,{company,conversation,sendKey:keys[index],agent,message,encryptionKey});
  const step=async()=>{ await closeOpenRuns(service,{encryptionKey,conversation}); await startQueuedTurns(service,{encryptionKey,conversation}); };
  expect(await send(0,'Plan the launch week')).toEqual({conversation});
  expect(await send(1,'Add a teaser post')).toEqual({conversation,queued:true});
  expect(await send(2,'And a reminder')).toEqual({conversation,queued:true});
  // A retried send of a waiting turn is the same turn.
  expect(await send(1,'Add a teaser post')).toEqual({conversation,queued:true});
  // While the first run is still running nothing else starts, however often the worker and a reader look.
  for(let pass=0;pass<4;pass++) { await step(); await new Promise(resolve=>setTimeout(resolve,500)); }
  expect(fake.settings.runs.map(run=>run.input)).toEqual(['Plan the launch week']);
  // The first run ends: the waiting turns follow one at a time, each its own run, in the order they were sent.
  fake.settings.pendingReads=0;
  await expect.poll(async()=>{ await step(); return rows(conversation).length; },{timeout:30000}).toBe(6);
  expect(rows(conversation)).toEqual([
   {author:'person',person_id:omar,author_name:'عمر',body:'Plan the launch week'},{author:'agent',person_id:null,author_name:'Faye',body:'Reply to: Plan the launch week'},
   {author:'person',person_id:omar,author_name:'عمر',body:'Add a teaser post'},{author:'agent',person_id:null,author_name:'Faye',body:'Reply to: Add a teaser post'},
   {author:'person',person_id:omar,author_name:'عمر',body:'And a reminder'},{author:'agent',person_id:null,author_name:'Faye',body:'Reply to: And a reminder'},
  ]);
  expect(fake.settings.runs.map(run=>run.input)).toEqual(['Plan the launch week','Add a teaser post','And a reminder']);
  // Each turn carried its own sender's note as the run's instructions, never inside the message.
  expect(fake.settings.runs.every(run=>run.instructions?.includes('Answer in short points.'))).toBe(true);
 } finally { query(`delete from public.member_notes where company_id='${company}'`); detach(); await fake.close(); }
});

test('integration: stop is refused to another Contributor and works for a Manager',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); fake.settings.pendingReads=1e9;
 const {service,person}=await memberClient('omar@example.com'); const {agent,detach}=attachAgent();
 try {
  const conversation=randomUUID();
  expect(await sendMessage(person,service,{company,conversation,sendKey:randomUUID(),agent,message:'Write the long report',encryptionKey,engineFor:fake.engineFor})).toEqual({conversation});
  const other=(await memberClient('multi@example.com')).person;
  expect(await stopConversationRun(other,service,{company,conversation,encryptionKey,engineFor:fake.engineFor})).toMatchObject({code:'42501',message:'conversationStopNotAllowed'});
  expect(fake.runs[0].stopped).toBe(false);
  const lead=(await memberClient('manager@example.com')).person;
  expect(await stopConversationRun(lead,service,{company,conversation,encryptionKey,engineFor:fake.engineFor})).toEqual({stopped:true});
  expect(fake.runs[0].stopped).toBe(true);
  expect(await closeOpenRuns(service,{encryptionKey,conversation,engineFor:fake.engineFor})).toBe(1);
  expect(JSON.parse(query(`select outcome from public.conversation_usage where conversation_id='${conversation}'`))).toEqual([{outcome:'stopped'}]);
 } finally { detach(); }
});

test('integration: a message to a person starts no run on the fake engine; a message to the Agent does',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine();
 const {service,person}=await memberClient('omar@example.com'); const {agent,detach}=attachAgent();
 try {
  const conversation=randomUUID();
  expect(await sendMessage(person,service,{company,conversation,sendKey:randomUUID(),agent,message:'@مدير can you check the budget first?',encryptionKey,engineFor:fake.engineFor})).toEqual({conversation,addressed:true});
  expect(fake.runs).toHaveLength(0);
  expect(JSON.parse(query(`select person_id,addressed_to,author_name from public.conversation_notes where conversation_id='${conversation}'`))).toEqual([{person_id:omar,addressed_to:manager,author_name:'عمر'}]);
  expect(await sendMessage(person,service,{company,conversation,sendKey:randomUUID(),agent,message:'@Faye draft the budget post',encryptionKey,engineFor:fake.engineFor})).toEqual({conversation});
  expect(fake.runs.map(run=>run.input)).toEqual(['@Faye draft the budget post']);
 } finally { detach(); }
});

test('integration: a Member\'s note goes with their own runs only, nobody else reads it, and a secret is refused',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); fake.settings.pendingReads=1e9;
 const a=await memberClient('omar@example.com'); const b=await memberClient('multi@example.com'); const {agent,detach}=attachAgent();
 try {
  expect((await a.person.rpc('save_member_note',{c:company,note:'Answer in short points.'})).error).toBeNull();
  expect((await b.person.rpc('save_member_note',{c:company,note:'Write in Egyptian Arabic.'})).error).toBeNull();
  expect((await b.person.rpc('save_member_note',{c:company,note:'my api key: sk-abcdefghijklmnopqrstuvwx'})).error?.message).toBe('memberNoteSecret');
  expect((await b.person.rpc('save_member_note',{c:company,note:'x'.repeat(4001)})).error?.message).toBe('memberNoteTooLong');
  // Another Member reads no one else's note.
  expect((await b.person.from('member_notes').select('person_id,note')).data).toEqual([{person_id:contributor,note:'Write in Egyptian Arabic.'}]);
  const mine=randomUUID(); const theirs=randomUUID();
  expect(await sendMessage(a.person,a.service,{company,conversation:mine,sendKey:randomUUID(),agent,message:'Plan the week',encryptionKey,engineFor:fake.engineFor})).toEqual({conversation:mine});
  expect(await sendMessage(b.person,b.service,{company,conversation:theirs,sendKey:randomUUID(),agent,message:'Plan my week',encryptionKey,engineFor:fake.engineFor})).toEqual({conversation:theirs});
  const [runA,runB]=fake.runs;
  expect(runA.instructions).toContain('Answer in short points.');
  expect(runA.instructions).not.toContain('Egyptian Arabic');
  expect(runB.instructions).toContain('Write in Egyptian Arabic.');
  expect(runB.instructions).not.toContain('short points');
  // The note is never put into the message the Agent and the record keep.
  expect(rows(mine).filter((row:{author:string})=>row.author==='person').map((row:{body:string})=>row.body)).toEqual(['Plan the week']);
 } finally { query(`delete from public.member_notes where company_id='${company}'`); detach(); }
});

test('integration: a message is stored under the signed-in person whatever author the request names',async({page})=>{
 test.setTimeout(120000);
 const {agent,detach}=attachAgent();
 try {
  query(`update public.people set language='en' where id='${omar}'`);
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const conversation=randomUUID();
  // A message to a person needs no engine: the route stores it as it arrives, with every author field ignored.
  const sent=await page.request.post('/api/conversations',{data:{company,conversation,agent,sendKey:randomUUID(),message:'@مدير please check this',author:'agent',author_name:'Mallory',person:manager,person_id:manager}});
  expect(sent.status()).toBe(200);
  expect(await sent.json()).toEqual({conversation,addressed:true});
  expect(JSON.parse(query(`select person_id,author_name from public.conversation_notes where conversation_id='${conversation}'`))).toEqual([{person_id:omar,author_name:'عمر'}]);
  expect(JSON.parse(query(`select person_id from public.conversations where id='${conversation}'`))).toEqual([{person_id:omar}]);
  // The conversation page shows the note to its person, marked as addressed to that Member.
  await page.goto(`/c/rs-learning/conversations/${conversation}`);
  await expect(page.locator('.msg[data-kind=note] .bubble')).toHaveText('@مدير please check this');
  await expect(page.locator('[data-addressed]')).toHaveText('To مدير · the agent wasn’t asked');
 } finally { detach(); }
});

test('integration: a role lowered between two requests refuses the second one',async({page})=>{
 test.setTimeout(120000);
 try {
  // The guard reads the role from the database each time.
  const {person}=await memberClient('multi@example.com');
  expect(await routeAllowed(person,'app/api/conversations/route.ts','POST',company)).toBe(true);
  query(`update public.members set role='viewer' where company_id='${company}' and person_id='${contributor}'`);
  expect(await routeAllowed(person,'app/api/conversations/route.ts','POST',company)).toBe(false);
  query(`update public.members set role='contributor' where company_id='${company}' and person_id='${contributor}'`);
  // And so does the route itself, with the same browser session for both requests.
  await signIn(page,'multi@example.com','/c/rs-learning/home');
  const stop=()=>page.request.post('/api/conversations',{data:{company,conversation:randomUUID(),intent:'stop'}});
  const first=await stop();
  expect(first.status()).toBe(404);
  query(`update public.members set role='viewer' where company_id='${company}' and person_id='${contributor}'`);
  const second=await stop();
  expect(second.status()).toBe(403);
  expect(await second.json()).toEqual({error:'conversationNotAllowed'});
 } finally { query(`update public.members set role='contributor' where company_id='${company}' and person_id='${contributor}'`); }
});
