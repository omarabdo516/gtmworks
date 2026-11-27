import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { driveChannelRuns, driveNoteRuns, postChannelMessage } from '../lib/channel-runs.mjs';
import { toolSpecTexts } from '../lib/agent-tools.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #338: the database decides who may post (supabase/tests/channels.sql); the run layer turns its refusal into the
// route's answer and drives no Run for it.
test('a post the database refuses is answered as not allowed or not found, and starts no Run', async () => {
  const calls = [];
  const refusing = code => ({ rpc: async name => { calls.push(name); return { error: { code } }; } });
  const driven = [];
  const service = { rpc: async name => { driven.push(name); return { data: [] }; } };
  const post = code => postChannelMessage(refusing(code), service, { channel: 'c', sendKey: 'k', message: '@Faye hello', encryptionKey: undefined });
  assert.deepEqual(await post('42501'), { refused: 'channelNotAllowed', status: 403 });
  assert.deepEqual(await post('P0002'), { refused: 'channelNotFound', status: 404 });
  assert.deepEqual(await post('22023'), { refused: 'channelFailed', status: 400 });
  assert.deepEqual(calls, ['post_channel_message', 'post_channel_message', 'post_channel_message']);
  assert.deepEqual(driven, [], 'no Run is driven for a refused post');
});

const hermes={address:'http://hermes:8642',key:'test-only-key'};
// Each Company's Engine record, as the database holds it; the fake of the contract answers for the Engine.
for(const company of ['co','10000000-0000-0000-0000-000000000001']) engineRecord(company,hermes);

// #148: a channel Run is offered show_draft and show_review, pinned at its first start (pin_channel_run) with the same
// texts a Conversation's Run gets. A retry finds them pinned and sends exactly the same request.
test('a channel Run is started with its pinned draft and review tools, and a retry sends the same request',async()=>{
 const starts=[]; const pins=[];
 const pinned=JSON.stringify([JSON.parse(toolSpecTexts().show_draft),JSON.parse(toolSpecTexts().show_review)]);
 let attempts=0;
 const service={rpc:async name=>{
  if(name==='channel_runs_due') return {data:[{message:5,run:null,profile:null}],error:null};
  if(name==='begin_channel_start') return {data:[{attempt:++attempts,company:'10000000-0000-0000-0000-000000000001',profile:'ag-faye',session:'s-1',input:'Sara: @Faye draft the teaser',instructions:null}],error:null};
  if(name==='pin_channel_run') { pins.push(pinned); return {data:{tools:pinned},error:null}; }
  if(name==='channel_handover_targets') return {data:[],error:null};
  if(name==='answer_channel_start') return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 const engine={start:async request=>{ starts.push(request); return attempts===1?{state:'unknown'}:`run-${attempts}`; }};
 const drive=()=>withEngineContract(()=>/** @type {any} */(engine),()=>driveChannelRuns(/** @type {any} */(service),{}));
 assert.deepEqual(await drive(),{started:0,closed:0},'the first start may have happened');
 assert.deepEqual(await drive(),{started:1,closed:0},'so it is asked again with the same key');
 assert.equal(pins.length,2,'the pin is asked both times');
 assert.deepEqual(starts.map(start=>start.idempotencyKey),['channel:5','channel:5']);
 assert.deepEqual(starts.map(start=>start.tools.map(tool=>tool.name)),[['show_draft','show_review'],['show_draft','show_review']]);
 assert.deepEqual(JSON.stringify(starts[0].tools),pinned);
});

// #148 on the fake engine: a completed channel Run's draft and review calls are carried out before it closes, kept once
// per message, run and call however often the Run is closed, a call that does not read is ignored, and the reply still
// shows. The database is a small stand-in for channel_show_card (supabase/tests/channel_cards.sql proves the real one).
test('a channel Run shows its draft and review cards once, ignores a call that does not read, and still posts its reply',async()=>{
 const fake=fakeEngine();
 fake.settings.reply=()=> 'Here are the scripts for review.';
 fake.settings.toolCalls=()=>[
  {id:'call_1',name:'show_draft',arguments:{title:'December scripts',line:'Draft · Meta Ads',rows:[{label:'Scripts',value:'3'}]}},
  {id:'call_2',name:'show_review',arguments:{title:'Script review',line:'3 texts · Meta Ads',items:[{text:'A',fine:true,note:'Fine'},{text:'B',fine:false,note:'Swap the promise'}],decision:'1 ready, 1 back'}},
  {id:'call_3',name:'show_draft',arguments:null},
 ];
 const cards=[]; const closed=new Map();
 const service={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  if(name==='channel_runs_due') return {data:[{message:9,run,profile:'ag-faye',company:'10000000-0000-0000-0000-000000000001'}],error:null};
  if(name==='track_channel_permission') return {data:[],error:null};
  if(name==='channel_show_card') { if(!cards.some(card=>card.run===args.run&&card.call===args.call)) cards.push(args); return {data:{state:'shown',card:cards.length},error:null}; }
  if(name==='close_channel_run') { if(closed.has(args.run)) return {data:false,error:null}; closed.set(args.run,args); return {data:true,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 const run=await fake.engineFor({}).start({conversation:'s-1',input:'Sara: @Faye draft the scripts',idempotencyKey:'channel:9'});
 const drive=()=>withEngineContract(fake.engineFor,()=>driveChannelRuns(/** @type {any} */(service),{}));
 assert.deepEqual(await drive(),{started:0,closed:1});
 assert.deepEqual(cards.map(card=>[card.run,card.call,card.kind,card.title]),[
  [run,'call_1','draft','December scripts'],[run,'call_2','review','Script review'],
 ]);
 assert.deepEqual(cards[1].content,{line:'3 texts · Meta Ads',items:[{text:'A',fine:true,note:'Fine'},{text:'B',fine:false,note:'Swap the promise'}],decision:'1 ready, 1 back'});
 assert.equal(closed.get(run).reply,'Here are the scripts for review.');
 // A second closer that read the Run before the first closed it carries the same calls out again; the database keeps one.
 closed.delete(run);
 assert.deepEqual(await drive(),{started:0,closed:1});
 assert.equal(cards.length,2,'the same message, run and call keep one card');
});

// #428, #530: a channel Run or a Card note's Run the Engine failed for want of any model provider (the contract's
// `noModel`, #422) ends as no_model, and one whose model call cannot succeed on a retry (`modelRefused`, #457) as
// no_credit, key_refused or model_missing, so the channel or the Card says what to fix, as a Conversation does. Any other
// failure still ends as failed.
test('a channel or note Run that failed for want of a model, credit, key or model keeps that cause, any other failure ends as failed',async()=>{
 /** @param {'channel'|'note'} kind @param {object} read */
 const closedAs=async(kind,read)=>{
  const closed=[];
  const service={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
   if(name===`${kind}_runs_due`) return {data:closed.length?[]:[{message:9,run:'run-9',profile:'ag-faye',company:'10000000-0000-0000-0000-000000000001'}],error:null};
   if(name==='track_channel_permission') return {data:[],error:null};
   if(name===`close_${kind}_run`) { closed.push(args.run_outcome); return {data:true,error:null}; }
   return {data:null,error:{message:`unexpected ${name}`}};
  }};
  const engine={read:async()=>({reply:null,session:null,usage:null,toolCalls:[],...read})};
  const drive=kind==='channel'?driveChannelRuns:driveNoteRuns;
  assert.deepEqual(await withEngineContract(()=>/** @type {any} */(engine),()=>drive(/** @type {any} */(service),{})),{started:0,closed:1});
  return closed;
 };
 for(const kind of /** @type {const} */(['channel','note'])) {
  assert.deepEqual(await closedAs(kind,{state:'failed',noModel:true}),['no_model'],kind);
  assert.deepEqual(await closedAs(kind,{state:'failed',modelRefused:'credit'}),['no_credit'],kind);
  assert.deepEqual(await closedAs(kind,{state:'failed',modelRefused:'key'}),['key_refused'],kind);
  assert.deepEqual(await closedAs(kind,{state:'failed',modelRefused:'model'}),['model_missing'],kind);
  assert.deepEqual(await closedAs(kind,{state:'failed'}),['failed'],kind);
  assert.deepEqual(await closedAs(kind,{state:'stopped',noModel:true}),['stopped'],'only a failure is read for its cause');
 }
});

// #413: a start that never reached an Engine (the Company has no Engine record yet, or its Engine is not running) is no
// attempt: the driver hands it back, so the Run stays due and its next start is a first one, which a refusal then fails.
// A start that may have reached the Engine keeps its attempt, so its retry keeps the same idempotency key. The database
// half (release_channel_start, release_note_start) is supabase/tests/unreached_starts.sql.
const counted=(source)=>{
 const state={attempts:0,released:[],answered:[]};
 const begin=source==='channel'?'begin_channel_start':'begin_note_start';
 const service={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  if(name===`${source}_runs_due`) return {data:[{message:7,run:null,profile:null}],error:null};
  if(name===begin) return {data:[{attempt:++state.attempts,company:'10000000-0000-0000-0000-000000000001',profile:'ag-faye',session:'s-7',input:'Sara: @Faye hello',instructions:null,...(source==='channel'?{ordinal:1}:{})}],error:null};
  if(name===`release_${source}_start`) { state.released.push(args); if(args.attempt===state.attempts) { state.attempts--; return {data:true,error:null}; } return {data:false,error:null}; }
  if(name===`answer_${source}_start`) { state.answered.push(args); return {data:true,error:null}; }
  if(name==='channel_handover_targets') return {data:[],error:null};
  if(name==='pin_channel_run') return {data:{tools:null},error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 return {state,service};
};
const notReached=Object.freeze({state:'notReached'});
for(const source of /** @type {const} */(['channel','note'])) {
 const drive=(service,options)=>(source==='channel'?driveChannelRuns:driveNoteRuns)(/** @type {any} */(service),options);
 const place=source==='channel'?{ordinal:1}:{};

 test(`a stopped Engine leaves a ${source} Run due, and its next start is a first attempt a refusal fails`,async()=>{
  const {state,service}=counted(source); const starts=[]; let answer=notReached;
  const engine={start:async request=>{ starts.push(request); return answer; }};
  const options=()=>withEngineContract(()=>/** @type {any} */(engine),()=>drive(service,{}));
  assert.deepEqual(await options(),{started:0,closed:0},'nothing connected to the Engine');
  assert.deepEqual(state.released,[{message:7,attempt:1,...place}],'so its attempt is handed back');
  assert.deepEqual(state.answered,[],'and the Run is not answered as failed');
  answer=null;
  assert.deepEqual(await options(),{started:0,closed:0},'the Engine runs again and refuses the start');
  assert.deepEqual(starts.map(start=>[start.idempotencyKey,start.retry]),[[`${source}:7`,false],[`${source}:7`,false]],'both are sent as a first attempt');
  assert.deepEqual(state.answered,[{message:7,attempt:1,run:null,...place}],'so the refusal is answered for the first attempt, which fails the Run');
  assert.equal(state.released.length,1,'a refusal reached the Engine and is not handed back');
 });

 test(`a ${source} Run that waited for a missing Engine is then sent as a first attempt`,async()=>{
  const {state,service}=counted(source); const starts=[];
  const engine={start:async request=>{ starts.push(request); return null; }};
  engineRecord('10000000-0000-0000-0000-000000000001',null);
  assert.deepEqual(await withEngineContract(()=>/** @type {any} */(engine),()=>drive(service,{})),{started:0,closed:0},'the Company has no Engine yet');
  assert.deepEqual(state.released,[{message:7,attempt:1,...place}],'so the wait counts no attempt');
  assert.deepEqual(starts,[],'and nothing is sent');
  engineRecord('10000000-0000-0000-0000-000000000001',hermes);
  await withEngineContract(()=>/** @type {any} */(engine),()=>drive(service,{}));
  assert.deepEqual(starts.map(start=>start.retry),[false],'once the Engine is there its start is a first one');
  assert.deepEqual(state.answered,[{message:7,attempt:1,run:null,...place}],'and its refusal fails the Run instead of retrying for a day');
 });

 test(`a ${source} start that may have reached the Engine keeps its attempt and is retried with the same key`,async()=>{
  const {state,service}=counted(source); const starts=[]; let answer=/** @type {any} */({state:'unknown'});
  const engine={start:async request=>{ starts.push(request); return answer; }};
  const options=()=>withEngineContract(()=>/** @type {any} */(engine),()=>drive(service,{}));
  await options();
  assert.deepEqual(state.released,[],'an unknown outcome is never handed back');
  assert.deepEqual(state.answered,[],'nor answered');
  answer='run-7';
  assert.deepEqual(await options(),{started:1,closed:0});
  assert.deepEqual(starts.map(start=>[start.idempotencyKey,start.retry]),[[`${source}:7`,false],[`${source}:7`,true]],'the second is the same request, as a retry');
  assert.deepEqual(state.answered,[{message:7,attempt:2,run:'run-7',...place}]);
 });
}
