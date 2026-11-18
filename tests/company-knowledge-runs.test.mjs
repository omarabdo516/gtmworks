import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { sendMessage, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { fakeEngine } from './fake-engine.mjs';

// Every run of a Company's Agents is given the Company knowledge (#27) through the engine contract, after the Agent's
// own instructions and before its rules and its sender's note, as the database pinned it at the run's first start.
const encryptionKey=Buffer.alloc(32,7).toString('base64');
const connection='f9000000-0000-0000-0000-000000000001';
const role='You are the ad critic on RS Learning\'s marketing team.';
const voice='بنكلّم خريج تجارة أو محاسب في أول طريقه زي زميل أكبر منه بسنتين، مش زي مدرّس.';
const banned='• «شغل مضمون» أو «وظيفة مضمونة 100%»: وعد مقدرش نثبته.';
const rule='Answer every comment within the day';
const note='Answer in short points.';

// The database as the run paths see it: the Company's parts as stored now, each run's pinned at its first start (while
// no attempt of its key was begun), and the attempts begun per key.
function databases({parts,knowledge}={}) {
 const company={parts:parts??[]}; const pinned=new Map(); const attempts=new Map();
 const rpc=async(/** @type {string} */ name,/** @type {any} */ given)=>{
  if(name==='conversation_agent') return {data:null,error:null};
  if(name==='reserve_conversation_turn') return {data:{state:'reserved',connection,note},error:null};
  if(name==='queued_conversations') return {data:[{conversation:'c'}],error:null};
  if(name==='claim_conversation_turn') return {data:[{company:'co',agent:'a',person:'p',send_key:'q',message:'Draft the offer email',connection,note,retry:false}],error:null};
  if(name==='pin_run') return {data:{tools:null,rules:[rule]},error:null};
  if(name==='pin_run_knowledge') {
   if(knowledge) return knowledge;
   if(!pinned.has(given.message_key)&&!attempts.get(given.message_key)) pinned.set(given.message_key,structuredClone(company.parts));
   return {data:pinned.get(given.message_key)??[],error:null};
  }
  if(name==='pin_run_history') return {data:null,error:null};
  if(name==='pin_run_model') return {data:null,error:null};
  if(name==='begin_start') { attempts.set(given.message_key,(attempts.get(given.message_key)??0)+1); return {data:attempts.get(given.message_key),error:null}; }
  if(['send_conversation_message','record_conversation_turn'].includes(name)) return {data:true,error:null};
  return {data:null,error:{message:`unexpected ${name}`}}; };
 const chain=(/** @type {unknown} */ data)=>{ const c={select:()=>c,eq:()=>c,maybeSingle:async()=>({data,error:null})}; return c; };
 const db={rpc,from:(/** @type {string} */ table)=>chain(table==='conversation_messages'?null:{id:'a9000000-0000-0000-0000-000000000001',instructions:role})};
 const service={rpc,from:(/** @type {string} */ table)=>chain(table==='hermes_agents'?{instructions:role}:{address:'http://hermes:8642',profile:'writer',state:'connected',features:['run_submission'],key_encrypted:encryptSecret('test-only-key',encryptionKey)})};
 return {db,service,company};
}
/** @param {ReturnType<typeof fakeEngine>} fake */
function recording(fake) {
 const starts=/** @type {any[]} */([]);
 return {starts,engineFor:(/** @type {object} */ linked)=>{ const engine=fake.engineFor(linked); return {...engine,start:(/** @type {any} */ run)=>{ starts.push(run); return engine.start(run); }}; }};
}
const send=(/** @type {ReturnType<typeof databases>} */ {db,service},/** @type {string} */ sendKey,/** @type {object} */ engine)=>sendMessage(db,service,{company:'co',conversation:'c',sendKey,message:'Draft the offer email',encryptionKey,...engine});
/** @param {string} sent @param {string[]} texts */
const inOrder=(sent,texts)=>texts.every((text,n)=>sent.includes(text)&&(n===0||sent.indexOf(texts[n-1])<sent.indexOf(text)));

test('a run carries the Company knowledge after the Agent\'s own instructions and before its rules and its sender\'s note',async()=>{
 const fake=fakeEngine();
 assert.deepEqual(await send(databases({parts:[{part:'voice',body:voice},{part:'banned',body:banned}]}),'k',{engineFor:fake.engineFor}),{conversation:'c'});
 const sent=/** @type {string} */(fake.runs[0].instructions);
 assert.ok(inOrder(sent,[role,'Brand voice',voice,'Banned claims',banned,rule,note]),sent);
 assert.ok(sent.endsWith(note));
});

test('a queued turn carries it too',async()=>{
 const fake=fakeEngine(); const {service}=databases({parts:[{part:'products',body:'Tax diploma: 1,800 EGP'}]});
 assert.equal(await startQueuedTurns(service,{encryptionKey,engineFor:fake.engineFor}),1);
 assert.ok(inOrder(/** @type {string} */(fake.runs[0].instructions),[role,'Products and prices','Tax diploma: 1,800 EGP',rule,note]));
});

test('after an edit the next run carries the new text, and a retry of an earlier run the text it first sent',async()=>{
 const fake=fakeEngine(); const {starts,engineFor}=recording(fake); const databasesOf=databases({parts:[{part:'voice',body:voice}]});
 await send(databasesOf,'k1',{engineFor});
 databasesOf.company.parts=[{part:'voice',body:'Short sentences, no exclamation marks.'}];
 await send(databasesOf,'k1',{engineFor});
 assert.deepEqual(starts[1],{...starts[0],retry:true},'the retry sends the same request');
 await send(databasesOf,'k2',{engineFor});
 assert.ok(starts[2].instructions.includes('Short sentences, no exclamation marks.'));
 assert.ok(!starts[2].instructions.includes(voice));
 assert.equal(fake.runs.length,2);
});

test('a run with no knowledge pinned is told none, and a refused pin starts no run',async()=>{
 const fake=fakeEngine();
 for(const data of [[],null,'not a list',[{part:'voice',body:''}]]) await send(databases({knowledge:{data,error:null}}),`k-${JSON.stringify(data)}`,{engineFor:fake.engineFor});
 for(const run of fake.runs) assert.ok(!run.instructions?.includes('The company keeps the knowledge'),String(run.instructions));
 assert.equal(fake.runs.length,4);
 const refusal={message:'permission denied',code:'42501'};
 await assert.rejects(send(databases({knowledge:{data:null,error:refusal}}),'k',{engineFor:fake.engineFor}),refusal);
 await startQueuedTurns(databases({knowledge:{data:null,error:refusal}}).service,{encryptionKey,engineFor:fake.engineFor});
 assert.equal(fake.runs.length,4);
});
