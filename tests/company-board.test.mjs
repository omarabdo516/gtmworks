import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineServing, withNoEngine } from './engine-records.mjs';
import { readCompanyBoard } from '../lib/company-board.mjs';

// Spec #831 (#834): the board a Member reads is the Company's Engine's own Kanban board, read through the Engine handle
// on the management listener, every Card in its column with its title, its Agent and its symbol. The reader's own
// session says which Agents they see: a Card of an Agent hidden from them is not on their board.
const company='10000000-0000-0000-0000-000000000001';
const companyProfile=`co-${company.replaceAll('-','')}`;
const [lead,ads,seo]=['3b000000-0000-0000-0000-000000000001','3b000000-0000-0000-0000-000000000011','3b000000-0000-0000-0000-000000000021'];
const profileOf=id=>`ag-${id.replaceAll('-','')}`;
const agents=[{agent:lead,name:'Lead',profile:companyProfile,main:true},{agent:ads,name:'Ads',profile:profileOf(ads),main:false}];
// The reader's own session: the Company's profiles (company_engine_target) and the Agents they see (company_app_agents),
// Seo among the Company's profiles but hidden from this reader.
// Its rows beside the Cards (kanban_cards, #836): the Member each Card is given to, with their name.
const reader=(seen=agents,rows=[])=>({rpc:async name=>{
 if(name==='company_engine_target') return {data:[{profile:companyProfile,profiles:[companyProfile,profileOf(ads),profileOf(seo)]}],error:null};
 if(name==='company_app_agents') return {data:seen,error:null};
 return {data:null,error:{message:`unexpected ${name}`}};
},from:table=>{
 const read={select:()=>read,eq:()=>read,not:()=>read,then:(done,failed)=>Promise.resolve(table==='kanban_cards'?{data:rows,error:null}:{data:null,error:{message:`unexpected ${table}`}}).then(done,failed)};
 return read;
}});

test('every Card on the Engine is in its column with its title, its Agent and its symbol', async () => {
 const fake=await engineServing(company);
 try {
  const card=fields=>fake.settings.kanban.task(fields).id;
  const idea=card({title:'Reel: a day in an accountant\'s life',status:'triage'});
  const todo=card({title:'Email to old subscribers',status:'todo'});
  const waits=card({title:'Email after the course page',status:'todo'});
  fake.settings.kanban.link(todo,waits);
  const ready=card({title:'December ad copy',status:'ready',assignee:profileOf(ads)});
  const running=card({title:'Meta campaign',status:'running',assignee:profileOf(ads)});
  const question=card({title:'Google Ads numbers',status:'blocked',assignee:companyProfile});
  const failed=card({title:'October report',status:'blocked',assignee:profileOf(ads),consecutive_failures:2});
  const review=card({title:'SEO article',status:'review',assignee:profileOf(ads)});
  const done=card({title:'Weekly report',status:'done',assignee:companyProfile});
  fake.settings.kanban.comment(done,'Omar','Sent to the team.');
  card({title:'Old webinar',status:'archived'});
  const read=await readCompanyBoard(reader(),{company});
  assert.equal(read.state,'found');
  const shown=Object.fromEntries(read.cards.map(found=>[found.id,found]));
  const columnOf=id=>shown[id]?.column;
  assert.deepEqual([idea,todo,waits,ready,running,question,failed,review,done].map(columnOf),['ideas','planned','planned','planned','progress','waiting','waiting','waiting','done']);
  assert.equal(shown[running].title,'Meta campaign');
  assert.deepEqual(shown[running].agent,{id:ads,name:'Ads'});
  assert.deepEqual(shown[question].agent,{id:lead,name:'Lead'});
  assert.equal(shown[idea].agent,null);
  assert.deepEqual(shown[running].symbol,{kind:'working'});
  assert.deepEqual(shown[question].symbol,{kind:'question'});
  assert.deepEqual(shown[failed].symbol,{kind:'failed'});
  assert.deepEqual(shown[review].symbol,{kind:'review'});
  assert.deepEqual(shown[waits].symbol,{kind:'waits',count:1});
  assert.equal(shown[ready].symbol,null);
  assert.equal(shown[done].comments,1);
  // The main Agent, whom an empty board names.
  assert.deepEqual(read.main,{id:lead,name:'Lead'});
  // An archived Card is on no column.
  assert.equal(read.cards.length,9);
  // The answer names no profile and no key: the browser never learns how the Engine is reached.
  const sent=JSON.stringify(read);
  for(const secret of [fake.settings.key,companyProfile,profileOf(ads),fake.address,fake.managementAddress]) assert.ok(!sent.includes(secret),secret);
  // The board was read on the management listener with the Engine's key, and nothing was written there.
  const asked=fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/plugins/kanban'));
  assert.deepEqual(asked.map(request=>`${request.method} ${request.path}`),['GET /api/plugins/kanban/board']);
  assert.equal(asked[0].authorization,`Bearer ${fake.settings.key}`);
 } finally { await fake.close(); }
});

test('a Card of an Agent hidden from the reader is not on their board; a Card for a profile no Agent of theirs runs shows no Agent', async () => {
 const fake=await engineServing(company);
 try {
  const hidden=fake.settings.kanban.task({title:'Seo keywords',status:'ready',assignee:profileOf(seo)}).id;
  const root=fake.settings.kanban.task({title:'Made on the Engine itself',status:'ready',assignee:'default'}).id;
  const seen=fake.settings.kanban.task({title:'Ads budget',status:'ready',assignee:profileOf(ads)}).id;
  const read=await readCompanyBoard(reader(),{company});
  assert.deepEqual(read.cards.map(card=>card.id).sort(),[root,seen].sort());
  assert.equal(read.cards.find(card=>card.id===root).agent,null);
  assert.ok(!read.cards.some(card=>card.id===hidden));
 } finally { await fake.close(); }
});

test('a Card given to a Member shows that Member, and a Card with an Agent on the Engine is the Agent\'s alone', async () => {
 const fake=await engineServing(company);
 try {
  const mona='20000000-0000-0000-0000-000000000003';
  const theirs=fake.settings.kanban.task({title:'Shoot the reel',status:'ready'}).id;
  const taken=fake.settings.kanban.task({title:'Ad copy',status:'ready',assignee:profileOf(ads)}).id;
  const nobody=fake.settings.kanban.task({title:'Someday',status:'ready'}).id;
  const read=await readCompanyBoard(reader(agents,[{task_id:theirs,assignee:mona,people:{name:'Mona'}},{task_id:taken,assignee:mona,people:{name:'Mona'}}]),{company});
  const shown=Object.fromEntries(read.cards.map(found=>[found.id,found]));
  assert.deepEqual([shown[theirs].person,shown[theirs].agent],[{id:mona,name:'Mona'},null]);
  assert.deepEqual([shown[taken].person,shown[taken].agent],[null,{id:ads,name:'Ads'}]);
  assert.deepEqual([shown[nobody].person,shown[nobody].agent],[null,null]);
 } finally { await fake.close(); }
});

test('Waiting on you lists the newest Card first, and Done the newest finished first, as the Engine orders it', async () => {
 const fake=await engineServing(company);
 try {
  const card=fields=>fake.settings.kanban.task(fields).id;
  const older=card({title:'Older question',status:'blocked',created_at:1000});
  const newer=card({title:'Newer review',status:'review',created_at:3000});
  const middle=card({title:'Middle question',status:'blocked',created_at:2000});
  const first=card({title:'Finished first',status:'done',completed_at:1000});
  const last=card({title:'Finished last',status:'done',completed_at:5000});
  const read=await readCompanyBoard(reader(),{company});
  assert.deepEqual(read.cards.filter(found=>found.column==='waiting').map(found=>found.id),[newer,middle,older]);
  assert.deepEqual(read.cards.filter(found=>found.column==='done').map(found=>found.id),[last,first]);
 } finally { await fake.close(); }
});

test('an Engine that does not answer reads unreachable, one that refuses its key refused, and a Company with no Engine noEngine', async () => {
 const fake=await engineServing(company);
 try {
  fake.settings.managementStatus=503;
  assert.deepEqual(await readCompanyBoard(reader(),{company}),{state:'unreachable'});
  fake.settings.managementStatus=401;
  assert.deepEqual(await readCompanyBoard(reader(),{company}),{state:'refused'});
  fake.settings.managementStatus=200;
  assert.deepEqual(await withNoEngine(company,()=>readCompanyBoard(reader(),{company})),{state:'noEngine'});
  await fake.close();
  assert.deepEqual(await readCompanyBoard(reader(),{company}),{state:'unreachable'});
 } finally { await fake.close().catch(()=>{}); }
});

test('a reader the database answers nothing for gets no board', async () => {
 const fake=await engineServing(company);
 try {
  fake.settings.kanban.task({title:'Anything',status:'ready'});
  const failing={rpc:async()=>({data:null,error:{message:'down'}})};
  assert.deepEqual(await readCompanyBoard(failing,{company}),{state:'noEngine'});
  assert.deepEqual(await readCompanyBoard(reader(),{company:'not a company'}),{state:'noEngine'});
 } finally { await fake.close(); }
});

// #837: a Card's Project is the Engine's tenant, a name; the board's Project filter is made from the Cards the reader
// sees, so the name of a Project only a hidden Agent's Cards hold is not in their answer.
test('each Card carries its Project name, and one only hidden Cards hold is not in the reader\'s answer', async () => {
 const fake=await engineServing(company);
 try {
  const card=fields=>fake.settings.kanban.task(fields).id;
  const launch=card({title:'Launch ads',status:'todo',tenant:'Spring launch'});
  const plain=card({title:'Weekly report',status:'todo'});
  card({title:'Seo keywords',status:'ready',assignee:profileOf(seo),tenant:'Secret project'});
  const read=await readCompanyBoard(reader(),{company});
  assert.equal(read.state,'found');
  const shown=Object.fromEntries(read.cards.map(found=>[found.id,found]));
  assert.equal(shown[launch].project,'Spring launch');
  assert.equal(shown[plain].project,null);
  assert.ok(!JSON.stringify(read).includes('Secret project'));
 } finally { await fake.close(); }
});
