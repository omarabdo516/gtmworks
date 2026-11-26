import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineServing } from './engine-records.mjs';
import { readCompanyBoard } from '../lib/company-board.mjs';
import { archiveCompanyCards, readArchivedCards, restoreCompanyCards } from '../lib/company-board-archive.mjs';

// Spec #831 (#842): a person clears the board without losing anything. Archiving is the Engine's archived status, read
// and written through the Engine handle on the wire fake, as the reader may see the board: a Card leaves the board and
// its column's count, an Agent's open Run is stopped only once the person confirmed, a Card that waited for it goes on,
// and Restore (Undo, or the archived list's) puts it back where it was without starting anything. The Engine's delete is
// never asked (tests/engine-routes.mjs holds that for the whole browser suite).
const company='10000000-0000-0000-0000-000000000001';
const companyProfile=`co-${company.replaceAll('-','')}`;
const [lead,ads,seo]=['3b000000-0000-0000-0000-000000000001','3b000000-0000-0000-0000-000000000011','3b000000-0000-0000-0000-000000000021'];
const profileOf=id=>`ag-${id.replaceAll('-','')}`;
const agents=[{agent:lead,name:'Lead',profile:companyProfile,main:true},{agent:ads,name:'Ads',profile:profileOf(ads),main:false}];
// The reader's own session, Seo among the Company's profiles but hidden from this reader.
const reader=(seen=agents)=>({rpc:async name=>{
 if(name==='company_engine_target') return {data:[{profile:companyProfile,profiles:[companyProfile,profileOf(ads),profileOf(seo)]}],error:null};
 if(name==='company_app_agents') return {data:seen,error:null};
 return {data:null,error:{message:`unexpected ${name}`}};
},from:table=>{
 const read={select:()=>read,eq:()=>read,not:()=>read,then:(done,failed)=>Promise.resolve(table==='kanban_cards'?{data:[],error:null}:{data:null,error:{message:`unexpected ${table}`}}).then(done,failed)};
 return read;
}});
const columnOf=async(id,db=reader())=>(await readCompanyBoard(db,{company})).cards.find(card=>card.id===id)?.column??null;
const kanbanAsked=fake=>fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/plugins/kanban')).map(request=>`${request.method} ${String(request.path).split('?')[0]}`);

test('an archived Card leaves the board and its column, and Restore puts it back in the same column', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const idea=kanban.task({title:'Reel: a day in an accountant\'s life',status:'triage'}).id;
  const planned=kanban.task({title:'December ad copy',status:'ready',assignee:profileOf(ads)}).id;
  const done=kanban.task({title:'Weekly report',status:'done',assignee:profileOf(ads)}).id;
  kanban.run(done,{profile:profileOf(ads),status:'done',outcome:'completed',summary:'Sent the weekly report.',ended_at:1});
  const archived=await archiveCompanyCards(reader(),{company,cards:[idea,planned,done]});
  assert.deepEqual(archived,{state:'archived',archived:[idea,planned,done],left:[]});
  const board=await readCompanyBoard(reader(),{company});
  assert.deepEqual(board.cards.map(card=>card.id),[]);
  const restored=await restoreCompanyCards(reader(),{company,cards:[idea,planned,done]});
  assert.deepEqual(restored,{state:'restored',restored:[idea,planned,done],left:[]});
  assert.deepEqual([await columnOf(idea),await columnOf(planned),await columnOf(done)],['ideas','planned','done']);
  // A done Card keeps its summary, and Restore asked the dispatcher for no tick: nothing started.
  assert.equal(kanban.tasks.find(task=>task.id===done).status,'done');
  assert.equal(fake.settings.kanban.detail(done).task.latest_summary,'Sent the weekly report.');
  assert.equal(kanban.ticks,0);
  assert.equal(kanban.tasks.find(task=>task.id===planned).status,'ready');
  assert.ok(!kanbanAsked(fake).some(route=>route.startsWith('DELETE')));
 } finally { await fake.close(); }
});

test('a Card an Agent works on asks once: nothing is archived until the person confirms, then its Run is stopped, and Undo gives the work back', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const running=kanban.task({title:'Meta campaign',status:'running',assignee:profileOf(ads)}).id;
  const run=kanban.run(running,{profile:profileOf(ads)});
  const question=kanban.task({title:'Google Ads numbers',status:'blocked',assignee:companyProfile}).id;
  const quiet=kanban.task({title:'Email to old subscribers',status:'todo'}).id;
  const asked=await archiveCompanyCards(reader(),{company,cards:[running,question,quiet]});
  assert.deepEqual(asked,{state:'stops',stops:[{about:running,kind:'run',title:'Meta campaign',agent:'Ads',agent_id:ads},
   {about:question,kind:'question',title:'Google Ads numbers',agent:'Lead',agent_id:lead}]});
  assert.deepEqual([await columnOf(running),await columnOf(question),await columnOf(quiet)],['progress','waiting','planned']);
  const archived=await archiveCompanyCards(reader(),{company,cards:[running,question,quiet],stop:true});
  assert.deepEqual(archived,{state:'archived',archived:[running,question,quiet],left:[]});
  assert.deepEqual({status:run.status,outcome:run.outcome,ended:run.ended_at!=null},{status:'reclaimed',outcome:'reclaimed',ended:true});
  // Undo: the Card that was worked on is ready again and the dispatcher is asked at once, so its Agent goes on. The
  // question's Card comes back ready, waiting on no one, and its Agent starts again with the same tick, as the Engine's
  // own tick of the whole board would start it.
  const undone=await restoreCompanyCards(reader(),{company,cards:[running,question,quiet],undo:true});
  assert.deepEqual(undone,{state:'restored',restored:[running,question,quiet],left:[]});
  assert.equal(kanban.ticks,1);
  assert.deepEqual([await columnOf(running),await columnOf(question),await columnOf(quiet)],['progress','progress','planned']);
 } finally { await fake.close(); }
});

test('a Card that waited for an archived Card no longer waits, and waits again once that Card is restored', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const page=kanban.task({title:'Course page copy',status:'ready',assignee:profileOf(ads)}).id;
  const copy=kanban.task({title:'December ad copy',status:'todo',assignee:profileOf(ads)}).id;
  kanban.link(page,copy);
  const symbolOf=async id=>(await readCompanyBoard(reader(),{company})).cards.find(card=>card.id===id)?.symbol??null;
  assert.deepEqual(await symbolOf(copy),{kind:'waits',count:1});
  await archiveCompanyCards(reader(),{company,cards:[page]});
  assert.equal(await symbolOf(copy),null);
  assert.equal(await columnOf(copy),'planned');
  await restoreCompanyCards(reader(),{company,cards:[page]});
  assert.deepEqual(await symbolOf(copy),{kind:'waits',count:1});
  assert.equal(kanban.ticks,0);
 } finally { await fake.close(); }
});

test('a Card of an Agent hidden from the reader, or one gone from the board meanwhile, is left as it is and named', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const hidden=kanban.task({title:'Seo keywords',status:'ready',assignee:profileOf(seo)}).id;
  const gone=kanban.task({title:'Old webinar',status:'archived'}).id;
  const mine=kanban.task({title:'Weekly report',status:'todo'}).id;
  assert.deepEqual(await archiveCompanyCards(reader(),{company,cards:[hidden,gone,mine]}),{state:'archived',archived:[mine],left:[hidden,gone]});
  assert.equal(kanban.tasks.find(task=>task.id===hidden).status,'ready');
  kanban.status(hidden,'archived');
  assert.deepEqual(await restoreCompanyCards(reader(),{company,cards:[hidden,mine,'t_notthere']}),{state:'restored',restored:[mine],left:[hidden,'t_notthere']});
  assert.equal(kanban.tasks.find(task=>task.id===hidden).status,'archived');
  for(const cards of [[],'t_one',[`t_${'x'.repeat(70)}`],Array.from({length:201},(_,n)=>`t_${n}`)]) assert.deepEqual(await archiveCompanyCards(reader(),{company,cards}),{state:'invalid'});
 } finally { await fake.close(); }
});

test('the archived list is fifty at a time, newest made first, searched by title as a search reads text, and none of a hidden Agent', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  kanban.task({title:'مُــهمّة إعلانات ديسمبر',status:'archived',assignee:profileOf(ads)});
  for(let n=2;n<=60;n++) kanban.task({title:`Archived plan ${String(n).padStart(2,'0')}`,status:'archived'});
  kanban.task({title:'Archived plan of Seo',status:'archived',assignee:profileOf(seo)});
  kanban.task({title:'On the board',status:'todo'});
  const first=await readArchivedCards(reader(),{company});
  assert.equal(first.state,'found');
  assert.equal(first.total,60);
  assert.equal(first.cards.length,50);
  assert.equal(first.cards[0].title,'Archived plan 60');
  assert.equal(first.cards.at(-1).title,'Archived plan 11');
  assert.equal(first.next,50);
  const rest=await readArchivedCards(reader(),{company,from:50});
  assert.equal(rest.cards.at(-1).title,'مُــهمّة إعلانات ديسمبر');
  assert.deepEqual(rest.cards.at(-1).agent,{id:ads,name:'Ads'});
  assert.equal(rest.next,null);
  assert.deepEqual((await readArchivedCards(reader(),{company,query:'مهمه'})).cards.map(card=>card.title),['مُــهمّة إعلانات ديسمبر']);
  assert.equal((await readArchivedCards(reader(),{company,query:'PLAN 0'})).cards.length,8);
  assert.deepEqual((await readArchivedCards(reader(),{company,query:'nothing like it'})).cards,[]);
  assert.ok(!JSON.stringify(first).includes(profileOf(ads)));
  assert.deepEqual(await readArchivedCards(reader(),{company,from:-1}),{state:'invalid'});
 } finally { await fake.close(); }
});
