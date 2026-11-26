import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNoEngine, engineServing } from './engine-records.mjs';
import { readCompanySignIns } from '../lib/company-sign-in.mjs';
import { sendMessage } from '../lib/conversation-runs.mjs';
import { readWorkSandbox } from '../lib/engine/files.mjs';

// A Company whose Engine is not running (#387): its Settings read one plain state (noEngine), and a message is kept as
// "not sent" (#764) without starting or recording a Run. A later send on the same install works
// once the Engine answers again, since every call asks for the Company's Engine anew.
const company='10000000-0000-0000-0000-000000000002';
const profile=`co-${company.replaceAll('-','')}`;
const connection='f9000000-0000-0000-0000-000000000001';
const hermesOf=fake=>({address:fake.address,managementAddress:fake.managementAddress,key:'test-only-key'});

// The signed-in person's session and the service role, as the sign-in read and a send ask them: the send stores its
// turn (#764), and the starter claims it, pins its Run and starts it, or fails it when the Engine refuses or is none.
function databases() {
 const calls=[]; const queued=new Map();
 const rpc=async(name,args)=>{ calls.push({name,args});
  if(name==='company_engine_target') return {data:[{profile,profiles:[profile]}],error:null};
  if(name==='conversation_agent') return {data:null,error:null};
  if(name==='queue_conversation_turn') { queued.set(args.message_key,{key:args.message_key,message:args.message,started_at:null,failed_at:null,model_refused:false}); return {data:{state:'queued'},error:null}; }
  const waiting=[...queued.values()].find(turn=>!turn.started_at&&!turn.failed_at);
  if(name==='queued_conversations') return {data:waiting?[{conversation:'c'}]:[],error:null};
  if(name==='claim_conversation_turn') return {data:waiting?[{company,agent:'a9000000-0000-0000-0000-000000000001',person:'p',send_key:waiting.key,message:waiting.message,connection,profile,note:null,retry:false,has_files:false}]:[],error:null};
  if(name==='conversation_handover_agents') return {data:[],error:null};
  if(name==='pin_run') return {data:{tools:null},error:null};
  if(name==='pin_run_history') return {data:null,error:null};
  if(name==='pin_run_model') return {data:null,error:null};
  if(name==='pin_run_brief') return {data:null,error:null};
  if(name==='begin_turn_start') return {data:1,error:null};
  if(name==='fail_conversation_turn') { queued.get(args.message_key).failed_at='now'; return {data:null,error:null}; }
  if(name==='record_conversation_turn') { queued.get(args.message_key).started_at='now'; return {data:true,error:null}; }
  return {data:null,error:{message:'unexpected'}};
 };
 let wanted=null;
 const chain=table=>{ const read={select:()=>read,eq:(column,value)=>{ if(column==='send_key') wanted=value; return read; },maybeSingle:async()=>({data:table==='hermes_agents'?{id:'a9000000-0000-0000-0000-000000000001',instructions:null}:table==='conversation_queued_turns'?queued.get(wanted)??null:null,error:null})}; return read; };
 return {db:{rpc,from:chain},service:{rpc,from:chain},calls};
}

test('an Engine that does not answer reads as noEngine, and a message to it stays, not sent, without a Run', async () => {
 const fake=await engineServing(company);
 const {db,service,calls}=databases();
 try {
  // Both the record's address (engineOf answered null) and an Engine that does not answer are the same one state.
  assert.deepEqual(await withNoEngine(company,()=>readCompanySignIns(db,{company})),{profile:null,profiles:null,signIns:null,noEngine:true});
  fake.settings.managementStatus=500;
  assert.deepEqual(await readCompanySignIns(db,{company}),{profile:null,profiles:null,signIns:null,noEngine:true});

  fake.settings.status=500;
  const refused=await sendMessage(db,service,{company,conversation:'c',sendKey:'k-1',message:'Are you there?'});
  assert.deepEqual(refused,{error:'conversationHermesFailed',status:502});
  // The message was stored first (#764) and its turn failed: it stays as "not sent", and no Run is recorded.
  assert.ok(calls.findIndex(call=>call.name==='queue_conversation_turn')<calls.findIndex(call=>call.name==='begin_turn_start'));
  assert.deepEqual(calls.filter(call=>call.name==='fail_conversation_turn').map(call=>call.args.message_key),['k-1']);
  assert.equal(calls.some(call=>call.name==='record_conversation_turn'),false);
  assert.equal(fake.settings.runs.length,0);

  // When the Engine answers again the next send starts its Run, with no reload and nothing else changed.
  fake.settings.status=200;
  assert.deepEqual(await sendMessage(db,service,{company,conversation:'c',sendKey:'k-2',message:'Are you there now?'}),{conversation:'c'});
  assert.equal(fake.settings.runs.length,1);
  assert.equal(calls.filter(call=>call.name==='record_conversation_turn').length,1);
 } finally { await fake.close(); }
});

test('a Company with no Engine at all keeps the message, not sent, the same way, and keeps the Agent for the next one', async () => {
 const fake=await engineServing(company);
 const {db,service,calls}=databases();
 try {
  assert.deepEqual(await withNoEngine(company,()=>sendMessage(db,service,{company,conversation:'c',sendKey:'k-3',message:'Hello'})),{error:'conversationHermesFailed',status:502});
  assert.equal(calls.some(call=>call.name==='queue_conversation_turn'),true,'the message is stored');
  assert.equal(calls.some(call=>call.name==='record_conversation_turn'),false);
  assert.equal(fake.settings.runs.length,0);
 } finally { await fake.close(); }
});

// #398: the Company's work sandbox is a second container its Engine reaches over ssh. One read of the Engine's own ssh
// workspace names whether it is there, and it answers the same way again once the container runs again, with no restart.
test('a work sandbox that is not running reads as one state, and reads as running again once it answers', async () => {
 const fake=await engineServing(company);
 try {
  fake.settings.sandboxDown=true;
  assert.deepEqual(await readWorkSandbox(hermesOf(fake)),{state:'notRunning'});
  fake.settings.sandboxDown=false;
  assert.deepEqual(await readWorkSandbox(hermesOf(fake)),{state:'running'});
  // The Engine itself not answering is that other state, never "the sandbox is not running".
  fake.settings.managementStatus=500;
  assert.deepEqual(await readWorkSandbox(hermesOf(fake)),{state:'unreachable'});
  assert.deepEqual(await readWorkSandbox(null),{state:'unreachable'});
 } finally { await fake.close(); }
});
