import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { readRunEvents, startSessionRun } from '../lib/engine/runs.mjs';
import { readSessionMessages } from '../lib/engine/sessions.mjs';
import { liveLines } from '../lib/live-steps.mjs';
import { hermesEngine } from '../lib/engine/contract.mjs';
import { runEnd } from '../lib/run-outcome.mjs';

// #876 on the fake Engine server: a person's message is one Run on the Conversation's own session, whose id gtmworks
// chose (docs/engine-probes/conversation-read.md, answer 1), with the Member's note as its instructions. The Run's event
// stream carries the reply as it is written (message.delta) and each tool call as it starts and ends, and once it ends
// the session holds the message, the calls and the reply, read as any other turn is.
const profile='co-send';
const connection=(/** @type {Awaited<ReturnType<typeof fakeHermes>>} */ fake)=>({address:fake.address,managementAddress:fake.managementAddress,profile,key:fake.settings.key});
/** @param {AsyncIterable<any>} lines */
const collect=async lines=>{ const all=[]; for await(const line of lines) all.push(line); return all; };

test('a message is a Run on the session gtmworks chose, its reply streamed as written and its steps as they start and end',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.liveSteps=()=>[{tool:'web_search',preview:'accounting courses Cairo'}];
  const session=`gtmworks-${crypto.randomUUID()}`;
  const run=await startSessionRun({...connection(fake),session,input:'Plan the ads',instructions:'Write short.',idempotencyKey:'send-1'});
  assert.equal(typeof run,'string');
  const sent=fake.settings.runs.find(each=>each.id===run);
  assert.equal(sent?.sessionId,session,'the Run is on the chosen session');
  assert.equal(sent?.instructions,'Write short.','the note goes as the Run\'s instructions, and nothing else');
  const lines=await collect(liveLines(/** @type {string} */(run),readRunEvents({...connection(fake),run:/** @type {string} */(run)}),{reply:true}));
  const said=lines.flatMap(line=>'delta' in line?[line.delta]:[]).join('');
  assert.equal(said,'Reply to: Plan the ads','the reply arrives as it is written');
  const views=lines.filter(line=>'steps' in line);
  assert.deepEqual(views.at(-1),{run,steps:[{tool:'web_search',preview:'accounting courses Cairo',state:'done'}],now:null});
  assert.ok(views.some(view=>view.now?.tool==='web_search'),'the step shows as it starts');
  assert.deepEqual(lines.at(-1),{end:'ended'});
  // Once it ended, the session holds the turn: the person's words, the call, its result and the reply.
  const read=await readSessionMessages(connection(fake),session,{offset:0,limit:50});
  assert.equal(read.state,'found');
  assert.deepEqual(read.state==='found'&&read.messages.map(message=>message.role),['user','assistant','tool','assistant']);
  assert.equal(read.state==='found'&&read.messages[0].content,'Plan the ads');
  assert.equal(read.state==='found'&&read.messages.at(-1)?.content,'Reply to: Plan the ads');
 } finally { await fake.close(); }
});

test('the same send key replays the same Run, and a refused start is no Run',async()=>{
 const fake=await fakeHermes();
 try {
  const session=`gtmworks-${crypto.randomUUID()}`;
  const first=await startSessionRun({...connection(fake),session,input:'Hello',idempotencyKey:'send-2'});
  const again=await startSessionRun({...connection(fake),session,input:'Hello',idempotencyKey:'send-2'});
  assert.equal(again,first);
  assert.equal(fake.settings.runs.length,1);
  fake.settings.status=503;
  assert.equal(typeof await startSessionRun({...connection(fake),session,input:'Hello',idempotencyKey:'send-3'}),'object','no run id');
 } finally { await fake.close(); }
});

test('a start whose answers were lost is unknown, and asking again with the same key replays that one Run',async()=>{
 const fake=await fakeHermes();
 try {
  const session=`gtmworks-${crypto.randomUUID()}`;
  fake.settings.loseStarts=2;
  const lost=await startSessionRun({...connection(fake),session,input:'Hello',idempotencyKey:'send-4'});
  assert.deepEqual(lost,{state:'unknown'});
  const found=await startSessionRun({...connection(fake),session,input:'Hello',idempotencyKey:'send-4',retry:true});
  assert.equal(typeof found,'string');
  assert.equal(fake.settings.runs.length,1,'one Run, never two');
 } finally { await fake.close(); }
});

// #879: how the Run ended is read from its own record, once its events end or before they are followed at all.
test('a Run that ran out of usage did not finish, and its record says why and when the usage resets',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.ending='failed'; fake.settings.failure=fake.settings.noAccountText;
  const session=`gtmworks-${crypto.randomUUID()}`;
  const run=/** @type {string} */(await startSessionRun({...connection(fake),session,input:'Plan the ads',idempotencyKey:'send-5'}));
  const lines=await collect(liveLines(run,readRunEvents({...connection(fake),run}),{reply:true}));
  assert.equal(lines.some(line=>'delta' in line),false,'no reply is written');
  assert.deepEqual(lines.at(-1),{end:'ended'});
  const told=runEnd(await hermesEngine(connection(fake)).read(run));
  assert.equal(told?.end,'ended');
  assert.equal(told&&'outcome' in told&&told.outcome,'failed');
  assert.equal(told&&'cause' in told&&told.cause,'access');
  const wait=Date.parse(told&&'resetsAt' in told&&told.resetsAt||'')-Date.now();
  assert.ok(wait>120*3600e3&&wait<121*3600e3,'it resets in about 121 hours, as the Engine said');
  // The session holds the person's message, and no reply.
  const read=await readSessionMessages(connection(fake),session,{offset:0,limit:50});
  assert.deepEqual(read.state==='found'&&read.messages.map(message=>message.role),['user']);
 } finally { await fake.close(); }
});

test('a finished Run read after it ended has ended, and one the Engine lost is gone',async()=>{
 const fake=await fakeHermes();
 try {
  const session=`gtmworks-${crypto.randomUUID()}`;
  const run=/** @type {string} */(await startSessionRun({...connection(fake),session,input:'Hello',idempotencyKey:'send-6'}));
  await collect(readRunEvents({...connection(fake),run}));
  assert.deepEqual(runEnd(await hermesEngine(connection(fake)).read(run)),{end:'ended'});
  fake.settings.runs.splice(fake.settings.runs.findIndex(each=>each.id===run),1); fake.settings.sweep(run);
  assert.deepEqual(runEnd(await hermesEngine(connection(fake)).read(run)),{end:'gone'});
 } finally { await fake.close(); }
});
