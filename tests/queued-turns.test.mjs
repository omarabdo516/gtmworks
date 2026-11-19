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
  if(name==='pin_run') return {data:{tools:null},error:null};
  if(name==='pin_run_history') return {data:null,error:null};
  if(name==='pin_run_model') return {data:null,error:null};
  if(name==='begin_start') return {data:1,error:null};
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
