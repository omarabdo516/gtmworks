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

// A listener of our own that answers after `delay`, noting when each request arrived.
async function slowListener() {
 const state={delay:0,arrivals:/** @type {number[]} */([])};
 const server=createServer((request,response)=>{ state.arrivals.push(Date.now()); setTimeout(()=>{ if(!response.destroyed) response.end('{}'); },state.delay); });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {state,address:`http://127.0.0.1:${/** @type {any} */(server.address()).port}`,close:()=>new Promise(resolve=>{ server.closeAllConnections(); server.close(resolve); })};
}
const stateLines=logged=>logged.mock.calls.map(call=>JSON.parse(String(call.arguments[0]))).filter(line=>line.event==='engine_state').map(({state,cause,listener})=>[state,cause,listener]);

test('a listener that timed out is asked less often by every caller until it answers, and one answer restores it', async()=>{
 const engine=await slowListener();
 const logged=mock.method(console,'log',()=>{});
 try {
  const at={address:engine.address,key:'k'}; const other={address:engine.address,key:'another caller'};
  engine.state.delay=5000;
  const late=await failureOf(engineRequest(at,{path:'/health',deadline:50}));
  const firstFailed=Date.now();
  assert.ok(late instanceof EngineFailure);
  assert.equal(late.cause,'timedOut');
  assert.equal(late.sent,true,'a request that timed out may have reached the Engine');
  assert.deepEqual(listenerHealth(at,'api'),{state:'slow',cause:'timedOut'});
  // Another caller whose deadline ends before the listener may be asked again fails at once, and sends nothing.
  const held=await failureOf(engineRequest(other,{path:'/health',deadline:100}));
  assert.equal(held.cause,'timedOut'); assert.equal(held.sent,false,'the request never left');
  assert.ok(Date.now()-firstFailed<60,'it did not wait out its deadline');
  assert.equal(engine.state.arrivals.length,1);
  // One whose deadline is longer is sent once the wait is over; it times out too, so the wait after it is longer.
  await failureOf(engineRequest(other,{path:'/health',deadline:700}));
  const secondFailed=Date.now();
  assert.equal(engine.state.arrivals.length,2);
  assert.ok(engine.state.arrivals[1]-firstFailed>=240,`asked again after a wait, not at once (${engine.state.arrivals[1]-firstFailed} ms)`);
  // While slow, every caller's calls go one at a time, after the longer wait.
  engine.state.delay=40;
  const calls=Array.from({length:4},(_,n)=>engineRequest(n%2?at:other,{path:'/health',deadline:3000}));
  const answers=await Promise.all(calls);
  assert.ok(answers.every(answer=>answer.ok));
  assert.ok(engine.state.arrivals[2]-secondFailed>=490,`the wait doubled (${engine.state.arrivals[2]-secondFailed} ms)`);
  // One answer restored it: the calls after the first went side by side, and the next call has no wait.
  assert.deepEqual(listenerHealth(at,'api'),{state:'answering',cause:null});
  assert.ok(engine.state.arrivals[5]-engine.state.arrivals[3]<40,'side by side once it answered');
  const before=Date.now(); await engineRequest(at,{path:'/health',deadline:100});
  assert.ok(Date.now()-before<90,'no wait is held over once it answers');
  assert.deepEqual(stateLines(logged),[['slow','timedOut','api'],['up',null,'api']],'one line for each change of state, from the transport alone');
 } finally { logged.mock.restore(); await engine.close(); }
});

test('a call that cannot wait out a slow listener fails at once, even behind a call that waits, and none is sent to time out', async()=>{
 const engine=await slowListener();
 const logged=mock.method(console,'log',()=>{});
 try {
  const at={address:engine.address,key:'k'};
  engine.state.delay=5000;
  await failureOf(engineRequest(at,{path:'/health',deadline:50}));
  engine.state.delay=0;
  // One call waits out the 250 ms, holding the one turn a slow listener gives.
  const waiting=engineRequest(at,{path:'/health',deadline:3000});
  // Another, whose deadline would leave too little for the wire after that wait, does not queue behind it.
  const began=Date.now();
  const short=await failureOf(engineRequest(at,{path:'/health',deadline:400}));
  assert.equal(short.cause,'timedOut'); assert.equal(short.sent,false);
  assert.ok(Date.now()-began<60,`it failed at once (${Date.now()-began} ms)`);
  assert.equal((await waiting).status,200);
  assert.equal(engine.state.arrivals.length,2,'the short call was never sent');
 } finally { logged.mock.restore(); await engine.close(); }
});

test('a Run\'s start and what a person tells a Run are sent at their turn without the slow wait, and a read still waits', async()=>{
 const engine=await slowListener();
 const logged=mock.method(console,'log',()=>{});
 try {
  const at={address:engine.address,key:'k'};
  engine.state.delay=5000;
  await failureOf(engineRequest(at,{path:'/health',deadline:50}));
  engine.state.delay=0;
  // The Run lifecycle holds its claim on the turn while it starts, so a start is never held behind the wait.
  const began=Date.now();
  const started=await hermesEngine({...at,profile:'default'}).start({conversation:'c',input:'hi',idempotencyKey:'i'});
  assert.ok(Date.now()-began<200,`the start went at once (${Date.now()-began} ms)`);
  assert.equal(engine.state.arrivals.length,2,'it reached the Engine');
  assert.notDeepEqual(started,{state:'notReached'});
  // It answered, so the listener answers again and nothing waits.
  assert.deepEqual(listenerHealth(at,'api'),{state:'answering',cause:null});
  // Slow again: a read waits out the wait, as before.
  engine.state.delay=5000;
  await failureOf(engineRequest(at,{path:'/health',deadline:50}));
  engine.state.delay=0;
  const read=Date.now(); await engineRequest(at,{path:'/health',deadline:3000});
  assert.ok(Date.now()-read>=200,`the read waited (${Date.now()-read} ms)`);
 } finally { logged.mock.restore(); await engine.close(); }
});

test('a listener nothing connects to is down, asked one call at a time by every caller, and back the moment it answers', async()=>{
 const engine=await listener();
 const logged=mock.method(console,'log',()=>{});
 try {
  const at={address:engine.address,key:'k',profile:'default'};
  await engine.stop();
  const refused=await failureOf(engineRequest(at,{path:'/health'}));
  assert.equal(refused.cause,'refused');
  assert.equal(refused.sent,false,'nothing connected, so nothing reached the Engine');
  assert.deepEqual(listenerHealth(at,'api'),{state:'down',cause:'refused'});
  assert.deepEqual(await hermesEngine(at).start({conversation:'c',input:'hi',idempotencyKey:'i'}),{state:'notReached'},'a Run start nothing connected to is not reached (#413)');
  assert.deepEqual(stateLines(logged),[['down','refused','api']],'one log line for the change, none for the same state again');
  // It comes back: the very next call reaches it, with no wait held over from the outage, and restores it.
  await engine.start();
  const answered=await engineRequest(at,{path:'/health'});
  assert.equal(answered.status,200);
  assert.equal(engine.state.connections,1);
  assert.deepEqual(listenerHealth(at,'api'),{state:'answering',cause:null});
  assert.deepEqual(stateLines(logged),[['down','refused','api'],['up',null,'api']]);
 } finally { logged.mock.restore(); await engine.stop(); }
 // An address gtmworks never calls is refused before anything is sent.
 const outside=await failureOf(engineRequest({address:'http://8.8.8.8:8642',key:'k'},{path:'/health'}));
 assert.equal(outside.cause,'notAllowed'); assert.equal(outside.sent,false);
});

test('an outcome that got no answer keeps its cause beside its state, without changing its shape', async()=>{
 const closed=await listener(); const address=closed.address; await closed.stop();
 const quiet=mock.method(console,'log',()=>{});
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

test('nothing outside the handle imports the driver', ()=>{
 // The handle (lib/engine/handle.mjs) is the one way in (ADR 0009, #784): the app, the library and the worker import
 // it alone from lib/engine/; a type may be named from a driver module, since it makes no call. The install proof's
 // scripts are the other reader of the driver, as the ADR says.
 const files=[];
 const walk=dir=>{ for(const name of readdirSync(dir)) { const path=join(dir,name); if(statSync(path).isDirectory()) { if(name!=='node_modules') walk(path); } else if(/\.(mjs|ts|tsx|mts)$/.test(name)) files.push(path); } };
 for(const dir of ['app','lib','worker','components']) walk(dir);
 const offenders=[];
 for(const path of files) {
  if(path.startsWith(join('lib','engine')+'/')) continue;
  for(const [line] of readFileSync(path,'utf8').matchAll(/^import (?!type )[^\n]*from '[^']*engine\/(?!handle\.mjs')[a-z-]+\.mjs';$/gm)) offenders.push(`${path}: ${line}`);
 }
 assert.deepEqual(offenders,[]);
});
