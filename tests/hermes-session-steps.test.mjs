import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { engineFor } from '../lib/engine.mjs';

// #346 on the fake Engine server, which serves a session's messages as the pinned release's management listener does
// (hermes_cli/web_routers/sessions.py get_session_messages): a Run's steps are read from the session, never kept.
const profile='co-steps';
const connection=(/** @type {Awaited<ReturnType<typeof fakeHermes>>} */ fake)=>({address:fake.address,managementAddress:fake.managementAddress,profile,key:fake.settings.key});
const call=(/** @type {string} */ id,/** @type {string} */ name,/** @type {object} */ args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const user=(/** @type {number} */ timestamp,/** @type {string} */ content)=>({role:'user',content,timestamp});
const asked=(/** @type {number} */ timestamp,/** @type {any[]} */ calls)=>({role:'assistant',content:'',tool_calls:calls,timestamp});
const result=(/** @type {number} */ timestamp,/** @type {string} */ id,/** @type {string} */ name,/** @type {unknown} */ content)=>({role:'tool',tool_call_id:id,tool_name:name,content:typeof content==='string'?content:JSON.stringify(content),timestamp});
const replied=(/** @type {number} */ timestamp,/** @type {string} */ content)=>({role:'assistant',content,timestamp});

test('a session\'s turns are read from Hermes: each turn\'s tool calls in order, how each ended, and the turn\'s length',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.sessions.set('session-1',{profile,messages:[
   user(1000,'Plan the ads'),
   asked(1002,[call('call_1','web_search',{query:'accounting courses Cairo'}),call('call_2','read_file',{path:'campaigns.csv'})]),
   result(1005,'call_1','web_search',{results:[]}),
   result(1006,'call_2','read_file',{success:false,error:'not found'}),
   asked(1007,[call('call_3','terminal',{command:'ls'})]),
   replied(1041.4,'Here is the plan.'),
   user(2000,'And the budget?'),
   replied(2003,'15,000 a month.')]});
  const read=await engineFor(connection(fake)).session('session-1');
  assert.deepEqual(read,{state:'found',turns:[
   {at:1000,seconds:41,steps:[{tool:'web_search',preview:'accounting courses Cairo',state:'done'},{tool:'read_file',preview:'campaigns.csv',state:'failed'},{tool:'terminal',preview:'ls',state:'started'}]},
   {at:2000,seconds:3,steps:[]}]});
  assert.ok(fake.settings.managementRequests.some(request=>request.path?.startsWith(`/api/sessions/session-1/messages?profile=${profile}`)),'read from the profile the conversation runs on');
 } finally { await fake.close(); }
});

test('a session Hermes does not know is missing, a refused key refused, an Engine that cannot be asked unreachable',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.sessions.set('elsewhere',{profile:'co-other',messages:[user(1,'hi')]});
  assert.deepEqual(await engineFor(connection(fake)).session('unknown'),{state:'missing',turns:null});
  assert.deepEqual(await engineFor(connection(fake)).session('elsewhere'),{state:'missing',turns:null},'another profile\'s session is not this one\'s');
  assert.deepEqual(await engineFor({...connection(fake),key:'wrong'}).session('session-1'),{state:'refused',turns:null});
  assert.deepEqual(await engineFor({...connection(fake),address:'http://8.8.8.8:1',managementAddress:'http://8.8.8.8:2'}).session('session-1'),{state:'unreachable',turns:null},'an address that is not allowed is never called');
  assert.deepEqual(await engineFor(connection(fake)).session('../profiles'),{state:'missing',turns:null},'no id that is not a session id is sent');
 } finally { await fake.close(); }
});

test('a preview that holds a path, looks like a key or names the Engine is dropped, and a tool that names the Engine is no step',async()=>{
 const fake=await fakeHermes();
 try {
  const previews=['/etc/app/.env','~/notes.md','api_key=abcd1234efgh','sk-abcdefghijklmnopqrstuvwxyz123456','ask Hermes for the plan','https://rslearning.com/courses/accounting',' best  audiences\nfor   ads '];
  fake.settings.sessions.set('session-2',{profile,messages:[user(10,'Go'),
   asked(11,[...previews.map((query,index)=>call(`call_${index}`,'web_search',{query})),call('call_engine','hermes_memory',{query:'x'}),call('call_bad','read file',{path:'x'}),call('call_none','todo',{items:[1]})]),
   replied(12,'Done')]});
  const read=await engineFor(connection(fake)).session('session-2');
  assert.deepEqual(read.turns?.[0].steps.map(step=>[step.tool,step.preview]),[...previews.slice(0,5).map(()=>['web_search',null]),['web_search','https://rslearning.com/courses/accounting'],['web_search','best audiences for ads'],['todo',null]]);
 } finally { await fake.close(); }
});

test('a long session is read page by page, oldest first',async()=>{
 const fake=await fakeHermes();
 try {
  const messages=[user(1,'Go'),...Array.from({length:600},(_,index)=>asked(2+index,[call(`call_${index}`,'web_search',{query:`q${index}`})])),replied(700,'Done')];
  fake.settings.sessions.set('session-3',{profile,messages});
  const read=await engineFor(connection(fake)).session('session-3');
  assert.equal(read.turns?.[0].steps.length,600);
  assert.equal(read.turns?.[0].steps.at(-1)?.preview,'q599');
 } finally { await fake.close(); }
});
