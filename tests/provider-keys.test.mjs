import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProviderKeys, setProviderKey, removeProviderKey } from '../lib/hermes.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// #124: a Company's model-provider API key, passed by gtmworks straight to the Engine's profiles of that Company.
const hex=n=>`10000000000000000000000000000${String(n).padStart(3,'0')}`;
const companyOf=n=>({space:`cs-${hex(n)}`,main:`co-${hex(n)}`,agents:[`ag-a${hex(n).slice(1)}`,`ag-b${hex(n).slice(1)}`]});
const [one,two]=[companyOf(1),companyOf(2)];
const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const made=(fake,...names)=>{ for(const name of names) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:'test-only-key',config:{},credentials:{}}); };
const madeCompany=(fake,company)=>made(fake,company.space,company.main,...company.agents);
const envOf=(fake,name)=>fake.settings.profiles.get(name).env||{};
const keyRequests=fake=>fake.settings.managementRequests.filter(request=>request.path.startsWith('/api/env')||request.path.includes('/model'));
const known='sk-or-v1-known-0123456789abcdef0123456789abcdef';

test('the providers that take a key are the Engine\'s primary password rows, with a name and a yes or no only', async () => {
 const fake=await fakeHermes();
 try {
  madeCompany(fake,one);
  fake.settings.profiles.get(one.space).env={OPENROUTER_API_KEY:known,FIRECRAWL_API_KEY:'fc-tool-key-0123456789'};
  const read=await readProviderKeys(install(fake),{space:one.space,profiles:[]});
  assert.deepEqual(read,{state:'found',keys:[{provider:'openrouter',label:'OpenRouter',set:true},{provider:'anthropic',label:'Anthropic',set:false},{provider:'deepseek',label:'DeepSeek',set:false}],lacking:[]});
  const answer=JSON.stringify(read);
  for(const secret of [known,`${known.slice(0,4)}...${known.slice(-4)}`,known.slice(-4),'OPENROUTER_API_KEY','redacted']) assert.ok(!answer.includes(secret),secret);
  assert.ok(fake.settings.managementRequests.every(request=>!request.path.includes('/reveal')),'the reveal route is never asked');
  // Each Agent profile that lacks a key the space holds is named.
  fake.settings.profiles.get(one.main).env={OPENROUTER_API_KEY:known};
  assert.deepEqual((await readProviderKeys(install(fake),{space:one.space,profiles:[one.main,...one.agents]})).lacking,one.agents);
 } finally { await fake.close(); }
});

test('a refused, missing, failing or silent Engine is a state, never its text', async () => {
 const fake=await fakeHermes();
 try {
  madeCompany(fake,one);
  assert.deepEqual(await readProviderKeys({...install(fake),key:'wrong-key'},{space:one.space,profiles:[]}),{state:'refused',keys:null,lacking:null});
  assert.deepEqual(await readProviderKeys(install(fake),{space:two.space,profiles:[]}),{state:'failed',keys:null,lacking:null});
  fake.settings.managementStatus=500;
  assert.deepEqual(await readProviderKeys(install(fake),{space:one.space,profiles:[]}),{state:'unreachable',keys:null,lacking:null});
  assert.deepEqual(await setProviderKey(install(fake),{space:one.space,profiles:[],provider:'openrouter',value:known}),{state:'unreachable',model:null,profiles:null});
  fake.settings.managementStatus=200;
  assert.deepEqual(await setProviderKey(install(fake),{space:one.space,profiles:[],provider:'gemini',value:known}),{state:'unknownProvider',model:null,profiles:null});
  // The Engine refuses a value that reads as its own preview (config_env.py 333-355): 400.
  assert.deepEqual(await setProviderKey(install(fake),{space:one.space,profiles:one.agents,provider:'openrouter',value:'sk-o...cdef'}),{state:'invalid',model:null,profiles:null});
  fake.settings.envFail.add(one.space);
  assert.deepEqual(await setProviderKey(install(fake),{space:one.space,profiles:one.agents,provider:'openrouter',value:known}),{state:'failed',model:null,profiles:null});
  assert.deepEqual(await removeProviderKey(install(fake),{space:one.space,profiles:one.agents,provider:'openrouter'}),{state:'failed',profiles:null});
  fake.settings.envFail.clear(); fake.settings.envHang.add(one.space);
  assert.deepEqual(await setProviderKey(install(fake),{space:one.space,profiles:one.agents,provider:'openrouter',value:known}),{state:'unreachable',model:null,profiles:null});
  assert.ok(one.agents.every(name=>!envOf(fake,name).OPENROUTER_API_KEY),'no profile is written when the space was not');
 } finally { await fake.close(); }
});

test('the driver asks only a Company\'s own profiles, never the root, and checks a key before any request', async () => {
 const fake=await fakeHermes();
 try {
  madeCompany(fake,one); madeCompany(fake,two);
  const refusedTargets=[{space:'default',profiles:[]},{space:one.main,profiles:[]},{space:one.space,profiles:['default']},{space:one.space,profiles:[two.main]},
   {space:one.space,profiles:[two.space]},{space:one.space,profiles:['']},{space:one.space,profiles:'ag-a'},{space:one.space,profiles:[one.agents[0].toUpperCase()]}];
  for(const target of refusedTargets) {
   assert.equal((await readProviderKeys(install(fake),target)).state,'failed',JSON.stringify(target));
   assert.equal((await setProviderKey(install(fake),{...target,provider:'openrouter',value:known})).state,'failed',JSON.stringify(target));
   assert.equal((await removeProviderKey(install(fake),{...target,provider:'openrouter'})).state,'failed',JSON.stringify(target));
  }
  for(const value of ['short',`${known} with a space`,'x'.repeat(4097),'مفتاح-عربي-طويل',null,42]) assert.equal((await setProviderKey(install(fake),{space:one.space,profiles:[],provider:'openrouter',value})).state,'invalid');
  assert.deepEqual(fake.settings.managementRequests,[],'nothing reached the Engine');
 } finally { await fake.close(); }
});

test('a set writes the key to the space, then each profile its key before its model; one failing profile leaves the others written, and the next set writes it', async () => {
 const fake=await fakeHermes();
 try {
  madeCompany(fake,one); madeCompany(fake,two);
  fake.settings.modelNeedsKey=true;
  const profiles=[one.main,...one.agents];
  fake.settings.envFail.add(one.agents[0]); fake.settings.envDropped.add(one.agents[1]);
  const set=await setProviderKey(install(fake),{space:one.space,profiles,provider:'openrouter',value:known});
  assert.deepEqual(set,{state:'written',model:'anthropic/claude-opus-4.6',profiles:{[one.main]:'written',[one.agents[0]]:'failed',[one.agents[1]]:'unreachable'}});
  assert.ok(!JSON.stringify(set).includes(known));
  assert.equal(envOf(fake,one.space).OPENROUTER_API_KEY,known);
  assert.equal(envOf(fake,one.main).OPENROUTER_API_KEY,known);
  assert.deepEqual([fake.settings.profiles.get(one.main).provider,fake.settings.profiles.get(one.main).model],['openrouter','anthropic/claude-opus-4.6']);
  const order=keyRequests(fake).filter(request=>request.method==='PUT').map(request=>`${request.path}`);
  assert.deepEqual(order.slice(0,3),[`/api/env?profile=${one.space}`,`/api/env?profile=${one.main}`,`/api/profiles/${one.main}/model`]);
  for(const name of [two.space,two.main,...two.agents]) assert.deepEqual(envOf(fake,name),{},`${name} holds no key of another Company`);
  assert.deepEqual((await readProviderKeys(install(fake),{space:one.space,profiles})).lacking,one.agents);
  fake.settings.envFail.clear(); fake.settings.envDropped.clear();
  const again=await setProviderKey(install(fake),{space:one.space,profiles,provider:'openrouter',value:known});
  assert.deepEqual(again.profiles,{[one.main]:'written',[one.agents[0]]:'written',[one.agents[1]]:'written'});
  assert.deepEqual((await readProviderKeys(install(fake),{space:one.space,profiles})).lacking,[]);
  // A provider the Engine lists no model for gets the key and keeps the profile's model.
  const deepseek=await setProviderKey(install(fake),{space:one.space,profiles:[one.main],provider:'deepseek',value:known});
  assert.deepEqual(deepseek,{state:'written',model:null,profiles:{[one.main]:'noModel'}});
  assert.equal(fake.settings.profiles.get(one.main).provider,'openrouter');
 } finally { await fake.close(); }
});

test('a removal takes the key from the space and each profile, leaves their models, and says when nothing was there', async () => {
 const fake=await fakeHermes();
 try {
  madeCompany(fake,one);
  const profiles=[one.main,...one.agents];
  await setProviderKey(install(fake),{space:one.space,profiles:[one.main,one.agents[0]],provider:'openrouter',value:known});
  const removed=await removeProviderKey(install(fake),{space:one.space,profiles,provider:'openrouter'});
  assert.deepEqual(removed,{state:'removed',profiles:{[one.main]:'removed',[one.agents[0]]:'removed',[one.agents[1]]:'nothing'}});
  for(const name of [one.space,...profiles]) assert.equal(envOf(fake,name).OPENROUTER_API_KEY,undefined,name);
  assert.equal(fake.settings.profiles.get(one.main).model,'anthropic/claude-opus-4.6');
  assert.deepEqual(await removeProviderKey(install(fake),{space:one.space,profiles,provider:'openrouter'}),{state:'nothing',profiles:Object.fromEntries(profiles.map(name=>[name,'nothing']))});
  assert.deepEqual(await removeProviderKey(install(fake),{space:one.space,profiles,provider:'gemini'}),{state:'unknownProvider',profiles:null});
  assert.ok(fake.settings.managementRequests.every(request=>request.method!=='DELETE'||request.body?.key==='OPENROUTER_API_KEY'));
 } finally { await fake.close(); }
});
