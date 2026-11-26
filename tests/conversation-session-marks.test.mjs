import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markConversationSessions } from '../lib/conversation-archive.mjs';
import { fakeEngine } from './fake-engine.mjs';
import { engineRecord } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';

// #674 on the fake engine: the worker carries each archived (or restored) Conversation's mark to its Engine session,
// and settles it once the Engine took it. The database is a small stand-in for conversation_sessions_to_mark,
// conversation_session_marked and conversation_session_missing (supabase/tests/conversation_archive.sql proves the real
// ones, among them how long a missing session is asked again).
const hermes={address:'http://hermes:8642',key:'test-only-key'};
const company='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
// Each Company's Engine record, as the database holds it; the fake of the contract answers for the Engine.
engineRecord(company,hermes); engineRecord(other,{...hermes,address:'http://other:8642'});

function database(rows,{gone=false}={}) {
 const due=[...rows]; const settled=/** @type {{conversation:string,archived:boolean}[]} */([]); const missing=/** @type {{conversation:string,archived:boolean}[]} */([]); const later=/** @type {string[]} */([]);
 const service={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  if(name==='conversation_sessions_to_mark') return {data:[...due],error:null};
  if(name==='conversation_session_marked') { settled.push(args); due.splice(due.findIndex(row=>row.conversation===args.conversation),1); return {data:true,error:null}; }
  if(name==='conversation_session_missing') { missing.push(args); return {data:gone,error:null}; }
  if(name==='conversation_sessions_later') { later.push(...args.conversations); return {data:null,error:null}; }
  return {data:null,error:{message:'unexpected'}};
 }};
 return {service,settled,due,missing,later};
}

test('each Conversation\'s session takes its mark on its Agent\'s profile, and the mark is settled once taken',async()=>{
 const fake=fakeEngine();
 const {service,settled}=database([
  {conversation:'c1',company,profile:'ag-1',session:'s1',archived:true},
  {conversation:'c2',company,profile:'ag-2',session:'s2',archived:false}]);
 assert.equal(await withEngineContract(fake.engineFor,()=>markConversationSessions(service)),2);
 assert.deepEqual(fake.marks,[{session:'s1',archived:true},{session:'s2',archived:false}]);
 assert.deepEqual(fake.connections.map(connection=>/** @type {any} */(connection).profile),['ag-1','ag-2'],'each on its own Agent\'s profile');
 assert.deepEqual(settled,[{conversation:'c1',archived:true},{conversation:'c2',archived:false}]);
});

test('an Engine that does not answer keeps its marks for the next pass, and never holds up another Company\'s',async()=>{
 const fake=fakeEngine();
 fake.settings.marking='unreachable';
 const {service,settled,due}=database([
  {conversation:'c1',company,profile:'ag-1',session:'s1',archived:true},
  {conversation:'c2',company,profile:'ag-2',session:'s2',archived:true}]);
 assert.equal(await withEngineContract(fake.engineFor,()=>markConversationSessions(service)),0);
 assert.equal(fake.marks.length,1,'one Engine that does not answer is not asked again in the pass');
 assert.deepEqual(settled,[]);
 fake.settings.marking='marked';
 assert.equal(await withEngineContract(fake.engineFor,()=>markConversationSessions(service)),2,'the mark is sent once it answers');
 assert.deepEqual(due,[]);
 const later=fakeEngine();
 later.settings.marking='unreachable';
 const two=database([{conversation:'c3',company,profile:'ag-1',session:'s3',archived:true},{conversation:'c4',company:other,profile:'ag-9',session:'s4',archived:true}]);
 await withEngineContract(connection=>{
  const engine=later.engineFor(connection); later.settings.marking=/** @type {any} */(connection).address.includes('other')?'marked':'unreachable'; return engine; },()=>markConversationSessions(two.service));
 assert.deepEqual(two.settled,[{conversation:'c4',archived:true}],'another Company\'s Engine is still asked');
});

test('the marks of an Engine that does not answer wait a minute in the database, so another Company\'s beyond the page reach the next pass',async()=>{
 const fake=fakeEngine();
 fake.settings.marking='unreachable';
 const {service,later,settled}=database([
  {conversation:'c1',company,profile:'ag-1',session:'s1',archived:true},
  {conversation:'c2',company,profile:'ag-2',session:'s2',archived:true},
  {conversation:'c3',company,profile:null,session:'s3',archived:true}]);
 await withEngineContract(fake.engineFor,()=>markConversationSessions(service));
 assert.deepEqual(later,['c1','c2'],'each of the held Engine\'s marks is put off, the one never asked among them');
 assert.deepEqual(settled,[]);
});

test('a session the Engine does not keep, or a Conversation whose Agent is gone, is told to the database, which decides when to let it go',async()=>{
 const fake=fakeEngine();
 fake.settings.marking='missing';
 const rows=[{conversation:'c1',company,profile:'ag-1',session:'s1',archived:true},{conversation:'c2',company,profile:null,session:'s2',archived:true}];
 const waiting=database(rows);
 assert.equal(await withEngineContract(fake.engineFor,()=>markConversationSessions(waiting.service)),0,'a session not written yet is not settled: it is asked again later');
 assert.equal(fake.marks.length,1,'a Conversation with no Agent asks no Engine');
 assert.deepEqual(waiting.settled,[],'nothing is marked as taken');
 assert.deepEqual(waiting.missing,[{conversation:'c1',archived:true},{conversation:'c2',archived:true}]);
 const gone=database(rows,{gone:true});
 assert.equal(await withEngineContract(fake.engineFor,()=>markConversationSessions(gone.service)),2,'once the database lets them go, they count as settled');
});

test('a refused key keeps the mark for the next pass',async()=>{
 const fake=fakeEngine();
 fake.settings.marking='refused';
 const {service,settled}=database([{conversation:'c1',company,profile:'ag-1',session:'s1',archived:true}]);
 assert.equal(await withEngineContract(fake.engineFor,()=>markConversationSessions(service)),0);
 assert.deepEqual(settled,[]);
});
