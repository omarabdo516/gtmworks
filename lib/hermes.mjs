import { isIP } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { apps, appByKey, appConfig, appKey, appState, customApp } from './app-catalogue.mjs';
import { isAgentProfile, toolConfig, appToolset, workFolder } from './agent-toolsets.mjs';
import { secretLike } from './secret-text.mjs';
import { sandboxServer, sandboxCommandOf } from './sandbox-command.mjs';
import { openDesignApp, designProfileOf, designProfileConfig, openDesignServer, openDesignKeyOf, newDesignKey } from './open-design.mjs';
import { accountId } from './provider-names.mjs';
import { servedListOf, readServedModels, keepServed } from './served-models.mjs';

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
// A start has four outcomes. A run id: Hermes started it (or replayed it for the same key). null: Hermes refused it: the
// address is not allowed, or on the first attempt Hermes answered with a refusal. startNotReached: on the first attempt
// nothing could connect (#413), so the request never reached Hermes and the start may be made again as a first one.
// startUnknown: the request may have reached Hermes but no usable answer came back (a timeout, a connection
// closed mid-answer, a gateway's 502, 503 or 504, an accepted answer without a run id), so the run may exist; the caller keeps its reservation and asks again with the same
// idempotency key and the same body (`retry`), and every outcome but a run id stays unknown, until Hermes says which.
export const startUnknown=Object.freeze({state:'unknown'});
export const startNotReached=Object.freeze({state:'notReached'});
// A start whose key Hermes already holds for a different body; never an answer of the engine contract.
const keyConflict=Object.freeze({state:'keyConflict'});
const neverConnected=new Set(['ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH']);
const causeCode=failure=>failure?.cause?.code||failure?.cause?.errors?.find?.(error=>error?.code)?.code||failure?.code;
// A Run on a chosen model (#158) names its provider and model, as the Engine takes them for that Run alone
// (gateway/platforms/api_server.py 269-291, _request_agent_overrides); the profile's own model is left as it is.
export async function startRun({address,profile,key,input,instructions,history,model,sessionKey,idempotencyKey,retry=false}) {
 if(!isHermesAddressAllowed(address)) return retry?startUnknown:null;
 const body={input,...(instructions?{instructions}:{}),...(history?.length?{conversation_history:history}:{}),...(model?{provider:model.provider,model:model.model}:{})};
 const request={method:'POST',headers:{...authorized(key),'Content-Type':'application/json','X-Hermes-Session-Key':sessionKey,'Idempotency-Key':idempotencyKey},body:JSON.stringify(body),redirect:'manual',cache:'no-store'};
 // A request that got no answer is sent once more at once: the same key and body make it the same run, and a
 // connection closed under a reused socket is answered by the second attempt. Only the first attempt can prove the run
 // did not start (nothing connected, or Hermes itself refused it); once an answer was lost, or a gateway answered
 // 502, 503 or 504, every later failure leaves the outcome unknown.
 // A retry of a start that was once unknown (`retry`) begins lost: no answer can prove that start did not happen.
 let lost=retry;
 for(let attempt=1;attempt<=2;attempt++) {
  let response;
  try { response=await fetch(runRoot({address,profile}),{...request,signal:AbortSignal.timeout(10000)}); }
  catch(failure) { if(!lost&&neverConnected.has(causeCode(failure))) return startNotReached; lost=true; continue; }
  if([502,503,504].includes(response.status)) { lost=true; continue; }
  // The key names a Run Hermes admitted with another body (`idempotency_key_conflict`, api_server_runs.py
  // _replay_or_conflict): the caller decides whether it knows that other body (#708).
  if(response.status===409&&(await response.json().catch(()=>null))?.error?.code==='idempotency_key_conflict') return keyConflict;
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
  const question=status==='running'?questionOf(result?.pending_controls):null;
  const permission=result?.status==='waiting_for_approval'?permissionOf(result.approval):null;
  // A failed Run names its cause only in words: a model refusal in the record's output (#457), no provider in error (#422).
  const failure=status==='failed'?failureText(result):null;
  const modelRefused=failure?refusalOf(failure):null;
  const secondsToReset=modelRefused==='access'?resetOf(/** @type {string} */(failure)):null;
  const served=status==='completed'?modelPair(result?.runtime):null;
  const chosen=served?modelPair(result.runtime.requested):null;
  return {status,output:status==='completed'&&typeof result.output==='string'?result.output:null,session:typeof result.session_id==='string'?result.session_id.slice(0,200):null,usage:usageOf(result.usage),
   ...(question?{question}:{}),...(permission?{permission}:{}),...(failure&&noProvider(failure)?{noModel:true}:{}),...(modelRefused?{modelRefused}:{}),
   ...(secondsToReset?{resetsAt:new Date(Date.now()+secondsToReset*1000).toISOString()}:{}),...(served?{served}:{}),...(chosen?{chosen}:{})};
 } catch { return unreachable; }
}
// The model a completed Run's record names (#644): `runtime` is the provider and model that answered it, which after a
// move to the Fallback model is that model (api_server_runs.py _served_runtime; the record's own `model` only echoes the
// request), and `runtime.requested` the pair the Run named, absent when it ran on its profile's own model. Both are ids
// the Engine cleaned (api_server.py _sanitize_runtime_metadata); a blank or odd one is none.
/** @param {any} value @returns {{provider:string,model:string}|null} */
const modelPair=value=>{
 const id=text=>typeof text==='string'&&/^[^\s\u0000-\u001f]{1,200}$/.test(text);
 return id(value?.provider)&&id(value?.model)?{provider:value.provider,model:value.model}:null;
};
/** @param {any} result */
const failureText=result=>[result?.output,result?.error].filter(text=>typeof text==='string').join('\n')||null;
// A Run that failed because its Engine has no model provider at all (#422). The pinned release names the cause only in
// the run's text (api_server_runs.py, _ProviderAuthResolutionError.user_text, around AuthError
// no_provider_configured in hermes_cli/auth.py); that sentence is English in every display language.
// shortcut: a sentence match, as v0.23.0 sends no code; match a code once the pinned release puts one on a failed run.
/** @param {unknown} text */
const noProvider=text=>typeof text==='string'&&text.includes('is not connected to any AI provider');
// A Run whose model call cannot succeed on a retry says which cause it was (#457): no credit or billing, a refused key
// or sign-in, or a model the provider does not have (agent/turn_failure_copy.py, agent/turn_recovery.py). The text is
// English in every display language.
// shortcut: a sentence match, as v0.23.0 sends no code; match a code once the pinned release puts one on a failed run.
// A Run whose every account ran out (#622): the credential pool had no account left and the Fallback model, when the
// Company has one, ran out too or was not there, so the Engine's retries ended on its rate limit
// (agent/turn_failure_copy.py exhausted_copy: "<provider> rate-limited every one of N attempts", or "is rate-limiting
// requests right now" after one).
// A Run after that, on an account the Engine already marked exhausted, fails at once without a model call (#642,
// measured): the gateway's usage-limit line (gateway/run.py _rate_limit_reply, locales/en.yaml
// gateway.errors.usage_limit_resets), or, from its error path, the plan's usage-limit hint (hint_usage_limit_resets,
// hint_usage_limit). A short rate limit ("is rate-limiting requests. Wait a moment") is not one: a send again can work.
/** @param {string} text @returns {'credit'|'key'|'model'|'access'|null} */
const refusalOf=text=>/Billing or credits exhausted|credit balance is too low/i.test(text)?'credit'
 :/rejected your (?:API key|sign-in)/i.test(text)?'key'
 :/isn't available on /i.test(text)?'model'
 :/rate-limited every one of \d+ attempts|is rate-limiting requests right now|usage limit is reached|plan's usage limit has been reached/i.test(text)?'access':null;
// How long until a usage limit resets, in seconds, when the Run's text names it (#642): the Engine's own last line,
// "Limit resets at 19:24 (in 120h 58m)." (agent/turn_failure_copy.py limit_reset_copy), to the minute, else "resets in
// ~121h" or "~45 min" (agent/retry_utils.py format_reset_window, rounded up), or "resets in ~121h" of the error hint.
// The clock time is the Engine's own zone, so only the wait is read. Null when the text names none.
/** @param {string} text @returns {number|null} */
function resetOf(text) {
 const minutes=(/** @type {string|undefined} */ hours,/** @type {string|undefined} */ more)=>Number(hours??0)*60+Number(more??0);
 const exact=/Limit resets at \d{1,2}:\d{2} \(in (?:(\d{1,5})h )?(\d{1,2})m\)/.exec(text);
 const rough=/resets in ~?(?:(\d{1,5})\s*h\b(?: (\d{1,2})m\b)?|(\d{1,5}) min\b)/.exec(text);
 const wait=exact?minutes(exact[1],exact[2]):rough?minutes(rough[1],rough[2]??rough[3]):0;
 // A week and a day at most: a provider's longest usage window is a week.
 return wait>0&&wait<=8*24*60?wait*60:null;
}
// A Run waiting on its person (#138; v0.23.0 clarify, measured): still `running`, with the question in pending_controls,
// one at a time. Hermes appends a skip hint to the text the person never types, and marks the first of two or more
// choices recommended; both are its words, not the Agent's. Its id carries what the answer must name (prompt_id and
// execution_generation); only this driver reads it.
const skipHint=/\n+Reply "skip" to skip this question\.\s*$/;
const recommended=' (Recommended)';
/** @param {unknown} controls @returns {import('./engine.mjs').RunQuestion|null} */
function questionOf(controls) {
 const asked=Array.isArray(controls)?controls.find(control=>control?.kind==='clarify'):null;
 if(!asked||typeof asked.prompt_id!=='string'||!/^[\w-]{1,100}$/.test(asked.prompt_id)||!Number.isSafeInteger(asked.execution_generation)||asked.execution_generation<0||typeof asked.question!=='string') return null;
 const choices=Array.isArray(asked.choices)&&asked.choices.every(choice=>typeof choice==='string')?[...asked.choices]:[];
 if(choices.length>=2&&choices[0].endsWith(recommended)) choices[0]=choices[0].slice(0,-recommended.length);
 return {id:`${asked.prompt_id}@${asked.execution_generation}`,text:asked.question.replace(skipHint,''),choices,multiple:asked.multi_select===true};
}
// The answer goes on the Run's own route, with exactly the body Hermes takes (any other key is refused): typed words as
// written, and several picks (#648) as one JSON array of the choices' texts, which Hermes decodes for a several-pick
// question (tools/clarify_tool.py _clean_answer). Hermes answers
// 200 when it took the answer or already had one, and 409 approval_not_pending when an earlier answer is being taken;
// 409 stale_generation, or 404 run_not_found for a Run it no longer knows, mean it no longer waits for this question. Any
// other answer (a 404 from a proxy among them) may pass, so it is asked again, as readRun keeps such a Run open.
/** @returns {Promise<import('./engine.mjs').AnsweredQuestion>} */
async function answerRun({address,profile,key,run,question,text}) {
 const parts=/^([\w-]{1,100})@(\d{1,15})$/.exec(question);
 const picks=Array.isArray(text)&&text.length>0&&text.every(pick=>typeof pick==='string');
 if(!parts||typeof text!=='string'&&!picks) return 'gone';
 if(!isHermesAddressAllowed(address)) return 'unreachable';
 try {
  const response=await fetch(`${runRoot({address,profile})}/${encodeURIComponent(run)}/clarify`,{method:'POST',headers:{...authorized(key),'Content-Type':'application/json'},
   body:JSON.stringify({request_id:parts[1],execution_generation:Number(parts[2]),answer:picks?JSON.stringify(text):text}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000)});
  const result=await boundedJson(response);
  if(response.ok) return 'answered';
  const code=result===tooLarge?null:result?.error?.code??result?.code;
  if(response.status===409) return code==='approval_not_pending'?'answered':code==='stale_generation'?'gone':'unreachable';
  return response.status===404&&code==='run_not_found'?'gone':'unreachable';
 } catch { return 'unreachable'; }
}
// A Run parked for its person's consent (#163; v0.23.0 _make_approval_notify): status waiting_for_approval, still
// running, with the request in `approval`, its command and description already redacted by Hermes. Of its choices,
// session has no button and is never offered. A request without once and deny is not one gtmworks can answer: Hermes's
// time limit then refuses the action.
/** @type {import('./engine.mjs').PermissionChoice[]} */
const permissionChoices=['once','always','deny'];
const requestId=/^[\w-]{1,100}$/;
// What an "always" answer keeps in the profile's command_allowlist (#166): the request's pattern_keys for a flagged command
// (tools/approval.py _persist_choice), and for an app's tool the one key the trust gate remembers, mcp:<server>/<tool>
// (tools/mcp_tool_handlers.py _trust_approval_key 60-64), which the record does not carry: its pattern_keys are the
// placeholder mcp_elicitation, so the server and the tool are read from the gate's own first sentence (_ask_for_call).
const appToolAsked=/^MCP tool '([^'\n]{1,200})' on UNTRUSTED server '([^'\n]{1,200})' wants to run\./;
const allowKey=key=>typeof key==='string'&&key.length>=1&&key.length<=1000&&key.trim()===key;
/** @param {unknown[]} keys @param {string} command @returns {string[]} */
function allowsOf(keys,command) {
 if(keys.length===1&&keys[0]==='mcp_elicitation') { const tool=appToolAsked.exec(command); return tool?[`mcp:${tool[2]}/${tool[1]}`]:[]; }
 return [...new Set(keys.filter(allowKey))].slice(0,32);
}
/** @param {unknown} asked @returns {import('./engine.mjs').RunPermission|null} */
function permissionOf(asked) {
 const request=/** @type {{request_id?:unknown,description?:unknown,command?:unknown,choices?:unknown,pattern_keys?:unknown}|null} */(asked&&typeof asked==='object'?asked:null);
 if(!request||typeof request.request_id!=='string'||!requestId.test(request.request_id)||!Array.isArray(request.choices)) return null;
 const offered=/** @type {unknown[]} */(request.choices);
 const choices=permissionChoices.filter(choice=>offered.includes(choice));
 if(!choices.includes('once')||!choices.includes('deny')) return null;
 const text=(/** @type {unknown} */ value)=>typeof value==='string'?value:'';
 const allows=choices.includes('always')&&Array.isArray(request.pattern_keys)?allowsOf(request.pattern_keys,text(request.command)):[];
 return {id:request.request_id,description:text(request.description),command:text(request.command),choices,allows};
}
// The choice goes on the Run's own route with exactly the body Hermes takes. Hermes answers 200 when it took it; 409
// approval_not_pending (nothing matching waits: answered, timed out, a stale id) or approval_not_active (the Run's
// approval session is over), 404 run_not_found, and 400 invalid_approval_request or invalid_approval_choice mean it no
// longer waits for this request. Any other answer (a 404 from a proxy among them) may pass, so it is asked again.
const notWaiting={400:['invalid_approval_request','invalid_approval_choice'],404:['run_not_found'],409:['approval_not_pending','approval_not_active']};
/** @returns {Promise<import('./engine.mjs').AnsweredPermission>} */
async function permitRun({address,profile,key,run,permission,choice}) {
 if(typeof permission!=='string'||!requestId.test(permission)||!permissionChoices.includes(choice)) return 'gone';
 if(!isHermesAddressAllowed(address)) return 'unreachable';
 try {
  const response=await fetch(`${runRoot({address,profile})}/${encodeURIComponent(run)}/approval`,{method:'POST',headers:{...authorized(key),'Content-Type':'application/json'},
   body:JSON.stringify({choice,request_id:permission}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000)});
  const result=await boundedJson(response);
  if(response.ok) return 'answered';
  const code=result===tooLarge?null:result?.error?.code??result?.code;
  return notWaiting[response.status]?.includes(code)?'gone':'unreachable';
 } catch { return 'unreachable'; }
}
// Hermes stops a run it is running; an ended or unknown run is not stopped again.
async function stopRun({address,profile,key,run}) {
 if(!isHermesAddressAllowed(address)) return false;
 try {
  const response=await fetch(`${runRoot({address,profile})}/${encodeURIComponent(run)}/stop`,{method:'POST',headers:authorized(key),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
  await response.body?.cancel().catch(()=>{});
  return response.ok;
 } catch { return false; }
}
// A Conversation's session keeps the archived mark its Conversation has (#674): the pinned release's own sidebar flag,
// set on the API listener with the profile's key (v0.23.0 PATCH /api/sessions/<id>, gateway/platforms/api_server.py
// _handle_patch_session, set_session_archived), which hides the session and its compression lineage and keeps every
// message; the flag is the only field sent, so nothing else of the session, and none of the Agent's memory, changes.
// Marked, missing (the profile keeps no such session: there is nothing to mark), refused (the key) or unreachable.
async function markSession({address,profile,key},session,archived) {
 if(typeof session!=='string'||!sessionIdLike.test(session)||session.includes('..')||typeof archived!=='boolean') return 'missing';
 if(!isHermesAddressAllowed(address)) return 'unreachable';
 try {
  const response=await fetch(`${address.replace(/\/$/,'')}/p/${encodeURIComponent(profile)}/api/sessions/${encodeURIComponent(session)}`,{method:'PATCH',
   headers:{...authorized(key),'Content-Type':'application/json'},body:JSON.stringify({archived}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
  await response.body?.cancel().catch(()=>{});
  if(response.ok) return 'marked';
  if(response.status===404) return 'missing';
  return refusal(response);
 } catch { return 'unreachable'; }
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
async function manage(connection,path,{method='GET',body,timeout=method==='POST'?15000:5000}={}) {
 const response=await fetch(`${managementRoot(connection)}${path}`,{method,headers:{...authorized(connection.key),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(timeout)});
 return {response,result:await boundedJson(response)};
}
const reachable=connection=>isHermesAddressAllowed(connection.address)&&isHermesAddressAllowed(managementRoot(connection));
async function createAgent(connection,{name,instructions,model=null}) {
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
  // The name the person gave it, its About and its title are the Engine's own (v0.23.0 GET /api/profiles): gtmworks
  // never invents one (#161). No management route writes a named profile's display_name, so nothing here writes it.
  return {state:'found',agent:{name,instructions:typeof soul.result?.content==='string'?soul.result.content:'',model:provider&&model?`${provider}/${model}`:null,ready:capabilities.ok,
   displayName:text(profile.display_name),description:typeof profile.description==='string'?profile.description:'',descriptionAuto:profile.description_auto!==false,botTitle:text(profile.bot_title)}};
 } catch { return noAgent('unreachable'); }
}
// An Agent's About is its profile's description, written as a person wrote it (v0.23.0 PUT
// /api/profiles/{name}/description, hermes_cli/web_routers/profiles.py 1042-1053): the Engine trims it, stores it with
// description_auto false and answers what it kept, which is what the page then shows. The Engine sets no length limit.
/** @param {any} connection @param {{name:string,description:string}} change @returns {Promise<{state:'written',description:string}|{state:'refused'|'unreachable'|'failed',description:null}>} */
export async function writeAgentAbout(connection,{name,description}) {
 if(!agentName.test(name)||typeof description!=='string') return {state:'failed',description:null};
 if(!reachable(connection)) return {state:'unreachable',description:null};
 try {
  const written=await manage(connection,`/api/profiles/${encodeURIComponent(name)}/description`,{method:'PUT',body:{description}});
  if(!written.response.ok||written.result?.ok!==true) return {state:stepState(written),description:null};
  return typeof written.result.description==='string'?{state:'written',description:written.result.description}:{state:'failed',description:null};
 } catch { return {state:'unreachable',description:null}; }
}
const address=({address})=>address.replace(/\/$/,'');

// A Company's own profile in the Engine (ADR 0014): its own home, so its memory, skills, sessions and model sign-in,
// with the one fixed set of tools every Agent gets (lib/agent-toolsets.mjs). It is made in steps like an Agent's (ADR 0011):
// the profile with its soul, then its Run API key, then its tools; each step answers ok:true. The name is derived from
// the Company's id and reserved for that Company, so a profile already there under that name is a create that stopped
// part way: it is finished, never left held. A profile is never cloned from another, so it starts with no memory.
// The tools are read back from the profile's own Run API (/v1/toolsets, the toolsets a Run there gets), and a profile
// that still offers a toolset that must stay off fails, so the worker never attaches a Company to it.
const query=name=>`?profile=${encodeURIComponent(name)}`;
const stepState=step=>[401,403].includes(step.response.status)?'refused':'failed';
const noProfile=state=>({state,toolsets:null});
/** @param {any} connection @param {{name:string,soul:string,config:object,forbidden:string[],noSkills?:boolean}} profile */
export async function provideProfile(connection,{name,soul,config,forbidden,noSkills=false}) {
 if(!agentName.test(name)||typeof soul!=='string'||!config||typeof config!=='object'||!Array.isArray(forbidden)) return noProfile('failed');
 if(!reachable(connection)) return noProfile('unreachable');
 try {
  const made=await manage(connection,'/api/profiles',{method:'POST',body:{name,soul,...(noSkills?{no_skills:true}:{})}});
  const exists=made.response.status===400&&typeof made.result?.detail==='string'&&made.result.detail.includes('already exists');
  if(!exists&&!made.response.ok) return noProfile(made.response.status===400?'failed':refusal(made.response));
  if(!exists&&(made.result?.ok!==true||made.result.name!==name)) return noProfile('failed');
  const key=await manage(connection,`/api/env${query(name)}`,{method:'PUT',body:{key:'API_SERVER_KEY',value:connection.key}});
  if(!key.response.ok||key.result?.ok!==true) return noProfile(stepState(key));
  return await writeTools(connection,{name,config,forbidden});
 } catch { return noProfile('unreachable'); }
}
// A profile's tools are written again and read back after the worker found them different from the fixed set.
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
 const wanted=Array.isArray(config.platform_toolsets?.api_server)?config.platform_toolsets.api_server:null;
 // A name beside what was written may be one of the Company's own Apps' servers (#30), which the Engine can report as a
 // toolset of its own (`<server>` or `mcp-<server>`, lib/agent-toolsets.mjs appToolset). Only then is the profile's config
 // read, to know which servers gtmworks put there; one it cannot read is not judged, never wrongly failed.
 let apps=[];
 if(wanted!==null&&read.toolsets.some(toolset=>!wanted.includes(toolset))) {
  const held=await readProfileApps({...connection,profile:name});
  if(held.state!=='found') return noProfile(held.state);
  apps=held.apps;
 }
 // What the profile offers must be exactly what was written, its Apps aside: a tool the Engine kept on, and one it did not
 // turn on, both mean the write was not applied, so the profile is never recorded as confirmed.
 const offers=read.toolsets.filter(toolset=>!appToolset(toolset,apps));
 const differs=wanted!==null&&(offers.length!==new Set(wanted).size||wanted.some(toolset=>!offers.includes(toolset)));
 return differs||offers.some(toolset=>forbidden.includes(toolset))?{state:'failed',toolsets:read.toolsets}:{state:'configured',toolsets:read.toolsets};
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

// The Apps the profile holds (#30), by the Engine's own name for each server: gtmworks writes a connected App's MCP server
// into the profile's config (lib/app-catalogue.mjs appConfig), and the Engine may report that server as a toolset of its
// own beside the fixed set (`<server>`, or the registry's `mcp-<server>`). The catalogue's Apps and the servers an Owner
// added by address (#458, ADR 0021, read back as readApps does: any server key of the catalogue's shape) both count; a
// key of another shape is not one gtmworks wrote, so the tool check counts it as a difference. A server turned off is off.
// States as readToolsets' are.
/** @param {{address:string,profile:string,key:string,managementAddress?:string}} connection @returns {Promise<{state:'found',apps:string[]}|{state:'failed'|'refused'|'unreachable',apps:null}>} */
export async function readProfileApps(connection) {
 const none=state=>({state,apps:null});
 if(!reachable(connection)) return none('unreachable');
 try {
  const read=await manage(connection,`/api/config${query(connection.profile)}`);
  if(!read.response.ok) return none(refusal(read.response));
  const servers=read.result?.mcp_servers;
  if(servers===undefined||servers===null) return {state:'found',apps:[]};
  if(typeof servers!=='object'||Array.isArray(servers)) return none('failed');
  return {state:'found',apps:Object.entries(servers).filter(([key,server])=>(Boolean(appByKey(key))||appKey.test(key))&&server?.enabled!==false).map(([key])=>key)};
 } catch { return none('unreachable'); }
}

// Whether a Run on this profile can answer: the Engine lists the model providers this profile has a sign-in for, marks
// the profile's own provider is_current, and lists a current provider that lost its sign-in with authenticated:false
// (v0.23.0 GET /api/model/options, hermes_cli/web_routers/models.py 138-170 and inventory.py 731-746). A profile answers
// when its model is set and its current provider is listed without authenticated:false. The read may wait on the
// Engine's model catalogue (up to 15 s).
/** @param {any} connection @param {string} name @returns {Promise<'answers'|'noModel'|'refused'|'unreachable'>} */
async function canAnswer(connection,name) {
 try {
  const read=await manage(connection,`/api/model/options${query(name)}`,{timeout:20000});
  if(!read.response.ok) return [401,403].includes(read.response.status)?'refused':read.response.status===404?'noModel':'unreachable';
  const {model,providers}=read.result||{};
  const current=Array.isArray(providers)?providers.find(row=>row?.is_current===true):undefined;
  return typeof model==='string'&&model.trim()&&current&&current.authenticated!==false?'answers':'noModel';
 } catch { return 'unreachable'; }
}

// The models a Run on this profile may choose (#158): each model of each provider the Engine lists for it, but a provider
// that lost its sign-in (authenticated:false), and the profile's own provider and model, from the same read canAnswer
// makes. found, refused or unreachable; the list is empty unless found.
/** @param {any} connection @returns {Promise<import('./engine.mjs').AgentModels>} */
export async function readModels(connection) {
 const none=state=>({state,current:null,models:[]});
 if(!reachable(connection)) return none('unreachable');
 try {
  const read=await manage(connection,`/api/model/options${query(connection.profile)}`,{timeout:20000});
  if(!read.response.ok) return none(refusal(read.response));
  const {model,provider,providers}=read.result||{};
  if(!Array.isArray(providers)) return none('unreachable');
  const text=value=>typeof value==='string'&&value.trim()&&value.length<=200;
  const rows=providers.filter(row=>text(row?.slug)&&row.authenticated!==false&&Array.isArray(row.models));
  const served=await Promise.all(rows.map(row=>servedModels(connection,connection.profile,row.slug)));
  // served: the provider itself said it serves the model to this profile's key (#643).
  const models=rows.flatMap((row,at)=>keepServed(row.models.filter(text),served[at])
   .map(name=>({provider:row.slug,providerName:text(row.name)?row.name:row.slug,model:name,...served[at]?{served:/** @type {true} */(true)}:{}})));
  return {state:'found',current:text(provider)&&text(model)?{provider,model}:null,models};
 } catch { return none('unreachable'); }
}

// Each named profile's own model, as the Engine's profile list reports it (#29, ADR 0016): provider and model, or null for
// a profile the Engine lists with none. The config route's `model` is not this read: its value is a dict there
// (hermes_cli/web_routers/config_env.py 81-92, web_server_config.py 587-599), and PUT /api/profiles/<name>/model is the
// only route that sets it (profiles.py 1056-1068).
/** @param {any} connection @param {string[]} profiles */
export async function readProfileModels(connection,profiles) {
 const none=state=>({state,models:null});
 if(!Array.isArray(profiles)||!profiles.every(name=>typeof name==='string'&&agentName.test(name))) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const read=await manage(connection,'/api/profiles');
  if(!read.response.ok) return none(refusal(read.response));
  if(!Array.isArray(read.result?.profiles)) return none('failed');
  /** @type {Record<string,{provider:string,model:string}|null>} */
  const models={};
  for(const name of profiles) {
   const row=read.result.profiles.find(found=>found?.name===name);
   const provider=typeof row?.provider==='string'?row.provider:''; const model=typeof row?.model==='string'?row.model:'';
   models[name]=row&&provider&&model?{provider,model}:null;
  }
  return {state:'found',models};
 } catch { return none('unreachable'); }
}
// One profile's model written through the Engine's own route and read back from the profile list before it counts as
// saved. A profile the Engine does not serve, a refused key and an answer that keeps another model are states, never
// thrown.
/** @param {any} connection @param {{profile:string,provider:string,model:string}} change */
export async function writeProfileModel(connection,{profile,provider,model}) {
 const none=state=>({state,provider:null,model:null});
 if(!agentName.test(profile)||typeof provider!=='string'||!provider.trim()||typeof model!=='string'||!model.trim()) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const written=await manage(connection,`/api/profiles/${encodeURIComponent(profile)}/model`,{method:'PUT',body:{provider,model}});
  if(!written.response.ok||written.result?.ok!==true) return none(stepState(written));
  const found=await designProfiles(connection,[profile]);
  if(!found.designs) return none(found.state);
  const design=found.designs.get(profile);
  if(design) {
   const mirrored=await manage(connection,`/api/profiles/${encodeURIComponent(design)}/model`,{method:'PUT',body:{provider,model}});
   if(!mirrored.response.ok||mirrored.result?.ok!==true) return none(stepState(mirrored));
  }
  const after=await readProfileModels(connection,[profile]);
  if(after.state!=='found') return none(after.state);
  const saved=after.models?.[profile];
  return saved&&saved.provider===provider&&saved.model===model?{state:'saved',provider,model}:{state:'mismatch',provider:null,model:null};
 } catch { return none('unreachable'); }
}

// An Agent's own profile (ADR 0016), made as a Company's is: its soul, the connection's key as its Run API key, the one
// fixed set of tools every Agent gets, read back. Only an Agent's reserved name (ag-<agent id>) is provided, since a
// profile already there under it is finished, and finishing any other name would rewrite another profile's key and tools.
/** @param {any} connection @param {{name:string,instructions:string}} agent @returns {Promise<import('./engine.mjs').ProvidedAgent>} */
// `subagents` is the Agent's own sub-agents switch (#29): a profile made while it is on gets the delegation variant, so a
// move that records the switch as written has written it.
// `providers` names the Company's shared space and its keeper's profile: a profile that cannot answer yet is given the
// Company's Providers as they stand (giveProviders, #660), so an Agent Lead makes starts with no step from the Owner. One
// they give no model, or that could not be given them now, is made all the same and answers noModel.
async function provideAgent(connection,{name,instructions,subagents=false,providers}) {
 if(!isAgentProfile(name)||typeof instructions!=='string') return {state:'failed'};
 const config=toolConfig({profile:name,subagents:subagents===true});
 const made=await provideProfile(connection,{name,soul:instructions,config,forbidden:config.agent.disabled_toolsets});
 if(made.state!=='configured') return {state:made.state==='failed'&&made.toolsets?'forbidden':made.state==='missing'?'failed':made.state};
 const answers=await canAnswer(connection,name);
 if(!providers||!['answers','noModel'].includes(answers)) return {state:answers==='answers'?'provided':answers};
 // Given even to a profile that answers already, so it holds the Company's keys its Fallback model may need.
 const given=await giveProviders(connection,{name,...providers});
 return {state:given.state==='provided'||answers==='answers'?'provided':'noModel'};
}

// An Agent's own profile given the Company's Providers as they stand (#660, spec #611; GLOSSARY: Provider). A
// subscription needs nothing: it is the Engine root's, which every profile reads, in the Owner's order (ADR 0018, #621).
// Each API key the Company's shared space holds is read on the Engine's own reveal route and written straight into the
// profile, as an Agent's design profile is given its Agent's (designAccess): it never leaves this process or reaches a
// log. A profile with no model of its own, or one it cannot answer with, then takes the model the Company's keeper
// (Lead) runs on, or, when that one names none or a custom endpoint no route gives back, the first model the space lists
// for a key it holds. The Fallback model reaches it from the worker as it reaches every Agent's profile (#622).
// `provided` once the profile can answer; `noModel` when the Company has no account that gives it a model.
/** @param {any} connection @param {{name:string,space:string,keeper:string}} target @returns {Promise<import('./engine.mjs').ProvidedAgent>} */
async function giveProviders(connection,{name,space,keeper}) {
 if(!isAgentProfile(name)||typeof space!=='string'||!spaceName.test(space)||typeof keeper!=='string'||!keyProfile.test(keeper)||keeper.startsWith('cs-')) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const table=await providerTable(connection,space);
  if(table.state!=='found') return {state:spaceState(table.state)};
  const held=table.rows.filter(row=>row.set);
  const copied=await copyKeys(connection,{from:space,to:name,rows:held});
  if(copied) return {state:copied};
  // A model of the profile's own that answers is kept; one that cannot is replaced, as a missing one is.
  const before=await canAnswer(connection,name);
  if(before!=='noModel') return {state:before==='answers'?'provided':before};
  const models=await readProfileModels(connection,[name,keeper]);
  if(models.state!=='found') return {state:models.state};
  const own=models.models?.[name]; const lead=models.models?.[keeper];
  const pick=lead&&lead.provider!=='custom'?lead:await firstKeyModel(connection,space,held);
  if(!pick||own&&own.provider===pick.provider&&own.model===pick.model) return {state:'noModel'};
  const picked=await manage(connection,`/api/profiles/${encodeURIComponent(name)}/model`,{method:'PUT',body:{provider:pick.provider,model:pick.model}});
  if(!picked.response.ok||picked.result?.ok!==true) return {state:stepState(picked)};
  const answers=await canAnswer(connection,name);
  return {state:answers==='answers'?'provided':answers};
 } catch { return {state:'unreachable'}; }
}
// Each of `rows`, the provider keys one profile holds, read on the Engine's own reveal route and written straight into
// another profile: the value never leaves this process or reaches a log. Null when done, else the state it stopped in.
/** @param {any} connection @param {{from:string,to:string,rows:{env:string}[]}} copy */
async function copyKeys(connection,{from,to,rows}) {
 for(const row of rows) {
  const revealed=await revealEnv(connection,from,row.env);
  if(typeof revealed.value!=='string') return revealed.state;
  const written=await manage(connection,`/api/env${query(to)}`,{method:'PUT',body:{key:row.env,value:revealed.value}});
  if(!written.response.ok||written.result?.ok!==true) return stepState(written);
 }
 return null;
}
// One variable of a profile's .env, read on the Engine's reveal route: its value, or the state the read stopped in;
// `absent` when the Engine's 404 says the profile holds no such variable. The value stays in this process.
/** @param {any} connection @param {string} profile @param {string} key @returns {Promise<{value:string,state?:undefined,absent?:undefined}|{value:null,state:string,absent:boolean}>} */
async function revealEnv(connection,profile,key) {
 const revealed=await manage(connection,'/api/env/reveal',{method:'POST',body:{key,profile}});
 return revealed.response.ok&&typeof revealed.result?.value==='string'?{value:revealed.result.value}:{value:null,state:stepState(revealed),absent:revealed.response.status===404};
}
/** @param {any} connection @param {string} space @param {{provider:string}[]} held */
async function firstKeyModel(connection,space,held) {
 for(const row of held) {
  const model=await defaultModel(connection,space,row.provider);
  if(model) return {provider:row.provider,model};
 }
 return null;
}

// DELETE /api/profiles/<name> (v0.23.0 hermes_cli/web_routers/profiles.py 984-1002): ok is removed, also with
// settlement_pending, whose profile home is already gone; 404 is missing; 400 (the default profile, a name that is not a
// profile name) and a refused key are refused; anything else, such as the 500 of a gateway that still runs the profile,
// may pass and is unreachable. The Engine waits up to 10 s for the profile's gateway to stop.
/** @param {any} connection @param {string} name @returns {Promise<import('./engine.mjs').RemovedAgent>} */
async function removeAgent(connection,name) {
 if(typeof name!=='string'||!agentName.test(name)||name==='default') return {state:'refused'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const removed=await manage(connection,`/api/profiles/${encodeURIComponent(name)}`,{method:'DELETE',timeout:20000});
  // The Agent's Open Design profile (#544) goes with it, also when the Agent's own profile is already gone; one that cannot
  // be removed now leaves the removal unfinished, so it is asked again.
  if(removed.response.ok&&removed.result?.ok===true||removed.response.status===404) {
   const design=await removeDesignProfile(connection,name).catch(()=>'unreachable');
   if(design!=='disconnected') return {state:'unreachable'};
  }
  if(removed.response.ok&&removed.result?.ok===true) return {state:'removed'};
  if(removed.response.status===404) return {state:'missing'};
  return {state:[400,401,403].includes(removed.response.status)?'refused':'unreachable'};
 } catch { return {state:'unreachable'}; }
}

// A Company's shared space (ADR 0016), `cs-<company id>`: a profile made with no bundled Skills and never given a Run
// API key, so the Engine refuses every Run on it (v0.23.0 gateway/platforms/api_server.py 1413-1434). Its own Skills
// folder, as the Engine lists the profile's home, is the folder every Agent profile of the Company reads. A space
// already there under the reserved name is the same space.
const spaceName=/^cs-[0-9a-f]{32}$/;
/** @param {any} connection @param {{name:string}} space */
export async function provideSharedSpace(connection,{name}) {
 const none=state=>({state,folder:null});
 if(!spaceName.test(name)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const made=await manage(connection,'/api/profiles',{method:'POST',body:{name,no_skills:true}});
  const exists=made.response.status===400&&typeof made.result?.detail==='string'&&made.result.detail.includes('already exists');
  if(!exists&&(!made.response.ok||made.result?.ok!==true||made.result.name!==name)) return none(stepState(made));
  const listed=await manage(connection,'/api/profiles');
  if(!listed.response.ok) return none(stepState(listed));
  const home=Array.isArray(listed.result?.profiles)?listed.result.profiles.find(found=>found?.name===name)?.path:undefined;
  if(typeof home!=='string'||!home.startsWith('/')||!home.endsWith(`/${name}`)) return none('failed');
  return {state:'provided',folder:`${home}/skills`};
 } catch { return none('unreachable'); }
}
// The space's Skill as the Engine keeps it: found with its text, absent when the space has none by that name, missing
// when the Engine no longer has the space.
/** @param {any} connection @param {{space:string,name:string}} skill */
export async function readSharedSkill(connection,{space,name}) {
 if(!spaceName.test(space)||!agentName.test(name)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const read=await manage(connection,`/api/skills/content${query(space)}&name=${encodeURIComponent(name)}`);
  if(read.response.ok&&typeof read.result?.content==='string') return {state:'found',content:read.result.content};
  if(read.response.status===404) return {state:typeof read.result?.detail==='string'&&read.result.detail.includes('does not exist')?'missing':'absent'};
  return {state:stepState(read)};
 } catch { return {state:'unreachable'}; }
}
// One of a profile's own Skills' text (#181), as the Engine serves that profile's SKILL.md (v0.23.0
// hermes_cli/web_routers/skills.py 436-455): found with its text, absent when the profile has none by that name, and
// refused, unreachable or failed as every read is. Only a Company's or an Agent's own profile is asked.
/** @param {any} connection @param {{name:string}} skill */
export async function readOwnSkill(connection,{name}) {
 if(!ownProfile.test(connection.profile)||!agentName.test(name)) return {state:'failed',content:null};
 if(!reachable(connection)) return {state:'unreachable',content:null};
 try {
  const read=await manage(connection,`/api/skills/content${query(connection.profile)}&name=${encodeURIComponent(name)}`);
  if(read.response.ok&&typeof read.result?.content==='string') return {state:'found',content:read.result.content};
  if(read.response.status===404) return {state:'absent',content:null};
  return {state:stepState(read),content:null};
 } catch { return {state:'unreachable',content:null}; }
}
// The space's Skill, written through the space's own profile (v0.23.0 hermes_cli/web_routers/skills.py 436-483): made
// when the space has none, else rewritten whole, then read back. The same text is never written again. A space the
// Engine no longer has is missing.
// With onlyNew, a Skill the space already has is left as it is (unchanged).
/** @param {any} connection @param {{space:string,name:string,content:string,onlyNew?:boolean}} skill */
export async function writeSharedSkill(connection,{space,name,content,onlyNew=false}) {
 if(!spaceName.test(space)||!agentName.test(name)||typeof content!=='string') return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 const read=()=>manage(connection,`/api/skills/content${query(space)}&name=${encodeURIComponent(name)}`);
 try {
  const before=await read();
  if(before.response.ok&&(onlyNew||before.result?.content===content)) return {state:'unchanged'};
  if(before.response.status===404&&typeof before.result?.detail==='string'&&before.result.detail.includes('does not exist')) return {state:'missing'};
  if(!before.response.ok&&before.response.status!==404) return {state:stepState(before)};
  const written=before.response.ok?await manage(connection,`/api/skills/content${query(space)}`,{method:'PUT',body:{name,content}})
   :await manage(connection,`/api/skills${query(space)}`,{method:'POST',body:{name,content}});
  // Another worker made it first: the read-back decides.
  const raced=written.response.status===400&&typeof written.result?.detail==='string'&&written.result.detail.includes('already exists');
  if(!raced&&(!written.response.ok||written.result?.success!==true)) return {state:stepState(written)};
  const after=await read();
  return {state:after.response.ok&&after.result?.content===content?'written':'failed'};
 } catch { return {state:'unreachable'}; }
}
// The team's lasting rules (#18, #345) in a section of the Agent's profile SOUL.md that gtmworks owns, between its two
// markers: SOUL.md is loaded in every session and has no memory budget. Text outside the section is never changed; with
// no rules the section and the line break before it go. A rule is folded to one line and cannot close the section.
const rulesStart='<!-- gtmworks:rules -->'; const rulesEnd='<!-- /gtmworks:rules -->';
const rulesSection=new RegExp(`\\n?${rulesStart}[\\s\\S]*?${rulesEnd}\\n?`);
/** @param {string} soul @param {string[]} rules */
function soulWithRules(soul,rules) {
 if(!rules.length) return soul.replace(rulesSection,'');
 const block=[rulesStart,'## Rules the team gave you','The team told you the lasting rules below for your work in this company. Follow every one of them, in every reply, until the team removes it.','',
  ...rules.map(rule=>`- ${rule.replace(/\s+/g,' ').trim().replaceAll('-->','-- >')}`),rulesEnd].join('\n');
 return rulesSection.test(soul)?soul.replace(rulesSection,found=>`${found.startsWith('\n')?'\n':''}${block}${found.endsWith('\n')?'\n':''}`)
  :`${soul}${soul?'\n':''}${block}\n`;
}
// SOUL.md has two owners in gtmworks: the Owner's standing instructions (#176) and the team's rules section (#345). One
// way writes it, and it reads the file again just before writing, keeps the part the other owner holds as it is then,
// and replaces only its own part (v0.23.0 hermes_cli/web_routers/profiles.py 1005-1038). The Engine itself has no
// version or compare-and-swap, so the write is still a read then a write. A profile the Engine does not have is missing.
/** @param {any} connection @param {string} profile @param {(soul:string)=>string|null} change */
async function writeSoul(connection,profile,change) {
 const at=`/api/profiles/${encodeURIComponent(profile)}/soul`;
 const before=await manage(connection,at);
 if(before.response.status===404) return {state:'missing'};
 if(!before.response.ok||typeof before.result?.content!=='string') return {state:stepState(before)};
 const content=change(before.result.content);
 if(content===null) return {state:'failed'};
 if(content===before.result.content) return {state:'unchanged'};
 // shortcut: the Engine has no compare-and-swap, so this read then write is not atomic across the two owners of the
 // file. The rules section a write keeps is the one it re-read, and the worker rewrites its section on the next pass; a
 // save that lands inside another writer's millisecond gap can still be lost.
 const written=await manage(connection,at,{method:'PUT',body:{content}});
 return {state:written.response.ok&&written.result?.ok===true?'written':stepState(written)};
}
// Read, changed only in its section, and written back whole. The same text is never written again.
/** @param {any} connection @param {{profile:string,rules:string[]}} change */
export async function writeSoulRules(connection,{profile,rules}) {
 if(!/^(co|ag)-[0-9a-f]{32}$/.test(profile)||!Array.isArray(rules)||!rules.every(rule=>typeof rule==='string')) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try { return await writeSoul(connection,profile,soul=>soulWithRules(soul,rules)); } catch { return {state:'unreachable'}; }
}
// #434: a soul moves from one default text to another only while it still holds that text outside the team's rules
// section, which is kept; any other text is the Owner's own and stays as it is (unchanged).
/** @param {any} connection @param {{profile:string,from:string,to:string}} change */
export async function replaceSoulText(connection,{profile,from,to}) {
 if(!ownProfile.test(profile)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  return await writeSoul(connection,profile,soul=>{ const at=soul.match(rulesSection)?.index??soul.length; return soul.slice(0,at).trim()===from?`${to}${soul.slice(at)}`:soul; });
 } catch { return {state:'unreachable'}; }
}
// A Company's own profile or an Agent's reads the Company's shared folder and no other (skills.external_dirs), loads the
// shared Skill in each new session (skills.auto_load; v0.23.0 hermes_cli/config_defaults.py 1434 and 1445-1448) and
// holds it locked, so the Agent's own skill_manage refuses to change it (tools/skill_manager_guards.py 224-258). Both are
// read back. A lock the Engine cannot place, or a Skill the profile does not list at all, means the space or its Skill
// was lost: missing.
/** @param {any} connection @param {{profile:string,folder:string,skill:string}} sharing */
export async function shareSkills(connection,{profile,folder,skill}) {
 if(!/^(co|ag)-[0-9a-f]{32}$/.test(profile)||typeof folder!=='string'||!folder.startsWith('/')||!agentName.test(skill)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 const at=query(profile);
 try {
  const config=await manage(connection,`/api/config${at}`);
  if(!config.response.ok) return {state:stepState(config)};
  const loaded=Array.isArray(config.result?.skills?.auto_load)?config.result.skills.auto_load.filter(name=>typeof name==='string'&&name!==skill):[];
  const written=await manage(connection,`/api/config${at}`,{method:'PUT',body:{config:{skills:{external_dirs:[folder],auto_load:[...loaded,skill]}}}});
  if(!written.response.ok||written.result?.ok!==true) return {state:stepState(written)};
  const locked=await manage(connection,`/api/skills/lock${at}`,{method:'PUT',body:{name:skill,locked:true}});
  if(locked.response.status===404) return {state:'missing'};
  if(!locked.response.ok||locked.result?.ok!==true||locked.result.locked!==true) return {state:stepState(locked)};
  const [kept,listed]=[await manage(connection,`/api/config${at}`),await manage(connection,`/api/skills${at}`)];
  for(const read of [kept,listed]) if(!read.response.ok) return {state:stepState(read)};
  const dirs=kept.result?.skills?.external_dirs; const loads=kept.result?.skills?.auto_load;
  if(!Array.isArray(dirs)||dirs.length!==1||dirs[0]!==folder||!Array.isArray(loads)||!loads.includes(skill)) return {state:'failed'};
  const found=Array.isArray(listed.result)?listed.result.find(row=>row?.name===skill):undefined;
  // A Skill of the profile's own under the same name comes first (v0.23.0 agent/skill_utils.py 402-424): it is kept, and
  // only this profile stays unconfirmed.
  if(found&&found.provenance!=='external') return {state:'shadowed'};
  if(!found) return {state:'missing'};
  return {state:found.locked===true?'shared':'failed'};
 } catch { return {state:'unreachable'}; }
}

// A profile's settings (#125, ADR 0016), read and written through the Engine's config routes (v0.23.0
// hermes_cli/web_routers/config_env.py 81-161). The read merges the Engine's defaults over what the profile saved unless
// include_defaults=false asks for the saved values alone; the defaults route takes no profile; the schema gives each
// field's type and choices. A write deep-merges, so it states only its own keys (config.py 1373-1388), and is checked by
// the read-back its caller makes, never by a 200 alone.
const configState=state=>({state,config:null});
/** @param {any} connection */
export async function readConfig(connection) { return readConfigAt(connection,`/api/config${query(connection.profile)}`); }
/** @param {any} connection */
export async function readSavedConfig(connection) { return readConfigAt(connection,`/api/config${query(connection.profile)}&include_defaults=false`); }
async function readConfigAt(connection,path) {
 if(!agentName.test(connection.profile)) return configState('failed');
 if(!reachable(connection)) return configState('unreachable');
 try {
  const read=await manage(connection,path);
  if(!read.response.ok) return configState(refusal(read.response));
  if(!read.result||typeof read.result!=='object'||Array.isArray(read.result)) return configState('failed');
  return {state:'found',config:read.result};
 } catch { return configState('unreachable'); }
}
/** @param {any} connection */
export async function readConfigDefaults(connection) {
 if(!reachable(connection)) return configState('unreachable');
 try {
  const read=await manage(connection,'/api/config/defaults');
  if(!read.response.ok) return configState(refusal(read.response));
  if(!read.result||typeof read.result!=='object'||Array.isArray(read.result)) return configState('failed');
  return {state:'found',config:read.result};
 } catch { return configState('unreachable'); }
}
/** @param {any} connection */
export async function readConfigSchema(connection) {
 const none=state=>({state,schema:null});
 if(!agentName.test(connection.profile)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const read=await manage(connection,`/api/config/schema${query(connection.profile)}`);
  if(!read.response.ok) return none(refusal(read.response));
  if(!read.result?.fields||typeof read.result.fields!=='object'||Array.isArray(read.result.fields)) return none('failed');
  return {state:'found',schema:read.result};
 } catch { return none('unreachable'); }
}
/** @param {any} connection @param {object} config */
export async function writeConfig(connection,config) {
 if(!agentName.test(connection.profile)||!config||typeof config!=='object'||Array.isArray(config)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const written=await manage(connection,`/api/config${query(connection.profile)}`,{method:'PUT',body:{config}});
  if(!written.response.ok) return {state:written.response.status===404?'failed':refusal(written.response)};
  return {state:written.result?.ok===true?'written':'failed'};
 } catch { return {state:'unreachable'}; }
}

// A profile's fallback chain (#622, GLOSSARY: Fallback model): the providers its Runs move to once the credential pool
// of the chosen model's provider cannot recover (v0.23.0 agent/turn_recovery.py; the Run API loads the chain from the
// profile's own config.yaml for every Run, gateway/platforms/api_server.py 2245). The Engine takes the chain from
// `fallback_providers` and the older `fallback_model` together (hermes_cli/fallback_config.py get_fallback_chain), so
// both are read; an entry is provider and model, and anything else in it is not one gtmworks wrote. The write replaces
// `fallback_providers` whole (a config write replaces a list, config.py 1373-1388), and clears an older `fallback_model`
// that still holds an entry, with a list, as a value of None over a dict section is ignored there.
/** @param {unknown} raw @returns {{provider:string,model:string}[]} */
const chainEntries=raw=>(Array.isArray(raw)?raw:raw&&typeof raw==='object'?[raw]:[]).flatMap(entry=>{
 const provider=typeof entry?.provider==='string'?entry.provider.trim():''; const model=typeof entry?.model==='string'?entry.model.trim():'';
 return provider&&model?[{provider,model}]:[];
});
/** @param {any} connection @returns {Promise<{state:'found',chain:{provider:string,model:string}[],legacy:boolean}|{state:'refused'|'unreachable'|'failed',chain:null,legacy:false}>} */
export async function readFallbackChain(connection) {
 const read=await readSavedConfig(connection);
 if(read.state!=='found') return {state:/** @type {'refused'|'unreachable'|'failed'} */(read.state),chain:null,legacy:false};
 const legacy=chainEntries(read.config.fallback_model);
 return {state:'found',chain:[...chainEntries(read.config.fallback_providers),...legacy],legacy:legacy.length>0};
}
/** @param {any} connection @param {{chain:{provider:string,model:string}[],legacy?:boolean}} change */
export async function writeFallbackChain(connection,{chain,legacy=false}) {
 if(!Array.isArray(chain)||chain.some(entry=>typeof entry?.provider!=='string'||typeof entry?.model!=='string')) return {state:'failed'};
 const written=await writeConfig(connection,{fallback_providers:chain.map(({provider,model})=>({provider,model})),...(legacy?{fallback_model:[]}:{})});
 if(written.state!=='written') return written;
 const after=await readFallbackChain(connection);
 if(after.state!=='found') return {state:after.state};
 return {state:sameChain(after.chain,chain)?'saved':'mismatch'};
}
/** @param {{provider:string,model:string}[]} one @param {{provider:string,model:string}[]} other */
export const sameChain=(one,other)=>one.length===other.length&&one.every((entry,at)=>entry.provider===other[at].provider&&entry.model===other[at].model);

// An Agent's standing permissions (#166) are its own profile's command_allowlist, the list every "always" answer adds to
// (tools/approval.py _persist_choice; hermes_cli/config_defaults.py 1685-1686): gtmworks keeps no copy. A missing or
// empty list is none; anything but a list of strings is one the Engine itself ignores (_read_permanent_allowlist), and
// reads as failed rather than as none. Revoking one entry writes the list back without it — the config write replaces a
// list whole (config.py _deep_merge 1373-1388) — and reads it back, and the Engine stops honouring it at its next check,
// with no restart (_sync_permanent_from_disk 376-391). An entry already gone is gone, and nothing is written.
const allowlistState=state=>({state,entries:null});
/** @param {any} connection @returns {Promise<import('./engine.mjs').StandingPermissions>} */
export async function readStandingPermissions(connection) {
 if(!ownProfile.test(connection.profile)) return allowlistState('failed');
 const read=await readConfig(connection);
 if(read.state!=='found') return allowlistState(read.state==='missing'?'failed':read.state);
 const list=read.config.command_allowlist;
 if(list==null) return {state:'found',entries:[]};
 if(!Array.isArray(list)||list.some(entry=>typeof entry!=='string')) return allowlistState('failed');
 return {state:'found',entries:[...new Set(/** @type {string[]} */(list))]};
}
/** @param {any} connection @param {{entry:string,keep?:string[]}} change @returns {Promise<import('./engine.mjs').StandingRevoke>} */
export async function revokeStandingPermission(connection,{entry,keep=[]}) {
 if(!ownProfile.test(connection.profile)||typeof entry!=='string'||!entry) return {state:'failed'};
 // What this guarantees, and what it cannot: the pinned Engine has no route that removes one entry and no conditional
 // write (its config route replaces the list whole and shares no lock with its own save of an always answer:
 // tools/approval.py save_permanent_allowlist; config_env.py's _CONFIG_MUTATION_LOCK is the route's alone). So the
 // write is made safe for the writers gtmworks knows: `keep` names the always answers gtmworks is delivering or the
 // Engine just took, written back with the list, and the caller runs one revoke of a profile at a time
 // (lib/standing-permissions.mjs). The list is read twice and written only when both reads agree (three times at most),
 // and the read-back must hold every entry written. A grant made outside gtmworks (the Engine's own dashboard or command
 // line) in the instant between the last read and the write can still be overwritten; `revoked` means the entry is gone
 // and every entry gtmworks knew of is kept, not more. An atomic removal needs the Engine to offer one (#503).
 const same=(a,b)=>a.length===b.length&&a.every((each,index)=>each===b[index]);
 for(let attempt=0;attempt<3;attempt++) {
  const read=await readStandingPermissions(connection);
  if(read.state!=='found') return {state:read.state};
  if(!read.entries.includes(entry)) return {state:'gone'};
  const again=await readStandingPermissions(connection);
  if(again.state!=='found') return {state:again.state};
  if(!same(read.entries,again.entries)) continue;
  const kept=[...new Set([...read.entries,...keep.filter(each=>typeof each==='string'&&each)])].filter(each=>each!==entry);
  // From here the write was sent: an answer lost on the way, or a read-back that fails, may hide a write the Engine took,
  // and a write the Engine never confirmed may still land later (it runs the write on a worker thread of its own).
  // `removed` says what is known of the entry afterwards: 'no' only when the Engine confirmed the write and a read-back
  // still shows the entry; 'yes' when a read-back no longer shows it; else 'maybe'. `unconfirmed` is apart from it: a
  // write the Engine never confirmed may still land, even when another writer took the entry out before the read-back.
  const written=await writeConfig(connection,{command_allowlist:kept});
  const back=await readStandingPermissions(connection);
  if(written.state!=='written') return {state:written.state,removed:back.state==='found'&&!back.entries.includes(entry)?'yes':'maybe',unconfirmed:true};
  if(back.state!=='found') return {state:back.state,removed:'maybe'};
  if(back.entries.includes(entry)) return {state:'failed',removed:'no'};
  return {state:kept.every(each=>back.entries.includes(each))?'revoked':'failed',removed:'yes'};
 }
 return {state:'failed'};
}

// An Agent's standing instructions (#176) are the text of its own profile's SOUL.md outside the team's rules section: the
// Owner edits only that text, and the section is kept as it stands when the save lands. The Engine loads at most
// context_file_max_chars when the profile sets a positive one, else its floor of 20,000 characters (v0.23.0
// agent/prompt_builder.py 1033, 1043-1048, 1051-1054); the section counts against that size.
const instructionsFloor=20000;
const soulSection=soul=>soul.match(rulesSection)?.[0].replace(/^\n/,'').replace(/\n$/,'')||'';
const soulOutside=soul=>{const found=soul.match(rulesSection);return(found?soul.slice(0,found.index):soul).replace(/\n+$/,'');};
const instructionsLimit=config=>{const set=Number(config?.context_file_max_chars);return Number.isFinite(set)&&set>0?Math.floor(set):instructionsFloor;};
const noInstructions=(state,limit=instructionsFloor)=>({state,instructions:'',sectionChars:0,limit});
// The Owner's text as the Engine holds it, with the current section's size and the size the Engine loads.
/** @param {any} connection @param {string} name @returns {Promise<{state:'found',instructions:string,sectionChars:number,limit:number}|{state:'missing'|'refused'|'unreachable'|'failed',instructions:string,sectionChars:number,limit:number}>} */
export async function readAgentInstructions(connection,name) {
 if(!agentName.test(name)) return noInstructions('missing');
 if(!reachable(connection)) return noInstructions('unreachable');
 try {
  const at=`/api/profiles/${encodeURIComponent(name)}`;
  const [soul,config]=await Promise.all([manage(connection,`${at}/soul`),manage(connection,`/api/config${query(name)}`)]);
  if(soul.response.status===404) return noInstructions('missing');
  if(!soul.response.ok||typeof soul.result?.content!=='string') return noInstructions(stepState(soul));
  const content=soul.result.content;
  // A config that cannot be read leaves the Engine's own floor in place.
  return {state:'found',instructions:soulOutside(content),sectionChars:soulSection(content).length,limit:config.response.ok?instructionsLimit(config.result):instructionsFloor};
 } catch { return noInstructions('unreachable'); }
}
// The Owner's save replaces the text outside the rules section and keeps the section as it is when the write lands. It
// refuses text that, with the section, is larger than the Engine loads. The same text is never written again.
/** @param {any} connection @param {{profile:string,instructions:string}} change
 * @returns {Promise<{state:'written',instructions:string,sectionChars:number,limit:number}|{state:'tooLong'|'missing'|'refused'|'unreachable'|'failed',instructions:null,sectionChars:number,limit:number}>} */
export async function writeAgentInstructions(connection,{profile,instructions}) {
 if(!ownProfile.test(profile)||typeof instructions!=='string') return {state:'failed',instructions:null,sectionChars:0,limit:instructionsFloor};
 if(!reachable(connection)) return {state:'unreachable',instructions:null,sectionChars:0,limit:instructionsFloor};
 try {
  const config=await manage(connection,`/api/config${query(profile)}`);
  const limit=config.response.ok?instructionsLimit(config.result):instructionsFloor;
  let sectionChars=0, kept=null, tooLong=false;
  const result=await writeSoul(connection,profile,soul=>{
   const found=soul.match(rulesSection);
   sectionChars=soulSection(soul).length;
   if(instructions.length+sectionChars>limit) { tooLong=true; return null; }
   kept=instructions;
   return found?`${instructions}${instructions?'\n':''}${soul.slice(found.index).replace(/^\n/,'')}`:instructions;
  });
  if(tooLong) return {state:'tooLong',instructions:null,sectionChars,limit};
  if(result.state!=='written'&&result.state!=='unchanged') return {state:result.state,instructions:null,sectionChars,limit};
  return {state:'written',instructions:kept??'',sectionChars,limit};
 } catch { return {state:'unreachable',instructions:null,sectionChars:0,limit:instructionsFloor}; }
}

// An Agent's voice (#162): the words the Engine speaks for a profile with its saved voice and speed, and the list of
// voices it offers for the profile's provider. The Engine offers a list only for ElevenLabs (v0.23.0
// hermes_cli/web_routers/audio.py 223-295); every other provider answers the saved voice alone. Its voice-config route is
// never read here: it returns provider keys (ADR 0017). The sound comes back base64 inside the JSON answer, so a long
// sentence can pass the 4 MB reading cap: that is `tooLarge`, never a truncated sound.
export const speakLimit=600;
/** @param {any} connection */
export async function readVoices(connection) {
 const none=state=>({state,available:false,voices:[]});
 if(!agentName.test(connection.profile)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const read=await manage(connection,`/api/audio/elevenlabs/voices${query(connection.profile)}`);
  if(!read.response.ok) return none(refusal(read.response));
  if(!read.result||typeof read.result!=='object'||Array.isArray(read.result)) return none('failed');
  const voices=Array.isArray(read.result.voices)?read.result.voices.map(voice=>({id:typeof voice?.voice_id==='string'?voice.voice_id:'',
   name:typeof voice?.name==='string'&&voice.name?voice.name:typeof voice?.label==='string'?voice.label:'',label:typeof voice?.label==='string'?voice.label:''})).filter(voice=>voice.id):[];
  // The Engine's own line for a provider it cannot list (its key is missing or was refused) is kept as words, not a state.
  const error=typeof read.result.error==='string'?read.result.error:null;
  return {state:'found',available:read.result.available===true,voices,...(error?{error}:{})};
 } catch { return none('unreachable'); }
}
/** @param {any} connection @param {{text:string}} say @returns {Promise<{state:'spoken',dataUrl:string,mimeType:string|null,provider:string|null}|{state:'refused'|'unreachable'|'failed'|'tooLarge',dataUrl:null,mimeType:null,provider:null}>} */
export async function speakText(connection,{text}) {
 const none=state=>({state,dataUrl:null,mimeType:null,provider:null});
 if(!agentName.test(connection.profile)||typeof text!=='string'||!text.trim()||text.length>speakLimit) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  // Synthesis is slower than a setting write: the Engine builds the whole sound before it answers.
  const spoken=await manage(connection,`/api/audio/speak${query(connection.profile)}`,{method:'POST',body:{text},timeout:30000});
  if(spoken.result===tooLarge) return none('tooLarge');
  if(!spoken.response.ok) return none(stepState(spoken));
  const dataUrl=spoken.result?.data_url;
  if(spoken.result?.ok!==true||typeof dataUrl!=='string'||!dataUrl.startsWith('data:')) return none('failed');
  return {state:'spoken',dataUrl,mimeType:typeof spoken.result.mime_type==='string'?spoken.result.mime_type:null,
   provider:typeof spoken.result.provider==='string'?spoken.result.provider:null};
 } catch { return none('unreachable'); }
}

// An Agent's skills are its profile's own (#343, ADR 0011): listed as the Engine lists them, in its order, each with what
// the Engine says of it (v0.23.0 hermes_cli/web_routers/skills.py). The shared folder's skills are marked shared and
// kept off every page's own list (#180). The Engine's essential skill (#180: agent/skill_utils.py ESSENTIAL_SKILLS) is
// always on and carries the Engine's name, which no page may show, so it is left out here. Only a Company's or an
// Agent's profile is read.
const ownProfile=/^(co|ag)-[0-9a-f]{32}$/;
export const essentialSkill='hermes-agent';
/** @param {any} connection */
export async function readSkills(connection) {
 const none=state=>({state,skills:null});
 if(!ownProfile.test(connection.profile)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const listed=await manage(connection,`/api/skills${query(connection.profile)}`);
  if(!listed.response.ok) return none(refusal(listed.response));
  if(!Array.isArray(listed.result)) return none('failed');
  return {state:'found',skills:listed.result.filter(row=>typeof row?.name==='string'&&row.name!==essentialSkill).map(row=>({
   name:row.name,description:typeof row.description==='string'?row.description:'',category:typeof row.category==='string'?row.category:null,
   locked:row.locked===true,provenance:typeof row.provenance==='string'?row.provenance:'agent',shared:row.provenance==='external',enabled:row.enabled!==false}))};
 } catch { return none('unreachable'); }
}

// What the Engine says an Agent learned on its own (#180): the skill nodes of its learning graph whose `createdBy` is
// "agent" (v0.23.0 web_routers/status.py 746, agent/learning_graph.py 218-245). `createdBy` covers agent-written and
// hand-made skills alike, so it is the Engine's own claim, not proof. Names only: the page draws the mark, no version.
/** @param {any} connection */
export async function readLearningGraph(connection) {
 const none=state=>({state,learned:null});
 if(!ownProfile.test(connection.profile)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const graph=await manage(connection,`/api/learning/graph${query(connection.profile)}`);
  if(!graph.response.ok) return none(refusal(graph.response));
  if(!Array.isArray(graph.result?.nodes)) return none('failed');
  return {state:'found',learned:graph.result.nodes.filter(node=>node?.kind==='skill'&&node.createdBy==='agent'&&typeof node.id==='string').map(node=>node.id)};
 } catch { return none('unreachable'); }
}
// A SKILL.md written into the profile's own skills: made when it has none of that name, else rewritten whole, then read
// back. A skill of the shared folder is never written from here. In this and the four changes below, an answer given
// before the Engine was asked to change anything carries unsent, so a failed or unreachable one is known to have
// changed nothing (#370: lib/agent-change-log.mjs keeps the held log record of any other).
/** @param {any} connection @param {{name:string,content:string}} skill */
export async function writeSkill(connection,{name,content}) {
 if(!ownProfile.test(connection.profile)||!agentName.test(name)||typeof content!=='string') return {state:'failed',unsent:true};
 const listed=await readSkills(connection);
 if(listed.state!=='found') return {state:listed.state,unsent:true};
 const found=listed.skills.find(skill=>skill.name===name);
 if(found?.shared) return {state:'shared'};
 const at=query(connection.profile);
 try {
  const written=found?await manage(connection,`/api/skills/content${at}`,{method:'PUT',body:{name,content}})
   :await manage(connection,`/api/skills${at}`,{method:'POST',body:{name,content}});
  if(!written.response.ok||written.result?.success!==true) return {state:stepState(written)};
  // The Engine acknowledged the write: a read-back that fails or differs is still answered as failed, and says the
  // write itself was taken (acknowledged), so its held log record is finished (#370).
  const after=await manage(connection,`/api/skills/content${at}&name=${encodeURIComponent(name)}`).catch(()=>null);
  return after?.response.ok&&after.result?.content===content?{state:'written'}:{state:'failed',acknowledged:true};
 } catch { return {state:'unreachable'}; }
}

// One of the profile's own skills switched off or on for that profile alone (v0.23.0 web_routers/skills.py 418,
// PUT /api/skills/toggle: the profile's skills.disabled). A skill of the shared folder is never switched from here, and
// the Engine's essential skill is always on: it is refused here, before the Engine is asked (#180).
/** @param {any} connection @param {{name:string,enabled:boolean}} skill */
export async function setSkillEnabled(connection,{name,enabled}) {
 if(!ownProfile.test(connection.profile)||!agentName.test(name)||typeof enabled!=='boolean') return {state:'failed',unsent:true};
 if(name===essentialSkill) return {state:'essential'};
 const listed=await readSkills(connection);
 if(listed.state!=='found') return {state:listed.state,unsent:true};
 const found=listed.skills.find(skill=>skill.name===name);
 if(!found) return {state:'failed',unsent:true};
 if(found.shared) return {state:'shared'};
 try {
  const toggled=await manage(connection,`/api/skills/toggle${query(connection.profile)}`,{method:'PUT',body:{name,enabled}});
  return {state:toggled.response.ok&&toggled.result?.ok===true&&toggled.result.enabled===enabled?'changed':stepState(toggled)};
 } catch { return {state:'unreachable'}; }
}

// An Agent's memory (#350) belongs to its own profile (ADR 0016, ADR 0017) and to nothing else: the learning graph lists
// that profile's notes beside its skills (v0.23.0 GET /api/learning/graph?profile=, agent/learning_graph.py
// build_learning_graph), each note named `memory:<source>:<index>:<fingerprint>`, and one note's text is read on its own
// (GET /api/learning/node?id=&profile=, agent/learning_mutations.py node_detail). A skill is never read: only an id that
// starts with `memory:` is ever asked for, and an answer that is not a memory note is refused. gtmworks keeps no copy.
// shortcut: a memory is a few thousand characters in total, so 200 notes is more than a profile can hold; upgrade if
// the Engine ever lets one grow that long.
const memoryId=/^memory:(memory|profile):\d{1,9}(:[0-9a-f]{12})?$/;
const mostNotes=200;
/** @param {any} connection @returns {Promise<import('./engine.mjs').MemoryNotes>} */
export async function readMemoryNotes(connection) {
 const none=state=>({state,notes:null});
 if(!ownProfile.test(connection.profile)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const graph=await manage(connection,`/api/learning/graph${query(connection.profile)}`);
  if(!graph.response.ok) return none(refusal(graph.response));
  if(!Array.isArray(graph.result?.nodes)) return none('failed');
  const ids=[...new Set(graph.result.nodes.filter(node=>node?.kind==='memory'&&typeof node.id==='string'&&memoryId.test(node.id)).map(node=>node.id))].slice(0,mostNotes);
  const notes=[];
  for(const id of ids) {
   const read=await manage(connection,`/api/learning/node${query(connection.profile)}&id=${encodeURIComponent(id)}`);
   // A note removed since the graph was drawn is no longer the memory's, and is left out.
   if(read.response.status===404) continue;
   if(!read.response.ok) return none(refusal(read.response));
   // Only a memory note is taken: a skill's SKILL.md is never part of an Agent's memory, whatever its id.
   if(read.result?.kind!=='memory'||read.result.id!==id||typeof read.result.content!=='string') return none('failed');
   notes.push({id,text:read.result.content});
  }
  return {state:'found',notes};
 } catch { return none('unreachable'); }
}
// A reset deletes that one profile's MEMORY.md and USER.md (v0.23.0 POST /api/memory/reset, ops.py 535-553) and leaves
// its skills as they are. The Engine refuses a reset with no profile while its backend serves several, so the profile is
// always sent; the database keeps the person to an active Owner of the Agent's Company (log_memory_reset).
/** @param {any} connection @returns {Promise<import('./engine.mjs').MemoryReset>} */
export async function resetMemory(connection) {
 if(!ownProfile.test(connection.profile)) return {state:'failed',unsent:true};
 if(!reachable(connection)) return {state:'unreachable',unsent:true};
 try {
  const reset=await manage(connection,`/api/memory/reset${query(connection.profile)}`,{method:'POST',body:{target:'all'}});
  if(reset.response.status===400) return {state:'refused'};
  return {state:reset.response.ok&&reset.result?.ok===true?'reset':stepState(reset)};
 } catch { return {state:'unreachable'}; }
}

// The Engine's answer to a change of one note, as the contract's own words: a 400 that names a stale id is `stale`, any
// other 400 a refusal (an empty note, one over the memory's budget), and anything else read as any other step is.
/** @param {{response:Response,result:any}} answer @returns {'changed'|'stale'|'refused'|'failed'|'unreachable'} */
function noteChange(answer) {
 if(answer.response.ok&&answer.result?.ok===true) return 'changed';
 const detail=typeof answer.result?.detail==='string'?answer.result.detail:typeof answer.result?.message==='string'?answer.result.message:'';
 if(answer.response.status===400&&detail.includes('stale')) return 'stale';
 if(answer.response.status===400) return 'refused';
 return stepState(answer);
}

// An edit rewrites one note by the exact id the Engine gave it (v0.23.0 PUT /api/learning/node, status.py 791-795,
// agent/learning_mutations.py _edit_memory). The text is the whole note. An id that is not a memory note's is refused
// before the Engine is asked, so a skill is never named here; an empty note is refused as the Engine refuses it; and a
// note that changed since the graph was read answers 400 "memory node id is stale", which is `stale`, never guessed at.
/** @param {any} connection @param {{note:string,text:string}} change @returns {Promise<import('./engine.mjs').MemoryEdit>} */
export async function editMemoryNote(connection,{note,text}) {
 if(!ownProfile.test(connection.profile)||typeof note!=='string'||!memoryId.test(note)||typeof text!=='string') return {state:'failed',unsent:true};
 if(!text.trim()) return {state:'refused'};
 if(!reachable(connection)) return {state:'unreachable',unsent:true};
 try {
  const changed=noteChange(await manage(connection,`/api/learning/node${query(connection.profile)}`,{method:'PUT',body:{id:note,content:text}}));
  return {state:changed==='changed'?'edited':changed};
 } catch { return {state:'unreachable'}; }
}
// A removal deletes one note by the same id (v0.23.0 DELETE /api/learning/node, agent/learning_mutations.py
// _delete_memory). A memory is rewritten in its file; a skill would be archived, so any id that is not a memory note's
// is refused before the Engine is asked.
/** @param {any} connection @param {{note:string}} change @returns {Promise<import('./engine.mjs').MemoryForget>} */
export async function forgetMemoryNote(connection,{note}) {
 if(!ownProfile.test(connection.profile)||typeof note!=='string'||!memoryId.test(note)) return {state:'failed',unsent:true};
 if(!reachable(connection)) return {state:'unreachable',unsent:true};
 try {
  const changed=noteChange(await manage(connection,`/api/learning/node${query(connection.profile)}`,{method:'DELETE',body:{id:note}}));
  return {state:changed==='changed'?'forgotten':changed};
 } catch { return {state:'unreachable'}; }
}

// An Agent's Routines (#31) are the cron jobs of its own Engine profile (ADR 0016, decision of 2026-11-16): the Engine
// schedules and runs them, and gtmworks keeps no copy. Every call names the profile (v0.23.0 hermes_cli/web_routers/
// cron.py: list 735, create 750, update 781, pause 786, resume 791, trigger 796, delete 806, each with ?profile=). For a
// job's own routes the Engine takes the profile as a hint only and acts on whichever profile holds the id
// (_job_owner_profile), so a job is first found in this profile's own list, and an id that is not there is never sent:
// one Agent's Routine can never be changed through another's.
const routineId=/^[0-9a-f]{6,64}$/;
const textOf=value=>typeof value==='string'?value:'';
const timeOf=value=>typeof value==='string'&&!Number.isNaN(Date.parse(value))?new Date(value).toISOString():null;
/** @param {any} job @returns {import('./engine.mjs').Routine} */
function routineOf(job) {
 const schedule=job.schedule&&typeof job.schedule==='object'?job.schedule:{};
 const on=job.enabled!==false&&job.state!=='paused';
 return {id:job.id,name:textOf(job.name),prompt:textOf(job.prompt),
  schedule:{kind:typeof schedule.kind==='string'?schedule.kind:'unknown',expr:typeof schedule.expr==='string'?schedule.expr:null,
   minutes:Number.isSafeInteger(schedule.minutes)?schedule.minutes:null,display:cleanPreview(job.schedule_display??schedule.display)},
  timezone:typeof job.timezone==='string'&&job.timezone?job.timezone:null,on,
  state:['scheduled','paused','running','completed','error'].includes(job.state)?job.state:on?'scheduled':'paused',
  nextRunAt:on?timeOf(job.next_run_at):null,lastRunAt:timeOf(job.last_run_at),
  lastStatus:job.last_status==null?null:job.last_status==='ok'?'ok':'failed',lastError:cleanPreview(job.last_error)};
}
const ownJob=(job,profile)=>job&&typeof job==='object'&&typeof job.id==='string'&&routineId.test(job.id)&&(job.profile===undefined||job.profile===profile);
/** @param {any} connection @returns {Promise<import('./engine.mjs').RoutineList>} */
export async function readRoutines(connection) {
 const none=state=>({state,routines:null});
 if(!ownProfile.test(connection.profile)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const listed=await manage(connection,`/api/cron/jobs${query(connection.profile)}`);
  if(!listed.response.ok) return none(refusal(listed.response));
  if(!Array.isArray(listed.result)) return none('failed');
  // The list asked for one profile holds that profile's jobs alone; any other is dropped, never shown as this Agent's.
  // Every one is kept (the body is bounded by boundedJson), so a change can always find the Routine it names.
  return {state:'found',routines:listed.result.filter(job=>ownJob(job,connection.profile)).map(routineOf)};
 } catch { return none('unreachable'); }
}
// A schedule gtmworks sends: a five-field cron expression of plain numbers (what Settings writes), checked before the
// Engine is asked, and an IANA zone the person's clock is in, which the Engine checks again.
const cronExpression=/^[0-9*,/-]{1,20}( [0-9*,/-]{1,20}){4}$/;
const zoneName=/^[A-Za-z_+-]{1,40}(\/[A-Za-z0-9_+-]{1,40}){0,2}$/;
// An interval as the Engine writes one ("every 720m"), which a Routine moved with its Agent keeps (#182).
const intervalSchedule=/^every [1-9]\d{0,5}m$/;
// Whether a listed job's schedule is the one a create sent: its cron expression, or an interval of the same minutes.
/** @param {{expr:string|null,minutes:number|null}} listed @param {string} sent */
const sameSchedule=(listed,sent)=>listed.expr===sent||(listed.expr===null&&intervalSchedule.test(sent)&&listed.minutes===Number(sent.slice(6,-1)));
/** @param {unknown} schedule */
export const isRoutineSchedule=schedule=>typeof schedule==='string'&&cronExpression.test(schedule);
/** @param {any} connection @param {string} id */
async function ownRoutine(connection,id) {
 if(!ownProfile.test(connection.profile)||typeof id!=='string'||!routineId.test(id)) return {state:'failed'};
 const listed=await readRoutines(connection);
 if(listed.state!=='found') return {state:listed.state};
 return listed.routines.some(routine=>routine.id===id)?{state:'found'}:{state:'missing'};
}
/** @param {{response:Response,result:any}} answer @param {string} profile */
const routineAnswer=(answer,profile)=>{
 if(answer.response.ok&&ownJob(answer.result,profile)) return {state:'done',routine:routineOf(answer.result)};
 if(answer.response.status===404) return {state:'missing'};
 if(answer.response.status===400||answer.response.status===422) return {state:'refused'};
 if(answer.response.status===409) return {state:'busy'};
 return {state:stepState(answer)};
};
// `paused` makes it switched off from the start (CronJobCreate's `paused`), as a daily message moved to a new main Agent
// while it is off (#182).
/** @param {any} connection @param {{name:string,prompt:string,schedule:string,timezone?:string|null,paused?:boolean}} routine @returns {Promise<import('./engine.mjs').RoutineChange>} */
export async function createRoutine(connection,{name,prompt,schedule,timezone=null,paused=false}) {
 if(!ownProfile.test(connection.profile)||typeof name!=='string'||typeof prompt!=='string'||!prompt.trim()||!(isRoutineSchedule(schedule)||intervalSchedule.test(schedule))||(timezone!==null&&!zoneName.test(timezone))) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 const body={name:name.trim(),prompt:prompt.trim(),schedule,deliver:'local',...(timezone?{timezone}:{}),...(paused===true?{paused:true}:{})};
 // The Engine takes no key for a create, so an answer that is lost (a timeout, a dropped connection, a gateway's 5xx)
 // leaves it unknown whether the job was made. The profile's list is read before and after: a job that was not there
 // before and is this one is the create's, answered as done, so the person is never offered a second create.
 const before=await readRoutines(connection);
 if(before.state!=='found') return {state:before.state};
 const known=new Set(before.routines.map(routine=>routine.id));
 let answer=null;
 try { answer=await manage(connection,`/api/cron/jobs${query(connection.profile)}`,{method:'POST',body}); } catch { answer=null; }
 if(answer&&answer.response.status<500) return routineAnswer(answer,connection.profile);
 const after=await readRoutines(connection);
 const made=after.state==='found'?after.routines.find(routine=>!known.has(routine.id)&&routine.name===body.name&&routine.prompt===body.prompt&&sameSchedule(routine.schedule,schedule)):null;
 return made?{state:'done',routine:made}:{state:'unreachable'};
}
/** @param {any} connection @param {string} id @param {string} path @param {{method?:string,body?:any}} [request] */
async function onOwnRoutine(connection,id,path,request={method:'POST'}) {
 const own=await ownRoutine(connection,id);
 if(own.state!=='found') return {state:own.state};
 try { return routineAnswer(await manage(connection,`/api/cron/jobs/${id}${path}${query(connection.profile)}`,request),connection.profile); }
 catch { return {state:'unreachable'}; }
}
// A new schedule (and the zone it is read in) for one Routine; its prompt and name stay the Engine's.
/** @param {any} connection @param {{id:string,schedule:string,timezone?:string|null}} change @returns {Promise<import('./engine.mjs').RoutineChange>} */
export async function changeRoutine(connection,{id,schedule,timezone=null}) {
 if(!(isRoutineSchedule(schedule)||intervalSchedule.test(schedule))||(timezone!==null&&!zoneName.test(timezone))) return {state:'failed'};
 return onOwnRoutine(connection,id,'',{method:'PUT',body:{updates:{schedule,...(timezone?{timezone}:{})}}});
}
/** @param {any} connection @param {{id:string}} routine */
export const pauseRoutine=(connection,{id})=>onOwnRoutine(connection,id,'/pause');
/** @param {any} connection @param {{id:string}} routine */
export const resumeRoutine=(connection,{id})=>onOwnRoutine(connection,id,'/resume');
// Run now: the Engine claims the job and runs it once, outside its schedule; one already running answers busy.
/** @param {any} connection @param {{id:string}} routine */
export const triggerRoutine=(connection,{id})=>onOwnRoutine(connection,id,'/trigger',{method:'POST',timeout:30000});
/** @param {any} connection @param {{id:string}} routine @returns {Promise<{state:'deleted'|'missing'|'refused'|'unreachable'|'failed'|'busy'}>} */
export async function deleteRoutine(connection,{id}) {
 const own=await ownRoutine(connection,id);
 if(own.state!=='found') return {state:own.state};
 try {
  const removed=await manage(connection,`/api/cron/jobs/${id}${query(connection.profile)}`,{method:'DELETE'});
  if(removed.response.ok&&removed.result?.ok===true) return {state:'deleted'};
  return removed.response.status===404?{state:'missing'}:{state:stepState(removed)};
 } catch { return {state:'unreachable'}; }
}

// What a Routine's newest runs answered (#182): its run history (GET /api/cron/jobs/<id>/runs?profile=&limit=, newest
// first, each agent run a cron session) and each session's newest messages (order=latest), whose last assistant text is
// that run's reply. A run with no session (a script-only fire) or no text has no reply. The job is first found in the
// Agent's own list, as every other call on one Routine.
/** @param {any} connection @param {{id:string,limit?:number}} routine @returns {Promise<{state:'found',runs:{at:string|null,reply:string|null}[]}|{state:'missing'|'refused'|'unreachable'|'failed',runs:null}>} */
export async function readRoutineReplies(connection,{id,limit=3}) {
 const none=state=>({state,runs:null});
 const own=await ownRoutine(connection,id);
 if(own.state!=='found') return none(own.state);
 const count=Number.isInteger(limit)?Math.min(Math.max(limit,1),10):3;
 try {
  const listed=await manage(connection,`/api/cron/jobs/${id}/runs${query(connection.profile)}&limit=${count}`,{timeout:requestTime});
  if(!listed.response.ok) return none(listed.response.status===404?'missing':refusal(listed.response));
  const rows=Array.isArray(listed.result?.runs)?listed.result.runs.slice(0,count):[];
  const runs=await Promise.all(rows.map(async run=>{
   const started=Number(run?.started_at);
   const at=Number.isFinite(started)?new Date(started*1000).toISOString():null;
   const session=typeof run?.id==='string'?run.id:'';
   if(!sessionIdLike.test(session)||session.includes('..')||session.startsWith('cron_output:')) return {at,reply:null};
   const read=await manage(connection,`/api/sessions/${encodeURIComponent(session)}/messages${query(connection.profile)}&order=latest&limit=20&inline_images=false`,{timeout:requestTime}).catch(()=>null);
   if(!read?.response.ok||!Array.isArray(read.result?.messages)) return {at,reply:null};
   const last=read.result.messages.findLast(message=>message?.role==='assistant'&&typeof message.content==='string'&&message.content.trim());
   return {at,reply:last?last.content:null};
  }));
  return {state:'found',runs};
 } catch { return none('unreachable'); }
}

// A Routine's finished runs (#183), newest first, each with its session: the morning message records each run of the
// daily job once, by its session, and reads the night's Routine results between two mornings by when each run ended
// (v0.23.0 GET /api/cron/jobs/<id>/runs, web_routers/cron.py 485-538: an agent run is a `source: cron` session with
// started_at and ended_at in epoch seconds). A run still going, or one with no session (a script-only fire), is left out.
/** @param {any} connection @param {{id:string,limit?:number}} routine @returns {Promise<{state:'found',full:boolean,runs:{session:string,startedAt:string,endedAt:string}[]}|{state:'missing'|'refused'|'unreachable'|'failed',runs:null}>} */
export async function readRoutineRuns(connection,{id,limit=20}) {
 const none=state=>({state,runs:null});
 const own=await ownRoutine(connection,id);
 if(own.state!=='found') return none(own.state);
 try {
  const listed=await manage(connection,`/api/cron/jobs/${id}/runs${query(connection.profile)}&limit=${Math.max(1,Math.min(100,Math.trunc(limit)||20))}`,{timeout:requestTime});
  if(!listed.response.ok) return none(listed.response.status===404?'missing':refusal(listed.response));
  if(!Array.isArray(listed.result?.runs)) return none('failed');
  const epoch=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?new Date(value*1000).toISOString():null;
  const count=Math.max(1,Math.min(100,Math.trunc(limit)||20));
  // `full`: the Engine answered as many rows as asked for, so older runs may lie beyond what it lists.
  return {state:'found',full:listed.result.runs.length>=count,runs:listed.result.runs.flatMap(run=>{
   const session=run?.source==='cron'&&typeof run.id==='string'&&sessionIdLike.test(run.id)&&!run.id.includes('..')&&!run.id.startsWith('cron_output:')?run.id:null;
   const startedAt=epoch(run?.started_at), endedAt=epoch(run?.ended_at);
   return session&&startedAt&&endedAt&&run.is_active!==true?[{session,startedAt,endedAt}]:[];
  })};
 } catch { return none('unreachable'); }
}
// One run's reply (#183): the last assistant text of its session, or null for a reply the Engine sends nothing for
// (isSilentReply) or one that names the Engine.
/** @param {any} connection @param {string} session @returns {Promise<{state:'found',reply:string|null}|{state:'missing'|'refused'|'unreachable',reply:null}>} */
export async function readRunReply(connection,session) {
 const none=state=>({state,reply:null});
 if(typeof session!=='string'||!sessionIdLike.test(session)||session.includes('..')) return none('missing');
 if(!reachable(connection)) return none('unreachable');
 try {
  const {response,result}=await manage(connection,`/api/sessions/${encodeURIComponent(session)}/messages${query(connection.profile)}&order=latest&limit=20&inline_images=false`,{timeout:requestTime});
  if(response.status===404) return none('missing');
  if(!response.ok) return none(refusal(response));
  if(!Array.isArray(result?.messages)) return none('unreachable');
  const last=result.messages.findLast(message=>message?.role==='assistant'&&typeof message.content==='string'&&message.content.trim());
  const text=last?last.content.toWellFormed().replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]+/g,' ').trim():'';
  return {state:'found',reply:!text||isSilentReply(text)||engineName.test(text)?null:text};
 } catch { return none('unreachable'); }
}

// The words an Agent wrote in the message that paused its Run (#647): the model asks with clarify, or calls a tool that
// waits for approval, in an assistant message that may also carry its answer so far. The pinned release keeps that
// message in the session before it runs the call (agent/turn_tool_round.py), but the run record has no text until the
// Run completes, and then only what came after the pause (the interim text is an SSE event only, api_server_runs.py
// _interim_cb). So the paused message is the session's latest one but its tool results, after the person's last
// message; its words are kept, as a reply's are, when it made a call. Null when it has none or the session cannot be read.
const pausedPage=50;
/** @param {any} connection @param {string} session @returns {Promise<string|null>} */
async function pausedWords(connection,session) {
 if(!sessionIdLike.test(session)||session.includes('..')||!reachable(connection)) return null;
 try {
  const {response,result}=await manage(connection,`/api/sessions/${encodeURIComponent(session)}/messages${query(connection.profile)}&order=latest&limit=${pausedPage}&inline_images=false`,{timeout:requestTime});
  if(!response.ok||!Array.isArray(result?.messages)) return null;
  const paused=result.messages.findLast(message=>message?.role==='assistant'||message?.role==='user'&&message.display_kind!=='hidden');
  const calls=parsed(paused?.tool_calls);
  if(paused?.role!=='assistant'||!Array.isArray(calls)||!calls.length||typeof paused.content!=='string') return null;
  // gtmworks's own tool calls (lib/agent-tools.mjs) never run from a paused message, so their blocks are not words.
  const text=takeToolCalls(paused.content.toWellFormed()).reply.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]+/g,' ').trim();
  return text||null;
 } catch { return null; }
}

// The Engine's rule for a scheduled run that sends nothing (cron/scheduler.py _is_cron_silence_response, gateway/
// response_filters.py is_autonomous_silence_response): a silence marker as the whole reply or its own first or last
// line, or a bracketed one that opens it, case aside. A marker inside a sentence is a real reply.
const silenceMarkers=new Set(['[SILENT]','SILENT','NO_REPLY','NO REPLY','[静默]','静默','[沉默]','沉默']);
/** @param {unknown} reply */
export function isSilentReply(reply) {
 const text=typeof reply==='string'?reply.trim():'';
 if(!text) return false;
 const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 const upper=text.toUpperCase();
 return ['[SILENT]','[静默]','[沉默]'].some(marker=>upper.startsWith(marker))||[text,lines[0],lines.at(-1)].some(candidate=>silenceMarkers.has(candidate.toUpperCase()));
}

// A Company's model sign-in lives on the root profile of its own Engine (#384, ADR 0018), which the driver is given as
// `default`; the Engine lends it to every Agent profile of that Company with none of its own. Hermes runs the sign-in;
// gtmworks passes on only whether each provider is connected, and for a device-code sign-in the code and the https
// link the person opens. No credential, token preview or Hermes error text ever leaves the driver.
export const signInProviders=['openai-codex','anthropic'];
const signInState=['pending','approved','denied','expired','error','cancelled'];
const sessionId=/^[\w-]{8,128}$/;
// Hermes lets a profile with no credential of its own for a provider use the default (root) profile's, and reports it
// as logged in either way: the status names no source and no setting turns the fallback off (hermes_cli/auth.py,
// read_credential_pool and _load_provider_state, v0.23.0). So both are read: `root` says the root profile holds the
// provider's sign-in, and `connected` says the profile asked about holds one of its own. The root itself holds it.
// A status read from an environment key (source `env_var`: Claude's ANTHROPIC_API_KEY, web_server_oauth.py 58-72) is a
// provider key, never a sign-in (#438). And Claude's status never reads the credential pool, where
// `hermes auth add anthropic --type oauth` (the install's `gtmworks sign-in claude`) keeps the subscription, so the
// root's pool is read too (GET /api/credentials/pool, web_routers/ops.py 351-377): an `oauth` row there is the root's
// sign-in, unless the Engine seeded it from outside its own store (an `env:` token, the host's `claude_code` login,
// credential_pool.py 2545-2595), which no Disconnect removes. Only each row's provider, type and source are looked at.
/** @param {any} connection */
export async function readSignIns(connection) {
 if(!agentName.test(connection.profile)) return {state:'failed',signIns:null};
 if(!reachable(connection)) return {state:'unreachable',signIns:null};
 const onRoot=connection.profile==='default';
 try {
  const [own,root,pool]=await Promise.all([onRoot?null:manage(connection,`/api/providers/oauth${query(connection.profile)}`),
   manage(connection,'/api/providers/oauth'),manage(connection,'/api/credentials/pool')]);
  for(const listed of [own,root,pool]) {
   if(!listed) continue;
   if(!listed.response.ok) return {state:refusal(listed.response),signIns:null};
   if(!Array.isArray(listed.result?.providers)) return {state:'failed',signIns:null};
  }
  const loggedIn=(listed,id)=>{ const status=listed.result.providers.find(found=>found?.id===id)?.status; return status?.logged_in===true&&status.source!=='env_var'; };
  const pooled=id=>pool.result.providers.some(found=>found?.provider===id&&Array.isArray(found.entries)&&found.entries.some(entry=>entry?.auth_type==='oauth'&&typeof entry.source==='string'&&!entry.source.startsWith('env:')&&entry.source!=='claude_code'));
  const signIns=Object.fromEntries(signInProviders.map(id=>{
   const provider=own?.result.providers.find(found=>found?.id===id)??root.result.providers.find(found=>found?.id===id);
   const atRoot=loggedIn(root,id)||pooled(id);
   return [id,{connected:onRoot?atRoot:!atRoot&&loggedIn(own,id),root:atRoot,flow:provider?.flow==='device_code'?'device_code':'external'}];
  }));
  return {state:'found',signIns};
 } catch { return {state:'unreachable',signIns:null}; }
}
const noSignIn=state=>({state,session:null,code:null,link:null,expiresIn:null,interval:null});
// The root profile is asked with no profile at all, as readSignIns reads it: Hermes takes an empty profile for its root
// (v0.23.0 web_server_oauth.py 153, _oauth_profile_name), and a session answers only under the profile it started
// under (web_routers/oauth.py 921 poll, 975 cancel).
const signInScope=connection=>connection.profile==='default'?'':query(connection.profile);
/** @param {any} connection @param {string} provider */
export async function startSignIn(connection,provider) {
 if(!signInProviders.includes(provider)||!agentName.test(connection.profile)) return noSignIn('failed');
 if(!reachable(connection)) return noSignIn('unreachable');
 try {
  const started=await manage(connection,`/api/providers/oauth/${encodeURIComponent(provider)}/start${signInScope(connection)}`,{method:'POST'});
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
  const polled=await manage(connection,`/api/providers/oauth/${encodeURIComponent(provider)}/poll/${encodeURIComponent(session)}${signInScope(connection)}`);
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
  const cancelled=await manage(connection,`/api/providers/oauth/sessions/${encodeURIComponent(session)}${signInScope(connection)}`,{method:'DELETE'});
  return {state:cancelled.response.ok?'cancelled':stepState(cancelled)};
 } catch { return {state:'unreachable'}; }
}
// Disconnect removes the provider's credential from this profile's home only, its pool rows with it (v0.23.0 auth.py
// 1359-1378, clear_provider_auth). `nothing`: the profile held none of its own (409, web_routers/oauth.py 774-815), or the Engine
// serves no such profile (404).
/** @param {any} connection @param {string} provider */
export async function disconnectSignIn(connection,provider) {
 if(!signInProviders.includes(provider)||!agentName.test(connection.profile)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const removed=await manage(connection,`/api/providers/oauth/${encodeURIComponent(provider)}${signInScope(connection)}`,{method:'DELETE'});
  if(removed.response.ok&&removed.result?.ok===true) return {state:'disconnected'};
  // An Agent's profile whose Claude is its API key is refused (oauth.py 659-672): it holds no sign-in, and the key stays
  // (#438). The root holds no key of the Company's, so a refusal there is a failure: its sign-in may still be in place.
  if(connection.profile!=='default'&&removed.response.status===400&&typeof removed.result?.detail==='string'&&removed.result.detail.includes('Remove the API key')) return {state:'nothing'};
  return {state:[404,409].includes(removed.response.status)?'nothing':stepState(removed)};
 } catch { return {state:'unreachable'}; }
}

// Each subscription account the Company holds (#618): one entry of the root profile's credential pool per account
// (GET /api/credentials/pool, v0.23.0 web_routers/ops.py 351-377), the ChatGPT one Settings signed in first as the
// singleton's `device_code` row, every further ChatGPT account as its own `manual:device_code` row
// (scripts/engine-codex-accounts.sh), and each `gtmworks sign-in claude` as its own `manual:hermes_pkce` row
// (hermes_cli/auth_commands.py _add_credential). A row the Engine seeded from outside its own store (an `env:` token,
// the host's `claude_code` login) is no subscription the Owner connected, and a key row is a key: neither is listed.
// The entry's id is the account's identity: the Engine keeps it across refreshes (credential_pool.py _upsert_entry) and
// a sign-in of the same account again (the patch). Only the provider, the id and whether the Engine found the account
// exhausted leave the driver: never its label (an email the token carries), its token preview or its counts.
const ownSubscription=entry=>entry?.auth_type==='oauth'&&typeof entry.source==='string'&&!entry.source.startsWith('env:')&&entry.source!=='claude_code'
 &&typeof entry.id==='string'&&accountId.test(entry.id)&&Number.isSafeInteger(entry.index)&&entry.index>0;
/** @param {any} connection */
async function subscriptionRows(connection) {
 const pool=await manage(connection,`/api/credentials/pool${query('default')}`);
 if(!pool.response.ok) return {state:refusal(pool.response),rows:null};
 if(!Array.isArray(pool.result?.providers)) return {state:'failed',rows:null};
 const rows=[];
 for(const listed of pool.result.providers) {
  if(!signInProviders.includes(listed?.provider)||!Array.isArray(listed.entries)) continue;
  for(const entry of listed.entries) if(ownSubscription(entry)&&!rows.some(row=>row.provider===listed.provider&&row.account===entry.id))
   rows.push({provider:listed.provider,account:entry.id,index:entry.index,exhausted:entry.last_status==='exhausted'});
 }
 return {state:'found',rows};
}
/** @param {any} connection */
export async function readSubscriptionAccounts(connection) {
 if(connection.profile!=='default') return {state:'failed',accounts:null};
 if(!reachable(connection)) return {state:'unreachable',accounts:null};
 try {
  const {state,rows}=await subscriptionRows(connection);
  return state==='found'&&rows?{state,accounts:rows.map(({provider,account,exhausted})=>({provider,account,exhausted}))}:{state,accounts:null};
 } catch { return {state:'unreachable',accounts:null}; }
}
// One account leaves the root's pool by the Engine's own removal (DELETE /api/credentials/pool/<provider>/<index>,
// ops.py 438-488), which also clears what it was seeded from (the ChatGPT singleton) and keeps it from coming back.
// The index is read again just before, by the account's id; `nothing`: the Engine holds no such account (any more).
// The root is named (`?profile=default`): the route refuses an unnamed profile on an Engine serving several
// (web_routers/_common.py destructive_profile), as every Company's does.
/** @param {any} connection @param {string} provider @param {string} account */
export async function removeSubscriptionAccount(connection,provider,account) {
 if(connection.profile!=='default'||!signInProviders.includes(provider)||typeof account!=='string'||!accountId.test(account)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const {state,rows}=await subscriptionRows(connection);
  if(state!=='found'||!rows) return {state};
  const row=rows.find(found=>found.provider===provider&&found.account===account);
  if(!row) return {state:'nothing'};
  const removed=await manage(connection,`/api/credentials/pool/${encodeURIComponent(provider)}/${row.index}${query('default')}`,{method:'DELETE'});
  if(removed.response.status===404) return {state:'nothing'};
  return {state:removed.response.ok&&removed.result?.ok===true?'disconnected':stepState(removed)};
 } catch { return {state:'unreachable'}; }
}

// The Owner's order of one provider's subscription accounts, first to last, and which are switched off (#621), given to
// the root's credential pool by scripts/engine-pool-order.sh's route (PUT /api/credentials/pool/<provider>/order): the
// Engine then takes a request's account in that order, goes on with it on the next one switched on when one runs out,
// and never selects one switched off; an account it does not name loses its place. Only entry ids and switches are sent.
// `unsupported`: an Engine without the patch (404 or 405), which keeps its own order.
/** @param {any} connection @param {string} provider @param {{account:string,off:boolean}[]} entries */
export async function writeAccountOrder(connection,provider,entries) {
 if(connection.profile!=='default'||!signInProviders.includes(provider)||!Array.isArray(entries)||entries.length>64
  ||!entries.every(entry=>typeof entry?.account==='string'&&accountId.test(entry.account)&&typeof entry.off==='boolean')) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const written=await manage(connection,`/api/credentials/pool/${encodeURIComponent(provider)}/order${query('default')}`,
   {method:'PUT',body:{entries:entries.map(entry=>({id:entry.account,off:entry.off}))}});
  if([404,405].includes(written.response.status)) return {state:'unsupported'};
  return {state:written.response.ok&&written.result?.ok===true?'written':stepState(written)};
 } catch { return {state:'unreachable'}; }
}
// The moves the Engine made from one subscription account to another (#621; GET /api/credentials/pool/switches,
// scripts/engine-pool-order.sh): its id for each move, the provider, the two accounts by their entry ids and its time in
// seconds, oldest first. A row of any other shape is left out; the Engine records no token, label or error with them.
// `unsupported`: an Engine without the patch.
const switchId=/^[0-9a-f]{32}$/;
/** @param {any} connection */
export async function readAccountSwitches(connection) {
 if(connection.profile!=='default') return {state:'failed',switches:null};
 if(!reachable(connection)) return {state:'unreachable',switches:null};
 try {
  const read=await manage(connection,'/api/credentials/pool/switches');
  if([404,405].includes(read.response.status)) return {state:'unsupported',switches:null};
  if(!read.response.ok) return {state:refusal(read.response),switches:null};
  if(!Array.isArray(read.result?.switches)) return {state:'failed',switches:null};
  const switches=read.result.switches.filter(row=>typeof row?.id==='string'&&switchId.test(row.id)&&signInProviders.includes(row.provider)
   &&typeof row.from==='string'&&accountId.test(row.from)&&typeof row.to==='string'&&accountId.test(row.to)&&row.from!==row.to
   &&typeof row.at==='number'&&Number.isFinite(row.at)&&row.at>0).map(({id,provider,from,to,at})=>({id,provider,from,to,at}));
  return {state:'found',switches};
 } catch { return {state:'unreachable',switches:null}; }
}

// A Company's model-provider API key (#124, ADR 0016). In the Engine a key belongs to one profile: a profile never
// reads another's key, and only the root profile's sign-ins are lent to other profiles (v0.23.0 agent/secret_scope.py
// 1-11 and get_secret 230, hermes_cli/auth.py read_credential_pool 934-958). So the key is written to the Company's
// shared space and to each of its Agent profiles, and never to the root. The providers that take a key are the Engine's
// own rows of GET /api/env (web_routers/config_env.py 264-330): a primary password row of category `provider`. Only a
// provider's slug, its label and whether a key is set leave the driver; the row's redacted preview is dropped, and the
// reveal route (config_env.py 1098) is called only to copy a key from one profile to another inside this process
// (designAccess, giveProviders), and to ask a provider that lists its own models which it serves the key (servedModels,
// #643). The key goes into the PUT bodies only and no Engine text comes back.
// A model is checked against the profile's own keys (web_routers/profiles.py 124-150), so the key is written first.
// A profile made after the key was set is not cloned from the space: a clone copies the space's whole `skills` folder
// (hermes_cli/profiles.py 43-46 and 1305-1333), a local Skill outranks the shared folder (agent/skill_utils.py 400-424)
// and no web route of the pinned Engine deletes a local Skill. It is given the space's keys instead (giveProviders,
// #660).
const keyProfile=/^(cs|co|ag)-[0-9a-f]{32}$/;
const keyValue=/^[\x21-\x7e]{8,4096}$/;
// Agent profiles only: the space is named apart, and a Company profile must be the space's own Company's.
const keyTargets=(space,profiles)=>typeof space==='string'&&spaceName.test(space)&&Array.isArray(profiles)
 &&profiles.every(name=>typeof name==='string'&&keyProfile.test(name)&&!name.startsWith('cs-')&&(!name.startsWith('co-')||name.slice(3)===space.slice(3)));
const readState=response=>response.status===404?'missing':refusal(response);
// The space the Engine does not serve is a failure of the Company's setup, not a profile still to be made.
const spaceState=state=>state==='missing'?'failed':state;
/** @param {any} connection @param {string} profile */
async function providerTable(connection,profile) {
 const read=await manage(connection,`/api/env${query(profile)}`);
 if(!read.response.ok) return {state:readState(read.response),rows:null};
 if(!read.result||typeof read.result!=='object'||Array.isArray(read.result)) return {state:'failed',rows:null};
 const rows=[];
 for(const [env,row] of Object.entries(read.result)) {
  if(row?.category!=='provider'||row.is_password!==true||row.provider_primary!==true||typeof row.provider!=='string'||!row.provider) continue;
  if(rows.some(found=>found.provider===row.provider)) continue;
  rows.push({provider:row.provider,label:typeof row.provider_label==='string'&&row.provider_label?row.provider_label:row.provider,env,set:row.is_set===true});
 }
 return {state:'found',rows};
}
// One Agent profile's table; a profile the Engine did not answer for is unread, and the others are still asked.
/** @param {any} connection @param {string} profile */
const profileTable=(connection,profile)=>providerTable(connection,profile).catch(()=>({state:'unreachable',rows:null}));
const shown=rows=>rows.map(({provider,label,set})=>({provider,label,set}));
/** @param {any} connection @param {{space:string,profiles:string[]}} target */
export async function readProviderKeys(connection,{space,profiles}) {
 const none=state=>({state,keys:null,lacking:null,leftover:null,unread:null});
 if(!keyTargets(space,profiles)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const table=await providerTable(connection,space);
  if(table.state!=='found') return none(spaceState(table.state));
  const held=table.rows.filter(row=>row.set).map(row=>row.provider);
  // lacking: a key the space holds is missing, also from a profile the Engine has not made yet. leftover: a removal that
  // stopped part way left a key the space no longer holds. unread: the Engine could not say, so neither is known.
  const lacking=[]; const leftover=[]; const unread=[];
  for(const profile of profiles) {
   const own=await profileTable(connection,profile);
   if(own.state==='missing') { if(held.length) lacking.push(profile); continue; }
   if(own.state!=='found') { unread.push(profile); continue; }
   if(held.some(provider=>!own.rows.some(row=>row.provider===provider&&row.set))) lacking.push(profile);
   if(own.rows.some(row=>row.set&&!held.includes(row.provider))) leftover.push(profile);
  }
  return {state:'found',keys:shown(table.rows),lacking,leftover,unread};
 } catch { return none('unreachable'); }
}
// A removed Agent's profile is kept in the Engine (#299), so a key it still holds is found here and taken by the next
// removal. held: the providers each profile holds a key of, none for a profile the Engine does not serve. unread: the
// Engine could not say.
/** @param {any} connection @param {{space:string,profiles:string[]}} target */
export async function readHeldKeys(connection,{space,profiles}) {
 const none=state=>({state,held:null,unread:null});
 if(!keyTargets(space,profiles)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 const tables=await Promise.all(profiles.map(profile=>profileTable(connection,profile)));
 /** @type {Record<string,string[]>} */
 const held={}; const unread=[];
 tables.forEach((own,at)=>{
  if(own.state==='missing') held[profiles[at]]=[];
  else if(own.state!=='found') unread.push(profiles[at]);
  else held[profiles[at]]=own.rows.filter(row=>row.set).map(row=>row.provider);
 });
 return {state:'found',held,unread};
}
// The Company's default model for the provider: the first the Engine lists for it in the space once the key is there,
// of those the provider serves the key when it says which (#643). Null when the provider lists none; undefined when the
// Engine did not answer, so no profile's model is settled.
/** @param {any} connection @param {string} space @param {string} provider @returns {Promise<string|null|undefined>} */
async function defaultModel(connection,space,provider) {
 try {
  const read=await manage(connection,`/api/model/options${query(space)}`,{timeout:20000});
  if(!read.response.ok) return undefined;
  const row=Array.isArray(read.result?.providers)?read.result.providers.find(found=>found?.slug===provider):undefined;
  const listed=Array.isArray(row?.models)?row.models.filter(name=>typeof name==='string'&&name.trim()):[];
  const [model]=keepServed(listed,listed.length?await servedModels(connection,space,provider):null);
  return model||null;
 } catch { return undefined; }
}
// The models a provider serves the key this profile holds, read from the provider with the key and address the profile's
// own .env gives the Engine (lib/served-models.mjs). The key is read on the Engine's reveal route and never leaves this
// process but to the provider it is for, over HTTPS. Null for a provider that keeps the Engine's list, a profile holding
// no key, or a read that failed.
/** @param {any} connection @param {string} profile @param {string} provider @returns {Promise<string[]|null>} */
async function servedModels(connection,profile,provider) {
 const source=servedListOf(provider);
 if(!source) return null;
 try {
  const [key,base]=await Promise.all([revealEnv(connection,profile,source.keyEnv),revealEnv(connection,profile,source.baseEnv)]);
  // The provider's own address is used only when the profile names none; an address the Engine could not read is not
  // replaced by it, so the list is never read from another place than the Engine sends the key.
  if(!key.value||!base.value&&!base.absent) return null;
  return await readServedModels({provider,key:key.value,base:base.value});
 } catch { return null; }
}
/** @param {any} connection @param {string} profile @param {{env:string,value:string,provider:string,model:string|null|undefined}} key */
async function writeProfileKey(connection,profile,{env,value,provider,model,design}) {
 try {
  const written=await manage(connection,`/api/env${query(profile)}`,{method:'PUT',body:{key:env,value}});
  if(!written.response.ok||written.result?.ok!==true) return stepState(written);
  // The Agent's design profile (#544) takes the same key and model; a write it refuses is this profile's outcome, so the
  // profile stays unfinished and the next set writes both again.
  if(design) {
   const mirrored=await manage(connection,`/api/env${query(design)}`,{method:'PUT',body:{key:env,value}});
   if(!mirrored.response.ok||mirrored.result?.ok!==true) return stepState(mirrored);
  }
  if(model===undefined) return 'modelUnread';
  if(!model) return 'noModel';
  const picked=await manage(connection,`/api/profiles/${encodeURIComponent(profile)}/model`,{method:'PUT',body:{provider,model}});
  if(!picked.response.ok||picked.result?.ok!==true) return stepState(picked);
  if(design) {
   const mirrored=await manage(connection,`/api/profiles/${encodeURIComponent(design)}/model`,{method:'PUT',body:{provider,model}});
   if(!mirrored.response.ok||mirrored.result?.ok!==true) return stepState(mirrored);
  }
  return 'written';
 } catch { return 'unreachable'; }
}
// profilesOnly writes the profiles alone, for a space that already holds this key; the space still names its env and model.
/** @param {any} connection @param {{space:string,profiles:string[],provider:string,value:string,profilesOnly?:boolean}} key */
export async function setProviderKey(connection,{space,profiles,provider,value,profilesOnly=false}) {
 const none=state=>({state,model:null,profiles:null});
 if(!keyTargets(space,profiles)||typeof provider!=='string') return none('failed');
 if(typeof value!=='string'||!keyValue.test(value)) return none('invalid');
 if(!reachable(connection)) return none('unreachable');
 try {
  const table=await providerTable(connection,space);
  if(table.state!=='found') return none(spaceState(table.state));
  const row=table.rows.find(found=>found.provider===provider);
  if(!row) return none('unknownProvider');
  if(!profilesOnly) {
   const written=await manage(connection,`/api/env${query(space)}`,{method:'PUT',body:{key:row.env,value}});
   // The Engine refuses a value that reads as its own redacted preview.
   if(written.response.status===400) return none('invalid');
   if(!written.response.ok||written.result?.ok!==true) return none(stepState(written));
  }
  const model=await defaultModel(connection,space,provider);
  // Each profile is asked even after one fails, so the next set finds the others done.
  const states={};
  const designs=await designProfiles(connection,profiles);
  for(const profile of profiles) {
   states[profile]=await writeProfileKey(connection,profile,{env:row.env,value,provider,model,design:designs.designs?.get(profile)});
   // Which Agents have a design profile is unknown: each Agent that could have one stays unfinished, to be asked again.
   if(!designs.designs&&designProfileOf(profile)&&['written','noModel'].includes(states[profile])) states[profile]=designs.state;
  }
  return {state:'written',model:model??null,profiles:states};
 } catch { return none('unreachable'); }
}
// The key leaves the space and each profile; a 404 is a profile that held none (or that the Engine has not made).
// Each profile keeps its model, which the next set writes again.
/** @param {any} connection @param {{space:string,profiles:string[],provider:string}} key */
export async function removeProviderKey(connection,{space,profiles,provider}) {
 const none=state=>({state,profiles:null});
 if(!keyTargets(space,profiles)||typeof provider!=='string') return none('failed');
 if(!reachable(connection)) return none('unreachable');
 const remove=async(profile,env)=>{
  try {
   const removed=await manage(connection,`/api/env${query(profile)}`,{method:'DELETE',body:{key:env}});
   if(removed.response.status===404) return 'nothing';
   return removed.response.ok&&removed.result?.ok===true?'removed':stepState(removed);
  } catch { return 'unreachable'; }
 };
 try {
  const table=await providerTable(connection,space);
  if(table.state!=='found') return none(spaceState(table.state));
  const row=table.rows.find(found=>found.provider===provider);
  if(!row) return none('unknownProvider');
  const fromSpace=await remove(space,row.env);
  if(fromSpace!=='removed'&&fromSpace!=='nothing') return none(fromSpace);
  const states={};
  const designs=await designProfiles(connection,profiles);
  for(const profile of profiles) {
   states[profile]=await remove(profile,row.env);
   // A design profile (#544) that keeps the key, or a list that could not say whether there is one, makes this profile's
   // removal unfinished, so it is asked again.
   if(!designs.designs) { if(designProfileOf(profile)) states[profile]=designs.state; continue; }
   const design=designs.designs.get(profile);
   const fromDesign=design?await remove(design,row.env):'nothing';
   if(fromDesign!=='removed'&&fromDesign!=='nothing') states[profile]=fromDesign;
   else if(fromDesign==='removed'&&states[profile]==='nothing') states[profile]='removed';
  }
  return {state:fromSpace==='removed'||Object.values(states).includes('removed')?'removed':'nothing',profiles:states};
 } catch { return none('unreachable'); }
}

// Speech-to-text (#430): a profile transcribes with its saved `stt.provider` (tools/transcription_tools.py 249-277) and
// that provider's key, one variable of the profile's own .env, read in the profile's own secret scope (agent/
// secret_scope.py). A provider the Engine has no handler for is its own `stt.providers.<name>` command
// (tools/transcription_command.py), so nothing inside the Engine changes. Of a key, only whether it is set leaves the
// driver: the row's redacted preview is dropped. `held` lists which of `envs` the profile holds; a profile the Engine
// does not answer for is null.
const envName=/^[A-Z][A-Z0-9_]{2,63}$/;
/** @param {any} connection @param {{profiles:string[],envs:string[]}} asked */
export async function readSpeech(connection,{profiles,envs}) {
 const none=state=>({state,profiles:null});
 if(!Array.isArray(profiles)||!profiles.every(name=>typeof name==='string'&&keyProfile.test(name))||!Array.isArray(envs)||!envs.every(name=>envName.test(name))) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 const one=async profile=>{
  try {
   const [config,env]=await Promise.all([manage(connection,`/api/config${query(profile)}&include_defaults=false`),manage(connection,`/api/env${query(profile)}`)]);
   if(!config.response.ok||!env.response.ok||!env.result||typeof env.result!=='object') return null;
   const stt=config.result?.stt;
   return {provider:typeof stt?.provider==='string'&&stt.provider?stt.provider:null,language:typeof stt?.language==='string'?stt.language:null,
    held:envs.filter(name=>env.result[name]?.is_set===true)};
  } catch { return null; }
 };
 const read=await Promise.all(profiles.map(one));
 return {state:'found',profiles:Object.fromEntries(profiles.map((profile,at)=>[profile,read[at]]))};
}
// One profile's provider and key. A set writes the key before the config, so the provider never points at a key the
// profile lacks; a removal (no value) writes the config first and then takes the key, a 404 being a key it never held,
// or leaves every key where it is when `env` is null.
// The config write deep-merges, so it states only its own keys.
/** @param {any} connection @param {{profile:string,env:string|null,value?:string,config:object}} change @returns {Promise<'written'|'invalid'|'refused'|'unreachable'|'failed'>} */
export async function writeSpeech(connection,{profile,env,value,config}) {
 if(typeof profile!=='string'||!keyProfile.test(profile)||!(env===null&&value===undefined)&&(typeof env!=='string'||!envName.test(env))||!config||typeof config!=='object'||Array.isArray(config)) return 'failed';
 if(value!==undefined&&(typeof value!=='string'||!keyValue.test(value))) return 'invalid';
 if(!reachable(connection)) return 'unreachable';
 const path=`/api/env${query(profile)}`;
 const writeConfigOf=async()=>{ const written=await manage(connection,`/api/config${query(profile)}`,{method:'PUT',body:{config}}); return written.response.ok&&written.result?.ok===true?'written':stepState(written); };
 try {
  if(value!==undefined) {
   const keyed=await manage(connection,path,{method:'PUT',body:{key:env,value}});
   // The Engine refuses a value that reads as its own redacted preview.
   if(keyed.response.status===400) return 'invalid';
   if(!keyed.response.ok||keyed.result?.ok!==true) return stepState(keyed);
   return await writeConfigOf();
  }
  const configured=await writeConfigOf();
  if(configured!=='written'||env===null) return configured;
  const removed=await manage(connection,path,{method:'DELETE',body:{key:env}});
  return removed.response.status===404||removed.response.ok&&removed.result?.ok===true?'written':stepState(removed);
 } catch { return 'unreachable'; }
}

// The apps a Company's Agents use (#30, #458) are servers in the Company's profile or in one Agent's own profile, on for
// every Run of that profile or off. Hermes signs in to an OAuth app with its own flow; the vendor sends the person back to
// gtmworks (the redirect_uri written for the server), which hands the answer on to Hermes. Only states and the vendor's
// https sign-in link leave the driver: never a token, a tool list, Hermes's own page or its error text.
const flowId=/^[\w-]{8,128}$/;
const companyScope=connection=>agentName.test(connection.profile)&&connection.profile!=='default';
const serverPath=(connection,key,step='')=>`/api/mcp/servers/${encodeURIComponent(key)}${step}${query(connection.profile)}`;
// Hermes connects with the stored sign-in and lists the server's tools; it answers ok only when a token is on disk.
async function reaches(connection,key) {
 try {
  const tested=await manage(connection,serverPath(connection,key,'/test'),{method:'POST',timeout:8000});
  return tested.response.ok&&tested.result?.ok===true;
 } catch { return false; }
}
// One server's tools as the Engine lists them: names only, never its descriptions or a schema (#458's Test).
/** @param {any} connection @param {string} key */
export async function testServer(connection,key) {
 if(typeof key!=='string'||!appKey.test(key)||key==='own') return {state:'failed',tools:null};
 if(!reachable(connection)) return {state:'unreachable',tools:null};
 try {
  const tested=await manage(connection,serverPath(connection,key,'/test'),{method:'POST',timeout:10000});
  if([401,403].includes(tested.response.status)) return {state:'refused',tools:null};
  if(!tested.response.ok) return {state:stepState(tested),tools:null};
  if(tested.result?.ok!==true) return {state:'attention',tools:[]};
  const tools=Array.isArray(tested.result.tools)?tested.result.tools.flatMap(tool=>{
   const name=typeof tool==='string'?tool:tool?.name;
   return typeof name==='string'&&name.length<=128?[name]:[];
  }).slice(0,500):[];
  return {state:'connected',tools};
 } catch { return {state:'unreachable',tools:null}; }
}
const noApps=state=>({state,apps:null});
// The registry's apps the Engine offers, each with its state, plus every server in the profile that the registry does not
// name (an Owner's own tool) and the card that adds one; an app the Engine does not offer is not listed. 'installed' tells
// an app turned off in the profile (#204: "Turned off for it") from one never added there. A catalogue entry's declared
// fields come from the Engine's own catalogue and hold names and prompts only, never a value.
/** @param {any} connection */
export async function readApps(connection) {
 if(!companyScope(connection)) return noApps('failed');
 if(!reachable(connection)) return noApps('unreachable');
 try {
  const [listed,config]=await Promise.all([manage(connection,`/api/mcp/catalog${query(connection.profile)}`),manage(connection,`/api/config${query(connection.profile)}`)]);
  for(const read of [listed,config]) if(!read.response.ok) return noApps(refusal(read.response));
  const entries=listed.result?.entries;
  if(!Array.isArray(entries)) return noApps('failed');
  const servers=config.result?.mcp_servers&&typeof config.result.mcp_servers==='object'?config.result.mcp_servers:{};
  const offered=apps.flatMap(entry=>{
   if(entry.source==='own') return [{entry,installed:false,on:false,fields:null}];
   if(entry.source==='remote'||entry.source==='sandbox') { const server=servers[entry.key]; return [{entry,installed:Boolean(server),on:Boolean(server)&&server.enabled!==false,fields:null}]; }
   const found=entries.find(one=>one?.name===entry.key);
   if(!found) return [];
   const installed=found.installed===true;
   const fields=Array.isArray(found.required_env)?found.required_env.flatMap(field=>typeof field?.name==='string'?[{name:field.name,prompt:typeof field.prompt==='string'?field.prompt:'',required:field.required!==false}]:[]):[];
   return [{entry,installed,on:installed&&found.enabled===true,fields:fields.length?fields:null}];
  });
  const knownKeys=new Set(apps.map(entry=>entry.key));
  const custom=Object.keys(servers).filter(key=>!knownKeys.has(key)&&appKey.test(key)).sort().map(key=>{
   const server=servers[key];
   // A command server gtmworks wrote runs in the work sandbox (#459); its card shows the command as the Owner typed it.
   const command=sandboxCommandOf(server);
   if(command) return {entry:{...customApp(key),auth:'command',command:command.command,args:command.args},installed:true,on:server?.enabled!==false,fields:null};
   const auth=server?.auth==='oauth'?'oauth':server?.headers&&typeof server.headers==='object'&&Object.keys(server.headers).some(name=>name.toLowerCase()==='authorization')?'header':'none';
   return {entry:{...customApp(key),auth,...(typeof server?.url==='string'?{url:server.url}:{})},installed:true,on:server?.enabled!==false,fields:null};
  });
  return {state:'found',apps:await Promise.all([...offered,...custom].map(async({entry,installed,on,fields})=>({key:entry.key,name:entry.name,mark:entry.mark,category:entry.category,source:entry.source,
   ...(entry.url?{url:entry.url}:{}),...(entry.command?{command:entry.command,args:entry.args}:{}),...(entry.docs?{docs:entry.docs}:{}),...(entry.auth?{auth:entry.auth}:{}),...(entry.care?{care:entry.care}:{}),...(fields?{fields}:{}),installed,
   state:appState(on,on&&await reaches(connection,entry.key))})))};
 } catch { return noApps('unreachable'); }
}
const noFlow=state=>({state,flow:null,url:null});
const wayBack=redirectUri=>{ try { const url=new URL(redirectUri); return ['http:','https:'].includes(url.protocol)?url.href:null; } catch { return null; } };
// A server written by the version before #458 carries a tool whitelist. The Engine's config write deep-merges and cannot
// delete a key, so its whole-map replace is used for this one profile: every other server stays as it was, and the server
// loses only its `tools` filter. Returns null when there was nothing to clear, else the state it stopped in.
/** @param {any} connection @param {string} key */
async function clearToolFilter(connection,key) {
 try {
  // Read again right before the whole-map replace: another server may have been added since this step began, and the
  // replace must carry it unchanged.
  const config=await manage(connection,`/api/config${query(connection.profile)}`);
  if(!config.response.ok) return stepState(config);
  const servers=config.result?.mcp_servers&&typeof config.result.mcp_servers==='object'?config.result.mcp_servers:{};
  if(!Object.hasOwn(servers,key)) return null;
  const server=servers[key];
  if(!server||typeof server!=='object'||!('tools' in server)) return null;
  const cleaned={...servers,[key]:Object.fromEntries(Object.entries(server).filter(([name])=>name!=='tools'))};
  const replaced=await manage(connection,`/api/mcp/servers${query(connection.profile)}`,{method:'PUT',body:{servers:cleaned,profile:connection.profile}});
  return replaced.response.ok&&replaced.result?.ok===true?null:stepState(replaced);
 } catch { return 'unreachable'; }
}
// Before a sign-in or a turn-on the server is installed when it is not there, any old tool filter is cleared, and the way
// back to gtmworks (OAuth only) is written. A catalogue entry is installed off and turned on only in the config write, so
// a sign-in left on disk by an earlier connect never gives a Run every tool meanwhile. A remote entry is added through the
// Engine's own server route, with its address, sign-in kind and, for a token, the token itself. Returns null when ready,
// else the state it stopped in.
/** @param {any} connection @param {string} key @param {string|null} redirectUri
 *  @param {{fields?:Record<string,string>,token?:string}} [given] */
export async function prepareApp(connection,key,redirectUri,{fields={},token}={}) {
 const entry=appByKey(key); const back=redirectUri===null?null:wayBack(redirectUri);
 if(!entry||entry.source==='own'||!companyScope(connection)||(entry.auth==='oauth'&&!back)) return 'failed';
 if(entry.source==='remote') return prepareServer(connection,{key,url:entry.url,auth:entry.auth,token,redirectUri:back});
 if(entry.source==='sandbox') return prepareOpenDesign(connection);
 if(!reachable(connection)) return 'unreachable';
 const scope=query(connection.profile);
 try {
  let installing=false;
  if(entry.source==='engine') {
   const listed=await manage(connection,`/api/mcp/catalog${scope}`);
   if(!listed.response.ok) return stepState(listed);
   const found=Array.isArray(listed.result?.entries)?listed.result.entries.find(one=>one?.name===key):undefined;
   if(!found) return 'failed';
   // Fields given for an installed entry are new values (a rotated secret, a corrected address): v0.23.0 writes them only
   // at install, so the entry is removed and installed again with them; its sign-in stays on disk.
   const replacing=found.installed===true&&Object.keys(fields).length>0;
   if(replacing) {
    const removed=await manage(connection,serverPath(connection,key),{method:'DELETE'});
    if(!removed.response.ok&&removed.response.status!==404) return stepState(removed);
   }
   installing=found.installed!==true||replacing;
   if(installing) {
    const installed=await manage(connection,`/api/mcp/catalog/install${scope}`,{method:'POST',body:{name:key,env:fields,enable:false,profile:connection.profile}});
    if(!installed.response.ok||installed.result?.ok!==true||installed.result.background!==false) return stepState(installed);
   }
  }
  const cleared=await clearToolFilter(connection,key);
  if(cleared) return cleared;
  const written=await manage(connection,`/api/config${scope}`,{method:'PUT',body:{config:appConfig(entry,back)}});
  if(written.response.ok&&written.result?.ok===true) return null;
  if(installing) await manage(connection,serverPath(connection,key),{method:'DELETE'}).catch(()=>{});
  return stepState(written);
 } catch { return 'unreachable'; }
}
// The same steps for a server the Owner adds by address (#458): it is created through the Engine's own server route when
// the profile lacks it, any old filter is cleared, and the server is turned on with the way back for OAuth. No command
// server is ever created here: a URL is required.
/** @param {any} connection @param {{key:string,url:string,auth?:string,token?:string,redirectUri:string|null}} server */
export async function prepareServer(connection,{key,url,auth='none',token,redirectUri}) {
 const back=redirectUri===null?null:wayBack(redirectUri);
 if(typeof key!=='string'||!appKey.test(key)||key==='own'||typeof url!=='string'||!['none','header','oauth'].includes(auth)||(auth==='oauth'&&!back)||(auth==='header'&&typeof token!=='string')) return 'failed';
 if(!companyScope(connection)) return 'failed';
 if(!reachable(connection)) return 'unreachable';
 const scope=query(connection.profile);
 try {
  const config=await manage(connection,`/api/config${scope}`);
  if(!config.response.ok) return stepState(config);
  const servers=config.result?.mcp_servers&&typeof config.result.mcp_servers==='object'?config.result.mcp_servers:{};
  const present=Object.hasOwn(servers,key);
  const current=present&&servers[key]&&typeof servers[key]==='object'?servers[key]:null;
  // v0.23.0 has no route that updates a server, so a new address, a different sign-in kind or a pasted token removes the
  // server and adds it again. The same OAuth server with the same address keeps its sign-in.
  const changed=present&&(current?.url!==url||(current?.auth||'none')!==auth||(auth==='header'&&typeof token==='string'));
  if(changed) {
   const removed=await manage(connection,serverPath(connection,key),{method:'DELETE'});
   if(!removed.response.ok&&removed.response.status!==404) return stepState(removed);
  }
  if(!present||changed) {
   const added=await manage(connection,`/api/mcp/servers${scope}`,{method:'POST',body:{name:key,url,auth,profile:connection.profile,...(auth==='header'?{bearer_token:token}:{})}});
   if(!added.response.ok) return stepState(added);
  }
  const cleared=await clearToolFilter(connection,key);
  if(cleared) return cleared;
  const written=await manage(connection,`/api/config${scope}`,{method:'PUT',body:{config:{mcp_servers:{[key]:{enabled:true,...(auth==='oauth'?{oauth:{redirect_uri:back}}:{})}}}}});
  return written.response.ok&&written.result?.ok===true?null:stepState(written);
 } catch { return 'unreachable'; }
}
// A command server the Owner adds (#459, ADR 0024): the Engine gets ssh into the Company's work sandbox, never the
// Owner's command itself, so the server's process runs in the sandbox from the Agent's own work folder. Like an address,
// it is added when the profile lacks it, removed and added again when the command changed (v0.23.0 has no route that
// updates a server), and turned on. Returns null when ready, else the state it stopped in.
/** @param {any} connection @param {{key:string,command:string,args:string[]}} server */
export async function prepareCommandServer(connection,{key,command,args}) {
 if(typeof key!=='string'||!appKey.test(key)||key==='own'||!companyScope(connection)) return 'failed';
 const entry=sandboxServer({profile:connection.profile,command,args});
 if(!entry) return 'failed';
 if(!reachable(connection)) return 'unreachable';
 const scope=query(connection.profile);
 try {
  const config=await manage(connection,`/api/config${scope}`);
  if(!config.response.ok) return stepState(config);
  const servers=config.result?.mcp_servers&&typeof config.result.mcp_servers==='object'?config.result.mcp_servers:{};
  const present=Object.hasOwn(servers,key);
  const current=present?servers[key]:null;
  const same=present&&current?.command===entry.command&&JSON.stringify(current?.args)===JSON.stringify(entry.args)&&!current?.url;
  if(present&&!same) {
   const removed=await manage(connection,serverPath(connection,key),{method:'DELETE'});
   if(!removed.response.ok&&removed.response.status!==404) return stepState(removed);
  }
  if(!same) {
   const added=await manage(connection,`/api/mcp/servers${scope}`,{method:'POST',body:{name:key,command:entry.command,args:entry.args,auth:'none',profile:connection.profile}});
   if(!added.response.ok) return stepState(added);
  }
  const cleared=await clearToolFilter(connection,key);
  if(cleared) return cleared;
  const written=await manage(connection,`/api/config${scope}`,{method:'PUT',body:{config:{mcp_servers:{[key]:{enabled:true}}}}});
  return written.response.ok&&written.result?.ok===true?null:stepState(written);
 } catch { return 'unreachable'; }
}
// The design profile draws with its Agent's own model access (#544, ADR 0025). A profile reads no other profile's model
// choice, and gtmworks writes a provider key into each Agent profile (setProviderKey), so the design profile is given the
// Agent's: each provider key the Agent's profile holds, read on the Engine's own reveal route and written straight into
// the design profile (it never leaves this process or reaches a log), then the Agent's provider and model. A subscription
// sign-in needs no copy: it is the Engine root's, which every profile reads (ADR 0018). A custom endpoint the Owner set in
// the Engine itself is a config of that profile, which no route gives back whole, so it is not copied. Later changes
// reach the design profile through designProfiles. Returns null when done, else the state it stopped in.
/** @param {any} connection @param {string} design */
async function designAccess(connection,design) {
 const table=await providerTable(connection,connection.profile);
 if(table.state!=='found') return table.state==='missing'?'failed':table.state;
 const copied=await copyKeys(connection,{from:connection.profile,to:design,rows:table.rows.filter(found=>found.set)});
 if(copied) return copied;
 const models=await readProfileModels(connection,[connection.profile]);
 if(models.state!=='found') return models.state;
 const own=models.models?.[connection.profile];
 if(!own||own.provider==='custom') return null;
 const picked=await manage(connection,`/api/profiles/${encodeURIComponent(design)}/model`,{method:'PUT',body:own});
 return picked.response.ok&&picked.result?.ok===true?null:stepState(picked);
}
// A write gtmworks makes to an Agent profile's model or provider key is made to that Agent's design profile too, when it
// has one (Open Design on): the Engine's profile list, read once per change, says which do. A failed design write leaves
// the Agent's own write standing; turning Open Design on again copies the Agent's access afresh.
// A list that cannot be read is a failure of its own: a change then stays unfinished and is asked again, never taken as
// proof that no Agent has a design profile.
/** @param {any} connection @param {string[]} profiles @returns {Promise<{state:'found',designs:Map<string,string>}|{state:string,designs:null}>} Agent profile to its design profile */
async function designProfiles(connection,profiles) {
 const wanted=new Map(profiles.flatMap(profile=>{ const design=designProfileOf(profile); return design?[[design,profile]]:[]; }));
 if(!wanted.size) return {state:'found',designs:new Map()};
 try {
  const listed=await manage(connection,'/api/profiles');
  if(!listed.response.ok) return {state:refusal(listed.response),designs:null};
  if(!Array.isArray(listed.result?.profiles)) return {state:'failed',designs:null};
  const names=listed.result.profiles.map(found=>found?.name);
  return {state:'found',designs:new Map(names.filter(name=>wanted.has(name)).map(name=>[/** @type {string} */(wanted.get(name)),name]))};
 } catch { return {state:'unreachable',designs:null}; }
}
// The Open Design app for one Agent (#544, ADR 0025, lib/open-design.mjs): the Agent's design profile, then the server
// entry that runs Open Design's MCP command in the sandbox with that profile's key. The design profile is made like a
// Company's profile (provideProfile) but given a Run API key of its own, never the install's, so the key the sandbox
// holds runs that one profile; its tools are the Agent's own, in the Agent's own folder. An entry already there whose key
// the design profile still takes keeps it, so turning the app on again leaves the Agent's connected session as it is.
// Returns null when ready, else the state it stopped in.
/** @param {any} connection */
async function prepareOpenDesign(connection) {
 const design=designProfileOf(connection.profile);
 let engine=''; try { engine=new URL(connection.address).hostname; } catch { engine=''; }
 if(!design||!engine||!companyScope(connection)) return 'failed';
 if(!reachable(connection)) return 'unreachable';
 const scope=query(connection.profile);
 try {
  const config=await manage(connection,`/api/config${scope}`);
  if(!config.response.ok) return stepState(config);
  const servers=config.result?.mcp_servers&&typeof config.result.mcp_servers==='object'?config.result.mcp_servers:{};
  const present=Object.hasOwn(servers,openDesignApp);
  const kept=present?openDesignKeyOf(servers[openDesignApp],connection.profile):null;
  const made=await manage(connection,'/api/profiles',{method:'POST',body:{name:design,soul:designSoul}});
  const exists=made.response.status===400&&typeof made.result?.detail==='string'&&made.result.detail.includes('already exists');
  if(!exists&&(!made.response.ok||made.result?.ok!==true||made.result.name!==design)) return stepState(made);
  const answers=async(/** @type {string} */ key)=>{
   const response=await fetch(`${address(connection)}/p/${encodeURIComponent(design)}/v1/capabilities`,{headers:authorized(key),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
   await response.body?.cancel().catch(()=>{});
   return response.ok;
  };
  const key=exists&&kept&&await answers(kept)?kept:newDesignKey();
  if(key!==kept) {
   const written=await manage(connection,`/api/env${query(design)}`,{method:'PUT',body:{key:'API_SERVER_KEY',value:key}});
   if(!written.response.ok||written.result?.ok!==true) return stepState(written);
  }
  const tools=designProfileConfig(connection.profile);
  const toolsWritten=await manage(connection,`/api/config${query(design)}`,{method:'PUT',body:{config:tools}});
  if(!toolsWritten.response.ok||toolsWritten.result?.ok!==true) return stepState(toolsWritten);
  // The design profile's Runs get exactly the Agent's work tools, read back with its own key.
  const offered=await readToolsets({...connection,profile:design,key});
  if(offered.state!=='found') return offered.state==='missing'?'failed':offered.state;
  const wanted=tools.platform_toolsets.api_server;
  if(offered.toolsets.some(name=>!wanted.includes(name))||wanted.some(name=>!offered.toolsets.includes(name))) return 'failed';
  const access=await designAccess(connection,design);
  if(access) return access;
  const entry=openDesignServer({profile:connection.profile,engine,key});
  if(!entry) return 'failed';
  const current=present?servers[openDesignApp]:null;
  const same=present&&current?.command===entry.command&&JSON.stringify(current?.args)===JSON.stringify(entry.args);
  if(present&&!same) {
   const removed=await manage(connection,serverPath(connection,openDesignApp),{method:'DELETE'});
   if(!removed.response.ok&&removed.response.status!==404) return stepState(removed);
  }
  if(!same) {
   const added=await manage(connection,`/api/mcp/servers${scope}`,{method:'POST',body:{name:openDesignApp,command:entry.command,args:entry.args,auth:'none',profile:connection.profile}});
   if(!added.response.ok) return stepState(added);
  }
  const cleared=await clearToolFilter(connection,openDesignApp);
  if(cleared) return cleared;
  const on=await manage(connection,`/api/config${scope}`,{method:'PUT',body:{config:{mcp_servers:{[openDesignApp]:{enabled:true}}}}});
  return on.response.ok&&on.result?.ok===true?null:stepState(on);
 } catch { return 'unreachable'; }
}
// What a design profile is told once, beside each Run's own instructions (sandbox/open-design/hermes-engine.mjs).
const designSoul='You draw designs for Open Design, for one Agent of this Company. Each request names its project folder in the work sandbox: write the design\'s files there with your file tools, and answer in a sentence or two with what you made and its files.';
// Off for an Agent keeps its design profile, with the Runs its usage counts, but gives it a new key nobody holds: the key
// the sandbox kept then runs nothing. Turning Open Design on again writes a key of its own, as for a new profile.
/** @param {any} connection */
async function sealDesignProfile(connection) {
 const design=designProfileOf(connection.profile);
 if(!design) return 'disconnected';
 const sealed=await manage(connection,`/api/env${query(design)}`,{method:'PUT',body:{key:'API_SERVER_KEY',value:newDesignKey()}});
 return sealed.response.status===404||sealed.response.ok&&sealed.result?.ok===true?'disconnected':stepState(sealed);
}
// Removing the Agent removes its design profile.
/** @param {any} connection @param {string} [agent] the Agent's profile, the connection's own unless named */
async function removeDesignProfile(connection,agent=connection.profile) {
 const design=designProfileOf(agent);
 if(!design) return 'disconnected';
 const removed=await manage(connection,`/api/profiles/${encodeURIComponent(design)}`,{method:'DELETE',timeout:20000});
 return removed.response.status===404||removed.response.ok&&removed.result?.ok===true?'disconnected':stepState(removed);
}
// Connecting prepares the app, then asks Hermes for the vendor's sign-in page. Only an OAuth entry gets here; a token or
// no-sign-in server is turned on by prepareApp alone.
/** @param {any} connection @param {string} key @param {string} redirectUri */
export async function startAppSignIn(connection,key,redirectUri,{fields={},token,url:serverAddress,auth}={}) {
 const stopped=appByKey(key)?await prepareApp(connection,key,redirectUri,{fields,token}):await prepareServer(connection,{key,url:serverAddress,auth,token,redirectUri});
 if(stopped) return noFlow(stopped);
 try {
  // Hermes waits up to 30 seconds for the vendor's sign-in page before it answers.
  const started=await manage(connection,serverPath(connection,key,'/auth'),{method:'POST',timeout:40000});
  if(started.response.status===409) return noFlow('busy');
  if(!started.response.ok) return noFlow(stepState(started));
  const {flow_id:flow,status,authorization_url:link}=started.result||{};
  let url=null; try { url=new URL(link); } catch { url=null; }
  // A vendor signs in over https. A server the Owner added may be plain http on the Company's own network (ADR 0021), so
  // its sign-in page may be http only when its own address is http; an https server still needs an https page.
  const catalogue=Boolean(appByKey(key));
  let serverUrl=null; try { serverUrl=typeof serverAddress==='string'?new URL(serverAddress):null; } catch { serverUrl=null; }
  const pageOk=Boolean(url)&&(url.protocol==='https:'||(!catalogue&&url.protocol==='http:'&&serverUrl?.protocol==='http:'))&&!url.username&&!url.password;
  if(typeof flow!=='string'||!flowId.test(flow)||status!=='authorization_required'||!pageOk) return noFlow('failed');
  return {state:'started',flow,url:url.href};
 } catch { return noFlow('unreachable'); }
}
/** @param {any} connection @param {string} flow */
export async function pollAppSignIn(connection,flow) {
 if(typeof flow!=='string'||!flowId.test(flow)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const polled=await manage(connection,`/api/mcp/oauth/flows/${encodeURIComponent(flow)}`);
  // A flow Hermes no longer knows (fifteen minutes old, or after a restart) can never finish.
  if(polled.response.status===404) return {state:'expired'};
  if(!polled.response.ok) return {state:stepState(polled)};
  const status=polled.result?.status;
  return {state:status==='approved'?'approved':['starting','authorization_required'].includes(status)?'waiting':'failed'};
 } catch { return {state:'unreachable'}; }
}
/** @param {any} connection @param {string} flow */
export async function cancelAppSignIn(connection,flow) {
 if(typeof flow!=='string'||!flowId.test(flow)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const cancelled=await manage(connection,`/api/mcp/oauth/flows/${encodeURIComponent(flow)}`,{method:'DELETE'});
  return {state:cancelled.response.ok?'cancelled':stepState(cancelled)};
 } catch { return {state:'unreachable'}; }
}
// The vendor sent the person back to gtmworks. Only the four values OAuth returns go on to Hermes's callback, whose page
// is never read; Hermes then trades the code for a token and connects, and the flow says when that is done. A key of a
// server the Owner added is handed on the same way: its open sign-in row is the only thing that says whose it is.
/** @param {any} connection @param {{key:string,flow:string,answer:Record<string,unknown>,settle?:number}} signIn */
export async function finishAppSignIn(connection,{key,flow,answer,settle=20}) {
 const entry=appByKey(key);
 if((!entry||entry.source==='own')&&!(appKey.test(String(key))&&key!=='own')||typeof flow!=='string'||!flowId.test(flow)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 const forwarded=new URLSearchParams();
 for(const name of ['code','state','error','iss']) { const value=answer?.[name]; if(typeof value==='string'&&value.length<=4096) forwarded.set(name,value); }
 try {
  const answered=await fetch(`${managementRoot(connection)}/api/mcp/oauth/callback/${encodeURIComponent(key)}?${forwarded}`,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000)});
  await answered.body?.cancel().catch(()=>{});
  if(answered.status===404) return {state:'expired'};
  if(!answered.ok) return {state:'failed'};
  for(let round=0;round<settle;round++) {
   const polled=await pollAppSignIn(connection,flow);
   if(polled.state!=='waiting') return {state:polled.state==='approved'?'approved':polled.state==='unreachable'?'waiting':'failed'};
   await sleep(500);
  }
  return {state:'waiting'};
 } catch { return {state:'unreachable'}; }
}
// Off for the whole Company: the server leaves the profile's config, so no later Run gets it. Hermes v0.23.0 keeps the
// sign-in's token on disk and has no route to remove it.
/** @param {any} connection @param {string} key */
export async function disconnectApp(connection,key) {
 const entry=appByKey(key);
 if((!entry||entry.source==='own')&&!(appKey.test(String(key))&&key!=='own')||!companyScope(connection)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  // Open Design's design profile is sealed first: a key the sandbox kept never outlives the app being shown as off.
  if(key===openDesignApp) { const sealed=await sealDesignProfile(connection); if(sealed!=='disconnected') return {state:sealed}; }
  const removed=await manage(connection,serverPath(connection,key),{method:'DELETE'});
  return {state:removed.response.status===404||removed.response.ok&&removed.result?.ok===true?'disconnected':stepState(removed)};
 } catch { return {state:'unreachable'}; }
}

// Off for one Agent, kept in its profile: a server the Owner added is known only by its configuration, so switching it
// off for an Agent keeps that (address and sign-in kind) and only stops the Agent's Runs from getting it; Remove deletes.
/** @param {any} connection @param {string} key */
export async function turnOffApp(connection,key) {
 if(appByKey(key)||!appKey.test(String(key))||key==='own'||!companyScope(connection)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const turned=await manage(connection,serverPath(connection,key,'/enabled'),{method:'PUT',body:{enabled:false,profile:connection.profile}});
  return {state:turned.response.status===404||turned.response.ok&&turned.result?.ok===true?'disconnected':stepState(turned)};
 } catch { return {state:'unreachable'}; }
}

// Hermes v0.23.0 takes no tools from the caller (/v1/runs reads input, instructions and the session only), and its MCP
// client sends the same headers for every run of a profile, so a call over MCP could not say which conversation made
// it (ADR 0009). The tools a run offers therefore go into its instructions with an exact reply format, and the calls
// are read back out of the reply.
const toolFence='```gtmworks-tool';
const toolBlock=/```gtmworks-tool[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*/g;
const mostCalls=4; const callSize=4000;
/** @param {string|undefined} instructions @param {import('./engine.mjs').ToolSpec[]|undefined} tools */
const withTools=(instructions,tools)=>!tools?.length?instructions:[instructions,
 `You can ask gtmworks to act for the person writing to you with the tools below. To call one, add to your reply a block of exactly this form, holding one JSON object and nothing else. gtmworks removes these blocks before the person reads your reply, so always write your reply to them as well.\n\n${toolFence}\n{"name":"<tool name>","arguments":<its arguments, one JSON object>}\n\`\`\`\n\n${tools.map(tool=>`- ${tool.name}: ${tool.description} Its arguments, as JSON Schema: ${JSON.stringify(tool.parameters)}`).join('\n')}`].filter(Boolean).join('\n\n');
// How an Agent hands its person a file in a reply (#708, ADR 0028), in every Run gtmworks starts. The Engine's own hint
// for this platform says only images named by a `MEDIA:` tag come through, which is not so for the Runs API gtmworks
// reads (docs/engine-probes/work-sandbox-ssh.md, 8c): gtmworks reads each tag itself (lib/reply-files.mjs), so the Agent
// is told that any kind of file it made in its own work folder is attached, and never to turn one into images.
/** @param {string|undefined} instructions @param {string|undefined} profile */
const withFileDelivery=(instructions,profile)=>[instructions,
 `To give the person a file you made (a PDF, an image, a spreadsheet, a page, any kind of file), save it in your work folder${profile?` (${workFolder}/${profile})`:''} and put its full path on a line of its own in your reply, as MEDIA:${workFolder}/${profile||'<your folder>'}/<path to the file>. gtmworks attaches that file to your reply for the person to open and download, whatever its kind, up to 25 MB; this replaces any other note you have on which files come through. Never convert a file into images to send it, and write no other path to it in your reply. Only files inside your own work folder can be attached.`].filter(Boolean).join('\n\n');
/** @param {string} text */
const json=text=>{ try { return JSON.parse(text); } catch { return null; } };
/** @param {string} output */
function takeToolCalls(output) {
 if(!output.includes(toolFence)) return {reply:output,toolCalls:[]};
 const toolCalls=/** @type {import('./engine.mjs').ToolCall[]} */([]);
 const reply=output.replace(toolBlock,(_,body)=>{
  const call=toolCalls.length<mostCalls&&body.length<=callSize?json(body):null;
  if(typeof call?.name==='string'&&call.name.length<=64) toolCalls.push({id:`call-${toolCalls.length}`,name:call.name,arguments:call.arguments??null});
  return '';
 }).trim();
 return {reply,toolCalls};
}

// A conversation's steps (#346) are read from its Hermes session, never kept by gtmworks: the management listener's
// session messages (v0.23.0 GET /api/sessions/<id>/messages?profile=, hermes_cli/web_routers/sessions.py), oldest first,
// page by page. Each person's message starts a turn; a turn's steps are the tool calls its assistant messages made, in
// order, each done or failed once its result is in the session (failed as Hermes judges a result, agent/display.py
// _detect_tool_failure), else started; its length is from its first message to its last on Hermes's clock.
// The preview is the call's main argument (Hermes's own fallback keys, agent/display.py _FALLBACK_PREVIEW_KEYS, and an
// address), dropped when it holds a path, looks like a key or names the Engine. A tool that names the Engine is no step.
// shortcut: previews use the fallback keys only, not Hermes's per-tool builders; upgrade if a tool's line reads wrong.
const previewKeys=['query','text','command','path','name','prompt','code','goal','url','urls'];
// A file path, not every slash: a word that starts a path (/, ~/, ./, ../), one with a backslash or a drive letter, or one
// of three or more parts joined by slashes. An address (://), a date such as 1/12 or a 50/50 split is kept.
const pathLike=text=>text.split(' ').some(word=>!word.includes('://')&&(/^["'(]?(~|\.{1,2})?\//.test(word)||/\\/.test(word)||/(^|[^\w])[A-Za-z]:[\\/]/.test(word)||/[^/\s]+\/[^/\s]+\/[^/\s]*/.test(word)));
const engineName=/(^|[^\p{L}])hermes(?![\p{L}])/iu;
const toolName=/^[\w.:-]{1,64}$/;
const previewSize=300; const requestTime=5000; const sessionPage=500;
// A download's whole body is read under the request's own signal, up to the size gtmworks serves (25 MiB), so it gets
// longer than a JSON call: a slow Engine must not cut a file the person asked for at five seconds.
const downloadTime=60000;
// shortcut: a session past 20 pages (10,000 messages) shows the steps of its first 10,000; upgrade if chats grow so long.
const sessionPages=20;
const sessionIdLike=/^[\w.:-]{1,200}$/;
/** @param {unknown} preview */
const cleanPreview=preview=>{
 if(typeof preview!=='string') return null;
 const text=preview.toWellFormed().replace(/[\u0000-\u001f\u007f-\u009f�]+/g,' ').replace(/\s+/g,' ').trim();
 if(!text||pathLike(text)||secretLike(text)||engineName.test(text)) return null;
 const points=Array.from(text);
 return points.length<=previewSize?text:`${points.slice(0,previewSize-1).join('').trimEnd()}…`;
};
/** @param {unknown} raw */
const parsed=raw=>{ if(typeof raw!=='string') return raw; try { return JSON.parse(raw); } catch { return raw; } };
/** @param {unknown} raw */
function previewOf(raw) {
 const args=parsed(raw);
 if(!args||typeof args!=='object') return null;
 const key=previewKeys.find(name=>name in args); const value=key?args[key]:null;
 return cleanPreview(Array.isArray(value)?value[0]:value);
}
/** @param {string} tool @param {unknown} content */
function failedResult(tool,content) {
 const data=parsed(content);
 if(!data||typeof data!=='object'||Array.isArray(data)) return false;
 if(data.user_summary) return true;
 if(tool==='terminal') return Number.isFinite(data.exit_code)&&data.exit_code!==0;
 const error=data.error||data.message;
 return !!error&&(data.success===false||'error' in data);
}
// The Engine's own answer for a tool it could not run because its terminal backend is down (#398): `status: "degraded"`
// (v0.23.0 tools/terminal_tool.py _degraded_result), which in this install is the Company's work sandbox. A failed step
// with it is shown as the sandbox's own plain state, not as an ordinary failed command.
/** @param {unknown} content */
const sandboxDown=content=>{ const data=parsed(content); return !!data&&typeof data==='object'&&!Array.isArray(data)&&data.status==='degraded'; };
// A Routine the Agent made in the turn (#205): the Engine's scheduling tool (v0.23.0 tools/cronjob_tools.py, registered
// as cronjob_manage) called to create, whose result names the job made, its name and its schedule as the Engine shows
// it (a cron expression, or its own words for another shape).
const scheduleTool='cronjob_manage';
/** @param {unknown} content */
function routineMade(content) {
 const data=parsed(content);
 if(!data||typeof data!=='object'||data.success!==true||typeof data.job_id!=='string') return null;
 const name=cleanPreview(data.name); const schedule=cleanPreview(data.schedule);
 return name&&schedule?{name,schedule}:null;
}
/** @param {any[]} messages @returns {import('./engine.mjs').SessionTurn[]} */
function turnsOf(messages) {
 /** @type {(import('./engine.mjs').SessionTurn&{last:number,calls:Map<string,number>,creates:Set<number>})[]} */
 const turns=[];
 for(const message of messages) {
  const at=Number(message?.timestamp);
  if(message?.role==='user'&&message.display_kind!=='hidden'&&Number.isFinite(at)) { turns.push({at,seconds:0,steps:[],last:at,calls:new Map(),creates:new Set()}); continue; }
  const turn=turns.at(-1); if(!turn) continue;
  if(Number.isFinite(at)&&at>turn.last) turn.last=at;
  if(message?.role==='assistant') for(const call of Array.isArray(parsed(message.tool_calls))?parsed(message.tool_calls):[]) {
   const tool=call?.function?.name;
   if(typeof tool!=='string'||!toolName.test(tool)||/hermes/i.test(tool)) continue;
   if(typeof call.id==='string') turn.calls.set(call.id,turn.steps.length);
   if(tool===scheduleTool&&parsed(call.function.arguments)?.action==='create') turn.creates.add(turn.steps.length);
   turn.steps.push({tool,preview:previewOf(call.function.arguments),state:'started'});
  }
  if(message?.role==='tool'&&turn.calls.has(message.tool_call_id)) {
   const at=/** @type {number} */(turn.calls.get(message.tool_call_id));
   const step=turn.steps[at];
   step.state=failedResult(step.tool,message.content)?'failed':'done';
   if(step.state==='failed'&&sandboxDown(message.content)) step.sandbox=true;
   const routine=step.state==='done'&&turn.creates.has(at)?routineMade(message.content):null;
   if(routine) step.routine=routine;
  }
 }
 return turns.map(({at,last,steps})=>({at,seconds:Math.round(last-at),steps}));
}
/** @returns {Promise<import('./engine.mjs').SessionRead>} */
export async function readSession(connection,session) {
 const none=state=>({state,turns:null,usage:null});
 if(typeof session!=='string'||!sessionIdLike.test(session)||session.includes('..')) return none('missing');
 if(!reachable(connection)) return none('unreachable');
 try {
  // The session's token use (#347) is its detail's, read beside the messages; unknown when it cannot be read.
  const totals=manage(connection,`/api/sessions/${encodeURIComponent(session)}${query(connection.profile)}`,{timeout:requestTime})
   .then(({response,result})=>response.ok?usageOf(result):null,()=>null);
  const messages=[];
  for(let page=0;page<sessionPages;page++) {
   const {response,result}=await manage(connection,`/api/sessions/${encodeURIComponent(session)}/messages${query(connection.profile)}&order=oldest&limit=${sessionPage}&offset=${page*sessionPage}&inline_images=false`,{timeout:requestTime});
   if(response.status===404) return none('missing');
   if(!response.ok) return none(refusal(response));
   if(!Array.isArray(result?.messages)) return none('unreachable');
   messages.push(...result.messages);
   if(result.messages.length<sessionPage) break;
  }
  return {state:'found',turns:turnsOf(messages),usage:await totals};
 } catch { return none('unreachable'); }
}

// An Agent's token use (#347) is its profile's own, never counted by gtmworks: the management listener's usage
// analytics (v0.23.0 GET /api/analytics/usage?profile=&days=, hermes_cli/web_routers/analytics.py), summed over the
// sessions the profile started in the last `days` (1 to 365). A sum Hermes leaves empty is zero. #32: its by_model rows
// are kept as each model's own count, without `estimated_cost` or any other price; Hermes merges auxiliary usage into
// them, so their sum can pass the totals above and is never added to it.
export async function readUsage(connection,days) {
 const none=state=>({state,input:null,output:null,sessions:null,models:null});
 if(!Number.isSafeInteger(days)||days<1||days>365) return none('unreachable');
 if(!reachable(connection)) return none('unreachable');
 const own=await profileUsage(connection,days);
 // An Agent's designs (#544) are Runs on its design profile, and count as the Agent's use: added when it has one.
 if(own.state!=='found') return own;
 const found=await designProfiles(connection,[connection.profile]);
 if(!found.designs) return none(found.state);
 const design=found.designs.get(connection.profile);
 if(!design) return own;
 const drawn=await profileUsage({...connection,profile:design},days);
 if(drawn.state!=='found') return none(drawn.state);
 const models=[...own.models];
 for(const row of drawn.models) {
  const same=models.findIndex(found=>found.model===row.model);
  if(same<0) models.push(row);
  else models[same]={model:row.model,input:models[same].input+row.input,output:models[same].output+row.output,sessions:models[same].sessions+row.sessions};
 }
 return {state:'found',input:own.input+drawn.input,output:own.output+drawn.output,sessions:own.sessions+drawn.sessions,models};
}
/** @param {any} connection @param {number} days */
async function profileUsage(connection,days) {
 const none=state=>({state,input:null,output:null,sessions:null,models:null});
 try {
  const {response,result}=await manage(connection,`/api/analytics/usage${query(connection.profile)}&days=${days}`,{timeout:requestTime});
  if(response.status===404) return none('missing');
  if(!response.ok) return none(refusal(response));
  const total=value=>value===null||value===undefined?0:count(value)?value:null;
  const [input,output,sessions]=[result?.totals?.total_input,result?.totals?.total_output,result?.totals?.total_sessions].map(total);
  const models=(Array.isArray(result?.by_model)?result.by_model:[]).flatMap(row=>{
   if(typeof row?.model!=='string'||!row.model) return [];
   const [eachInput,eachOutput,eachSessions]=[row.input_tokens,row.output_tokens,row.sessions].map(total);
   return eachInput===null||eachOutput===null||eachSessions===null?[]:[{model:row.model,input:eachInput,output:eachOutput,sessions:eachSessions}];
  });
  return input===null||output===null||sessions===null?none('unreachable'):{state:'found',input,output,sessions,models};
 } catch { return none('unreachable'); }
}

// The Library of an Agent (#194) reads one named folder through the Engine's dashboard file routes, and never copies a
// file into gtmworks. It has two roots (#353), each a name gtmworks chooses and never a path segment a browser sends, so
// a work folder called `images` is still a folder of `work` and cannot collide with the images root.
//
// `work` is the Agent's own folder in its Company's work folder (#395, ADR 0018): `/work/<profile>` in the work sandbox,
// where every command of that Agent starts (#393, sandbox/work-shell) and where its file tools write. Every Agent of the
// Company can read and change all of the work folder; the Library opens on the Agent's own part of it. The Engine sees
// the same volume read-only at `/opt/data/work` (scripts/engine-template.yml), inside the dashboard's managed files root
// (`/opt/data`, hermes_cli/web_server_files.py _managed_files_policy), so a folder is listed by the Engine with each
// entry's size and time and the path it resolves to. A file's bytes are never read through that mount: what the work
// folder holds is written by whoever talks to an Agent, so a link swapped in between the listing and the read would
// resolve on the Engine's own disk (another Agent's memory, a private Conversation). They are read through the profile's
// ssh workspace instead (v0.23.0 /api/fs/read-text and /api/fs/download with `profile`, hermes_cli/ssh_workspace_fs.py),
// inside the sandbox, where a link reaches nothing an Agent's own terminal cannot.
//
// `images` is where the Engine writes a generated image (`agent/provider_media.py`: GENERATED_SUBDIR under the
// profile's cache_dir, outside the folders the gateway sweeps), on the Engine's own disk, where no Agent writes: it is
// listed and read through the managed files routes (/api/files, /api/files/download), never through the ssh workspace,
// which holds none of the Engine's files.
// The sandbox's path is the one every Agent's start folder is pinned under (lib/agent-toolsets.mjs).
const engineWork='/opt/data/work'; const sandboxWork=workFolder;
// A Library root, by name: `work` unless the caller names one. Anything else is null — refused before the Engine is
// asked, so no other folder of a profile is ever read through the Library.
/** @param {unknown} raw @returns {'work'|'images'|null} */
export function libraryRoot(raw) {
 if(raw===undefined) return 'work';
 return raw==='work'||raw==='images'?raw:null;
}
// Whether the Company's work sandbox answers (#398): one read of the Engine's own ssh workspace, the backend its Agents'
// terminal, files and code run in. A folder the sandbox holds lists; a sandbox that is not running answers the Engine's
// 503 (`SSH workspace is unavailable`), a 502 when its dial fails, or a listing with an error instead of entries. No
// polling and no retry: the next page or command reads it again. `unreachable` is the Engine itself not answering (which
// Settings names separately), `refused` its key.
/** @param {{address:string,key:string,managementAddress?:string}|null} connection @returns {Promise<{state:'running'|'notRunning'|'refused'|'unreachable'}>} */
export async function readWorkSandbox(connection) {
 if(!connection||!reachable(connection)) return {state:'unreachable'};
 try {
  // The page that reads it waits for it, so it gets the management reads' own 5 s, not more.
  const {response,result}=await manage(connection,`/api/fs/list?path=${encodeURIComponent(sandboxWork)}`);
  if([502,503].includes(response.status)) return {state:'notRunning'};
  if(!response.ok) return {state:refusal(response)};
  if(typeof result?.error==='string'&&result.error) return {state:'notRunning'};
  return Array.isArray(result?.entries)?{state:'running'}:{state:'unreachable'};
 } catch { return {state:'unreachable'}; }
}
// A file gtmworks serves as an attachment is read to its end, up to this size: a longer one is refused, never held.
const libraryLimit=25*1024*1024;
// The preview's first part, as the Engine's own read-text cuts it (files.py _FS_TEXT_PREVIEW_MAX_BYTES).
const previewLimit=512*1024;

// A folder or file inside the work folder is named by a relative path of plain segments: no absolute path, no `..`, no
// hidden name, no backslash, no colon and no NUL, at most eight names of 128 characters each. '' is the work folder
// itself. Anything else is refused here, before the Engine is asked (null).
/** @param {unknown} raw @returns {string[]|null} */
export function workSegments(raw) {
 if(raw===undefined||raw==='') return [];
 if(typeof raw!=='string'||raw.length>512) return null;
 const parts=raw.split('/');
 if(parts.length>8) return null;
 for(const part of parts) if(!part||part.length>128||part==='.'||part==='..'||part.startsWith('.')||/[:\\\u0000-\u001f\u007f]/.test(part)) return null;
 return parts;
}
const folderOf=path=>path.slice(0,path.lastIndexOf('/'));
/** @param {unknown} mtime @returns {string|null} */
const fileTime=mtime=>Number.isFinite(mtime)&&/** @type {number} */(mtime)>0?new Date(/** @type {number} */(mtime)*1000).toISOString():null;
// The Engine path a root starts at for the profile this connection is bound to. The profile must be one the Engine's
// own profile list names (v0.23.0 web_routers/profiles.py 84-92): the images root is inside its home, and the work root
// is the profile's own folder of the work folder. gtmworks builds the path it asks about and never takes one from a
// browser.
/** @param {any} connection @param {'work'|'images'} root */
async function rootPath(connection,root) {
 if(!agentName.test(connection.profile)) return {state:'missing',path:null};
 const {response,result}=await manage(connection,'/api/profiles');
 if(!response.ok) return {state:refusal(response),path:null};
 const found=Array.isArray(result?.profiles)?result.profiles.find(profile=>profile?.name===connection.profile):undefined;
 const home=typeof found?.path==='string'?found.path.replace(/\/+$/,''):'';
 if(!home.startsWith('/')) return {state:'missing',path:null};
 return {state:'found',path:root==='work'?`${engineWork}/${connection.profile}`:`${home}/cache/generated/images`};
}
// One folder of a root, as `/api/files?path=` reports it (v0.23.0 web_routers/files.py 616 with
// web_server_files.py _managed_file_entry): a name, whether it is a folder, its size, its time and the path it resolves
// to. An entry the Engine resolved outside this folder is a link out of it, and is neither listed nor read. The folder
// the Engine resolved must be the one gtmworks asked for — a root, or a folder inside it, that is a link somewhere else is
// not this Agent's Library at all (missing) — and no entry is used before that check. `unmade` says the Engine has no
// such folder at all (404) rather than a folder that is a link.
/** @param {any} connection @param {string} base @param {string[]} segments */
async function readFolder(connection,base,segments) {
 const target=[base,...segments].join('/');
 const {response,result}=await manage(connection,`/api/files?path=${encodeURIComponent(target)}`);
 if(response.status===404) return {state:'missing',entries:null,folder:null,unmade:true};
 if(!response.ok) return {state:refusal(response),entries:null,folder:null,unmade:false};
 if(!Array.isArray(result?.entries)) return {state:'unreachable',entries:null,folder:null,unmade:false};
 const folder=typeof result.path==='string'?result.path.replace(/\/+$/,''):'';
 if(folder!==target) return {state:'missing',entries:null,folder:null,unmade:false};
 const entries=[];
 for(const entry of result.entries) {
  const name=entry?.name; const at=typeof entry?.path==='string'?entry.path.replace(/\/+$/,''):'';
  if(typeof name!=='string'||workSegments(name)?.length!==1) continue;
  if(entry.broken_link===true||!at||folderOf(at)!==folder) continue;
  const isFolder=entry.is_directory===true;
  const size=!isFolder&&Number.isSafeInteger(entry.size)&&entry.size>=0?entry.size:null;
  entries.push({name,isFolder,size,time:isFolder?null:fileTime(entry.mtime)});
 }
 return {state:'found',entries,folder,unmade:false};
}
// The empty answer a Library root gives when the Engine has no such folder yet: the generated images folder is made with
// the first image (#353), and an Agent's own work folder with its first command (#395, sandbox/work-shell), so a profile
// with neither reads as the empty folder it is rather than a missing one. A folder that is a link somewhere else is
// still missing — only the Engine's own 404 of a root itself is empty.
const unmadeRoot=(segments,read)=>!segments.length&&read.unmade===true;
/** @param {any} connection @param {unknown} [folder] @param {unknown} [root] */
export async function listAgentFiles(connection,folder='',root='work') {
 const segments=workSegments(folder); const at=libraryRoot(root);
 if(!segments||!at) return {state:'invalid',entries:null};
 if(!reachable(connection)) return {state:'unreachable',entries:null};
 try {
  const base=await rootPath(connection,at);
  if(base.state!=='found') return {state:base.state,entries:null};
  const read=await readFolder(connection,base.path,segments);
  if(unmadeRoot(segments,read)) return {state:'found',entries:[]};
  return {state:read.state,entries:read.entries};
 } catch { return {state:'unreachable',entries:null}; }
}
// A download is read to its end, up to the size gtmworks serves; null when it is longer than that. With `cut`, a body
// longer than the limit is its first `limit` bytes instead: an Engine that ignores a Range still sends no more than that.
/** @param {Response} response @param {number} [limit] @param {boolean} [cut] */
async function boundedBytes(response,limit=libraryLimit,cut=false) {
 const reader=response.body?.getReader(); if(!reader) return new Uint8Array(0);
 const chunks=[]; let size=0;
 for(;;) {
  const {done,value}=await reader.read();
  if(done) break;
  if(size+value.byteLength>limit) {
   await reader.cancel().catch(()=>{});
   if(!cut) return null;
   chunks.push(value.subarray(0,limit-size)); size=limit; break;
  }
  size+=value.byteLength;
  chunks.push(value);
 }
 const body=new Uint8Array(size); let at=0; for(const chunk of chunks) { body.set(chunk,at); at+=chunk.byteLength; }
 return body;
}
// One file of a root, named by its folder and its own name: the folder is listed first, so a name the folder no longer
// holds, a folder itself and a link out of the folder are refused before the Engine is asked for the file. The path guard
// runs over both names, and the root over its own closed list, before anything is asked. States: found (the entry, and
// where its bytes are read: the Engine's own path for the images root, the sandbox's path for the work root), invalid,
// missing, refused (the key) or unreachable.
/** @param {any} connection @param {{folder?:unknown,name?:unknown,root?:unknown}} file */
async function listedFile(connection,{folder='',name,root='work'}={}) {
 const segments=workSegments(folder); const one=workSegments(name); const at=libraryRoot(root);
 if(!segments||!one||one.length!==1||!at) return {state:'invalid'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const base=await rootPath(connection,at);
  if(base.state!=='found') return {state:base.state};
  const read=await readFolder(connection,base.path,segments);
  if(read.state!=='found') return {state:read.state};
  const entry=read.entries.find(item=>item.name===name);
  if(!entry) return {state:'missing'};
  if(entry.isFolder) return {state:'invalid'};
  const path=at==='work'?[sandboxWork,connection.profile,...segments,name].join('/'):`${read.folder}/${name}`;
  return {state:'found',entry,root:at,path};
 } catch { return {state:'unreachable'}; }
}
// The bytes of a listed file: from the profile's ssh workspace for the work root, from the Engine's managed files for
// the images root. The answer is the response, its body unread.
/** @param {any} connection @param {{root:'work'|'images',path:string}} listed @param {Record<string,string>} [headers] */
const fetchFile=(connection,listed,headers={})=>fetch(listed.root==='work'
 ?`${managementRoot(connection)}/api/fs/download?path=${encodeURIComponent(listed.path)}&profile=${encodeURIComponent(connection.profile)}`
 :`${managementRoot(connection)}/api/files/download?path=${encodeURIComponent(listed.path)}`,
 {headers:{...authorized(connection.key),...headers},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(downloadTime)});
// What a file read that is not a success means. The Engine refuses a path that resolves outside the root it reads under,
// and a sensitive file, with a 403: for a file the folder listed, that is a file this Agent does not have (missing), and
// only a 401 is the key refused.
/** @param {Response} response */
const fileRefusal=response=>[403,404].includes(response.status)?'missing':response.status===413?'tooLarge':response.status===401?'refused':'unreachable';
// One file's bytes, up to the size gtmworks serves, with the Engine's type: found, missing, tooLarge, refused or
// unreachable.
/** @param {any} connection @param {{root:'work'|'images',path:string}} listed */
async function fileBytes(connection,listed) {
 const response=await fetchFile(connection,listed);
 if(!response.ok) { await response.body?.cancel().catch(()=>{}); return {state:fileRefusal(response)}; }
 const body=await boundedBytes(response);
 if(!body) return {state:'tooLarge'};
 const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 return {state:'found',type:type||'application/octet-stream',body};
}

// One file of a root is fetched by gtmworks and never by an address the browser holds: the file is `listedFile`
// first, so a name the folder no longer holds, a folder itself and a link out of the folder are refused before the
// Engine is asked for any bytes. The file's type is the Engine's, and its body is never written down.
// shortcut: a download's answer carries no path of its own, so a link swapped between the listing and this one request is
// only as narrow as the folder's own check above. For the work root that link resolves inside the sandbox, which holds
// nothing an Agent's terminal cannot already read; the bytes are handed on as an attachment, never as a page.
/** @param {any} connection @param {{folder?:unknown,name?:unknown,root?:unknown}} file */
export async function downloadAgentFile(connection,file={}) {
 const listed=await listedFile(connection,file);
 if(listed.state!=='found') return {state:listed.state};
 try {
  const read=await fileBytes(connection,listed);
  if(read.state!=='found') return {state:read.state};
  return {state:'found',name:listed.entry.name,type:read.type,size:read.body.byteLength,body:read.body};
 } catch { return {state:'unreachable'}; }
}

// A file's first part, for the read-only preview (#195). In the work root the Engine reads the first 512 KB of the file
// in the sandbox and says how big the whole file is, what type it is and whether more follows (v0.23.0 GET
// /api/fs/read-text, web_routers/files.py 1032-1079), and the answer must name the file asked for. In the images root,
// where only the Engine writes, the same first 512 KB is asked for as a range and cut there whatever the Engine sends,
// with the whole size from its Content-Range (or the folder's listing). The same guard as the download; a file that reads
// as binary is handed on with no text at all.
// A file reads as binary by the Engine's own rule (web_routers/files.py 157-163): a NUL, or more than 12% control bytes,
// in its first 4 KB.
/** @param {Uint8Array} data */
const looksBinary=data=>{ const head=data.subarray(0,4096); if(!head.length) return false; if(head.includes(0)) return true;
 let odd=0; for(const byte of head) if(byte<32&&![9,10,13].includes(byte)) odd++; return odd/head.length>0.12; };
/** @param {any} connection @param {{folder?:unknown,name?:unknown,root?:unknown}} file */
export async function readAgentFile(connection,file={}) {
 const listed=await listedFile(connection,file);
 if(listed.state!=='found') return {state:listed.state};
 try {
  if(listed.root==='images') {
   const response=await fetchFile(connection,listed,{Range:`bytes=0-${previewLimit-1}`});
   // An empty file has no first byte to give: the range is refused (416), and the file is the empty preview it is.
   if(response.status===416&&listed.entry.size===0) { await response.body?.cancel().catch(()=>{}); return {state:'found',name:listed.entry.name,type:'text/plain',byteSize:0,truncated:false,text:''}; }
   if(!response.ok) { await response.body?.cancel().catch(()=>{}); return {state:fileRefusal(response)}; }
   const data=/** @type {Uint8Array} */(await boundedBytes(response,previewLimit,true));
   const whole=Number(/\/(\d+)$/.exec(response.headers.get('content-range')||'')?.[1]??listed.entry.size??data.byteLength);
   const byteSize=Number.isSafeInteger(whole)&&whole>=data.byteLength?whole:data.byteLength;
   const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()||'application/octet-stream';
   return {state:'found',name:listed.entry.name,type,byteSize,truncated:byteSize>previewLimit,text:looksBinary(data)?null:new TextDecoder().decode(data,{stream:byteSize>data.byteLength})};
  }
  const {response,result}=await manage(connection,`/api/fs/read-text?path=${encodeURIComponent(listed.path)}&profile=${encodeURIComponent(connection.profile)}`);
  // A file over the Engine's own read ceiling (413) is refused rather than read.
  if(!response.ok) return {state:fileRefusal(response)};
  if(result?.path!==listed.path) return {state:'missing'};
  if(typeof result?.text!=='string'||!Number.isSafeInteger(result?.byteSize)||typeof result?.mimeType!=='string') return {state:'failed'};
  return {state:'found',name:listed.entry.name,type:result.mimeType,byteSize:result.byteSize,truncated:result.truncated===true,text:result.binary===true?null:result.text};
 } catch { return {state:'unreachable'}; }
}

// One recording as text (#160), on the management listener for the Agent's own profile (v0.23.0
// hermes_cli/web_routers/audio.py 89-149): the recording is a base64 data URL of at most 25 MB, the answer the
// transcript and the provider that wrote it. The recording goes in the request body only: gtmworks stores it nowhere and
// logs nothing of it, and the driver returns its words only. An empty transcript is silence, not an error. `unavailable`
// is the Engine saying it holds no speech-to-text provider to use: the profile's `stt.provider` is unset and its local
// model is not installed.
const maxRecording=25*1024*1024;
const maxAudioUrl=Math.ceil(maxRecording/3)*4+1024;
const noStt='No STT provider available';
/** @param {any} connection @param {{dataUrl:string,mimeType:string}} audio @returns {Promise<import('./engine.mjs').Transcription>} */
async function transcribe(connection,audio) {
 if(!reachable(connection)) return {state:'unreachable'};
 const dataUrl=typeof audio?.dataUrl==='string'?audio.dataUrl:'';
 const mimeType=typeof audio?.mimeType==='string'&&/^audio\/[a-z0-9.+-]{1,40}$/i.test(audio.mimeType)?audio.mimeType:'audio/webm';
 if(!dataUrl.startsWith('data:audio/')||dataUrl.length>maxAudioUrl) return {state:'refused'};
 try {
  const sent=await manage(connection,`/api/audio/transcribe${query(connection.profile)}`,{method:'POST',body:{data_url:dataUrl,mime_type:mimeType},timeout:60000});
  if([401,403].includes(sent.response.status)) return {state:'refused'};
  const detail=typeof sent.result?.detail==='string'?sent.result.detail:'';
  if(sent.response.status===400&&(detail.includes(noStt)||/stt[^\n]*\b(disabled|off)\b/i.test(detail))) return {state:'unavailable'};
  if(!sent.response.ok||sent.result?.ok!==true) return {state:'failed'};
  return {state:'transcribed',text:typeof sent.result.transcript==='string'?sent.result.transcript:''};
 } catch { return {state:'unreachable'}; }
}
// The language the profile listens in (`stt.language`; the Engine's default is `en`, and an empty value means it detects
// the language itself). Read from the profile's config, as every other profile setting is.
/** @param {any} connection @returns {Promise<import('./engine.mjs').DictationSettings>} */
async function readDictation(connection) {
 if(!reachable(connection)) return {state:'unreachable',language:null};
 try {
  const read=await manage(connection,`/api/config${query(connection.profile)}`);
  if(!read.response.ok) return {state:refusal(read.response),language:null};
  // No `stt.language` at all is the Engine's own default (`en`); an empty one is the profile asking it to detect.
  const configured=read.result?.stt?.language;
  const language=typeof configured==='string'?configured.trim().slice(0,35):configured===undefined?'en':'';
  return {state:'found',language:language||null};
 } catch { return {state:'unreachable',language:null}; }
}

// A Run's tool calls as they happen (#646), from its event stream (v0.23.0 GET /v1/runs/<run>/events,
// gateway/platforms/api_server_runs.py _handle_run_events; the same key and permission as the Run's record): server-sent
// frames numbered from 0. Hermes keeps a Run's last 1,000 events in memory and replays them to every new reader, so a
// reader who comes in mid-Run gets the calls made so far; it says so (replay.truncated) when older ones are gone. A
// terminal run event ends the Run's events, and Hermes then says the stream closed.
// `tool.started` carries the tool, Hermes's own preview of the call (agent/display.py build_tool_preview) and the call's
// id; `tool.completed` the same id and whether the call failed (`error`, Hermes's _detect_tool_failure). The preview is
// cleaned as a session step's is (cleanPreview: a path, a key or the Engine's name drops it), a tool that names the
// Engine is no step, and an ended call's preview (a summary of its result) is never read. A call Hermes gives no id is
// known by the number of its start, and its end by its tool.
// shortcut: v0.23.0 sends no event between a Run's last tool call and its reply, so "Writing the reply" is inferred from
// no call being open; upgrade if a later release streams the reply's own start.
const terminalEvents=new Set(['run.completed','run.failed','run.cancelled','run.interrupted']);
const frameLimit=1024*1024;
/** @param {any} event @param {number} seq @returns {import('./engine.mjs').RunStepEvent['step']} */
function stepEventOf(event,seq) {
 if(event?.event!=='tool.started'&&event?.event!=='tool.completed') return null;
 if(typeof event.tool!=='string'||!toolName.test(event.tool)||/hermes/i.test(event.tool)) return null;
 const id=typeof event.tool_call_id==='string'&&sessionIdLike.test(event.tool_call_id)?event.tool_call_id:null;
 if(event.event==='tool.started') return {call:id??`#${seq}`,tool:event.tool,preview:cleanPreview(event.preview),state:'started'};
 return {call:id,tool:event.tool,preview:null,state:event.error===true||event.is_error===true?'failed':'done'};
}
/** @param {string} frame */
function frameOf(frame) {
 const data=[]; let closed=false;
 for(const line of frame.split('\n')) {
  const colon=line.indexOf(':'); const field=colon<0?line:line.slice(0,colon); const value=colon<0?'':line.slice(colon+1).replace(/^ /,'');
  if(field==='data') data.push(value); else if(field===''&&value.trim()==='stream closed') closed=true;
 }
 return {closed,event:data.length?json(data.join('\n')):null};
}
// A stream's text so far with the next chunk added, every line end as \n. A \r\n split between two chunks is one line
// end: a \r last in the text waits for what follows it.
/** @param {string} buffer @param {string} chunk */
function withChunk(buffer,chunk) {
 const text=buffer+chunk; const pending=text.endsWith('\r')?1:0;
 return text.slice(0,text.length-pending).replace(/\r\n?/g,'\n')+(pending?'\r':'');
}
/** @param {{address:string,profile:string,key:string,run:string,signal?:AbortSignal}} read @returns {AsyncGenerator<import('./engine.mjs').RunEvent>} */
async function* readRunEvents({address,profile,key,run,signal}) {
 if(!isHermesAddressAllowed(address)) { yield {end:'unreachable'}; return; }
 // Hermes answers within the time any other request to it gets, or the read is unreachable; once it answers, the stream
 // lasts as long as the Run does, until `signal` stops it.
 let response; const answered=new AbortController(); const late=setTimeout(()=>answered.abort(),requestTime);
 try { response=await fetch(`${runRoot({address,profile})}/${encodeURIComponent(run)}/events`,{headers:{...authorized(key),Accept:'text/event-stream'},redirect:'manual',cache:'no-store',signal:signal?AbortSignal.any([signal,answered.signal]):answered.signal}); }
 catch { clearTimeout(late); yield {end:'unreachable'}; return; }
 // A refusal's body is read under the same deadline, so an answer that stalls after its head is still unreachable;
 // only a stream Hermes opened stays open past it.
 if(!response.ok||!response.body) {
  const result=await boundedJson(response).catch(()=>null);
  clearTimeout(late);
  yield {end:response.status===404&&result!==tooLarge&&result?.error?.code==='run_not_found'?'gone':'unreachable'}; return;
 }
 clearTimeout(late);
 const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
 let buffer=''; let ended=false; let end=/** @type {'ended'|'closed'|'unreachable'} */('closed');
 try {
  reading: for(;;) {
   const {done,value}=await reader.read();
   if(done) break;
   buffer=withChunk(buffer,value);
   for(let at=buffer.indexOf('\n\n');at>=0;at=buffer.indexOf('\n\n')) {
    const {closed,event}=frameOf(buffer.slice(0,at)); buffer=buffer.slice(at+2);
    if(closed) { ended=true; break reading; }
    if(event?.event==='replay.truncated') { yield {lost:true}; continue; }
    if(!Number.isSafeInteger(event?.seq)||event.seq<0) continue;
    if(terminalEvents.has(event.event)) { ended=true; continue; }
    const step=stepEventOf(event,event.seq);
    if(step) yield {seq:event.seq,step};
   }
   if(buffer.length>frameLimit) { end='unreachable'; break; }
  }
 } catch { end='unreachable'; }
 finally { await reader.cancel().catch(()=>{}); }
 yield {end:ended?'ended':end};
}

// The Hermes driver of the engine contract (lib/engine.mjs): one conversation is one Hermes session, and Hermes's
// cancelled and interrupted runs are the contract's stopped. Only this driver talks to Hermes.
export function hermesEngine(connection) {
 return {
  // Every Run carries how its Agent hands a file in its reply (#708). A start the previous release sent without it and
  // lost the answer to is retried here under the same key: Hermes holds that key for the earlier body and refuses this
  // one (409), so the retry sends that earlier body once more, which replays the Run it started.
  start:async({conversation,input,idempotencyKey,instructions,tools,history,model,retry})=>{
   const sent={...connection,input,history,model,sessionKey:conversation,idempotencyKey,retry:retry===true};
   const started=await startRun({...sent,instructions:withFileDelivery(withTools(instructions,tools),connection.profile)});
   if(started!==keyConflict) return started;
   if(retry!==true) return null;
   const earlier=await startRun({...sent,instructions:withTools(instructions,tools)});
   return earlier===keyConflict?startUnknown:earlier;
  },
  transcribe:audio=>transcribe(connection,audio),
  dictation:()=>readDictation(connection),
  models:()=>readModels(connection),
  read:async run=>{
   const {status,output,session,usage,question,permission,noModel,modelRefused,resetsAt,served,chosen}=await readRun({...connection,run});
   const {reply,toolCalls}=output===null?{reply:null,toolCalls:[]}:takeToolCalls(output);
   const said=(question||permission)&&session?await pausedWords(connection,session):null;
   return {state:status==='cancelled'||status==='interrupted'?'stopped':status,reply,session,usage,toolCalls,...(question?{question}:{}),...(permission?{permission}:{}),...(said?{said}:{}),...(noModel?{noModel}:{}),...(modelRefused?{modelRefused}:{}),...(resetsAt?{resetsAt}:{}),...(served?{served}:{}),...(chosen?{chosen}:{})};
  },
  stop:run=>stopRun({...connection,run}),
  answer:(run,question,text)=>answerRun({...connection,run,question,text}),
  permit:(run,permission,choice)=>permitRun({...connection,run,permission,choice}),
  session:session=>readSession(connection,session),
  markSession:(session,archived)=>markSession(connection,session,archived),
  steps:(run,{signal}={})=>readRunEvents({...connection,run,signal}),
  createAgent:agent=>createAgent(connection,agent),
  readAgent:name=>readAgent(connection,name),
  provideAgent:agent=>provideAgent(connection,agent),
  giveProviders:target=>giveProviders(connection,target),
  removeAgent:name=>removeAgent(connection,name),
  readKeys:space=>readProviderKeys(connection,{space,profiles:[]}),
  apps:()=>readApps(connection),
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
