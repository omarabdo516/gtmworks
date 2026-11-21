import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveHandovers } from '../lib/handovers.mjs';
import { fakeEngine } from './fake-engine.mjs';

// #477 on the fake engine: an asked Agent hands the job on, and gtmworks moves every Run of the chain itself. The
// database is a small stand-in for the handover functions as 20270415980000 defines them (supabase/tests/handover_chains.sql
// proves the real ones): a call in an asked Agent's Run is kept under the handover it serves, that leg waits until every
// child ended, then the asked Agent answers in its own handover session, and only the top handover's follow-up replies in
// the chat. Each Agent runs on a profile of its own, routed by profile as the install's Hermes is.
const hermes={address:'http://hermes:8642',key:'test-only-key'};
const company='10000000-0000-0000-0000-000000000001';
const team=/** @type {Record<string,{profile:string,job:string}>} */({
 Writer:{profile:'ag-04770000000000000000000000000013',job:'Posts and articles'},
 Ads:{profile:'ag-04770000000000000000000000000012',job:'Meta ads and their numbers'},
 Critic:{profile:'ag-04770000000000000000000000000014',job:'Reviews claims'},
 Lead:{profile:'co-10000000000000000000000000000001',job:'Runs the team'},
});
const others=(/** @type {string} */ agent)=>Object.entries(team).filter(([name])=>name!==agent).map(([name,{job}])=>({name,job})).sort((a,b)=>a.name.localeCompare(b.name));

/** The handovers of one chat or channel, as the database keeps them, starting with the one its own Agent made.
 * @param {'conversation'|'channel'} place @param {{from:string,to:string,goal:string}} top */
function record(place,top) {
 const where=place==='conversation'?'c4770000-0000-0000-0000-000000000001':'d4770000-0000-0000-0000-000000000001';
 /** @type {any[]} */
 const rows=[{id:1,parent:null,from:top.from,to:top.to,goal:top.goal,state:'waiting',run_id:'run-chat',call_id:'call-1',target_attempts:0,answer_attempts:0,return_attempts:0,
  target_run:null,answer_run:null,follow_up_run:null,target_outcome:null,summary:null,tools:null}];
 const replies=/** @type {{agent:string,body:string}[]} */([]);
 const pins=/** @type {number[]} */([]);
 const session=(/** @type {string} */ agent)=>`${where}:${agent}`;
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const open=(/** @type {any} */ row)=>row.state!=='done'&&row.state!=='failed';
 const unfinished=(/** @type {any} */ row)=>`${row.to} did not finish`;
 const service={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  const row=rows.find(entry=>entry.id===args.h);
  if(name==='handovers_due') return ok(rows.filter(entry=>open(entry)&&entry.id>args.after&&!(entry.state==='handing'&&rows.some(child=>child.parent===entry.id&&open(child)))).map(entry=>({id:entry.id,state:entry.state,conversation:place==='conversation'?where:null,company,
   run:{target:entry.target_run,answering:entry.answer_run,follow_up:entry.follow_up_run}[/** @type {string} */ (entry.state)]??null,
   profile:entry.state==='target'||entry.state==='answering'?team[entry.to].profile:entry.state==='follow_up'?team[entry.from].profile:null,
   attempt:entry.state==='handing'||entry.state==='answering'?entry.answer_attempts:entry.state==='returning'?entry.return_attempts:entry.target_attempts})));
  if(name==='begin_handover') {
   if(row.state==='returning'&&row.parent) { row.state='done'; return ok([]); }
   if(row.state==='waiting') { row.target_attempts+=1;
    return ok([{state:'waiting',attempt:row.target_attempts,company,profile:team[row.to].profile,session:session(row.to),input:`${row.from} asks you: ${row.goal}`,instructions:null,targets:others(row.to)}]); }
   if(row.state==='handing') {
    if(rows.some(child=>child.parent===row.id&&open(child))) return ok([]);
    row.answer_attempts+=1;
    const came=rows.filter(child=>child.parent===row.id).map(child=>child.target_outcome==='completed'?`${child.to} answered: ${child.summary}`:unfinished(child));
    return ok([{state:'handing',attempt:row.answer_attempts,company,profile:team[row.to].profile,session:session(row.to),input:`Answers for ${row.goal}:\n${came.join('\n')}`,instructions:null,targets:null}]);
   }
   if(row.state==='returning') { row.return_attempts+=1;
    return ok([{state:'returning',attempt:row.return_attempts,company,profile:team[row.from].profile,session:place==='conversation'?where:session(row.from),
     input:row.target_outcome==='completed'?`${row.to} reported: ${row.summary}`:unfinished(row),instructions:null,targets:null}]); }
   return ok([]);
  }
  if(name==='pin_handover_tools') { pins.push(row.id); row.tools??=args.spec??''; return ok(row.tools); }
  if(name==='answer_handover') {
   if(args.run===null||args.leg!==row.state) return ok(false);
   if(row.state==='waiting') Object.assign(row,{target_run:args.run,state:'target'});
   else if(row.state==='handing') Object.assign(row,{answer_run:args.run,state:'answering'});
   else Object.assign(row,{follow_up_run:args.run,state:'follow_up'});
   return ok(true);
  }
  if(name==='handover_hand_to_agent') {
   if(row.state!=='target'||row.target_run!==args.run||!row.tools) return ok({state:'refused'});
   const target=Object.keys(team).find(agent=>agent.toLowerCase()===args.agent_name.trim().toLowerCase()&&agent!==row.to);
   if(!target) return ok({state:'ignored'});
   if(!rows.some(child=>child.run_id===args.run&&child.call_id===args.call))
    rows.push({...rows[0],id:rows.length+1,parent:row.id,from:row.to,to:target,goal:args.goal,state:'waiting',run_id:args.run,call_id:args.call,
     target_attempts:0,answer_attempts:0,return_attempts:0,target_run:null,answer_run:null,follow_up_run:null,target_outcome:null,summary:null,tools:null});
   return ok({state:'created',agent:target});
  }
  if(name==='close_handover_target') {
   if(row.state!=='target'||row.target_run!==args.run) return ok(false);
   if(args.run_outcome==='completed'&&rows.some(child=>child.parent===row.id&&child.run_id===args.run)) { row.state='handing'; return ok(true); }
   Object.assign(row,{state:'returning',target_outcome:args.run_outcome,summary:args.words}); return ok(true);
  }
  if(name==='close_handover_answer') {
   if(row.state!=='answering'||row.answer_run!==args.run) return ok(false);
   Object.assign(row,{state:'returning',target_outcome:args.run_outcome,summary:args.answer}); return ok(true);
  }
  if(name==='close_handover_follow_up') {
   if(row.state!=='follow_up'||row.follow_up_run!==args.run) return ok(false);
   if(args.reply) replies.push({agent:row.from,body:args.reply});
   row.state='done'; return ok(true);
  }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 return {rows,replies,pins,service,session,where};
}

/** One fake Engine per Agent, routed by profile, with every start logged in order. `ends` names the runs (by key) the
 * Engine ends otherwise than completed: failed, stopped or lost. @param {Record<string,'failed'|'stopped'|'lost'>} [ends] */
function engines(ends={}) {
 const fakes=Object.fromEntries(Object.keys(team).map(agent=>[agent,fakeEngine()]));
 const started=/** @type {{agent:string,key:string,session:string,input:string,tools:any[]}[]} */([]);
 const engineFor=(/** @type {any} */ connection)=>{
  const agent=/** @type {string} */ (Object.keys(team).find(name=>team[name].profile===connection.profile));
  const fake=fakes[agent]; const engine=fake.engineFor(connection);
  return {...engine,
   start:async(/** @type {any} */ args)=>{ const run=await engine.start(args); if(!started.some(entry=>entry.key===args.idempotencyKey)) started.push({agent,key:args.idempotencyKey,session:args.conversation,input:typeof args.input==='string'?args.input:'',tools:args.tools??[]}); return run; },
   read:async(/** @type {string} */ id)=>{ const result=await engine.read(id); const run=fake.runs.find(entry=>entry.id===id);
    return run&&ends[run.key]&&result.state==='completed'?{...result,state:ends[run.key],reply:null,toolCalls:[]}:result; }};
 };
 return {fakes,started,engineFor};
}
const handOn=(/** @type {string} */ agent,/** @type {string} */ goal)=>[{id:`call-${agent}`,name:'hand_to_agent',arguments:{agent,goal}}];
/** The worker's passes, one after another, until every handover of the chain ended, or the bound is reached. */
const drive=async(/** @type {any} */ service,/** @type {any} */ engineFor,/** @type {any[]} */ rows,most=40)=>{
 for(let pass=0;pass<most&&rows.some(row=>row.state!=='done'&&row.state!=='failed');pass++) await driveHandovers(service,{hermes,engineFor});
};

for(const place of /** @type {const} */(['conversation','channel'])) {
 test(`a chain of three Agents in a ${place}: each Run on its own profile and session, the answer climbs back a step at a time, and the Agent the person talks to replies last`,async()=>{
  const {rows,replies,service,session,where}=record(place,{from:'Writer',to:'Ads',goal:'Last campaign\'s numbers'});
  const {fakes,started,engineFor}=engines();
  fakes.Ads.settings.toolCalls=input=>input.startsWith('Writer asks you')?handOn('Critic','Check the figures'):[];
  fakes.Ads.settings.reply=input=>input.startsWith('Answers')?'February: 120 leads, checked by Critic.':'I asked Critic to check the figures.';
  fakes.Critic.settings.reply=()=>'The figures check out: 120 leads.';
  fakes.Writer.settings.reply=input=>`Writer's reply with ${input}`;
  // Nobody reads an asked Agent's chat: its question is answered empty and its request to act is denied.
  fakes.Critic.settings.questions=()=>[{text:'Which month?',choices:['January','February']}];
  fakes.Critic.settings.permissions=()=>[{description:'Read the report',command:'cat report.csv'}];
  await drive(service,engineFor,rows);

  assert.deepEqual(rows.map(row=>`${row.from}>${row.to}:${row.state}`),['Writer>Ads:done','Ads>Critic:done'],'Ads\'s call to Critic is kept under the Writer\'s handover');
  assert.equal(rows[1].parent,1);
  assert.deepEqual(started.map(run=>`${run.agent}:${run.key}:${run.session}`),[
   `Ads:handover:1:target:${session('Ads')}`,
   `Critic:handover:2:target:${session('Critic')}`,
   `Ads:handover:1:answer:${session('Ads')}`,
   `Writer:handover:1:return:${place==='conversation'?where:session('Writer')}`],
  'Ads, then Critic, then Ads again with Critic\'s answer, each in its own session, then the Writer');
  assert.match(started[2].input,/Critic answered: The figures check out: 120 leads\./,'Critic\'s answer goes to Ads');
  assert.match(started[3].input,/Ads reported: February: 120 leads, checked by Critic\./,'and Ads\'s answer to the Writer');
  assert.deepEqual(replies,[{agent:'Writer',body:'Writer\'s reply with Ads reported: February: 120 leads, checked by Critic.'}],'only the Writer replies in the chat, last');
  assert.equal(rows[1].summary,'The figures check out: 120 leads.','Critic\'s answer is its leg\'s, for the chat to draw');
  assert.deepEqual(fakes.Critic.answers.map(answer=>answer.text),['']);
  assert.deepEqual(fakes.Critic.permits.map(permit=>permit.choice),['deny']);

  // Every asked Agent is offered hand_to_agent, naming the Company's other Agents, and nothing else; its answer and the
  // follow-up are offered nothing.
  for(const [at,agent] of /** @type {const} */([[0,'Ads'],[1,'Critic']])) {
   assert.deepEqual(started[at].tools.map(tool=>tool.name),['hand_to_agent'],`${agent} is offered hand_to_agent alone among gtmworks tools`);
   assert.deepEqual(started[at].tools[0].parameters.properties.agent.enum,others(agent).map(other=>other.name),`naming every other Agent, the Writer included`);
   assert.match(started[at].tools[0].description,/answer the agent that gave you the job/);
  }
  assert.deepEqual([started[2].tools,started[3].tools],[[],[]],'the answer and the follow-up write their words and hand nothing on');
 });
}

for(const place of /** @type {const} */(['conversation','channel'])) test(`a loop (Writer to Ads to Writer) completes in a ${place}, the Writer asked back working in its own handover session, never the chat's`,async()=>{
 const {rows,replies,service,session,where}=record(place,{from:'Writer',to:'Ads',goal:'Last campaign\'s numbers'});
 const {fakes,started,engineFor}=engines();
 fakes.Ads.settings.toolCalls=input=>input.startsWith('Writer asks you')?handOn('Writer','Say which month the post is for'):[];
 fakes.Ads.settings.reply=input=>input.startsWith('Answers')?'February: 120 leads.':'I asked the Writer which month.';
 fakes.Writer.settings.reply=input=>input.startsWith('Ads asks you')?'February.':'The post leads with February\'s 120 leads.';
 await drive(service,engineFor,rows);
 assert.deepEqual(rows.map(row=>`${row.from}>${row.to}:${row.state}`),['Writer>Ads:done','Ads>Writer:done']);
 const writerRuns=started.filter(run=>run.agent==='Writer');
 // In a channel an Agent has one session there (#150), its follow-up's too; in a Conversation the follow-up is the chat's.
 assert.deepEqual(writerRuns.map(run=>`${run.key}:${run.session}`),[`handover:2:target:${session('Writer')}`,`handover:1:return:${place==='conversation'?where:session('Writer')}`],
  'the Writer asked back works in its own handover session, then replies');
 assert.match(started.find(run=>run.key==='handover:1:answer')?.input??'',/Writer answered: February\./);
 assert.deepEqual(replies.map(reply=>reply.body),['The post leads with February\'s 120 leads.']);
});

test('a child that fails brings each level\'s Run back with "did not finish", up to the Agent the person talks to',async()=>{
 // Writer asks Ads, Ads asks Critic, Critic asks Lead. Lead fails; Critic's answer, then Ads's, fail in turn.
 const {rows,replies,service}=record('conversation',{from:'Writer',to:'Ads',goal:'Last campaign\'s numbers'});
 const {fakes,started,engineFor}=engines({'handover:3:target':'failed','handover:2:answer':'failed','handover:1:answer':'failed'});
 fakes.Ads.settings.toolCalls=input=>input.startsWith('Writer asks you')?handOn('Critic','Check the figures'):[];
 fakes.Critic.settings.toolCalls=input=>input.startsWith('Ads asks you')?handOn('Lead','Find the report'):[];
 fakes.Writer.settings.reply=()=>'Ads could not get the numbers; shall I write the post without them?';
 await drive(service,engineFor,rows);
 assert.deepEqual(rows.map(row=>`${row.from}>${row.to}:${row.state}:${row.target_outcome}`),
  ['Writer>Ads:done:failed','Ads>Critic:done:failed','Critic>Lead:done:failed'],'every step ended, each as not finished');
 assert.match(started.find(run=>run.key==='handover:2:answer')?.input??'',/Lead did not finish/,'Critic hears Lead did not finish');
 assert.match(started.find(run=>run.key==='handover:1:answer')?.input??'',/Critic did not finish/,'Ads hears Critic did not finish');
 assert.match(started.find(run=>run.key==='handover:1:return')?.input??'',/Ads did not finish/,'and the Writer hears Ads did not finish');
 assert.deepEqual(replies.map(reply=>reply.body),['Ads could not get the numbers; shall I write the post without them?'],'and still replies to the person');
});

test('a child that is stopped or lost is a job that did not finish, as a failed one is',async()=>{
 const {rows,service}=record('conversation',{from:'Writer',to:'Ads',goal:'Last campaign\'s numbers'});
 // Critic's Run is stopped on its Engine, and Lead's Engine no longer knows its Run.
 const {fakes,started,engineFor}=engines({'handover:2:target':'stopped','handover:3:target':'lost'});
 fakes.Ads.settings.toolCalls=input=>input.startsWith('Writer asks you')?[...handOn('Critic','Check the figures'),...handOn('Lead','Find the report')]:[];
 fakes.Ads.settings.reply=input=>input.startsWith('Answers')?'Neither finished.':'I asked Critic and Lead.';
 await drive(service,engineFor,rows);
 assert.deepEqual(rows.map(row=>`${row.to}:${row.state}:${row.target_outcome}`),['Ads:done:completed','Critic:done:stopped','Lead:done:lost']);
 const answer=started.find(run=>run.key==='handover:1:answer')?.input??'';
 assert.match(answer,/Critic did not finish/); assert.match(answer,/Lead did not finish/);
});

test('a call from the asked Agent\'s Run is kept once, however many passes read it',async()=>{
 const {rows,pins,service}=record('conversation',{from:'Writer',to:'Ads',goal:'Last campaign\'s numbers'});
 const {fakes,engineFor}=engines();
 fakes.Ads.settings.toolCalls=input=>input.startsWith('Writer asks you')?[...handOn('Critic','Check the figures'),...handOn('Critic','Check the figures'),{id:'call-x',name:'show_draft',arguments:{title:'x',line:'y'}}]:[];
 fakes.Critic.settings.pendingReads=2;
 await drive(service,engineFor,rows);
 assert.equal(rows.filter(row=>row.parent===1).length,1,'one child for one run and call, and a card tool the Run was never offered is ignored');
 assert.deepEqual(pins,[1,2],'each asked Agent\'s tool is pinned once, at its job\'s start');
});
