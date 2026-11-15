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
  assert.deepEqual(await engine.read(run),{state:'running',reply:null,session:'conversation-1',usage:null,toolCalls:[]});
  assert.deepEqual(await engine.read(run),{state:'completed',reply:'Reply to: Plan the launch post',session:'conversation-1',usage:{input:14000,output:12},toolCalls:[]});
 } finally { await fake.close(); }
});

test('the Hermes driver reads a cancelled or interrupted run as stopped, and keeps its usage',async()=>{
 for(const ending of ['cancelled','interrupted']) {
  const fake=await fakeHermes(); fake.settings.ending=ending; fake.settings.usage={input_tokens:900,output_tokens:7};
  try {
   const engine=engineFor(connection(fake));
   assert.deepEqual(await engine.read(await engine.start(message)),{state:'stopped',reply:null,session:'conversation-1',usage:{input:900,output:7},toolCalls:[]});
  } finally { await fake.close(); }
 }
});

test('the Hermes driver reads failed, lost and unreachable runs in the contract states',async()=>{
 const fake=await fakeHermes(); fake.settings.ending='failed'; fake.settings.usage=undefined;
 try {
  const engine=engineFor(connection(fake)); const run=await engine.start(message);
  assert.deepEqual(await engine.read(run),{state:'failed',reply:null,session:'conversation-1',usage:null,toolCalls:[]});
  assert.deepEqual(await engine.read('run_unknown'),{state:'lost',reply:null,session:null,usage:null,toolCalls:[]});
  fake.settings.status=500;
  assert.deepEqual(await engine.read(run),{state:'unreachable',reply:null,session:null,usage:null,toolCalls:[]});
  assert.equal(await engine.start({...message,idempotencyKey:'other'}),null);
 } finally { await fake.close(); }
});

// Hermes v0.23.0 takes no tools from the caller: the driver offers them in the run's instructions with an exact reply
// format and reads the calls back out of the reply, which the person then reads without them (ADR 0009).
const createAgent={name:'create_agent',description:'Add an Agent to the team.',parameters:{type:/** @type {const} */('object'),properties:{name:{type:'string'}},required:['name']}};
const block=body=>`\`\`\`gtmworks-tool\n${body}\n\`\`\``;
test('the Hermes driver offers tools in the run\'s instructions and reads the calls out of the reply',async()=>{
 const fake=await fakeHermes();
 fake.settings.reply=()=>`Meta Ads is on the team now.\n\n${block('{"name":"create_agent","arguments":{"name":"Meta Ads"}}')}\n${block('not a call')}\n`;
 try {
  const engine=engineFor(connection(fake));
  const offered={...message,instructions:'Answer in short points.',tools:[createAgent]};
  const run=await engine.start(offered);
  const sent=fake.settings.runs[0].instructions;
  assert.ok(sent.startsWith('Answer in short points.\n\n'));
  assert.ok(sent.includes('```gtmworks-tool\n{"name":"<tool name>"'));
  assert.ok(sent.includes(`- create_agent: Add an Agent to the team. Its arguments, as JSON Schema: ${JSON.stringify(createAgent.parameters)}`));
  // The same tools make the same request body, so a retry with the same key is the same run.
  assert.equal(await engine.start({...offered,retry:true}),run);
  assert.deepEqual(await engine.read(run),{state:'completed',reply:'Meta Ads is on the team now.',session:'conversation-1',usage:{input:14000,output:12},
   toolCalls:[{id:'call-0',name:'create_agent',arguments:{name:'Meta Ads'}}]});
  await engine.start({...message,idempotencyKey:'no-tools'});
  assert.equal(fake.settings.runs[1].instructions,undefined);
 } finally { await fake.close(); }
});

test('the Hermes driver reads at most four calls, each a small JSON object',async()=>{
 const fake=await fakeHermes();
 const call=n=>block(JSON.stringify({name:'create_agent',arguments:{name:`Agent ${n}`}}));
 fake.settings.reply=()=>[block(JSON.stringify({name:'create_agent',arguments:{name:'x'.repeat(4000)}})),...[1,2,3,4,5].map(call),'Done.'].join('\n');
 try {
  const engine=engineFor(connection(fake));
  const {reply,toolCalls}=await engine.read(/** @type {string} */(await engine.start(message)));
  assert.equal(reply,'Done.');
  assert.deepEqual(toolCalls.map(({id,arguments:args})=>[id,/** @type {any} */(args).name]),[['call-0','Agent 1'],['call-1','Agent 2'],['call-2','Agent 3'],['call-3','Agent 4']]);
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
