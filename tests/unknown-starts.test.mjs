import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRun, startUnknown } from '../lib/hermes.mjs';
import { engineFor } from '../lib/engine.mjs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { noteInstructions, sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { agentToolSpecs } from '../lib/agent-tools.mjs';
import { readFileSync } from 'node:fs';

// A start whose outcome was once unknown stays unknown until Hermes names the run (ADR 0015): no later answer can prove
// it never started, so its reservation is never released or failed, and the worker asks again until Hermes says which.
const encryptionKey=Buffer.alloc(32,7).toString('base64');
const failing=code=>Object.assign(new TypeError('fetch failed'),{cause:{code}});

test('a retry of an unknown start is never read as not started', async () => {
 const real=globalThis.fetch;
 const start={address:'http://127.0.0.1:8642',profile:'writer',key:'test-only-key',input:'Hello',sessionKey:'s',idempotencyKey:'k',retry:true};
 const answers=list=>{ const queue=[...list]; globalThis.fetch=async()=>{ const next=queue.shift(); if(next instanceof Error) throw next; return new Response(JSON.stringify(typeof next==='string'?{run_id:next}:{error:{message:'x'}}),{status:typeof next==='string'?202:next}); }; };
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
function databases({reserve={state:'reserved',connection,note:null},claim=[],usable=true,attempt=1,kept=true,stored=false,instructions=null,runNote={offersTools:false}}={}) {
 const order=[]; const args={}; const reads=[];
 const rpc=who=>async(name,given)=>{ order.push(`${who} ${name}`); args[name]=given;
  if(name==='conversation_agent') return {data:null,error:null};
  if(name==='reserve_conversation_turn') return {data:reserve,error:null};
  if(name==='queued_conversations') return {data:[{conversation:'c'}],error:null};
  if(name==='claim_conversation_turn') return {data:claim,error:null};
  // begin_start answers which attempt of the key this is (0: the reservation is no longer active).
  if(name==='begin_start') return {data:attempt,error:null};
  // The run's note: its first start pins the tools offered then, as the text sent, and its rules; every later start
  // reads them (pin_run). A run the previous app version already started keeps its tools and is told no rules.
  if(name==='pin_run') {
   if(runNote.rules===undefined&&!runNote.started) { runNote.tools=runNote.offersTools?`[${given.specs.create_agent}]`:null; runNote.rules=[]; }
   return {data:{tools:runNote.tools??null,rules:runNote.rules??[]},error:null};
  }
  if(name==='pin_run_knowledge') return {data:[],error:null};
  if(name==='pin_run_history') return {data:null,error:null};
  if(name==='pin_run_model') return {data:null,error:null};
  if(name==='keep_unknown_start') return {data:kept,error:null};
  if(['keep_unknown_start','fail_conversation_turn','release_conversation_run','record_conversation_turn','send_conversation_message'].includes(name)) return {data:true,error:null};
  return {data:null,error:{message:'unexpected'}}; };
 const chain=(table,data)=>{ const read={table}; reads.push(read); const c={select:()=>c,eq:(column,value)=>{ read[column]=value; return c; },maybeSingle:async()=>({data,error:null})}; return c; };
 const key=encryptSecret('test-only-key',encryptionKey);
 // The person's reads: the Agent, and (after a lost start) whether the message was stored meanwhile.
 const db={rpc:rpc('person'),from:table=>chain(table,table==='conversation_messages'?(stored?{id:7}:null):{id:'a9000000-0000-0000-0000-000000000001',instructions})};
 const service={rpc:rpc('service'),from:table=>chain(table,table==='hermes_agents'?{instructions}:{address:'http://hermes:8642',profile:'writer',state:usable?'connected':'unreachable',features:['run_submission'],key_encrypted:key})};
 return {db,service,order,args,reads};
}
const engine=(order,outcome)=>({engineFor:()=>({start:async run=>{ order.push(`start retry=${run.retry===true}`); return outcome; }})});

test('a direct send whose start is unknown is kept as its sender\'s turn for the worker to ask again', async () => {
 const {db,service,order,args}=databases();
 const sent=await sendMessage(db,service,{company:'co',conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...engine(order,startUnknown)});
 assert.deepEqual(sent,{conversation:'c',queued:true});
 assert.deepEqual(args.keep_unknown_start,{conversation:'c',message_key:'k'});
 assert.ok(order.includes('start retry=false'));
 // The attempt is recorded before Hermes is called, so a crash between the two never loses the run.
 assert.ok(order.indexOf('service begin_start')>=0&&order.indexOf('service begin_start')<order.indexOf('start retry=false'));
 assert.deepEqual(args.begin_start,{conversation:'c',message_key:'k'});
 assert.ok(!order.some(step=>step.endsWith('release_conversation_run')),'the reservation is never released');
});

test('the worker asks again on a turn whose start was unknown, and never fails it', async () => {
 const turn={company:'co',agent:'a',person:'p',send_key:'k',message:'Hi',connection,note:null};
 // A first start that is unknown is marked, so every later answer is read as unknown too.
 const first=databases({claim:[{...turn,retry:false}]});
 await startQueuedTurns(first.service,{encryptionKey,...engine(first.order,startUnknown)});
 assert.deepEqual(first.args.keep_unknown_start,{conversation:'c',message_key:'k'});
 assert.ok(first.order.indexOf('service begin_start')>=0&&first.order.indexOf('service begin_start')<first.order.indexOf('start retry=false'),'the attempt is recorded first');
 assert.ok(!first.order.includes('service fail_conversation_turn'));
 // Its retry is sent as a retry; a refusal then is not a proof, so the turn stays.
 const again=databases({claim:[{...turn,retry:true}]});
 await startQueuedTurns(again.service,{encryptionKey,...engine(again.order,null)});
 assert.ok(again.order.includes('start retry=true'));
 assert.ok(!again.order.includes('service fail_conversation_turn'));
 // Nor does a Connection that cannot be used now: the turn waits for it.
 const unusable=databases({claim:[{...turn,retry:true}],usable:false});
 await startQueuedTurns(unusable.service,{encryptionKey,...engine(unusable.order,'run_1')});
 assert.ok(!unusable.order.some(step=>step.startsWith('start')));
 assert.ok(!unusable.order.includes('service fail_conversation_turn'));
 // A first start that is refused still fails its turn, so the next one can go.
 const refused=databases({claim:[{...turn,retry:false}]});
 await startQueuedTurns(refused.service,{encryptionKey,...engine(refused.order,null)});
 assert.ok(refused.order.includes('service fail_conversation_turn'));
});

// #140: the turn "Done it" queued has no typed message, and is still the person's own: a start whose answer was lost is
// asked again with the same key, the same input and the same pinned tools, as a retry.
test('a handed step\'s turn whose first start is unknown is asked again with the same request, as a retry', async () => {
 const message='Omar did the step you handed over, "Publish the article" in WordPress, and pressed "Done it" at 2026-11-17 07:05 UTC. Pick up from there.';
 const turn={company:'co',agent:'a',person:'p',send_key:'h',message,connection,note:null};
 const runNote={offersTools:true}; const runs=[];
 const asked=(order,outcome)=>({engineFor:()=>({start:async run=>{ order.push(`start retry=${run.retry===true}`); runs.push(run); return outcome; }})});
 const first=databases({claim:[{...turn,retry:false}],runNote});
 await startQueuedTurns(first.service,{encryptionKey,...asked(first.order,startUnknown)});
 assert.deepEqual(first.args.keep_unknown_start,{conversation:'c',message_key:'h'});
 assert.ok(!first.order.includes('service fail_conversation_turn'));
 const again=databases({claim:[{...turn,retry:true}],attempt:2,runNote});
 assert.equal(await startQueuedTurns(again.service,{encryptionKey,...asked(again.order,'run_9')}),1);
 assert.deepEqual(again.args.record_conversation_turn,{conversation:'c',message_key:'h',run:'run_9',started_on:connection});
 assert.deepEqual(runs.map(run=>[run.idempotencyKey,run.input,run.retry]),[['c:h',message,false],['c:h',message,true]]);
 assert.deepEqual(runs[1].tools,runs[0].tools,'the tools pinned at its first start');
 assert.ok(runs[0].tools?.length);
});

test('a second attempt of the same key is a retry, and is never released or failed', async () => {
 // The server stopped after the first attempt reached Hermes; the person sends again with the same key.
 const resend=databases({attempt:2});
 const sent=await sendMessage(resend.db,resend.service,{company:'co',conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...engine(resend.order,null)});
 assert.ok(resend.order.includes('start retry=true'));
 assert.ok(!resend.order.some(step=>step.endsWith('release_conversation_run')));
 assert.deepEqual(sent,{conversation:'c',queued:true});
 // A worker claims a turn another claimer (or a stopped worker) already attempted: its refusal fails nothing.
 const turn={company:'co',agent:'a',person:'p',send_key:'k',message:'Hi',connection,note:null,retry:false};
 const second=databases({claim:[turn],attempt:2});
 await startQueuedTurns(second.service,{encryptionKey,...engine(second.order,null)});
 assert.ok(second.order.includes('start retry=true'));
 assert.ok(!second.order.includes('service fail_conversation_turn'));
 // Only the first attempt's refusal releases or fails, and it names that attempt, so the database keeps a start
 // another attempt made meanwhile.
 const first=databases();
 assert.deepEqual(await sendMessage(first.db,first.service,{company:'co',conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...engine(first.order,null)}),{error:'conversationHermesFailed',status:502});
 assert.deepEqual(first.args.release_conversation_run,{conversation:'c',c:'co',message_key:'k',attempt:1});
 const failed=databases({claim:[turn]});
 await startQueuedTurns(failed.service,{encryptionKey,...engine(failed.order,null)});
 assert.deepEqual(failed.args.fail_conversation_turn,{conversation:'c',message_key:'k',attempt:1});
});

test('a lost start whose reservation is gone answers by what was stored, never as waiting', async () => {
 // Another attempt's record landed meanwhile: the message was sent.
 const sent=databases({kept:false,stored:true});
 assert.deepEqual(await sendMessage(sent.db,sent.service,{company:'co',conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...engine(sent.order,startUnknown)}),{conversation:'c'});
 // Nothing stored and nothing kept: the person is asked to send again.
 const lost=databases({kept:false});
 assert.deepEqual(await sendMessage(lost.db,lost.service,{company:'co',conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...engine(lost.order,startUnknown)}),{error:'conversationSendAgain',status:409});
});

test('a run to an Agent with its own instructions carries them, then its sender\'s note, sent now or queued', async () => {
 const instructions='You are the ad critic on RS Learning\'s marketing team.';
 const sent=[]; const engine={engineFor:()=>({start:async run=>{ sent.push(run.instructions); return 'run_1'; }})};
 const now=databases({instructions,reserve:{state:'reserved',connection,note:'Answer in short points.'}});
 assert.deepEqual(await sendMessage(now.db,now.service,{company:'co',conversation:'c',sendKey:'k',message:'Hi',encryptionKey,...engine}),{conversation:'c'});
 const queued=databases({instructions,claim:[{company:'co',agent:'a7',person:'p',send_key:'k',message:'Hi',connection,note:null,retry:false}]});
 await startQueuedTurns(queued.service,{encryptionKey,...engine});
 const plain=databases({claim:[{company:'co',agent:'a8',person:'p',send_key:'k',message:'Hi',connection,note:null,retry:false}]});
 await startQueuedTurns(plain.service,{encryptionKey,...engine});
 assert.deepEqual(sent,[`${instructions}\n\n${noteInstructions('Answer in short points.')}`,instructions,undefined]);
 assert.ok(queued.reads.some(read=>read.table==='hermes_agents'&&read.id==='a7'&&read.company_id==='co'),'the claimed turn\'s Agent, in its Company');
});

// Hermes keeps each key's first body and refuses the key with any other (409); the answers to the first start are lost.
function hermesKeepingFirstBodies() {
 const real=globalThis.fetch; const bodies=[]; const runs=new Map(); let lost=2;
 globalThis.fetch=async(_,{headers,body})=>{ bodies.push(body); const key=headers['Idempotency-Key'];
  if(runs.has(key)&&runs.get(key)!==body) return new Response('{}',{status:409});
  runs.set(key,body); if(lost-->0) throw failing('ECONNRESET');
  return new Response(JSON.stringify({run_id:`run_${runs.size}`}),{status:202}); };
 return {bodies,restore:()=>{ globalThis.fetch=real; }};
}

test('a retry of a Lead start sends the tools of its first attempt, though the tools offered changed since', async () => {
 const spec=/** @type {import('../lib/engine.mjs').ToolSpec} */(agentToolSpecs.find(tool=>tool.name==='create_agent')); const offered=spec.description; const {bodies,restore}=hermesKeepingFirstBodies();
 const runNote={offersTools:true}; const message='Find me someone to run our Meta ads';
 try {
  const first=databases({runNote});
  assert.deepEqual(await sendMessage(first.db,first.service,{company:'co',conversation:'c',sendKey:'k',message,encryptionKey}),{conversation:'c',queued:true});
  assert.ok(bodies[0].includes(`- create_agent: ${offered}`),'the first start offers create_agent');
  spec.description='Adds an agent, as a later version words it.';
  const again=databases({runNote,attempt:2,claim:[{company:'co',agent:'a',person:'p',send_key:'k',message,connection,note:null,retry:true}]});
  assert.equal(await startQueuedTurns(again.service,{encryptionKey}),1);
  assert.equal(again.args.record_conversation_turn.run,'run_1','the worker\'s retry finds the run');
  assert.equal(new Set(bodies).size,1,'every attempt sent the first body');
  const fresh=databases({runNote:{offersTools:true}});
  assert.deepEqual(await sendMessage(fresh.db,fresh.service,{company:'co',conversation:'c',sendKey:'k2',message,encryptionKey}),{conversation:'c'});
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
  const again=databases({runNote:{offersTools:true,tools:pinned,started:true},attempt:2,claim:[{company:'co',agent:'a',person:'p',send_key:'k',message,connection,note:null,retry:true}]});
  assert.equal(await startQueuedTurns(again.service,{encryptionKey}),1);
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
