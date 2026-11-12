import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { engineFor } from '../lib/engine.mjs';

// One Agent is one Engine profile, made through the Engine's management listener (ADR 0011) with the install key.
const connection=(fake,key='test-only-key')=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key});
const seo={name:'seo-agent',instructions:'Write SEO briefs for the launch.',model:'openrouter/anthropic/claude-opus-4.6'};
const message={conversation:'conversation-1',input:'Plan the launch post',idempotencyKey:'conversation-1:message-1'};

test('creating an Agent makes a profile with its instructions, model and the key, and a Run then starts for it',async()=>{
 const fake=await fakeHermes();
 try {
  const engine=engineFor(connection(fake));
  assert.deepEqual(await engine.createAgent(seo),{state:'created',agent:{...seo,ready:true}});
  assert.deepEqual(fake.settings.managementRequests.map(({method,path,body})=>({method,path,body})),[
   {method:'POST',path:'/api/profiles',body:{name:'seo-agent',soul:'Write SEO briefs for the launch.'}},
   {method:'PUT',path:'/api/profiles/seo-agent/model',body:{provider:'openrouter',model:'anthropic/claude-opus-4.6'}},
   {method:'PUT',path:'/api/env?profile=seo-agent',body:{key:'API_SERVER_KEY',value:'test-only-key'}},
  ]);
  assert.ok(fake.settings.managementRequests.every(request=>request.authorization==='Bearer test-only-key'));
  assert.deepEqual(await engine.readAgent('seo-agent'),{state:'found',agent:{...seo,ready:true}});
  const agent=engineFor({...connection(fake),profile:'seo-agent'});
  const run=await agent.start(message);
  assert.equal(typeof run,'string');
  assert.deepEqual(fake.settings.requests.filter(request=>request.method==='POST').map(request=>request.path),['/p/seo-agent/v1/runs']);
  assert.deepEqual(await agent.read(run),{state:'completed',reply:'Reply to: Plan the launch post',session:'conversation-1',usage:{input:14000,output:12}});
 } finally { await fake.close(); }
});

test('an Agent with no model keeps the Engine default, and an unknown name reads as missing',async()=>{
 const fake=await fakeHermes();
 try {
  const engine=engineFor(connection(fake));
  assert.deepEqual(await engine.createAgent({name:'writer',instructions:'Write.'}),{state:'created',agent:{name:'writer',instructions:'Write.',model:null,ready:true}});
  assert.ok(!fake.settings.managementRequests.some(request=>request.path.endsWith('/model')));
  assert.deepEqual(await engine.readAgent('writer'),{state:'found',agent:{name:'writer',instructions:'Write.',model:null,ready:true}});
  assert.deepEqual(await engine.readAgent('nobody'),{state:'missing',agent:null});
 } finally { await fake.close(); }
});

test('a name that exists is reported, and the existing profile is left as it was',async()=>{
 const fake=await fakeHermes();
 try {
  const engine=engineFor(connection(fake));
  await engine.createAgent(seo);
  const made=fake.settings.managementRequests.length;
  assert.deepEqual(await engine.createAgent({...seo,instructions:'Something else.'}),{state:'exists',agent:null});
  assert.deepEqual(await engine.createAgent({...seo,name:'default'}),{state:'exists',agent:null});
  assert.deepEqual(fake.settings.managementRequests.slice(made).map(request=>request.method),['POST','POST']);
  assert.equal(fake.settings.profiles.get('seo-agent').soul,seo.instructions);
 } finally { await fake.close(); }
});

test('a create that stops half way is failed, and the profile reads as not ready, so no Run starts on it',async()=>{
 for(const step of ['model','env']) {
  const fake=await fakeHermes(); fake.settings.failStep=step;
  try {
   const engine=engineFor(connection(fake));
   assert.deepEqual(await engine.createAgent(seo),{state:'failed',agent:null});
   const read=await engine.readAgent('seo-agent');
   assert.equal(read.state,'found');
   assert.equal(read.agent.ready,false);
   assert.equal(await engineFor({...connection(fake),profile:'seo-agent'}).start(message),null);
   // Asking again does not reach into the profile that is there: the name is taken.
   assert.deepEqual(await engine.createAgent(seo),{state:'exists',agent:null});
  } finally { await fake.close(); }
 }
});

test('a refused key creates and reads nothing',async()=>{
 const fake=await fakeHermes();
 try {
  const engine=engineFor(connection(fake,'wrong-key'));
  assert.deepEqual(await engine.createAgent(seo),{state:'refused',agent:null});
  assert.deepEqual(await engine.readAgent('default'),{state:'refused',agent:null});
  fake.settings.managementStatus=403; fake.settings.key='wrong-key';
  assert.deepEqual(await engine.createAgent(seo),{state:'refused',agent:null});
  assert.equal(fake.settings.profiles.size,0);
 } finally { await fake.close(); }
});

test('an unreachable Engine, an error answer or a redirect is unreachable, and a redirect is not followed',async()=>{
 const fake=await fakeHermes(); const engine=engineFor(connection(fake));
 try {
  for(const status of [500,503,302]) {
   fake.settings.managementStatus=status;
   assert.deepEqual(await engine.createAgent(seo),{state:'unreachable',agent:null});
   assert.deepEqual(await engine.readAgent('default'),{state:'unreachable',agent:null});
  }
  assert.ok(!fake.settings.managementRequests.some(request=>request.path==='/must-not-follow'));
 } finally { await fake.close(); }
 assert.deepEqual(await engine.createAgent(seo),{state:'unreachable',agent:null});
 assert.deepEqual(await engine.readAgent('seo-agent'),{state:'unreachable',agent:null});
});

test('the management listener is the Engine host on port 9119, and the key never leaves for a public plain-HTTP address',async()=>{
 const real=globalThis.fetch; const called=[];
 globalThis.fetch=async(url,init)=>{ called.push({url:String(url),method:init?.method,authorization:init?.headers?.Authorization,redirect:init?.redirect}); return new Response('{"profiles":[]}',{status:200}); };
 try {
  assert.deepEqual(await engineFor({address:'http://hermes:8642',profile:'default',key:'test-only-key'}).readAgent('seo-agent'),{state:'missing',agent:null});
  assert.deepEqual(called,[{url:'http://hermes:9119/api/profiles',method:'GET',authorization:'Bearer test-only-key',redirect:'manual'}]);
  called.length=0;
  const exposed=engineFor({address:'http://hermes.example.com',profile:'default',key:'test-only-key'});
  assert.deepEqual(await exposed.createAgent(seo),{state:'unreachable',agent:null});
  assert.deepEqual(await exposed.readAgent('seo-agent'),{state:'unreachable',agent:null});
  const overridden=engineFor({address:'http://127.0.0.1:8642',managementAddress:'http://hermes.example.com:9119',profile:'default',key:'test-only-key'});
  assert.deepEqual(await overridden.readAgent('seo-agent'),{state:'unreachable',agent:null});
  // A name that is no profile name, or a model with no provider, is never sent.
  const engine=engineFor({address:'http://hermes:8642',profile:'default',key:'test-only-key'});
  for(const name of ['..','Has Space','a/b','',' seo']) {
   assert.deepEqual(await engine.createAgent({...seo,name}),{state:'failed',agent:null});
   assert.deepEqual(await engine.readAgent(name),{state:'missing',agent:null});
  }
  for(const model of ['claude','/claude','openrouter/','open router/x']) assert.deepEqual(await engine.createAgent({...seo,model}),{state:'failed',agent:null});
  assert.deepEqual(called,[]);
 } finally { globalThis.fetch=real; }
});

test('a failed Agent call logs nothing and returns nothing that holds the key',async()=>{
 const key='recognizable-key-4f1c9e';
 const fake=await fakeHermes();
 const logged=[]; const real={};
 for(const method of ['log','info','warn','error','debug','trace']) { real[method]=console[method]; console[method]=(...args)=>{ logged.push(args.map(String).join(' ')); }; }
 // Streams are recorded and still written: the test runner reports through them too.
 for(const stream of ['stdout','stderr']) { real[stream]=process[stream].write; process[stream].write=function(chunk,...rest) { logged.push(String(chunk)); return real[stream].call(this,chunk,...rest); }; }
 const results=[];
 try {
  // The Engine echoes the key back in its refusals and errors; none of it may surface.
  const engine=engineFor(connection(fake,key));
  results.push(await engine.createAgent(seo),await engine.readAgent('default'));
  fake.settings.key=key; fake.settings.managementStatus=500;
  results.push(await engine.createAgent(seo),await engine.readAgent('default'));
  fake.settings.managementStatus=200; fake.settings.failStep='env';
  results.push(await engine.createAgent(seo));
  await fake.close();
  results.push(await engine.createAgent({...seo,name:'other'}),await engine.readAgent('seo-agent'));
 } finally {
  for(const method of ['log','info','warn','error','debug','trace']) console[method]=real[method];
  for(const stream of ['stdout','stderr']) process[stream].write=real[stream];
  await fake.close();
 }
 assert.deepEqual(results.map(result=>result.state),['refused','refused','unreachable','unreachable','failed','unreachable','unreachable']);
 assert.ok(fake.settings.managementRequests.some(request=>request.authorization===`Bearer ${key}`),'the key was sent, so a leak was possible');
 assert.ok(!logged.join('\n').includes(key),'the key was logged');
 assert.ok(!JSON.stringify(results).includes(key),'the key was returned');
});
