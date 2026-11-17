import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { startRun, readRun, startUnknown } from '../lib/hermes.mjs';
import { engineFor } from '../lib/engine.mjs';

const connection=fake=>({address:fake.address,profile:'writer',key:'test-only-key'});

test('a message starts one run in the conversation session of the chosen profile',async()=>{
 const fake=await fakeHermes();
 try {
  const message={...connection(fake),input:'Plan the launch post',sessionKey:'conversation-1',idempotencyKey:'conversation-1:message-1'};
  const first=await startRun(message);
  assert.equal(typeof first,'string');
  assert.equal(await startRun(message),first);
  assert.equal(fake.settings.runs.length,1);
  const sent=fake.settings.requests.filter(request=>request.method==='POST');
  assert.deepEqual(sent.map(request=>request.path),['/p/writer/v1/runs','/p/writer/v1/runs']);
  assert.ok(sent.every(request=>request.authorization==='Bearer test-only-key'&&request.session==='conversation-1'&&request.idempotency==='conversation-1:message-1'));
  assert.equal(fake.settings.runs[0].input,'Plan the launch post');
 } finally { await fake.close(); }
});

// A Member's note travels as the run's own instructions (Hermes v0.23.0 /v1/runs `instructions`, an ephemeral prompt),
// never inside the message; a run without a note sends no instructions at all.
test('a run carries the sender\'s instructions only when it has them',async()=>{
 const fake=await fakeHermes();
 try {
  await startRun({...connection(fake),input:'Plan the week',instructions:'Answer in short points.',sessionKey:'s',idempotencyKey:'k1'});
  await startRun({...connection(fake),input:'And the next',sessionKey:'s',idempotencyKey:'k2'});
  assert.deepEqual(fake.settings.runs.map(run=>[run.input,run.instructions]),[['Plan the week','Answer in short points.'],['And the next',undefined]]);
 } finally { await fake.close(); }
});

test('a run is read as pending until Hermes reports its terminal status, output and session',async()=>{
 const fake=await fakeHermes(); fake.settings.pendingReads=1;
 try {
  const run=await startRun({...connection(fake),input:'Hello',sessionKey:'s',idempotencyKey:'k'});
  assert.deepEqual(await readRun({...connection(fake),run}),{status:'running',output:null,session:'s',usage:null});
  assert.deepEqual(await readRun({...connection(fake),run}),{status:'completed',output:'Reply to: Hello',session:'s',usage:{input:14000,output:12}});
  fake.settings.status=500;
  assert.deepEqual(await readRun({...connection(fake),run}),{status:'unreachable',output:null,session:null,usage:null});
 } finally { await fake.close(); }
});

// A start whose answers are lost (the driver asks twice) may have started the run: it is unknown, never "not started",
// and asking again with the same key and body replays that run. The same key with another body is refused, as the pinned release refuses it.
test('a lost start answer is unknown, and the same key with another body is refused',async()=>{
 const fake=await fakeHermes(); fake.settings.loseStarts=2;
 try {
  const start={...connection(fake),input:'Plan the week',instructions:'Answer in short points.',sessionKey:'s',idempotencyKey:'k'};
  assert.equal(await startRun(start),startUnknown);
  assert.equal(fake.settings.runs.length,1);
  const run=await startRun(start);
  assert.equal(run,fake.settings.runs[0].id);
  assert.equal(await startRun({...start,instructions:'Changed note.'}),null);
  assert.equal(fake.settings.runs.length,1);
 } finally { await fake.close(); }
});

// Only the first attempt can prove a run did not start. Once an answer was lost, a later refusal or a closed
// connection proves nothing about the run the first attempt may have started; a gateway's 502, 503 or 504 never does.
test('after a lost answer every failure is unknown, and a gateway error is never a refusal',async()=>{
 const real=globalThis.fetch;
 const failing=code=>Object.assign(new TypeError('fetch failed'),{cause:{code}});
 const start={address:'http://127.0.0.1:8642',profile:'writer',key:'test-only-key',input:'Hello',sessionKey:'s',idempotencyKey:'k'};
 const answers=list=>{ const queue=[...list]; globalThis.fetch=async()=>{ const next=queue.shift(); if(next instanceof Error) throw next; return new Response(JSON.stringify({error:{message:'x'}}),{status:next}); }; };
 try {
  answers([failing('UND_ERR_SOCKET'),failing('ECONNREFUSED')]); assert.equal(await startRun(start),startUnknown);
  answers([failing('UND_ERR_SOCKET'),400]); assert.equal(await startRun(start),startUnknown);
  for(const status of [502,503,504]) { answers([status,status]); assert.equal(await startRun(start),startUnknown,String(status)); }
  answers([failing('ECONNREFUSED')]); assert.equal(await startRun(start),null);
  answers([409]); assert.equal(await startRun(start),null);
 } finally { globalThis.fetch=real; }
});

test('a refused or unreachable Hermes starts no run',async()=>{
 const fake=await fakeHermes(); const input={...connection(fake),input:'Hello',sessionKey:'s',idempotencyKey:'k'};
 try {
  assert.equal(await startRun({...input,key:'wrong'}),null);
  // Hermes's own error answer is a refusal; a gateway's 502, 503 or 504 is not (next test).
  fake.settings.status=500;
  assert.equal(await startRun(input),null);
 } finally { await fake.close(); }
 // A Hermes nothing can connect to starts no run. (A request on a socket the closed fake dropped after an earlier answer
 // is unknown instead: whether it reached Hermes cannot be told.)
 const gone=await fakeHermes(); const address=gone.address; await gone.close();
 assert.equal(await startRun({...input,address}),null);
});

test('a key is never sent to Hermes over plain HTTP on a public address',async()=>{
 const real=globalThis.fetch; const called=[];
 globalThis.fetch=async(...args)=>{ called.push(String(args[0])); return new Response('{}',{status:202}); };
 try {
  const exposed={address:'http://hermes.example.com',profile:'writer',key:'test-only-key'};
  assert.equal(await startRun({...exposed,input:'Hello',sessionKey:'s',idempotencyKey:'k'}),null);
  assert.deepEqual(await readRun({...exposed,run:'run_1'}),{status:'unreachable',output:null,session:null,usage:null});
  assert.deepEqual(called,[]);
 } finally { globalThis.fetch=real; }
});

test('a run Hermes no longer knows is read as lost, not as unreachable',async()=>{
 const fake=await fakeHermes();
 try {
  assert.deepEqual(await readRun({...connection(fake),run:'run_unknown'}),{status:'lost',output:null,session:null,usage:null});
 } finally { await fake.close(); }
 // Any other 404 (a wrong address, a proxy) is not Hermes forgetting the run: it stays open.
 const real=globalThis.fetch;
 globalThis.fetch=async()=>new Response('<html>Not Found</html>',{status:404});
 try { assert.deepEqual(await readRun({address:'http://127.0.0.1:9',profile:'writer',key:'k',run:'run_1'}),{status:'unreachable',output:null,session:null,usage:null}); }
 finally { globalThis.fetch=real; }
});

test('a Hermes answer larger than the limit is not read to its end, and its run is failed',async()=>{
 const real=globalThis.fetch; let pulled=0;
 const chunk=new Uint8Array(64*1024).fill(32);
 // A chunked body with no Content-Length that never ends.
 globalThis.fetch=async()=>new Response(new ReadableStream({pull(controller){ pulled++; controller.enqueue(pulled===1?new TextEncoder().encode('{"status":"completed","output":"'):chunk); }}),{status:200});
 try {
  assert.deepEqual(await readRun({address:'http://127.0.0.1:9',profile:'writer',key:'k',run:'run_1'}),{status:'failed',output:null,session:null,usage:null});
  assert.ok(pulled<=4*16+2,`read ${pulled} chunks`);
 } finally { globalThis.fetch=real; }
});

// #138, as measured on the pinned release: a Run asking with clarify stays running with the question in
// pending_controls; the driver reads it without Hermes's skip hint and recommended label, and answers on the Run's own
// route with exactly the body Hermes takes.
const asks=(/** @type {any} */ fake,/** @type {{question:string,choices?:string[],multi_select?:boolean}[]} */ questions)=>{ fake.settings.questions=()=>questions; fake.settings.reply=(/** @type {string} */ input,/** @type {(string|null)[]} */ answers)=>`Reply to: ${input} (${answers.map(answer=>answer??'unanswered').join(', ')})`; };
const sentAnswers=(/** @type {any} */ fake)=>fake.settings.answers.map((/** @type {{status:number,body:any}} */ {status,body})=>[status,body]);

test('a pick: the waiting Run reads as running with its question, the choice\'s text is sent back, and the same Run replies with it',async()=>{
 const fake=await fakeHermes(); asks(fake,[{question:'Which audience first?',choices:['Parents','Students','Teachers']}]);
 try {
  const engine=engineFor(connection(fake)); const run=/** @type {string} */(await engine.start({conversation:'s',input:'Plan the ads',idempotencyKey:'k'}));
  const waiting=await engine.read(run);
  assert.deepEqual(waiting,{state:'running',reply:null,session:'s',usage:null,toolCalls:[],question:{id:`${fake.settings.runs[0].asked[0].prompt_id}@1`,text:'Which audience first?',choices:['Parents','Students','Teachers'],multiple:false}});
  assert.equal(await engine.read(run).then(read=>read.question?.id),waiting.question?.id,'the same question until it is answered');
  assert.equal(await engine.answer(run,/** @type {string} */(waiting.question?.id),'Students'),'answered');
  assert.deepEqual(sentAnswers(fake),[[200,{request_id:fake.settings.runs[0].asked[0].prompt_id,execution_generation:1,answer:'Students'}]]);
  assert.ok(fake.settings.requests.some(request=>request.method==='POST'&&request.path===`/p/writer/v1/runs/${run}/clarify`&&request.authorization==='Bearer test-only-key'));
  // A second answer while the Run goes on is the one already taken.
  assert.equal(await engine.answer(run,/** @type {string} */(waiting.question?.id),'Parents'),'answered');
  assert.deepEqual(await engine.read(run),{state:'completed',reply:'Reply to: Plan the ads (Students)',session:'s',usage:{input:14000,output:12},toolCalls:[]});
  assert.equal(fake.settings.runs.length,1,'no second Run');
  assert.equal(await engine.answer(run,/** @type {string} */(waiting.question?.id),'Parents'),'gone','an ended Run waits for nothing');
 } finally { await fake.close(); }
});

test('a free answer: an open-ended or several-pick question is answered with the typed words as written, one question at a time',async()=>{
 const fake=await fakeHermes(); asks(fake,[{question:'What tone should the ads take?'},{question:'Which channels?',choices:['Meta','TikTok'],multi_select:true}]);
 try {
  const engine=engineFor(connection(fake)); const run=/** @type {string} */(await engine.start({conversation:'s',input:'Plan the ads',idempotencyKey:'k'}));
  const first=(await engine.read(run)).question;
  assert.deepEqual(first&&{text:first.text,choices:first.choices,multiple:first.multiple},{text:'What tone should the ads take?',choices:[],multiple:false});
  assert.equal(await engine.answer(run,/** @type {string} */(first?.id),'  Warm, and short.\n'),'answered');
  const second=(await engine.read(run)).question;
  assert.deepEqual(second&&{text:second.text,choices:second.choices,multiple:second.multiple},{text:'Which channels?',choices:['Meta','TikTok'],multiple:true},'one recommended label is Hermes\'s, not the Agent\'s');
  assert.notEqual(second?.id,first?.id);
  assert.equal(await engine.answer(run,/** @type {string} */(second?.id),'Meta and TikTok'),'answered');
  assert.deepEqual(sentAnswers(fake).map(([status,body])=>[status,body.answer]),[[200,'  Warm, and short.\n'],[200,'Meta and TikTok']]);
  assert.equal((await engine.read(run)).reply,'Reply to: Plan the ads (  Warm, and short.\n, Meta and TikTok)');
 } finally { await fake.close(); }
});

test('a time limit: once Hermes stops waiting the Run reads with no question and goes on to its reply, and a late answer is gone',async()=>{
 const fake=await fakeHermes(); asks(fake,[{question:'Which audience first?',choices:['Parents','Students']}]);
 try {
  const engine=engineFor(connection(fake)); const run=/** @type {string} */(await engine.start({conversation:'s',input:'Plan the ads',idempotencyKey:'k'}));
  const {question}=await engine.read(run);
  assert.ok(fake.settings.expire(run));
  assert.equal(await engine.answer(run,/** @type {string} */(question?.id),'Students'),'gone');
  assert.deepEqual(await engine.read(run),{state:'completed',reply:'Reply to: Plan the ads (unanswered)',session:'s',usage:{input:14000,output:12},toolCalls:[]});
 } finally { await fake.close(); }
});

test('a stop: the waiting Run is stopped with no question left, and an answer to it is gone',async()=>{
 const fake=await fakeHermes(); asks(fake,[{question:'Which audience first?',choices:['Parents','Students']}]);
 try {
  const engine=engineFor(connection(fake)); const run=/** @type {string} */(await engine.start({conversation:'s',input:'Plan the ads',idempotencyKey:'k'}));
  const {question}=await engine.read(run);
  assert.equal(await engine.stop(run),true);
  assert.deepEqual(await engine.read(run),{state:'stopped',reply:null,session:'s',usage:null,toolCalls:[]});
  assert.equal(await engine.answer(run,/** @type {string} */(question?.id),'Students'),'gone');
  assert.deepEqual(sentAnswers(fake).map(([status])=>status),[409]);
 } finally { await fake.close(); }
});

test('an answer Hermes could not take, or one to an address no longer allowed, is asked again; a question id that is not the driver\'s is gone',async()=>{
 const fake=await fakeHermes(); asks(fake,[{question:'Which audience first?',choices:['Parents','Students']}]);
 try {
  const engine=engineFor(connection(fake)); const run=/** @type {string} */(await engine.start({conversation:'s',input:'Plan the ads',idempotencyKey:'k'}));
  const id=/** @type {string} */((await engine.read(run)).question?.id);
  fake.settings.status=500;
  assert.equal(await engine.answer(run,id,'Students'),'unreachable');
  fake.settings.status=200;
  assert.equal(await engineFor({...connection(fake),address:'http://203.0.113.9:8642'}).answer(run,id,'Students'),'unreachable');
  assert.equal(await engine.answer(run,'not-a-question','Students'),'gone');
  const engineFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response('<html>Not Found</html>',{status:404});
  try { assert.equal(await engine.answer(run,id,'Students'),'unreachable','a 404 that is not Hermes forgetting the Run keeps the question open'); }
  finally { globalThis.fetch=engineFetch; }
  assert.equal(await engine.answer(run,id,'Students'),'answered');
 } finally { await fake.close(); }
});
