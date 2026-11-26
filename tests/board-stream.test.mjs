import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { engineServing } from './engine-records.mjs';
import { boardStreams, boardStreamPath } from '../lib/board-stream.mjs';

// #840 (spec #831), ADR 0029's shape: an open board follows its Company's Engine's Kanban event stream, which gtmworks's
// own web server relays; no browser reaches the Engine. The person is the relay's `people` seam (in the app, the session
// cookie and the database): who they are when the socket opens, and whether they are still a Member now.
const rs='10000000-0000-0000-0000-000000000001', aleem='10000000-0000-0000-0000-000000000002';
const until=async(what,ready,ms=5000)=>{
 const end=Date.now()+ms;
 for(;;) { const found=ready(); if(found) return found; if(Date.now()>end) throw new Error(`${what} within ${ms}ms`); await new Promise(resolve=>setTimeout(resolve,20)); }
};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function relay({fresh=0,recheck=60000,again=[100]}={}) {
 const engines={[rs]:await engineServing(rs),[aleem]:await engineServing(aleem)};
 // Each person's standing: a Member until a test says otherwise.
 const standing=new Map();
 const people={
  admit:async(_request,query)=>({company:query.get('company'),person:query.get('as')??'mona'}),
  access:async at=>standing.get(at.person)??'member',
 };
 const handle=boardStreams({people,fresh,recheck,again});
 const server=createServer();
 server.on('upgrade',(request,socket,head)=>{ void handle(request,socket,head,new URL(request.url??'/','http://gtmworks').searchParams); });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(undefined)));
 const sockets=[];
 const open=(company=rs,as='mona')=>{
  const ws=new WebSocket(`ws://127.0.0.1:${/** @type {any} */(server.address()).port}${boardStreamPath}?company=${company}&as=${as}`);
  sockets.push(ws);
  const said=[], raw=[]; let code=null;
  ws.on('message',data=>{ raw.push(String(data)); said.push(JSON.parse(String(data))); });
  ws.on('close',closed=>{ code=closed; });
  const heard=(what,match,after=0)=>until(what,()=>said.slice(after).find(match));
  return {ws,said,raw,heard,code:()=>code,closed:()=>until('the socket closed',()=>code)};
 };
 const changed=id=>message=>Array.isArray(message.changed)&&message.changed.includes(id);
 return {engines,standing,open,changed,close:async()=>{ for(const ws of sockets) ws.terminate(); server.close(); await Promise.all(Object.values(engines).map(fake=>fake.close())); }};
}

test('a Card moved or commented on the Engine reaches every open board of the Company within a second, through one stream of the Engine\'s',async()=>{
 const at=await relay();
 try {
  const kanban=at.engines[rs].settings.kanban;
  const card=kanban.task({title:'December ad copy',status:'ready',assignee:'ads'});
  const mona=at.open(), omar=at.open(rs,'omar');
  await mona.heard('the stream open',message=>message.stream==='open');
  await omar.heard('the stream open',message=>message.stream==='open');
  assert.equal(at.engines[rs].settings.kanbanStreams,1,'one stream of the Engine\'s carries every open board of the Company');
  const moved=Date.now();
  kanban.move(card.id,'running');
  await mona.heard('the move',at.changed(card.id));
  await omar.heard('the move',at.changed(card.id));
  assert.ok(Date.now()-moved<1000,`the move arrived ${Date.now()-moved}ms after it was made`);
  kanban.comment(card.id,'Omar Abdo','Use the new price.');
  await mona.heard('the comment',message=>at.changed(card.id)(message)&&mona.said.filter(at.changed(card.id)).length===2);
  // The browser is told which Cards changed and nothing else: no Engine address, key, ticket or event payload.
  const fake=at.engines[rs];
  for(const leak of [fake.settings.key,fake.managementAddress,new URL(fake.managementAddress).host,'Omar Abdo','ads','ticket']) assert.ok(!mona.raw.some(frame=>frame.includes(leak)),leak);
  assert.ok(fake.settings.kanbanSockets.every(address=>/[?&]ticket=/.test(address)&&!address.includes(fake.settings.key)),'the Engine\'s stream opens with a one-use ticket, never the key in its address');
  // The last board to close ends the Engine's stream.
  mona.ws.close(); omar.ws.close();
  await until('the Engine\'s stream ended',()=>fake.settings.kanbanStreams===0);
 } finally { await at.close(); }
});

test('a board of Company A is never sent a change of Company B',async()=>{
 const at=await relay();
 try {
  const mine=at.open(rs), theirs=at.open(aleem);
  await mine.heard('A\'s stream open',message=>message.stream==='open');
  await theirs.heard('B\'s stream open',message=>message.stream==='open');
  const b=at.engines[aleem].settings.kanban.task({title:'Aleem’s own launch plan',status:'ready'});
  await theirs.heard('B\'s Card',at.changed(b.id));
  const a=at.engines[rs].settings.kanban.task({title:'Weekly report',status:'ready'});
  await mine.heard('A\'s Card',at.changed(a.id));
  assert.ok(!mine.raw.some(frame=>frame.includes(b.id)),'A heard nothing of B');
  assert.ok(!theirs.raw.some(frame=>frame.includes(a.id)),'B heard nothing of A');
 } finally { await at.close(); }
});

test('with the Engine\'s stream cut an open board is told it is down, and when it returns it is told so and follows again',async()=>{
 const at=await relay();
 try {
  const fake=at.engines[rs];
  const board=at.open();
  await board.heard('the stream open',message=>message.stream==='open');
  fake.settings.kanbanStreamDown=true;
  const down=board.said.length;
  await board.heard('the stream down',message=>message.stream==='down',down);
  const missed=fake.settings.kanban.task({title:'Made while the stream was down',status:'ready'});
  await pause(400);
  fake.settings.kanbanStreamDown=false;
  const back=board.said.length;
  await board.heard('the stream open again',message=>message.stream==='open',back);
  assert.equal(board.code(),null,'the board\'s own socket stayed open throughout');
  assert.ok(!board.said.some(at.changed(missed.id)),'a change made while it was down is the board\'s own read to find');
  const after=fake.settings.kanban.task({title:'Made after it came back',status:'ready'});
  await board.heard('the change after it came back',at.changed(after.id));
 } finally { await at.close(); }
});

test('a person whose membership ended is closed before the next change reaches them, and one whose session ran out is told to sign in again',async()=>{
 const at=await relay({recheck:200});
 try {
  const kanban=at.engines[rs].settings.kanban;
  const mona=at.open(), omar=at.open(rs,'omar'), sara=at.open(rs,'sara');
  for(const board of [mona,omar,sara]) await board.heard('the stream open',message=>message.stream==='open');
  at.standing.set('mona','none');
  const card=kanban.task({title:'After Mona left',status:'ready'});
  await omar.heard('the change',at.changed(card.id));
  assert.equal(await mona.closed(),4404);
  assert.ok(!mona.said.some(at.changed(card.id)),'no change reached a person no longer a Member');
  // With no change at all, the periodic check closes them too.
  at.standing.set('sara','signedOut');
  assert.equal(await sara.closed(),4401);
  assert.equal(omar.code(),null);
 } finally { await at.close(); }
});
