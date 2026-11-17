import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProviderKeys, setProviderKey, removeProviderKey, readHeldKeys, hermesEngine } from '../lib/hermes.mjs';
import { changeCompanyKey, readCompanyKeys } from '../lib/provider-keys.mjs';
import { runToolCall } from '../lib/agent-tools.mjs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// #299: once a Company holds a provider key, a later Agent waits on its own profile for the key instead of running on
// Lead's, and a removed Agent's profile stays reachable by the next removal.
const tail='0000000000000000000000000000001';
const company='10000000-0000-0000-0000-000000000001';
const space=`cs-1${tail}`; const main=`co-1${tail}`; const writer=`ag-a${tail}`; const later=`ag-c${tail}`; const gone=`ag-d${tail}`;
const agentId=profile=>`${profile.slice(3,11)}-${profile.slice(11,15)}-${profile.slice(15,19)}-${profile.slice(19,23)}-${profile.slice(23)}`;
const known='sk-or-v1-known-0123456789abcdef0123456789abcdef';
const encryptionKey=Buffer.alloc(32,9).toString('base64');
const made=(fake,...names)=>{ for(const name of names) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:'test-only-key',config:{},credentials:{}}); };
const envOf=(fake,name)=>fake.settings.profiles.get(name).env||{};
const profileOf=path=>new URL(path,'http://engine').searchParams.get('profile')??/^\/api\/profiles\/([^/]+)(?:\/model)?$/.exec(new URL(path,'http://engine').pathname)?.[1]??null;
const runsOn=fake=>fake.settings.requests.filter(request=>/^\/p\/[^/]+\/v1\/runs/.test(request.path)).map(request=>decodeURIComponent(request.path.split('/')[2]));

// The Company's profiles as company_key_profiles names them: the space, Lead's own, the Writer's, and `extra` rows.
const rowsOf=extra=>[{profile:space,kind:'space',agent:null,name:null},{profile:main,kind:'company',agent:agentId(main),name:'Lead'},
 {profile:writer,kind:'agent',agent:agentId(writer),name:'Writer'},...extra];
// The person's own session and the service role, as the route hands them over; every call is recorded.
function sessions(fake,{owner=true,extra=[],endFails=false}={}) {
 const asked=[]; const ended=[]; const unfinished=new Map();
 const db={rpc:async(name,args)=>{ asked.push({name,args});
  if(name==='is_company_owner') return {data:owner,error:null};
  if(name==='company_engine_target') return {data:[{connection:'f0000000-0000-0000-0000-000000000002',address:fake.address,profile:main,one_company:false,profiles:[]}],error:null};
  if(name==='company_key_profiles') return {data:rowsOf(extra),error:null};
  if(name==='record_provider_key_change') return {data:null,error:null};
  if(name==='record_unfinished_provider_key') { if(args.missed.length) unfinished.set(args.key_provider,args.missed); else unfinished.delete(args.key_provider); return {data:null,error:null}; }
  if(name==='company_key_unfinished_profiles') return {data:owner?[...unfinished].map(([provider,profiles])=>({provider,profiles})):[],error:null};
  if(name==='end_agent_key_waits') { ended.push(args); return endFails?{data:null,error:{code:'XX000',message:'the database is down'}}:{data:null,error:null}; }
  return {data:null,error:{message:'unexpected'}}; }};
 const key=encryptSecret('test-only-key',encryptionKey);
 const service={from:(...args)=>{ asked.push({name:'from',args}); return {select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{key_encrypted:key},error:null})})})})}; }};
 return {db,service,asked,ended};
}
// The fake's management listener is not on port 9119 of the run address, so the driver is pointed at it.
const pointedAt=fake=>{ const at=target=>({...target,managementAddress:fake.managementAddress});
 return {read:(target,keys)=>readProviderKeys(at(target),keys),held:(target,keys)=>readHeldKeys(at(target),keys),
  set:(target,key)=>setProviderKey(at(target),key),remove:(target,key)=>removeProviderKey(at(target),key)}; };
const change=(person,fake,request)=>changeCompanyKey(person.db,person.service,{company,provider:'openrouter',encryptionKey,driver:pointedAt(fake),...request});
const read=(person,fake)=>readCompanyKeys(person.db,person.service,{company,encryptionKey,driver:pointedAt(fake)});
const engineOn=(fake,profile)=>hermesEngine({address:fake.address,managementAddress:fake.managementAddress,profile,key:'test-only-key'});

// Lead's create_agent call on Lead's profile, with the database's answers for a Company whose level is 1.
async function leadMakes(fake) {
 const calls=[];
 const db={rpc:async(name,args)=>{ calls.push([name,args]);
  if(name==='lead_agent_profile') return {data:{profile:later,soul:'You write for RS Learning.',level:1},error:null};
  if(name==='lead_create_agent') return {data:{state:'created',agent:agentId(later)},error:null};
  return {data:null,error:{message:'unexpected'}}; }};
 const outcome=await runToolCall({db,engine:engineOn(fake,main),profile:main,conversation:'conversation-1',run:'run-1'},{id:'call-0',name:'create_agent',arguments:{template:'writer'}});
 return {outcome,calls};
}

test('an Agent Lead makes after the key was set is made on a fresh profile of its own, asked to wait for the key, and starts no Run on Lead\'s', async () => {
 const fake=await fakeHermes();
 try {
  made(fake,space,main,writer);
  await change(sessions(fake),fake,{intent:'set',value:known});
  fake.settings.managementRequests.length=0;
  const {outcome,calls}=await leadMakes(fake);
  assert.deepEqual(outcome,{state:'created',agent:agentId(later)});
  const createdProfiles=fake.settings.managementRequests.filter(request=>request.method==='POST'&&request.path==='/api/profiles');
  assert.deepEqual(createdProfiles.map(request=>request.body.name),[later],'the Engine is asked to make only the new Agent profile');
  assert.deepEqual(Object.keys(createdProfiles[0].body).sort(),['name','soul'],'never cloned from the space');
  assert.deepEqual(envOf(fake,later),{},'the new profile holds no key');
  assert.equal(fake.settings.skills.get(later),undefined,'nor a copy of the space\'s Skills');
  const writes=fake.settings.managementRequests.filter(request=>request.method!=='GET').map(request=>request.path==='/api/profiles'?request.body.name:profileOf(request.path));
  assert.ok(writes.every(profile=>profile===later),`only the new profile is written: ${writes}`);
  assert.equal(calls.at(-1)[0],'lead_create_agent');
  assert.deepEqual([calls.at(-1)[1].own_level,calls.at(-1)[1].own_answers],[1,false],'the database is asked to make it on its own profile, waiting for the key');
  assert.deepEqual(runsOn(fake),[],'no Run starts, on Lead\'s profile or any other');
 } finally { await fake.close(); }
});

test('the waiting Agent is listed for the Owner until the next set gives its own profile the key and model, then it runs there and never on Lead\'s', async () => {
 const fake=await fakeHermes();
 try {
  made(fake,space,main,writer);
  await change(sessions(fake),fake,{intent:'set',value:known});
  await leadMakes(fake);
  const owner=sessions(fake,{extra:[{profile:later,kind:'agent',agent:agentId(later),name:'Writer later'}]});
  assert.deepEqual((await read(owner,fake)).waiting,[{agent:agentId(later),name:'Writer later'}],'the Owner sees it waiting');
  const set=await change(owner,fake,{intent:'set',value:known});
  assert.deepEqual(set.body.agents.at(-1),{agent:agentId(later),name:'Writer later',written:true});
  assert.equal(envOf(fake,later).OPENROUTER_API_KEY,known);
  assert.deepEqual([fake.settings.profiles.get(later).provider,fake.settings.profiles.get(later).model],['openrouter','anthropic/claude-opus-4.6'],'its own profile has the model');
  assert.deepEqual(owner.ended,[{c:company,reached:[main,writer,later]}],'the set ends the waits of the profiles it gave key and model');
  assert.deepEqual((await read(owner,fake)).waiting,[]);
  const engine=engineOn(fake,later);
  const run=await engine.start({conversation:'conversation-2',input:'Write the June article',idempotencyKey:'send-1'});
  assert.equal((await engine.read(run)).state,'completed');
  assert.deepEqual([...new Set(runsOn(fake))],[later],'its Runs reach its own profile only');
 } finally { await fake.close(); }
});

test('a set that gives no profile a model ends no wait, and a wait the database could not end changes nothing in the answer', async () => {
 const fake=await fakeHermes();
 try {
  made(fake,space,main,writer,later);
  const extra=[{profile:later,kind:'agent',agent:agentId(later),name:'Writer later'}];
  fake.settings.modelOptionsFail=true;
  const unsettled=sessions(fake,{extra});
  await change(unsettled,fake,{intent:'set',value:known});
  assert.deepEqual(unsettled.ended,[],'no profile got its model, so every Agent still waits');
  fake.settings.modelOptionsFail=false;
  const failing=sessions(fake,{extra,endFails:true});
  const printed=[]; const kept=console.error; console.error=(...args)=>{ printed.push(args.map(String).join(' ')); };
  let set;
  try { set=await change(failing,fake,{intent:'set',value:known}); } finally { console.error=kept; }
  assert.deepEqual(Object.keys(set.body).sort(),['agents','model','provider']);
  assert.deepEqual(printed,['Agent key waits not ended XX000']);
 } finally { await fake.close(); }
});

test('a removed Agent\'s profile that holds the key reads as leftover by its name, is left out of a set, and the next removal reaches it', async () => {
 const fake=await fakeHermes();
 try {
  made(fake,space,main,writer,gone);
  await change(sessions(fake,{extra:[{profile:gone,kind:'agent',agent:agentId(gone),name:'Old writer'}]}),fake,{intent:'set',value:known});
  assert.equal(envOf(fake,gone).OPENROUTER_API_KEY,known);
  const owner=sessions(fake,{extra:[{profile:gone,kind:'removed',agent:agentId(gone),name:'Old writer'}]});
  const after=await read(owner,fake);
  assert.deepEqual([after.waiting,after.leftover,after.unknown],[[],[{agent:agentId(gone),name:'Old writer'}],[]],'still holding the key, it is leftover and never waiting');
  fake.settings.managementRequests.length=0;
  await change(owner,fake,{intent:'set',value:`${known}-rotated`});
  assert.ok(fake.settings.managementRequests.every(request=>profileOf(request.path)!==gone||request.method==='GET'),'a set writes nothing to it');
  assert.equal(envOf(fake,gone).OPENROUTER_API_KEY,known);
  const member=sessions(fake,{owner:false,extra:[{profile:gone,kind:'removed',agent:agentId(gone),name:'Old writer'}]});
  assert.deepEqual(await read(member,fake),{keys:[{provider:'openrouter',label:'OpenRouter',set:true},{provider:'anthropic',label:'Anthropic',set:false},{provider:'deepseek',label:'DeepSeek',set:false}],waiting:null,leftover:null,unknown:null},
   'a member who is not the Owner reads what they read before');
  fake.settings.managementRequests.length=0;
  const removed=await change(owner,fake,{intent:'remove'});
  assert.ok(fake.settings.managementRequests.some(request=>request.method==='DELETE'&&profileOf(request.path)===gone),'the removal reaches it');
  assert.equal(envOf(fake,gone).OPENROUTER_API_KEY,undefined);
  assert.deepEqual(removed.body.agents,[{agent:agentId(main),name:'Lead',removed:true},{agent:agentId(writer),name:'Writer',removed:true},{agent:agentId(gone),name:'Old writer',removed:true}]);
  assert.deepEqual((await read(owner,fake)).leftover,[]);
  assert.ok(fake.settings.profiles.has(gone),'the profile itself is kept');
 } finally { await fake.close(); }
});

test('a removed Agent\'s profile a set missed is never waiting, and one the Engine cannot read is unknown', async () => {
 const fake=await fakeHermes();
 try {
  made(fake,space,main,writer,gone);
  const extra=[{profile:gone,kind:'agent',agent:agentId(gone),name:'Old writer'}];
  const owner=sessions(fake,{extra});
  fake.settings.envFail.add(gone);
  await change(owner,fake,{intent:'set',value:known});
  fake.settings.envFail.clear();
  assert.deepEqual((await read(owner,fake)).waiting,[{agent:agentId(gone),name:'Old writer'}]);
  extra.splice(0,1,{...extra[0],kind:'removed'});
  const after=await read(owner,fake);
  assert.deepEqual([after.waiting,after.leftover,after.unknown],[[],[],[]],'once its Agent is removed it waits for no key, and holds none');
  fake.settings.envReadFail.add(gone);
  assert.deepEqual((await read(owner,fake)).unknown,[{agent:agentId(gone),name:'Old writer'}]);
 } finally { await fake.close(); }
});

test('no key reaches an answer, a log line or a database call while a later Agent waits, runs, or a removed one is cleaned', async () => {
 const fake=await fakeHermes();
 const printed=[]; const kept={};
 for(const level of ['log','info','warn','error','debug']) { kept[level]=console[level]; console[level]=(...args)=>{ printed.push(args.map(String).join(' ')); }; }
 try {
  made(fake,space,main,writer,gone);
  const answers=[await change(sessions(fake,{extra:[{profile:gone,kind:'agent',agent:agentId(gone),name:'Old writer'}]}),fake,{intent:'set',value:known})];
  const made_=await leadMakes(fake);
  const owner=sessions(fake,{endFails:true,extra:[{profile:later,kind:'agent',agent:agentId(later),name:'Writer later'},{profile:gone,kind:'removed',agent:agentId(gone),name:'Old writer'}]});
  answers.push(made_.outcome,await read(owner,fake),await change(owner,fake,{intent:'set',value:known}),await read(owner,fake),await change(owner,fake,{intent:'remove'}),await read(owner,fake));
  assert.ok(printed.some(line=>line.includes('Agent key waits not ended')),'the failed end is reported');
  const seen=JSON.stringify([answers,printed,owner.asked,made_.calls]);
  for(const secret of [known,known.slice(-4),`${known.slice(0,4)}...`,'OPENROUTER_API_KEY']) assert.ok(!seen.includes(secret),secret);
 } finally {
  for(const level of Object.keys(kept)) console[level]=kept[level];
  await fake.close();
 }
});
