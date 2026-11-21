import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drive, engines, handOn, others, record } from './handover-record.mjs';

// #477 on the fake engine: an asked Agent hands the job on, and gtmworks moves every Run of the chain itself, on the
// database stand-in of tests/handover-record.mjs (supabase/tests/handover_chains.sql proves the real functions).

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

test('an asked Agent whose reply is only its call still hands on: its Run completed, and the chain goes on',async()=>{
 const {rows,replies,service}=record('conversation',{from:'Writer',to:'Ads',goal:'Last campaign\'s numbers'});
 const {fakes,started,engineFor}=engines();
 // The Engine takes the call block out of the reply, so the Run completes with no words of its own.
 fakes.Ads.settings.toolCalls=input=>input.startsWith('Writer asks you')?handOn('Critic','Check the figures'):[];
 fakes.Ads.settings.reply=input=>input.startsWith('Answers')?'February: 120 leads.':'';
 fakes.Critic.settings.reply=()=>'The figures check out.';
 fakes.Writer.settings.reply=()=>'The post leads with 120 leads.';
 await drive(service,engineFor,rows);
 assert.deepEqual(rows.map(row=>`${row.from}>${row.to}:${row.state}:${row.target_outcome}`),['Writer>Ads:done:completed','Ads>Critic:done:completed']);
 assert.deepEqual(started.map(run=>run.key),['handover:1:target','handover:2:target','handover:1:answer','handover:1:return']);
 assert.deepEqual(replies.map(reply=>reply.body),['The post leads with 120 leads.']);
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
