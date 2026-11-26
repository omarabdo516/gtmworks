import { isIP } from 'node:net';

// The one transport to an Engine (ADR 0031, #781). Every request gtmworks makes to a Company's Engine is made here, and
// this is the only module that knows the Engine's two listeners: the API listener at the Engine record's address (Runs,
// sessions, a profile's capabilities) and the management listener, its dashboard, on port 9119 of the same host unless
// the connection names another address (profiles, config, memory, skills, apps, files, the Screen's socket).
//
// For each call it gives a deadline, holds a limit on calls at once to each listener of each Engine, keeps that
// listener's health (answering, slow, down), asks a slow or down one one call at a time, and fails with an error that keeps its cause:
// - every call has a deadline (`deadline`, in milliseconds; a stream's deadline covers only its answer's head);
// - at most `callLimit` calls are open at once to one listener, and only one while it is slow; the rest wait their turn,
//   inside their own deadline;
// - a listener that timed out is slow, and one nothing could connect to (the connection refused, its name or its
//   network gone) is down: either is asked one call at a time by every caller, each a pause after the last that failed,
//   the pause doubling from `backoffFrom` to `backoffTo` until it answers, so a slow Engine is given room, a stopped one
//   is asked less often, and it gets no burst the moment it starts again. A call waits for its turn inside its own
//   deadline and fails unsent (timedOut) when the deadline ends first; any answer, of any status, restores the listener;
// - a change of a listener's health is logged here, once, with its cause; callers log nothing of it themselves.
//
// A failure is an `EngineFailure`: its `cause` is timedOut, refused, nameNotFound, noNetwork or failed (the network's
// words), or notAllowed for an address gtmworks never calls; `sent` is false only when the request certainly never
// reached the Engine (nothing could connect, its deadline ended while it waited its turn, or the address is refused),
// which a Run's start reads as not reached (#413).

export const callLimit=8;
// An answer gtmworks reads whole is at most this big; a larger one is cut one byte past it, which every reader of the
// driver takes as too large (a run record holds at most a 200,000-character reply, well under it).
export const bodyLimit=4*1024*1024;

export function isHermesAddressAllowed(address) {
 let url;
 try { url=new URL(address); } catch { return false; }
 if(url.protocol==='https:') return true;
 if(url.protocol!=='http:') return false;
 const host=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'');
 if(host==='::1') return true;
 if(isIP(host)===4) {
  const [first,second]=host.split('.').map(Number);
  return first===127||first===10||first===172&&second>=16&&second<=31||first===192&&second===168||first===100&&second>=64&&second<=127;
 }
 if(isIP(host)) return false;
 return !host.includes('.')||['.local','.internal','.ts.net'].some(suffix=>host.endsWith(suffix));
}

/** The root of one listener of the connection's Engine, or '' when it has none gtmworks may call.
 * @param {{address:string,managementAddress?:string}} connection @param {'api'|'management'} listener */
function listenerRoot(connection,listener) {
 let root='';
 if(listener==='api') root=String(connection?.address??'').replace(/\/$/,'');
 else if(connection?.managementAddress) root=connection.managementAddress.replace(/\/$/,'');
 else { try { const url=new URL(connection.address); url.port='9119'; root=url.origin; } catch { root=''; } }
 return root&&isHermesAddressAllowed(root)?root:'';
}
/** Whether both listeners of the connection are ones gtmworks may call. @param {{address:string,managementAddress?:string}} connection */
export const bothListeners=connection=>!!listenerRoot(connection,'api')&&!!listenerRoot(connection,'management');

/** The path of a profile on the API listener. @param {string} profile @param {string} path */
export const onProfile=(profile,path)=>`/p/${encodeURIComponent(profile)}${path}`;

// Why a call got no answer (#772): it timed out, the connection was refused, its name was not found, or the network
// dropped it.
/** @param {unknown} error @returns {'timedOut'|'refused'|'nameNotFound'|'noNetwork'|'failed'} */
export function failureCause(error) {
 if(error instanceof EngineFailure) return error.cause==='notAllowed'?'failed':error.cause;
 const failure=/** @type {{name?:string,code?:string,cause?:{code?:string,name?:string,errors?:{code?:string}[]}}} */ (error??{});
 const code=failure.cause?.code??failure.cause?.errors?.find?.(one=>one?.code)?.code??failure.code;
 if(failure.name==='TimeoutError'||failure.cause?.name==='TimeoutError'||code==='UND_ERR_CONNECT_TIMEOUT'||code==='ETIMEDOUT'||code==='UND_ERR_HEADERS_TIMEOUT') return 'timedOut';
 if(code==='ECONNREFUSED') return 'refused';
 if(code==='ENOTFOUND'||code==='EAI_AGAIN') return 'nameNotFound';
 if(code==='ECONNRESET'||code==='EPIPE'||code==='ENETUNREACH'||code==='EHOSTUNREACH'||code==='UND_ERR_SOCKET') return 'noNetwork';
 return 'failed';
}
const neverConnected=new Set(['ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH']);

export class EngineFailure extends Error {
 /** @param {'timedOut'|'refused'|'nameNotFound'|'noNetwork'|'failed'|'notAllowed'} cause @param {boolean} sent @param {unknown} [error] */
 constructor(cause,sent,error) {
  super(`Engine call failed: ${cause}`,error?{cause:error}:undefined);
  this.name='EngineFailure';
  /** @type {'timedOut'|'refused'|'nameNotFound'|'noNetwork'|'failed'|'notAllowed'} */
  this.cause=cause;
  this.sent=sent;
 }
}

// The cause an outcome of the driver carries beside its state, without changing the state's shape: it is not enumerable,
// so an outcome compared, spread or sent to a browser stays what it was, and a log line can still say why.
/** @template T @param {T} outcome @param {unknown} error @returns {T} */
export function withCause(outcome,error) {
 if(outcome&&typeof outcome==='object'&&!Object.hasOwn(outcome,'cause')) Object.defineProperty(outcome,'cause',{value:failureCause(error),enumerable:false});
 return outcome;
}

/** @typedef {{state:'answering'|'slow'|'down',cause:string|null,open:number,waiting:(()=>void)[],pause:number,next:number}} Listener */
// The pause between calls to a slow or down listener: it doubles after each call that fails, from the first to the most.
export const backoffFrom=250, backoffTo=4000;
/** @type {Map<string,Listener>} */
const listeners=new Map();
/** @param {string} root */
const listenerOf=root=>{
 let found=listeners.get(root);
 if(!found) { found={state:'answering',cause:null,open:0,waiting:[],pause:0,next:0}; listeners.set(root,found); }
 return found;
};
/** The health of one listener as every caller sees it. @param {{address:string,managementAddress?:string}} connection @param {'api'|'management'} listener */
export function listenerHealth(connection,listener) {
 const root=listenerRoot(connection,listener);
 const found=root?listeners.get(root):null;
 return {state:found?.state??'answering',cause:found?.cause??null};
}
/** Forgets every listener's health and queue (tests). */
export function forgetListeners() { listeners.clear(); }

const hostOf=root=>{ try { return new URL(root).host; } catch { return root; } };
/** @param {string} root @param {Listener} found @param {'answering'|'slow'|'down'} state @param {string|null} cause */
function change(root,found,state,cause) {
 const was=found.state;
 found.state=state; found.cause=cause;
 // An answer ends the pause; a failure doubles it and puts the next call that far off.
 if(state==='answering') { found.pause=0; found.next=0; }
 else { found.pause=Math.min(backoffTo,Math.max(backoffFrom,found.pause*2)); found.next=Date.now()+found.pause; }
 if(was!==state) {
  if(state==='answering') console.info(`Engine listener ${hostOf(root)} answers again`);
  else console.warn(`Engine listener ${hostOf(root)} is ${state} (${cause})`);
 }
 release(found);
}
/** @param {Listener} found */
const limitOf=found=>found.state==='answering'?callLimit:1;
/** @param {Listener} found */
function release(found) {
 while(found.waiting.length&&found.open<limitOf(found)) { found.open++; found.waiting.shift()?.(); }
}
/** A turn among the calls to one listener, or null when the deadline ended first. @param {Listener} found @param {AbortSignal} signal */
function turn(found,signal) {
 if(found.open<limitOf(found)&&!found.waiting.length) { found.open++; return Promise.resolve(true); }
 return new Promise(resolve=>{
  const go=()=>{ signal.removeEventListener('abort',gone); resolve(true); };
  const gone=()=>{ const at=found.waiting.indexOf(go); if(at>=0) found.waiting.splice(at,1); resolve(false); };
  found.waiting.push(go);
  signal.addEventListener('abort',gone,{once:true});
 });
}

/** True once `ms` have passed, false when `signal` ended first. @param {number} ms @param {AbortSignal} signal */
function paused(ms,signal) {
 if(signal.aborted) return Promise.resolve(false);
 return new Promise(resolve=>{
  const timer=setTimeout(()=>{ signal.removeEventListener('abort',gone); resolve(true); },ms);
  const gone=()=>{ clearTimeout(timer); resolve(false); };
  signal.addEventListener('abort',gone,{once:true});
 });
}

/** Bytes of a response read up to one past `limit`. @param {Response} response @param {number} limit */
async function bytesUpTo(response,limit) {
 const reader=response.body?.getReader(); if(!reader) return new Uint8Array(0);
 const chunks=[]; let size=0;
 for(;;) {
  const {done,value}=await reader.read();
  if(done) break;
  chunks.push(value); size+=value.byteLength;
  if(size>limit) { await reader.cancel().catch(()=>{}); break; }
 }
 const body=new Uint8Array(size); let at=0; for(const chunk of chunks) { body.set(chunk,at); at+=chunk.byteLength; }
 return body;
}

/**
 * One request to one listener of an Engine. The answer is a Response: read whole before it is returned (up to
 * `bodyLimit` and one byte), or, with `stream`, as soon as its head arrives, its body for the caller to read under the
 * caller's own signal. Throws an EngineFailure when no answer came.
 * @param {{address:string,key?:string,managementAddress?:string}} connection
 * @param {{listener?:'api'|'management',path:string,method?:string,headers?:Record<string,string>,body?:any,deadline?:number,signal?:AbortSignal,stream?:boolean,key?:string|null}} call
 * @returns {Promise<Response>}
 */
export async function engineRequest(connection,{listener='api',path,method='GET',headers={},body,deadline=5000,signal,stream=false,key}) {
 const root=listenerRoot(connection,listener);
 if(!root) throw new EngineFailure('notAllowed',false);
 const found=listenerOf(root);
 const late=AbortSignal.timeout(deadline);
 const ended=signal?AbortSignal.any([signal,late]):late;
 if(!await turn(found,ended)) throw new EngineFailure(late.aborted?'timedOut':'failed',false);
 let held=true;
 const done=()=>{ if(held) { held=false; found.open--; release(found); } };
 // A slow or down listener is asked again only once its pause has passed (the turn already made this the one call).
 if(found.state!=='answering'&&found.next>Date.now()&&!await paused(found.next-Date.now(),ended)) { done(); throw new EngineFailure(late.aborted?'timedOut':'failed',false); }
 // A stream's head must arrive within the deadline; once it has, the stream lasts until the caller's own signal ends it.
 const head=new AbortController();
 const headLate=()=>head.abort(late.reason);
 late.addEventListener('abort',headLate,{once:true});
 try {
  const auth=key===null?{}:{Authorization:`Bearer ${key??connection.key}`};
  const isJson=body!==undefined&&typeof body!=='string';
  const response=await fetch(`${root}${path}`,{method,headers:{...auth,...(isJson?{'Content-Type':'application/json'}:{}),...headers},
   ...(body!==undefined?{body:isJson?JSON.stringify(body):body}:{}),redirect:'manual',cache:'no-store',signal:stream?(signal?AbortSignal.any([signal,head.signal]):head.signal):ended});
  if(found.state!=='answering') change(root,found,'answering',null);
  if(stream) return response;
  const bytes=await bytesUpTo(response,bodyLimit);
  return new Response([101,103,204,304].includes(response.status)?null:bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
 } catch(error) {
  const cause=signal?.aborted&&!late.aborted?'failed':failureCause(error);
  const failure=/** @type {any} */(error);
  const code=failure?.cause?.code??failure?.cause?.errors?.find?.((/** @type {any} */ one)=>one?.code)?.code??failure?.code;
  // Down is a listener nothing could connect to; a connection it dropped after taking one says nothing of its health.
  if(cause==='timedOut') change(root,found,'slow',cause);
  else if(neverConnected.has(code)) change(root,found,'down',cause);
  throw new EngineFailure(cause,!neverConnected.has(code),error);
 } finally { late.removeEventListener('abort',headLate); done(); }
}

/**
 * A WebSocket to the management listener (the Screen's JSON-RPC and its live stream). The socket is the caller's to
 * close. Throws an EngineFailure when none can open.
 * @param {{address:string,key:string,managementAddress?:string}} connection @param {{path:string,search?:Record<string,string>,binary?:boolean}} socket
 */
export function engineSocket(connection,{path,search={},binary=false}) {
 const root=listenerRoot(connection,'management');
 if(!root) throw new EngineFailure('notAllowed',false);
 const found=listenerOf(root);
 const url=new URL(`${root}${path}`);
 url.protocol=url.protocol==='https:'?'wss:':'ws:';
 for(const [name,value] of Object.entries(search)) url.searchParams.set(name,value);
 const socket=new WebSocket(url.href);
 if(binary) socket.binaryType='arraybuffer';
 socket.addEventListener('open',()=>{ if(found.state!=='answering') change(root,found,'answering',null); },{once:true});
 return socket;
}
