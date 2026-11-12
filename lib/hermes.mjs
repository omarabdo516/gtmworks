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

// One conversation is one Hermes session; the same idempotency key replays the same run.
const runRoot=({address,profile})=>`${address.replace(/\/$/,'')}/p/${encodeURIComponent(profile)}/v1/runs`;
const authorized=key=>({Authorization:`Bearer ${key}`});
export async function startRun({address,profile,key,input,sessionKey,idempotencyKey}) {
 if(!isHermesAddressAllowed(address)) return null;
 try {
  const response=await fetch(runRoot({address,profile}),{method:'POST',headers:{...authorized(key),'Content-Type':'application/json','X-Hermes-Session-Key':sessionKey,'Idempotency-Key':idempotencyKey},body:JSON.stringify({input}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(response.status!==202&&response.status!==200) return null;
  const run=(await response.json())?.run_id;
  return typeof run==='string'&&/^[\w.:-]{1,200}$/.test(run)?run:null;
 } catch { return null; }
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
// A company's own model subscription is signed in on the management listener too (#3, ADR 0012), in a profile of its
// own that holds no Agent: `company-<id without dashes>`, made from the company id on the server, created on the first
// connect as an empty profile (never cloned) and marked with the company in its description. A profile with that name
// and another description is not the company's, and nothing is read from or done in it. Every sign-in call names the
// profile with `?profile=`; the listener then works in that profile's home and answers 404 for a name it does not know,
// while a call with no profile would use the default one, so none is ever sent without it.
//
// The pinned release reads the default profile's credential in any profile that has none of its own, so a provider
// signed in on the default profile is `unavailable` for every company rather than shown as theirs. It has no
// dashboard sign-in for Claude (anthropic is "external" there and /submit always refuses): Claude is `unavailable` to
// connect, and one already stored in the profile shows as connected and can be removed. Only the state, the link and
// the code leave this driver; the Engine's session id is kept here, in memory, until the sign-in ends.
const companyId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** @param {unknown} company @returns {string|null} */
export function companyProfile(company) {
 return typeof company==='string'&&companyId.test(company)?`company-${company.toLowerCase().replaceAll('-','')}`:null;
}
const companyMarker=company=>`gtmworks company ${company.toLowerCase()}`;
const engineSignInProviders=['openai-codex','anthropic'];
const deviceSignIn='openai-codex';
const signInLifetime=15*60*1000;
/** @typedef {{session:string|null,expires:number,ready:Promise<any>,abort?:()=>Promise<boolean>}} EngineSession */
/** @type {Map<string,EngineSession>} */
const engineSessions=new Map();
// A sign-in nobody asks about again would otherwise stay here: one past its lifetime is forgotten and cancelled in
// Hermes (best effort, by its stored id) before the waiting ones are counted, so abandoned ones never fill the limit.
const forget=(/** @type {string} */ key,/** @type {EngineSession} */ entry)=>{
 if(engineSessions.get(key)!==entry) return;
 engineSessions.delete(key); entry.abort?.().catch(()=>false);
};
export const engineSignInsWaiting=()=>{
 const now=Date.now();
 for(const [key,entry] of engineSessions) if(entry.expires&&now>=entry.expires) forget(key,entry);
 return engineSessions.size;
};
// The poll answers after which Hermes saves nothing more for that sign-in (hermes_cli/web_routers/oauth.py:97 and the
// workers that set `status`); 404 is a session Hermes no longer knows. Any other answer keeps the sign-in tracked.
const signInEndings=new Set(['approved','denied','expired','error','cancelled']);
export function engineSignIn(connection,company) {
 const name=companyProfile(company); const root=managementRoot(connection);
 const failed={state:'failed'}, unavailable={state:'unavailable'};
 const scoped=(path,profile=name)=>`${path}?profile=${encodeURIComponent(profile)}`;
 const usable=provider=>!!name&&engineSignInProviders.includes(provider)&&isHermesAddressAllowed(root);
 const key=provider=>`${root}\0${name}\0${provider}`;
 const notSignedIn=provider=>provider===deviceSignIn?{state:'disconnected'}:unavailable;
 // Whether the company profile is there and gtmworks made it: ours, missing, foreign or failed.
 async function owner() {
  const listed=await manage(connection,'/api/profiles');
  if(!listed.response.ok||!Array.isArray(listed.result?.profiles)) return 'failed';
  const found=listed.result.profiles.find(profile=>profile?.name===name);
  return !found?'missing':found.description===companyMarker(company)?'ours':'foreign';
 }
 // Whether a profile has the provider signed in, read as a yes or no only (never the preview); null when unknown.
 async function signedIn(provider,profile) {
  const read=await manage(connection,scoped('/api/providers/oauth',profile));
  const status=read.response.ok&&Array.isArray(read.result?.providers)?read.result.providers.find(found=>found?.id===provider)?.status:null;
  return typeof status?.logged_in==='boolean'&&!status.error?status.logged_in:null;
 }
 async function settled(provider) {
  const found=await owner();
  if(found==='failed'||found==='foreign') return {found,state:failed};
  const shared=await signedIn(provider,'default');
  if(shared!==false) return {found,state:shared?unavailable:failed};
  if(found==='missing') return {found,state:notSignedIn(provider)};
  const own=await signedIn(provider,name);
  return {found,state:own===null?failed:own?{state:'connected'}:notSignedIn(provider)};
 }
 // The sign-in shown while the Engine still waits for the person, failed while its state cannot be learned, or null
 // once Hermes has ended it or its lifetime is over. A poll that fails keeps it: Hermes may still save a credential,
 // and only the stored id lets a disconnect cancel it.
 async function waiting(provider) {
  const entry=engineSessions.get(key(provider)); if(!entry) return null;
  const shown=await entry.ready;
  if(shown.state!=='pending'||!entry.session||engineSessions.get(key(provider))!==entry) return null;
  if(Date.now()>=entry.expires) { forget(key(provider),entry); return null; }
  const polled=await manage(connection,scoped(`/api/providers/oauth/${provider}/poll/${encodeURIComponent(entry.session)}`));
  const status=polled.response.ok?polled.result?.status:polled.response.status===404?'unknown':null;
  if(status==='pending') return shown;
  if(status!=='unknown'&&!signInEndings.has(status)) return failed;
  if(engineSessions.get(key(provider))===entry) engineSessions.delete(key(provider));
  return null;
 }
 async function cancel(entry) {
  await entry.ready.catch(()=>{});
  if(!entry.session) return true;
  const cancelled=await manage(connection,scoped(`/api/providers/oauth/sessions/${encodeURIComponent(entry.session)}`),{method:'DELETE'});
  return cancelled.response.ok;
 }
 async function state(provider) {
  if(!usable(provider)) return failed;
  try { return await waiting(provider)||(await settled(provider)).state; } catch { return failed; }
 }
 async function start(provider) {
  if(!usable(provider)) return failed;
  if(engineSessions.has(key(provider))) return state(provider);
  // Reserved before the first await, so a second connect finds this one instead of starting its own.
  /** @type {EngineSession} */
  const entry={session:null,expires:0,ready:Promise.resolve(failed)}; engineSessions.set(key(provider),entry);
  entry.abort=()=>cancel(entry);
  entry.ready=(async()=>{
   const now=await settled(provider);
   if(now.state.state!=='disconnected') return now.state;
   if(now.found==='missing') {
    const made=await manage(connection,'/api/profiles',{method:'POST',body:{name,description:companyMarker(company)}});
    const ours=made.response.ok?made.result?.ok===true&&made.result.name===name:await owner()==='ours';
    if(!ours) return failed;
   }
   const started=await manage(connection,scoped(`/api/providers/oauth/${provider}/start`),{method:'POST'});
   const session=started.response.ok&&typeof started.result?.session_id==='string'&&/^[\w-]{16,200}$/.test(started.result.session_id)?started.result.session_id:null;
   if(!session) return failed;
   entry.session=session; entry.expires=Date.now()+Math.min(signInLifetime,(Number(started.result.expires_in)||900)*1000);
   const link=typeof started.result.verification_url==='string'&&/^https:\/\/[^\s"'<>]{1,500}$/.test(started.result.verification_url)?started.result.verification_url:null;
   const code=typeof started.result.user_code==='string'&&/^[A-Za-z0-9-]{4,32}$/.test(started.result.user_code)?started.result.user_code:null;
   if(link&&code) return {state:'pending',link,code};
   await cancel({...entry,ready:Promise.resolve()}).catch(()=>{});
   return failed;
  })().catch(()=>failed).then(shown=>{ if(shown.state!=='pending'&&engineSessions.get(key(provider))===entry) engineSessions.delete(key(provider)); return shown; });
  return entry.ready;
 }
 async function disconnect(provider) {
  if(!usable(provider)) return failed;
  try {
   // A sign-in under way is cancelled in the Engine first, so it cannot save a credential after this one is removed.
   const entry=engineSessions.get(key(provider));
   // One Hermes did not cancel stays tracked, so a later disconnect can try again.
   if(entry) {
    engineSessions.delete(key(provider));
    if(!await cancel(entry)) { if(!engineSessions.has(key(provider))) engineSessions.set(key(provider),entry); return failed; }
   }
   const found=await owner();
   if(found==='failed'||found==='foreign') return failed;
   if(found==='ours') {
    // Hermes's own removal clears every credential of the provider in that profile; 409 means there was none.
    const removed=await manage(connection,scoped(`/api/providers/oauth/${provider}`),{method:'DELETE'});
    if(!removed.response.ok&&removed.response.status!==409) return failed;
   }
   const after=(await settled(provider)).state;
   return after.state==='connected'?failed:after;
  } catch { return failed; }
 }
 // Claude's pasted code has no route on the pinned listener, so nothing is sent.
 const complete=async()=>failed;
 return {start,state,disconnect,complete};
}
const address=({address})=>address.replace(/\/$/,'');
// The Hermes driver of the engine contract (lib/engine.mjs): one conversation is one Hermes session, and Hermes's
// cancelled and interrupted runs are the contract's stopped. Only this driver talks to Hermes.
export function hermesEngine(connection) {
 return {
  start:({conversation,input,idempotencyKey})=>startRun({...connection,input,sessionKey:conversation,idempotencyKey}),
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
