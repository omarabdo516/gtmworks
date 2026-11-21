import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { editMemoryNote, forgetMemoryNote, readMemoryNotes, resetMemory } from '../lib/hermes.mjs';
import { editAgentMemory, forgetAgentMemory, readAgentMemory, resetAgentMemory } from '../lib/agent-memory.mjs';
import { fakeHermes } from './fake-hermes.mjs';
import { heldChanges } from './held-changes.mjs';
import { logHeldAgentChanges, madeAndLogged } from '../lib/agent-change-log.mjs';

// An Agent's memory (#350) belongs to its own Hermes profile (ADR 0016, ADR 0017) and gtmworks keeps no copy: the
// contract lists that profile's notes through the learning routes, which also hold skills, so no skill is ever listed
// or touched, and a reset clears that one profile's notes and nothing else.
const company='10000000-0000-0000-0000-000000000001';
const [ads,seo]=['3a000000-0000-0000-0000-000000000011','3a000000-0000-0000-0000-000000000021'];
const hex=id=>id.replaceAll('-','');
const adsProfile=`ag-${hex(ads)}`; const seoProfile=`ag-${hex(seo)}`;
const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const at=(fake,profile)=>({...install(fake),profile});
const profileOn=(fake,name)=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
// Two Agents of one Company with their own notes, and a skill beside the notes of the first.
async function twoAgents() {
 const fake=await fakeHermes();
 profileOn(fake,adsProfile); profileOn(fake,seoProfile);
 fake.settings.memory.set(adsProfile,{memory:['Prefers short subject lines.','Never mention prices before the offer.'],profile:['Omar works in Cairo.']});
 fake.settings.memory.set(seoProfile,{memory:['Writes for people who already know the product.'],profile:[]});
 fake.settings.skills.set(adsProfile,new Map([['weekly-ads-recap','---\nname: weekly-ads-recap\ndescription: Recaps the week.\n---\nWrite the recap.\n']]));
 return fake;
}
// The signed-in person's own session: company_app_agents lists the Agents they see, and the database holds each change
// as their Role allows (`refuse`, `refuseEdit` and `refuseForget` name the refusal, tests/held-changes.mjs). Every log
// row is kept, by act; `failLogs` fails that many log calls first.
function session({agents,refuse=null,refuseEdit=null,refuseForget=null,failLogs=0}={}) {
 const refusals={memory_reset:refuse,memory_edit:refuseEdit,memory_forget:refuseForget};
 const changes=heldChanges({refuse:args=>args.act in refusals?refusals[args.act]:`unexpected ${args.act}`,failLogs});
 const rowsOf=act=>changes.logged.filter(row=>row.act===act).map(({c,agent})=>({c,agent}));
 const db={rpc:async(name,args)=>{
  if(name==='company_app_agents') return {data:agents,error:null};
  return changes.rpc(name,args)||{data:null,error:{message:`unexpected ${name}`}};
 }};
 return {db,changes,get logged() { return rowsOf('memory_reset'); },get edited() { return rowsOf('memory_edit'); },get forgotten() { return rowsOf('memory_forget'); }};
}
const rows=[
 {agent:ads,name:'Meta Ads',connection:'f0000000-0000-0000-0000-000000000011',profile:adsProfile,main:false,own:true},
 {agent:seo,name:'SEO',connection:'f0000000-0000-0000-0000-000000000021',profile:seoProfile,main:false,own:true},
];

test('the notes of one Agent\'s profile are listed with their id and text, and a skill beside them never is', async () => {
 const fake=await twoAgents();
 try {
  const read=await readMemoryNotes(at(fake,adsProfile));
  assert.equal(read.state,'found');
  assert.deepEqual(read.notes.map(note=>note.text),[
   'Prefers short subject lines.','Never mention prices before the offer.','Omar works in Cairo.',
  ]);
  for(const note of read.notes) {
   assert.match(note.id,/^memory:(memory|profile):\d{1,9}:[0-9a-f]{12}$/,note.id);
   assert.ok(!note.id.includes('weekly-ads-recap'));
  }
  // The skill sits in the same graph; the contract never asks for it, so it can never be returned.
  assert.ok(!fake.settings.managementRequests.some(request=>String(request.path).includes('weekly-ads-recap')));
  assert.ok(fake.settings.managementRequests.some(request=>String(request.path).startsWith('/api/learning/graph')));
  // Another Agent's profile is read on its own, never mixed in.
  const other=await readMemoryNotes(at(fake,seoProfile));
  assert.deepEqual(other.notes.map(note=>note.text),['Writes for people who already know the product.']);
 } finally { await fake.close(); }
});

test('a reset clears one Agent\'s memory only: the other Agent\'s notes and the skill stay', async () => {
 const fake=await twoAgents();
 try {
  const before=await readMemoryNotes(at(fake,adsProfile));
  assert.equal((await resetMemory(at(fake,adsProfile))).state,'reset');
  assert.deepEqual((await readMemoryNotes(at(fake,adsProfile))).notes,[]);
  assert.equal((await readMemoryNotes(at(fake,seoProfile))).notes.length,1,'the other Agent keeps its notes');
  assert.ok(fake.settings.skills.get(adsProfile)?.has('weekly-ads-recap'),'the skill is not touched');
  assert.ok(before.notes.length>0);
  const reset=fake.settings.managementRequests.filter(request=>request.method==='POST'&&String(request.path).startsWith('/api/memory/reset'));
  assert.equal(reset.length,1);
  assert.match(String(reset[0].path),new RegExp(`profile=${adsProfile}`));
  assert.deepEqual(reset[0].body,{target:'all'},'the Engine is always sent the profile it clears');
 } finally { await fake.close(); }
});

test('a profile the Engine no longer serves is missing, a refused key is refused, and no memory of a stranger is read', async () => {
 const fake=await twoAgents();
 try {
  fake.settings.unknownProfiles.push(adsProfile); fake.settings.profiles.delete(adsProfile);
  assert.equal((await readMemoryNotes(at(fake,adsProfile))).state,'unreachable');
  // A profile that is not an Agent's or a Company's own is never read at all.
  for(const profile of ['default','writer','ag-not-a-name']) assert.deepEqual(await readMemoryNotes(at(fake,profile)),{state:'failed',notes:null});
 } finally { await fake.close(); }
});

test('a Member reads the notes of the Agent they see, with whether it is the main one', async () => {
 const fake=await twoAgents();
 try {
  const {db}=session({agents:rows});
  const read=await readAgentMemory(db,{company,agent:ads,hermes:install(fake)});
  assert.equal(read.state,'found');
  assert.equal(read.main,false);
  assert.deepEqual(read.notes.map(note=>note.text),[
   'Prefers short subject lines.','Never mention prices before the offer.','Omar works in Cairo.',
  ]);
  const main=await readAgentMemory(session({agents:rows.map(row=>row.agent===ads?{...row,main:true}:row)}).db,{company,agent:ads,hermes:install(fake)});
  assert.equal(main.main,true,'the main Agent is named as the main one (#121)');
 } finally { await fake.close(); }
});

test('an Agent hidden from the reader is not found, and their memory is never asked of the Engine', async () => {
 const fake=await twoAgents();
 try {
  const {db}=session({agents:[rows[1]]});
  fake.settings.managementRequests.length=0;
  assert.deepEqual(await readAgentMemory(db,{company,agent:ads,hermes:install(fake)}),{state:'missing',main:false,notes:null});
  assert.deepEqual(await resetAgentMemory(db,{company,agent:ads,hermes:install(fake)}),{state:'missing'});
  assert.equal(fake.settings.managementRequests.length,0,'nothing reaches the Engine for an Agent the reader does not see');
 } finally { await fake.close(); }
});

test('only the Owner resets: a refused Role changes nothing and logs nothing, and a reset logs one row with no note text', async () => {
 const fake=await twoAgents();
 try {
  const refused=session({agents:rows,refuse:'memoryNotAllowed'});
  assert.deepEqual(await resetAgentMemory(refused.db,{company,agent:ads,hermes:install(fake)}),{state:'notAllowed'});
  assert.equal(fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/memory/reset')).length,0);
  assert.deepEqual(refused.logged,[]);
  const owner=session({agents:rows});
  assert.deepEqual(await resetAgentMemory(owner.db,{company,agent:ads,hermes:install(fake)}),{state:'reset'});
  assert.deepEqual(owner.logged,[{c:company,agent:ads}],'one row, naming the Agent and nothing of its notes');
  assert.deepEqual((await readMemoryNotes(at(fake,adsProfile))).notes,[]);
 } finally { await fake.close(); }
});

// #191: one note is rewritten or forgotten by the id the Engine gave it. A note that changed since the graph was read
// no longer carries that id's fingerprint, and the Engine refuses it; the contract never guesses which note was meant.
test('one note is rewritten by the Engine\'s id, and the rest of the memory is as it was', async () => {
 const fake=await twoAgents();
 try {
  const before=await readMemoryNotes(at(fake,adsProfile));
  const target=before.notes[0];
  assert.equal((await editMemoryNote(at(fake,adsProfile),{note:target.id,text:'Prefers very short subject lines.'})).state,'edited');
  const after=await readMemoryNotes(at(fake,adsProfile));
  assert.deepEqual(after.notes.map(note=>note.text),[
   'Prefers very short subject lines.','Never mention prices before the offer.','Omar works in Cairo.',
  ]);
  const puts=fake.settings.managementRequests.filter(request=>request.method==='PUT'&&String(request.path).startsWith('/api/learning/node'));
  assert.equal(puts.length,1);
  assert.match(String(puts[0].path),new RegExp(`profile=${adsProfile}`));
  assert.deepEqual(puts[0].body,{id:target.id,content:'Prefers very short subject lines.'});
 } finally { await fake.close(); }
});

test('one note is forgotten by its id, taking no other note and no skill with it', async () => {
 const fake=await twoAgents();
 try {
  const before=await readMemoryNotes(at(fake,adsProfile));
  assert.equal((await forgetMemoryNote(at(fake,adsProfile),{note:before.notes[1].id})).state,'forgotten');
  assert.deepEqual((await readMemoryNotes(at(fake,adsProfile))).notes.map(note=>note.text),[
   'Prefers short subject lines.','Omar works in Cairo.',
  ]);
  assert.ok(fake.settings.skills.get(adsProfile)?.has('weekly-ads-recap'),'the skill is not touched');
  assert.equal((await readMemoryNotes(at(fake,seoProfile))).notes.length,1,'the other Agent keeps its notes');
  const deletes=fake.settings.managementRequests.filter(request=>request.method==='DELETE'&&String(request.path).startsWith('/api/learning/node'));
  assert.equal(deletes.length,1);
  assert.deepEqual(deletes[0].body,{id:before.notes[1].id});
 } finally { await fake.close(); }
});

test('a note that changed since it was read is stale, and nothing in the Engine is rewritten or removed', async () => {
 const fake=await twoAgents();
 try {
  const before=await readMemoryNotes(at(fake,adsProfile));
  const stale=before.notes[0].id;
  // The Agent remembered something else in that entry between the graph and the change.
  fake.settings.memory.set(adsProfile,{memory:['Prefers short subject lines, and no emoji.','Never mention prices before the offer.'],profile:['Omar works in Cairo.']});
  assert.deepEqual(await editMemoryNote(at(fake,adsProfile),{note:stale,text:'Prefers short subject lines.'}),{state:'stale'});
  assert.deepEqual(await forgetMemoryNote(at(fake,adsProfile),{note:stale}),{state:'stale'});
  assert.deepEqual((await readMemoryNotes(at(fake,adsProfile))).notes.map(note=>note.text),[
   'Prefers short subject lines, and no emoji.','Never mention prices before the offer.','Omar works in Cairo.',
  ]);
 } finally { await fake.close(); }
});

test('an id that is not a memory note\'s is refused before the Engine is asked anything', async () => {
 const fake=await twoAgents();
 try {
  fake.settings.managementRequests.length=0;
  for(const note of ['weekly-ads-recap','memory:other:0:4d2c1b0a9f8e','mem-1','']) {
   assert.deepEqual(await editMemoryNote(at(fake,adsProfile),{note,text:'New text.'}),{state:'failed',unsent:true});
   assert.deepEqual(await forgetMemoryNote(at(fake,adsProfile),{note}),{state:'failed',unsent:true});
  }
  assert.equal(fake.settings.managementRequests.length,0,'not one request reaches the Engine, so no skill can be touched');
 } finally { await fake.close(); }
});

test('an empty note or one too long for the memory is refused, and nothing is written', async () => {
 const fake=await twoAgents();
 try {
  const before=await readMemoryNotes(at(fake,adsProfile));
  assert.deepEqual(await editMemoryNote(at(fake,adsProfile),{note:before.notes[0].id,text:'   '}),{state:'refused'});
  assert.deepEqual(await editMemoryNote(at(fake,adsProfile),{note:before.notes[1].id,text:'x'.repeat(4000)}),{state:'refused'});
  assert.deepEqual((await readMemoryNotes(at(fake,adsProfile))).notes.map(note=>note.text),[
   'Prefers short subject lines.','Never mention prices before the offer.','Omar works in Cairo.',
  ]);
 } finally { await fake.close(); }
});

test('the Owner and a Manager edit a note of an Agent they see, and each change is one log row with no note text', async () => {
 const fake=await twoAgents();
 try {
  const notes=(await readMemoryNotes(at(fake,adsProfile))).notes;
  const refused=session({agents:rows,refuseEdit:'memoryNotAllowed'});
  assert.deepEqual(await editAgentMemory(refused.db,{company,agent:ads,note:notes[0].id,text:'A new line.',hermes:install(fake)}),{state:'notAllowed'});
  assert.deepEqual(refused.edited,[]);
  assert.equal(fake.settings.managementRequests.filter(request=>request.method==='PUT').length,0,'a refused Role changes nothing in the Engine');
  const manager=session({agents:rows});
  assert.deepEqual(await editAgentMemory(manager.db,{company,agent:ads,note:notes[0].id,text:'A new line.',hermes:install(fake)}),{state:'edited'});
  assert.deepEqual(manager.edited,[{c:company,agent:ads}],'one row, naming the Agent and nothing of the note');
  assert.deepEqual((await readMemoryNotes(at(fake,adsProfile))).notes.map(note=>note.text),[
   'A new line.','Never mention prices before the offer.','Omar works in Cairo.',
  ]);
 } finally { await fake.close(); }
});

test('only the Owner forgets a note, and a forget is one log row with no note text', async () => {
 const fake=await twoAgents();
 try {
  const notes=(await readMemoryNotes(at(fake,adsProfile))).notes;
  const refused=session({agents:rows,refuseForget:'memoryNotAllowed'});
  assert.deepEqual(await forgetAgentMemory(refused.db,{company,agent:ads,note:notes[0].id,hermes:install(fake)}),{state:'notAllowed'});
  assert.deepEqual(refused.forgotten,[]);
  const owner=session({agents:rows});
  assert.deepEqual(await forgetAgentMemory(owner.db,{company,agent:ads,note:notes[0].id,hermes:install(fake)}),{state:'forgotten'});
  assert.deepEqual(owner.forgotten,[{c:company,agent:ads}]);
  assert.deepEqual((await readMemoryNotes(at(fake,adsProfile))).notes.map(note=>note.text),[
   'Never mention prices before the offer.','Omar works in Cairo.',
  ]);
 } finally { await fake.close(); }
});

test('a note a refused Engine call left alone is not logged, and a hidden Agent is never asked of the Engine', async () => {
 const fake=await twoAgents();
 try {
  const notes=(await readMemoryNotes(at(fake,adsProfile))).notes;
  const {db}=session({agents:[rows[1]]});
  fake.settings.managementRequests.length=0;
  assert.deepEqual(await editAgentMemory(db,{company,agent:ads,note:notes[0].id,text:'New.',hermes:install(fake)}),{state:'missing'});
  assert.deepEqual(await forgetAgentMemory(db,{company,agent:ads,note:notes[0].id,hermes:install(fake)}),{state:'missing'});
  assert.equal(fake.settings.managementRequests.length,0);

  const owner=session({agents:rows});
  fake.settings.memory.set(adsProfile,{memory:['Changed under the reader.'],profile:[]});
  assert.deepEqual(await editAgentMemory(owner.db,{company,agent:ads,note:notes[0].id,text:'New.',hermes:install(fake)}),{state:'stale'});
  assert.deepEqual(owner.edited,[],'a stale note is not logged as edited');
  assert.equal(owner.changes.held.size,0,'and its held record is dropped, so no later pass logs it');
  assert.deepEqual((await readMemoryNotes(at(fake,adsProfile))).notes.map(note=>note.text),['Changed under the reader.']);
 } finally { await fake.close(); }
});

// #370: a change the Engine holds always gets its one log row. A log the database does not take is retried, and one it
// still does not take is left held for the worker's pass; the person is told the change was made either way, the pass
// and a late retry never make a second row, and no call carries a note's text.
test('a reset, an edit and a forget whose log fails are still made, and each ends with exactly one log row', async () => {
 const fake=await twoAgents();
 try {
  const notes=(await readMemoryNotes(at(fake,adsProfile))).notes;
  const retried=session({agents:rows,failLogs:1});
  assert.deepEqual(await resetAgentMemory(retried.db,{company,agent:seo,hermes:install(fake)}),{state:'reset'},'a log taken on its retry');
  assert.deepEqual(retried.logged,[{c:company,agent:seo}]);
  assert.deepEqual((await readMemoryNotes(at(fake,seoProfile))).notes,[]);

  const late=session({agents:rows,failLogs:3});
  assert.deepEqual(await editAgentMemory(late.db,{company,agent:ads,note:notes[0].id,text:'Only short subject lines.',hermes:install(fake)}),
   {state:'edited',logPending:true},'the Engine holds the edit, so it is never told as failed');
  assert.deepEqual(late.edited,[],'its log is not written yet');
  assert.equal(late.changes.held.size,1,'it is held for the pass');
  late.changes.fail(3);
  const second=(await readMemoryNotes(at(fake,adsProfile))).notes[1];
  assert.deepEqual(await forgetAgentMemory(late.db,{company,agent:ads,note:second.id,hermes:install(fake)}),{state:'forgotten',logPending:true});
  assert.deepEqual((await readMemoryNotes(at(fake,adsProfile))).notes.map(note=>note.text),['Only short subject lines.','Omar works in Cairo.']);
  // The worker's pass logs both, once; a log retried after it finds nothing left to write.
  assert.deepEqual(await logHeldAgentChanges(late.db),{logged:2});
  for(const {args} of late.changes.calls.filter(call=>call.name==='finish_agent_change').slice(-1)) await late.db.rpc('finish_agent_change',args);
  assert.deepEqual(late.edited,[{c:company,agent:ads}]);
  assert.deepEqual(late.forgotten,[{c:company,agent:ads}]);
  assert.deepEqual(await logHeldAgentChanges(late.db),{logged:0});
  assert.equal(late.changes.logged.length,2,'never two rows for one change');
  const sent=JSON.stringify(late.changes.calls);
  for(const text of ['Only short subject lines.','Never mention prices before the offer.','Prefers short subject lines.']) assert.equal(sent.includes(text),false,'no log call carries a note');
 } finally { await fake.close(); }
});

test('an answer that does not say what the Engine did keeps the change held, and the pass logs it as unconfirmed', async () => {
 const changes=heldChanges();
 const db={rpc:async(name,args)=>changes.rpc(name,args)};
 const hold=async()=>(await db.rpc('hold_agent_change',{c:company,agent:ads,act:'memory_edit'})).data;
 // Sent, and no answer came back: the Engine may hold the edit.
 assert.deepEqual(await madeAndLogged(db,await hold(),'edited',async()=>({state:'unreachable'})),{state:'unreachable'});
 assert.deepEqual(await madeAndLogged(db,await hold(),'edited',async()=>({state:'failed'})),{state:'failed'});
 await assert.rejects(madeAndLogged(db,await hold(),'edited',async()=>{ throw new Error('the answer could not be read'); }));
 assert.equal(changes.held.size,3,'each stays held');
 // Never sent: the Engine was asked nothing, so nothing is held and nothing is logged.
 assert.deepEqual(await madeAndLogged(db,await hold(),'edited',async()=>({state:'unreachable',unsent:true})),{state:'unreachable'});
 assert.deepEqual(await madeAndLogged(db,await hold(),'edited',async()=>({state:'stale'})),{state:'stale'});
 assert.equal(changes.held.size,3);
 // A write the Engine acknowledged whose read-back failed: the Engine holds it, so its row is confirmed now.
 assert.deepEqual(await madeAndLogged(db,await hold(),'written',async()=>({state:'failed',acknowledged:true})),{state:'failed'});
 assert.deepEqual(changes.logged.map(row=>row.unconfirmed),[undefined]);
 assert.deepEqual(await logHeldAgentChanges(db),{logged:3});
 assert.deepEqual(changes.logged.map(row=>row.unconfirmed),[undefined,true,true,true],'the pass never says one was made');
});

test('a change the Engine refused is dropped even when the database takes the drop only after the answer, so no pass logs it', async () => {
 const changes=heldChanges({failDrops:4});
 const db={rpc:async(name,args)=>changes.rpc(name,args)};
 const {data:held}=await db.rpc('hold_agent_change',{c:company,agent:ads,act:'memory_reset'});
 assert.deepEqual(await madeAndLogged(db,held,'reset',async()=>({state:'refused'}),{waits:[1,1],laterWaits:[5,5]}),{state:'refused'},'the answer does not wait on the drop');
 assert.equal(changes.held.size,1,'three drops the database did not take');
 // The background retries run on timers, which a loaded machine may fire late: wait until the drop lands, never a guess.
 for(const deadline=Date.now()+2000;changes.held.size>0&&Date.now()<deadline;) await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(changes.held.size,0,'the drop is taken in the background');
 assert.deepEqual(await logHeldAgentChanges(db),{logged:0});
 assert.deepEqual(changes.logged,[]);
});

// #191/#350: the route's own answers, with its permission check and its store replaced and no server or database (as
// agent-files.test.mjs runs its routes).
const require=createRequire(import.meta.url);
const origin=await import('../lib/app-origin.mjs');
function loadRoute(store) {
 const exports={};
 const {outputText}=ts.transpileModule(readFileSync('app/api/agent-memory/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ESNext,esModuleInterop:true}});
 const imports={
  '@/lib/supabase':{supabase:async()=>({auth:{getUser:async()=>({data:{user:{id:'9a000000-0000-0000-0000-000000000001'}}})}})},
  '@/lib/app-origin.mjs':origin,
  '@/lib/route-permissions.mjs':{routeAllowed:async()=>true},
  '@/lib/agent-memory.mjs':store,
 };
 runInNewContext(outputText,{exports,require:name=>imports[name]??require(name),URL,URLSearchParams,Error,Response,Request,Headers,process});
 return exports;
}
const put=(route,body)=>route.PUT(new (require('next/server').NextRequest)('http://app.test/api/agent-memory',{method:'PUT',headers:{'content-type':'application/json'},body}));

test('a note too long for the memory is refused rather than invalid, so the screen shows its own line', async () => {
 const calls=[];
 const route=loadRoute({editAgentMemory:async(...args)=>{ calls.push(args); return {state:'edited'}; }});
 const long=await put(route,JSON.stringify({company,agent:ads,note:'memory:memory:0:4d2c1b0a9f8e',text:'x'.repeat(12001)}));
 assert.equal(long.status,400);
 assert.deepEqual(await long.json(),{error:'agentMemoryRefused'},'the screen reads it as a note too long');
 assert.deepEqual(calls,[],'nothing is sent to the Engine');
 const short=await put(route,JSON.stringify({company,agent:ads,note:'memory:memory:0:4d2c1b0a9f8e',text:'x'.repeat(12000)}));
 assert.equal(short.status,200);
 assert.equal(calls.length,1);
});

test('a body that is not JSON is invalid, and a failure after it is a server error', async () => {
 const {NextRequest}=require('next/server');
 const route=loadRoute({editAgentMemory:async()=>{ throw new Error('the database is down'); },
  readAgentMemory:async()=>{ throw new Error('the database is down'); }});
 const notJson=await put(route,'{');
 assert.equal(notJson.status,400);
 assert.deepEqual(await notJson.json(),{error:'agentMemoryInvalid'},'a parse error stays invalid');
 const failed=await put(route,JSON.stringify({company,agent:ads,note:'memory:memory:0:4d2c1b0a9f8e',text:'New.'}));
 assert.equal(failed.status,500);
 assert.deepEqual(await failed.json(),{error:'agentMemoryFailed'});
 const read=await route.GET(new NextRequest(`http://app.test/api/agent-memory?company=${company}&agent=${ads}`));
 assert.equal(read.status,500);
 assert.deepEqual(await read.json(),{error:'agentMemoryFailed'});
});
