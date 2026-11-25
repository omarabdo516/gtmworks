import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeOpenRuns } from '../lib/conversation-runs.mjs';

// #457: how an ended Run is recorded. A model error a retry cannot fix keeps its own outcome, and a Run the Engine read
// as interrupted (stopped) or no longer knew (lost) closes still, so the chat never stays on "working" after a restart.
const hermes={address:'http://hermes:8642',key:'test-only-key'};
const conversation='c4570000-0000-0000-0000-000000000001';
const open={message:1,conversation,run:'run-1',person:'p',connection:'f9000000-0000-0000-0000-000000000001',address:'http://hermes:8642',profile:'writer',state:'connected'};

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
 assert.equal(await closeOpenRuns(db,{hermes,conversation,engineFor:()=>engine}),1);
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

// #642: a Run whose every account ran out closes with when its usage resets, when the Engine named it, in the same call
// that closes it; with no reset named it closes as any other no-access Run.
test('a Run that ran out of usage closes with when its usage resets, in the same call',async()=>{
 const calls=/** @type {{name:string,args:any}[]} */([]);
 const db={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  calls.push({name,args});
  if(name==='open_conversation_runs') return {data:calls.some(call=>call.name.startsWith('close_'))?[]:[open],error:null};
  if(name==='track_run_question'||name==='track_run_permission') return {data:[],error:null};
  if(name==='close_conversation_run_out_of_usage'||name==='close_conversation_run') return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 const resetsAt='2027-05-01T19:24:00.000Z';
 const engine={read:async()=>({state:'failed',reply:null,session:'s-1',usage:null,toolCalls:[],modelRefused:'access',resetsAt})};
 assert.equal(await closeOpenRuns(db,{hermes,conversation,engineFor:()=>engine}),1);
 assert.deepEqual(calls.filter(call=>call.name.startsWith('close_')),[{name:'close_conversation_run_out_of_usage',args:{conversation,run:'run-1',hermes_session:'s-1',read_completed:false,usage_resets_at:resetsAt}}]);
 calls.length=0;
 const unnamed={read:async()=>({state:'failed',reply:null,session:null,usage:null,toolCalls:[],modelRefused:'access'})};
 assert.equal(await closeOpenRuns(db,{hermes,conversation,engineFor:()=>unnamed}),1);
 assert.deepEqual(calls.filter(call=>call.name.startsWith('close_')).map(call=>[call.name,call.args.run_outcome]),[['close_conversation_run','no_access']]);
});
