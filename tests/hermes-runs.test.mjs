import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { startRun, readRun, startUnknown } from '../lib/hermes.mjs';

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
