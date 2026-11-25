import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startQueuedTurns } from '../lib/conversation-runs.mjs';

// #68: a start that waits on a slow engine holds up no other Conversation's waiting turn, and the queue is read page by
// page behind a stable cursor so a page of ready Conversations never hides the next one.
const hermes={address:'http://127.0.0.1:9',key:'test-only-key'};
const connection='f9000000-0000-0000-0000-000000000001';

// The run layer's database, as startQueuedTurns reads it: a page of waiting Conversations, each with one claimable turn.
function databases({pages}) {
 const calls=[];
 const rpc=async(/** @type {string} */ name,/** @type {any} */ given)=>{
  if(name==='queued_conversations') { calls.push(given); return {data:pages(given),error:null}; }
  if(name==='claim_conversation_turn') {
   const conversation=given.conversation;
   return {data:[{company:'co',agent:'a',person:'p',send_key:`k-${conversation}`,message:`Message ${conversation}`,connection,profile:'writer',note:null,retry:false}],error:null};
  }
  if(name==='conversation_handover_agents') return {data:[],error:null};
  if(name==='pin_run') return {data:{tools:null},error:null};
  if(name==='pin_run_history') return {data:null,error:null};
  if(name==='pin_run_model') return {data:null,error:null};
  // #143: every queued turn asks for the main Agent's brief, which the database answers null for any other Agent.
  if(name==='pin_lead_brief') return {data:null,error:null};
  if(name==='begin_turn_start') return {data:1,error:null};
  if(name==='record_conversation_turn') return {data:true,error:null};
  if(['keep_unknown_start','fail_conversation_turn','refuse_run_model'].includes(name)) return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 };
 const chain=(/** @type {unknown} */ data)=>{ const c={select:()=>c,eq:()=>c,maybeSingle:async()=>({data,error:null})}; return c; };
 return {service:{rpc,from:()=>chain({instructions:null})},calls};
}

test('a slow engine start on one Conversation does not delay another Conversation\'s start', async () => {
 const {service}=databases({pages:()=>[{conversation:'c1'},{conversation:'c2'}]});
 let release=()=>{};
 const held=new Promise(resolve=>{ release=resolve; });
 let reached=()=>{};
 const firstStarted=new Promise(resolve=>{ reached=resolve; });
 const starts=[];
 const engineFor=()=>({start:async run=>{ starts.push(run.conversation); if(run.conversation==='c1') { reached(); await held; } return `run_${run.conversation}`; }});
 const pending=startQueuedTurns(service,{hermes,engineFor});
 await firstStarted;
 // One turn of the event loop: the second Conversation is claimed and its start sent while the first still waits.
 await new Promise(resolve=>setImmediate(resolve));
 const whileFirstWaits=[...starts];
 release();
 assert.equal(await pending,2);
 assert.deepEqual(whileFirstWaits.sort(),['c1','c2'],'both starts were sent before the slow one answered');
});

test('queued turns page through every waiting Conversation behind a stable cursor', async () => {
 const all=Array.from({length:501},(_,index)=>`c${String(index).padStart(3,'0')}`);
 const {service,calls}=databases({pages:({after})=>{
  const from=after===null||after===undefined?0:all.indexOf(after)+1;
  return all.slice(from,from+500).map(conversation=>({conversation}));
 }});
 const started=[];
 const engineFor=()=>({start:async run=>{ started.push(run.conversation); return `run_${run.conversation}`; }});
 assert.equal(await startQueuedTurns(service,{hermes,engineFor}),501);
 assert.equal(started.length,501);
 assert.deepEqual(calls.map(call=>call.after),[null,all[499]],'the next page starts after the last Conversation of the first');
});

// #514: a queued turn's start that never reached its Engine (nothing could connect: the Engine is not running) is no
// attempt. Its attempt is handed back (release_queued_start), so the turn stays due as never started and its model is
// not refused; its next start is a first attempt again, which a refusal then fails. A start that may have reached the
// Engine keeps its attempt and is retried with the same key. The database half is supabase/tests/unreached_queued_starts.sql.
const notReached=Object.freeze({state:'notReached'});
function counted({model=null}={}) {
 const state={attempts:0,released:/** @type {any[]} */([]),failed:/** @type {[string,any][]} */([]),kept:0};
 const rpc=async(/** @type {string} */ name,/** @type {any} */ given)=>{
  if(name==='queued_conversations') return {data:given.after?[]:[{conversation:'c1'}],error:null};
  if(name==='claim_conversation_turn') return {data:[{company:'co',agent:'a',person:'p',send_key:'k-c1',message:'Hello',connection,profile:'writer',note:null,retry:state.attempts>0}],error:null};
  if(name==='pin_run') return {data:{tools:null},error:null};
  if(name==='pin_run_history') return {data:null,error:null};
  if(name==='pin_run_model') return {data:model,error:null};
  if(name==='pin_lead_brief') return {data:null,error:null};
  if(name==='conversation_handover_agents') return {data:[],error:null};
  if(name==='begin_turn_start') return {data:++state.attempts,error:null};
  if(name==='release_queued_start') { state.released.push(given); if(given.attempt===state.attempts) { state.attempts--; return {data:true,error:null}; } return {data:false,error:null}; }
  if(name==='keep_unknown_start') { state.kept++; return {data:true,error:null}; }
  if(name==='fail_conversation_turn'||name==='refuse_run_model') { state.failed.push([name,given]); return {data:true,error:null}; }
  if(name==='record_conversation_turn') return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 };
 const chain=(/** @type {unknown} */ data)=>{ const c={select:()=>c,eq:()=>c,maybeSingle:async()=>({data,error:null})}; return c; };
 return {state,service:{rpc,from:()=>chain({instructions:null})}};
}

for(const model of [null,{provider:'openrouter',model:'openai/gpt-5.5'}]) {
 const refusal=model?'refuse_run_model':'fail_conversation_turn';
 test(`a stopped Engine leaves a queued turn${model?' sent with a model':''} due, and its next start is a first attempt a refusal fails`, async () => {
  const {state,service}=counted({model}); const starts=[]; let answer=/** @type {any} */(notReached);
  const engineFor=()=>({start:async run=>{ starts.push(run); return answer; }});
  assert.equal(await startQueuedTurns(service,{hermes,engineFor:/** @type {any} */(engineFor)}),0,'nothing connected to the Engine');
  assert.deepEqual(state.released,[{conversation:'c1',message_key:'k-c1',attempt:1}],'so its attempt is handed back');
  assert.deepEqual(state.failed,[],`and the turn is not failed${model?', nor its model refused':''}`);
  assert.equal(state.kept,0,'nor kept as unknown');
  answer=null;
  assert.equal(await startQueuedTurns(service,{hermes,engineFor:/** @type {any} */(engineFor)}),0,'the Engine runs again and refuses the start');
  assert.deepEqual(starts.map(start=>[start.idempotencyKey,start.retry]),[['c1:k-c1',false],['c1:k-c1',false]],'both are sent as a first attempt');
  assert.deepEqual(state.failed,[[refusal,{conversation:'c1',message_key:'k-c1',attempt:1}]],'so the refusal fails the turn for its first attempt');
  assert.equal(state.released.length,1,'a refusal reached the Engine and is not handed back');
 });
}

test('a queued start that may have reached the Engine keeps its attempt and is retried with the same key', async () => {
 const {state,service}=counted(); const starts=[]; let answer=/** @type {any} */({state:'unknown'});
 const engineFor=()=>({start:async run=>{ starts.push(run); return answer; }});
 await startQueuedTurns(service,{hermes,engineFor:/** @type {any} */(engineFor)});
 assert.deepEqual(state.released,[],'an unknown outcome is never handed back');
 assert.equal(state.kept,1,'it is kept as unknown');
 answer='run-1';
 assert.equal(await startQueuedTurns(service,{hermes,engineFor:/** @type {any} */(engineFor)}),1);
 assert.deepEqual(starts.map(start=>[start.idempotencyKey,start.retry]),[['c1:k-c1',false],['c1:k-c1',true]],'the second is the same request, as a retry');
 assert.deepEqual(state.failed,[]);
});

// #514 (review): a turn claimed as a retry while another caller's first attempt was in flight, and handed back before
// this caller began, is a first attempt again: the attempt begin_turn_start answers decides, not the claim's flag, so an
// Engine that is still down is handed back here too instead of read as an unknown start that waits a day.
test('a turn claimed as a retry whose earlier attempt was handed back is sent, and handed back, as a first attempt', async () => {
 const {state,service}=counted(); const starts=[];
 const claimed=service.rpc;
 service.rpc=async(name,given)=>name==='claim_conversation_turn'?{data:[{company:'co',agent:'a',person:'p',send_key:'k-c1',message:'Hello',connection,profile:'writer',note:null,retry:true}],error:null}:claimed(name,given);
 const engineFor=()=>({start:async run=>{ starts.push(run); return run.retry?{state:'unknown'}:notReached; }});
 assert.equal(await startQueuedTurns(service,{hermes,engineFor:/** @type {any} */(engineFor)}),0);
 assert.deepEqual(starts.map(start=>start.retry),[false],'begin_turn_start answered attempt 1, so it is no retry');
 assert.deepEqual(state.released,[{conversation:'c1',message_key:'k-c1',attempt:1}],'and the unreached start is handed back');
 assert.equal(state.kept,0,'never kept as unknown');
});
