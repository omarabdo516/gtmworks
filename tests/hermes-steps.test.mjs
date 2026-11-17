import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { engineFor } from '../lib/engine.mjs';
import { withChunk } from '../lib/hermes.mjs';
import { followRun, sealRunSteps } from '../lib/run-steps.mjs';

// #141 on the fake Engine server, which streams a run's events as the pinned release does (api_server_runs.py
// _handle_run_events): what the driver reads of a Run's event stream and of its length.
const connection=(/** @type {Awaited<ReturnType<typeof fakeHermes>>} */ fake)=>({address:fake.address,profile:'writer',key:'test-only-key'});
/** @param {AsyncIterable<import('../lib/engine.mjs').RunEvent>} events */
// The Run's own end carries the time the Engine stamped on it; a test reads whether it is a number.
const all=async events=>{ const read=[]; for await(const event of events) read.push('endedAt' in event?{...event,endedAt:typeof event.endedAt}:event); return read; };
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
   {seq:5,step:null,endedAt:'number'},
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
  const end=(await events.next()).value; assert.deepEqual({...end,endedAt:typeof end.endedAt},{seq:2,step:null,endedAt:'number'},'the Run\'s own end, with the time the Engine stamped on it');
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
  assert.deepEqual(await all(engine.steps(run,{after:2})),[{seq:3,step:{call:'call_2',tool:'read_file',preview:null,state:'done'}},{seq:4,step:null,endedAt:'number'},{end:'ended'}]);
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

test('a follower that read the Run to its end, then the closer, seal its steps whole on the Engine\'s own stream',async()=>{
 const fake=await fakeHermes();
 try {
  const {engine,run}=await begin(fake);
  fake.settings.emit(run,started('web_search','audiences','call_1'));
  fake.settings.emit(run,completed('web_search',false,'call_1'));
  await finish(engine,run);
  // One row as the steps functions keep it (supabase/tests/run_steps.sql proves the real ones).
  /** @type {any} */ let row=null; const writes=/** @type {string[]} */([]);
  const db={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
   if(name==='run_steps_progress') return {data:row?[{steps:row.steps,read_to:row.readTo,broken:row.broken,ended:row.ended,seconds:row.seconds,sealed:row.sealed}]:[],error:null};
   writes.push(name);
   if(row?.sealed) return {data:false,error:null};
   row={steps:args.noted,readTo:args.upto,broken:!!row?.broken||args.lost,ended:!!row?.ended||!!args.done,seconds:args.took??row?.seconds??null,sealed:name==='seal_run_steps'};
   return {data:true,error:null};
  }};
  const open={conversation:'conversation-1',run};
  assert.equal(await followRun(db,engine,open,AbortSignal.timeout(5000)),'ended');
  assert.ok(row&&!row.broken&&!row.sealed&&row.ended,'the follower kept what it read up to the Run\'s end');
  assert.equal(row.seconds,Math.round(fake.settings.runSeconds),'and the Run\'s length');
  const asked=fake.settings.requests.length;
  await sealRunSteps(db,engine,open);
  assert.equal(fake.settings.requests.length,asked,'the closer seals what the follower kept without asking the Engine');
  assert.deepEqual(writes.filter(name=>name==='seal_run_steps'),['seal_run_steps']); assert.equal(writes.at(-1),'seal_run_steps','sealed once, last');
  assert.equal(row.broken,false,'the closer\'s read after the end finds the end, so the steps are whole');
  assert.deepEqual(row.steps,[{call:'call_1',tool:'web_search',preview:'audiences',state:'done'}]);
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
  assert.deepEqual((await all(engine.steps(run))).slice(0,2),[{seq:0,step:{call:'#0',tool:'web_search',preview:'audiences',state:'started'}},{seq:1,step:{call:null,tool:'web_search',preview:null,state:'done'}}]);
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

test('a Run\'s length is from its record\'s creation to the time the Engine stamped on its end, in whole seconds, once it has ended',async()=>{
 const fake=await fakeHermes(); fake.settings.pendingReads=1; fake.settings.runSeconds=40.6;
 try {
  const {engine,run}=await begin(fake);
  assert.equal(await engine.length(run),null,'a Run still working has no length');
  await finish(engine,run);
  const ended=(await all(engine.steps(run))).find(event=>'endedAt' in event);
  assert.ok(ended,'the read of its events gives the end');
  const endedAt=fake.settings.runs[0].created+fake.settings.runSeconds;
  assert.equal(await engine.length(run,{endedAt}),41,'from the record\'s creation to the end the events gave');
  assert.equal(await engine.length(run),null,'the record alone has no end time on the pinned release');
  assert.equal(await engine.length('run_unknown',{endedAt}),null);
 } finally { await fake.close(); }
});

test('a preview holding a character Postgres cannot store keeps the rest of its words, and the step is kept',async()=>{
 const fake=await fakeHermes();
 try {
  const {engine,run}=await begin(fake);
  fake.settings.emit(run,started('web_search','best\u0000 audiences\u0007 \ud800for ads','call_1'));
  await finish(engine,run);
  const [first]=await all(engine.steps(run));
  assert.deepEqual(first,{seq:0,step:{call:'call_1',tool:'web_search',preview:'best audiences for ads',state:'started'}});
  assert.equal(/[\u0000-\u001f]|[\ud800-\udfff]/.test(JSON.stringify(first)),false,'no NUL, control character or lone surrogate reaches the database');
 } finally { await fake.close(); }
});

test('a Hermes that takes the events request and never answers it leaves the read unreachable within the usual time',async()=>{
 const fake=await fakeHermes(); fake.settings.stallEvents=true;
 try {
  const {engine,run}=await begin(fake);
  const read=await all(engine.steps(run,{signal:new AbortController().signal}));
  assert.deepEqual(read,[{end:'unreachable'}]);
 } finally { await fake.close(); }
});

test('a preview keeps an address, a date and a split, and drops a file path and the Engine\'s name',async()=>{
 const fake=await fakeHermes();
 try {
  const {engine,run}=await begin(fake);
  const previews=['https://rslearning.com/courses/accounting','budget for 1/12','a 50/50 split','15,000 ج/شهر','Hermès scarves','/srv/app/plan.md','~/notes.txt','./draft.md','src/lib/plan.js','C:\\Users\\team\\plan.docx','ask hermes about it'];
  previews.forEach((preview,index)=>fake.settings.emit(run,started('web_search',preview,`call_${index}`)));
  await finish(engine,run);
  const shown=(await all(engine.steps(run))).flatMap(event=>'step' in event&&event.step?[event.step.preview]:[]);
  assert.deepEqual(shown,[...previews.slice(0,5),null,null,null,null,null,null]);
 } finally { await fake.close(); }
});

test('a line end split between two chunks of the stream stays one line end',()=>{
 let buffer=withChunk('','id: 3\r');
 buffer=withChunk(buffer,'\ndata: {"seq":3}\r\n\r\n');
 assert.equal(buffer,'id: 3\ndata: {"seq":3}\n\n');
 assert.equal(withChunk('','a\rb\r\nc'),'a\nb\nc','a lone \\r and a \\r\\n inside one chunk are line ends too');
});
