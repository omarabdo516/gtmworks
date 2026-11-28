import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineServing } from './engine-records.mjs';
import { keepConversationRows } from '../lib/conversation-drift.mjs';
import { upkeepSchedule } from '../lib/upkeep-schedule.mjs';

// #881 (spec #864): a Conversation is its Engine session, and gtmworks keeps only its row. A row whose session is gone
// from the Engine, as when its Agent is deleted there, is forgotten by the worker's slow check for drift (ADR 0031 item
// 4), never on a page read: one pass every five minutes, an archived session's row kept, a row whose Agent is gone from
// gtmworks forgotten without asking, and an Engine that does not answer left alone.
const rs='10000000-0000-0000-0000-000000000001';
const profile='rs-faye';
// The worker's database: each Company's sessions by profile (null for an Agent that is gone), and what it was told to forget.
const database=(/** @type {{company_id:string,profile:string|null,sessions:string[]}[]} */ rows)=>{
 const forgotten=/** @type {{c:string,sessions:string[]}[]} */([]);
 return {forgotten,rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  if(name==='conversation_drift') return {data:rows,error:null};
  if(name==='forget_conversations') { forgotten.push(args); return {data:args.sessions.length,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
};
const fresh=()=>({memory:{drift:0},health:upkeepSchedule()});
const said=(/** @type {string} */ content)=>[{role:'user',content,timestamp:1000}];

test('a row whose session is gone from the Engine is forgotten; one still there, archived or not, stays',async()=>{
 const fake=await engineServing(rs);
 try {
  fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
  fake.settings.sessions.set('kept',{profile,messages:said('Plan the ads')});
  fake.settings.sessions.set('shelved',{profile,messages:said('Old webinar')});
  fake.settings.archivedSessions.add(`${profile}:shelved`);
  const db=database([{company_id:rs,profile:null,sessions:['agent-gone']},{company_id:rs,profile,sessions:['kept','shelved','gone']}]);
  assert.deepEqual(await keepConversationRows(db,fresh()),{forgotten:2});
  assert.deepEqual(db.forgotten,[{c:rs,sessions:['agent-gone']},{c:rs,sessions:['gone']}]);
  const asked=fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/sessions'));
  assert.deepEqual(asked.map(request=>`${request.method} ${request.path}`),[`GET /api/sessions?profile=${profile}&order=recent&archived=include&limit=100&offset=0`,`GET /api/sessions/gone?profile=${profile}`],'the list is read, and the one session it did not show is asked for on its own: nothing is written');
 } finally { await fake.close(); }
});

test('a session the paged list missed while the Engine still holds it is asked for on its own, and its row stays',async()=>{
 const fake=await engineServing(rs);
 try {
  fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
  fake.settings.sessions.set('moved',{profile,messages:said('Busy while the list was read')});
  fake.settings.listSkips.add('moved');
  const db=database([{company_id:rs,profile,sessions:['moved','gone']}]);
  assert.deepEqual(await keepConversationRows(db,fresh()),{forgotten:1});
  assert.deepEqual(db.forgotten,[{c:rs,sessions:['gone']}]);
  const asked=fake.settings.managementRequests.filter(request=>/^\/api\/sessions\/(moved|gone)\?/.test(String(request.path))).map(request=>String(request.path).split('?')[0]).sort();
  assert.deepEqual(asked,['/api/sessions/gone','/api/sessions/moved'],'each session the list did not show is read on its own');
 } finally { await fake.close(); }
});

test('an Agent deleted on the Engine has every row of its forgotten, once every five minutes',async()=>{
 const fake=await engineServing(rs);
 try {
  const db=database([{company_id:rs,profile:'rs-deleted',sessions:['one','two']}]);
  let clock=1_000_000; const options={...fresh(),now:()=>clock};
  assert.deepEqual(await keepConversationRows(db,options),{forgotten:2});
  clock+=299_000;
  assert.deepEqual(await keepConversationRows(db,options),{forgotten:0},'nothing is asked before its five minutes');
  clock+=1_000;
  assert.deepEqual(await keepConversationRows(db,options),{forgotten:2});
 } finally { await fake.close(); }
});

test('an Engine that does not answer, or refuses its key, forgets nothing, and is left alone a while',async()=>{
 const fake=await engineServing(rs);
 try {
  const db=database([{company_id:rs,profile,sessions:['gone']}]);
  fake.settings.sessionListStatus=503;
  assert.deepEqual(await keepConversationRows(db,fresh()),{forgotten:0});
  fake.settings.sessionListStatus=null; fake.settings.managementStatus=401;
  assert.deepEqual(await keepConversationRows(db,fresh()),{forgotten:0});
  assert.deepEqual(db.forgotten,[]);
  fake.settings.managementStatus=200;
  const health=upkeepSchedule({now:()=>0});
  health.failed(fake.address);
  const before=fake.settings.managementRequests.length;
  assert.deepEqual(await keepConversationRows(db,{memory:{drift:0},health}),{forgotten:0});
  assert.equal(fake.settings.managementRequests.length,before,'an Engine waiting out its failure is not asked');
 } finally { await fake.close(); }
});
