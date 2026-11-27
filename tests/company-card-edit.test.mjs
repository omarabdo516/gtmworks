import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineServing } from './engine-records.mjs';
import { changeCompanyCard } from '../lib/company-card-edit.mjs';

// Spec #831 (#837): a person changes a Card after it is made, on the Company's Engine's own board: its title and its
// description, one to-do of it ticked, its column, the Card it waits for, and its publishing date in gtmworks's row.
// Each change writes only its own field, and a title or description changed by someone else since the person read it is
// not overwritten. A drop the Engine does not take leaves the Card where it was, with why.
const company='10000000-0000-0000-0000-000000000001';
const companyProfile=`co-${company.replaceAll('-','')}`;
const [lead,ads,seo]=['3b000000-0000-0000-0000-000000000001','3b000000-0000-0000-0000-000000000011','3b000000-0000-0000-0000-000000000021'];
const profileOf=id=>`ag-${id.replaceAll('-','')}`;
const agents=[{agent:lead,name:'Lead',profile:companyProfile,main:true},{agent:ads,name:'Ads',profile:profileOf(ads),main:false}];
const omar='20000000-0000-0000-0000-000000000001';
// The reader's session: the Agents they see, and gtmworks's row beside a Card (kanban_cards), whose writes are kept.
function reader() {
 const rows=/** @type {any[]} */([]);
 const db={rows,rpc:async name=>{
  if(name==='company_engine_target') return {data:[{profile:companyProfile,profiles:[companyProfile,profileOf(ads),profileOf(seo)]}],error:null};
  if(name==='company_app_agents') return {data:agents,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 },from:table=>{
  assert.equal(table,'kanban_cards');
  const where={}; let change=null;
  const chain={update:value=>{ change=value; return chain; },eq:(field,value)=>{ where[field]=value; return chain; },
   select:async()=>{ const found=rows.filter(row=>row.company_id===where.company_id&&row.task_id===where.task_id); for(const row of found) Object.assign(row,change); return {data:found.map(row=>({task_id:row.task_id})),error:null}; },
   insert:async value=>{ if(rows.some(row=>row.company_id===value.company_id&&row.task_id===value.task_id)) return {error:{code:'23505'}}; rows.push({...value}); return {error:null}; }};
  return chain;
 }};
 return db;
}
const change=(db,card,what)=>changeCompanyCard(db,{company,person:omar,card,change:what});

test('a new title or description changes the Card on the Engine and nothing else of it', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const id=kanban.task({title:'December ads',body:'- [ ] Draft the copy',status:'todo'}).id;
  const db=reader();
  assert.deepEqual(await change(db,id,{title:'  December ad copy ',was:'December ads'}),{state:'changed'});
  assert.equal(kanban.tasks[0].title,'December ad copy');
  assert.equal(kanban.tasks[0].body,'- [ ] Draft the copy');
  assert.deepEqual(await change(db,id,{description:'- [ ] Draft the copy\n- [ ] Send it',was:'- [ ] Draft the copy'}),{state:'changed'});
  assert.equal(kanban.tasks[0].body,'- [ ] Draft the copy\n- [ ] Send it');
  assert.equal(kanban.tasks[0].title,'December ad copy');
  // Only the field changed is sent: a rename never writes the body, a description never the title.
  const patches=fake.settings.managementRequests.filter(request=>request.method==='PATCH').map(request=>Object.keys(request.body).sort());
  assert.deepEqual(patches,[['title'],['body']]);
  // A title must have words.
  assert.deepEqual(await change(db,id,{title:'   ',was:'December ad copy'}),{state:'invalid'});
 } finally { await fake.close(); }
});

test('a second person\'s save over a title or description changed since they read it is refused, not written over', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const id=kanban.task({title:'December ads',body:'Three ads.',status:'todo'}).id;
  const [first,second]=[reader(),reader()];
  // Both read the Card; the first renames it and the second then edits the description: both changes stay.
  assert.deepEqual(await change(first,id,{title:'December ad copy',was:'December ads'}),{state:'changed'});
  assert.deepEqual(await change(second,id,{description:'Three ads for the new course.',was:'Three ads.'}),{state:'changed'});
  assert.equal(kanban.tasks[0].title,'December ad copy');
  assert.equal(kanban.tasks[0].body,'Three ads for the new course.');
  // The second then renames it from what they read before the first's rename: refused, the first's title stays.
  assert.deepEqual(await change(second,id,{title:'Ads',was:'December ads'}),{state:'stale'});
  assert.deepEqual(await change(second,id,{description:'Two ads.',was:'Three ads.'}),{state:'stale'});
  assert.equal(kanban.tasks[0].title,'December ad copy');
  assert.equal(kanban.tasks[0].body,'Three ads for the new course.');
 } finally { await fake.close(); }
});

test('ticking a to-do changes only that line, even after another person changed another line', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const id=kanban.task({title:'December ads',body:'- [ ] Draft the copy\n- [ ] Send it',status:'running',assignee:profileOf(ads)}).id;
  const db=reader();
  // The Agent ticked the first line meanwhile and added a note; the person ticks the second.
  kanban.tasks[0].body='- [x] Draft the copy\n- [ ] Send it\nNote from Ads.';
  assert.deepEqual(await change(db,id,{tick:{index:1,text:'Send it',done:true}}),{state:'changed'});
  assert.equal(kanban.tasks[0].body,'- [x] Draft the copy\n- [x] Send it\nNote from Ads.');
  // A to-do renamed since it was read is not ticked blind.
  assert.deepEqual(await change(db,id,{tick:{index:0,text:'Draft copy',done:false}}),{state:'stale'});
  assert.equal(kanban.tasks[0].body,'- [x] Draft the copy\n- [x] Send it\nNote from Ads.');
 } finally { await fake.close(); }
});

test('a drop into Ideas, Planned or Done moves the Card on the Engine; In progress and Waiting on you are the work\'s, and a Card waiting is not done', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const db=reader();
  const id=kanban.task({title:'December ads',status:'todo'}).id;
  assert.deepEqual(await change(db,id,{column:'ideas'}),{state:'changed'});
  assert.equal(kanban.tasks[0].status,'triage');
  assert.deepEqual(await change(db,id,{column:'done'}),{state:'changed'});
  assert.equal(kanban.tasks[0].status,'done');
  assert.deepEqual(await change(db,id,{column:'planned'}),{state:'changed'});
  assert.equal(kanban.tasks[0].status,'ready');
  // The Engine sets In progress itself and refuses `running`; Waiting on you is a question or a review, asked by the work.
  assert.deepEqual(await change(db,id,{column:'progress'}),{state:'refused',why:'progress'});
  assert.deepEqual(await change(db,id,{column:'waiting'}),{state:'refused',why:'waiting'});
  assert.equal(kanban.tasks[0].status,'ready');
  // The Engine's own refusal: a Card that waits for an open Card is not done, and stays where it was.
  const first=kanban.task({title:'Course page',status:'todo'}).id;
  const then=kanban.task({title:'Launch email',status:'todo'}).id;
  kanban.link(first,then);
  assert.deepEqual(await change(db,then,{column:'done'}),{state:'refused',why:'waits'});
  assert.equal(kanban.tasks.find(task=>task.id===then).status,'todo');
  // Into Planned it waits there (todo), not ready, until the first is done.
  assert.deepEqual(await change(db,then,{column:'ideas'}),{state:'changed'});
  assert.deepEqual(await change(db,then,{column:'planned'}),{state:'changed'});
  assert.equal(kanban.tasks.find(task=>task.id===then).status,'todo');
  // The Engine's delete is never asked for.
  assert.ok(!fake.settings.managementRequests.some(request=>request.method==='DELETE'&&String(request.path).startsWith('/api/plugins/kanban/tasks')));
 } finally { await fake.close(); }
});

test('a Card set to wait for another stays out of the dispatcher\'s reach until the first is done, then starts', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const db=reader();
  const first=kanban.task({title:'Course page',status:'todo'}).id;
  const then=kanban.task({title:'Launch email',status:'ready',assignee:profileOf(ads)}).id;
  assert.deepEqual(await change(db,then,{waitFor:first}),{state:'changed'});
  const status=id=>kanban.tasks.find(task=>task.id===id).status;
  assert.equal(status(then),'todo');
  kanban.dispatch();
  assert.equal(status(then),'todo','the dispatcher passes it by');
  // The first is done by a person's drop: the Engine promotes the second and gtmworks asks for a tick, so it starts.
  assert.deepEqual(await change(db,first,{column:'done'}),{state:'changed'});
  assert.equal(status(then),'running');
  // A Card cannot wait for itself, for a Card that waits for it, or for one of an Agent the reader does not see.
  const other=kanban.task({title:'Follow-up',status:'todo'}).id;
  assert.deepEqual(await change(db,other,{waitFor:other}),{state:'invalid'});
  assert.deepEqual(await change(db,other,{waitFor:then}),{state:'changed'});
  assert.deepEqual(await change(db,then,{waitFor:other}),{state:'refused',why:'link'});
  const hidden=kanban.task({title:'Seo keywords',status:'ready',assignee:profileOf(seo)}).id;
  assert.deepEqual(await change(db,other,{waitFor:hidden}),{state:'missing'});
  // It stops waiting: with nothing else open it is ready.
  assert.deepEqual(await change(db,other,{stopWaitingFor:then}),{state:'changed'});
  assert.equal(status(other),'ready');
 } finally { await fake.close(); }
});

test('a publishing date is kept in gtmworks\'s row beside the Card, made with it when the Card has none', async () => {
 const fake=await engineServing(company);
 try {
  const id=fake.settings.kanban.task({title:'December ads',status:'todo'}).id;
  const db=reader();
  assert.deepEqual(await change(db,id,{publishOn:'2026-12-03'}),{state:'changed'});
  assert.deepEqual(db.rows,[{company_id:company,task_id:id,publish_on:'2026-12-03'}]);
  assert.deepEqual(await change(db,id,{publishOn:''}),{state:'changed'});
  assert.equal(db.rows[0].publish_on,null);
  assert.deepEqual(await change(db,id,{publishOn:'2026-02-30'}),{state:'invalid'});
  // A Card of an Agent hidden from the reader is not theirs to change.
  const hidden=fake.settings.kanban.task({title:'Seo keywords',status:'ready',assignee:profileOf(seo)}).id;
  assert.deepEqual(await change(db,hidden,{publishOn:'2026-12-03'}),{state:'missing'});
  assert.deepEqual(await change(db,hidden,{title:'Mine now',was:'Seo keywords'}),{state:'missing'});
  assert.equal(fake.settings.kanban.tasks[1].title,'Seo keywords');
 } finally { await fake.close(); }
});
