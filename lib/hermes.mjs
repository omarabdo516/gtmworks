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
