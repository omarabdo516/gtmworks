import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Duplex } from 'node:stream';
import WebSocket from 'ws';
import { engineServing } from './engine-records.mjs';
import { withEngineContract } from '../lib/engine/handle.mjs';
import { hermesEngine as engineFor } from '../lib/engine/contract.mjs';
import { screenStreams, screenStreamPath, screenUpgrades } from '../lib/screen-stream.mjs';

// #713, ADR 0029: the live stream of an Agent's Screen on gtmworks's own web server, against the fake Engine. The person
// is the stream's `people` seam (in the app, the session cookie and the database): who they are when the socket opens,
// and what they may do now, asked again on each take and on each periodic check of an open socket.
const company='10000000-0000-0000-0000-000000000001', agent='e1000000-0000-0000-0000-000000000713';
const profile={soul:'',provider:'auto',model:'',key:'test-only-key',config:{},credentials:{}};
const until=async(what,ready,ms=5000)=>{
 const end=Date.now()+ms;
 for(;;) { const found=ready(); if(found) return found; if(Date.now()>end) throw new Error(`${what} within ${ms}ms`); await new Promise(resolve=>setTimeout(resolve,20)); }
};

async function streams({engine=engineFor,recheck=60000}={}) {
 // The Company's Engine record names this Engine; a test's own driver answers for it through the handle.
 const fake=await engineServing(company);
 fake.settings.profiles.set('ads',profile); fake.settings.screens.set('ads',{running:true});
 const may={level:'control',name:'Mona'}, rows=[];
 const people={
  admit:async(_request,query)=>({company:query.get('company'),agent:query.get('agent'),profile:'ads',person:query.get('as')??'mona'}),
  access:async at=>({...may,...may.level==='control'&&at.person!=='mona'?{name:at.person}:{}}),
  logged:async(_at,row)=>{ rows.push(row); },
 };
 const handle=screenStreams({people,recheck});
 const server=createServer();
 server.on('upgrade',(request,socket,head)=>{ void withEngineContract(engine,()=>handle(request,socket,head,new URL(request.url??'/','http://gtmworks').searchParams)); });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(undefined)));
 const sockets=[];
 const open=(as='mona',{resume=false}={})=>{
  const ws=new WebSocket(`ws://127.0.0.1:${/** @type {any} */(server.address()).port}${screenStreamPath}?company=${company}&agent=${agent}&as=${as}${resume?'&resume=1':''}`);
  sockets.push(ws);
  const said=[]; let code=null;
  ws.on('message',(data,binary)=>{ if(!binary) said.push(JSON.parse(String(data))); });
  ws.on('close',closed=>{ code=closed; });
  const heard=(what,match,after=0)=>until(what,()=>said.slice(after).find(message=>Object.entries(match).every(([key,value])=>message[key]===value)));
  return {ws,said,heard,closed:()=>until('the socket closed',()=>code),send:message=>ws.send(JSON.stringify(message))};
 };
 const lease=()=>fake.settings.screens.get('ads')?.holder??'agent';
 return {fake,may,rows,open,lease,close:async()=>{ for(const ws of sockets) ws.terminate(); server.close(); await fake.close(); }};
}

// The Engine contract with a viewer whose own give-back fails, as an Engine that does not answer the release: closing it
// leaves its lease behind, as a viewer whose connection dropped would. A forced give-back still works.
const failingRelease=held=>connection=>{
 const real=engineFor(connection);
 return {...real,screenViewer:async()=>{
  const opened=await real.screenViewer();
  if(opened.state!=='open') return opened;
  const viewer=opened.viewer; held.push(viewer);
  return {...opened,viewer:{...viewer,giveBack:async(options={})=>held.failing&&!options.force?{state:'failed'}:viewer.giveBack(options),close:async()=>{ if(!held.failing) await viewer.close(); }}};
 }};
};

test('a give-back the Engine fails as the socket closes still frees the Screen: the next person to open it may take control',async()=>{
 const held=Object.assign([],{failing:true});
 const at=await streams({engine:failingRelease(held)});
 try {
  const first=at.open();
  await first.heard('the stream',{stream:'open'});
  first.send({take:true});
  await first.heard('control taken',{control:'mine'});
  first.ws.close();
  await first.closed();
  assert.equal(at.lease(),'human','the Engine still holds the lease the failed give-back left');
  const next=at.open();
  await next.heard('the Screen with its Agent',{control:'agent'});
  await next.heard('the stream',{stream:'open'});
  held.failing=false;
  next.send({take:true});
  await next.heard('control taken',{control:'mine'});
  assert.deepEqual(at.rows,['taken','givenBack','taken']);
 } finally { for(const viewer of held) await viewer.close(); await at.close(); }
});

test('a person already watching when a failed give-back frees the Screen may take control, which forces the lease back',async()=>{
 const held=Object.assign([],{failing:true});
 const at=await streams({engine:failingRelease(held)});
 try {
  const first=at.open(), second=at.open();
  await first.heard('the stream',{stream:'open'}); await second.heard('the stream',{stream:'open'});
  first.send({take:true});
  await second.heard('control with the first',{control:'other',by:'Mona'});
  const after=second.said.length;
  first.ws.close();
  await second.heard('the Screen with its Agent again',{control:'agent'},after);
  second.send({take:true});
  await second.heard('control taken',{control:'mine'});
  assert.equal(at.lease(),'human');
 } finally { held.failing=false; for(const viewer of held) await viewer.close(); await at.close(); }
});

// #752: a page whose connection drops opens a new socket within seconds, while the server finds the old one dead only on
// its heartbeat. Here the old socket stays open on the server, as a dead one does until then.
test('a person who reconnects while their old socket still holds control has it on the new socket, with no log row',async()=>{
 const at=await streams();
 try {
  const old=at.open();
  await old.heard('the stream',{stream:'open'});
  old.send({take:true});
  await old.heard('control taken',{control:'mine'});
  const before=old.said.length;
  const back=at.open('mona',{resume:true});
  await back.heard('control on the new socket',{control:'mine'});
  await back.heard('the stream',{stream:'open'});
  await old.heard('the old socket watching',{control:'other',by:'Mona'},before);
  assert.equal(at.lease(),'human');
  // The heartbeat ends the old socket: control stays with the new one.
  old.ws.terminate();
  await old.closed();
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(at.lease(),'human');
  assert.ok(!back.said.some(message=>message.control&&message.control!=='mine'),'the new socket keeps control');
  back.send({giveBack:true});
  await back.heard('given back',{given:true});
  assert.equal(at.lease(),'agent');
  assert.deepEqual(at.rows,['taken','givenBack']);
 } finally { await at.close(); }
});

test('control moves between one person\'s sockets on their take, never to another person\'s, and a new view takes nothing on arrival',async()=>{
 const at=await streams();
 try {
  const first=at.open();
  await first.heard('the stream',{stream:'open'});
  first.send({take:true});
  await first.heard('control taken',{control:'mine'});
  const someone=at.open('omar');
  await someone.heard('control with Mona',{control:'other',by:'Mona'});
  someone.send({take:true});
  await someone.heard('the take refused',{refused:'held',by:'Mona'});
  const second=at.open();
  await second.heard('a new view watching',{control:'other',by:'Mona'});
  second.send({take:true});
  await second.heard('control on the second socket',{control:'mine'});
  const before=second.said.length;
  first.send({take:true});
  await first.heard('control back on the first',{control:'mine'},1);
  await second.heard('the second watching',{control:'other',by:'Mona'},before);
  assert.equal(at.lease(),'human');
  assert.deepEqual(at.rows,['taken']);
 } finally { await at.close(); }
});

test('the old socket ending while control moves to the new one leaves it with the new one',async()=>{
 const at=await streams();
 try {
  const old=at.open();
  await old.heard('the stream',{stream:'open'});
  old.send({take:true});
  await old.heard('control taken',{control:'mine'});
  // Both at once: the heartbeat ends the old socket as the page's new one arrives asking for control back.
  const back=at.open('mona',{resume:true});
  old.ws.terminate();
  await old.closed();
  await back.heard('the stream',{stream:'open'});
  await new Promise(resolve=>setTimeout(resolve,200));
  const last=back.said.filter(message=>message.control).at(-1);
  if(last?.control==='mine') { assert.equal(at.lease(),'human'); assert.deepEqual(at.rows,['taken']); }
  else { assert.equal(last?.control,'agent'); assert.equal(at.lease(),'agent'); assert.deepEqual(at.rows,['taken','givenBack']); }
 } finally { await at.close(); }
});

test('an open socket is checked again: a person who no longer sees the Agent is closed, and control goes back',async()=>{
 const at=await streams({recheck:50});
 try {
  const live=at.open();
  await live.heard('the stream',{stream:'open'});
  live.send({take:true});
  await live.heard('control taken',{control:'mine'});
  at.may.level='none';
  assert.equal(await live.closed(),4404);
  await until('the lease back with the Agent',()=>at.lease()==='agent');
  await until('the give-back logged',()=>at.rows.includes('givenBack'));
 } finally { await at.close(); }
});

test('a person made a Viewer while in control gives it back on the next check, and keeps watching',async()=>{
 const at=await streams({recheck:50});
 try {
  const live=at.open();
  await live.heard('the stream',{stream:'open'});
  live.send({take:true});
  await live.heard('control taken',{control:'mine'});
  const after=live.said.length;
  at.may.level='watch';
  await live.heard('control back with the Agent',{control:'agent'},after);
  await live.heard('why',{refused:'notAllowed'},after);
  assert.equal(at.lease(),'agent');
  assert.equal(live.ws.readyState,WebSocket.OPEN,'watching goes on');
  assert.deepEqual(at.rows,['taken','givenBack']);
 } finally { await at.close(); }
});

test('a take asks again: a person made a Viewer since the socket opened is refused, and one no longer shown the Agent is closed',async()=>{
 const at=await streams();
 try {
  const live=at.open();
  await live.heard('the stream',{stream:'open'});
  at.may.level='watch';
  live.send({take:true});
  await live.heard('the take refused',{refused:'notAllowed'});
  assert.equal(at.lease(),'agent');
  at.may.level='none';
  live.send({take:true});
  assert.equal(await live.closed(),4404);
  assert.deepEqual(at.rows,[]);
 } finally { await at.close(); }
});

test('an open socket whose session has run out is closed for the page to sign in again',async()=>{
 const at=await streams({recheck:50});
 try {
  const live=at.open();
  await live.heard('the stream',{stream:'open'});
  at.may.level='signedOut';
  assert.equal(await live.closed(),4401);
 } finally { await at.close(); }
});

test('the web server takes the Screen\'s upgrade, leaves others to Next in development, and ends any other in production',()=>{
 const taken=[];
 const socket=()=>Object.assign(new Duplex({read(){},write(_chunk,_encoding,done){ done(); }}),{});
 const asked=path=>new URL(path,'http://gtmworks'), request=/** @type {any} */({});
 for(const dev of [true,false]) {
  const route=screenUpgrades({dev,screen:(_request,_socket,_head,query)=>{ taken.push([dev,query.get('agent')]); }});
  const screen=socket(), other=socket();
  route(asked(`${screenStreamPath}?agent=a`),request,screen,Buffer.alloc(0));
  route(asked('/_next/webpack-hmr'),request,other,Buffer.alloc(0));
  assert.equal(screen.destroyed,false);
  assert.equal(other.destroyed,!dev,dev?'hot reload is Next\'s':'nothing else upgrades');
 }
 assert.deepEqual(taken,[[true,'a'],[false,'a']]);
});
