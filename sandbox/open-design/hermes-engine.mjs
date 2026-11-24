#!/usr/bin/env node
// Open Design's `hermes` runtime in the work sandbox (#544, ADR 0025): the Company's own Engine draws the design.
//
// Open Design's daemon makes a design by starting an agent CLI and speaking ACP to it over stdio; its Hermes runtime is
// `hermes acp --accept-hooks`, found through HERMES_BIN (Open Design 0.27.1, apps/daemon/src/runtimes/defs/hermes.ts and
// runtimes/executables.ts). This file is that CLI. It holds no model and no provider credential: each prompt becomes one
// Run on the Agent's design profile of the Company's Engine, which answers with the Company's own model access, an API
// key or a subscription sign-in alike, and whose file tools write into this sandbox over the Engine's ssh route.
//
// The Engine is reached through the socket the Engine's own ssh session forwards into this sandbox for the Agent's Open
// Design server (lib/open-design.mjs), with the key of that one design profile; the route is the file open-design-mcp
// wrote for the Agent, found from the project folder the daemon runs in (/work/<agent>/open-design/projects/<id>).
import { createInterface } from 'node:readline';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

export const engineVersion='0.23.0';
const profileName=/^[a-z0-9][a-z0-9_-]{0,63}$/;
// The Agent a project folder belongs to: the folder right under the work folder.
/** @param {string} cwd */
export const agentOf=cwd=>{ const found=/^\/work\/([a-z0-9][a-z0-9_-]{0,63})(?:\/|$)/.exec(cwd); return found?found[1]:null; };
/** @param {string} agent @param {string} [home] */
export const routeFile=(agent,home=homedir())=>`${home}/.gtmworks/open-design/${agent}.json`;

// The Agent's design profile and its key, and the sockets the Engine's ssh sessions forwarded for it, newest first
// (daemon.mjs adoptSocket names each by the time it was taken).
/** @param {string} agent @returns {{sockets:string[],profile:string,key:string}|null} */
export function routeOf(agent,home=homedir()) {
 try {
  const route=JSON.parse(readFileSync(routeFile(agent,home),'utf8'));
  if(!profileName.test(route?.profile)||typeof route?.key!=='string'||!/^[A-Za-z0-9_-]{32,200}$/.test(route.key)) return null;
  const prefix=`engine-${agent}-`;
  const sockets=readdirSync(`${home}/.gtmworks`).filter(name=>name.startsWith(prefix)&&name.endsWith('.sock')).sort().reverse().map(name=>`${home}/.gtmworks/${name}`);
  return {sockets,profile:route.profile,key:route.key};
 } catch { return null; }
}

// One call to the design profile's Run API over a forwarded socket. A socket whose session ended refuses the connection;
// it is removed and the next one is tried.
const gone=new Set(['ECONNREFUSED','ENOENT']);
/** @param {{sockets:string[],profile:string,key:string}} route @param {string} method @param {string} path @param {unknown} [body] @param {number} [timeout] @param {AbortSignal} [signal] */
export async function call(route,method,path,body,timeout=30000,signal) {
 for(;;) {
  const [socket]=route.sockets;
  if(!socket) throw new Error("Open Design cannot reach the Company's Engine now: its connection to this Agent is closed.");
  try { return await callOn(socket,route,method,path,body,timeout,signal); }
  catch(failure) {
   if(!gone.has(/** @type {any} */(failure)?.code)) throw failure;
   rmSync(socket,{force:true});
   route.sockets=route.sockets.slice(1);
  }
 }
}
/** @param {string} socket @param {{profile:string,key:string}} route @param {string} method @param {string} path @param {unknown} body @param {number} timeout @param {AbortSignal} [signal] */
function callOn(socket,route,method,path,body,timeout,signal) {
 return new Promise((resolve,reject)=>{
  const text=body===undefined?null:JSON.stringify(body);
  const sent=request({socketPath:socket,method,path:`/p/${encodeURIComponent(route.profile)}${path}`,timeout,...(signal?{signal}:{}),
   headers:{Authorization:`Bearer ${route.key}`,Host:'engine',...(text?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}:{})}},response=>{
   let data='';
   response.setEncoding('utf8');
   response.on('data',chunk=>{ data+=chunk; if(data.length>4_000_000) response.destroy(new Error('answer too large')); });
   response.on('end',()=>{ let json=null; try { json=JSON.parse(data); } catch { json=null; } resolve({status:response.statusCode??0,json}); });
   response.on('error',reject);
  });
  sent.on('timeout',()=>sent.destroy(new Error('timeout')));
  sent.on('error',reject);
  if(text) sent.write(text);
  sent.end();
 });
}

// What the design profile is told for each Run: where its files go. The request itself is Open Design's prompt.
/** @param {string} cwd */
export const instructionsFor=cwd=>`You are drawing a design for Open Design, in the Company's work sandbox. Its project folder is ${cwd}. `
 +'Write every file the request asks for inside that folder, with absolute paths and your file tools, and keep the entry file at the name the request gives '
 +'(index.html when it names none). When you are done, say in one or two sentences what you made and name its files.';

// The text of Open Design's prompt blocks: the text itself, and each attached file by its path.
/** @param {unknown} blocks */
export function promptText(blocks) {
 if(!Array.isArray(blocks)) return '';
 return blocks.map(block=>block?.type==='text'&&typeof block.text==='string'?block.text
  :block?.type==='resource_link'&&typeof block.uri==='string'?`Attached file: ${block.uri}`:'').filter(Boolean).join('\n\n');
}

const terminal=['completed','failed','cancelled','interrupted'];
// One prompt as one Run on the design profile: started, then read until it ends. A permission the Run asks for is given
// once, as Open Design's own ACP client gives every one (agent-protocol/acp/session.ts replyPermission): nobody watches
// this Run, and the Member who asked for the design asked for its work.
// A read that brings no Run record (no answer, an Engine error, a body that is not a Run) counts against one minute of
// outage, measured in time and reset only by a real record; once no forwarded socket is left, the minute runs out, or the
// Engine refuses the key, the Run is given up in words, never polled for ever.
/** @param {{sockets:string[],profile:string,key:string}} route @param {{input:string,cwd:string,signal:AbortSignal,outage?:number,pace?:number}} turn */
export async function runOnEngine(route,{input,cwd,signal,outage=60000,pace=1000}) {
 // The start is not interrupted by a cancel, so its Run id is known and the Run can be stopped; it takes ten seconds at
 // most, inside the twenty a closing runtime waits.
 const started=await call(route,'POST','/v1/runs',{input,instructions:instructionsFor(cwd)},10000).catch(()=>null);
 const run=started?.json?.run_id;
 if(started&&[401,403].includes(started.status)) throw new Error(refused);
 if(!started||![200,202].includes(started.status)||typeof run!=='string') throw new Error(`The Engine did not start the design (${started?started.status:'no answer'}).`);
 const at=`/v1/runs/${encodeURIComponent(run)}`;
 const stop=async()=>{ await call(route,'POST',`${at}/stop`,undefined,5000).catch(()=>null); throw new Error('cancelled'); };
 if(signal.aborted) return stop();
 let seen=Date.now();
 for(;;) {
  if(signal.aborted) return stop();
  const left=outage-(Date.now()-seen);
  if(left<=0) throw new Error("Open Design lost the Company's Engine while it drew the design.");
  // A cancel interrupts a read still waiting on the Engine, so the stop goes out at once; a read never outlasts what is
  // left of the outage (#634).
  const read=await call(route,'GET',at,undefined,Math.min(left,30000),signal).catch(failure=>{ if(!signal.aborted&&!route.sockets.length) throw failure; return null; });
  if(signal.aborted) return stop();
  if(read&&[401,403].includes(read.status)) throw new Error(refused);
  if(read?.status===404) throw new Error('The Engine no longer knows this design Run.');
  const record=read?.status===200&&typeof read.json?.status==='string'?read.json:null;
  if(record) {
   seen=Date.now();
   if(record.status==='waiting_for_approval'&&typeof record.approval?.request_id==='string')
    await call(route,'POST',`${at}/approval`,{choice:'once',request_id:record.approval.request_id},5000,signal).catch(()=>null);
   if(terminal.includes(record.status)) {
    if(record.status==='completed') return typeof record.output==='string'?record.output:'';
    throw new Error(typeof record.error==='string'&&record.error?record.error:`The design Run ${record.status}.`);
   }
  }
  await sleep(pace,undefined,{signal}).catch(()=>{});
 }
}
const refused="The Company's Engine refused Open Design's key: turn Open Design on again in the Agent's apps.";

// The ACP agent: initialize, session/new, an optional model choice, then each prompt as one Run.
/** @param {{input:NodeJS.ReadableStream,output:NodeJS.WritableStream,run?:typeof runOnEngine,route?:typeof routeOf}} io */
export function serveAcp({input,output,run=runOnEngine,route=routeOf}) {
 const send=message=>output.write(`${JSON.stringify({jsonrpc:'2.0',...message})}\n`);
 /** @type {Map<string,{cwd:string,abort:AbortController|null}>} */
 const sessions=new Map();
 /** @type {Set<Promise<void>>} */
 const pending=new Set();
 const models={availableModels:[{modelId:'default',name:"The Company's model"}],currentModelId:'default'};
 const prompt=async(id,params)=>{
  const session=sessions.get(params?.sessionId);
  if(!session) return send({id,error:{code:-32602,message:'Unknown session'}});
  const agent=agentOf(session.cwd);
  const engine=agent?route(agent):null;
  if(!engine) return send({id,error:{code:-32603,message:"Open Design is not connected to the Company's Engine: turn it on again in the Agent's apps."}});
  const abort=new AbortController();
  session.abort=abort;
  let done=()=>{};
  pending.add(new Promise(resolve=>{ done=resolve; }));
  try {
   const text=await run(engine,{input:promptText(params?.prompt),cwd:session.cwd,signal:abort.signal});
   if(text) send({method:'session/update',params:{sessionId:params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
   send({id,result:{stopReason:'end_turn'}});
  } catch(failure) {
   if(abort.signal.aborted) send({id,result:{stopReason:'cancelled'}});
   else send({id,error:{code:-32603,message:failure instanceof Error?failure.message:'The design Run failed.'}});
  } finally { session.abort=null; done(); }
 };
 const lines=createInterface({input});
 lines.on('line',line=>{
  let message; try { message=JSON.parse(line); } catch { return; }
  const {id,method,params}=message??{};
  if(method==='session/cancel') { sessions.get(params?.sessionId)?.abort?.abort(); return; }
  if(id===undefined||id===null) return;
  if(method==='initialize') return send({id,result:{protocolVersion:typeof params?.protocolVersion==='number'?params.protocolVersion:1,
   agentCapabilities:{loadSession:false,promptCapabilities:{image:false,audio:false,embeddedContext:false}},authMethods:[],agentInfo:{name:'hermes',version:engineVersion}}});
  if(method==='session/new') {
   const cwd=typeof params?.cwd==='string'?params.cwd:'';
   const sessionId=randomUUID();
   sessions.set(sessionId,{cwd,abort:null});
   return send({id,result:{sessionId,models}});
  }
  if(method==='session/set_model'||method==='session/set_config_option') return send({id,result:{}});
  if(method==='session/prompt') return void prompt(id,params);
  send({id,error:{code:-32601,message:'Method not found'}});
 });
 // Open Design cancels a run and then closes stdin: every Run still going is stopped on the Engine, a Run still starting
 // once its start answers, for twenty seconds at most, before the process ends.
 lines.once('close',()=>{ for(const session of sessions.values()) session.abort?.abort(); });
 return {lines,drained:()=>Promise.race([Promise.allSettled([...pending]),sleep(20000)])};
}

if(import.meta.url===`file://${process.argv[1]}`) {
 const [command]=process.argv.slice(2);
 if(command==='--version'||command==='-V') console.log(`Hermes Agent v${engineVersion} (the Company's Engine, through gtmworks)`);
 else if(command==='acp') { const served=serveAcp({input:process.stdin,output:process.stdout}); served.lines.on('close',()=>{ void served.drained().then(()=>process.exit(0)); }); }
 else { console.error('usage: hermes acp | hermes --version'); process.exit(2); }
}
