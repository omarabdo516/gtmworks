import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { engineFor } from '../lib/engine.mjs';

// #141 on the fake Engine server, which streams a run's events as the pinned release does (api_server_runs.py
// _handle_run_events): what the driver reads of a Run's event stream and of its length.
const connection=(/** @type {Awaited<ReturnType<typeof fakeHermes>>} */ fake)=>({address:fake.address,profile:'writer',key:'test-only-key'});
/** @param {AsyncIterable<import('../lib/engine.mjs').RunEvent>} events */
const all=async events=>{ const read=[]; for await(const event of events) read.push(event); return read; };
const started=(/** @type {string} */ tool,/** @type {string} */ preview,/** @type {string=} */ id)=>({event:'tool.started',tool,preview,...(id?{tool_call_id:id}:{})});
const completed=(/** @type {string} */ tool,/** @type {boolean} */ error,/** @type {string=} */ id)=>({event:'tool.completed',tool,duration:1.2,error,preview:'/home/hermes/out.txt',...(id?{tool_call_id:id}:{})});
const begin=async(/** @type {Awaited<ReturnType<typeof fakeHermes>>} */ fake)=>{
 const engine=engineFor(connection(fake));
 const run=/** @type {string} */(await engine.start({conversation:'conversation-1',input:'Plan the ads',idempotencyKey:'conversation-1:k1'}));
 return {engine,run};
};
const finish=async(/** @type {import('../lib/engine.mjs').Engine} */ engine,/** @type {string} */ run)=>assert.equal((await engine.read(run)).state,'completed');

test('an ended Run\'s events are read to their end: each numbered event in order, its tool calls as steps, then the end',async()=>{
 const fake=await fakeHermes();
 try {
  const {engine,run}=await begin(fake);
  fake.settings.emit(run,started('web_search','accounting courses Cairo','call_1'));
  fake.settings.emit(run,{event:'message.delta',delta:'Read'});
  fake.settings.emit(run,completed('web_search',false,'call_1'));
  fake.settings.emit(run,started('read_file','campaigns.csv','call_2'));
  fake.settings.emit(run,completed('read_file',true,'call_2'));
  await finish(engine,run);
  assert.deepEqual(await all(engine.steps(run)),[
   {seq:0,step:{call:'call_1',tool:'web_search',preview:'accounting courses Cairo',state:'started'}},
   {seq:1,step:null},
   {seq:2,step:{call:'call_1',tool:'web_search',preview:null,state:'done'}},
   {seq:3,step:{call:'call_2',tool:'read_file',preview:'campaigns.csv',state:'started'}},
   {seq:4,step:{call:'call_2',tool:'read_file',preview:null,state:'failed'}},
   {seq:5,step:null},
   {end:'ended'}]);
  const asked=fake.settings.requests.filter(request=>request.path?.endsWith('/events'));
  assert.deepEqual(asked.map(request=>[request.method,request.path,request.authorization]),[['GET',`/p/writer/v1/runs/${run}/events`,'Bearer test-only-key']]);
 } finally { await fake.close(); }
});

test('a Run still working is followed as its events arrive, and the read ends with the Run',async()=>{
 const fake=await fakeHermes(); fake.settings.pendingReads=1;
 try {
  const {engine,run}=await begin(fake);
  const events=engine.steps(run)[Symbol.asyncIterator]();
  fake.settings.emit(run,started('web_search','audiences','call_1'));
  assert.deepEqual((await events.next()).value,{seq:0,step:{call:'call_1',tool:'web_search',preview:'audiences',state:'started'}});
  fake.settings.emit(run,completed('web_search',false,'call_1'));
  assert.deepEqual((await events.next()).value,{seq:1,step:{call:'call_1',tool:'web_search',preview:null,state:'done'}});
  assert.equal((await engine.read(run)).state,'running');
  await finish(engine,run);
  assert.deepEqual((await events.next()).value,{seq:2,step:null},'the Run\'s own end');
  assert.deepEqual((await events.next()).value,{end:'ended'});
  assert.equal((await events.next()).done,true);
 } finally { await fake.close(); }
});

test('a read from a number gets only the events after it, and one the Engine no longer keeps all of reports the loss',async()=>{
 const fake=await fakeHermes();
 try {
  const {engine,run}=await begin(fake);
  fake.settings.emit(run,started('web_search','audiences','call_1'));
  fake.settings.emit(run,completed('web_search',false,'call_1'));
  fake.settings.emit(run,started('read_file','campaigns.csv','call_2'));
  fake.settings.emit(run,completed('read_file',false,'call_2'));
  await finish(engine,run);
  assert.deepEqual(await all(engine.steps(run,{after:2})),[{seq:3,step:{call:'call_2',tool:'read_file',preview:null,state:'done'}},{seq:4,step:null},{end:'ended'}]);
  assert.ok(fake.settings.requests.some(request=>request.path===`/p/writer/v1/runs/${run}/events?last_seq=2`),'the number read to is sent');
  fake.settings.forget(run,2);
  assert.deepEqual((await all(engine.steps(run,{after:1}))).at(0),{seq:2,step:{call:'call_2',tool:'read_file',preview:'campaigns.csv',state:'started'}},'nothing after the number read was lost');
  const read=await all(engine.steps(run));
  assert.deepEqual(read.slice(0,2),[{lost:true},{seq:2,step:{call:'call_2',tool:'read_file',preview:'campaigns.csv',state:'started'}}]);
  assert.deepEqual(read.at(-1),{end:'ended'});
 } finally { await fake.close(); }
});

test('a follower that read up to the Run\'s end leaves the closer a read that finds the end, so their steps are not broken',async()=>{
 const fake=await fakeHermes();
 try {
  const {engine,run}=await begin(fake);
  fake.settings.emit(run,started('web_search','audiences','call_1'));
  fake.settings.emit(run,completed('web_search',false,'call_1'));
  await finish(engine,run);
  const followed=await all(engine.steps(run));
  assert.deepEqual(followed.at(-1),{end:'ended'});
  const last=/** @type {{seq:number}} */(followed.at(-2)).seq;
  assert.deepEqual(await all(engine.steps(run,{after:last})),[{end:'ended'}],'after the last event, the close alone says the Run ended');
 } finally { await fake.close(); }
});

test('a preview that holds a path, looks like a key or names the Engine is dropped, and the line is the tool\'s name alone',async()=>{
 const fake=await fakeHermes();
 try {
  const {engine,run}=await begin(fake);
  const previews=['/etc/app/.env','src\\app\\page.tsx','~/notes.md','C:\\Users\\team','cat ./campaigns.csv','api_key=abcd1234efgh','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefgh','sk-abcdefghijklmnopqrstuvwxyz123456','ask Hermes for the plan','HERMES_HOME','   '];
  for(const [index,preview] of previews.entries()) fake.settings.emit(run,started('terminal',preview,`call_${index}`));
  fake.settings.emit(run,started('web_search',' best  audiences\nfor   ads ','call_kept'));
  fake.settings.emit(run,started('hermes_memory','the plan','call_engine'));
  fake.settings.emit(run,started('read file','x','call_bad'));
  await finish(engine,run);
  const steps=(await all(engine.steps(run))).flatMap(event=>'step' in event&&event.step?[event.step]:[]);
  assert.deepEqual(steps.slice(0,previews.length).map(step=>[step.tool,step.preview]),previews.map(()=>['terminal',null]));
  assert.deepEqual(steps.slice(previews.length),[{call:'call_kept',tool:'web_search',preview:'best audiences for ads',state:'started'}],
   'a plain preview is kept on one line, and a tool that names the Engine or is no tool name is no step');
 } finally { await fake.close(); }
});

test('a call the Engine gives no id is known by the number of its start, and its end by its tool',async()=>{
 const fake=await fakeHermes();
 try {
  const {engine,run}=await begin(fake);
  fake.settings.emit(run,started('web_search','audiences'));
  fake.settings.emit(run,completed('web_search',false));
  await finish(engine,run);
  assert.deepEqual((await all(engine.steps(run))).slice(0,2),[{seq:0,step:{call:'seq:0',tool:'web_search',preview:'audiences',state:'started'}},{seq:1,step:{call:null,tool:'web_search',preview:null,state:'done'}}]);
 } finally { await fake.close(); }
});

test('a Run whose events the Engine no longer keeps is gone; one that cannot be asked is unreachable',async()=>{
 const fake=await fakeHermes();
 try {
  const {engine,run}=await begin(fake);
  fake.settings.sweep(run);
  assert.deepEqual(await all(engine.steps(run)),[{end:'gone'}]);
  assert.deepEqual(await all(engineFor({...connection(fake),key:'wrong'}).steps(run)),[{end:'unreachable'}]);
  assert.deepEqual(await all(engineFor({...connection(fake),address:'http://8.8.8.8:1'}).steps(run)),[{end:'unreachable'}],'an address that is not allowed is never called');
 } finally { await fake.close(); }
});

test('a Run\'s length is its own record\'s, in whole seconds, once it has ended',async()=>{
 const fake=await fakeHermes(); fake.settings.pendingReads=1; fake.settings.runSeconds=40.6;
 try {
  const {engine,run}=await begin(fake);
  assert.equal(await engine.length(run),null,'a Run still working has no length');
  await finish(engine,run);
  assert.equal(await engine.length(run),41);
  assert.equal(await engine.length('run_unknown'),null);
 } finally { await fake.close(); }
});
