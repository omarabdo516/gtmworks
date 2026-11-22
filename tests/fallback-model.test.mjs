import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFor, changeFallbackModel, fallbackPair, keepFallbackModels } from '../lib/fallback-model.mjs';
import { readFallbackChain, writeFallbackChain } from '../lib/hermes.mjs';
import { endOf } from '../lib/engine.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// #622 (spec #611): the Company's Fallback model is kept by the database and given to every profile its Agents run on;
// the Engine walks it only once the chosen model's accounts ran out. The database and, but for the driver's own test,
// the Engine are stubs: supabase/tests/company_fallback_model.sql proves who may write and read the choice, and
// provider-fallback.spec.ts one request on the app.
const company='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
const hermes={address:'http://127.0.0.1:8642',key:'test-only-key'};
const claude={provider:'anthropic',model:'claude-sonnet-4-6'};

/** An Engine whose profiles hold the chains given, and the reads and writes it was asked. */
function engine(chains={},{legacy=new Set(),refuse=new Set()}={}) {
 const calls=[]; const held=new Map(Object.entries(chains));
 return {calls,held,driver:{
  read:async connection=>{ calls.push(['read',connection.profile]); return held.has(connection.profile)||!refuse.has(connection.profile)?{state:'found',chain:held.get(connection.profile)??[],legacy:legacy.has(connection.profile)}:{state:'unreachable',chain:null,legacy:false}; },
  write:async(connection,change)=>{ calls.push(['write',connection.profile,change]); if(refuse.has(connection.profile)) return {state:'unreachable'}; held.set(connection.profile,change.chain); return {state:'saved'}; }}};
}
/** The Owner's session: the database's answers to the change. */
function owner({error=null,agents=[{agent:'a1',name:'Lead',profile:'co-x'},{agent:'a2',name:'Writer',profile:'ag-2'}],target={profile:'co-x',profiles:['co-x','ag-2']}}={}) {
 const asked=[];
 return {asked,rpc:async(name,args)=>{
  asked.push({name,args});
  if(name==='set_company_fallback_model') return error?{data:null,error}:{data:args.fallback_provider?`${args.fallback_provider}/${args.fallback_model}`:null,error:null};
  if(name==='company_agent_models') return {data:agents,error:null};
  if(name==='company_engine_target') return {data:[target],error:null};
  return {data:null,error:{code:'P0001'}};
 }};
}
const enabled=on=>async()=>({entries:[{id:'sub-anthropic',provider:'anthropic'}],off:new Set(on?[]:['sub-anthropic\u0000claude-sonnet-4-6'])});

test('a choice is one provider/model as the pickers take it; None is an empty chain', () => {
 assert.deepEqual(fallbackPair('anthropic/claude-sonnet-4-6'),claude);
 assert.deepEqual(fallbackPair('openrouter/anthropic/claude-opus-4.6'),{provider:'openrouter',model:'anthropic/claude-opus-4.6'});
 for(const bad of ['claude-sonnet-4-6','Anthropic/claude','anthropic/','anthropic/claude sonnet',7,null]) assert.equal(fallbackPair(bad),null,String(bad));
 assert.deepEqual(chainFor(claude),[claude]);
 assert.deepEqual(chainFor(null),[]);
});

test('the Owner\'s choice is kept, then every profile an Agent runs on takes it at once', async () => {
 const db=owner(); const {calls,held,driver}=engine();
 const answer=await changeFallbackModel(db,{company,value:'anthropic/claude-sonnet-4-6',hermes,driver,access:enabled(true)});
 assert.deepEqual(answer,{status:200,body:{model:'anthropic/claude-sonnet-4-6',failed:[]}});
 assert.deepEqual(db.asked[0],{name:'set_company_fallback_model',args:{c:company,fallback_provider:'anthropic',fallback_model:'claude-sonnet-4-6'}});
 assert.deepEqual(Object.fromEntries(held),{'co-x':[claude],'ag-2':[claude]});
 // None empties every chain, so no Agent moves to another kind of Provider.
 calls.length=0;
 assert.deepEqual(await changeFallbackModel(db,{company,value:null,hermes,driver,access:enabled(true)}),{status:200,body:{model:null,failed:[]}});
 assert.deepEqual(db.asked.at(-3),{name:'set_company_fallback_model',args:{c:company,fallback_provider:null,fallback_model:null}});
 assert.deepEqual(Object.fromEntries(held),{'co-x':[],'ag-2':[]});
 // A profile already holding the choice is read and not written again.
 calls.length=0;
 await changeFallbackModel(db,{company,value:null,hermes,driver,access:enabled(true)});
 assert.deepEqual(calls.filter(call=>call[0]==='write'),[]);
});

test('a profile the Engine did not take the choice on is named by its Agents; the choice is still kept', async () => {
 const db=owner({agents:[{agent:'a1',name:'Lead',profile:'co-x'},{agent:'a2',name:'Writer',profile:'ag-2'},{agent:'a3',name:'Ads',profile:'ag-2'}]});
 const {driver}=engine({},{refuse:new Set(['ag-2'])});
 const answer=await changeFallbackModel(db,{company,value:'anthropic/claude-sonnet-4-6',hermes,driver,access:enabled(true)});
 assert.deepEqual(answer,{status:200,body:{model:'anthropic/claude-sonnet-4-6',failed:[{agent:'a2',name:'Writer'},{agent:'a3',name:'Ads'}]}});
 // No Engine for the Company: every Agent is named, and the worker gives it the choice later.
 const none=await changeFallbackModel(owner(),{company,value:null,hermes:null,driver,access:enabled(true)});
 assert.equal(none.status,200);
});

test('a model no Provider switched on, a malformed value and a refusal change nothing', async () => {
 for(const [value,access,error,answer] of [
  ['anthropic/claude-sonnet-4-6',enabled(false),null,{status:400,body:{error:'settingModelNotEnabled'}}],
  ['claude-sonnet-4-6',enabled(true),null,{status:400,body:{error:'fallbackInvalid'}}],
  [7,enabled(true),null,{status:400,body:{error:'fallbackInvalid'}}],
  ['anthropic/claude-sonnet-4-6',enabled(true),{code:'42501'},{status:403,body:{error:'fallbackNotAllowed'}}],
  ['anthropic/claude-sonnet-4-6',enabled(true),{code:'XX000'},{status:502,body:{error:'fallbackFailed'}}]]) {
  const db=owner({error}); const {calls,driver}=engine();
  assert.deepEqual(await changeFallbackModel(db,{company,value,hermes,driver,access}),answer,String(value));
  assert.deepEqual(calls,[],'the Engine is not asked');
  if(answer.status===400) assert.deepEqual(db.asked,[],'nor the database');
 }
});

function worker(work) { return {rpc:async name=>name==='fallback_model_work'?{data:work,error:null}:{data:null,error:{code:'P0001'}}}; }

test('the worker gives each profile the Company\'s choice when it holds another, and looks again every few minutes', async () => {
 const work=[{company_id:company,provider:'anthropic',model:'claude-sonnet-4-6',profiles:['co-x','ag-1']},{company_id:other,provider:null,model:null,profiles:['co-y']}];
 const {calls,held,driver}=engine({'ag-1':[claude],'co-y':[{provider:'openrouter',model:'gpt-5.5'}]});
 const memory=new Map(); let now=1000;
 assert.equal(await keepFallbackModels(worker(work),{memory,driver,engineFor:async()=>hermes,now:()=>now}),2);
 assert.deepEqual(Object.fromEntries(held),{'co-x':[claude],'ag-1':[claude],'co-y':[]},'a profile holding another chain, None\'s included, takes the Company\'s');
 assert.deepEqual(calls.filter(call=>call[0]==='write').map(call=>call[1]),['co-x','co-y']);
 // A minute later nothing is read again; a new Agent's profile is read at once.
 calls.length=0; now+=60000; work[0].profiles.push('ag-2');
 assert.equal(await keepFallbackModels(worker(work),{memory,driver,engineFor:async()=>hermes,now:()=>now}),1);
 assert.deepEqual(calls.map(call=>call.slice(0,2)),[['read','ag-2'],['write','ag-2']]);
 // A changed choice is given to every profile at once.
 calls.length=0; work[0].provider=null; work[0].model=null;
 assert.equal(await keepFallbackModels(worker(work),{memory,driver,engineFor:async()=>hermes,now:()=>now}),3);
 assert.deepEqual(held.get('ag-2'),[]);
 // Five minutes on, every profile is read again, and one changed behind gtmworks's back is put back.
 calls.length=0; now+=5*60000; held.set('co-x',[claude]);
 assert.equal(await keepFallbackModels(worker(work),{memory,driver,engineFor:async()=>hermes,now:()=>now}),1);
 assert.deepEqual(calls.filter(call=>call[0]==='read').map(call=>call[1]).sort(),['ag-1','ag-2','co-x','co-y']);
 assert.deepEqual(held.get('co-x'),[]);
});

test('the worker clears an older fallback_model, skips a Company with no Engine and keeps the others', async () => {
 const work=[{company_id:other,provider:'anthropic',model:'claude-sonnet-4-6',profiles:['co-y']},{company_id:company,provider:null,model:null,profiles:['co-x','ag-1']}];
 const {calls,driver}=engine({'co-x':[{provider:'openrouter',model:'gpt-5.5'}]},{legacy:new Set(['co-x']),refuse:new Set(['ag-1'])});
 const memory=new Map();
 assert.equal(await keepFallbackModels(worker(work),{memory,driver,engineFor:async id=>id===other?null:hermes}),1);
 assert.deepEqual(calls.filter(call=>call[0]==='write'),[['write','co-x',{chain:[],legacy:true}]]);
 // A profile that could not be read is asked again at the next pass.
 calls.length=0;
 await keepFallbackModels(worker(work),{memory,driver,engineFor:async id=>id===other?null:hermes});
 assert.deepEqual(calls.map(call=>call.slice(0,2)),[['read','ag-1']]);
});

test('the driver reads both of the Engine\'s chain keys and replaces the chain whole', async () => {
 const fake=await fakeHermes(); const connection={address:fake.address,managementAddress:fake.managementAddress,key:fake.settings.key,profile:'ag-1'};
 try {
  fake.settings.profiles.set('ag-1',{soul:'',provider:'openai-codex',model:'gpt-5.5',key:fake.settings.key,config:{fallback_model:{provider:'openrouter',model:'gpt-5.5'}},credentials:{}});
  assert.deepEqual(await readFallbackChain(connection),{state:'found',chain:[{provider:'openrouter',model:'gpt-5.5'}],legacy:true});
  assert.deepEqual(await writeFallbackChain(connection,{chain:[claude],legacy:true}),{state:'saved'});
  assert.deepEqual(fake.settings.profiles.get('ag-1').config,{fallback_model:[],fallback_providers:[claude]});
  assert.deepEqual(await writeFallbackChain(connection,{chain:[]}),{state:'saved'});
  assert.deepEqual(await readFallbackChain(connection),{state:'found',chain:[],legacy:false});
  // A stale Engine that answers the write and keeps the old chain is a mismatch, never saved.
  fake.settings.staleConfig=true;
  assert.deepEqual(await writeFallbackChain(connection,{chain:[claude]}),{state:'mismatch'});
  assert.equal((await readFallbackChain({...connection,profile:'nobody'})).chain,null,'a profile the Engine does not have holds no chain');
 } finally { await fake.close(); }
});

test('a Run that ran out of every account ends as no_access, a failure a send again cannot fix yet', () => {
 assert.equal(endOf({state:'failed',reply:null,modelRefused:'access'}),'no_access');
 assert.equal(endOf({state:'failed',reply:null}),'failed');
});
