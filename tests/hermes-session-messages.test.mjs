import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { readSessionMessages, readSessionUsage, stepsBetween } from '../lib/engine/sessions.mjs';

// #875 on the fake Engine server, whose management listener serves a session's messages as the pinned release does
// (hermes_cli/web_routers/sessions.py get_session_messages): the last 50 messages of a Conversation's session are read
// a page at a time from the newest, with compacted messages asked for and inline images, and the page before when the
// page starts in the middle of a turn, so its first reply still carries the tool calls its turn made.
const profile='co-messages';
const connection=(/** @type {Awaited<ReturnType<typeof fakeHermes>>} */ fake)=>({address:fake.address,managementAddress:fake.managementAddress,profile,key:fake.settings.key});
const user=(/** @type {number} */ timestamp,/** @type {string} */ content,/** @type {object} */ more={})=>({role:'user',content,timestamp,...more});
const asked=(/** @type {number} */ timestamp,/** @type {any[]} */ calls)=>({role:'assistant',content:'',tool_calls:calls,timestamp});
const result=(/** @type {number} */ timestamp,/** @type {string} */ id,/** @type {string} */ name,/** @type {unknown} */ content)=>({role:'tool',tool_call_id:id,tool_name:name,content:typeof content==='string'?content:JSON.stringify(content),timestamp});
const replied=(/** @type {number} */ timestamp,/** @type {string} */ content)=>({role:'assistant',content,timestamp});
const call=(/** @type {string} */ id,/** @type {string} */ name,/** @type {object} */ args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});

test('the last messages of a session are read a page at a time from the newest, compacted ones asked for',async()=>{
 const fake=await fakeHermes();
 try {
  const messages=Array.from({length:5},(_,index)=>replied(index+1,`Message ${index}`));
  fake.settings.sessions.set('session-page',{profile,messages});
  const last=await readSessionMessages(connection(fake),'session-page',{offset:0,limit:2});
  assert.equal(last.state,'found');
  assert.deepEqual(last.state==='found'&&last.messages.map(message=>message.content),['Message 3','Message 4']);
  assert.equal(last.state==='found'&&last.more,true);
  const before=await readSessionMessages(connection(fake),'session-page',{offset:2,limit:2});
  assert.deepEqual(before.state==='found'&&before.messages.map(message=>message.content),['Message 1','Message 2']);
  const first=await readSessionMessages(connection(fake),'session-page',{offset:4,limit:2});
  assert.deepEqual(first.state==='found'&&first.messages.map(message=>message.content),['Message 0']);
  assert.equal(first.state==='found'&&first.more,false,'a short page is the first');
  assert.ok(fake.settings.managementRequests.some(request=>request.path?.includes('/messages?')&&request.path.includes('include_compacted=true')&&request.path.includes('inline_images=true')),'compacted messages and inline images are asked for');
 } finally { await fake.close(); }
});

test('a compacted session returns the Engine\'s summary alone unless its older words are asked for',async()=>{
 const fake=await fakeHermes();
 try {
  const summary='[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted for this session.';
  fake.settings.sessions.set('session-compacted',{profile,messages:[
   user(1,'Long message 0. words words',{compacted:1}),replied(2,'Reply 0.'),
   user(3,'Long message 1. words words',{compacted:1}),replied(4,'Reply 1.'),
   user(5,summary),replied(6,'Reply after the summary.')]});
  const plain=await readSessionMessages(connection(fake),'session-compacted',{offset:0,limit:50});
  assert.deepEqual(plain.state==='found'&&plain.messages.map(message=>message.content),['Long message 0. words words','Reply 0.','Long message 1. words words','Reply 1.',summary,'Reply after the summary.'],'gtmworks asks for the compacted messages, so a person\'s older words come back');
  const answer=await fetch(`${fake.managementAddress}/api/sessions/session-compacted/messages?profile=${profile}&order=latest&limit=50&offset=0`,{headers:{authorization:`Bearer ${fake.settings.key}`}});
  assert.equal(answer.status,200);
  const page=await answer.json();
  assert.ok(page.messages[0].content.startsWith('[CONTEXT COMPACTION'),'without the ask the Engine answers its summary alone');
 } finally { await fake.close(); }
});

test('a page that starts in the middle of a turn reads the page before it, so its first reply keeps its steps',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.sessions.set('session-turn',{profile,messages:[
   user(1000,'Plan the ads'),
   asked(1002,[call('call_1','web_search',{query:'accounting courses Cairo'}),call('call_2','read_file',{path:'campaigns.csv'})]),
   result(1005,'call_1','web_search',{results:[]}),
   result(1006,'call_2','read_file',{success:false,error:'not found'}),
   replied(1041.4,'Here is the plan.')]});
  const read=await readSessionMessages(connection(fake),'session-turn',{offset:0,limit:1});
  assert.equal(read.state,'found');
  assert.deepEqual(read.state==='found'&&read.prefix.length,4,'the page before the reply');
  assert.deepEqual(read.state==='found'&&read.suffix.length,0,'no newer page to read');
  assert.deepEqual(read.state==='found'&&read.messages.map(message=>message.content),['Here is the plan.']);
  const steps=stepsBetween([...(read.state==='found'?read.prefix:[]),...(read.state==='found'?read.messages:[])],0,4);
  assert.deepEqual(steps,{list:[{tool:'web_search',preview:'accounting courses Cairo',state:'done'},{tool:'read_file',preview:'campaigns.csv',state:'failed'}],seconds:41});
 } finally { await fake.close(); }
});

test('a session the Engine does not know is missing, a read past its page size is refused, and no odd id is sent',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.sessions.set('elsewhere',{profile:'co-other',messages:[user(1,'hi')]});
  assert.deepEqual(await readSessionMessages(connection(fake),'unknown'),{state:'missing',messages:null,prefix:[],suffix:[],more:false});
  assert.deepEqual(await readSessionMessages(connection(fake),'elsewhere'),{state:'missing',messages:null,prefix:[],suffix:[],more:false},'another profile\'s session is not this one\'s');
  assert.equal((await readSessionMessages(connection(fake),'unknown',{offset:0,limit:51})).state,'unreachable');
  assert.equal((await readSessionMessages(connection(fake),'../profiles')).state,'missing');
  assert.equal((await readSessionMessages(connection(fake),'unknown',{offset:-1,limit:50})).state,'unreachable');
 } finally { await fake.close(); }
});

test('a session\'s token use is read from its detail on its own, and null when the Engine does not know it',async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.sessions.set('session-use',{profile,messages:[],input_tokens:29000,output_tokens:32});
  assert.deepEqual(await readSessionUsage(connection(fake),'session-use'),{input:29000,output:32});
  assert.equal(await readSessionUsage(connection(fake),'unknown'),null);
  assert.equal(await readSessionUsage({...connection(fake),key:'wrong'},'session-use'),null);
 } finally { await fake.close(); }
});
