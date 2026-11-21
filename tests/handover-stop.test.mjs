import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopConversationRun } from '../lib/conversation-runs.mjs';
import { stopChannelMessage } from '../lib/channel-runs.mjs';
import { driveHandovers } from '../lib/handovers.mjs';
import { company, drive, engines, handOn, hermes, record } from './handover-record.mjs';

// #478 on the fake engine: the person's Stop ends the whole Handover chain started from their chat, or from one channel
// message, on the database stand-in of tests/handover-record.mjs (supabase/tests/handover_stop.sql proves the real
// functions): each open Run of the chain is stopped on its own Agent's Engine, each handover ends as stopped, and no
// answer or follow-up Run starts after it.
const job={from:'Writer',to:'Ads',goal:'Last campaign\'s numbers'};
const state=(/** @type {any[]} */ rows)=>rows.map(row=>`${row.from}>${row.to}:${row.state}:${row.target_outcome??'-'}:${row.follow_up_outcome??'-'}`);

test('Stop in a Conversation stops every open handover of a two-level chain, each as stopped, and starts no follow-up',async()=>{
 const {rows,replies,service,where}=record('conversation',job);
 const {fakes,started,stops,engineFor}=engines();
 fakes.Ads.settings.toolCalls=input=>input.startsWith('Writer asks you')?handOn('Critic','Check the figures'):[];
 // Critic is still working when the person presses Stop; Ads's leg waits on it.
 fakes.Critic.settings.pendingReads=1000;
 await drive(service,engineFor,rows,{until:()=>rows[1]?.state==='target'});
 assert.deepEqual(state(rows),['Writer>Ads:handing:-:-','Ads>Critic:target:-:-'],'the chain is open two levels down');

 assert.deepEqual(await stopConversationRun(service,{company,conversation:where,hermes,engineFor}),{stopped:true});
 assert.deepEqual(stops.map(stop=>`${stop.agent}:${stop.run}`),[`Critic:${rows[1].target_run}`],'Critic\'s Run is stopped on its own Engine');
 assert.equal(fakes.Critic.runs[0].stopped,true);
 assert.deepEqual(state(rows),['Writer>Ads:done:stopped:-','Ads>Critic:done:stopped:-'],'each handover of the chain ends as stopped');

 const before=started.length;
 await drive(service,engineFor,rows);
 assert.equal(started.length,before,'no answer of Ads and no follow-up of the Writer starts');
 assert.deepEqual(started.map(run=>run.key),['handover:1:target','handover:2:target']);
 assert.deepEqual(replies,[],'and nothing is replied in the chat');
});

test('Stop in a Conversation whose own Run is still open stops that Run and the chain together',async()=>{
 const {rows,replies,service,where,chat}=record('conversation',job);
 const {fakes,started,stops,engineFor}=engines();
 fakes.Ads.settings.toolCalls=input=>input.startsWith('Writer asks you')?handOn('Critic','Check the figures'):[];
 fakes.Critic.settings.pendingReads=1000;
 await drive(service,engineFor,rows,{until:()=>rows[1]?.state==='target'});
 // The person wrote again meanwhile, and the Writer is working on that message in the chat.
 fakes.Writer.settings.pendingReads=1000;
 chat.run=/** @type {string} */ (await engineFor({...hermes,profile:'ag-04770000000000000000000000000013'}).start({conversation:where,input:'And add a call to action',idempotencyKey:'chat:2'}));
 assert.deepEqual(await stopConversationRun(service,{company,conversation:where,hermes,engineFor}),{stopped:true});
 assert.deepEqual(stops.map(stop=>`${stop.agent}:${stop.run}`),[`Writer:${chat.run}`,`Critic:${rows[1].target_run}`],'the chat\'s own Run first, then the chain\'s');
 assert.equal(fakes.Writer.runs.find(run=>run.id===chat.run)?.stopped,true);
 assert.deepEqual(state(rows),['Writer>Ads:done:stopped:-','Ads>Critic:done:stopped:-']);
 const before=started.length;
 await drive(service,engineFor,rows);
 assert.equal(started.length,before);
 assert.deepEqual(replies,[]);
});

test('the chat\'s own Run whose Engine missed the stop at the press is stopped by the worker\'s next pass',async()=>{
 const {rows,service,where,chat}=record('conversation',job);
 const {fakes,stops,engineFor}=engines({},{missedStops:1});
 fakes.Ads.settings.pendingReads=1000;
 fakes.Writer.settings.pendingReads=1000;
 await drive(service,engineFor,rows,{until:()=>rows[0].state==='target'});
 chat.run=/** @type {string} */ (await engineFor({...hermes,profile:'ag-04770000000000000000000000000013'}).start({conversation:where,input:'And add a call to action',idempotencyKey:'chat:2'}));
 assert.deepEqual(await stopConversationRun(service,{company,conversation:where,hermes,engineFor}),{stopped:true});
 const own=/** @type {any} */ (fakes.Writer.runs.find(run=>run.id===chat.run));
 assert.equal(own.stopped,false,'the Engine could not be reached for the chat\'s own Run');
 await driveHandovers(service,{hermes,engineFor});
 assert.equal(own.stopped,true,'the worker stops it on its next pass');
 assert.equal(stops.filter(stop=>stop.run===chat.run).length,2);
});

test('Stop while the asking Agent\'s follow-up runs stops that Run too, and keeps no reply',async()=>{
 const {rows,replies,service,where}=record('conversation',job);
 const {fakes,stops,engineFor}=engines();
 fakes.Writer.settings.pendingReads=1000;
 await drive(service,engineFor,rows,{until:()=>rows[0].state==='follow_up'});
 assert.deepEqual(await stopConversationRun(service,{company,conversation:where,hermes,engineFor}),{stopped:true});
 assert.deepEqual(stops.map(stop=>`${stop.agent}:${stop.run}`),[`Writer:${rows[0].follow_up_run}`]);
 assert.deepEqual(state(rows),['Writer>Ads:done:completed:stopped'],'Ads had answered; the Writer\'s reply to it is what stopped');
 await drive(service,engineFor,rows);
 assert.deepEqual(replies,[]);
});

test('a leg whose start is on its way to the Engine when Stop is pressed has its Run stopped once it arrives',async()=>{
 const {rows,service,where}=record('conversation',job);
 const {fakes,stops,engineFor}=engines();
 fakes.Ads.settings.pendingReads=1000;
 // The person presses Stop while Ads's start is with the Engine: the handover ends before its Run id is kept.
 const pressing=(/** @type {any} */ connection)=>{ const engine=engineFor(connection);
  return {...engine,start:async(/** @type {any} */ args)=>{ const run=await engine.start(args); await stopConversationRun(service,{company,conversation:where,hermes,engineFor}); return run; }}; };
 await drive(service,pressing,rows);
 assert.deepEqual(state(rows),['Writer>Ads:done:stopped:-']);
 assert.equal(fakes.Ads.runs.length,1);
 assert.deepEqual(stops.map(stop=>`${stop.agent}:${stop.run}`),[`Ads:${fakes.Ads.runs[0].id}`],'the Run that started after the Stop is stopped');
 assert.equal(fakes.Ads.runs[0].stopped,true);
});

test('a Run whose Engine missed the stop at the press is stopped by the worker\'s next pass, then left alone',async()=>{
 const {rows,service,where}=record('conversation',job);
 const {fakes,stops,engineFor}=engines({},{missedStops:1});
 fakes.Ads.settings.pendingReads=1000;
 await drive(service,engineFor,rows,{until:()=>rows[0].state==='target'});
 assert.deepEqual(await stopConversationRun(service,{company,conversation:where,hermes,engineFor}),{stopped:true});
 assert.equal(fakes.Ads.runs[0].stopped,false,'the Engine could not be reached at the press');
 assert.equal(rows[0].stopping_run,fakes.Ads.runs[0].id,'the Run is kept as the one to stop');
 await driveHandovers(service,{hermes,engineFor});
 assert.equal(fakes.Ads.runs[0].stopped,true,'the worker stops it');
 await driveHandovers(service,{hermes,engineFor});
 assert.equal(rows[0].stopping_run,null,'once its Engine says it ended, nothing is left to stop');
 await driveHandovers(service,{hermes,engineFor});
 assert.equal(stops.length,2,'and it is never asked again');
});

test('a leg whose start\'s answer was lost when Stop was pressed ends as stopped once a retry learns its Run, which is then stopped',async()=>{
 const {rows,replies,service,where}=record('conversation',job);
 const {fakes,stops,engineFor}=engines({},{lostStarts:['handover:1:target']});
 fakes.Ads.settings.pendingReads=1000;
 await driveHandovers(service,{hermes,engineFor});
 assert.equal(rows[0].state,'waiting','the start was made, its answer lost');
 assert.equal(fakes.Ads.runs.length,1);
 assert.deepEqual(await stopConversationRun(service,{company,conversation:where,hermes,engineFor}),{stopped:true});
 assert.equal(rows[0].state,'waiting','only a retry with the same key can learn that Run, so the leg waits for it');
 await drive(service,engineFor,rows);
 assert.deepEqual(state(rows),['Writer>Ads:done:stopped:-'],'it ended as stopped when its Run id came back');
 assert.equal(fakes.Ads.runs.length,1,'the retry was the same Run');
 assert.equal(fakes.Ads.runs[0].stopped,true,'and that Run is stopped');
 assert.deepEqual(stops.map(stop=>stop.run),[fakes.Ads.runs[0].id]);
 assert.deepEqual(replies,[]);
});

test('Stop with nothing open in the chat says there is nothing to stop',async()=>{
 const {rows,service,where}=record('conversation',job);
 const {engineFor}=engines();
 await drive(service,engineFor,rows);
 assert.deepEqual(await stopConversationRun(service,{company,conversation:where,hermes,engineFor}),{code:'P0002',message:'conversationNothingToStop'});
});

test('Stop on a channel message\'s Run stops the handovers started from that message, and leaves the other message\'s running',async()=>{
 // Message 1: the Writer asks Ads, and Ads asks Critic. Message 2: the Writer asks Lead.
 const {rows,replies,service}=record('channel',job,{from:'Writer',to:'Lead',goal:'The brand\'s tone'});
 const {fakes,started,stops,engineFor}=engines();
 fakes.Ads.settings.toolCalls=input=>input.startsWith('Writer asks you')?handOn('Critic','Check the figures'):[];
 fakes.Critic.settings.pendingReads=1000;
 fakes.Lead.settings.pendingReads=3;
 fakes.Lead.settings.reply=()=>'Warm and short.';
 fakes.Writer.settings.reply=input=>`Writer's reply with ${input}`;
 await drive(service,engineFor,rows,{until:()=>rows[2]?.state==='target'});
 assert.deepEqual(state(rows),['Writer>Ads:handing:-:-','Writer>Lead:target:-:-','Ads>Critic:target:-:-'],'both messages have work open');

 assert.deepEqual(await stopChannelMessage(service,{company,channel:'d4770000-0000-0000-0000-000000000001',message:1,hermes,engineFor}),{stopped:true});
 assert.deepEqual(stops.map(stop=>stop.agent),['Critic'],'only message 1\'s open Run is stopped');
 assert.equal(fakes.Lead.runs[0].stopped,false);

 await drive(service,engineFor,rows);
 assert.deepEqual(state(rows),['Writer>Ads:done:stopped:-','Writer>Lead:done:completed:completed','Ads>Critic:done:stopped:-'],
  'message 1\'s chain ended as stopped, and message 2\'s handover finished');
 assert.deepEqual(started.map(run=>run.key),['handover:1:target','handover:2:target','handover:3:target','handover:2:return'],'no answer of Ads and no follow-up for message 1');
 assert.deepEqual(replies,[{agent:'Writer',body:'Writer\'s reply with Lead reported: Warm and short.'}]);
});
