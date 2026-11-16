import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readProviderKeys, setProviderKey, removeProviderKey, hermesEngine } from '../lib/hermes.mjs';
import { changeCompanyKey, readCompanyKeys } from '../lib/provider-keys.mjs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { describeEntry } from '../lib/activity-log.mjs';
import { i18n } from '../lib/i18n.mjs';
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

// Two Companies on one bundled Engine, as company_key_profiles names their profiles: the space, the Company's own
// profile with the Agent that keeps it, and each Agent profile with its Agent.
const companies={
 '10000000-0000-0000-0000-000000000001':{...one,names:{[one.main]:'Lead',[one.agents[0]]:'Writer',[one.agents[1]]:'Designer'}},
 '10000000-0000-0000-0000-000000000002':{...two,names:{[two.main]:'Lead two',[two.agents[0]]:'Writer two',[two.agents[1]]:'Designer two'}},
};
const [first]=Object.keys(companies);
const agentId=profile=>`${profile.slice(3,11)}-${profile.slice(11,15)}-${profile.slice(15,19)}-${profile.slice(19,23)}-${profile.slice(23)}`;
const encryptionKey=Buffer.alloc(32,9).toString('base64');
const keyRows=(company,extra=[])=>{ const found=companies[company];
 return [{profile:found.space,kind:'space',agent:null,name:null},...[found.main,...found.agents,...extra].map(profile=>({profile,kind:profile.startsWith('co-')?'company':'agent',agent:agentId(profile),name:found.names[profile]||null}))]; };
// The person's own session and the service role, as the route hands them over; every call is recorded.
function sessions(fake,{owner,space=true,extra=[],logFails=false}) {
 const asked=[]; const logged=[];
 const db={rpc:async(name,args)=>{ asked.push({name,args});
  if(name==='is_company_owner') return {data:owner,error:null};
  if(name==='company_engine_target') return {data:[{connection:'f0000000-0000-0000-0000-000000000002',address:fake.address,profile:companies[args.c].main,one_company:false,profiles:[]}],error:null};
  if(name==='company_key_profiles') return {data:keyRows(args.c,extra).filter(row=>space||row.kind!=='space'),error:null};
  if(name==='record_provider_key_change') { logged.push(args); return logFails?{data:null,error:{code:'XX000',message:'the database is down'}}:{data:null,error:null}; }
  return {data:null,error:{message:'unexpected'}}; }};
 const key=encryptSecret('test-only-key',encryptionKey);
 const service={from:(...args)=>{ asked.push({name:'from',args}); return {select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{key_encrypted:key},error:null})})})})}; }};
 return {db,service,asked,logged};
}
// The fake's management listener is not on port 9119 of the run address, so the driver is pointed at it.
const pointedAt=fake=>{ const at=target=>({...target,managementAddress:fake.managementAddress});
 return {read:(target,keys)=>readProviderKeys(at(target),keys),set:(target,key)=>setProviderKey(at(target),key),remove:(target,key)=>removeProviderKey(at(target),key)}; };
const change=(person,fake,request)=>changeCompanyKey(person.db,person.service,{company:first,provider:'openrouter',encryptionKey,driver:pointedAt(fake),...request});
const read=(person,fake,company=first)=>readCompanyKeys(person.db,person.service,{company,encryptionKey,driver:pointedAt(fake)});
const profileOf=path=>new URL(path,'http://engine').searchParams.get('profile')??/^\/api\/profiles\/([^/]+)\/model$/.exec(new URL(path,'http://engine').pathname)?.[1]??null;

test('a set reaches the Company\'s space and its Agent profiles only, key before model, and names each Agent and whether it was written', async () => {
 const fake=await fakeHermes();
 try {
  madeCompany(fake,one); madeCompany(fake,two);
  fake.settings.modelNeedsKey=true;
  const owner=sessions(fake,{owner:true});
  fake.settings.envFail.add(one.agents[1]);
  const set=await change(owner,fake,{intent:'set',value:known});
  assert.deepEqual(set,{status:200,body:{provider:'openrouter',model:'anthropic/claude-opus-4.6',agents:[
   {agent:agentId(one.main),name:'Lead',written:true},{agent:agentId(one.agents[0]),name:'Writer',written:true},{agent:agentId(one.agents[1]),name:'Designer',written:false}]}});
  const own=new Set([one.space,one.main,...one.agents]);
  const asked=fake.settings.managementRequests.map(request=>({request:`${request.method} ${request.path}`,profile:profileOf(request.path)}));
  for(const {request,profile} of asked) assert.ok(own.has(profile),`${request} names one of the Company's own profiles`);
  for(const name of [two.space,two.main,...two.agents]) assert.deepEqual(envOf(fake,name),{},`${name} holds no key`);
  for(const profile of [one.main,one.agents[0]]) {
   const steps=asked.filter(found=>found.profile===profile&&found.request.startsWith('PUT')).map(found=>found.request);
   assert.deepEqual(steps,[`PUT /api/env?profile=${profile}`,`PUT /api/profiles/${profile}/model`],'key before model');
  }
  assert.deepEqual(owner.logged,[{c:first,provider:'openrouter',present:true}]);
  assert.deepEqual((await read(owner,fake)).waiting,[{agent:agentId(one.agents[1]),name:'Designer'}]);
  fake.settings.envFail.clear();
  const again=await change(owner,fake,{intent:'set',value:known});
  assert.ok(again.body.agents.every(agent=>agent.written),'the Agent the Engine could not write is written on the next set');
  assert.equal(envOf(fake,one.agents[1]).OPENROUTER_API_KEY,known);
  assert.deepEqual((await read(owner,fake)).waiting,[]);
  const removed=await change(owner,fake,{intent:'remove'});
  assert.deepEqual(removed.body,{provider:'openrouter',agents:[one.main,...one.agents].map(profile=>({agent:agentId(profile),name:companies[first].names[profile],removed:true}))});
  for(const name of own) assert.equal(envOf(fake,name).OPENROUTER_API_KEY,undefined,name);
  assert.deepEqual(owner.logged.map(entry=>entry.present),[true,true,false]);
  assert.deepEqual(await change(owner,fake,{intent:'remove'}),{status:200,body:{provider:'openrouter',agents:removed.body.agents}});
  assert.equal(owner.logged.length,3,'removing a key nobody held logs nothing');
  assert.ok(fake.settings.managementRequests.every(request=>!request.path.includes('/reveal')));
 } finally { await fake.close(); }
});

test('an Agent made after a key was set gets a fresh profile, waits on the Owner, and gets the key on the next set', async () => {
 const fake=await fakeHermes();
 try {
  madeCompany(fake,one);
  const owner=sessions(fake,{owner:true});
  await change(owner,fake,{intent:'set',value:known});
  const later=`ag-c${hex(1).slice(1)}`;
  const engine=hermesEngine({address:fake.address,managementAddress:fake.managementAddress,profile:one.main,key:'test-only-key'});
  fake.settings.managementRequests.length=0;
  assert.equal((await engine.provideAgent({name:later,instructions:'Writes ads.',level:1})).state,'noModel');
  const created=fake.settings.managementRequests.find(request=>request.method==='POST'&&request.path==='/api/profiles');
  assert.deepEqual(Object.keys(created.body).sort(),['name','soul'],'never cloned from the space');
  assert.deepEqual(envOf(fake,later),{},'the new profile holds no key and no copy of the space');
  assert.equal(fake.settings.skills.get(later),undefined);
  const listed=sessions(fake,{owner:true,extra:[later]});
  assert.deepEqual((await read(listed,fake)).waiting,[{agent:agentId(later),name:null}]);
  const set=await change(listed,fake,{intent:'set',value:known});
  assert.deepEqual(set.body.agents.at(-1),{agent:agentId(later),name:null,written:true});
  assert.equal(envOf(fake,later).OPENROUTER_API_KEY,known);
  assert.deepEqual((await read(listed,fake)).waiting,[]);
 } finally { await fake.close(); }
});

test('only an active Owner sets or removes a key, checked on the server; every member reads only names and yes or no', async () => {
 const fake=await fakeHermes();
 try {
  madeCompany(fake,one);
  fake.settings.profiles.get(one.space).env={OPENROUTER_API_KEY:known};
  for(const role of ['manager','contributor','viewer','removed owner']) {
   const member=sessions(fake,{owner:false});
   for(const intent of ['set','remove']) assert.deepEqual(await change(member,fake,{intent,value:known}),{status:403,body:{error:'keyNotAllowed'}},`${role} ${intent}`);
   assert.deepEqual(member.logged,[]);
   assert.deepEqual(await read(member,fake),{keys:[{provider:'openrouter',label:'OpenRouter',set:true},{provider:'anthropic',label:'Anthropic',set:false},{provider:'deepseek',label:'DeepSeek',set:false}],waiting:null},role);
  }
  assert.ok(fake.settings.managementRequests.every(request=>request.method==='GET'),'a member never writes to the Engine');
  assert.ok(Object.values(fake.settings.profiles.get(one.main).env||{}).length===0);
  const owner=sessions(fake,{owner:true});
  assert.deepEqual(await change(owner,fake,{provider:'Open Router',intent:'set',value:known}),{status:400,body:{error:'keyInvalid'}});
  assert.deepEqual(await change(owner,fake,{intent:'reveal'}),{status:400,body:{error:'keyInvalid'}});
  assert.deepEqual(await change(owner,fake,{intent:'set'}),{status:400,body:{error:'keyInvalid'}});
  assert.deepEqual(await change(owner,fake,{intent:'set',value:'short'}),{status:400,body:{error:'keyInvalid'}});
  assert.deepEqual(await change(owner,fake,{provider:'gemini',intent:'set',value:known}),{status:400,body:{error:'keyProviderUnknown'}});
  assert.deepEqual(await change(sessions(fake,{owner:true,space:false}),fake,{intent:'set',value:known}),{status:409,body:{error:'keyNoSpace'}});
  assert.deepEqual(await read(sessions(fake,{owner:true,space:false}),fake),{keys:null,waiting:null});
  assert.deepEqual(owner.logged,[]);
 } finally { await fake.close(); }
});

test('no key reaches an answer, a log line or a database call, when the Engine takes it, refuses it or never answers', async () => {
 const fake=await fakeHermes();
 const printed=[]; const kept={};
 for(const level of ['log','info','warn','error','debug']) { kept[level]=console[level]; console[level]=(...args)=>{ printed.push(args.map(String).join(' ')); }; }
 try {
  madeCompany(fake,one);
  const owner=sessions(fake,{owner:true,logFails:true});
  const answers=[await change(owner,fake,{intent:'set',value:known}),await read(owner,fake)];
  fake.settings.key='another-install-key';
  answers.push(await change(owner,fake,{intent:'set',value:known}),await read(owner,fake));
  fake.settings.key='test-only-key'; fake.settings.envHang.add(one.space);
  answers.push(await change(owner,fake,{intent:'set',value:`${known}-rotated`}));
  fake.settings.envHang.clear(); fake.settings.envFail.add(one.agents[0]);
  answers.push(await change(owner,fake,{intent:'set',value:known}),await change(owner,fake,{intent:'remove'}));
  assert.deepEqual(answers.map(answer=>answer.status??'read'),[200,'read',502,'read',503,200,200]);
  assert.deepEqual(answers[2].body,{error:'keyFailed'});
  assert.deepEqual(answers[4].body,{error:'keyFailed'});
  assert.ok(printed.some(line=>line.includes('XX000')),'a failed log write is reported by its code');
  const seen=JSON.stringify([answers,printed,owner.asked]);
  for(const secret of [known,known.slice(-4),`${known.slice(0,4)}...`,'OPENROUTER_API_KEY']) assert.ok(!seen.includes(secret),secret);
 } finally {
  for(const level of Object.keys(kept)) console[level]=kept[level];
  await fake.close();
 }
});

test('a key change reads in the Company log by its provider, in both languages', () => {
 assert.deepEqual(describeEntry({subject:'company',action:'provider_key_set',details:{provider:'openrouter'}}),{act:['logActProviderKeySet'],obj:'openrouter',from:undefined,to:undefined,note:undefined});
 assert.deepEqual(describeEntry({subject:'company',action:'provider_key_removed',details:{provider:'deepseek'}}).act,['logActProviderKeyRemoved']);
 for(const language of ['en','ar']) for(const key of ['logActProviderKeySet','logActProviderKeyRemoved']) assert.notEqual(i18n(language).t(key),key,`${language}:${key}`);
 assert.match(i18n('ar').t('logActProviderKeySet'),/مفتاح/);
});

test('the README says a Company on an install with several Companies uses its own key, which lives in the agent engine only', () => {
 const sentence='A company\'s API key lives in the agent engine only: gtmworks passes it to that company\'s profiles in the bundled Hermes, never to the root profile or another company\'s, and never keeps, logs or shows it.';
 const readme=readFileSync('README.md','utf8').replace(/\s+/g,' ');
 assert.ok(readme.includes('On an install with several companies, a subscription signed in on the root profile is shared by every company on the install, and a company that wants its own uses its own API key (#124).'));
 assert.ok(readme.includes(sentence),sentence);
});

test('the install job sets a key on the pinned Engine for a Company\'s space and Agent profile only, then removes it', () => {
 const script=readFileSync('scripts/check-install-profiles.mjs','utf8');
 assert.match(script,/setProviderKey\(engine,\{\.\.\.keyed,provider,value:/);
 assert.match(script,/assert\.deepEqual\(await providerKeys\(\),\[true,true,false,false\]/);
 assert.match(script,/removeProviderKey\(engine,\{\.\.\.keyed,provider\}\)/);
 assert.match(script,/assert\.deepEqual\(await providerKeys\(\),\[false,false,false,false\]/);
});
