import { workFolder } from '../agent-toolsets.mjs';
import { engineRequest, EngineFailure, isHermesAddressAllowed, onProfile, withCause } from './transport.mjs';
import { cleanPreview, sessionIdLike, toolName } from './sessions.mjs';
import { boundedJson, tooLarge, requestTime } from './wire.mjs';

// One conversation is one Hermes session; the same idempotency key replays the same run. Instructions are Hermes's
// per-run system prompt (v0.23.0 /v1/runs `instructions`, an ephemeral prompt that is not stored in the session).
const runPath=(profile,rest='')=>onProfile(profile,`/v1/runs${rest}`);
// A start has four outcomes. A run id: Hermes started it (or replayed it for the same key). null: Hermes refused it: the
// address is not allowed, or on the first attempt Hermes answered with a refusal. startNotReached: on the first attempt
// nothing could connect (#413), so the request never reached Hermes and the start may be made again as a first one.
// startUnknown: the request may have reached Hermes but no usable answer came back (a timeout, a connection
// closed mid-answer, a gateway's 502, 503 or 504, an accepted answer without a run id), so the run may exist; the caller keeps its reservation and asks again with the same
// idempotency key and the same body (`retry`), and every outcome but a run id stays unknown, until Hermes says which.
export const startUnknown=Object.freeze({state:'unknown'});
export const startNotReached=Object.freeze({state:'notReached'});
// A start whose key Hermes already holds for a different body; never an answer of the engine contract.
export const keyConflict=Object.freeze({state:'keyConflict'});
// A Run on a chosen model (#158) names its provider and model, as the Engine takes them for that Run alone
// (gateway/platforms/api_server.py 269-291, _request_agent_overrides); the profile's own model is left as it is.
export async function startRun({address,profile,key,input,instructions,history,model,sessionKey,idempotencyKey,retry=false}) {
 if(!isHermesAddressAllowed(address)) return retry?startUnknown:null;
 const body={input,...(instructions?{instructions}:{}),...(history?.length?{conversation_history:history}:{}),...(model?{provider:model.provider,model:model.model}:{})};
 const request={method:'POST',path:runPath(profile),headers:{'X-Hermes-Session-Key':sessionKey,'Idempotency-Key':idempotencyKey},body,deadline:10000,now:true};
 // A request that got no answer is sent once more at once: the same key and body make it the same run, and a
 // connection closed under a reused socket is answered by the second attempt. Only the first attempt can prove the run
 // did not start (nothing connected, or Hermes itself refused it); once an answer was lost, or a gateway answered
 // 502, 503 or 504, every later failure leaves the outcome unknown.
 // A retry of a start that was once unknown (`retry`) begins lost: no answer can prove that start did not happen.
 let lost=retry;
 for(let attempt=1;attempt<=2;attempt++) {
  let response;
  try { response=await engineRequest({address,key},request); }
  catch(failure) { if(!lost&&failure instanceof EngineFailure&&!failure.sent) return startNotReached; lost=true; continue; }
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
  const response=await engineRequest({address,key},{path:runPath(profile,`/${encodeURIComponent(run)}`),now:true});
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
 } catch(error) { return withCause({...unreachable},error); }
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
/** @param {unknown} controls @returns {import('../engine.mjs').RunQuestion|null} */
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
/** @returns {Promise<import('../engine.mjs').AnsweredQuestion>} */
export async function answerRun({address,profile,key,run,question,text}) {
 const parts=/^([\w-]{1,100})@(\d{1,15})$/.exec(question);
 const picks=Array.isArray(text)&&text.length>0&&text.every(pick=>typeof pick==='string');
 if(!parts||typeof text!=='string'&&!picks) return 'gone';
 if(!isHermesAddressAllowed(address)) return 'unreachable';
 try {
  const response=await engineRequest({address,key},{method:'POST',path:runPath(profile,`/${encodeURIComponent(run)}/clarify`),now:true,
   body:{request_id:parts[1],execution_generation:Number(parts[2]),answer:picks?JSON.stringify(text):text},deadline:10000});
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
/** @type {import('../engine.mjs').PermissionChoice[]} */
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
/** @param {unknown} asked @returns {import('../engine.mjs').RunPermission|null} */
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
/** @returns {Promise<import('../engine.mjs').AnsweredPermission>} */
export async function permitRun({address,profile,key,run,permission,choice}) {
 if(typeof permission!=='string'||!requestId.test(permission)||!permissionChoices.includes(choice)) return 'gone';
 if(!isHermesAddressAllowed(address)) return 'unreachable';
 try {
  const response=await engineRequest({address,key},{method:'POST',path:runPath(profile,`/${encodeURIComponent(run)}/approval`),body:{choice,request_id:permission},deadline:10000,now:true});
  const result=await boundedJson(response);
  if(response.ok) return 'answered';
  const code=result===tooLarge?null:result?.error?.code??result?.code;
  return notWaiting[response.status]?.includes(code)?'gone':'unreachable';
 } catch { return 'unreachable'; }
}
// Hermes stops a run it is running; an ended or unknown run is not stopped again.
export async function stopRun({address,profile,key,run}) {
 if(!isHermesAddressAllowed(address)) return false;
 try {
  const response=await engineRequest({address,key},{method:'POST',path:runPath(profile,`/${encodeURIComponent(run)}/stop`),now:true});
  return response.ok;
 } catch { return false; }
}
// Hermes v0.23.0 takes no tools from the caller (/v1/runs reads input, instructions and the session only), and its MCP
// client sends the same headers for every run of a profile, so a call over MCP could not say which conversation made
// it (ADR 0009). The tools a run offers therefore go into its instructions with an exact reply format, and the calls
// are read back out of the reply.
const toolFence='```gtmworks-tool';
const toolBlock=/```gtmworks-tool[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*/g;
const mostCalls=4; const callSize=4000;
/** @param {string|undefined} instructions @param {import('../engine.mjs').ToolSpec[]|undefined} tools */
export const withTools=(instructions,tools)=>!tools?.length?instructions:[instructions,
 `You can ask gtmworks to act for the person writing to you with the tools below. To call one, add to your reply a block of exactly this form, holding one JSON object and nothing else. gtmworks removes these blocks before the person reads your reply, so always write your reply to them as well.\n\n${toolFence}\n{"name":"<tool name>","arguments":<its arguments, one JSON object>}\n\`\`\`\n\n${tools.map(tool=>`- ${tool.name}: ${tool.description} Its arguments, as JSON Schema: ${JSON.stringify(tool.parameters)}`).join('\n')}`].filter(Boolean).join('\n\n');
// How an Agent hands its person a file in a reply (#708, ADR 0028), in every Run gtmworks starts. The Engine's own hint
// for this platform says only images named by a `MEDIA:` tag come through, which is not so for the Runs API gtmworks
// reads (docs/engine-probes/work-sandbox-ssh.md, 8c): gtmworks reads each tag itself (lib/reply-files.mjs), so the Agent
// is told that any kind of file it made in its own work folder is attached, and never to turn one into images.
/** @param {string|undefined} instructions @param {string|undefined} profile */
export const withFileDelivery=(instructions,profile)=>[instructions,
 `To give the person a file you made (a PDF, an image, a spreadsheet, a page, any kind of file), save it in your work folder${profile?` (${workFolder}/${profile})`:''} and put its full path on a line of its own in your reply, as MEDIA:${workFolder}/${profile||'<your folder>'}/<path to the file>. gtmworks attaches that file to your reply for the person to open and download, whatever its kind, up to 25 MB; this replaces any other note you have on which files come through. Never convert a file into images to send it, and write no other path to it in your reply. Only files inside your own work folder can be attached.`].filter(Boolean).join('\n\n');
/** @param {string} text */
const json=text=>{ try { return JSON.parse(text); } catch { return null; } };
/** @param {string} output */
export function takeToolCalls(output) {
 if(!output.includes(toolFence)) return {reply:output,toolCalls:[]};
 const toolCalls=/** @type {import('../engine.mjs').ToolCall[]} */([]);
 const reply=output.replace(toolBlock,(_,body)=>{
  const call=toolCalls.length<mostCalls&&body.length<=callSize?json(body):null;
  if(typeof call?.name==='string'&&call.name.length<=64) toolCalls.push({id:`call-${toolCalls.length}`,name:call.name,arguments:call.arguments??null});
  return '';
 }).trim();
 return {reply,toolCalls};
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
/** @param {any} event @param {number} seq @returns {import('../engine.mjs').RunStepEvent['step']} */
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
/** @param {{address:string,profile:string,key:string,run:string,signal?:AbortSignal}} read @returns {AsyncGenerator<import('../engine.mjs').RunEvent>} */
export async function* readRunEvents({address,profile,key,run,signal}) {
 if(!isHermesAddressAllowed(address)) { yield {end:'unreachable'}; return; }
 // Hermes answers within the time any other request to it gets, or the read is unreachable; once it answers, the stream
 // lasts as long as the Run does, until `signal` stops it.
 let response; const answered=new AbortController(); const late=setTimeout(()=>answered.abort(),requestTime);
 try { response=await engineRequest({address,key},{path:runPath(profile,`/${encodeURIComponent(run)}/events`),headers:{Accept:'text/event-stream'},deadline:requestTime,stream:true,now:true,signal:signal?AbortSignal.any([signal,answered.signal]):answered.signal}); }
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

// The tokens Hermes reported for a run; anything missing or malformed is unknown (null), never zero.
export const count=value=>Number.isSafeInteger(value)&&value>=0;
export function usageOf(usage) {
 return count(usage?.input_tokens)&&count(usage?.output_tokens)?{input:usage.input_tokens,output:usage.output_tokens}:null;
}
