import { test, expect } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { closeOpenRuns, sendMessage } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// A conversation on the fake engine (tests/fake-engine.mjs): the engine contract with no subscription and no network,
// through the same send and close code the conversation route and the worker run, on the local database.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
function totp(secret:string) {
 const bits=[...secret.toUpperCase()].map(character=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character).toString(2).padStart(5,'0')).join('');
 const key=Buffer.from(bits.match(/.{8}/g)!.map(byte=>parseInt(byte,2)));
 const counter=Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac('sha1',key).update(counter).digest();
 return String((digest.readUInt32BE(digest[19]&15)&0x7fffffff)%1000000).padStart(6,'0');
}
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const encryptionKey=process.env.WEBHOOK_ENCRYPTION_KEY||'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

// Omar's own session, two-step verified (Agency access), as the conversation route receives it; and the service client
// the route and the worker use.
async function clients() {
 const value=status();
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const person=createClient(value('API_URL'),value('ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 query(`delete from auth.mfa_factors where user_id='${omar}'`);
 const {data:link,error:linked}=await service.auth.admin.generateLink({type:'magiclink',email:'omar@example.com'});
 expect(linked).toBeNull();
 expect((await person.auth.verifyOtp({type:'email',token_hash:link.properties!.hashed_token})).error).toBeNull();
 const {data:factor,error:enrolled}=await person.auth.mfa.enroll({factorType:'totp',friendlyName:`fake-engine-${randomUUID().slice(0,8)}`});
 expect(enrolled).toBeNull();
 expect((await person.auth.mfa.challengeAndVerify({factorId:factor!.id,code:totp(factor!.totp.secret)})).error).toBeNull();
 return {service,person};
}
// An agent whose Connection is never called: every run goes to the fake engine. Its address refuses connections, so
// the background worker (which drives Hermes) leaves these runs open for the fake engine to close.
function attachAgent() {
 const [connection,agent]=[randomUUID(),randomUUID()];
 query(`insert into public.hermes_connections(id,company_id,agency_owner_id,address,profile,key_encrypted,state,version,features) values ('${connection}','${company}','${omar}','http://127.0.0.1:9','fake-${connection.slice(0,8)}','${encryptSecret('fake-engine-key',encryptionKey)}','connected','0.23.0','{run_submission}')`);
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${agent}','${company}','${connection}','Faye','Marketing')`);
 return {connection,agent,detach:()=>{ query(`delete from public.hermes_agents where id='${agent}'`); query(`delete from public.hermes_connections where id='${connection}'`); }};
}
// A Member's own session, signed in with no two-step verification (so no Agency access).
async function memberClient(email:string) {
 const value=status();
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const person=createClient(value('API_URL'),value('ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:link,error:linked}=await service.auth.admin.generateLink({type:'magiclink',email});
 expect(linked).toBeNull();
 expect((await person.auth.verifyOtp({type:'email',token_hash:link.properties!.hashed_token})).error).toBeNull();
 return {service,person};
}
const agentRows=(conversation:string)=>JSON.parse(query(`select body from public.conversation_messages where conversation_id='${conversation}' and author='agent' order by id`));
const usageRows=(conversation:string)=>JSON.parse(query(`select outcome,input_tokens,output_tokens from public.conversation_usage where conversation_id='${conversation}' order by recorded_at,run_id`));

test('integration: a message on the fake engine gets its slow reply stored once, with its usage',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); fake.settings.pendingReads=1; fake.settings.usage={input:3200,output:41};
 const {service,person}=await clients(); const {agent,detach}=attachAgent();
 try {
  const conversation=randomUUID(); const sendKey=randomUUID();
  const message={person:omar,company,conversation,sendKey,agent,message:'Plan the launch week',encryptionKey,engineFor:fake.engineFor};
  expect(await sendMessage(person,service,message)).toEqual({conversation});
  // A retried send (double click, a lost answer) is the same message and the same run.
  expect(await sendMessage(person,service,message)).toEqual({conversation});
  expect(fake.runs.map(run=>({conversation:run.conversation,input:run.input}))).toEqual([{conversation,input:'Plan the launch week'}]);
  expect(fake.connections[0]).toMatchObject({address:'http://127.0.0.1:9',key:'fake-engine-key'});
  const close=()=>closeOpenRuns(service,{encryptionKey,conversation,engineFor:fake.engineFor});
  // The reply is slow: the first pass finds the run still running.
  expect(await close()).toBe(0);
  expect(agentRows(conversation)).toEqual([]);
  // Two passes at once (a reader and the worker) store the reply and its usage once.
  const closed=await Promise.all([close(),close()]);
  expect(closed[0]+closed[1]).toBe(1);
  expect(await close()).toBe(0);
  expect(agentRows(conversation)).toEqual([{body:'Reply to: Plan the launch week'}]);
  expect(usageRows(conversation)).toEqual([{outcome:'completed',input_tokens:3200,output_tokens:41}]);
 } finally { detach(); }
});

test('integration: on the fake engine a failed run and a stopped run end with their usage and no reply',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); fake.settings.pendingReads=1e9;
 const {service,person}=await clients(); const {agent,detach}=attachAgent();
 try {
  const conversation=randomUUID();
  const send=(message:string)=>sendMessage(person,service,{person:omar,company,conversation,sendKey:randomUUID(),agent,message,encryptionKey,engineFor:fake.engineFor});
  const close=()=>closeOpenRuns(service,{encryptionKey,conversation,engineFor:fake.engineFor});
  expect(await send('Stop this one')).toEqual({conversation});
  const engine=fake.engineFor({});
  expect(await engine.stop(fake.runs[0].id)).toBe(true);
  expect(await close()).toBe(1);
  fake.settings.pendingReads=0; fake.settings.ending='failed'; fake.settings.usage=null;
  expect(await send('This one fails')).toEqual({conversation});
  expect(await close()).toBe(1);
  expect(agentRows(conversation)).toEqual([]);
  expect(usageRows(conversation)).toEqual([{outcome:'stopped',input_tokens:14000,output_tokens:12},{outcome:'failed',input_tokens:null,output_tokens:null}]);
  // A run the engine cannot start is refused, and nothing is stored for it.
  fake.engineFor=()=>({...engine,start:async()=>null});
  expect(await send('Never started')).toEqual({error:'conversationHermesFailed',status:502});
  expect(JSON.parse(query(`select count(*)::int as n from public.conversation_messages where conversation_id='${conversation}'`))[0].n).toBe(2);
 } finally { detach(); }
});

// #287: a Contributor, with no Agency access, gets a reply on the fake engine through the company agent's Connection
// (an Agency owner's), and a Viewer is refused by the database before the engine is called.
test('integration: a Contributor gets a reply on the fake engine and a Viewer is refused',async()=>{
 test.setTimeout(120000);
 const fake=fakeEngine(); const {agent,detach}=attachAgent();
 const contributor='20000000-0000-0000-0000-000000000005';
 query(`update public.members set role='contributor' where company_id='${company}' and person_id='${contributor}'`);
 try {
  const {service,person}=await memberClient('multi@example.com');
  const conversation=randomUUID();
  expect(await sendMessage(person,service,{person:contributor,company,conversation,sendKey:randomUUID(),agent,message:'Draft the teaser',encryptionKey,engineFor:fake.engineFor})).toEqual({conversation});
  expect(fake.connections[0]).toMatchObject({address:'http://127.0.0.1:9',key:'fake-engine-key'});
  expect(await closeOpenRuns(service,{encryptionKey,conversation,owner:contributor,engineFor:fake.engineFor})).toBe(1);
  const {data:record}=await person.from('conversation_messages').select('author,body').eq('conversation_id',conversation).order('id');
  expect(record).toEqual([{author:'person',body:'Draft the teaser'},{author:'agent',body:'Reply to: Draft the teaser'}]);

  const viewer=(await memberClient('viewer@example.com')).person;
  expect(await sendMessage(viewer,service,{person:'20000000-0000-0000-0000-000000000004',company,conversation:randomUUID(),sendKey:randomUUID(),agent,message:'Hello',encryptionKey,engineFor:fake.engineFor})).toEqual({code:'42501'});
  expect(fake.runs).toHaveLength(1);
 } finally { query(`update public.members set role='reviewer' where company_id='${company}' and person_id='${contributor}'`); detach(); }
});
