import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { engineFor } from '../lib/engine.mjs';
import { toolConfig } from '../lib/agent-toolsets.mjs';

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
  assert.deepEqual(await engine.readAgent('seo-agent'),{state:'found',agent:{...seo,ready:true,displayName:null,description:'',descriptionAuto:true,botTitle:null}});
  const agent=engineFor({...connection(fake),profile:'seo-agent'});
  const run=await agent.start(message);
  assert.equal(typeof run,'string');
  assert.deepEqual(fake.settings.requests.filter(request=>request.method==='POST').map(request=>request.path),['/p/seo-agent/v1/runs']);
  assert.deepEqual(await agent.read(run),{state:'completed',reply:'Reply to: Plan the launch post',session:'conversation-1',usage:{input:14000,output:12},toolCalls:[]});
 } finally { await fake.close(); }
});

test('an Agent with no model keeps the Engine default, and an unknown name reads as missing',async()=>{
 const fake=await fakeHermes();
 try {
  const engine=engineFor(connection(fake));
  assert.deepEqual(await engine.createAgent({name:'writer',instructions:'Write.'}),{state:'created',agent:{name:'writer',instructions:'Write.',model:null,ready:true}});
  assert.ok(!fake.settings.managementRequests.some(request=>request.path.endsWith('/model')));
  assert.deepEqual(await engine.readAgent('writer'),{state:'found',agent:{name:'writer',instructions:'Write.',model:null,ready:true,displayName:null,description:'',descriptionAuto:true,botTitle:null}});
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

// An Agent's own profile (ADR 0016) is removed only for an Agent that was never made: removal answers what happened.
test('removing a profile answers removed, then missing, and a removed profile can be made again',async()=>{
 const fake=await fakeHermes();
 try {
  const engine=engineFor(connection(fake));
  await engine.createAgent({name:'seo-agent',instructions:'Write.'});
  assert.deepEqual(await engine.removeAgent('seo-agent'),{state:'removed'});
  assert.equal(fake.settings.profiles.has('seo-agent'),false);
  assert.deepEqual(await engine.readAgent('seo-agent'),{state:'missing',agent:null});
  assert.deepEqual(await engine.removeAgent('seo-agent'),{state:'missing'});
  assert.deepEqual(fake.settings.managementRequests.filter(request=>request.method==='DELETE').map(({path,authorization})=>({path,authorization})),
   [{path:'/api/profiles/seo-agent',authorization:'Bearer test-only-key'},{path:'/api/profiles/seo-agent',authorization:'Bearer test-only-key'}]);
  assert.equal((await engine.createAgent({name:'seo-agent',instructions:'Write.'})).state,'created');
  // A delete whose identity settlement stays pending already removed the profile's home.
  fake.settings.settlementPending=true;
  assert.deepEqual(await engine.removeAgent('seo-agent'),{state:'removed'});
 } finally { await fake.close(); }
});

test('the default profile and a name that is no profile name are refused without asking the Engine',async()=>{
 const fake=await fakeHermes();
 try {
  const engine=engineFor(connection(fake));
  for(const name of ['default','Bad Name','..','a/b','',' seo','x'.repeat(65),undefined,7]) assert.deepEqual(await engine.removeAgent(/** @type {any} */(name)),{state:'refused'},String(name));
  assert.deepEqual(fake.settings.managementRequests,[]);
 } finally { await fake.close(); }
});

test('a refused key or Engine refusal is refused, and an error answer or a closed Engine is unreachable, never thrown',async()=>{
 const fake=await fakeHermes(); const engine=engineFor(connection(fake));
 try {
  await engine.createAgent({name:'seo-agent',instructions:'Write.'});
  assert.deepEqual(await engineFor(connection(fake,'wrong-key')).removeAgent('seo-agent'),{state:'refused'});
  for(const [status,state] of /** @type {[number,string][]} */([[403,'refused'],[400,'refused'],[500,'unreachable'],[503,'unreachable'],[302,'unreachable']])) {
   fake.settings.managementStatus=status;
   assert.deepEqual(await engine.removeAgent('seo-agent'),{state},String(status));
  }
  assert.ok(fake.settings.profiles.has('seo-agent'),'nothing was removed');
 } finally { await fake.close(); }
 assert.deepEqual(await engine.removeAgent('seo-agent'),{state:'unreachable'});
 assert.deepEqual(await engineFor({address:'http://hermes.example.com',profile:'default',key:'test-only-key'}).removeAgent('seo-agent'),{state:'unreachable'});
});

const own='ag-a0000000000000000000000000000001';
// A root profile signed in to a model provider, whose model block a new profile copies, as in the install.
const signedIn=fake=>{ fake.settings.seedModel={provider:'openai-codex',model:'gpt-5.5'}; fake.settings.defaultCredentials['openai-codex']='root-codex-token'; };

test('providing an Agent its own profile makes it with its soul, the key and the fixed tools, read back, and asks whether it can answer',async()=>{
 const fake=await fakeHermes(); signedIn(fake);
 try {
  const engine=engineFor(connection(fake));
  assert.deepEqual(await engine.provideAgent({name:own,instructions:"Run the Meta ads."}),{state:'provided'});
  const profile=fake.settings.profiles.get(own);
  assert.equal(profile.soul,'Run the Meta ads.');
  assert.equal(profile.key,'test-only-key');
  assert.deepEqual(profile.config,toolConfig());
  assert.deepEqual(fake.settings.managementRequests.map(({method,path,body})=>({method,path,body})),[
   {method:'POST',path:'/api/profiles',body:{name:own,soul:'Run the Meta ads.'}},
   {method:'PUT',path:`/api/env?profile=${own}`,body:{key:'API_SERVER_KEY',value:'test-only-key'}},
   {method:'PUT',path:`/api/config?profile=${own}`,body:{config:toolConfig()}},
   {method:'GET',path:`/api/model/options?profile=${own}`,body:null},
  ]);
  assert.deepEqual(fake.settings.requests.map(request=>request.path),[`/p/${own}/v1/toolsets`]);
  assert.deepEqual(await engine.provideAgent({name:own,instructions:"Run the Meta ads."}),{state:'provided'});
  assert.deepEqual([...fake.settings.profiles.keys()],[own]);
 } finally { await fake.close(); }
});

test('a profile that cannot answer, still offers a toolset that must stay off, or stops part way is not provided',async()=>{
 const fake=await fakeHermes();
 try {
  const engine=engineFor(connection(fake));
  const provide=()=>engine.provideAgent({name:own,instructions:'Write.'});
  assert.deepEqual(await provide(),{state:'noModel'},'no model');
  fake.settings.seedModel={provider:'openai-codex',model:'gpt-5.5'}; await engine.removeAgent(own);
  assert.deepEqual(await provide(),{state:'noModel'},'a model whose provider has no sign-in');
  signedIn(fake);
  // A Hermes that answers the tools' write and keeps the new profile's defaults offers a terminal, files and code.
  await engine.removeAgent(own); fake.settings.staleConfig=true;
  assert.deepEqual(await provide(),{state:'forbidden'});
  fake.settings.staleConfig=false; fake.settings.failStep='config';
  assert.deepEqual(await provide(),{state:'failed'});
  fake.settings.failStep='';
  assert.deepEqual(await provide(),{state:'provided'});
  assert.deepEqual(await engineFor(connection(fake,'wrong-key')).provideAgent({name:own,instructions:'Write.'}),{state:'refused'});
  fake.settings.managementStatus=503;
  assert.deepEqual(await provide(),{state:'unreachable'});
  fake.settings.managementStatus=200;
  // Only an Agent's reserved name is provided: finishing another name would rewrite that profile's key and tools.
  const asked=fake.settings.managementRequests.length;
  for(const name of ['co-10000000000000000000000000000001','seo-agent','default','ag-A0000000000000000000000000000001','ag-a000'])
   assert.deepEqual(await engine.provideAgent({name,instructions:'Write.'}),{state:'failed'},name);
  assert.equal(fake.settings.managementRequests.length,asked);
 } finally { await fake.close(); }
 assert.deepEqual(await engineFor(connection(fake)).provideAgent({name:own,instructions:'Write.'}),{state:'unreachable'});
});

test('providing and removing log nothing and return nothing that holds the key',async()=>{
 const key='recognizable-key-7b2d1e';
 const fake=await fakeHermes(); signedIn(fake);
 const logged=[]; const real={};
 for(const method of ['log','info','warn','error','debug','trace']) { real[method]=console[method]; console[method]=(...args)=>{ logged.push(args.map(String).join(' ')); }; }
 for(const stream of ['stdout','stderr']) { real[stream]=process[stream].write; process[stream].write=function(chunk,...rest) { logged.push(String(chunk)); return real[stream].call(this,chunk,...rest); }; }
 const results=[];
 try {
  const engine=engineFor(connection(fake,key));
  results.push(await engine.provideAgent({name:own,instructions:'Write.'}),await engine.removeAgent(own));
  fake.settings.key=key;
  results.push(await engine.provideAgent({name:own,instructions:'Write.'}));
  fake.settings.managementStatus=500;
  results.push(await engine.provideAgent({name:own,instructions:'Write.'}),await engine.removeAgent(own));
  fake.settings.managementStatus=200;
  results.push(await engine.removeAgent(own));
  await fake.close();
  results.push(await engine.provideAgent({name:own,instructions:'Write.'}),await engine.removeAgent(own));
 } finally {
  for(const method of ['log','info','warn','error','debug','trace']) console[method]=real[method];
  for(const stream of ['stdout','stderr']) process[stream].write=real[stream];
  await fake.close();
 }
 assert.deepEqual(results.map(result=>result.state),['refused','refused','provided','unreachable','unreachable','removed','unreachable','unreachable']);
 assert.ok(fake.settings.managementRequests.some(request=>request.authorization===`Bearer ${key}`),'the key was sent, so a leak was possible');
 assert.ok(!logged.join('\n').includes(key),'the key was logged');
 assert.ok(!JSON.stringify(results).includes(key),'the key was returned');
});
