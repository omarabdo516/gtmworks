import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { forgetListeners } from '../lib/engine/transport.mjs';
import { startNotReached, startRun, startUnknown } from '../lib/engine/runs.mjs';
import { hermesEngine as engineFor } from '../lib/engine/contract.mjs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { noteInstructions, sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { agentToolSpecs } from '../lib/agent-tools.mjs';
import { readFileSync } from 'node:fs';

// A start whose outcome was once unknown stays unknown until Hermes names the run (ADR 0015): no later answer can prove
// it never started, so its reservation is never released or failed, and the worker asks again until Hermes says which.
const encryptionKey=Buffer.alloc(32,7).toString('base64');
const hermes={address:'http://hermes:8642',key:'test-only-key'};
// Each Company's Engine record, as the database holds it; the fake of the contract answers for the Engine.
for(const company of ['co']) engineRecord(company,hermes);
const failing=code=>Object.assign(new TypeError('fetch failed'),{cause:{code}});

test('a retry of an unknown start is never read as not started', async () => {
 const real=globalThis.fetch;
 const start={address:'http://127.0.0.1:8642',profile:'writer',key:'test-only-key',input:'Hello',sessionKey:'s',idempotencyKey:'k',retry:true};
 // Each scripted list starts on a listener with no health kept (the backoff has its own tests, engine-transport.test.mjs).
 const answers=list=>{ forgetListeners(); const queue=[...list]; globalThis.fetch=async()=>{ const next=queue.shift(); if(next instanceof Error) throw next; return new Response(JSON.stringify(typeof next==='string'?{run_id:next}:{error:{message:'x'}}),{status:typeof next==='string'?202:next}); }; };
 try {
  answers([failing('ECONNREFUSED')]); assert.equal(await startRun(start),startUnknown,'nothing connected');
  for(const status of [400,401,409,429,500]) { answers([status]); assert.equal(await startRun(start),startUnknown,String(status)); }
  answers(['run_7']); assert.equal(await startRun(start),'run_7','Hermes names the run');
  assert.equal(await startRun({...start,address:'http://203.0.113.9:8642'}),startUnknown,'an address no longer allowed');
  // The first start of a key can still be refused.
  answers([409]); assert.equal(await startRun({...start,retry:false}),null);
 } finally { globalThis.fetch=real; }
});

const connection='f9000000-0000-0000-0000-000000000001';
function databases({queue={state:'queued'},claim=[],usable=true,attempt=1,kept=true,instructions=null,runNote={offersTools:false},model=null,}={}) {
 const order=[]; const args={}; const reads=[]; const turn={started_at:null,failed_at:null,model_refused:false};
 const rpc=who=>async(name,given)=>{ order.push(`${who} ${name}`); args[name]=given;
  if(name==='conversation_agent') return {data:null,error:null};
  // #764: a send stores its turn first (queue_conversation_turn); the one starter claims it after.
  if(name==='queue_conversation_turn') return {data:queue,error:null};
  if(name==='record_conversation_turn') { turn.started_at='now'; return {data:true,error:null}; }
  if(name==='fail_conversation_turn') { turn.failed_at='now'; return {data:true,error:null}; }
  if(name==='refuse_run_model') { turn.failed_at='now'; turn.model_refused=true; return {data:true,error:null}; }
  if(name==='queued_conversations') return {data:[{conversation:'c'}],error:null};
  if(name==='claim_conversation_turn') return {data:claim,error:null};
  // begin_turn_start answers which attempt of the key this is (0: the reservation is no longer active).
  if(name==='begin_turn_start') return {data:attempt,error:null};
  // The run's note: its first start pins the tools offered then, as the text sent, and its rules; every later start
  if(name==='conversation_handover_agents') return {data:[],error:null};
  // reads them (pin_run). A run the previous app version already started keeps its tools and is told no rules.
  if(name==='pin_run') {
   if(runNote.rules===undefined&&!runNote.started) { runNote.tools=runNote.offersTools?`[${given.specs.create_agent}]`:null; runNote.rules=[]; }
   return {data:{tools:runNote.tools??null,rules:runNote.rules??[]},error:null};
  }
  if(name==='pin_run_history') return {data:null,error:null};
  if(name==='pin_run_model') return {data:model,error:null};
  // #143: every queued turn asks for the main Agent's brief, which the database answers null for any other Agent.
  if(name==='pin_lead_brief') return {data:null,error:null};
  if(name==='keep_unknown_start') return {data:kept,error:null};
  if(name==='release_queued_start') return {data:true,error:null};
  return {data:null,error:{message:'unexpected'}}; };
 const chain=(table,data)=>{ const read={table}; reads.push(read); const c={select:()=>c,eq:(column,value)=>{ read[column]=value; return c; },maybeSingle:async()=>({data,error:null})}; return c; };
 const key=encryptSecret('test-only-key',encryptionKey);
 // The person's read: the Agent. The service's: the claimed turn's Agent, the turn after its start, the Engine's record.
 const db={rpc:rpc('person'),from:table=>chain(table,{id:'a9000000-0000-0000-0000-000000000001',instructions})};
 const service={rpc:rpc('service'),from:table=>chain(table,table==='hermes_agents'?{instructions}:table==='conversation_queued_turns'?turn:{address:'http://hermes:8642',profile:'writer',state:usable?'connected':'unreachable',features:['run_submission'],key_encrypted:key})};
 return {db,service,order,args,reads};
}
const engine=(order,outcome)=>({engineFor:()=>({start:async run=>{ order.push(`start retry=${run.retry===true}`); return outcome; }})});

const waiting={company:'co',agent:'a',person:'p',send_key:'k',message:'Hi',connection,profile:'writer',note:null,retry:false};
test('a send stores its turn before the Engine is asked, and the one starter starts it after (#764)', async () => {
 // With the request's own start given to `later` (the route's after()), the send answers once the turn is stored, and
 // nothing has reached the Engine yet.
 const {db,service,order}=databases({claim:[waiting]}); const later=[];
 const sent=await withEngineContract(engine(order,'run_1').engineFor,()=>sendMessage(db,service,{company:'co',conversation:'c',sendKey:'k',message:'Hi',later:work=>{ later.push(()=>withEngineContract(engine(order,'run_1').engineFor,work)); }}));
 assert.deepEqual(sent,{conversation:'c',queued:true});
 assert.ok(order.includes('person queue_conversation_turn'));
 assert.ok(!order.some(step=>step.startsWith('start')),'the send answered before the Engine was asked');
 assert.ok(!order.some(step=>step.endsWith('reserve_conversation_turn')||step.endsWith('send_conversation_message')),'no direct start remains');
 await later[0]();
 assert.ok(order.indexOf('service claim_conversation_turn')<order.indexOf('start retry=false'),'the starter claims the turn, then starts it');
 assert.ok(order.includes('service record_conversation_turn'));
});

test('a send whose start is unknown is kept as its sender\'s turn for the worker to ask again', async () => {
 const {db,service,order,args}=databases({claim:[waiting]});
 const sent=await withEngineContract(engine(order,startUnknown).engineFor,()=>sendMessage(db,service,{company:'co',conversation:'c',sendKey:'k',message:'Hi'}));
 assert.deepEqual(sent,{conversation:'c',queued:true});
 assert.deepEqual(args.keep_unknown_start,{conversation:'c',message_key:'k'});
 assert.ok(order.includes('start retry=false'));
 // The attempt is recorded before Hermes is called, so a crash between the two never loses the run.
 assert.ok(order.indexOf('service begin_turn_start')>=0&&order.indexOf('service begin_turn_start')<order.indexOf('start retry=false'));
 assert.deepEqual(args.begin_turn_start,{conversation:'c',message_key:'k'});
 assert.ok(!order.some(step=>step.endsWith('fail_conversation_turn')),'the turn is never failed');
});

test('the worker asks again on a turn whose start was unknown, and never fails it', async () => {
 const turn={company:'co',agent:'a',person:'p',send_key:'k',message:'Hi',connection,profile:'writer',note:null};
 // A first start that is unknown is marked, so every later answer is read as unknown too.
 const first=databases({claim:[{...turn,retry:false}]});
 await withEngineContract(engine(first.order,startUnknown).engineFor,()=>startQueuedTurns(first.service,{}));
 assert.deepEqual(first.args.keep_unknown_start,{conversation:'c',message_key:'k'});
 assert.ok(first.order.indexOf('service begin_turn_start')>=0&&first.order.indexOf('service begin_turn_start')<first.order.indexOf('start retry=false'),'the attempt is recorded first');
 assert.ok(!first.order.includes('service fail_conversation_turn'));
 // Its retry is sent as a retry; a refusal then is not a proof, so the turn stays.
 const again=databases({claim:[{...turn,retry:true}],attempt:2});
 await withEngineContract(engine(again.order,null).engineFor,()=>startQueuedTurns(again.service,{}));
 assert.ok(again.order.includes('start retry=true'));
 assert.ok(!again.order.includes('service fail_conversation_turn'));
 // Nor does a Connection that cannot be used now: the turn waits for it.
 const unusable=databases({claim:[{...turn,retry:true}],usable:false});
 engineRecord('co',null);
 await withEngineContract(engine(unusable.order,'run_1').engineFor,()=>startQueuedTurns(unusable.service,{}));
 engineRecord('co',hermes);
 assert.ok(!unusable.order.some(step=>step.startsWith('start')));
 assert.ok(!unusable.order.includes('service fail_conversation_turn'));
 // A first start that is refused still fails its turn, so the next one can go.
 const refused=databases({claim:[{...turn,retry:false}]});
 await withEngineContract(engine(refused.order,null).engineFor,()=>startQueuedTurns(refused.service,{}));
 assert.ok(refused.order.includes('service fail_conversation_turn'));
});

// #140: the turn "Done it" queued has no typed message, and is still the person's own: a start whose answer was lost is
// asked again with the same key, the same input and the same pinned tools, as a retry.
test('a handed step\'s turn whose first start is unknown is asked again with the same request, as a retry', async () => {
 const message='Omar did the step you handed over, "Publish the article" in WordPress, and pressed "Done it" at 2026-11-17 07:05 UTC. Pick up from there.';
 const turn={company:'co',agent:'a',person:'p',send_key:'h',message,connection,profile:'writer',note:null};
 const runNote={offersTools:true}; const runs=[];
 const asked=(order,outcome)=>({engineFor:()=>({start:async run=>{ order.push(`start retry=${run.retry===true}`); runs.push(run); return outcome; }})});
 const first=databases({claim:[{...turn,retry:false}],runNote});
 await withEngineContract(asked(first.order,startUnknown).engineFor,()=>startQueuedTurns(first.service,{}));
 assert.deepEqual(first.args.keep_unknown_start,{conversation:'c',message_key:'h'});
 assert.ok(!first.order.includes('service fail_conversation_turn'));
 const again=databases({claim:[{...turn,retry:true}],attempt:2,runNote});
 assert.equal(await withEngineContract(asked(again.order,'run_9').engineFor,()=>startQueuedTurns(again.service,{})),1);
 assert.deepEqual(again.args.record_conversation_turn,{conversation:'c',message_key:'h',run:'run_9',started_on:connection});
 assert.deepEqual(runs.map(run=>[run.idempotencyKey,run.input,run.retry]),[['c:h',message,false],['c:h',message,true]]);
 assert.deepEqual(runs[1].tools,runs[0].tools,'the tools pinned at its first start');
 assert.ok(runs[0].tools?.length);
});

test('a second attempt of the same key is a retry, and is never released or failed', async () => {
 // The server stopped after the first attempt reached Hermes; the person sends again with the same key: it is the same
 // turn, and the starter's next attempt is a retry.
 const resend=databases({queue:{state:'queued'},claim:[waiting],attempt:2});
 const sent=await withEngineContract(engine(resend.order,null).engineFor,()=>sendMessage(resend.db,resend.service,{company:'co',conversation:'c',sendKey:'k',message:'Hi'}));
 assert.ok(resend.order.includes('start retry=true'));
 assert.ok(!resend.order.some(step=>step.endsWith('fail_conversation_turn')));
 assert.deepEqual(sent,{conversation:'c',queued:true});
 // A worker claims a turn another claimer (or a stopped worker) already attempted: its refusal fails nothing.
 const second=databases({claim:[waiting],attempt:2});
 await withEngineContract(engine(second.order,null).engineFor,()=>startQueuedTurns(second.service,{}));
 assert.ok(second.order.includes('start retry=true'));
 assert.ok(!second.order.includes('service fail_conversation_turn'));
 // Only the first attempt's refusal fails, and it names that attempt, so the database keeps a start another attempt
 // made meanwhile; the message stays, "not sent".
 const first=databases({claim:[waiting]});
 assert.deepEqual(await withEngineContract(engine(first.order,null).engineFor,()=>sendMessage(first.db,first.service,{company:'co',conversation:'c',sendKey:'k',message:'Hi'})),{error:'conversationHermesFailed',status:502});
 assert.deepEqual(first.args.fail_conversation_turn,{conversation:'c',message_key:'k',attempt:1});
});

// #158, review of #330: a waiting turn refused for its pinned model is settled in one database call that names its
// attempt, so the revert and the turn's failure commit together, or neither does.
test('a waiting turn the Engine refused for its model is refused and failed in one call, for its own attempt', async () => {
 const refused=databases({claim:[{company:'co',agent:'a',person:'p',send_key:'k',message:'Hi',connection,profile:'writer',note:null,retry:false}],attempt:1,model:{provider:'openrouter',model:'openai/gpt-5.5'}});
 await withEngineContract(engine(refused.order,null).engineFor,()=>startQueuedTurns(refused.service,{}));
 assert.deepEqual(refused.args.refuse_run_model,{conversation:'c',message_key:'k',attempt:1});
 assert.ok(!refused.order.includes('service fail_conversation_turn'),'the turn is failed inside the refusal, not by a second call');
});

// #413: an Engine that is not running never got the start, so it says nothing about the Conversation's model: the attempt
// is handed back, the turn waits as never started, and the model the Conversation chose is kept.
test('a turn whose Engine is not running is handed back, and its chosen model is not refused', async () => {
 const unreached=databases({claim:[waiting],model:{provider:'openrouter',model:'openai/gpt-5.5'}});
 assert.deepEqual(await withEngineContract(engine(unreached.order,startNotReached).engineFor,()=>sendMessage(unreached.db,unreached.service,{company:'co',conversation:'c',sendKey:'k',message:'Hi'})),{conversation:'c',queued:true});
 assert.deepEqual(unreached.args.release_queued_start,{conversation:'c',message_key:'k',attempt:1});
 assert.ok(!unreached.order.some(step=>step.endsWith(' refuse_run_model')||step.endsWith(' keep_unknown_start')||step.endsWith(' fail_conversation_turn')),'the model stays, and nothing is kept as unknown');
});

test('a run to an Agent with its own instructions carries them, then its sender\'s note', async () => {
 const instructions='You are the ad critic on RS Learning\'s marketing team.';
 const sent=[]; const engine={engineFor:()=>({start:async run=>{ sent.push(run.instructions); return 'run_1'; }})};
 const now=databases({instructions,claim:[{...waiting,agent:'a6',note:'Answer in short points.'}]});
 assert.deepEqual(await withEngineContract(engine.engineFor,()=>sendMessage(now.db,now.service,{company:'co',conversation:'c',sendKey:'k',message:'Hi'})),{conversation:'c'});
 const queued=databases({instructions,claim:[{...waiting,agent:'a7'}]});
 await withEngineContract(engine.engineFor,()=>startQueuedTurns(queued.service,{}));
 const plain=databases({claim:[{...waiting,agent:'a8'}]});
 await withEngineContract(engine.engineFor,()=>startQueuedTurns(plain.service,{}));
 assert.deepEqual(sent,[`${instructions}\n\n${noteInstructions('Answer in short points.')}`,instructions,undefined]);
 assert.ok(queued.reads.some(read=>read.table==='hermes_agents'&&read.id==='a7'&&read.company_id==='co'),'the claimed turn\'s Agent, in its Company');
});

// Hermes keeps each key's first body and refuses the key with any other (409); the answers to the first start are lost.
function hermesKeepingFirstBodies() {
 const real=globalThis.fetch; const bodies=[]; const runs=new Map(); let lost=2;
 // Only the Engine's requests are answered here; the read of its record goes to the database as ever.
 globalThis.fetch=async(url,init)=>{ if(!String(url).startsWith('http://hermes:8642')) return real(url,init); const {headers,body}=init; bodies.push(body); const key=headers['Idempotency-Key'];
  if(runs.has(key)&&runs.get(key)!==body) return new Response('{}',{status:409});
  runs.set(key,body); if(lost-->0) throw failing('ECONNRESET');
  return new Response(JSON.stringify({run_id:`run_${runs.size}`}),{status:202}); };
 return {bodies,restore:()=>{ globalThis.fetch=real; }};
}

test('a retry of a Lead start sends the tools of its first attempt, though the tools offered changed since', async () => {
 const spec=/** @type {import('../lib/engine.mjs').ToolSpec} */(agentToolSpecs.find(tool=>tool.name==='create_agent')); const offered=spec.description; const {bodies,restore}=hermesKeepingFirstBodies();
 const runNote={offersTools:true}; const message='Find me someone to run our Meta ads';
 try {
  const first=databases({runNote,claim:[{...waiting,message}]});
  assert.deepEqual(await sendMessage(first.db,first.service,{company:'co',conversation:'c',sendKey:'k',message}),{conversation:'c',queued:true});
  assert.ok(bodies[0].includes(`- create_agent: ${offered}`),'the first start offers create_agent');
  spec.description='Adds an agent, as a later version words it.';
  const again=databases({runNote,attempt:2,claim:[{company:'co',agent:'a',person:'p',send_key:'k',message,connection,profile:'writer',note:null,retry:true}]});
  assert.equal(await startQueuedTurns(again.service,{}),1);
  assert.equal(again.args.record_conversation_turn.run,'run_1','the worker\'s retry finds the run');
  assert.equal(new Set(bodies).size,1,'every attempt sent the first body');
  const fresh=databases({runNote:{offersTools:true},claim:[{...waiting,send_key:'k2',message}]});
  assert.deepEqual(await sendMessage(fresh.db,fresh.service,{company:'co',conversation:'c',sendKey:'k2',message}),{conversation:'c'});
  assert.ok(bodies.at(-1).includes(`- create_agent: ${spec.description}`),'a new run offers the tools as they are now');
 } finally { restore(); spec.description=offered; }
});

// During an update the previous app version serves on after the migrations (scripts/install.sh). It starts a Lead run
// with #89's spec, as it held it (lib/lead-tools.mjs before #14), and the database pins that spec for the run when that
// version asks whether the run offers tools (run_offers_tools, lead_tools_spec_89).
test('a Lead start the previous app version began is asked again with the body it sent', async () => {
 const previousSpecs=[{name:'create_agent',
  description:'Adds a lasting agent to the company\'s team for a job the person asked someone to take on, such as running their Meta ads. Use it only when they asked for that.',
  parameters:{type:'object',additionalProperties:false,required:['name','job','apps'],properties:{
   name:{type:'string',maxLength:100,description:'A short name for the agent.'},
   job:{type:'string',maxLength:200,description:'One sentence: the work it does.'},
   apps:{type:'array',maxItems:8,items:{type:'string',maxLength:40},description:'The apps it will use.'}}}}];
 const migration=readFileSync('supabase/migrations/20261216000000_role_templates.sql','utf8');
 const pinned=migration.match(/function public\.lead_tools_spec_89\(\) returns text[^$]*\$\$\s*select '((?:[^']|'')*)'/)?.[1].replaceAll("''","'");
 assert.ok(pinned,'the migration holds #89\'s spec');
 const {bodies,restore}=hermesKeepingFirstBodies(); const message='Find me someone to run our Meta ads';
 try {
  const previous=engineFor({address:'http://hermes:8642',profile:'writer',key:'test-only-key'});
  assert.equal(await previous.start({conversation:'c',input:message,idempotencyKey:'c:k',tools:previousSpecs,retry:false}),startUnknown,'its answer is lost');
  const again=databases({runNote:{offersTools:true,tools:pinned,started:true},attempt:2,claim:[{company:'co',agent:'a',person:'p',send_key:'k',message,connection,profile:'writer',note:null,retry:true}]});
  assert.equal(await startQueuedTurns(again.service,{}),1);
  assert.equal(bodies.length,3);
  assert.equal(new Set(bodies).size,1,'the new worker\'s retry sent the previous version\'s body, byte for byte');
  assert.equal(again.args.record_conversation_turn.run,'run_1','and its turn is recorded with the run Hermes named');
 } finally { restore(); }
});

// A start may wait twenty seconds on an engine that does not answer: queued starts run in their own worker loop, so they
// never hold back closing the runs of other conversations.
test('the worker closes runs and starts queued turns in separate loops', () => {
 const worker=readFileSync('worker/index.mjs','utf8');
 const loops=[...worker.matchAll(/loop\('([^']+)',([^]*?)\)(?=,\s*(?:\n\s*)?(?:hermes&&)?loop\(|\]\))/g)].map(match=>[match[1],match[2]]);
 const closing=loops.filter(([,body])=>body.includes('closeOpenRuns')), starting=loops.filter(([,body])=>body.includes('startQueuedTurns'));
 assert.equal(closing.length,1); assert.equal(starting.length,1);
 assert.notEqual(closing[0][0],starting[0][0]);
});
