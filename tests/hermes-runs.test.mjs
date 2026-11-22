import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes, noProviderError, creditExhaustedError, apiKeyRefusedError, signInRefusedError, modelMissingError, failedRunText } from './fake-hermes.mjs';
import { startRun, readRun, startNotReached, startUnknown } from '../lib/hermes.mjs';
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
  answers([failing('ECONNREFUSED')]); assert.equal(await startRun(start),startNotReached,'a first start nothing connected to never reached Hermes');
  answers([409]); assert.equal(await startRun(start),null);
 } finally { globalThis.fetch=real; }
});

test('a refused Hermes starts no run, and one nothing connects to is never reached',async()=>{
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
 assert.equal(await startRun({...input,address}),startNotReached);
 // The same Hermes on a retry proves nothing: an earlier attempt may have reached it.
 assert.equal(await startRun({...input,address,retry:true}),startUnknown);
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

test('a run that failed because the Engine has no model provider says so; any other failure does not',async()=>{
 const fake=await fakeHermes(); fake.settings.ending='failed'; fake.settings.failure=noProviderError;
 try {
  const run=await startRun({...connection(fake),input:'Hello',sessionKey:'s',idempotencyKey:'k'});
  assert.deepEqual(await readRun({...connection(fake),run}),{status:'failed',output:null,session:'s',usage:{input:14000,output:12},noModel:true});
  assert.equal((await engineFor(connection(fake)).read(run)).noModel,true);
  fake.settings.failure='⚠️ Provider authentication failed: HTTP 401: invalid x-api-key';
  assert.equal((await readRun({...connection(fake),run})).noModel,undefined);
  assert.equal((await engineFor(connection(fake)).read(run)).noModel,undefined);
 } finally { await fake.close(); }
});

test('a run that failed for no credit, a refused key or sign-in, or a missing model says which; any other failure does not',async()=>{
 const fake=await fakeHermes(); fake.settings.ending='failed';
 try {
  const run=await startRun({...connection(fake),input:'Hello',sessionKey:'s',idempotencyKey:'k'});
  for(const [sentence,reason] of [[creditExhaustedError,'credit'],[apiKeyRefusedError,'key'],[signInRefusedError,'key'],[modelMissingError,'model']]) {
   fake.settings.failure=sentence;
   assert.equal((await readRun({...connection(fake),run})).modelRefused,reason);
   assert.equal((await engineFor(connection(fake)).read(run)).modelRefused,reason);
  }
  fake.settings.failure=failedRunText;
  assert.equal((await readRun({...connection(fake),run})).modelRefused,undefined);
  assert.equal((await engineFor(connection(fake)).read(run)).modelRefused,undefined);
 } finally { await fake.close(); }
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

// #647: an Agent that writes its answer so far in the same message that asks (or that calls a tool waiting for approval)
// keeps those words only in its session until the Run completes, and the completed output holds only what came after
// the pause. The driver reads them from the session while the Run waits, once, and the reply after the answer has none.
test('words written before a question or an approval are read from the session while the Run waits, and the reply after it does not carry them',async()=>{
 const fake=await fakeHermes();
 const five='Five Agents I advise:\n1. Writer — drafts posts alone\n2. Analyst — reads the numbers';
 fake.settings.questions=input=>input==='Which Agents?'?[{question:'Which of them do we make now?',choices:['Writer','Analyst'],multi_select:true,said:five}]:input==='Plan the ads'?[{question:'Which audience first?',choices:['Parents','Students'],said:''}]:[];
 fake.settings.approvals=input=>input==='Clean up'?[{description:'delete the old exports',command:'rm -r /srv/exports',said:'The exports folder is 4 GB of old files.'}]:[];
 fake.settings.reply=input=>input==='Which Agents?'?'Making Writer and Analyst now.':`Reply to: ${input}`;
 try {
  const engine=engineFor({...connection(fake),managementAddress:fake.managementAddress});
  const run=/** @type {string} */(await engine.start({conversation:'s1',input:'Which Agents?',idempotencyKey:'k1'}));
  const waiting=await engine.read(run);
  assert.equal(waiting.said,five);
  assert.equal(waiting.question?.text,'Which of them do we make now?');
  assert.equal((await engine.read(run)).said,five,'the same words on every read while it waits');
  assert.equal(await engine.answer(run,/** @type {string} */(waiting.question?.id),'Writer, Analyst'),'answered');
  assert.deepEqual(await engine.read(run),{state:'completed',reply:'Making Writer and Analyst now.',session:'s1',usage:{input:14000,output:12},toolCalls:[]});
  // A message that asked with no words of its own has none; a request to allow an action carries its message's words.
  const quiet=/** @type {string} */(await engine.start({conversation:'s2',input:'Plan the ads',idempotencyKey:'k2'}));
  const asked=await engine.read(quiet);
  assert.ok(asked.question&&!('said' in asked));
  const cleaning=/** @type {string} */(await engine.start({conversation:'s3',input:'Clean up',idempotencyKey:'k3'}));
  const allowing=await engine.read(cleaning);
  assert.equal(allowing.permission?.description,'delete the old exports');
  assert.equal(allowing.said,'The exports folder is 4 GB of old files.');
  // A session the listener cannot read leaves the question as it is, with no words.
  const unread=await engineFor({...connection(fake),managementAddress:'http://127.0.0.1:1'}).read(cleaning);
  assert.ok(unread.permission&&!('said' in unread));
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

// #163, as the pinned release does it (api_server_runs.py _make_approval_notify, _handle_run_approval): a Run that stops
// to ask before an action reports waiting_for_approval with the request in `approval`; the driver reads it as running
// with the request, and the choice goes on the Run's own route with exactly {choice, request_id}.
const permits=(/** @type {any} */ fake,/** @type {{description:string,command:string,choices?:string[]}[]} */ approvals)=>{ fake.settings.approvals=()=>approvals; fake.settings.reply=(/** @type {string} */ input,/** @type {unknown[]} */ _answers,/** @type {(string|null)[]} */ choices)=>`Reply to: ${input} (${choices.map(choice=>choice??'not allowed').join(', ')})`; };
const sentPermits=(/** @type {any} */ fake)=>fake.settings.permits.map((/** @type {{status:number,body:any}} */ {status,body})=>[status,body]);
const deletes={description:'recursive delete',command:'rm -rf /tmp/exports'};

test('a waiting Run reads as running with the request: its id, its words and its choices, never the session choice',async()=>{
 const fake=await fakeHermes(); permits(fake,[deletes,{description:'',command:'curl -X POST https://example.com',choices:['once','session','deny']}]);
 try {
  const engine=engineFor(connection(fake)); const run=/** @type {string} */(await engine.start({conversation:'s',input:'Clean up',idempotencyKey:'k'}));
  const [first,second]=fake.settings.runs[0].approvals;
  assert.deepEqual(await engine.read(run),{state:'running',reply:null,session:'s',usage:null,toolCalls:[],
   permission:{id:first.request_id,description:'recursive delete',command:'rm -rf /tmp/exports',choices:['once','always','deny'],allows:['recursive delete']}});
  assert.equal(await engine.permit(run,first.request_id,'once'),'answered');
  assert.deepEqual((await engine.read(run)).permission,{id:second.request_id,description:'',command:'curl -X POST https://example.com',choices:['once','deny'],allows:[]},
   'a request Hermes will not keep for later offers once and deny only');
 } finally { await fake.close(); }
});

test('Allow once, Always allow and Don\'t allow each post exactly the choice and the request\'s id, once, and the same Run goes on',async()=>{
 const fake=await fakeHermes(); permits(fake,[deletes,deletes,deletes]);
 try {
  const engine=engineFor(connection(fake)); const run=/** @type {string} */(await engine.start({conversation:'s',input:'Clean up',idempotencyKey:'k'}));
  for(const choice of /** @type {const} */(['once','always','deny'])) {
   const {permission}=await engine.read(run);
   assert.equal(await engine.permit(run,/** @type {string} */(permission?.id),choice),'answered');
  }
  const ids=fake.settings.runs[0].approvals.map((/** @type {{request_id:string}} */ asking)=>asking.request_id);
  assert.deepEqual(sentPermits(fake),[[200,{choice:'once',request_id:ids[0]}],[200,{choice:'always',request_id:ids[1]}],[200,{choice:'deny',request_id:ids[2]}]]);
  assert.ok(fake.settings.requests.some(request=>request.method==='POST'&&request.path===`/p/writer/v1/runs/${run}/approval`&&request.authorization==='Bearer test-only-key'));
  assert.deepEqual(await engine.read(run),{state:'completed',reply:'Reply to: Clean up (once, always, deny)',session:'s',usage:{input:14000,output:12},toolCalls:[]});
  assert.equal(fake.settings.runs.length,1,'no second Run');
 } finally { await fake.close(); }
});

test('a choice for a request Hermes no longer waits on is gone: answered already, timed out, stopped, ended or unknown',async()=>{
 const fake=await fakeHermes(); permits(fake,[deletes,deletes]);
 try {
  const engine=engineFor(connection(fake)); const run=/** @type {string} */(await engine.start({conversation:'s',input:'Clean up',idempotencyKey:'k'}));
  const first=/** @type {string} */((await engine.read(run)).permission?.id);
  assert.equal(await engine.permit(run,first,'once'),'answered');
  assert.equal(await engine.permit(run,first,'deny'),'gone','a second choice for the same request');
  const second=/** @type {string} */((await engine.read(run)).permission?.id);
  assert.ok(fake.settings.expireApproval(run));
  assert.equal(await engine.permit(run,second,'once'),'gone','a request Hermes timed out');
  assert.deepEqual(await engine.read(run),{state:'completed',reply:'Reply to: Clean up (once, not allowed)',session:'s',usage:{input:14000,output:12},toolCalls:[]},
   'the Run reads with no request and goes on to its reply');
  assert.equal(await engine.permit(run,second,'once'),'gone','an ended Run waits on nothing');
  assert.equal(await engine.permit('run_unknown',second,'once'),'gone','a Run Hermes does not know');
  assert.deepEqual(sentPermits(fake).map(([status,body])=>[status,body.choice]),[[200,'once'],[409,'deny'],[409,'once'],[409,'once'],[404,'once']]);
 } finally { await fake.close(); }
});

test('a refusal whose code is at the top of the body reads the same: a request Hermes no longer waits on is gone',async()=>{
 const fake=await fakeHermes(); permits(fake,[deletes,deletes]);
 fake.settings.flatPermitErrors=true;
 try {
  const engine=engineFor(connection(fake)); const run=/** @type {string} */(await engine.start({conversation:'s',input:'Clean up',idempotencyKey:'k'}));
  const first=/** @type {string} */((await engine.read(run)).permission?.id);
  assert.equal(await engine.permit(run,first,'once'),'answered');
  assert.equal(await engine.permit(run,first,'deny'),'gone','approval_not_pending');
  await engine.read(run);
  assert.equal(await engine.permit('run_unknown',first,'once'),'gone','run_not_found');
  const second=/** @type {string} */((await engine.read(run)).permission?.id);
  assert.equal(await engine.permit(run,second,'once'),'answered');
  await engine.read(run);
  assert.equal(await engine.permit(run,second,'once'),'gone','approval_not_active');
  assert.deepEqual(sentPermits(fake).map(([status,body])=>[status,body.choice]),[[200,'once'],[409,'deny'],[404,'once'],[200,'once'],[409,'once']]);
 } finally { await fake.close(); }
});

test('a stop: the waiting Run is stopped with no request left, and a choice for it is gone',async()=>{
 const fake=await fakeHermes(); permits(fake,[deletes]);
 try {
  const engine=engineFor(connection(fake)); const run=/** @type {string} */(await engine.start({conversation:'s',input:'Clean up',idempotencyKey:'k'}));
  const {permission}=await engine.read(run);
  assert.equal(await engine.stop(run),true);
  assert.deepEqual(await engine.read(run),{state:'stopped',reply:null,session:'s',usage:null,toolCalls:[]});
  assert.equal(await engine.permit(run,/** @type {string} */(permission?.id),'once'),'gone');
  assert.deepEqual(sentPermits(fake).map(([status])=>status),[409]);
 } finally { await fake.close(); }
});

test('a choice Hermes could not take, or one to an address no longer allowed, is sent again; a malformed id or choice sends nothing',async()=>{
 const fake=await fakeHermes(); permits(fake,[deletes]);
 try {
  const engine=engineFor(connection(fake)); const run=/** @type {string} */(await engine.start({conversation:'s',input:'Clean up',idempotencyKey:'k'}));
  const id=/** @type {string} */((await engine.read(run)).permission?.id);
  fake.settings.status=500;
  assert.equal(await engine.permit(run,id,'once'),'unreachable');
  fake.settings.status=200;
  assert.equal(await engineFor({...connection(fake),address:'http://203.0.113.9:8642'}).permit(run,id,'once'),'unreachable');
  const engineFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response('<html>Not Found</html>',{status:404});
  try { assert.equal(await engine.permit(run,id,'once'),'unreachable','a 404 that is not Hermes forgetting the Run keeps the request open'); }
  finally { globalThis.fetch=engineFetch; }
  globalThis.fetch=async()=>{ throw new TypeError('fetch failed'); };
  try { assert.equal(await engine.permit(run,id,'once'),'unreachable','nothing answered'); }
  finally { globalThis.fetch=engineFetch; }
  assert.equal(await engine.permit(run,'not a request id','once'),'gone');
  assert.equal(await engine.permit(run,id,/** @type {any} */('session')),'gone');
  assert.deepEqual(sentPermits(fake),[],'neither reached Hermes');
  assert.equal(await engine.permit(run,id,'once'),'answered');
 } finally { await fake.close(); }
});
