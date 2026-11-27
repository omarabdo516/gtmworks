import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineServing } from './engine-records.mjs';
import { readCompanyCard } from '../lib/company-card.mjs';
import { passCard, sendBackCard } from '../lib/company-card-review.mjs';

// Spec #831 (#839): a Card that needs review is passed or sent back, by an Agent as Hermes does it or by a person, on the
// Company's fake Engine through the Engine handle (docs/engine-probes/kanban-board.md). A person's pass completes the
// Card with its Agent's summary and a line naming them; a person's return is the reason as a comment under their name,
// then a move back to ready, which restores the implementer, and a tick, so its next Run reads the reason. A reviewing
// Agent passes with kanban_complete and returns with kanban_request_changes. Either way the Card names who did it: an
// Agent by its name, a person by theirs. The route checks the Role (Owner or Manager) before any of this runs.
const company='10000000-0000-0000-0000-000000000001';
const companyProfile=`co-${company.replaceAll('-','')}`;
const [lead,ads,seo]=['3b000000-0000-0000-0000-000000000001','3b000000-0000-0000-0000-000000000011','3b000000-0000-0000-0000-000000000021'];
const profileOf=id=>`ag-${id.replaceAll('-','')}`;
const agents=[{agent:lead,name:'Lead',profile:companyProfile,main:true},{agent:ads,name:'Ads',profile:profileOf(ads),main:false}];
const omar='20000000-0000-0000-0000-000000000001';
const reader=({name='Omar Abdo'}={})=>({rpc:async rpc=>{
 if(rpc==='company_engine_target') return {data:[{profile:companyProfile,profiles:[companyProfile,profileOf(ads),profileOf(seo)]}],error:null};
 if(rpc==='company_app_agents') return {data:agents,error:null};
 return {data:null,error:{message:`unexpected ${rpc}`}};
},from:table=>{
 const read={select:()=>read,eq:()=>read,maybeSingle:async()=>table==='people'?{data:{name},error:null}:table==='kanban_cards'?{data:null,error:null}:{data:null,error:{message:`unexpected ${table}`}}};
 return read;
}});
const writes=fake=>fake.settings.managed.filter(request=>request.method!=='GET'&&String(request.path).startsWith('/api/plugins/kanban'));
const Ads={id:ads,name:'Ads'}, Lead={id:lead,name:'Lead'};

// A Card its Agent worked and handed in for review, as a worker's kanban_request_review leaves it.
function handedIn(kanban,title='SEO article: online accounting course') {
 const id=kanban.task({title,status:'ready',assignee:profileOf(ads)}).id;
 kanban.dispatch();
 kanban.requestReview(id,'Wrote the article, 1,850 words.');
 return id;
}

test('a Card its Agent handed in waits on a review, with what the Agent handed in and its name', async () => {
 const fake=await engineServing(company);
 try {
  const id=handedIn(fake.settings.kanban);
  const {card}=await readCompanyCard(reader(),{company,card:id});
  assert.equal(card.column,'waiting');
  assert.deepEqual(card.symbol,{kind:'review'});
  assert.deepEqual(card.review,{state:'requested',by:{agent:Ads},text:'Wrote the article, 1,850 words.',at:card.review.at});
 } finally { await fake.close(); }
});

test('a person\'s pass: the Card is done with its Agent\'s summary, and its Activity and Runs name the person', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const id=handedIn(kanban);
  assert.deepEqual(await passCard(reader(),{company,person:omar,card:id}),{state:'passed'});
  const task=kanban.tasks.find(found=>found.id===id);
  assert.equal(task.status,'done');
  // On the Engine: the worker's summary and the line naming the person, which the Engine has no identity to say.
  assert.equal(kanban.runs.filter(run=>run.task_id===id).at(-1).summary,'Wrote the article, 1,850 words.\n\nPassed by Omar Abdo');
  const {card}=await readCompanyCard(reader({name:'Someone else'}),{company,card:id});
  assert.equal(card.column,'done');
  assert.deepEqual(card.symbol,{kind:'passed'});
  assert.equal(card.summary,'Wrote the article, 1,850 words.');
  assert.deepEqual(card.review,{state:'passed',by:{person:'Omar Abdo'},text:null,at:card.review.at});
  const passed=card.activity.at(-1);
  assert.deepEqual([passed.kind,passed.agent,passed.by],['passed',null,'Omar Abdo']);
  assert.deepEqual(card.runs.map(run=>[run.state,run.agent,run.by??null,run.summary]),[['review',Ads,null,'Wrote the article, 1,850 words.'],['passed',null,{person:'Omar Abdo'},'Wrote the article, 1,850 words.']]);
 } finally { await fake.close(); }
});

test('a person\'s return: the reason is a comment under their name, the Agent goes on, and its next Run is given the reason', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const id=handedIn(kanban);
  // A return needs a reason, and one without writes nothing.
  const before=writes(fake).length;
  assert.deepEqual(await sendBackCard(reader(),{company,person:omar,card:id,reason:'   '}),{state:'invalid'});
  assert.equal(writes(fake).length,before);
  const ticks=kanban.ticks;
  assert.deepEqual(await sendBackCard(reader(),{company,person:omar,card:id,reason:'  Use the course\'s real price.  '}),{state:'sentBack'});
  assert.equal(kanban.ticks,ticks+1);
  const task=kanban.tasks.find(found=>found.id===id);
  assert.deepEqual([task.status,task.assignee],['running',profileOf(ads)]);
  const next=kanban.prompts.at(-1);
  assert.deepEqual([next.task,next.profile],[id,profileOf(ads)]);
  assert.match(next.prompt,/comment from worker `Omar Abdo`:\nUse the course's real price\./);
  const {card}=await readCompanyCard(reader({name:'Someone else'}),{company,card:id});
  assert.deepEqual(card.comments.map(comment=>[comment.author,comment.body]),[[{person:'Omar Abdo'},'Use the course\'s real price.']]);
  assert.deepEqual(card.review,{state:'sentBack',by:{person:'Omar Abdo'},text:'Use the course\'s real price.',at:card.review.at});
  // Working again on the reason: the Card shows it works, and still says who sent it back.
  assert.deepEqual(card.symbol,{kind:'working'});
  const back=card.activity.find(event=>event.kind==='review_reopened');
  assert.deepEqual([back.agent,back.by],[null,'Omar Abdo']);
 } finally { await fake.close(); }
});

test('a reviewing Agent the Engine started is stopped first, so the pass or the return is the person\'s', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const passed=handedIn(kanban);
  kanban.claimReview(passed,companyProfile);
  assert.deepEqual(await passCard(reader(),{company,person:omar,card:passed}),{state:'passed'});
  let {card}=await readCompanyCard(reader(),{company,card:passed});
  assert.deepEqual(card.review.by,{person:'Omar Abdo'});
  assert.deepEqual(card.runs.map(run=>[run.state,run.agent]),[['review',Ads],['stopped',Lead],['passed',null]]);
  const returned=handedIn(kanban,'Meta campaign');
  kanban.claimReview(returned,companyProfile);
  assert.deepEqual(await sendBackCard(reader(),{company,person:omar,card:returned,reason:'Shorter headline.'}),{state:'sentBack'});
  ({card}=await readCompanyCard(reader(),{company,card:returned}));
  assert.deepEqual(card.review.by,{person:'Omar Abdo'});
  assert.deepEqual(card.agent,Ads);
  assert.equal(card.runs.at(-1).agent.name,'Ads');
 } finally { await fake.close(); }
});

test('a reviewing Agent that returns or passes the work is named the same way, and a line it writes names no person', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const id=handedIn(kanban);
  kanban.claimReview(id,companyProfile);
  kanban.reviewerReturns(id,'The price in paragraph two is wrong.');
  let {card}=await readCompanyCard(reader(),{company,card:id});
  assert.equal(card.column,'planned');
  assert.deepEqual(card.symbol,{kind:'sentBack'});
  assert.deepEqual(card.review,{state:'sentBack',by:{agent:Lead},text:'The price in paragraph two is wrong.',at:card.review.at});
  assert.deepEqual(card.agent,Ads);
  const back=card.activity.at(-1);
  assert.deepEqual([back.kind,back.agent],['changes_requested',Lead]);
  assert.deepEqual(card.runs.at(-1).state,'sentBack');
  // Its Agent goes on and hands it in again; the reviewing Agent passes it, in words that look like a person's line.
  kanban.dispatch();
  kanban.requestReview(id,'Fixed the price.');
  kanban.claimReview(id,companyProfile);
  kanban.reviewerPasses(id,'Looks right.\n\nPassed by Omar Abdo');
  ({card}=await readCompanyCard(reader(),{company,card:id}));
  assert.deepEqual(card.symbol,{kind:'passed'});
  assert.deepEqual(card.review,{state:'passed',by:{agent:Lead},text:null,at:card.review.at});
  assert.equal(card.summary,'Looks right.\n\nPassed by Omar Abdo');
  const passed=card.activity.at(-1);
  assert.deepEqual([passed.kind,passed.agent,passed.by??null],['passed',Lead,null]);
  assert.deepEqual(card.runs.at(-1).state,'passed');
 } finally { await fake.close(); }
});

test('a Card that waits on no review is neither passed nor sent back, and one of an Agent hidden from the person is missing', async () => {
 const fake=await engineServing(company);
 try {
  const kanban=fake.settings.kanban;
  const working=kanban.task({title:'December ad copy',status:'running',assignee:profileOf(ads)}).id;
  const asking=kanban.task({title:'Webinar invite',status:'blocked',assignee:profileOf(ads)}).id;
  const hidden=kanban.task({title:'SEO keywords',status:'ready',assignee:profileOf(seo)}).id;
  kanban.requestReview(hidden,'Done.');
  // A Card done without a review was never passed.
  const done=kanban.task({title:'Weekly report',status:'done',assignee:profileOf(ads)}).id;
  for(const card of [working,asking,done]) {
   assert.deepEqual(await passCard(reader(),{company,person:omar,card}),{state:'notInReview'});
   assert.deepEqual(await sendBackCard(reader(),{company,person:omar,card,reason:'No.'}),{state:'notInReview'});
  }
  assert.deepEqual(await passCard(reader(),{company,person:omar,card:hidden}),{state:'missing'});
  assert.deepEqual(await sendBackCard(reader(),{company,person:omar,card:hidden,reason:'No.'}),{state:'missing'});
  assert.deepEqual(await passCard(reader(),{company,person:omar,card:'t_00000000'}),{state:'missing'});
  assert.deepEqual(writes(fake),[]);
  const {card}=await readCompanyCard(reader(),{company,card:done});
  assert.deepEqual([card.symbol,card.review],[null,null]);
 } finally { await fake.close(); }
});

test('no word of the Card window\'s catalogues, or of a board symbol\'s name, says Approval or Version, in either language', async () => {
 const { readFile } = await import('node:fs/promises');
 const words={en:/approv|version/i,ar:/موافق|وافق|نسخة|نسخه|النسخ/};
 for(const language of ['en','ar']) {
  const card=JSON.parse(await readFile(new URL(`../lib/messages/card-window.${language}.json`,import.meta.url),'utf8'));
  const shell=JSON.parse(await readFile(new URL(`../lib/messages/${language}.json`,import.meta.url),'utf8'));
  const symbols=Object.entries(shell).filter(([key])=>/^sym[A-Z]/.test(key));
  assert.ok(symbols.some(([key])=>key==='symPassed'));
  for(const [key,value] of [...Object.entries(card),...symbols]) assert.doesNotMatch(String(value),words[language],`${language} ${key}`);
 }
});
