import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { engineFor } from '../lib/engine.mjs';

const connection=fake=>({address:fake.address,profile:'writer',key:'test-only-key'});
const message={conversation:'conversation-1',input:'Plan the launch post',idempotencyKey:'conversation-1:message-1'};

test('the Hermes driver starts one run per idempotency key, in the conversation session',async()=>{
 const fake=await fakeHermes();
 try {
  const engine=engineFor(connection(fake));
  const run=await engine.start(message);
  assert.equal(typeof run,'string');
  assert.equal(await engine.start(message),run);
  assert.deepEqual(fake.settings.runs.map(({session,input})=>({session,input})),[{session:'conversation-1',input:'Plan the launch post'}]);
 } finally { await fake.close(); }
});

test('the Hermes driver reads a slow run as running, then completed with the reply, session and usage',async()=>{
 const fake=await fakeHermes(); fake.settings.pendingReads=1;
 try {
  const engine=engineFor(connection(fake)); const run=await engine.start(message);
  assert.deepEqual(await engine.read(run),{state:'running',reply:null,session:'conversation-1',usage:null});
  assert.deepEqual(await engine.read(run),{state:'completed',reply:'Reply to: Plan the launch post',session:'conversation-1',usage:{input:14000,output:12}});
 } finally { await fake.close(); }
});

test('the Hermes driver reads a cancelled or interrupted run as stopped, and keeps its usage',async()=>{
 for(const ending of ['cancelled','interrupted']) {
  const fake=await fakeHermes(); fake.settings.ending=ending; fake.settings.usage={input_tokens:900,output_tokens:7};
  try {
   const engine=engineFor(connection(fake));
   assert.deepEqual(await engine.read(await engine.start(message)),{state:'stopped',reply:null,session:'conversation-1',usage:{input:900,output:7}});
  } finally { await fake.close(); }
 }
});

test('the Hermes driver reads failed, lost and unreachable runs in the contract states',async()=>{
 const fake=await fakeHermes(); fake.settings.ending='failed'; fake.settings.usage=undefined;
 try {
  const engine=engineFor(connection(fake)); const run=await engine.start(message);
  assert.deepEqual(await engine.read(run),{state:'failed',reply:null,session:'conversation-1',usage:null});
  assert.deepEqual(await engine.read('run_unknown'),{state:'lost',reply:null,session:null,usage:null});
  fake.settings.status=500;
  assert.deepEqual(await engine.read(run),{state:'unreachable',reply:null,session:null,usage:null});
  assert.equal(await engine.start({...message,idempotencyKey:'other'}),null);
 } finally { await fake.close(); }
});

test('the Hermes driver stops a run with the profile key and says whether Hermes accepted it',async()=>{
 const real=globalThis.fetch; const called=[];
 globalThis.fetch=async(url,init)=>{ called.push({url:String(url),method:init?.method,authorization:init?.headers?.Authorization,redirect:init?.redirect}); return new Response('{"status":"stopping"}',{status:called.length===1?200:409}); };
 try {
  const engine=engineFor({address:'http://127.0.0.1:9',profile:'writer',key:'test-only-key'});
  assert.equal(await engine.stop('run_1'),true);
  assert.equal(await engine.stop('run_1'),false);
  assert.deepEqual(called[0],{url:'http://127.0.0.1:9/p/writer/v1/runs/run_1/stop',method:'POST',authorization:'Bearer test-only-key',redirect:'manual'});
  // A key is never sent over plain HTTP to a public address.
  assert.equal(await engineFor({address:'http://hermes.example.com',profile:'writer',key:'k'}).stop('run_1'),false);
  assert.equal(called.length,2);
 } finally { globalThis.fetch=real; }
});
