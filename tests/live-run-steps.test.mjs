import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { engineFor } from '../lib/engine.mjs';
import { liveLines, liveView, mostLiveSteps, withStep } from '../lib/live-steps.mjs';

// #646 on the fake Engine server, which streams a Run's events as the pinned release does (api_server_runs.py
// _handle_run_events): the Run's tool calls as they happen, folded into what its reader sees, and nothing kept.
const profile='co-live';
const connection=(/** @type {Awaited<ReturnType<typeof fakeHermes>>} */ fake)=>({address:fake.address,managementAddress:fake.managementAddress,profile,key:fake.settings.key});
const started=(/** @type {string} */ id,/** @type {string} */ tool,/** @type {string} */ preview)=>({event:'tool.started',tool,preview,tool_call_id:id});
const completed=(/** @type {string} */ id,/** @type {string} */ tool,error=false)=>({event:'tool.completed',tool,duration:0.4,error,preview:'{"results": []}',tool_call_id:id});
const runOn=async(/** @type {Awaited<ReturnType<typeof fakeHermes>>} */ fake)=>/** @type {string} */(await engineFor(connection(fake)).start({conversation:'live-conversation',input:'Plan the ads',idempotencyKey:crypto.randomUUID()}));
/** @param {AsyncIterable<any>} lines @param {(line:any)=>boolean} [until] */
const collect=async(lines,until=()=>false)=>{ const all=[]; for await(const line of lines) { all.push(line); if(until(line)) break; } return all; };

test('a Run\'s calls are read as they happen: each start names the call made now, each end moves it to the list, done or failed',async()=>{
 const fake=await fakeHermes();
 try {
  const run=await runOn(fake);
  const engine=engineFor(connection(fake));
  const reading=collect(liveLines(run,/** @type {AsyncIterable<any>} */(engine.steps?.(run))));
  fake.settings.emit(run,{event:'run.started'});
  fake.settings.emit(run,started('call_1','web_search','accounting courses Cairo'));
  fake.settings.emit(run,{event:'message.delta',delta:'Let me look'});
  fake.settings.emit(run,completed('call_1','web_search'));
  // A path, a key or the Engine's name is never shown: the line is the tool's name alone.
  fake.settings.emit(run,started('call_2','read_file','/opt/data/work/campaigns.csv'));
  fake.settings.emit(run,completed('call_2','read_file',true));
  // A tool that names the Engine is no step.
  fake.settings.emit(run,started('call_3','hermes_admin','reload'));
  fake.settings.emit(run,{event:'run.completed',output:'Here is the plan.'});
  fake.settings.emit(run,null);
  assert.deepEqual(await reading,[
   {run,steps:[],now:null},
   {run,steps:[],now:{tool:'web_search',preview:'accounting courses Cairo'}},
   {run,steps:[{tool:'web_search',preview:'accounting courses Cairo',state:'done'}],now:null},
   {run,steps:[{tool:'web_search',preview:'accounting courses Cairo',state:'done'}],now:{tool:'read_file',preview:null}},
   {run,steps:[{tool:'web_search',preview:'accounting courses Cairo',state:'done'},{tool:'read_file',preview:null,state:'failed'}],now:null},
   {end:'ended'}]);
  assert.ok(fake.settings.requests.some(request=>request.path===`/p/${profile}/v1/runs/${run}/events`),'read from the profile the Run is on');
 } finally { await fake.close(); }
});

test('a reader who comes in mid-Run is given the calls made so far and the one made now, then each new one',async()=>{
 const fake=await fakeHermes();
 try {
  const run=await runOn(fake);
  fake.settings.emit(run,started('call_1','web_search','courses'));
  fake.settings.emit(run,completed('call_1','web_search'));
  fake.settings.emit(run,started('call_2','browser_navigate','https://example.org'));
  const stop=new AbortController();
  const reading=collect(liveLines(run,/** @type {AsyncIterable<any>} */(engineFor(connection(fake)).steps?.(run,{signal:stop.signal}))),line=>line.now?.tool==='terminal');
  const lines=await new Promise(resolve=>setTimeout(()=>{ fake.settings.emit(run,completed('call_2','browser_navigate')); fake.settings.emit(run,started('call_3','terminal','ls')); resolve(reading); },100));
  stop.abort();
  assert.deepEqual(/** @type {any[]} */(lines).slice(-3),[
   {run,steps:[{tool:'web_search',preview:'courses',state:'done'}],now:{tool:'browser_navigate',preview:'https://example.org'}},
   {run,steps:[{tool:'web_search',preview:'courses',state:'done'},{tool:'browser_navigate',preview:'https://example.org',state:'done'}],now:null},
   {run,steps:[{tool:'web_search',preview:'courses',state:'done'},{tool:'browser_navigate',preview:'https://example.org',state:'done'}],now:{tool:'terminal',preview:'ls'}}]);
 } finally { await fake.close(); }
});

test('a Run the Engine no longer knows is gone, and an Engine that cannot be read is unreachable: the page keeps its plain line',async()=>{
 const fake=await fakeHermes();
 try {
  const engine=engineFor(connection(fake));
  assert.deepEqual(await collect(liveLines('run_missing',/** @type {AsyncIterable<any>} */(engine.steps?.('run_missing')))),[{run:'run_missing',steps:[],now:null},{end:'gone'}]);
  const elsewhere=engineFor({...connection(fake),address:'http://8.8.8.8:1'});
  assert.deepEqual(await collect(/** @type {AsyncIterable<any>} */(elsewhere.steps?.('run_1'))),[{end:'unreachable'}]);
 } finally { await fake.close(); }
 const closed=await fakeHermes(); const address=closed.address; await closed.close();
 assert.deepEqual(await collect(/** @type {AsyncIterable<any>} */(engineFor({address,profile,key:'test-only-key'}).steps?.('run_1'))),[{end:'unreachable'}]);
});

test('a replayed start is drawn once; an end with no id closes the oldest open call of its tool; an end of no call changes nothing',()=>{
 const one=withStep([],{call:'a',tool:'web_search',preview:'x',state:'started'});
 assert.equal(withStep(one,{call:'a',tool:'web_search',preview:'x',state:'started'}),one);
 const two=withStep(withStep(one,{call:'#4',tool:'terminal',preview:'ls',state:'started'}),{call:'#5',tool:'terminal',preview:'pwd',state:'started'});
 assert.deepEqual(liveView('r',two).now,{tool:'terminal',preview:'pwd'},'the call started last is the one made now');
 const ended=withStep(two,{call:null,tool:'terminal',preview:null,state:'failed'});
 assert.deepEqual(liveView('r',ended),{run:'r',steps:[{tool:'terminal',preview:'ls',state:'failed'}],now:{tool:'terminal',preview:'pwd'}});
 assert.equal(withStep(ended,{call:'zzz',tool:'web_search',preview:null,state:'done'}),ended);
 const full=Array.from({length:mostLiveSteps},(_,index)=>({call:`c${index}`,tool:'t',preview:null,state:/** @type {const} */('done')}));
 assert.equal(withStep(full,{call:'more',tool:'t',preview:null,state:'started'}),full,'a Run past its limit shows its first calls');
});
