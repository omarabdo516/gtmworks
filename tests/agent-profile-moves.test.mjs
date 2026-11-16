import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// The first Run of the Conversation of an Agent that moved to its own profile (#121, ADR 0016) carries gtmworks's record
// of it as the Run's history.
const encryptionKey=Buffer.alloc(32,6).toString('base64');
const company='10000000-0000-0000-0000-000000000001';
const writer='a0000000-0000-0000-0000-000000000001';
const own=agent=>`ag-${agent.replaceAll('-','')}`;

// The run paths as a moved Agent's Conversation sees them: its pinned Connection to the Agent's own profile, and the
// history pin_run_history pinned for the send key (none for the others).
const record=[{role:'user',content:'Write the first post'},{role:'assistant',content:'Here it is.'}];
function runDatabases(fake,{history}) {
 const attempts=new Map();
 const rpc=async(/** @type {string} */ name,/** @type {any} */ given)=>{
  if(name==='conversation_agent') return {data:null,error:null};
  if(name==='reserve_conversation_turn') return {data:{state:'reserved',connection:'f9000000-0000-0000-0000-000000000001',note:null},error:null};
  if(name==='queued_conversations') return {data:[{conversation:'c'}],error:null};
  if(name==='claim_conversation_turn') return {data:[{company,agent:writer,person:'p',send_key:'q',message:'Next draft',connection:'f9000000-0000-0000-0000-000000000001',note:null,retry:false}],error:null};
  if(name==='pin_run') return {data:{tools:null,rules:[]},error:null};
  if(name==='pin_run_knowledge') return {data:[],error:null};
  if(name==='pin_run_history') return {data:history,error:null};
  if(name==='begin_start') { attempts.set(given.message_key,(attempts.get(given.message_key)??0)+1); return {data:attempts.get(given.message_key),error:null}; }
  if(['send_conversation_message','record_conversation_turn','keep_unknown_start'].includes(name)) return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}}; };
 const chain=(/** @type {unknown} */ data)=>{ const c={select:()=>c,eq:()=>c,maybeSingle:async()=>({data,error:null})}; return c; };
 const connection={company_id:company,address:fake.address,profile:own(writer),state:'connected',features:['run_submission'],key_encrypted:encryptSecret(fake.settings.key,encryptionKey)};
 const db={rpc,from:(/** @type {string} */ table)=>chain(table==='conversation_messages'?null:{id:writer,instructions:null})};
 const service={rpc,from:(/** @type {string} */ table)=>chain(table==='hermes_agents'?{instructions:null}:connection)};
 return {db,service};
}

test('the first Run of a moved Agent\'s Conversation carries its record as the Run\'s history, sent now or waiting, and its retry the same body',async()=>{
 const fake=await fakeHermes();
 try {
  const {db,service}=runDatabases(fake,{history:record});
  fake.settings.loseStarts=2;
  const send=()=>sendMessage(db,service,{company,conversation:'c',sendKey:'k',message:'Next draft',encryptionKey});
  assert.deepEqual(await send(),{conversation:'c',queued:true});
  assert.deepEqual(await send(),{conversation:'c'});
  assert.equal(fake.settings.runs.length,1,'the retry sent the same body, so it was the same run');
  assert.deepEqual(fake.settings.runs[0].history,record);
  assert.deepEqual(fake.settings.requests.filter(request=>request.method==='POST').map(request=>request.path),Array(3).fill(`/p/${own(writer)}/v1/runs`));
  assert.equal(await startQueuedTurns(service,{encryptionKey}),1);
  assert.deepEqual(fake.settings.runs[1].history,record);
 } finally { await fake.close(); }
});

test('a Run with no history pinned sends the body it sent before',async()=>{
 const fake=await fakeHermes();
 try {
  const {db,service}=runDatabases(fake,{history:null});
  assert.deepEqual(await sendMessage(db,service,{company,conversation:'c',sendKey:'k',message:'Next draft',encryptionKey}),{conversation:'c'});
  assert.deepEqual(JSON.parse(/** @type {string} */(fake.settings.runs[0].body)),{input:'Next draft'});
 } finally { await fake.close(); }
});
