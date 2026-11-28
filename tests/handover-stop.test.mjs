import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { stopChannelMessage } from '../lib/channel-runs.mjs';
import { company, drive, engines, handOn, record } from './handover-record.mjs';

// #478 on the fake engine: the person's Stop ends the whole Handover chain started from one channel
// message, on the database stand-in of tests/handover-record.mjs (supabase/tests/handover_stop.sql proves the real
// functions): each open Run of the chain is stopped on its own Agent's Engine, each handover ends as stopped, and no
// answer or follow-up Run starts after it.
const job={from:'Writer',to:'Ads',goal:'Last campaign\'s numbers'};
const state=(/** @type {any[]} */ rows)=>rows.map(row=>`${row.from}>${row.to}:${row.state}:${row.target_outcome??'-'}:${row.follow_up_outcome??'-'}`);

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

 assert.deepEqual(await withEngineContract(engineFor,()=>stopChannelMessage(service,{company,channel:'d4770000-0000-0000-0000-000000000001',message:1})),{stopped:true});
 assert.deepEqual(stops.map(stop=>stop.agent),['Critic'],'only message 1\'s open Run is stopped');
 assert.equal(fakes.Lead.runs[0].stopped,false);

 await drive(service,engineFor,rows);
 assert.deepEqual(state(rows),['Writer>Ads:done:stopped:-','Writer>Lead:done:completed:completed','Ads>Critic:done:stopped:-'],
  'message 1\'s chain ended as stopped, and message 2\'s handover finished');
 assert.deepEqual(started.map(run=>run.key),['handover:1:target','handover:2:target','handover:3:target','handover:2:return'],'no answer of Ads and no follow-up for message 1');
 assert.deepEqual(replies,[{agent:'Writer',body:'Writer\'s reply with Lead reported: Warm and short.'}]);
});
