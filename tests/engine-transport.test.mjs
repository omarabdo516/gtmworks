import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fakeHermes } from './fake-hermes.mjs';
import { callLimit, engineRequest, EngineFailure, forgetListeners, listenerHealth } from '../lib/engine/transport.mjs';
import { hermesEngine } from '../lib/engine/contract.mjs';
import { engineOf, enginePass } from '../lib/company-engine.mjs';

// The one transport to an Engine (ADR 0031, #781), driven against the Hermes wire fake as the driver drives it.
beforeEach(()=>forgetListeners());
const connection=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const failureOf=async call=>{ try { await call; } catch(error) { return error; } assert.fail('the call answered'); };
// A listener of our own that can stop and start again on the same port, counting the connections it took.
async function listener() {
 const state={connections:0};
 const server=createServer((request,response)=>{ state.connections++; response.end('{}'); });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=/** @type {any} */(server.address()).port;
 return {state,address:`http://127.0.0.1:${port}`,
  stop:()=>new Promise(resolve=>{ server.closeAllConnections(); server.close(resolve); }),
  start:()=>new Promise(resolve=>server.listen(port,'127.0.0.1',resolve))};
}

test('with twenty calls started at once, one listener never has more than the limit open', async()=>{
 const fake=await fakeHermes();
 try {
  fake.settings.answerDelay=80;
  const engine=hermesEngine(connection(fake));
  const reads=await Promise.all(Array.from({length:20},(_,at)=>engine.read(`run_missing_${at}`)));
  assert.equal(reads.length,20);
  assert.ok(fake.settings.openAtMost<=callLimit,`at most ${callLimit} open at once, saw ${fake.settings.openAtMost}`);
  assert.ok(fake.settings.openAtMost>1,'calls still run side by side');
  assert.equal(fake.settings.requests.length,20,'every call is made, in its turn');
 } finally { await fake.close(); }
});

test('a listener that timed out is slow and asked one call at a time by every caller, and one answer restores it', async()=>{
 const fake=await fakeHermes();
 const warned=mock.method(console,'warn',()=>{}); const told=mock.method(console,'info',()=>{});
 try {
  fake.settings.answerDelay=300;
  const late=await failureOf(engineRequest(connection(fake),{path:'/health',deadline:50}));
  assert.ok(late instanceof EngineFailure);
  assert.equal(late.cause,'timedOut');
  assert.equal(late.sent,true,'a request that timed out may have reached the Engine');
  const again=await failureOf(engineRequest(connection(fake),{path:'/health',deadline:50}));
  assert.equal(again.cause,'timedOut');
  assert.deepEqual(listenerHealth(connection(fake),'api'),{state:'slow',cause:'timedOut'});
  assert.equal(warned.mock.callCount(),1,'one log line for the change, none for the same state again');
  assert.match(String(warned.mock.calls[0].arguments[0]),/is slow \(timedOut\)/);
  // Slow: the calls of every caller go one at a time.
  await new Promise(resolve=>setTimeout(resolve,400));
  fake.settings.answerDelay=60;
  const calls=Array.from({length:4},()=>engineRequest(connection(fake),{path:'/health',deadline:2000}));
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(fake.settings.openNow,1,'one call at a time while it is slow');
  const answers=await Promise.all(calls);
  assert.ok(answers.every(answer=>answer.ok));
  assert.deepEqual(listenerHealth(connection(fake),'api'),{state:'answering',cause:null});
  assert.equal(told.mock.callCount(),1);
  // Answering again: side by side once more.
  fake.settings.openAtMost=0;
  await Promise.all(Array.from({length:4},()=>engineRequest(connection(fake),{path:'/health',deadline:2000})));
  assert.ok(fake.settings.openAtMost>1);
 } finally { warned.mock.restore(); told.mock.restore(); await fake.close(); }
});

test('a listener nothing connects to is down, asked one call at a time by every caller, and back the moment it answers', async()=>{
 const engine=await listener();
 const warned=mock.method(console,'warn',()=>{}); const told=mock.method(console,'info',()=>{});
 try {
  const at={address:engine.address,key:'k',profile:'default'};
  await engine.stop();
  const refused=await failureOf(engineRequest(at,{path:'/health'}));
  assert.equal(refused.cause,'refused');
  assert.equal(refused.sent,false,'nothing connected, so nothing reached the Engine');
  assert.deepEqual(listenerHealth(at,'api'),{state:'down',cause:'refused'});
  assert.deepEqual(await hermesEngine(at).start({conversation:'c',input:'hi',idempotencyKey:'i'}),{state:'notReached'},'a Run start nothing connected to is not reached (#413)');
  assert.equal(warned.mock.callCount(),1,'one log line for the change, none for the same state again');
  assert.match(String(warned.mock.calls[0].arguments[0]),/is down \(refused\)/);
  // It comes back: the very next call reaches it, with no wait held over from the outage, and restores it.
  await engine.start();
  const answered=await engineRequest(at,{path:'/health'});
  assert.equal(answered.status,200);
  assert.equal(engine.state.connections,1);
  assert.deepEqual(listenerHealth(at,'api'),{state:'answering',cause:null});
  assert.equal(told.mock.callCount(),1);
 } finally { warned.mock.restore(); told.mock.restore(); await engine.stop(); }
 // An address gtmworks never calls is refused before anything is sent.
 const outside=await failureOf(engineRequest({address:'http://8.8.8.8:8642',key:'k'},{path:'/health'}));
 assert.equal(outside.cause,'notAllowed'); assert.equal(outside.sent,false);
});

test('an outcome that got no answer keeps its cause beside its state, without changing its shape', async()=>{
 const closed=await listener(); const address=closed.address; await closed.stop();
 const quiet=mock.method(console,'warn',()=>{});
 try {
  const read=await hermesEngine({address,key:'k',profile:'default'}).read('run_1');
  assert.equal(read.state,'unreachable');
  const raw=await import('../lib/engine/runs.mjs').then(driver=>driver.readRun({address,key:'k',profile:'default',run:'run_1'}));
  assert.deepEqual(raw,{status:'unreachable',output:null,session:null,usage:null});
  assert.equal(/** @type {any} */(raw).cause,'refused');
 } finally { quiet.mock.restore(); }
});

test('one worker pass reads a Company\'s Engine record once, and the next pass reads it again', async()=>{
 let reads=0;
 const db={from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>{ if(table==='companies') reads++; return {data:null,error:null}; }})})})};
 await enginePass(async()=>{ await engineOf('c1',db); await engineOf('c1',db); await new Promise(resolve=>setTimeout(resolve,10)); await engineOf('c1',db); });
 assert.equal(reads,1);
 await enginePass(async()=>{ await engineOf('c1',db); });
 assert.equal(reads,2);
});

test('no module outside the transport makes a request to an Engine', ()=>{
 // Every request to an Engine goes through lib/engine/transport.mjs: the driver's modules call no fetch and open no
 // socket of their own, and only the transport knows where the two listeners are.
 const files=[];
 const walk=dir=>{ for(const name of readdirSync(dir)) { const path=join(dir,name); if(statSync(path).isDirectory()) { if(name!=='node_modules') walk(path); } else if(/\.(mjs|ts|tsx)$/.test(name)&&!name.endsWith('.d.mts')) files.push(path); } };
 for(const dir of ['app','lib','worker','components']) walk(dir);
 files.push('middleware.ts','instrumentation.ts');
 const offenders=[];
 for(const path of files) {
  if(path===join('lib','engine','transport.mjs')) continue;
  const text=readFileSync(path,'utf8');
  const driver=path.startsWith(join('lib','engine'))||/^lib[/\\]hermes/.test(path);
  if(driver&&/\bfetch\(|new WebSocket\(/.test(text)) offenders.push(`${path}: a request of its own`);
  if(/url\.port\s*=\s*'9119'|\/v1\/runs['`/]|managementRoot\(/.test(text)&&!driver) offenders.push(`${path}: an Engine listener's address`);
 }
 assert.deepEqual(offenders,[]);
});
