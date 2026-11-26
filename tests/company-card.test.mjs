import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineServing, withNoEngine } from './engine-records.mjs';
import { readCompanyCard } from '../lib/company-card.mjs';

// Spec #831 (#835): a Card a Member opens is read whole from the Company's Engine (GET /tasks/{id}) through the Engine
// handle, as the reader may see it: its title, description, Agent, column and symbol, what it waits for, its summary
// when done, its comments under their authors, its events in the Engine's order and its Runs. The reader's own session
// says which Agents they see: a Card of an Agent hidden from them is missing, and no answer names a profile.
const company='10000000-0000-0000-0000-000000000001';
const companyProfile=`co-${company.replaceAll('-','')}`;
const [lead,ads,seo]=['3b000000-0000-0000-0000-000000000001','3b000000-0000-0000-0000-000000000011','3b000000-0000-0000-0000-000000000021'];
const profileOf=id=>`ag-${id.replaceAll('-','')}`;
const agents=[{agent:lead,name:'Lead',profile:companyProfile,main:true},{agent:ads,name:'Ads',profile:profileOf(ads),main:false}];
// Its row beside the Card (kanban_cards, #836): the Member it is given to, its publishing date and the person who made it.
const reader=(seen=agents,row=null)=>({rpc:async name=>{
 if(name==='company_engine_target') return {data:[{profile:companyProfile,profiles:[companyProfile,profileOf(ads),profileOf(seo)]}],error:null};
 if(name==='company_app_agents') return {data:seen,error:null};
 return {data:null,error:{message:`unexpected ${name}`}};
},from:table=>{
 const read={select:()=>read,eq:()=>read,maybeSingle:async()=>table==='kanban_cards'?{data:row,error:null}:{data:null,error:{message:`unexpected ${table}`}}};
 return read;
}});
const omar='20000000-0000-0000-0000-000000000001', mona='20000000-0000-0000-0000-000000000002';

test('a done Card is read with its description, summary, comments under their authors, events and Runs', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const id=kanban.task({title:'Weekly report',status:'done',assignee:profileOf(ads),tenant:'November',created_by:companyProfile,
   body:'## Steps\n- [x] Read the numbers\n- [ ] Send it'}).id;
  const first=kanban.run(id,{profile:profileOf(ads),status:'blocked',outcome:'blocked',summary:'Which week?',ended_at:1});
  kanban.event(id,'claimed',{lock:'host:1',run_id:first.id},first.id);
  kanban.event(id,'blocked',{reason:'Which week?'},first.id);
  kanban.comment(id,profileOf(ads),'Which week should I cover?');
  kanban.comment(id,'Omar Abdo','The last one.');
  kanban.comment(id,profileOf(seo),'I can help.');
  kanban.event(id,'unblocked',null);
  const second=kanban.run(id,{profile:profileOf(ads),status:'done',outcome:'completed',summary:'Sent the report for 29 Oct to 4 Nov.',ended_at:2});
  kanban.event(id,'spawned',{pid:42,started_at:1},second.id);
  kanban.event(id,'completed',{summary:'Sent'},second.id);
  const read=await readCompanyCard(reader(),{company,card:id});
  assert.equal(read.state,'found');
  const card=read.card;
  assert.equal(card.id,id);
  assert.equal(card.title,'Weekly report');
  assert.equal(card.column,'done');
  assert.equal(card.description,'## Steps\n- [x] Read the numbers\n- [ ] Send it');
  assert.deepEqual(card.agent,{id:ads,name:'Ads'});
  assert.equal(card.project,'November');
  assert.deepEqual(card.madeBy,{agent:{id:lead,name:'Lead'}});
  assert.equal(card.person,null);
  assert.equal(card.publishOn,null);
  assert.equal(card.summary,'Sent the report for 29 Oct to 4 Nov.');
  // Comments in the Engine's order, an Agent's under its Agent and a person's under the name gtmworks wrote; one of an
  // Agent hidden from the reader names no one.
  assert.deepEqual(card.comments.map(comment=>[comment.author,comment.body]),[
   [{agent:{id:ads,name:'Ads'}},'Which week should I cover?'],[{person:'Omar Abdo'},'The last one.'],[{agent:null},'I can help.']]);
  // The events a person reads, with the Agent of their Run or the Agent that commented; the worker's own plumbing
  // (spawned) is not one.
  assert.deepEqual(card.activity.map(event=>[event.kind,event.agent?.name??null]),[
   ['created',null],['claimed','Ads'],['blocked','Ads'],['commented','Ads'],['commented',null],['commented',null],['unblocked',null],['completed','Ads']]);
  assert.deepEqual(card.activity.filter(event=>event.kind==='commented').map(event=>event.by??null),[null,'Omar Abdo',null]);
  // Each Run with its number, its Agent, its state and its summary, the oldest first.
  assert.deepEqual(card.runs.map(run=>[run.n,run.agent?.name,run.state,run.summary]),[
   [1,'Ads','question','Which week?'],[2,'Ads','done','Sent the report for 29 Oct to 4 Nov.']]);
  // Nothing the browser is sent names a profile, the Engine or its key.
  const sent=JSON.stringify(read);
  for(const secret of [fake.settings.key,companyProfile,profileOf(ads),profileOf(seo),fake.address,fake.managementAddress,'host:1']) assert.ok(!sent.includes(secret),secret);
  // Read with the Engine's key, and nothing written.
  const asked=fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/plugins/kanban'));
  assert.ok(asked.every(request=>request.method==='GET'&&request.authorization===`Bearer ${fake.settings.key}`));
  assert.ok(asked.some(request=>request.path===`/api/plugins/kanban/tasks/${id}`));
 } finally { await fake.close(); }
});

test('a Card names the Cards it waits for and those waiting for it, a hidden one without its title', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const page=kanban.task({title:'Course page',status:'running',assignee:profileOf(ads)}).id;
  const brief=kanban.task({title:'Brief',status:'done'}).id;
  const secret=kanban.task({title:'Seo keywords',status:'ready',assignee:profileOf(seo)}).id;
  const email=kanban.task({title:'Email after the course page',status:'todo'}).id;
  const follow=kanban.task({title:'Follow-up email',status:'todo'}).id;
  kanban.link(page,email); kanban.link(brief,email); kanban.link(secret,email); kanban.link(email,follow);
  const read=await readCompanyCard(reader(),{company,card:email});
  assert.equal(read.state,'found');
  assert.deepEqual(read.card.symbol,{kind:'waits',count:3});
  const byId=new Map(read.card.waitsFor.map(other=>[other.id,other]));
  assert.deepEqual(byId.get(page),{id:page,title:'Course page',column:'progress',done:false});
  assert.deepEqual(byId.get(brief),{id:brief,title:'Brief',column:'done',done:true});
  assert.equal(read.card.waitsFor.length,3);
  assert.deepEqual(byId.get(null),{id:null,title:null,column:null,done:false});
  assert.ok(!JSON.stringify(read).includes(secret));
  assert.ok(!JSON.stringify(read).includes('Seo keywords'));
  assert.deepEqual(read.card.waitedBy,[{id:follow,title:'Follow-up email',column:'planned',done:false}]);
  assert.equal(read.card.summary,null);
 } finally { await fake.close(); }
});

test('a Card of an Agent hidden from the reader, or not on the Engine, is missing; an Engine that does not answer is unreachable', async () => {
 const fake=await engineServing(company);
 try {
  const hidden=fake.settings.kanban.task({title:'Seo keywords',status:'ready',assignee:profileOf(seo)}).id;
  assert.deepEqual(await readCompanyCard(reader(),{company,card:hidden}),{state:'missing'});
  assert.deepEqual(await readCompanyCard(reader(),{company,card:'t_00000000'}),{state:'missing'});
  assert.deepEqual(await readCompanyCard(reader(),{company,card:'../board'}),{state:'invalid'});
  fake.settings.managedFail=(method,path)=>path.startsWith('/api/plugins/kanban/tasks/')?500:null;
  assert.deepEqual(await readCompanyCard(reader(),{company,card:hidden}),{state:'unreachable'});
 } finally { await fake.close(); }
 await withNoEngine(company,async()=>assert.deepEqual(await readCompanyCard(reader(),{company,card:'t_00000001'}),{state:'noEngine'}));
});

test('a Card given to a Member names the Member, the person who made it and its publishing date, from its row', async () => {
 const fake=await engineServing(company);
 try {
  const id=fake.settings.kanban.task({title:'Shoot the course reel',status:'todo'}).id;
  const row={assignee:mona,made_by:omar,publish_on:'2026-12-03',member:{name:'Mona Adel'},maker:{name:'Omar Abdo'}};
  const read=await readCompanyCard(reader(agents,row),{company,card:id});
  assert.equal(read.state,'found');
  assert.equal(read.card.agent,null);
  assert.deepEqual(read.card.person,{id:mona,name:'Mona Adel'});
  assert.deepEqual(read.card.madeBy,{person:{id:omar,name:'Omar Abdo'}});
  assert.equal(read.card.publishOn,'2026-12-03');
  // A Card with an Agent on the Engine is the Agent's, whatever its row says.
  const given=fake.settings.kanban.task({title:'December ad copy',status:'ready',assignee:profileOf(ads)}).id;
  const agentCard=await readCompanyCard(reader(agents,row),{company,card:given});
  assert.deepEqual(agentCard.card.agent,{id:ads,name:'Ads'});
  assert.equal(agentCard.card.person,null);
 } finally { await fake.close(); }
});
