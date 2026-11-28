import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { answerRun, permitRun, readRunEvents, startSessionRun, stopRun } from '../lib/engine/runs.mjs';
import { hermesEngine } from '../lib/engine/contract.mjs';
import { liveLines } from '../lib/live-steps.mjs';
import { conversationLines } from '../lib/conversation-live.mjs';
import { claimAnswer, confirmAnswer, forgetAnswer } from '../lib/run-answers.mjs';

// #878 on the fake Engine server: a person steers the open Run of their Conversation through the Run's own routes. Its
// live read carries the question or the request to act the Run waits on, read from the Run's record, and says how it
// settled: answered here or in another tab, or, once the Engine stopped waiting with no answer, not allowed.
const profile='co-steer';
const connection=(/** @type {Awaited<ReturnType<typeof fakeHermes>>} */ fake)=>({address:fake.address,managementAddress:fake.managementAddress,profile,key:fake.settings.key});
/** Follows a Run as the live route does, calling `seen` with each line as it comes; resolves with every line. */
const follow=(/** @type {any} */ fake,/** @type {string} */ run,/** @type {(line:any)=>void|Promise<void>} */ seen=()=>{},may=/** @type {const} */(['once','always','deny']))=>{
 const engine=hermesEngine(connection(fake));
 return (async()=>{
  const all=[];
  for await(const line of conversationLines(run,liveLines(run,readRunEvents({...connection(fake),run}),{reply:true}),{read:()=>engine.read(run),may:[...may],every:50})) { all.push(line); await seen(line); }
  return all;
 })();
};
const start=async(/** @type {any} */ fake,/** @type {string} */ input)=>/** @type {string} */(await startSessionRun({...connection(fake),session:`gtmworks-${crypto.randomUUID()}`,input,idempotencyKey:crypto.randomUUID()}));

test('the question a Run asks is on its live read, the answer reaches the Run, and the Agent goes on',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.questions=input=>input.includes('plan')?[{question:'Which city?',choices:['Cairo','Giza']}]:[];
  fake.settings.reply=(input,answers)=>`Plan for ${answers[0]??'nowhere'}`;
  const run=await start(fake,'Write the plan');
  const lines=await follow(fake,run,async line=>{ if('asking' in line) assert.equal(await answerRun({...connection(fake),run,question:line.asking.id,text:'Giza'}),'answered'); });
  const asked=lines.find(line=>'asking' in line)?.asking;
  assert.deepEqual({...asked,id:undefined},{kind:'question',run,id:undefined,text:'Which city?',choices:['Cairo','Giza'],multiple:false},'the Engine\'s own hint and mark are not the Agent\'s words');
  assert.equal(lines.map(line=>'delta' in line?line.delta:'').join(''),'Plan for Giza','the Agent went on with the answer');
  assert.deepEqual(lines.at(-1),{end:'ended',outcome:'completed'});
 } finally { await fake.close(); }
});

test('a request to act waits with the choices the person may send; allowed once the Agent goes on, refused it is told no',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.approvals=()=>[{description:'recursive delete',command:'rm -rf build'}];
  fake.settings.reply=(input,answers,choices)=>`${input}: ${choices[0]}`;
  for(const choice of /** @type {const} */(['once','deny'])) {
   const run=await start(fake,`Clean up ${choice}`);
   const lines=await follow(fake,run,async line=>{ if('asking' in line) { assert.ok(claimAnswer(run,line.asking.id,{choice})); assert.equal(await permitRun({...connection(fake),run,permission:line.asking.id,choice}),'answered'); confirmAnswer(run,line.asking.id); } },['once','deny']);
   const asked=lines.find(line=>'asking' in line)?.asking;
   assert.equal(asked?.kind,'permission');
   assert.equal(asked?.description,'recursive delete'); assert.equal(asked?.command,'rm -rf build');
   assert.deepEqual(asked?.choices,['once','deny'],'"Always allow" is not offered to a Role that may not send it');
   assert.deepEqual(lines.find(line=>'settled' in line)?.settled,{kind:'permission',id:asked?.id,choice},'the card closes with the choice made');
   assert.equal(lines.map(line=>'delta' in line?line.delta:'').join(''),`Clean up ${choice}: ${choice}`,'the Run took the choice and went on');
  }
 } finally { await fake.close(); }
});

test('a card answered in another tab closes with that answer, and one the Engine stopped waiting on shows as not allowed',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.questions=input=>input.includes('ask')?[{question:'Which city?',choices:['Cairo','Giza']}]:[];
  fake.settings.approvals=input=>input.includes('act')?[{description:'Send the email',command:'send mail'}]:[];
  // Two tabs follow the same Run; the first answers it through this server, the second only sees the Engine stop waiting.
  const asked=await start(fake,'ask');
  const [mine,other]=await Promise.all([
   follow(fake,asked,async line=>{ if('asking' in line) { assert.ok(claimAnswer(asked,line.asking.id,{answer:'Cairo'})); assert.equal(await answerRun({...connection(fake),run:asked,question:line.asking.id,text:'Cairo'}),'answered'); confirmAnswer(asked,line.asking.id); } }),
   follow(fake,asked)]);
  for(const lines of [mine,other]) assert.deepEqual(lines.find(line=>'settled' in line)?.settled,{kind:'question',id:lines.find(line=>'asking' in line)?.asking.id,answer:'Cairo'});
  // Nobody answers: the Engine's time limit passes.
  const acting=await start(fake,'act');
  const lapsed=await follow(fake,acting,line=>{ if('asking' in line) fake.settings.expireApproval(acting); });
  assert.deepEqual(lapsed.find(line=>'settled' in line)?.settled,{kind:'permission',id:lapsed.find(line=>'asking' in line)?.asking.id,choice:'deny',expired:true},'not allowed, never allowed');
  const unasked=await start(fake,'ask again');
  const closed=await follow(fake,unasked,line=>{ if('asking' in line) fake.settings.expire(unasked); });
  assert.deepEqual(closed.find(line=>'settled' in line)?.settled,{kind:'question',id:closed.find(line=>'asking' in line)?.asking.id,closed:true});
 } finally { await fake.close(); }
});

test('Stop ends the open Run, a card it waited on with it, and its end says it was stopped',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.questions=()=>[{question:'Which city?'}];
  const run=await start(fake,'Write the plan');
  const lines=await follow(fake,run,async line=>{ if('asking' in line) assert.equal(await stopRun({...connection(fake),run}),true); });
  assert.deepEqual(lines.find(line=>'settled' in line)?.settled,{kind:'question',id:lines.find(line=>'asking' in line)?.asking.id,closed:true});
  assert.deepEqual(lines.at(-1),{end:'ended',outcome:'stopped'});
 } finally { await fake.close(); }
});

test('a choice still on its way never shows as taken: one the Engine did not take settles as not allowed',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.approvals=()=>[{description:'Send the email',command:'send mail'}];
  const run=await start(fake,'Send it');
  // This tab claimed "Allow once", but the Engine's time limit passed before the choice reached it.
  const lines=await follow(fake,run,async line=>{
   if(!('asking' in line)) return;
   assert.ok(claimAnswer(run,line.asking.id,{choice:'once'}));
   assert.ok(!claimAnswer(run,line.asking.id,{choice:'deny'}),'one claim per card');
   fake.settings.expireApproval(run);
   await new Promise(resolve=>setTimeout(resolve,300));
   assert.equal(await permitRun({...connection(fake),run,permission:line.asking.id,choice:'once'}),'gone');
   forgetAnswer(run,line.asking.id);
  });
  const asked=lines.find(line=>'asking' in line)?.asking;
  assert.deepEqual(lines.find(line=>'settled' in line)?.settled,{kind:'permission',id:asked?.id,choice:'deny',expired:true});
 } finally { await fake.close(); }
});

test('a question whose choices cannot all be drawn is drawn with none, to be answered in words',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.questions=()=>[{question:'Which day?',choices:['Sun','Mon','Tue','Wed','Thu']}];
  const run=await start(fake,'Plan the week');
  const lines=await follow(fake,run,async line=>{ if('asking' in line) await stopRun({...connection(fake),run}); });
  assert.deepEqual(lines.find(line=>'asking' in line)?.asking.choices,[]);
 } finally { await fake.close(); }
});

test('a stream cut short leaves the card open: only the Run\'s end or a record read settles it',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.questions=()=>[{question:'Which city?',choices:['Cairo','Giza']}];
  const run=await start(fake,'Write the plan');
  const engine=hermesEngine(connection(fake));
  // The Engine's stream drops once the card is drawn; the Run still waits.
  const cut=new AbortController();
  const lines=[];
  for await(const line of conversationLines(run,liveLines(run,readRunEvents({...connection(fake),run,signal:cut.signal}),{reply:true}),{read:()=>engine.read(run),may:['once','deny'],every:50})) {
   lines.push(line);
   if('asking' in line) cut.abort();
  }
  assert.ok(lines.some(line=>'asking' in line));
  assert.ok(!lines.some(line=>'settled' in line),'the card is not settled by a cut stream');
  assert.notEqual(lines.at(-1)?.end,'ended');
  assert.equal(fake.settings.runs.at(-1)?.asked[0].settled,null,'the Engine still waits');
  await stopRun({...connection(fake),run});
 } finally { await fake.close(); }
});

test('a reader that comes back with a card still drawn has it settled when the Engine no longer waits on it, else drawn again',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.questions=()=>[{question:'Which city?',choices:['Cairo','Giza']},{question:'Which day?'}];
  fake.settings.liveHold=true;
  const run=await start(fake,'Write the plan');
  fake.settings.release(run);
  const engine=hermesEngine(connection(fake));
  const reading=(/** @type {{kind:'question',id:string}|null} */ held,/** @type {(line:any)=>boolean} */ until)=>(async()=>{
   const cut=new AbortController(); const lines=[];
   for await(const line of conversationLines(run,liveLines(run,readRunEvents({...connection(fake),run,signal:cut.signal}),{reply:true}),{read:()=>engine.read(run),may:[],every:50,held})) { lines.push(line); if(until(line)) cut.abort(); }
   return lines;
  })();
  // The reader drew the first question, then went away.
  const first=(await reading(null,line=>'asking' in line)).find(line=>'asking' in line)?.asking;
  assert.equal(first?.text,'Which city?');
  // Another tab answered it meanwhile, through this server.
  assert.ok(claimAnswer(run,first.id,{answer:'Giza'}));
  assert.equal(await answerRun({...connection(fake),run,question:first.id,text:'Giza'}),'answered');
  confirmAnswer(run,first.id);
  // Coming back with it still drawn: it settles with that answer, and the next question is drawn.
  const back=await reading({kind:'question',id:first.id},line=>'asking' in line);
  assert.deepEqual(back.find(line=>'settled' in line)?.settled,{kind:'question',id:first.id,answer:'Giza'});
  const second=back.find(line=>'asking' in line)?.asking;
  assert.equal(second?.text,'Which day?');
  // Coming back with a card the Engine still waits on draws it again, unsettled.
  const again=await reading({kind:'question',id:second.id},line=>'asking' in line);
  assert.equal(again.find(line=>'asking' in line)?.asking.id,second.id);
  assert.ok(!again.some(line=>'settled' in line));
  await stopRun({...connection(fake),run});
 } finally { await fake.close(); }
});
