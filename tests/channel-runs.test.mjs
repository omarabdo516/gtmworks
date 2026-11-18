import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveChannelRuns, postChannelMessage } from '../lib/channel-runs.mjs';
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
  if(name==='answer_channel_start') return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 const engine={start:async request=>{ starts.push(request); return attempts===1?{state:'unknown'}:`run-${attempts}`; }};
 const drive=()=>driveChannelRuns(/** @type {any} */(service),{hermes,engineFor:()=>/** @type {any} */(engine)});
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
  if(name==='channel_runs_due') return {data:[{message:9,run,profile:'ag-faye'}],error:null};
  if(name==='track_channel_permission') return {data:[],error:null};
  if(name==='channel_show_card') { if(!cards.some(card=>card.run===args.run&&card.call===args.call)) cards.push(args); return {data:{state:'shown',card:cards.length},error:null}; }
  if(name==='close_channel_run') { if(closed.has(args.run)) return {data:false,error:null}; closed.set(args.run,args); return {data:true,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 const run=await fake.engineFor({}).start({conversation:'s-1',input:'Sara: @Faye draft the scripts',idempotencyKey:'channel:9'});
 const drive=()=>driveChannelRuns(/** @type {any} */(service),{hermes,engineFor:fake.engineFor});
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
