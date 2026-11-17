import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { closeOpenRuns, followOpenRuns } from '../lib/conversation-runs.mjs';
import { followRun, withEvent } from '../lib/run-steps.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #141 on the fake engine: what the worker's follower and the closer keep of a Run's tool calls. The database is a small
// stand-in for the steps functions (supabase/tests/run_steps.sql proves the real ones): it keeps one row per Run,
// refuses a closed Run and a sealed row, keeps the steps of the read that went furthest and never forgets a loss.
const encryptionKey=Buffer.alloc(32,7).toString('base64');
const conversation='c1000000-0000-0000-0000-000000000001';

/** @typedef {{steps:import('../lib/engine.mjs').RunStep[],readTo:number,broken:boolean,seconds:number|null,sealed:number|null}} Row */
function database(/** @type {ReturnType<typeof fakeEngine>} */ fake,{stale=false}={}) {
 const rows=/** @type {Map<string,Row>} */(new Map()); const closed=/** @type {Map<string,any>} */(new Map()); const seals=/** @type {any[]} */([]);
 let sealedAt=0;
 const key=encryptSecret('test-only-key',encryptionKey);
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const keep=(/** @type {any} */ args,/** @type {boolean} */ sealing)=>{
  if(closed.has(args.run)) return false;
  const row=rows.get(args.run);
  if(row?.sealed) return false;
  const further=!row||args.upto>=row.readTo;
  rows.set(args.run,{steps:further?args.noted:row.steps,readTo:Math.max(row?.readTo??-1,args.upto),broken:!!row?.broken||args.lost,seconds:sealing?args.took:null,sealed:sealing?++sealedAt:null});
  return true;
 };
 const db={
  rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
   if(name==='open_conversation_runs') return ok(fake.runs.filter(run=>stale||!closed.has(run.id)).map((run,index)=>({message:index+1,conversation,run:run.id,person:'p',connection:'f9000000-0000-0000-0000-000000000001',address:'http://hermes:8642',profile:'writer',state:'connected'})));
   if(name==='track_run_question') return ok([]);
   if(name==='run_steps_progress') { const row=rows.get(args.run); return ok(row?[{steps:row.steps,read_to:row.readTo,broken:row.broken,sealed:row.sealed!==null}]:[]); }
   if(name==='note_run_steps') return ok(keep(args,false));
   if(name==='seal_run_steps') { seals.push(args); return ok(keep(args,true)); }
   if(name==='close_conversation_run') { if(closed.has(args.run)) return ok(false); closed.set(args.run,args); return ok(true); }
   return {data:null,error:{message:'unexpected'}};
  },
  from:()=>{ const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>ok({key_encrypted:key})}; return chain; },
 };
 return {db,rows,closed,seals};
}
const start=async(/** @type {ReturnType<typeof fakeEngine>} */ fake,input='Plan the ads')=>/** @type {string} */(await fake.engineFor({}).start({conversation,input,idempotencyKey:`${conversation}:${input}`}));
const close=(/** @type {any} */ db,/** @type {ReturnType<typeof fakeEngine>} */ fake)=>closeOpenRuns(db,{encryptionKey,conversation,engineFor:fake.engineFor});
const follow=async(/** @type {any} */ db,/** @type {ReturnType<typeof fakeEngine>} */ fake,following=new Map())=>Promise.all(await followOpenRuns(db,{encryptionKey,following,engineFor:fake.engineFor}));
// design-reference: threads['th-meta'] m3, three calls that ended and one that failed.
const calls=()=>[{tool:'meta_ads',preview:'campaign results August to October'},{tool:'meta_ads',preview:'saved audiences'},{tool:'ga4',preview:null,failed:true},{tool:'sheets',preview:'budget split over 30 days'}];
const sealed=[
 {call:'call_1',tool:'meta_ads',preview:'campaign results August to October',state:'done'},
 {call:'call_2',tool:'meta_ads',preview:'saved audiences',state:'done'},
 {call:'call_3',tool:'ga4',preview:null,state:'failed'},
 {call:'call_4',tool:'sheets',preview:'budget split over 30 days',state:'done'}];

test('a completed Run\'s tool calls are kept once with its reply, a failed call as failed, and closing it again changes nothing',async()=>{
 const fake=fakeEngine(); fake.settings.steps=calls;
 const {db,rows,closed,seals}=database(fake,{stale:true});
 const run=await start(fake);
 assert.equal(await close(db,fake),1);
 assert.equal(closed.get(run).reply,'Reply to: Plan the ads');
 assert.deepEqual(rows.get(run),{steps:sealed,readTo:7,broken:false,seconds:41,sealed:1});
 assert.equal(await close(db,fake),0,'a second closer that still found the Run open');
 assert.equal(seals.length,1,'it found the steps sealed and kept nothing');
 assert.deepEqual([...rows.keys()],[run]);
 assert.deepEqual(rows.get(run),{steps:sealed,readTo:7,broken:false,seconds:41,sealed:1});
});

test('the follower keeps what it read while the Run works, and the closer reads only the events after it',async()=>{
 const fake=fakeEngine(); fake.settings.steps=calls; fake.settings.pendingReads=1;
 const {db,rows}=database(fake);
 const run=await start(fake);
 const following=new Map();
 await follow(db,fake,following);
 assert.deepEqual(rows.get(run),{steps:sealed,readTo:7,broken:false,seconds:null,sealed:null});
 assert.equal(following.size,0,'a follower whose stream closed is started again on a later pass');
 fake.forget(run,8);
 assert.equal(await close(db,fake),0,'still working');
 assert.equal(await close(db,fake),1);
 assert.deepEqual(rows.get(run),{steps:sealed,readTo:7,broken:false,seconds:41,sealed:1},'the events the Engine no longer keeps had all been read');
});

test('a read again from an earlier number ends at the same steps',async()=>{
 const fake=fakeEngine(); fake.settings.steps=calls;
 const {db,rows}=database(fake);
 const run=await start(fake);
 const events=[];
 for await(const event of fake.engineFor({}).steps(run)) if(!('end' in event)) events.push(event);
 const once=events.reduce(withEvent,{steps:[],readTo:-1,broken:false});
 assert.deepEqual(events.slice(2).reduce(withEvent,once),once,'events already read change nothing');
 rows.set(run,{...events.slice(0,3).reduce(withEvent,{steps:[],readTo:-1,broken:false}),readTo:1,seconds:null,sealed:null});
 await followRun(db,fake.engineFor({}),{conversation,run},new AbortController().signal);
 assert.deepEqual(rows.get(run)?.steps,once.steps,'a follower started from an earlier number');
 assert.deepEqual(once.steps,sealed);
});

test('a call with no id ends the oldest call of its tool still started',()=>{
 const read=[{seq:0,step:{call:'seq:0',tool:'web_search',preview:'audiences',state:/** @type {const} */('started')}},{seq:1,step:{call:'seq:1',tool:'web_search',preview:'ads',state:/** @type {const} */('started')}},
  {seq:2,step:{call:null,tool:'web_search',preview:null,state:/** @type {const} */('failed')}},{seq:3,step:{call:null,tool:'web_search',preview:null,state:/** @type {const} */('done')}}].reduce(withEvent,{steps:[],readTo:-1,broken:false});
 assert.deepEqual(read.steps.map(step=>[step.preview,step.state]),[['audiences','failed'],['ads','done']]);
});

test('a Run whose events were never read and that the Engine no longer keeps stores none',async()=>{
 const fake=fakeEngine(); fake.settings.steps=calls;
 const {db,rows,seals}=database(fake);
 const run=await start(fake);
 fake.sweep(run);
 assert.equal(await close(db,fake),1);
 assert.equal(rows.size,0);
 assert.equal(seals.length,0);
});

test('a Run that failed or was stopped seals nothing, also what its follower read',async()=>{
 for(const end of ['failed','stopped']) {
  const fake=fakeEngine(); fake.settings.steps=calls; fake.settings.pendingReads=1;
  const {db,rows,closed,seals}=database(fake);
  const run=await start(fake);
  await follow(db,fake);
  if(end==='failed') { fake.settings.ending='failed'; await close(db,fake); } else await fake.engineFor({}).stop(run);
  assert.equal(await close(db,fake),1,end);
  assert.equal(closed.get(run).run_outcome,end);
  assert.equal(seals.length,0,`a ${end} Run is never sealed`);
  assert.equal(rows.get(run)?.sealed,null,'and what the follower read is never shown');
 }
});

test('events lost before they were read, or an Engine that cannot be asked at the close, seal the steps as broken and the Run still closes',async()=>{
 const lost=fakeEngine(); lost.settings.steps=calls;
 const first=database(lost);
 const run=await start(lost);
 lost.forget(run,2);
 assert.equal(await close(first.db,lost),1);
 assert.equal(first.rows.get(run)?.broken,true);
 const down=fakeEngine(); down.settings.steps=calls; down.settings.unreachableSteps=1;
 const second=database(down);
 const other=await start(down);
 assert.equal(await close(second.db,down),1);
 assert.equal(second.closed.get(other).run_outcome,'completed');
 assert.equal(second.rows.get(other)?.broken,true);
});

test('the worker follows each open Run once, and stops the follower of a Run that closed',async()=>{
 const fake=fakeEngine(); fake.settings.steps=calls; fake.settings.pendingReads=1e9;
 const {db,rows,closed}=database(fake);
 const run=await start(fake);
 const gone=new AbortController(); const following=new Map([[`${conversation}:fake_run_closed`,gone]]);
 const started=await followOpenRuns(db,{encryptionKey,following,engineFor:fake.engineFor});
 assert.equal(started.length,1);
 assert.ok(gone.signal.aborted,'the closed Run\'s follower is stopped');
 assert.deepEqual([...following.keys()],[`${conversation}:${run}`]);
 assert.equal((await followOpenRuns(db,{encryptionKey,following,engineFor:fake.engineFor})).length,0,'a Run already followed gets no second follower');
 await Promise.all(started);
 assert.deepEqual(rows.get(run)?.steps,sealed);
 fake.sweep(run);
 await Promise.all(await followOpenRuns(db,{encryptionKey,following,engineFor:fake.engineFor}));
 assert.equal((await followOpenRuns(db,{encryptionKey,following,engineFor:fake.engineFor})).length,0,'a Run whose events the Engine no longer keeps is not asked again');
 closed.set(run,{});
 await followOpenRuns(db,{encryptionKey,following,engineFor:fake.engineFor});
 assert.equal(following.size,0);
});

test('a call past the most a list holds breaks the list rather than showing fewer calls than the Run made',()=>{
 const started=/** @param {number} n */ n=>({seq:n,step:{call:`call_${n}`,tool:'web_search',preview:null,state:/** @type {const} */('started')}});
 const full=Array.from({length:1000},(_,n)=>started(n)).reduce(withEvent,{steps:[],readTo:-1,broken:false});
 assert.equal(full.steps.length,1000); assert.equal(full.broken,false);
 const over=withEvent(full,started(1000));
 assert.equal(over.steps.length,1000); assert.equal(over.broken,true,'the 1,001st call breaks the list');
 assert.equal(withEvent(full,{seq:1000,step:{call:'call_3',tool:'web_search',preview:null,state:'done'}}).broken,false,'an end of a call already listed does not');
});
