import { isIP } from 'node:net';

// The one Hermes release whose contract was live-checked (ADR 0008); the install ships this release (ADR 0010).
export const hermesVersion='0.23.0';

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

export async function testHermes({address,profile,key}) {
 if(!isHermesAddressAllowed(address)) throw new Error('hermesHttpsRequired');
 const root=`${address.replace(/\/$/,'')}/p/${encodeURIComponent(profile)}`;
 const get=path=>fetch(`${root}${path}`,{headers:{Authorization:`Bearer ${key}`},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
 try {
  const capabilities=await get('/v1/capabilities');
  if([401,403].includes(capabilities.status)) return {state:'refused',version:null,features:[]};
  if(!capabilities.ok) return {state:'unreachable',version:null,features:[]};
  const contract=await capabilities.json();
  const health=await get('/health');
  if([401,403].includes(health.status)) return {state:'refused',version:null,features:[]};
  if(!health.ok) return {state:'unreachable',version:null,features:[]};
  const identity=await health.json();
  const version=typeof identity?.version==='string'&&/^\d+\.\d+\.\d+$/.test(identity.version)?identity.version:null;
  if(version!==hermesVersion||identity.platform!=='hermes-agent'||contract?.object!=='hermes.api_server.capabilities'||!contract.features) return {state:'untested_version',version,features:[]};
  return {state:'connected',version,features:['run_submission','run_events_sse'].filter(feature=>contract.features[feature]===true)};
 } catch { return {state:'unreachable',version:null,features:[]}; }
}

// One conversation is one Hermes session; the same idempotency key replays the same run. Instructions are Hermes's
// per-run system prompt (v0.23.0 /v1/runs `instructions`, an ephemeral prompt that is not stored in the session).
const runRoot=({address,profile})=>`${address.replace(/\/$/,'')}/p/${encodeURIComponent(profile)}/v1/runs`;
const authorized=key=>({Authorization:`Bearer ${key}`});
// A start has three outcomes. A run id: Hermes started it (or replayed it for the same key). null: it definitely did
// not start: the address is not allowed, or on the first attempt nothing could connect or Hermes answered with a
// refusal. startUnknown: the request may have reached Hermes but no usable answer came back (a timeout, a connection
// closed mid-answer, a gateway's 502, 503 or 504, an accepted answer without a run id), so the run may exist; the caller keeps its reservation and asks again with the same
// idempotency key and the same body until Hermes says which.
export const startUnknown=Object.freeze({state:'unknown'});
const neverConnected=new Set(['ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH']);
const causeCode=failure=>failure?.cause?.code||failure?.cause?.errors?.find?.(error=>error?.code)?.code||failure?.code;
export async function startRun({address,profile,key,input,instructions,sessionKey,idempotencyKey}) {
 if(!isHermesAddressAllowed(address)) return null;
 const request={method:'POST',headers:{...authorized(key),'Content-Type':'application/json','X-Hermes-Session-Key':sessionKey,'Idempotency-Key':idempotencyKey},body:JSON.stringify(instructions?{input,instructions}:{input}),redirect:'manual',cache:'no-store'};
 // A request that got no answer is sent once more at once: the same key and body make it the same run, and a
 // connection closed under a reused socket is answered by the second attempt. Only the first attempt can prove the run
 // did not start (nothing connected, or Hermes itself refused it); once an answer was lost, or a gateway answered
 // 502, 503 or 504, every later failure leaves the outcome unknown.
 let lost=false;
 for(let attempt=1;attempt<=2;attempt++) {
  let response;
  try { response=await fetch(runRoot({address,profile}),{...request,signal:AbortSignal.timeout(10000)}); }
  catch(failure) { if(!lost&&neverConnected.has(causeCode(failure))) return null; lost=true; continue; }
  if([502,503,504].includes(response.status)) { lost=true; continue; }
  if(response.status!==202&&response.status!==200) return lost?startUnknown:null;
  try {
   const run=(await response.json())?.run_id;
   return typeof run==='string'&&/^[\w.:-]{1,200}$/.test(run)?run:startUnknown;
  } catch { return startUnknown; }
 }
 return startUnknown;
}
export async function readRun({address,profile,key,run}) {
 const unreachable={status:'unreachable',output:null,session:null,usage:null};
 if(!isHermesAddressAllowed(address)) return unreachable;
 try {
  const response=await fetch(`${runRoot({address,profile})}/${encodeURIComponent(run)}`,{headers:authorized(key),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
  const result=await boundedJson(response);
  // An answer too large to be a run record is never read to its end: the worker calls Hermes on its own, so one
  // endless body must not exhaust it, and that run is failed rather than asked again forever.
  if(result===tooLarge) return {...unreachable,status:'failed'};
  // Hermes answers 404 run_not_found for a run it no longer knows (after a restart, say): that run will never finish.
  // Any other failure (a wrong address, a proxy) may pass, so the run stays open.
  if(!response.ok) return response.status===404&&result?.error?.code==='run_not_found'?{...unreachable,status:'lost'}:unreachable;
  const status=['completed','failed','cancelled','interrupted'].includes(result?.status)?result.status:'running';
  return {status,output:status==='completed'&&typeof result.output==='string'?result.output:null,session:typeof result.session_id==='string'?result.session_id.slice(0,200):null,usage:usageOf(result.usage)};
 } catch { return unreachable; }
}
// Hermes stops a run it is running; an ended or unknown run is not stopped again.
export async function stopRun({address,profile,key,run}) {
 if(!isHermesAddressAllowed(address)) return false;
 try {
  const response=await fetch(`${runRoot({address,profile})}/${encodeURIComponent(run)}/stop`,{method:'POST',headers:authorized(key),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
  await response.body?.cancel().catch(()=>{});
  return response.ok;
 } catch { return false; }
}
// One Agent is one Hermes profile (ADR 0011). Profiles are made and read on Hermes's management listener (its
// dashboard, port 9119 of the same host unless the connection names another address), authenticated with the same key
// as the Run API. A new profile has no Run API key of its own, so creating an Agent also gives it the connection's key;
// a create that stops part way is failed, and its profile reads as not ready rather than being changed by a retry.
const managementRoot=({address,managementAddress})=>{
 if(managementAddress) return managementAddress.replace(/\/$/,'');
 try { const url=new URL(address); url.port='9119'; return url.origin; } catch { return ''; }
};
const agentName=/^[a-z0-9][a-z0-9_-]{0,63}$/;
// A model is "provider/model", split on the first slash (openrouter/anthropic/claude-opus-4.6); none keeps the default.
const modelOf=model=>/^([^/\s]+)\/(\S+)$/.exec(model)?.slice(1)||null;
const noAgent=state=>({state,agent:null});
// The state an answer that is not a success means: refused for a refused key, unreachable for anything else.
const refusal=response=>[401,403].includes(response.status)?'refused':'unreachable';
async function manage(connection,path,{method='GET',body}={}) {
 const response=await fetch(`${managementRoot(connection)}${path}`,{method,headers:{...authorized(connection.key),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(method==='POST'?15000:5000)});
 return {response,result:await boundedJson(response)};
}
const reachable=connection=>isHermesAddressAllowed(connection.address)&&isHermesAddressAllowed(managementRoot(connection));
export async function createAgent(connection,{name,instructions,model=null}) {
 const pair=model?modelOf(model):null;
 if(!agentName.test(name)||typeof instructions!=='string'||model&&!pair) return noAgent('failed');
 if(!reachable(connection)) return noAgent('unreachable');
 try {
  const made=await manage(connection,'/api/profiles',{method:'POST',body:{name,soul:instructions}});
  if(made.response.status===400&&typeof made.result?.detail==='string'&&made.result.detail.includes('already exists')) return noAgent('exists');
  if(!made.response.ok) return noAgent(made.response.status===400?'failed':refusal(made.response));
  if(made.result?.ok!==true||made.result.name!==name) return noAgent('failed');
  // A 200 alone is not trusted: each step answers ok:true when it was applied.
  const steps=[...(pair?[[`/api/profiles/${encodeURIComponent(name)}/model`,{provider:pair[0],model:pair[1]}]]:[]),
   [`/api/env?profile=${encodeURIComponent(name)}`,{key:'API_SERVER_KEY',value:connection.key}]];
  for(const [path,body] of steps) {
   const step=await manage(connection,path,{method:'PUT',body});
   if(!step.response.ok||step.result?.ok!==true) return noAgent('failed');
  }
  return {state:'created',agent:{name,instructions,model:pair?model:null,ready:true}};
 } catch { return noAgent('unreachable'); }
}
export async function readAgent(connection,name) {
 if(!agentName.test(name)) return noAgent('missing');
 if(!reachable(connection)) return noAgent('unreachable');
 try {
  const listed=await manage(connection,'/api/profiles');
  if(!listed.response.ok) return noAgent(refusal(listed.response));
  const profile=Array.isArray(listed.result?.profiles)?listed.result.profiles.find(found=>found?.name===name):undefined;
  if(!profile) return noAgent('missing');
  const soul=await manage(connection,`/api/profiles/${encodeURIComponent(name)}/soul`);
  if(!soul.response.ok) return noAgent(refusal(soul.response));
  // Ready when the Run API of that profile accepts the connection's key: a Run can then start for the Agent.
  const capabilities=await fetch(`${address(connection)}/p/${encodeURIComponent(name)}/v1/capabilities`,{headers:authorized(connection.key),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
  await capabilities.body?.cancel().catch(()=>{});
  const text=value=>typeof value==='string'&&value?value:null;
  const [provider,model]=[text(profile.provider),text(profile.model)];
  return {state:'found',agent:{name,instructions:typeof soul.result?.content==='string'?soul.result.content:'',model:provider&&model?`${provider}/${model}`:null,ready:capabilities.ok}};
 } catch { return noAgent('unreachable'); }
}
const address=({address})=>address.replace(/\/$/,'');

// A Company's own profile in the bundled Engine (ADR 0014): its own home, so its memory, skills, sessions and model
// sign-in, with the tool configuration of the Company's Agent level. It is made in steps like an Agent's (ADR 0011):
// the profile with its soul, then its Run API key, then its tools; each step answers ok:true. The name is derived from
// the Company's id and reserved for that Company, so a profile already there under that name is a create that stopped
// part way: it is finished, never left held. A profile is never cloned from another, so it starts with no memory.
// The tools are read back from the profile's own Run API (/v1/toolsets, the toolsets a Run there gets), and a profile
// that still offers a toolset that must stay off fails, so the worker never attaches a Company to it.
const query=name=>`?profile=${encodeURIComponent(name)}`;
const stepState=step=>[401,403].includes(step.response.status)?'refused':'failed';
const noProfile=state=>({state,toolsets:null});
/** @param {any} connection @param {{name:string,soul:string,config:object,forbidden:string[]}} profile */
export async function provideProfile(connection,{name,soul,config,forbidden}) {
 if(!agentName.test(name)||typeof soul!=='string'||!config||typeof config!=='object'||!Array.isArray(forbidden)) return noProfile('failed');
 if(!reachable(connection)) return noProfile('unreachable');
 try {
  const made=await manage(connection,'/api/profiles',{method:'POST',body:{name,soul}});
  const exists=made.response.status===400&&typeof made.result?.detail==='string'&&made.result.detail.includes('already exists');
  if(!exists&&!made.response.ok) return noProfile(made.response.status===400?'failed':refusal(made.response));
  if(!exists&&(made.result?.ok!==true||made.result.name!==name)) return noProfile('failed');
  const key=await manage(connection,`/api/env${query(name)}`,{method:'PUT',body:{key:'API_SERVER_KEY',value:connection.key}});
  if(!key.response.ok||key.result?.ok!==true) return noProfile(stepState(key));
  return await writeTools(connection,{name,config,forbidden});
 } catch { return noProfile('unreachable'); }
}
// A Company's level changed: its profile's tools are written again and read back.
/** @param {any} connection @param {{name:string,config:object,forbidden:string[]}} profile */
export async function configureProfile(connection,{name,config,forbidden}) {
 if(!agentName.test(name)||!config||typeof config!=='object'||!Array.isArray(forbidden)) return noProfile('failed');
 if(!reachable(connection)) return noProfile('unreachable');
 try { return await writeTools(connection,{name,config,forbidden}); } catch { return noProfile('unreachable'); }
}
async function writeTools(connection,{name,config,forbidden}) {
 const written=await manage(connection,`/api/config${query(name)}`,{method:'PUT',body:{config}});
 if(!written.response.ok||written.result?.ok!==true) return noProfile(stepState(written));
 const read=await readToolsets({...connection,profile:name});
 if(read.state!=='found') return noProfile(read.state);
 return read.toolsets.some(toolset=>forbidden.includes(toolset))?{state:'failed',toolsets:read.toolsets}:{state:'configured',toolsets:read.toolsets};
}
// The toolsets a Run on this profile gets, as the profile's own Run API reports them (Hermes applies the platform list
// and then agent.disabled_toolsets). Any profile is read, a pasted one too: it is only read, never changed.
/** @param {{address:string,profile:string,key:string}} connection */
export async function readToolsets(connection) {
 if(!isHermesAddressAllowed(connection.address)||!/^[a-zA-Z0-9_-]{1,100}$/.test(connection.profile)) return noProfile('unreachable');
 try {
  const response=await fetch(`${address(connection)}/p/${encodeURIComponent(connection.profile)}/v1/toolsets`,{headers:authorized(connection.key),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
  const result=await boundedJson(response);
  // Hermes answers 404 for a profile it does not serve (it was removed, or its data was not restored with a backup).
  if(response.status===404&&typeof result?.error==='string'&&result.error.includes('Unknown or unconfigured profile')) return noProfile('missing');
  if(!response.ok) return noProfile([401,403].includes(response.status)?'refused':'unreachable');
  if(!Array.isArray(result?.data)) return noProfile('failed');
  return {state:'found',toolsets:result.data.filter(toolset=>toolset?.enabled===true&&typeof toolset.name==='string').map(toolset=>toolset.name)};
 } catch { return noProfile('unreachable'); }
}

// A Company's model sign-in lives in its own profile (#3, ADR 0014). Hermes runs the sign-in; gtmworks passes on only
// whether each provider is connected, and for a device-code sign-in the code and the https link the person opens.
// No credential, token preview or Hermes error text ever leaves the driver.
export const signInProviders=['openai-codex','anthropic'];
const signInState=['pending','approved','denied','expired','error','cancelled'];
const sessionId=/^[\w-]{8,128}$/;
// Hermes lets a profile with no credential of its own for a provider use the default (root) profile's, and reports it
// as logged in either way: the status names no source and no setting turns the fallback off (hermes_cli/auth.py,
// read_credential_pool and _load_provider_state, v0.23.0). So the default profile is read too, and a provider signed in
// there is never reported as the company's own: it is `shared`, not connected, whatever the company profile says.
/** @param {any} connection */
export async function readSignIns(connection) {
 if(!agentName.test(connection.profile)||connection.profile==='default') return {state:'failed',signIns:null};
 if(!reachable(connection)) return {state:'unreachable',signIns:null};
 try {
  const [own,root]=[await manage(connection,`/api/providers/oauth${query(connection.profile)}`),await manage(connection,'/api/providers/oauth')];
  for(const listed of [own,root]) {
   if(!listed.response.ok) return {state:refusal(listed.response),signIns:null};
   if(!Array.isArray(listed.result?.providers)) return {state:'failed',signIns:null};
  }
  const loggedIn=(listed,id)=>listed.result.providers.find(found=>found?.id===id)?.status?.logged_in===true;
  const signIns=Object.fromEntries(signInProviders.map(id=>{
   const provider=own.result.providers.find(found=>found?.id===id);
   const shared=loggedIn(root,id);
   return [id,{connected:!shared&&loggedIn(own,id),shared,flow:provider?.flow==='device_code'?'device_code':'external'}];
  }));
  return {state:'found',signIns};
 } catch { return {state:'unreachable',signIns:null}; }
}
const noSignIn=state=>({state,session:null,code:null,link:null,expiresIn:null,interval:null});
/** @param {any} connection @param {string} provider */
export async function startSignIn(connection,provider) {
 if(!signInProviders.includes(provider)||!agentName.test(connection.profile)) return noSignIn('failed');
 if(!reachable(connection)) return noSignIn('unreachable');
 try {
  const started=await manage(connection,`/api/providers/oauth/${encodeURIComponent(provider)}/start${query(connection.profile)}`,{method:'POST'});
  // A provider Hermes signs in only from its own command line (Claude, in the pinned release).
  if(started.response.status===400&&typeof started.result?.detail==='string'&&started.result.detail.includes('external CLI')) return noSignIn('terminal_only');
  if(!started.response.ok) return noSignIn(stepState(started));
  const {session_id:session,user_code:code,verification_url:link,expires_in:expiresIn,poll_interval:interval}=started.result||{};
  let url=null; try { url=new URL(link); } catch { url=null; }
  if(typeof session!=='string'||!sessionId.test(session)||typeof code!=='string'||!/^[A-Za-z0-9-]{4,32}$/.test(code)||url?.protocol!=='https:'||url.username||url.password) return noSignIn('failed');
  const seconds=(value,fallback,most)=>Number.isSafeInteger(value)&&value>0?Math.min(value,most):fallback;
  return {state:'started',session,code,link:url.href,expiresIn:seconds(expiresIn,900,3600),interval:seconds(interval,5,60)};
 } catch { return noSignIn('unreachable'); }
}
/** @param {any} connection @param {string} provider @param {string} session */
export async function pollSignIn(connection,provider,session) {
 if(!signInProviders.includes(provider)||!agentName.test(connection.profile)||typeof session!=='string'||!sessionId.test(session)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const polled=await manage(connection,`/api/providers/oauth/${encodeURIComponent(provider)}/poll/${encodeURIComponent(session)}${query(connection.profile)}`);
  // A session Hermes no longer knows (expired, cancelled, or after a restart) can never finish.
  if(polled.response.status===404) return {state:'expired'};
  if(!polled.response.ok) return {state:stepState(polled)};
  return {state:signInState.includes(polled.result?.status)?polled.result.status:'failed'};
 } catch { return {state:'unreachable'}; }
}
/** @param {any} connection @param {string} session */
export async function cancelSignIn(connection,session) {
 if(!agentName.test(connection.profile)||typeof session!=='string'||!sessionId.test(session)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const cancelled=await manage(connection,`/api/providers/oauth/sessions/${encodeURIComponent(session)}${query(connection.profile)}`,{method:'DELETE'});
  return {state:cancelled.response.ok?'cancelled':stepState(cancelled)};
 } catch { return {state:'unreachable'}; }
}
// Disconnect removes the provider's credential from this profile's home only (Hermes's clear_provider_auth).
/** @param {any} connection @param {string} provider */
export async function disconnectSignIn(connection,provider) {
 if(!signInProviders.includes(provider)||!agentName.test(connection.profile)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const removed=await manage(connection,`/api/providers/oauth/${encodeURIComponent(provider)}${query(connection.profile)}`,{method:'DELETE'});
  return {state:removed.response.ok&&removed.result?.ok===true?'disconnected':stepState(removed)};
 } catch { return {state:'unreachable'}; }
}

// The Hermes driver of the engine contract (lib/engine.mjs): one conversation is one Hermes session, and Hermes's
// cancelled and interrupted runs are the contract's stopped. Only this driver talks to Hermes.
export function hermesEngine(connection) {
 return {
  start:({conversation,input,idempotencyKey,instructions})=>startRun({...connection,input,instructions,sessionKey:conversation,idempotencyKey}),
  read:async run=>{
   const {status,output,session,usage}=await readRun({...connection,run});
   return {state:status==='cancelled'||status==='interrupted'?'stopped':status,reply:output,session,usage};
  },
  stop:run=>stopRun({...connection,run}),
  createAgent:agent=>createAgent(connection,agent),
  readAgent:name=>readAgent(connection,name),
 };
}
// A run record holds at most a 200,000-character reply (4 bytes a character at most), well under this limit.
const bodyLimit=4*1024*1024; const tooLarge=Symbol('tooLarge');
async function boundedJson(response) {
 const reader=response.body?.getReader(); if(!reader) return null;
 const chunks=[]; let size=0;
 for(;;) {
  const {done,value}=await reader.read();
  if(done) break;
  size+=value.byteLength;
  if(size>bodyLimit) { await reader.cancel().catch(()=>{}); return tooLarge; }
  chunks.push(value);
 }
 const body=new Uint8Array(size); let at=0; for(const chunk of chunks) { body.set(chunk,at); at+=chunk.byteLength; }
 try { return JSON.parse(new TextDecoder().decode(body)); } catch { return null; }
}
// The tokens Hermes reported for a run; anything missing or malformed is unknown (null), never zero.
const count=value=>Number.isSafeInteger(value)&&value>=0;
function usageOf(usage) {
 return count(usage?.input_tokens)&&count(usage?.output_tokens)?{input:usage.input_tokens,output:usage.output_tokens}:null;
}
