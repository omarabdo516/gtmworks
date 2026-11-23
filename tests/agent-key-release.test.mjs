import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hermesEngine } from '../lib/hermes.mjs';
import { releaseKeyWaits } from '../lib/company-profiles.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// #660: an Agent made waiting for the Company's key before this version (#299) is released by the worker alone, once its
// own profile has the Company's Providers as they stand: the space's key, and the model Lead runs on.
const tail='0000000000000000000000000000001';
const company='10000000-0000-0000-0000-000000000001';
const space=`cs-1${tail}`; const main=`co-1${tail}`; const waiter=`ag-c${tail}`; const other=`ag-d${tail}`;
const agentOf=profile=>`${profile.slice(3,11)}-${profile.slice(11,15)}-${profile.slice(15,19)}-${profile.slice(19,23)}-${profile.slice(23)}`;
const known='sk-or-v1-known-0123456789abcdef0123456789abcdef';
const made=(fake,...names)=>{ for(const name of names) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:'test-only-key',config:{},credentials:{}}); };
const runsOn=fake=>fake.settings.requests.filter(request=>/^\/p\/[^/]+\/v1\/runs/.test(request.path)).map(request=>decodeURIComponent(request.path.split('/')[2]));
const row=(profile,seen=4)=>({company_id:company,agent_id:agentOf(profile),profile,space,keeper:main,seen});
// The worker's database: the waits it lists, and release_agent_key_wait's answer (`released`, false while a key change
// moved the count past `seen`).
function database(rows,{released=()=>true}={}) {
 const calls=[]; const waits=new Set(rows.map(found=>found.agent_id));
 return {calls,waits,rpc:async(name,args)=>{ calls.push([name,args]);
  if(name==='agent_key_wait_work') return {data:rows.filter(found=>waits.has(found.agent_id)),error:null};
  if(name==='release_agent_key_wait') { const ok=released(args); if(ok) waits.delete(args.agent); return {data:ok,error:null}; }
  return {data:null,error:{message:'unexpected'}}; }};
}
const connection=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:main,key:'test-only-key'});
const pass=(db,fake,options={})=>releaseKeyWaits(db,{hermes:connection(fake),driverFor:at=>hermesEngine(at),...options});

test('an Agent waiting from before the update gets the space\'s key and Lead\'s model, its wait ends, and it answers a turn on its own profile', async () => {
 const fake=await fakeHermes();
 try {
  made(fake,space,main,waiter);
  fake.settings.profiles.get(space).env={OPENROUTER_API_KEY:known};
  fake.settings.defaultCredentials.anthropic='test-only-claude-oauth';
  fake.settings.subscriptionModels.anthropic=['claude-sonnet-4-6'];
  Object.assign(fake.settings.profiles.get(main),{provider:'anthropic',model:'claude-sonnet-4-6'});
  const db=database([row(waiter)]);
  assert.deepEqual(await pass(db,fake),{released:1});
  assert.equal(fake.settings.profiles.get(waiter).env.OPENROUTER_API_KEY,known,'its profile holds the Company\'s key');
  assert.deepEqual([fake.settings.profiles.get(waiter).provider,fake.settings.profiles.get(waiter).model],['anthropic','claude-sonnet-4-6'],'on the model Lead runs on');
  assert.deepEqual(db.calls.find(([name])=>name==='release_agent_key_wait')[1],{agent:agentOf(waiter),engine_profile:waiter,seen:4},'released with the count the work was read at');
  assert.equal(db.waits.size,0,'it leaves "Waiting on you"');
  assert.ok(!JSON.stringify(db.calls).includes(known),'no key reaches the database');
  const engine=hermesEngine({...connection(fake),profile:waiter});
  const run=await engine.start({conversation:'conversation-1',input:'Write the June article',idempotencyKey:'send-1'});
  assert.equal((await engine.read(run)).state,'completed');
  assert.deepEqual([...new Set(runsOn(fake))],[waiter],'its turn runs on its own profile only');
 } finally { await fake.close(); }
});

test('a profile that already has a model keeps it, and is only given the key', async () => {
 const fake=await fakeHermes();
 try {
  made(fake,space,main,waiter);
  fake.settings.profiles.get(space).env={OPENROUTER_API_KEY:known};
  Object.assign(fake.settings.profiles.get(waiter),{provider:'openrouter',model:'openai/gpt-5.5'});
  assert.deepEqual(await pass(database([row(waiter)]),fake),{released:1});
  assert.deepEqual([fake.settings.profiles.get(waiter).provider,fake.settings.profiles.get(waiter).model],['openrouter','openai/gpt-5.5']);
 } finally { await fake.close(); }
});

test('an Agent the Company\'s accounts give no model stays waiting, and is asked again at most once a minute', async () => {
 const fake=await fakeHermes();
 try {
  made(fake,space,main,waiter);
  fake.settings.profiles.get(space).env={OPENROUTER_API_KEY:known};
  fake.settings.providerModels.openrouter=[];
  const db=database([row(waiter)]); const waiting=new Map(); let clock=1000;
  const now=()=>clock;
  assert.deepEqual(await pass(db,fake,{waiting,now}),{released:0});
  assert.equal(db.waits.size,1,'still waiting');
  assert.ok(!db.calls.some(([name])=>name==='release_agent_key_wait'),'nothing is released');
  const reveals=fake.settings.reveals.length;
  clock+=30000; await pass(db,fake,{waiting,now});
  assert.equal(fake.settings.reveals.length,reveals,'not asked again within the minute');
  fake.settings.providerModels.openrouter=['openai/gpt-5.5'];
  clock+=31000;
  assert.deepEqual(await pass(db,fake,{waiting,now}),{released:1},'a model the Company gains later starts it');
 } finally { await fake.close(); }
});

test('a release a key change overtook leaves the wait, and the next pass gives the Providers again; one Agent that fails holds back no other', async () => {
 const fake=await fakeHermes();
 try {
  made(fake,space,main,other);
  fake.settings.profiles.get(space).env={OPENROUTER_API_KEY:known};
  // The waiter's profile the Engine lost: its write fails, and the other Agent is still released.
  const db=database([row(waiter),row(other)],{released:args=>args.seen>=5});
  assert.deepEqual(await pass(db,fake),{released:0});
  assert.equal(db.waits.size,2,'a change since the count read leaves both waiting');
  db.calls.length=0;
  const later=database([row(waiter,5),row(other,5)],{released:args=>args.seen>=5});
  assert.deepEqual(await pass(later,fake),{released:1});
  assert.deepEqual([...later.waits],[agentOf(waiter)],'the lost profile stays waiting for the worker to make it');
 } finally { await fake.close(); }
});

test('no Engine at all releases nothing and asks the database nothing', async () => {
 const db=database([]);
 assert.deepEqual(await releaseKeyWaits(db,{hermes:null}),{released:0});
 assert.deepEqual(db.calls,[]);
});
