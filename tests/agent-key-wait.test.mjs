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
// The person's own session and the service role, as the route hands them over; every call of either is recorded.
// `waits` are the Agent profiles the database holds for the key: finish_provider_key_change ends those a set reached
// and answers the rest while the key is held. `failing` names the service-role calls that answer an error.
function sessions(fake,{owner=true,extra=[],waits=[],failing=[]}={}) {
 const asked=[]; const unfinished=new Map(); const waiting=new Set(waits);
 const db={rpc:async(name,args)=>{ asked.push({name,args});
  if(name==='is_company_owner') return {data:owner,error:null};
  if(name==='company_engine_target') return {data:[{connection:'f0000000-0000-0000-0000-000000000002',address:fake.address,profile:main,one_company:false,profiles:[]}],error:null};
  if(name==='company_key_profiles') return {data:rowsOf(extra),error:null};
  if(name==='record_provider_key_change') return {data:null,error:null};
  if(name==='record_unfinished_provider_key') { if(args.missed.length) unfinished.set(args.key_provider,args.missed); else unfinished.delete(args.key_provider); return {data:null,error:null}; }
  if(name==='company_key_unfinished_profiles') return {data:owner?[...unfinished].map(([provider,profiles])=>({provider,profiles})):[],error:null};
  return {data:null,error:{message:'unexpected'}}; }};
 const key=encryptSecret('test-only-key',encryptionKey);
 const service={from:(...args)=>{ asked.push({name:'from',args}); return {select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{key_encrypted:key},error:null})})})})}; },
  rpc:async(name,args)=>{ asked.push({name,args,engineAsked:fake.settings.managementRequests.length});
   if(failing.includes(name)) return {data:null,error:{code:'XX000',message:'the database is down'}};
   if(['begin_provider_key_change','forget_agent_profile_leftovers','settle_provider_key_holds'].includes(name)) return {data:null,error:null};
   if(name==='finish_provider_key_change') { if(args.now_held!==true) return {data:[],error:null}; for(const profile of args.reached) waiting.delete(profile); return {data:[...waiting],error:null}; }
   return {data:null,error:{message:'unexpected'}}; }};
 const calls=name=>asked.filter(call=>call.name===name).map(call=>call.args);
 return {db,service,asked,calls};
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
  const owner=sessions(fake,{waits:[later],extra:[{profile:later,kind:'agent',agent:agentId(later),name:'Writer later'}]});
  assert.deepEqual((await read(owner,fake)).waiting,[{agent:agentId(later),name:'Writer later'}],'the Owner sees it waiting');
  const set=await change(owner,fake,{intent:'set',value:known});
  assert.deepEqual(set.body.agents.at(-1),{agent:agentId(later),name:'Writer later',written:true});
  assert.equal(envOf(fake,later).OPENROUTER_API_KEY,known);
  assert.deepEqual([fake.settings.profiles.get(later).provider,fake.settings.profiles.get(later).model],['openrouter','anthropic/claude-opus-4.6'],'its own profile has the model');
  assert.deepEqual(owner.calls('finish_provider_key_change'),[{c:company,key_provider:'openrouter',now_held:true,reached:[main,writer,later]}],'the set ends the waits of the profiles it gave key and model');
  assert.deepEqual((await read(owner,fake)).waiting,[]);
  const engine=engineOn(fake,later);
  const run=await engine.start({conversation:'conversation-2',input:'Write the June article',idempotencyKey:'send-1'});
  assert.equal((await engine.read(run)).state,'completed');
  assert.deepEqual([...new Set(runsOn(fake))],[later],'its Runs reach its own profile only');
 } finally { await fake.close(); }
});

test('a change is begun in the database before the Engine is asked anything, and a person who is not the Owner begins none', async () => {
 const fake=await fakeHermes();
 try {
  made(fake,space,main,writer);
  for(const request of [{intent:'set',value:known},{intent:'remove'}]) {
   fake.settings.managementRequests.length=0;
   const owner=sessions(fake);
   assert.equal((await change(owner,fake,request)).status,200,request.intent);
   const begun=owner.asked.filter(call=>call.name==='begin_provider_key_change');
   assert.deepEqual(begun.map(call=>[call.args,call.engineAsked]),[[{c:company,key_provider:'openrouter'},0]],`${request.intent}: begun once, before any Engine request`);
   assert.ok(owner.asked.indexOf(begun[0])<owner.asked.findIndex(call=>call.name==='company_key_profiles'),`${request.intent}: before the profiles to write are read`);
   assert.ok(fake.settings.managementRequests.length>0,`${request.intent}: the Engine is asked after`);
  }
  fake.settings.managementRequests.length=0;
  const member=sessions(fake,{owner:false});
  assert.equal((await change(member,fake,{intent:'set',value:known})).status,403);
  assert.deepEqual([member.calls('begin_provider_key_change'),member.calls('finish_provider_key_change'),fake.settings.managementRequests],[[],[],[]]);
 } finally { await fake.close(); }
});

test('a change ends in one finish as the Engine answered: a set holds the key, a removal lets it go, a refusal leaves it as it was, and an unknown end waits for a set and keeps the hold for a removal', async () => {
 const fake=await fakeHermes();
 const printed=[]; const kept=console.error; console.error=(...args)=>{ printed.push(args.map(String).join(' ')); };
 try {
  made(fake,space,main,writer);
  const finished=async(request,person=sessions(fake))=>{ const answer=await change(person,fake,request).catch(()=>({status:'threw'})); return [answer.status,person.calls('begin_provider_key_change').length,person.calls('finish_provider_key_change')]; };
  const ended=(now_held,reached=[])=>[{c:company,key_provider:'openrouter',now_held,reached}];
  fake.settings.envFail.add(writer);
  assert.deepEqual(await finished({intent:'set',value:known}),[200,1,ended(true,[main])],'a set names only the profiles it gave key and model');
  fake.settings.envFail.clear();
  assert.deepEqual(await finished({intent:'remove'}),[200,1,ended(false)],'a removal lets the key go');
  assert.deepEqual(await finished({intent:'remove'}),[200,1,ended(false)],'and so does one that found nothing to remove');
  assert.deepEqual(await finished({intent:'set',value:known,provider:'nosuch'}),[400,1,[{c:company,key_provider:'nosuch',now_held:null,reached:[]}]],'a refused set leaves it as it was');
  const silent={...pointedAt(fake),set:async()=>({state:'unreachable',model:null,profiles:null}),remove:async()=>({state:'unreachable',profiles:null})};
  assert.deepEqual(await finished({intent:'set',value:known,driver:silent}),[503,1,ended(true)],'a set the Engine did not answer may be in the space, so later Agents wait');
  assert.deepEqual(await finished({intent:'remove',driver:silent}),[503,1,ended(null)],'a removal it did not answer keeps the hold it had');
  const broken=()=>{ const person=sessions(fake); const rpc=person.db.rpc; person.db.rpc=async(name,args)=>{ if(name==='company_key_profiles') throw new Error('down'); return rpc(name,args); }; return person; };
  assert.deepEqual(await finished({intent:'set',value:known},broken()),['threw',1,ended(true)],'a set that threw after its begin is finished as held');
  assert.deepEqual(await finished({intent:'remove'},broken()),['threw',1,ended(null)],'a removal that threw keeps the hold');
  assert.deepEqual(printed,[]);
 } finally { console.error=kept; await fake.close(); }
});

test('a change the database could not begin writes nothing to the Engine and asks the Owner to try again, so an Agent made meanwhile finds the key nowhere', async () => {
 const fake=await fakeHermes();
 const printed=[]; const kept=console.error; console.error=(...args)=>{ printed.push(args.map(String).join(' ')); };
 try {
  made(fake,space,main,writer);
  for(const request of [{intent:'set',value:known},{intent:'remove'}]) {
   fake.settings.managementRequests.length=0;
   const unbegun=sessions(fake,{failing:['begin_provider_key_change']});
   assert.deepEqual(await change(unbegun,fake,request),{status:502,body:{error:'keyFailed'}},request.intent);
   assert.deepEqual([fake.settings.managementRequests,unbegun.calls('company_key_profiles'),unbegun.calls('finish_provider_key_change')],[[],[],[]],`${request.intent}: no Engine request, no profile read and no finish`);
  }
  assert.deepEqual(printed,['Provider key change not begun XX000','Provider key change not begun XX000'],'each logged by its code only');
  assert.equal((await leadMakes(fake)).outcome.state,'created');
  for(const profile of [space,main,writer,later]) assert.equal(envOf(fake,profile).OPENROUTER_API_KEY,undefined,`${profile} holds no key`);
 } finally { console.error=kept; await fake.close(); }
});

test('only the Owner\'s read settles the holds to what the space holds, naming only the providers whose name reads', async () => {
 const fake=await fakeHermes();
 try {
  made(fake,space,main,writer);
  const owner=sessions(fake);
  assert.equal((await change(owner,fake,{intent:'set',value:known})).status,200);
  await read(owner,fake);
  assert.deepEqual(owner.calls('settle_provider_key_holds'),[{c:company,held:['openrouter']}]);
  const member=sessions(fake,{owner:false});
  await read(member,fake);
  assert.deepEqual(member.calls('settle_provider_key_holds'),[],'a member\'s read settles nothing');
  await change(owner,fake,{intent:'remove'});
  await read(owner,fake);
  assert.deepEqual(owner.calls('settle_provider_key_holds').at(-1),{c:company,held:[]});
  const odd={...pointedAt(fake),read:async()=>({state:'found',keys:[{provider:'openrouter',label:'OpenRouter',set:true},{provider:'Not a provider',label:'Odd',set:true},{provider:'deepseek',label:'DeepSeek',set:false}],lacking:[],leftover:[],unread:[]})};
  await readCompanyKeys(owner.db,owner.service,{company,encryptionKey,driver:odd});
  assert.deepEqual(owner.calls('settle_provider_key_holds').at(-1),{c:company,held:['openrouter']},'a provider name that does not read is never sent');
 } finally { await fake.close(); }
});

test('a set that gives no profile a model ends no wait, and a change the database could not finish changes nothing in the answer', async () => {
 const fake=await fakeHermes();
 try {
  made(fake,space,main,writer,later);
  const extra=[{profile:later,kind:'agent',agent:agentId(later),name:'Writer later'}];
  fake.settings.modelOptionsFail=true;
  const unsettled=sessions(fake,{extra,waits:[later]});
  await change(unsettled,fake,{intent:'set',value:known});
  assert.deepEqual(unsettled.calls('finish_provider_key_change'),[{c:company,key_provider:'openrouter',now_held:true,reached:[]}],'no profile got its model, so every Agent still waits');
  fake.settings.modelOptionsFail=false;
  const failing=sessions(fake,{extra,failing:['finish_provider_key_change']});
  const printed=[]; const kept=console.error; console.error=(...args)=>{ printed.push(args.map(String).join(' ')); };
  let set;
  try { set=await change(failing,fake,{intent:'set',value:known}); } finally { console.error=kept; }
  assert.deepEqual(Object.keys(set.body).sort(),['agents','model','provider']);
  assert.deepEqual(printed,['Provider key change not finished XX000']);
 } finally { await fake.close(); }
});

test('an Agent made while a set was writing waits on a profile the set did not name, so the set gives it the key too, for at most three more rounds', async () => {
 const fake=await fakeHermes();
 try {
  const late=`ag-e${tail}`;
  made(fake,space,main,writer,late);
  const owner=sessions(fake,{waits:[late]});
  assert.equal((await change(owner,fake,{intent:'set',value:known})).status,200);
  assert.equal(envOf(fake,late).OPENROUTER_API_KEY,known,'the late profile gets the key');
  assert.deepEqual([fake.settings.profiles.get(late).provider,fake.settings.profiles.get(late).model],['openrouter','anthropic/claude-opus-4.6'],'and the model');
  assert.deepEqual(owner.calls('finish_provider_key_change').map(call=>call.reached),[[main,writer],[late]],'and a second finish ends its wait');
  const endless=sessions(fake); const finish=endless.service.rpc; let fresh=0;
  endless.service.rpc=async(name,args)=>{ const answer=await finish(name,args); return name==='finish_provider_key_change'?{data:[`ag-${(++fresh).toString(16).padStart(32,'0')}`],error:null}:answer; };
  await change(endless,fake,{intent:'set',value:known});
  assert.equal(endless.calls('finish_provider_key_change').length,4,'the first finish and three more rounds');
 } finally { await fake.close(); }
});

test('a late round writes only the late profiles, never the space again, and one it could not write is kept as unfinished', async () => {
 const fake=await fakeHermes();
 try {
  const late=`ag-e${tail}`; const lost=`ag-7${tail}`;
  made(fake,space,main,writer,late,lost);
  fake.settings.envFail.add(lost);
  const owner=sessions(fake,{waits:[late,lost]});
  const set=await change(owner,fake,{intent:'set',value:known});
  assert.equal(set.status,200);
  const spaceWrites=fake.settings.managementRequests.filter(request=>request.method==='PUT'&&profileOf(request.path)===space);
  assert.equal(spaceWrites.length,1,'the space key is written once');
  assert.equal(envOf(fake,late).OPENROUTER_API_KEY,known,'the late profile gets the key');
  assert.deepEqual(owner.calls('record_unfinished_provider_key'),[{c:company,key_provider:'openrouter',missed:[lost]}],'the late profile it could not write is kept as unfinished');
  assert.deepEqual(set.body.agents.map(found=>found.name),['Lead','Writer'],'the answer names the Company\'s listed Agents only');
 } finally { await fake.close(); }
});

test('the Owner\'s read forgets a removed Agent\'s profile left holding no key, once no key change is under way, and keeps one holding a key or unread', async () => {
 const fake=await fakeHermes();
 try {
  const other=`ag-f${tail}`; const missing=`ag-b${tail}`; const unread=`ag-9${tail}`;
  made(fake,space,main,writer,gone,other,unread);
  fake.settings.profiles.get(other).env={DEEPSEEK_API_KEY:'sk-deepseek-test-only-0123456789'};
  fake.settings.envReadFail.add(unread);
  const removedRow=(profile,name)=>({profile,kind:'removed',agent:agentId(profile),name});
  const owner=sessions(fake,{extra:[removedRow(gone,'Old writer'),removedRow(other,'Old ads'),removedRow(missing,'Old SEO'),removedRow(unread,'Old design')]});
  let open; const gate=new Promise(resolve=>{ open=resolve; });
  const gated={...pointedAt(fake),set:async(target,key)=>{ await gate; return pointedAt(fake).set(target,key); }};
  const changing=changeCompanyKey(owner.db,owner.service,{company,provider:'openrouter',intent:'set',value:known,encryptionKey,driver:gated});
  const reading=read(owner,fake);
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.deepEqual([owner.calls('settle_provider_key_holds'),owner.calls('forget_agent_profile_leftovers')],[[],[]],'the read waits for the change under way');
  open();
  await changing;
  const after=await reading;
  assert.deepEqual(owner.calls('forget_agent_profile_leftovers'),[{c:company,profiles:[gone,missing]}],'the one holding no key and the one the Engine does not serve');
  assert.deepEqual([after.leftover,after.unknown],[[{agent:null,name:'Old ads'}],[{agent:null,name:'Old design'}]]);
  const member=sessions(fake,{owner:false,extra:[removedRow(gone,'Old writer')]});
  await read(member,fake);
  assert.deepEqual(member.calls('forget_agent_profile_leftovers'),[],'a member\'s read forgets nothing');
  assert.ok(fake.settings.profiles.has(gone),'the Engine keeps the profile');
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
  assert.deepEqual([after.waiting,after.leftover,after.unknown],[[],[{agent:null,name:'Old writer'}],[]],'still holding the key, it is leftover by its name only and never waiting');
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
  assert.deepEqual(removed.body.agents,[{agent:agentId(main),name:'Lead',removed:true},{agent:agentId(writer),name:'Writer',removed:true},{agent:null,name:'Old writer',removed:true}]);
  assert.deepEqual((await read(owner,fake)).leftover,[]);
  assert.ok(fake.settings.profiles.has(gone),'the profile itself is kept');
 } finally { await fake.close(); }
});

test('after a removal, a removed Agent\'s profile left holding no key is forgotten, and one still holding a key, unread or not reached is kept', async () => {
 const fake=await fakeHermes();
 try {
  const other=`ag-f${tail}`; const missing=`ag-b${tail}`; const unread=`ag-9${tail}`; const stuck=`ag-8${tail}`;
  made(fake,space,main,writer,gone,other,unread,stuck);
  for(const name of [space,gone,other,unread,stuck]) fake.settings.profiles.get(name).env={OPENROUTER_API_KEY:known};
  fake.settings.profiles.get(other).env.DEEPSEEK_API_KEY='sk-deepseek-test-only-0123456789';
  fake.settings.envReadFail.add(unread); fake.settings.envFail.add(stuck);
  const removedRow=(profile,name)=>({profile,kind:'removed',agent:agentId(profile),name});
  const extra=[removedRow(gone,'Old writer'),removedRow(other,'Old ads'),removedRow(missing,'Old SEO'),removedRow(unread,'Old design'),removedRow(stuck,'Old video')];
  const owner=sessions(fake,{extra});
  const removed=await change(owner,fake,{intent:'remove'});
  assert.deepEqual(removed.body.agents.slice(2),[{agent:null,name:'Old writer',removed:true},{agent:null,name:'Old ads',removed:true},{agent:null,name:'Old SEO',removed:true},
   {agent:null,name:'Old design',removed:true},{agent:null,name:'Old video',removed:false}],'a removed Agent is named, never by its id');
  assert.deepEqual(owner.calls('forget_agent_profile_leftovers'),[{c:company,profiles:[gone,missing]}],'the one emptied and the one the Engine does not serve');
  assert.ok(fake.settings.profiles.has(gone),'the Engine keeps the profile');
  const failing=sessions(fake,{extra,failing:['forget_agent_profile_leftovers']});
  const printed=[]; const kept=console.error; console.error=(...args)=>{ printed.push(args.map(String).join(' ')); };
  let again;
  try { again=await change(failing,fake,{intent:'remove'}); } finally { console.error=kept; }
  assert.equal(again.status,200);
  assert.deepEqual(printed,['Agent profile leftovers not forgotten XX000']);
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
  assert.deepEqual((await read(owner,fake)).unknown,[{agent:null,name:'Old writer'}]);
 } finally { await fake.close(); }
});

test('no key reaches an answer, a log line or a database call while a later Agent waits, runs, or a removed one is cleaned', async () => {
 const fake=await fakeHermes();
 const printed=[]; const kept={};
 for(const level of ['log','info','warn','error','debug']) { kept[level]=console[level]; console[level]=(...args)=>{ printed.push(args.map(String).join(' ')); }; }
 try {
  const late=`ag-e${tail}`;
  made(fake,space,main,writer,gone,late);
  const answers=[await change(sessions(fake,{extra:[{profile:gone,kind:'agent',agent:agentId(gone),name:'Old writer'}]}),fake,{intent:'set',value:known})];
  const made_=await leadMakes(fake);
  const owner=sessions(fake,{waits:[later,late],failing:['forget_agent_profile_leftovers'],extra:[{profile:later,kind:'agent',agent:agentId(later),name:'Writer later'},{profile:gone,kind:'removed',agent:agentId(gone),name:'Old writer'}]});
  answers.push(made_.outcome,await read(owner,fake),await change(owner,fake,{intent:'set',value:known}));
  assert.equal(envOf(fake,late).OPENROUTER_API_KEY,known,'the late profile got the key');
  answers.push(await read(owner,fake),await change(owner,fake,{intent:'remove'}),await read(owner,fake));
  for(const name of ['begin_provider_key_change','finish_provider_key_change','forget_agent_profile_leftovers']) assert.ok(owner.calls(name).length>0,`${name} was called`);
  assert.ok(owner.calls('finish_provider_key_change').some(call=>call.reached.includes(late)),'the late round was taken');
  assert.ok(printed.some(line=>line.includes('Agent profile leftovers not forgotten')),'the failed forget is reported');
  const seen=JSON.stringify([answers,printed,owner.asked,made_.calls]);
  for(const secret of [known,known.slice(-4),`${known.slice(0,4)}...`,'OPENROUTER_API_KEY']) assert.ok(!seen.includes(secret),secret);
 } finally {
  for(const level of Object.keys(kept)) console[level]=kept[level];
  await fake.close();
 }
});
