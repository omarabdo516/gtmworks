import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRun, startUnknown } from '../lib/hermes.mjs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';

// A start whose outcome was once unknown stays unknown until Hermes names the run (ADR 0015): no later answer can prove
// it never started, so its reservation is never released or failed, and the worker asks again until Hermes says which.
const encryptionKey=Buffer.alloc(32,7).toString('base64');
const failing=code=>Object.assign(new TypeError('fetch failed'),{cause:{code}});

test('a retry of an unknown start is never read as not started', async () => {
 const real=globalThis.fetch;
 const start={address:'http://127.0.0.1:8642',profile:'writer',key:'test-only-key',input:'Hello',sessionKey:'s',idempotencyKey:'k',retry:true};
 const answers=list=>{ const queue=[...list]; globalThis.fetch=async()=>{ const next=queue.shift(); if(next instanceof Error) throw next; return new Response(JSON.stringify(typeof next==='string'?{run_id:next}:{error:{message:'x'}}),{status:typeof next==='string'?202:next}); }; };
 try {
  answers([failing('ECONNREFUSED')]); assert.equal(await startRun(start),startUnknown,'nothing connected');
  for(const status of [400,401,409,429,500]) { answers([status]); assert.equal(await startRun(start),startUnknown,String(status)); }
  answers(['run_7']); assert.equal(await startRun(start),'run_7','Hermes names the run');
  assert.equal(await startRun({...start,address:'http://203.0.113.9:8642'}),startUnknown,'an address no longer allowed');
  // The first start of a key can still be refused.
  answers([409]); assert.equal(await startRun({...start,retry:false}),null);
 } finally { globalThis.fetch=real; }
});

const connection='f9000000-0000-0000-0000-000000000001';
function databases({reserve={state:'reserved',connection,note:null},claim=[],usable=true}={}) {
 const order=[]; const args={};
 const rpc=who=>async(name,given)=>{ order.push(`${who} ${name}`); args[name]=given;
  if(name==='conversation_agent') return {data:null,error:null};
  if(name==='reserve_conversation_turn') return {data:reserve,error:null};
  if(name==='queued_conversations') return {data:[{conversation:'c'}],error:null};
  if(name==='claim_conversation_turn') return {data:claim,error:null};
  if(['begin_start','keep_unknown_start','fail_conversation_turn','release_conversation_run','record_conversation_turn','send_conversation_message'].includes(name)) return {data:true,error:null};
  return {data:null,error:{message:'unexpected'}}; };
 const chain=data=>{ const c={select:()=>c,eq:()=>c,maybeSingle:async()=>({data,error:null})}; return c; };
 const key=encryptSecret('test-only-key',encryptionKey);
 const db={rpc:rpc('person'),from:()=>chain({id:'a9000000-0000-0000-0000-000000000001'})};
 const service={rpc:rpc('service'),from:()=>chain({address:'http://hermes:8642',profile:'writer',state:usable?'connected':'unreachable',features:['run_submission'],key_encrypted:key})};
 return {db,service,order,args};
}
const engine=(order,outcome)=>({engineFor:()=>({start:async run=>{ order.push(`start retry=${run.retry===true}`); return outcome; }})});

test('a direct send whose start is unknown is kept as its sender\'s turn for the worker to ask again', async () => {
 const {db,service,order,args}=databases();
 const sent=await sendMessage(db,service,{company:'co',conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...engine(order,startUnknown)});
 assert.deepEqual(sent,{conversation:'c',queued:true});
 assert.deepEqual(args.keep_unknown_start,{conversation:'c',message_key:'k'});
 assert.ok(order.includes('start retry=false'));
 // The attempt is recorded before Hermes is called, so a crash between the two never loses the run.
 assert.ok(order.indexOf('service begin_start')>=0&&order.indexOf('service begin_start')<order.indexOf('start retry=false'));
 assert.deepEqual(args.begin_start,{conversation:'c',message_key:'k'});
 assert.ok(!order.some(step=>step.endsWith('release_conversation_run')),'the reservation is never released');
});

test('the worker asks again on a turn whose start was unknown, and never fails it', async () => {
 const turn={company:'co',agent:'a',person:'p',send_key:'k',message:'Hi',connection,note:null};
 // A first start that is unknown is marked, so every later answer is read as unknown too.
 const first=databases({claim:[{...turn,retry:false}]});
 await startQueuedTurns(first.service,{encryptionKey,...engine(first.order,startUnknown)});
 assert.deepEqual(first.args.keep_unknown_start,{conversation:'c',message_key:'k'});
 assert.ok(first.order.indexOf('service begin_start')>=0&&first.order.indexOf('service begin_start')<first.order.indexOf('start retry=false'),'the attempt is recorded first');
 assert.ok(!first.order.includes('service fail_conversation_turn'));
 // Its retry is sent as a retry; a refusal then is not a proof, so the turn stays.
 const again=databases({claim:[{...turn,retry:true}]});
 await startQueuedTurns(again.service,{encryptionKey,...engine(again.order,null)});
 assert.ok(again.order.includes('start retry=true'));
 assert.ok(!again.order.includes('service fail_conversation_turn'));
 // Nor does a Connection that cannot be used now: the turn waits for it.
 const unusable=databases({claim:[{...turn,retry:true}],usable:false});
 await startQueuedTurns(unusable.service,{encryptionKey,...engine(unusable.order,'run_1')});
 assert.ok(!unusable.order.some(step=>step.startsWith('start')));
 assert.ok(!unusable.order.includes('service fail_conversation_turn'));
 // A first start that is refused still fails its turn, so the next one can go.
 const refused=databases({claim:[{...turn,retry:false}]});
 await startQueuedTurns(refused.service,{encryptionKey,...engine(refused.order,null)});
 assert.ok(refused.order.includes('service fail_conversation_turn'));
});
