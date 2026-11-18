import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { driveChannelRuns } from '../lib/channel-runs.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// An Agent on its own profile (ADR 0016) has its instructions as the profile's soul, so its Runs start on that profile
// with the sender's note only (the team's rules are in the soul too, #345), and a retry sends the same body: the fake
// Engine server, as the pinned release, refuses another body under the same idempotency key. No Run is told the Company
// knowledge (#344): the profile auto-loads it as the shared Skill company-knowledge, so this database pins none.
const encryptionKey=Buffer.alloc(32,5).toString('base64');
const own='ag-a0000000000000000000000000000001';
const lead='co-10000000000000000000000000000001';
const role='You are the SEO content writer on RS Learning\'s marketing team.';
const rule='Answer every comment within the day';
const note='Answer in short points.';
const company='10000000-0000-0000-0000-000000000001';

// The database as the three start paths see it: the run's pinned Connection, its pinned parts, and the attempts begun.
function databases(fake,{profile,owner=company}) {
 const attempts=new Map();
 const attempt=key=>{ attempts.set(key,(attempts.get(key)??0)+1); return attempts.get(key); };
 const rpc=async(/** @type {string} */ name,/** @type {any} */ given)=>{
  if(name==='conversation_agent') return {data:null,error:null};
  if(name==='reserve_conversation_turn') return {data:{state:'reserved',connection:'f9000000-0000-0000-0000-000000000001',note},error:null};
  if(name==='queued_conversations') return {data:[{conversation:'c'}],error:null};
  if(name==='claim_conversation_turn') return {data:[{company,agent:'a',person:'p',send_key:'q',message:'Draft the offer email',connection:'f9000000-0000-0000-0000-000000000001',note,retry:false}],error:null};
  if(name==='pin_run') return {data:{tools:null,rules:[rule]},error:null};
  if(name==='pin_run_history') return {data:null,error:null};
  if(name==='pin_run_model') return {data:null,error:null};
  if(name==='begin_start') return {data:attempt(given.message_key),error:null};
  if(name==='channel_runs_due') return {data:[{message:7,run:null}],error:null};
  if(name==='begin_channel_start') return {data:[{attempt:attempt('channel'),company,connection:'f9000000-0000-0000-0000-000000000001',session:'s',input:'Omar: draft the offer email',instructions:role,rules:[rule]}],error:null};
  if(['send_conversation_message','record_conversation_turn','keep_unknown_start','answer_channel_start'].includes(name)) return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}}; };
 const chain=(/** @type {unknown} */ data)=>{ const c={select:()=>c,eq:()=>c,maybeSingle:async()=>({data,error:null})}; return c; };
 const connection={company_id:owner,address:fake.address,profile,state:'connected',features:['run_submission'],key_encrypted:encryptSecret(fake.settings.key,encryptionKey)};
 const db={rpc,from:(/** @type {string} */ table)=>chain(table==='conversation_messages'?null:{id:'a9000000-0000-0000-0000-000000000001',instructions:role})};
 const service={rpc,from:(/** @type {string} */ table)=>chain(table==='hermes_agents'?{instructions:role}:connection)};
 return {db,service};
}
async function engineServer(profile) {
 const fake=await fakeHermes();
 fake.settings.profiles.set(profile,{soul:role,provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 return fake;
}
const send=({db,service})=>sendMessage(db,service,{company,conversation:'c',sendKey:'k',message:'Draft the offer email',encryptionKey});
const starts=fake=>fake.settings.requests.filter(request=>request.method==='POST');

test('a message to an Agent on its own profile starts there without its instructions, and its retry sends the same body',async()=>{
 const fake=await engineServer(own);
 try {
  const databasesOf=databases(fake,{profile:own});
  // Both attempts of the first start lose their answer, so the start is kept as unknown and asked again later.
  fake.settings.loseStarts=2;
  assert.deepEqual(await send(databasesOf),{conversation:'c',queued:true});
  assert.deepEqual(await send(databasesOf),{conversation:'c'});
  assert.deepEqual(starts(fake).map(request=>request.path),[`/p/${own}/v1/runs`,`/p/${own}/v1/runs`,`/p/${own}/v1/runs`]);
  assert.equal(new Set(starts(fake).map(request=>request.idempotency)).size,1);
  assert.equal(fake.settings.runs.length,1,'the retry was the same run, so it sent the same body');
  const sent=fake.settings.runs[0].instructions;
  assert.ok(sent.includes(note),sent);
  assert.ok(!sent.includes(rule),'the team\'s rules are in the profile\'s SOUL.md');
  assert.ok(!sent.includes('Brand voice')&&!sent.includes('knowledge'),'no Company knowledge');
  assert.ok(!sent.includes(role),'the profile\'s soul holds the Agent\'s instructions');
 } finally { await fake.close(); }
});

test('a waiting turn of an Agent on its own profile starts there the same way, and so does its retry',async()=>{
 const fake=await engineServer(own);
 try {
  const {service}=databases(fake,{profile:own});
  fake.settings.loseStarts=2;
  assert.equal(await startQueuedTurns(service,{encryptionKey}),0);
  assert.equal(await startQueuedTurns(service,{encryptionKey}),1);
  assert.deepEqual(starts(fake).map(request=>request.path),[`/p/${own}/v1/runs`,`/p/${own}/v1/runs`,`/p/${own}/v1/runs`]);
  assert.equal(fake.settings.runs.length,1);
  const sent=fake.settings.runs[0].instructions;
  assert.ok(sent.includes(note),sent);
  assert.ok(!sent.includes(rule),'the team\'s rules are in the profile\'s SOUL.md');
  assert.ok(!sent.includes('Brand voice')&&!sent.includes('knowledge'),'no Company knowledge');
  assert.ok(!sent.includes(role));
 } finally { await fake.close(); }
});

test('a channel Run of an Agent on its own profile starts there without its instructions, and so does its retry',async()=>{
 const fake=await engineServer(own);
 try {
  const {service}=databases(fake,{profile:own});
  fake.settings.loseStarts=2;
  assert.deepEqual(await driveChannelRuns(service,{encryptionKey}),{started:0,closed:0});
  assert.deepEqual(await driveChannelRuns(service,{encryptionKey}),{started:1,closed:0});
  assert.deepEqual(starts(fake).map(request=>request.path),[`/p/${own}/v1/runs`,`/p/${own}/v1/runs`,`/p/${own}/v1/runs`]);
  assert.equal(fake.settings.runs.length,1);
  const sent=fake.settings.runs[0].instructions;
  assert.ok(!sent?.includes(rule),'the team\'s rules are in the profile\'s SOUL.md');
  assert.ok(!sent?.includes('Brand voice')&&!sent?.includes('knowledge'),'no Company knowledge');
  assert.ok(!sent?.includes(role));
 } finally { await fake.close(); }
});

test('an Agent on Lead\'s profile still has its instructions first in every Run',async()=>{
 const fake=await engineServer(lead);
 try {
  const databasesOf=databases(fake,{profile:lead});
  assert.deepEqual(await send(databasesOf),{conversation:'c'});
  await driveChannelRuns(databasesOf.service,{encryptionKey});
  assert.deepEqual(starts(fake).map(request=>request.path),[`/p/${lead}/v1/runs`,`/p/${lead}/v1/runs`]);
  for(const run of fake.settings.runs) assert.ok(run.instructions.startsWith(role),run.instructions);
 } finally { await fake.close(); }
});

test('no Run starts on an Agent profile whose Connection is another Company\'s',async()=>{
 const fake=await engineServer(own);
 try {
  assert.deepEqual(await send(databases(fake,{profile:own,owner:'10000000-0000-0000-0000-000000000002'})),{error:'conversationNotFound',status:404});
  assert.deepEqual(starts(fake),[]);
 } finally { await fake.close(); }
});
