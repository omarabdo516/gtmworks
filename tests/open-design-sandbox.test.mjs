import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveAcp, agentOf, promptText, instructionsFor, routeOf, runOnEngine, engineVersion } from '../sandbox/open-design/hermes-engine.mjs';
import { agentPaths, adoptSocket } from '../sandbox/open-design/daemon.mjs';

// Open Design's `hermes` runtime in the work sandbox (#544, ADR 0025): the ACP agent Open Design's daemon speaks to, which
// turns each prompt into one Run on the Agent's design profile over the socket the Engine's ssh session forwarded.
const agent='ag-0123456789abcdef0123456789abcdef';
const cwd=`/work/${agent}/open-design/projects/spring-sale-1a2b`;

/** @param {(message:any)=>void} [onMessage] */
function acp(options={}) {
 const input=new PassThrough(); const output=new PassThrough(); const messages=[];
 let buffer='';
 output.on('data',chunk=>{ buffer+=chunk; let at; while((at=buffer.indexOf('\n'))>=0) { messages.push(JSON.parse(buffer.slice(0,at))); buffer=buffer.slice(at+1); } });
 serveAcp({input,output,...options});
 const send=message=>input.write(`${JSON.stringify({jsonrpc:'2.0',...message})}\n`);
 const answer=async id=>{ for(let waited=0;waited<200;waited++) { const found=messages.find(message=>message.id===id); if(found) return found; await new Promise(resolve=>setTimeout(resolve,5)); } throw new Error(`no answer to ${id}`); };
 return {send,answer,messages};
}

test('a project folder names its Agent, and only a folder right under the work folder does', () => {
 assert.equal(agentOf(cwd),agent);
 assert.equal(agentOf(`/work/${agent}`),agent);
 assert.equal(agentOf('/tmp/x'),null);
 assert.equal(agentOf('/work/../etc'),null);
 assert.equal(agentOf('/workers/ag-1'),null);
});

test('Open Design\'s prompt reaches the Engine as text with its attachments named, and the Run is told its project folder', () => {
 assert.equal(promptText([{type:'text',text:'A poster'},{type:'resource_link',uri:'/work/x/ref.png'},{type:'image'}]),'A poster\n\nAttached file: /work/x/ref.png');
 assert.equal(promptText(null),'');
 assert.match(instructionsFor(cwd),new RegExp(`project folder is ${cwd.replaceAll('/','\\/')}\\. `));
});

test('the ACP handshake answers as Hermes with one model, and a prompt is one Run whose answer comes back as the agent\'s text', async () => {
 const runs=[];
 const {send,answer,messages}=acp({route:()=>({sockets:['/s'],profile:`od-${agent}`,key:'k'.repeat(43)}),
  run:async(route,turn)=>{ runs.push({route,turn}); return 'Made index.html.'; }});
 send({id:1,method:'initialize',params:{protocolVersion:1,clientCapabilities:{terminal:false}}});
 assert.deepEqual((await answer(1)).result.agentInfo,{name:'hermes',version:engineVersion});
 send({id:2,method:'session/new',params:{cwd,mcpServers:[]}});
 const session=(await answer(2)).result;
 assert.deepEqual(session.models.availableModels.map(model=>model.modelId),['default']);
 send({id:3,method:'session/set_model',params:{sessionId:session.sessionId,modelId:'default'}});
 assert.deepEqual((await answer(3)).result,{});
 send({id:4,method:'session/prompt',params:{sessionId:session.sessionId,prompt:[{type:'text',text:'A poster for the spring sale'}]}});
 assert.deepEqual((await answer(4)).result,{stopReason:'end_turn'});
 assert.equal(runs.length,1);
 assert.equal(runs[0].turn.input,'A poster for the spring sale');
 assert.equal(runs[0].turn.cwd,cwd);
 assert.equal(runs[0].route.profile,`od-${agent}`);
 const update=messages.find(message=>message.method==='session/update');
 assert.deepEqual(update.params.update,{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Made index.html.'}});
 send({id:5,method:'session/unknown',params:{}});
 assert.equal((await answer(5)).error.code,-32601);
});

test('with no route to the Engine, or a Run that fails, the prompt fails with words a person can act on', async () => {
 const none=acp({route:()=>null,run:async()=>'never'});
 none.send({id:1,method:'session/new',params:{cwd}});
 const {sessionId}=(await none.answer(1)).result;
 none.send({id:2,method:'session/prompt',params:{sessionId,prompt:[{type:'text',text:'x'}]}});
 assert.match((await none.answer(2)).error.message,/not connected to the Company's Engine/);
 const failing=acp({route:()=>({sockets:[],profile:'p',key:'k'.repeat(43)}),run:async()=>{ throw new Error('The design Run failed.'); }});
 failing.send({id:1,method:'session/new',params:{cwd}});
 const second=(await failing.answer(1)).result.sessionId;
 failing.send({id:2,method:'session/prompt',params:{sessionId:second,prompt:[{type:'text',text:'x'}]}});
 assert.equal((await failing.answer(2)).error.message,'The design Run failed.');
});

test('a cancel stops the Run and the prompt ends cancelled', async () => {
 const {send,answer}=acp({route:()=>({sockets:[],profile:'p',key:'k'.repeat(43)}),
  run:(route,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled'))))});
 send({id:1,method:'session/new',params:{cwd}});
 const {sessionId}=(await answer(1)).result;
 send({id:2,method:'session/prompt',params:{sessionId,prompt:[{type:'text',text:'x'}]}});
 send({method:'session/cancel',params:{sessionId}});
 assert.deepEqual((await answer(2)).result,{stopReason:'cancelled'});
});

test('the Run goes to the design profile with its key over the newest socket that answers, and a stale one is dropped', async () => {
 const home=mkdtempSync(join(tmpdir(),'od-home-'));
 mkdirSync(`${home}/.gtmworks/open-design`,{recursive:true});
 const key='k'.repeat(43);
 writeFileSync(`${home}/.gtmworks/open-design/${agent}.json`,JSON.stringify({profile:`od-${agent}`,key}));
 // The newer socket is stale: a file no server listens on. The older one is the Engine.
 const older=`${home}/.gtmworks/engine-${agent}-000000000000001-1.sock`;
 const stale=`${home}/.gtmworks/engine-${agent}-000000000000002-2.sock`;
 writeFileSync(stale,'');
 const seen=[];
 let reads=0;
 const engine=createServer((request,response)=>{
  let body=''; request.on('data',chunk=>{ body+=chunk; }); request.on('end',()=>{
   seen.push({method:request.method,url:request.url,authorization:request.headers.authorization,body:body?JSON.parse(body):null});
   response.setHeader('Content-Type','application/json');
   if(request.method==='POST'&&request.url===`/p/od-${agent}/v1/runs`) { response.statusCode=202; return response.end(JSON.stringify({run_id:'run-1'})); }
   if(request.method==='POST') return response.end(JSON.stringify({ok:true}));
   reads++;
   response.end(JSON.stringify(reads===1?{status:'waiting_for_approval',approval:{request_id:'req-1'}}:{status:'completed',output:'Made index.html.'}));
  });
 });
 await new Promise(resolve=>engine.listen(older,resolve));
 try {
  const route=routeOf(agent,home);
  assert.deepEqual(route?.sockets,[stale,older],'newest first');
  const text=await runOnEngine(route,{input:'A poster',cwd,signal:new AbortController().signal});
  assert.equal(text,'Made index.html.');
  assert.equal(existsSync(stale),false,'the stale socket is removed');
  assert.ok(seen.every(call=>call.authorization===`Bearer ${key}`));
  assert.equal(seen[0].body.input,'A poster');
  assert.match(seen[0].body.instructions,/project folder is/);
  assert.deepEqual(seen.find(call=>call.url.endsWith('/approval'))?.body,{choice:'once',request_id:'req-1'});
 } finally { engine.close(); }
 assert.equal(routeOf('ag-ffffffffffffffffffffffffffffffff',home),null,'an Agent with no route has none');
});

test('the daemon keeps an Agent\'s files in its own folder and its route in the work user\'s home', () => {
 const paths=agentPaths(`/work/${agent}`,'/home/pn');
 assert.deepEqual(paths,{agent,data:`/work/${agent}/open-design`,route:`/home/pn/.gtmworks/open-design/${agent}.json`,port:`/home/pn/.gtmworks/open-design/${agent}.port`,
  lock:`/home/pn/.gtmworks/open-design/${agent}.lock`,log:`/home/pn/.gtmworks/open-design/${agent}.log`,socket:`/home/pn/.gtmworks/engine-${agent}.sock`});
 assert.equal(agentPaths(`/work/${agent}/sub`,'/home/pn'),null);
 assert.equal(agentPaths('/tmp','/home/pn'),null);
});

test('the socket a session forwarded is moved to a name of its own, and nothing is made when there is none', () => {
 const home=mkdtempSync(join(tmpdir(),'od-sock-'));
 const socket=`${home}/engine-${agent}.sock`;
 assert.equal(adoptSocket(socket,1,7),null);
 writeFileSync(socket,'');
 const kept=adoptSocket(socket,1795289438020,27);
 assert.equal(kept,`${home}/engine-${agent}-001795289438020-27.sock`);
 assert.equal(existsSync(socket),false);
 assert.ok(statSync(kept).isFile());
 assert.deepEqual(readdirSync(home),[`engine-${agent}-001795289438020-27.sock`]);
});

// An Engine that answers with errors: each answer that is not a Run record counts against the outage, measured in time,
// and a refused key ends the design at once.
async function engineAnswering(answer) {
 const home=mkdtempSync(join(tmpdir(),'od-err-'));
 const socket=`${home}/engine.sock`;
 const seen=[];
 const engine=createServer((request,response)=>{
  seen.push(`${request.method} ${request.url}`);
  response.setHeader('Content-Type','application/json');
  if(request.method==='POST'&&request.url.endsWith('/v1/runs')) { response.statusCode=202; return response.end(JSON.stringify({run_id:'run-9'})); }
  const answered=answer(request);
  if(!answered) return; // held: never answered
  const [status,body]=answered;
  response.statusCode=status; response.end(JSON.stringify(body));
 });
 await new Promise(resolve=>engine.listen(socket,resolve));
 return {route:{sockets:[socket],profile:`od-${agent}`,key:'k'.repeat(43)},seen,close:()=>{ engine.closeAllConnections(); engine.close(); }};
}

test('an Engine that keeps answering errors gives the design up after the outage, and a refused key at once', async () => {
 const failing=await engineAnswering(()=>[503,{error:{message:'busy'}}]);
 try {
  const started=Date.now();
  await assert.rejects(runOnEngine(failing.route,{input:'x',cwd,signal:new AbortController().signal,outage:300,pace:20}),/lost the Company's Engine/);
  assert.ok(Date.now()-started<3000,'within the outage, not for ever');
  assert.ok(failing.seen.filter(line=>line.startsWith('GET')).length>=3);
 } finally { failing.close(); }
 const refused=await engineAnswering(()=>[401,{error:{code:'gateway_auth_failed'}}]);
 try {
  await assert.rejects(runOnEngine(refused.route,{input:'x',cwd,signal:new AbortController().signal,outage:60000,pace:20}),/refused Open Design's key/);
 } finally { refused.close(); }
});

test('closing the runtime\'s input stops the Run still going on the Engine', async () => {
 const engine=await engineAnswering(()=>[200,{status:'running'}]);
 try {
  const input=new PassThrough(); const output=new PassThrough();
  const served=serveAcp({input,output,route:()=>engine.route,run:(route,turn)=>runOnEngine(route,{...turn,pace:20})});
  input.write(`${JSON.stringify({jsonrpc:'2.0',id:1,method:'session/new',params:{cwd}})}\n`);
  await new Promise(resolve=>setTimeout(resolve,50));
  const sessionId=JSON.parse(String(output.read()).split('\n')[0]).result.sessionId;
  input.write(`${JSON.stringify({jsonrpc:'2.0',id:2,method:'session/prompt',params:{sessionId,prompt:[{type:'text',text:'x'}]}})}\n`);
  await new Promise(resolve=>setTimeout(resolve,150));
  input.end();
  await served.drained();
  assert.ok(engine.seen.includes('POST /p/od-ag-0123456789abcdef0123456789abcdef/v1/runs/run-9/stop'),engine.seen.join('\n'));
 } finally { engine.close(); }
});

test('a start lock is never taken from a live holder, and one left by a holder that is gone is broken', async () => {
 const { locked } = await import('../sandbox/open-design/daemon.mjs');
 const home=mkdtempSync(join(tmpdir(),'od-lock-'));
 const lock=`${home}/agent.lock`;
 // A live holder (this process): the second caller waits until the first is done.
 const order=[];
 const first=locked(lock,async()=>{ order.push('first in'); await new Promise(resolve=>setTimeout(resolve,700)); order.push('first out'); return 'a'; });
 await new Promise(resolve=>setTimeout(resolve,50));
 const second=locked(lock,async()=>{ order.push('second'); return 'b'; });
 assert.deepEqual(await Promise.all([first,second]),['a','b']);
 assert.deepEqual(order,['first in','first out','second']);
 // A holder that is gone: its lock is broken at once.
 writeFileSync(lock,'999999999\n');
 assert.equal(await locked(lock,async()=>'c'),'c');
 assert.equal(existsSync(lock),false);
});

test('a cancel interrupts a read the Engine holds, and the stop goes out at once', async () => {
 const held=await engineAnswering(request=>request.method==='GET'?null:[200,{ok:true}]);
 try {
  const abort=new AbortController();
  const running=runOnEngine(held.route,{input:'x',cwd,signal:abort.signal,pace:20});
  await new Promise(resolve=>setTimeout(resolve,200));
  const asked=Date.now();
  abort.abort();
  await assert.rejects(running,/cancelled/);
  assert.ok(Date.now()-asked<3000,'not after the read\'s own time limit');
  assert.ok(held.seen.some(line=>line.endsWith('/run-9/stop')),held.seen.join('\n'));
 } finally { held.close(); }
});

test('a cancel while the Run is still starting stops it as soon as the Engine names it', async () => {
 const home=mkdtempSync(join(tmpdir(),'od-start-'));
 const socket=`${home}/engine.sock`;
 const seen=[];
 const engine=createServer((request,response)=>{
  seen.push(`${request.method} ${request.url}`);
  response.setHeader('Content-Type','application/json');
  if(request.method==='POST'&&request.url.endsWith('/v1/runs')) { setTimeout(()=>{ response.statusCode=202; response.end(JSON.stringify({run_id:'run-slow'})); },300); return; }
  response.end(JSON.stringify({ok:true}));
 });
 await new Promise(resolve=>engine.listen(socket,resolve));
 try {
  const abort=new AbortController();
  const running=runOnEngine({sockets:[socket],profile:`od-${agent}`,key:'k'.repeat(43)},{input:'x',cwd,signal:abort.signal,pace:20});
  await new Promise(resolve=>setTimeout(resolve,50));
  abort.abort();
  await assert.rejects(running,/cancelled/);
  assert.ok(seen.some(line=>line.endsWith('/run-slow/stop')),seen.join('\n'));
  assert.ok(!seen.some(line=>line.startsWith('GET')),'no read after the cancel');
 } finally { engine.closeAllConnections(); engine.close(); }
});

test('a cancel interrupts an approval the Engine holds, and the stop goes out at once', async () => {
 const held=await engineAnswering(request=>request.url.endsWith('/approval')?null:request.method==='GET'?[200,{status:'waiting_for_approval',approval:{request_id:'req-9'}}]:[200,{ok:true}]);
 try {
  const abort=new AbortController();
  const running=runOnEngine(held.route,{input:'x',cwd,signal:abort.signal,pace:20});
  await new Promise(resolve=>setTimeout(resolve,200));
  const asked=Date.now();
  abort.abort();
  await assert.rejects(running,/cancelled/);
  assert.ok(Date.now()-asked<3000,'not after the approval\'s own time limit');
  assert.ok(held.seen.some(line=>line.endsWith('/run-9/stop')),held.seen.join('\n'));
 } finally { held.close(); }
});

// A daemon that never answered is stopped whole before its start lock goes (#634): the start waits for its process group
// to exit, for a bounded time, and kills what is left, so the next start never races it for the port.
test('a stopped daemon\'s whole process group is gone before the stop returns, killed when it ignores the request', async () => {
 const { spawn } = await import('node:child_process');
 const { stopGroup } = await import('../sandbox/open-design/daemon.mjs');
 const groupGone=pid=>{ try { process.kill(-pid,0); return false; } catch { return true; } };
 // A daemon and a child of its own that both ignore SIGTERM: only the kill after the wait ends them.
 const stubborn=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); require('child_process').spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)\"],{stdio:'ignore'}); setInterval(()=>{},1000)"],{detached:true,stdio:'ignore'});
 const willing=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
 const leftover=()=>{ for(const child of [stubborn,willing]) { try { process.kill(-child.pid,'SIGKILL'); } catch {} } };
 try {
  await new Promise(resolve=>setTimeout(resolve,300));
  const started=Date.now();
  await stopGroup(stubborn,{grace:400});
  assert.ok(groupGone(stubborn.pid),'nothing of the group is left');
  assert.ok(Date.now()-started>=400,'the kill waits out the grace first');
  // A daemon that exits when asked ends the wait at once.
  const asked=Date.now();
  await stopGroup(willing,{grace:5000});
  assert.ok(groupGone(willing.pid));
  assert.ok(Date.now()-asked<3000,'not the whole grace');
 } finally { leftover(); }
});

// A read never outlasts what is left of the outage (#634): with less than a second left, the read's own limit is what is left.
test('a read the Engine holds is given up when the outage runs out, not a second later', async () => {
 const held=await engineAnswering(request=>request.method==='GET'?null:[200,{ok:true}]);
 try {
  const started=Date.now();
  await assert.rejects(runOnEngine(held.route,{input:'x',cwd,signal:new AbortController().signal,outage:150,pace:20}),/lost the Company's Engine/);
  assert.ok(Date.now()-started<900,`gave up after ${Date.now()-started} ms`);
 } finally { held.close(); }
});
