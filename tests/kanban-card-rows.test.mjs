import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineRecord, engineServing } from './engine-records.mjs';
import { keepKanbanCards } from '../lib/kanban-card-rows.mjs';
import { upkeepSchedule } from '../lib/upkeep-schedule.mjs';

// Spec #831 (#836): gtmworks keeps a row beside a Card only while the Card is a task on its Company's Engine. A row whose
// task is gone from the Engine is forgotten by the worker's slow check for drift (ADR 0031 item 4), never on a page read:
// one pass every five minutes, an archived Card's row kept, and an Engine that does not answer left alone.
const [rs,aleem]=['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003'];
// The worker's database: each Company's rows by task id, and the rows it was told to forget.
const database=(/** @type {Record<string,string[]>} */ rows)=>{
 const forgotten=/** @type {{c:string,tasks:string[]}[]} */([]);
 return {forgotten,rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  if(name==='kanban_card_tasks') return {data:Object.entries(rows).map(([company_id,tasks])=>({company_id,tasks})),error:null};
  if(name==='forget_kanban_cards') { forgotten.push(args); rows[args.c]=rows[args.c].filter(task=>!args.tasks.includes(task)); return {data:args.tasks.length,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
};
const fresh=()=>({memory:{drift:0},health:upkeepSchedule()});

test('a row whose task is gone from the Engine is forgotten; one of a Card still there, archived or not, stays', async () => {
 const fake=await engineServing(rs);
 engineRecord(aleem,{address:'http://127.0.0.1:9'});
 try {
  const kept=fake.settings.kanban.task({title:'December ad copy',status:'ready'}).id;
  const archived=fake.settings.kanban.task({title:'Old webinar',status:'archived'}).id;
  const db=database({[rs]:[kept,archived,'t_gone0001'],[aleem]:['t_aleem001']});
  assert.deepEqual(await keepKanbanCards(db,{...fresh(),now:()=>1_000_000}),{forgotten:1});
  assert.deepEqual(db.forgotten,[{c:rs,tasks:['t_gone0001']}]);
  // The Engine was only read, and its delete never asked for.
  const asked=fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/plugins/kanban'));
  assert.deepEqual(asked.map(request=>`${request.method} ${request.path}`),['GET /api/plugins/kanban/board?include_archived=true']);
 } finally { await fake.close(); }
});

test('the check runs once every five minutes, not on every pass', async () => {
 const fake=await engineServing(rs);
 try {
  const db=database({[rs]:['t_gone0001']});
  const options=fresh(); let clock=1_000_000; const now=()=>clock;
  await keepKanbanCards(db,{...options,now});
  assert.equal(db.forgotten.length,1);
  db.forgotten.length=0;
  const rows=database({[rs]:['t_gone0002']});
  clock+=299_000;
  assert.deepEqual(await keepKanbanCards(rows,{...options,now}),{forgotten:0});
  assert.deepEqual(rows.forgotten,[],'nothing is asked before its five minutes');
  clock+=1_000;
  assert.deepEqual(await keepKanbanCards(rows,{...options,now}),{forgotten:1});
 } finally { await fake.close(); }
});

test('an Engine that does not answer, or refuses its key, forgets nothing, and is left alone a while', async () => {
 const fake=await engineServing(rs);
 try {
  const db=database({[rs]:['t_gone0001']});
  fake.settings.managementStatus=503;
  assert.deepEqual(await keepKanbanCards(db,fresh()),{forgotten:0});
  fake.settings.managementStatus=401;
  assert.deepEqual(await keepKanbanCards(db,fresh()),{forgotten:0});
  assert.deepEqual(db.forgotten,[]);
  // After a failure the Engine waits its turn in the upkeep's schedule.
  fake.settings.managementStatus=200;
  const health=upkeepSchedule({now:()=>0});
  health.failed(fake.address);
  const before=fake.settings.managementRequests.length;
  assert.deepEqual(await keepKanbanCards(db,{memory:{drift:0},health}),{forgotten:0});
  assert.equal(fake.settings.managementRequests.length,before,'an Engine waiting out its failure is not asked');
 } finally { await fake.close(); }
});
