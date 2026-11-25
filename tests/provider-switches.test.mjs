import test from 'node:test';
import assert from 'node:assert/strict';
import { accountName, accountOrders, placedName, applyAccountOrder, keepProviderAccounts } from '../lib/provider-switches.mjs';

// #621: the Company's Engine moves a request to the next subscription account itself; this module gives it the Owner's
// order and switches and copies each move it recorded into the Company's log once. The Engine and the database are
// stubs: scripts/check-engine-pool-order.py proves the Engine's side on the pinned image, and
// supabase/tests/provider_switches.sql the log's.
const company='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
const hermes={address:'http://127.0.0.1:8642',key:'test-only-key'};
const accounts=[{provider:'openai-codex',account:'c0dex1',exhausted:true},{provider:'openai-codex',account:'c0dex2',exhausted:false},
 {provider:'openai-codex',account:'c0dex3',exhausted:false},{provider:'anthropic',account:'c1aude',exhausted:false}];
const move=(id,from,to,provider='openai-codex')=>({id:id.repeat(32).slice(0,32),provider,from,to,at:1795000000.5});

function engine({listed=accounts,switches=[],orderState='written',switchState='found'}={}) {
 const calls=[];
 return {calls,driver:{
  accounts:async connection=>{ calls.push(['accounts',connection.profile]); return listed?{state:'found',accounts:listed}:{state:'unreachable',accounts:null}; },
  order:async(connection,provider,entries)=>{ calls.push(['order',connection.profile,provider,entries]); return {state:orderState}; },
  switches:async connection=>{ calls.push(['switches',connection.profile]); return switchState==='found'?{state:'found',switches}:{state:switchState,switches:null}; }}};
}
function worker(work,{error=null,added=null}={}) {
 const asked=[];
 return {asked,rpc:async(name,args)=>{ asked.push({name,args}); return name==='provider_accounts_work'?{data:work,error:null}:{data:added??args.switches.length,error}; }};
}

test('each provider\'s accounts go to the Engine in the Owner\'s order, a switched-off one marked off', () => {
 const order={'openai-codex:c0dex3':{place:0,enabled:true},'anthropic:c1aude':{place:1,enabled:true},'openai-codex:c0dex1':{place:2,enabled:false}};
 assert.deepEqual(accountOrders(accounts,order),{
  'openai-codex':[{account:'c0dex3',off:false},{account:'c0dex1',off:true},{account:'c0dex2',off:false}],
  anthropic:[{account:'c1aude',off:false}]});
 assert.deepEqual(accountOrders([],order),{});
});

test('an account reads under the Owner\'s name, or its kind\'s with its place, as Settings names it', () => {
 const names={'openai-codex:c0dex2':'ChatGPT · Omar'};
 assert.equal(accountName(accounts,names,'openai-codex','c0dex1'),'ChatGPT');
 assert.equal(accountName(accounts,names,'openai-codex','c0dex2'),'ChatGPT · Omar');
 assert.equal(accountName(accounts,names,'openai-codex','c0dex3'),'ChatGPT 3');
 assert.equal(accountName(accounts,names,'anthropic','gone00'),'Claude');
});

test('a pass gives each Company\'s Engine its order once, and again only when it changed or a while later', async () => {
 const work=[{company_id:company,accounts:[{provider:'openai-codex',account:'c0dex2',ordered:true,place:0,enabled:true,name:null},{provider:'openai-codex',account:'c0dex1',ordered:true,place:1,enabled:false,name:null}]}];
 const {calls,driver}=engine(); const memory=new Map(); let now=1000;
 await keepProviderAccounts(worker(work),{memory,driver,engineFor:async()=>hermes,now:()=>now});
 assert.deepEqual(calls.filter(call=>call[0]==='order'),[
  ['order','default','openai-codex',[{account:'c0dex2',off:false},{account:'c0dex1',off:true},{account:'c0dex3',off:false}]],
  ['order','default','anthropic',[{account:'c1aude',off:false}]]]);
 calls.length=0; now+=60000;
 await keepProviderAccounts(worker(work),{memory,driver,engineFor:async()=>hermes,now:()=>now});
 assert.equal(calls.filter(call=>call[0]==='order').length,0,'an order the Engine took is not sent again a minute later');
 work[0].accounts[1].enabled=true;
 await keepProviderAccounts(worker(work),{memory,driver,engineFor:async()=>hermes,now:()=>now});
 assert.deepEqual(calls.filter(call=>call[0]==='order').map(call=>call[2]),['openai-codex'],'a switch turned on is sent at once');
 calls.length=0; now+=5*60000;
 await keepProviderAccounts(worker(work),{memory,driver,engineFor:async()=>hermes,now:()=>now});
 assert.equal(calls.filter(call=>call[0]==='order').length,2,'and every order again after five minutes');
 // Every call went to the root profile, which holds the Company's accounts.
 assert.ok(calls.every(call=>call[1]==='default'));
});

test('an order the Engine did not take, or an Engine without the patch, is sent the order again on the next pass', async () => {
 const work=[{company_id:company,accounts:[{provider:'anthropic',account:'c1aude',ordered:true,place:0,enabled:true,name:null}]}];
 for(const [orderState,sentTwice] of [['unreachable',true],['unsupported',true]]) {
  const {calls,driver}=engine({orderState}); const memory=new Map();
  await keepProviderAccounts(worker(work),{memory,driver,engineFor:async()=>hermes});
  await keepProviderAccounts(worker(work),{memory,driver,engineFor:async()=>hermes});
  assert.equal(calls.filter(call=>call[0]==='order').length===4,sentTwice,orderState);
 }
});

test('each move the Engine recorded is copied once, with the names the accounts read under, and nothing else', async () => {
 const work=[{company_id:company,accounts:[{provider:'openai-codex',account:'c0dex2',place:null,enabled:true,name:'ChatGPT · Omar'}]}];
 const {driver}=engine({switches:[move('a','c0dex1','c0dex2'),move('b','c0dex2','c0dex3')]});
 const memory=new Map(); const db=worker(work);
 assert.equal(await keepProviderAccounts(db,{memory,driver,engineFor:async()=>hermes}),2);
 assert.deepEqual(db.asked.filter(call=>call.name==='record_provider_switches'),[{name:'record_provider_switches',args:{c:company,switches:[
  {id:'a'.repeat(32),provider:'openai-codex',from:'c0dex1',to:'c0dex2',at:1795000000.5,from_name:'ChatGPT',to_name:'ChatGPT · Omar'},
  {id:'b'.repeat(32),provider:'openai-codex',from:'c0dex2',to:'c0dex3',at:1795000000.5,from_name:'ChatGPT · Omar',to_name:'ChatGPT 3'}]}}]);
 // Read again, the same moves are not sent again.
 assert.equal(await keepProviderAccounts(db,{memory,driver,engineFor:async()=>hermes}),0);
 assert.equal(db.asked.filter(call=>call.name==='record_provider_switches').length,1);
});

test('a move the database refused is sent again on the next pass', async () => {
 const work=[{company_id:company,accounts:[]}];
 const {driver}=engine({switches:[move('c','c0dex1','c0dex2')]});
 const memory=new Map();
 const refused=worker(work,{error:{code:'22023'}});
 assert.equal(await keepProviderAccounts(refused,{memory,driver,engineFor:async()=>hermes}),0);
 const kept=worker(work);
 assert.equal(await keepProviderAccounts(kept,{memory,driver,engineFor:async()=>hermes}),1);
});

test('a Company whose Owner never placed or switched a Provider keeps the Engine\'s own order; one switched on again is sent', async () => {
 const {calls,driver}=engine();
 await keepProviderAccounts(worker([{company_id:company,accounts:[{provider:'openai-codex',account:'c0dex2',ordered:false,place:null,enabled:true,name:'ChatGPT · Omar'}]}]),{driver,engineFor:async()=>hermes});
 assert.deepEqual(calls.map(call=>call[0]),['accounts','switches']);
 // Switched off, then on again while the Engine could not be reached: on, with no place, it is still given to the Engine.
 calls.length=0;
 await keepProviderAccounts(worker([{company_id:company,accounts:[{provider:'openai-codex',account:'c0dex1',ordered:true,place:null,enabled:true,name:null}]}]),{driver,engineFor:async()=>hermes});
 assert.deepEqual(calls.filter(call=>call[0]==='order').map(call=>call[3]),[[{account:'c0dex1',off:false},{account:'c0dex2',off:false},{account:'c0dex3',off:false}],[{account:'c1aude',off:false}]]);
});

test('a Company whose Engine is not made, does not list its accounts or keeps no record is skipped, and the others are kept', async () => {
 const work=[{company_id:other,accounts:[]},{company_id:company,accounts:[]}];
 const unread=engine({listed:null});
 assert.equal(await keepProviderAccounts(worker(work),{driver:unread.driver,engineFor:async id=>id===company?hermes:null}),0);
 assert.deepEqual(unread.calls,[['accounts','default']]);
 const none=engine({switchState:'unsupported'}); const db=worker(work);
 assert.equal(await keepProviderAccounts(db,{driver:none.driver,engineFor:async()=>hermes}),0);
 assert.equal(db.asked.filter(call=>call.name==='record_provider_switches').length,0);
 // One Company's failure does not stop the pass.
 const {driver}=engine({switches:[move('d','c0dex1','c0dex2')]});
 const failing={...driver,accounts:async connection=>{ if(connection.address.includes('8643')) throw new Error('boom'); return driver.accounts(connection); }};
 const both=worker(work);
 await keepProviderAccounts(both,{driver:failing,engineFor:async id=>id===other?{...hermes,address:'http://127.0.0.1:8643'}:hermes});
 assert.deepEqual(both.asked.filter(call=>call.name==='record_provider_switches').map(call=>call.args.c),[company]);
});

test('the Owner\'s change goes to the Engine at once, read from their own session', async () => {
 const {calls,driver}=engine();
 const person={from:()=>({select:()=>({eq:async()=>({data:[{provider:'openai-codex',account:'c0dex1',place:0,enabled:false}],error:null})})})};
 await applyAccountOrder(person,{company,hermes,driver});
 assert.deepEqual(calls.filter(call=>call[0]==='order').map(call=>[call[2],call[3]]),[
  ['openai-codex',[{account:'c0dex1',off:true},{account:'c0dex2',off:false},{account:'c0dex3',off:false}]],['anthropic',[{account:'c1aude',off:false}]]]);
 // An order the database did not answer is never guessed: nothing is sent.
 const unread={from:()=>({select:()=>({eq:async()=>({data:null,error:{code:'500'}})})})};
 const quiet=engine();
 await applyAccountOrder(unread,{company,hermes,driver:quiet.driver});
 assert.equal(quiet.calls.filter(call=>call[0]==='order').length,0);
});

// The two calls on the Engine's root, against the fake Engine as the patched pinned release answers them.
test('the order reaches the root\'s pool by entry id and switch, and the moves read back without anything else', async () => {
 const { fakeHermes } = await import('./fake-hermes.mjs');
 const { writeAccountOrder, readAccountSwitches } = await import('../lib/hermes.mjs');
 const fake=await fakeHermes();
 try {
  const root={address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:fake.settings.key};
  fake.settings.defaultPool['openai-codex']=[{id:'c0dex1',label:'said@example.com',auth_type:'oauth',source:'device_code',priority:0,access_token:'t1'},
   {id:'c0dex2',label:'omar@example.com',auth_type:'oauth',source:'manual:device_code',priority:1,access_token:'t2'}];
  assert.deepEqual(await writeAccountOrder(root,'openai-codex',[{account:'c0dex2',off:false},{account:'c0dex1',off:true}]),{state:'written'});
  assert.deepEqual(fake.settings.defaultPool['openai-codex'].map(row=>[row.id,row.off]),[['c0dex2',false],['c0dex1',true]]);
  const sent=fake.settings.managementRequests.at(-1);
  assert.equal(sent.path,'/api/credentials/pool/openai-codex/order?profile=default');
  assert.deepEqual(sent.body,{entries:[{id:'c0dex2',off:false},{id:'c0dex1',off:true}]});
  // Only the root, one of the subscriptions, and accounts by the Engine's id are sent.
  for(const [connection,provider,entries] of [[{...root,profile:'co-one'},'openai-codex',[]],[root,'openrouter',[]],[root,'openai-codex',[{account:'c0 dex',off:false}]],[root,'openai-codex',[{account:'c0dex1'}]]])
   assert.deepEqual(await writeAccountOrder(connection,provider,/** @type {any} */(entries)),{state:'failed'});
  fake.settings.switches.push({id:'e'.repeat(32),provider:'openai-codex',from:'c0dex1',to:'c0dex2',at:1795000000.5,label:'said@example.com'},
   {id:'nope',provider:'openai-codex',from:'c0dex1',to:'c0dex2',at:1},{id:'f'.repeat(32),provider:'openrouter',from:'a',to:'b',at:1});
  assert.deepEqual(await readAccountSwitches(root),{state:'found',switches:[{id:'e'.repeat(32),provider:'openai-codex',from:'c0dex1',to:'c0dex2',at:1795000000.5}]});
  // An Engine without the patch answers 404 on both: it keeps its own order and records nothing.
  fake.settings.managementStatus=404;
  assert.deepEqual(await writeAccountOrder(root,'openai-codex',[]),{state:'unsupported'});
  assert.deepEqual(await readAccountSwitches(root),{state:'unsupported',switches:null});
 } finally { await fake.close(); }
});

// #731: a Conversation names an account that ran out by its kept place, as Settings names it.
test('an account with a known place reads under the Owner\'s name, else its kind\'s with its place', () => {
 const names={'openai-codex:c0dex2':'Omar’s ChatGPT'};
 assert.equal(placedName(names,'openai-codex','c0dex1',1),'ChatGPT');
 assert.equal(placedName(names,'openai-codex','c0dex3',3),'ChatGPT 3');
 assert.equal(placedName(names,'openai-codex','c0dex2',2),'Omar’s ChatGPT');
 assert.equal(placedName(names,'other-kind','x',2),'other-kind 2');
});
