import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord, engineServing } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { closeOpenRuns } from '../lib/conversation-runs.mjs';

// #457: how an ended Run is recorded. A model error a retry cannot fix keeps its own outcome, and a Run the Engine read
// as interrupted (stopped) or no longer knew (lost) closes still, so the chat never stays on "working" after a restart.
const hermes={address:'http://hermes:8642',key:'test-only-key'};
// Each Company's Engine record, as the database holds it; the fake of the contract answers for the Engine.
for(const company of ['co',]) engineRecord(company,hermes);
const conversation='c4570000-0000-0000-0000-000000000001';
const open={message:1,conversation,run:'run-1',person:'p',company:'co',connection:'f9000000-0000-0000-0000-000000000001',address:'http://hermes:8642',profile:'writer',state:'connected'};

function databases() {
 const closed=/** @type {Map<string,string>} */(new Map());
 const db={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  if(name==='open_conversation_runs') return {data:closed.size?[]:[open],error:null};
  if(name==='track_run_question'||name==='track_run_permission') return {data:[],error:null};
  if(name==='close_conversation_run') { closed.set(args.run,args.run_outcome); return {data:true,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 return {db,closed};
}
/** @param {{state:string,noModel?:true,modelRefused?:'credit'|'key'|'model'}} state */
async function outcomeOfRead(state) {
 const {db,closed}=databases();
 const engine={read:async()=>({reply:null,session:null,usage:null,toolCalls:[],...state})};
 assert.equal(await withEngineContract(()=>engine,()=>closeOpenRuns(db,{conversation})),1);
 return closed.get('run-1');
}

test('a model error a retry cannot fix ends the Run with its own outcome, and an interrupted or forgotten Run still closes',async()=>{
 assert.equal(await outcomeOfRead({state:'failed',noModel:true}),'no_model');
 assert.equal(await outcomeOfRead({state:'failed',noModel:true,modelRefused:'credit'}),'no_model','no model provider is the cause kept first');
 for(const [reason,outcome] of [['credit','no_credit'],['key','key_refused'],['model','model_missing']]) assert.equal(await outcomeOfRead({state:'failed',modelRefused:reason}),outcome);
 assert.equal(await outcomeOfRead({state:'failed'}),'failed');
 assert.equal(await outcomeOfRead({state:'stopped'}),'stopped');
 assert.equal(await outcomeOfRead({state:'lost'}),'lost');
});

// #642, #731: a Run whose every account ran out closes with when its usage resets, when the Engine named it, and the
// accounts the Engine's pool found exhausted, beside the Agent's own provider, in the same call that closes it; with
// neither, it closes as a no-access Run with nothing more kept. Only an ended no-access Run reads the pool.
test('a Run that ran out of usage closes with when its usage resets and the accounts that ran out, in the same call',async()=>{
 const calls=/** @type {{name:string,args:any}[]} */([]);
 const db={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  calls.push({name,args});
  if(name==='open_conversation_runs') return {data:calls.some(call=>call.name.startsWith('close_'))?[]:[open],error:null};
  if(name==='track_run_question'||name==='track_run_permission') return {data:[],error:null};
  if(name==='close_conversation_run_ran_out'||name==='close_conversation_run') return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 const resetsAt='2027-05-01T19:24:00.000Z';
 // The Run's Engine on the wire: its root pool has two ChatGPT accounts marked exhausted, and the Agent runs on ChatGPT.
 const fake=await engineServing('co');
 const exhausted=(/** @type {string} */ id,priority=0)=>({id,label:id,auth_type:/** @type {const} */('oauth'),source:'manual:device_code',priority,access_token:`token-${id}`,last_status:'exhausted'});
 fake.settings.defaultPool['openai-codex']=[exhausted('c0dex1'),exhausted('c0dex2',1)];
 fake.settings.profiles.set('writer',{soul:'',provider:'openai-codex',model:'gpt-5.5',key:fake.settings.key,config:{},credentials:{}});
 const poolReads=()=>fake.settings.managed.filter(request=>request.path?.startsWith('/api/credentials/pool')).length;
 try {
  const accounts=[{provider:'openai-codex',account:'c0dex1',place:1},{provider:'openai-codex',account:'c0dex2',place:2}];
  const engine={read:async()=>({state:'failed',reply:null,session:'s-1',usage:null,toolCalls:[],modelRefused:'access',resetsAt})};
  assert.equal(await withEngineContract(()=>engine,()=>closeOpenRuns(db,{conversation})),1);
  assert.deepEqual(calls.filter(call=>call.name.startsWith('close_')),[{name:'close_conversation_run_ran_out',
   args:{conversation,run:'run-1',hermes_session:'s-1',read_completed:false,usage_resets_at:resetsAt,own_provider:'openai-codex',ran_out:accounts}}]);
  assert.equal(poolReads(),1,'the pool is read once for the Run');
  calls.length=0;
  fake.settings.defaultPool['openai-codex']=[];
  const unnamed={read:async()=>({state:'failed',reply:null,session:null,usage:null,toolCalls:[],modelRefused:'access'})};
  assert.equal(await withEngineContract(()=>unnamed,()=>closeOpenRuns(db,{conversation})),1);
  assert.deepEqual(calls.filter(call=>call.name.startsWith('close_')).map(call=>[call.name,call.args.usage_resets_at,call.args.ran_out]),[['close_conversation_run_ran_out',null,[]]]);
  calls.length=0;
  const read=poolReads();
  const failed={read:async()=>({state:'failed',reply:null,session:null,usage:null,toolCalls:[]})};
  assert.equal(await withEngineContract(()=>failed,()=>closeOpenRuns(db,{conversation})),1);
  assert.deepEqual(calls.filter(call=>call.name.startsWith('close_')).map(call=>[call.name,call.args.run_outcome]),[['close_conversation_run','failed']]);
  assert.equal(poolReads(),read,'a Run that failed for another cause reads no pool');
 } finally { await fake.close(); engineRecord('co',hermes); }
});
