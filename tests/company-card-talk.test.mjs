import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineServing, withNoEngine } from './engine-records.mjs';
import { readCompanyCard } from '../lib/company-card.mjs';
import { commentOnCard, continueCard, stopCard } from '../lib/company-card-talk.mjs';

// Spec #831 (#838): a person talks to the work on a Card, on the Company's fake Engine through the Engine handle. A
// comment is the Engine's own, under the writer's name, which gtmworks writes as its author because the Engine records
// no identity of its own; an answer to an Agent's question is that comment, then a move to ready and a dispatcher tick,
// so the Agent's next Run reads it; Stop ends the Card's open Run and holds the Card until a person lets it go on; and
// Continue asks the Engine to try a Card stopped after two failures again. The reader's own session says which Agents
// they see: a Card of an Agent hidden from them is missing, and nothing is written to it.
const company='10000000-0000-0000-0000-000000000001';
const companyProfile=`co-${company.replaceAll('-','')}`;
const [lead,ads,seo]=['3b000000-0000-0000-0000-000000000001','3b000000-0000-0000-0000-000000000011','3b000000-0000-0000-0000-000000000021'];
const profileOf=id=>`ag-${id.replaceAll('-','')}`;
const agents=[{agent:lead,name:'Lead',profile:companyProfile,main:true},{agent:ads,name:'Ads',profile:profileOf(ads),main:false}];
const omar='20000000-0000-0000-0000-000000000001';
// The signed-in person's own session: the Engine's target, the Agents they see, their own name and the Card's row.
const reader=({name='Omar Abdo',seen=agents}={})=>({rpc:async name=>{
 if(name==='company_engine_target') return {data:[{profile:companyProfile,profiles:[companyProfile,profileOf(ads),profileOf(seo)]}],error:null};
 if(name==='company_app_agents') return {data:seen,error:null};
 return {data:null,error:{message:`unexpected ${name}`}};
},from:table=>{
 const read={select:()=>read,eq:()=>read,maybeSingle:async()=>table==='people'?{data:name===null?null:{name},error:null}:table==='kanban_cards'?{data:null,error:null}:{data:null,error:{message:`unexpected ${table}`}}};
 return read;
}});
const writes=fake=>fake.settings.managed.filter(request=>request.method!=='GET'&&String(request.path).startsWith('/api/plugins/kanban'));

test('a comment shows under the writer\'s name for every reader, and a Card that is not stopped stays where it is', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const id=kanban.task({title:'December ad copy',status:'running',assignee:profileOf(ads)}).id;
  const ticks=kanban.ticks;
  assert.deepEqual(await commentOnCard(reader(),{company,person:omar,card:id,body:'  Keep the price in every ad.  '}),{state:'commented'});
  const read=await readCompanyCard(reader({name:'Someone else'}),{company,card:id});
  assert.deepEqual(read.card.comments.map(comment=>[comment.author,comment.body]),[[{person:'Omar Abdo'},'Keep the price in every ad.']]);
  // A comment starts nothing: the Card keeps its status and no tick was asked for.
  assert.equal(kanban.tasks.find(task=>task.id===id).status,'running');
  assert.equal(kanban.ticks,ticks);
  assert.deepEqual(writes(fake).map(request=>request.method+' '+request.path),[`POST /api/plugins/kanban/tasks/${id}/comments`]);
 } finally { await fake.close(); }
});

test('an answer to a Card stopped on a question is the comment, a move to ready and a tick: the Agent\'s next Run reads it', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const id=kanban.task({title:'Meta campaign',status:'blocked',assignee:profileOf(ads),body:'Plan the December campaign.'}).id;
  kanban.run(id,{profile:profileOf(ads),status:'blocked',outcome:'blocked',summary:'Which angle should the ads take?',ended_at:1});
  // The question is the reason its Agent stopped with, which the Card window shows above its answer box.
  const asked=await readCompanyCard(reader(),{company,card:id});
  assert.deepEqual(asked.card.symbol,{kind:'question'});
  assert.equal(asked.card.question,'Which angle should the ads take?');
  // A plain comment on it is only a comment: the Card still waits.
  assert.deepEqual(await commentOnCard(reader(),{company,person:omar,card:id,body:'Looking at it.'}),{state:'commented'});
  assert.equal(kanban.tasks.find(task=>task.id===id).status,'blocked');
  const ticks=kanban.ticks;
  assert.deepEqual(await commentOnCard(reader(),{company,person:omar,card:id,body:'The accountant who works from home.',answer:true}),{state:'answered'});
  assert.equal(kanban.ticks,ticks+1);
  const read=await readCompanyCard(reader(),{company,card:id});
  assert.deepEqual(read.card.symbol,{kind:'working'});
  assert.equal(read.card.column,'progress');
  // The Agent's next Run, on its own profile, is given the answer under the person's name.
  const next=kanban.prompts.at(-1);
  assert.equal(next.task,id);
  assert.equal(next.profile,profileOf(ads));
  assert.match(next.prompt,/comment from worker `Omar Abdo`:\nThe accountant who works from home\./);
 } finally { await fake.close(); }
});

test('an answer to a Card that asks nothing, an empty comment, and a Card of an Agent hidden from the writer write nothing', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const working=kanban.task({title:'December ad copy',status:'running',assignee:profileOf(ads)}).id;
  const failed=kanban.task({title:'Google Ads numbers',status:'blocked',assignee:profileOf(ads),consecutive_failures:2}).id;
  const hidden=kanban.task({title:'Seo keywords',status:'blocked',assignee:profileOf(seo)}).id;
  assert.deepEqual(await commentOnCard(reader(),{company,person:omar,card:working,body:'Go on.',answer:true}),{state:'notAsking'});
  assert.deepEqual(await commentOnCard(reader(),{company,person:omar,card:failed,body:'Go on.',answer:true}),{state:'notAsking'});
  assert.deepEqual(await commentOnCard(reader(),{company,person:omar,card:working,body:'   '}),{state:'invalid'});
  assert.deepEqual(await commentOnCard(reader(),{company,person:omar,card:hidden,body:'Hello.'}),{state:'missing'});
  assert.deepEqual(await commentOnCard(reader(),{company,person:omar,card:'t_00000000',body:'Hello.'}),{state:'missing'});
  assert.deepEqual(await stopCard(reader(),{company,person:omar,card:hidden}),{state:'missing'});
  assert.deepEqual(await continueCard(reader(),{company,card:hidden}),{state:'missing'});
  assert.deepEqual(writes(fake),[]);
 } finally { await fake.close(); }
 await withNoEngine(company,async()=>assert.deepEqual(await commentOnCard(reader(),{company,person:omar,card:'t_00000001',body:'Hello.'}),{state:'noEngine'}));
});

test('Stop ends the Card\'s open Run and holds the Card stopped, where no tick starts it, until Continue lets it go on', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const id=kanban.task({title:'December ad copy',status:'ready',assignee:profileOf(ads)}).id;
  kanban.dispatch();
  assert.equal(kanban.tasks.find(task=>task.id===id).status,'running');
  assert.deepEqual(await stopCard(reader(),{company,person:omar,card:id}),{state:'stopped'});
  let read=await readCompanyCard(reader(),{company,card:id});
  assert.deepEqual(read.card.symbol,{kind:'stopped'});
  assert.deepEqual(read.card.runs.map(run=>run.state),['stopped']);
  // The Engine's own next tick does not start it again.
  kanban.dispatch();
  assert.equal(kanban.tasks.find(task=>task.id===id).status,'scheduled');
  // A Card with no open Run has nothing to stop.
  assert.deepEqual(await stopCard(reader(),{company,person:omar,card:id}),{state:'idle'});
  const ticks=kanban.ticks;
  assert.deepEqual(await continueCard(reader(),{company,card:id}),{state:'continued'});
  assert.equal(kanban.ticks,ticks+1);
  read=await readCompanyCard(reader(),{company,card:id});
  assert.deepEqual(read.card.symbol,{kind:'working'});
  assert.deepEqual(read.card.runs.map(run=>run.state),['stopped','running']);
 } finally { await fake.close(); }
});

test('Continue asks the Engine to try a Card stopped after two failures again; a Card that is not stopped is left as it is', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const id=kanban.task({title:'Google Ads numbers',status:'blocked',assignee:profileOf(ads),consecutive_failures:2}).id;
  kanban.run(id,{profile:profileOf(ads),status:'crashed',outcome:'crashed',ended_at:1});
  kanban.run(id,{profile:profileOf(ads),status:'crashed',outcome:'crashed',ended_at:2});
  assert.deepEqual((await readCompanyCard(reader(),{company,card:id})).card.symbol,{kind:'failed'});
  assert.deepEqual(await continueCard(reader(),{company,card:id}),{state:'continued'});
  const task=kanban.tasks.find(found=>found.id===id);
  assert.equal(task.status,'running');
  assert.equal(task.consecutive_failures,0);
  const asking=kanban.task({title:'Meta campaign',status:'blocked',assignee:profileOf(ads)}).id;
  assert.deepEqual(await continueCard(reader(),{company,card:asking}),{state:'notStopped'});
  assert.equal(kanban.tasks.find(found=>found.id===asking).status,'blocked');
 } finally { await fake.close(); }
});
