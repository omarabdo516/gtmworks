import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineServing } from './engine-records.mjs';
import { keepHeldConversationRuns } from '../lib/conversation-held-runs.mjs';
import { upkeepSchedule } from '../lib/upkeep-schedule.mjs';

// #882 (spec #864): a Run an Engine Conversation's row holds sets its Agent's face working (agent_work), and the live
// read lets it go when its person sees its end. One whose person left while it worked is let go by the worker once the
// Engine says it ended or no longer knows it; one still working, and every Run of an Engine that does not answer, stay.
const rs='10000000-0000-0000-0000-000000000001';
const profile='rs-lead';
const database=(/** @type {{company_id:string,conversation:string,profile:string,runs:string[]}[]} */ rows)=>{
 const released=/** @type {{conversation:string,run:string}[]} */([]);
 return {released,rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  if(name==='held_conversation_runs') return {data:rows,error:null};
  if(name==='let_go_conversation_run') { released.push(args); return {data:true,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
};
const held=(/** @type {string} */ id,/** @type {object} */ state)=>({id,profile,sessionId:'gtmworks-s',session:'gtmworks-s',input:'Plan',reads:0,asked:[],approvals:[],created:1,...state});

test('a held Run that ended, or that the Engine no longer knows, is let go; one still working stays',async()=>{
 const fake=await engineServing(rs);
 try {
  fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
  fake.settings.runs.push(/** @type {any} */(held('run_done',{turnStarted:true,liveDone:true})),/** @type {any} */(held('run_working',{turnStarted:true})),/** @type {any} */(held('run_failed',{turnStarted:true,liveFailed:true})));
  const db=database([{company_id:rs,conversation:'c1',profile,runs:['run_done','run_working']},{company_id:rs,conversation:'c2',profile,runs:['run_failed','run_forgotten']}]);
  assert.deepEqual(await keepHeldConversationRuns(db,{health:upkeepSchedule()}),{released:3});
  assert.deepEqual(db.released,[{conversation:'c1',run:'run_done'},{conversation:'c2',run:'run_failed'},{conversation:'c2',run:'run_forgotten'}]);
 } finally { await fake.close(); }
});

test('an Engine that does not answer lets go of nothing',async()=>{
 const fake=await engineServing(rs);
 const db=database([{company_id:rs,conversation:'c1',profile,runs:['run_done']}]);
 await fake.close();
 assert.deepEqual(await keepHeldConversationRuns(db,{health:upkeepSchedule()}),{released:0});
 assert.deepEqual(db.released,[]);
});
