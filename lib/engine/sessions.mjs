import { secretLike } from '../secret-text.mjs';
import { engineRequest, isHermesAddressAllowed, onProfile } from './transport.mjs';
import { count, takeToolCalls, usageOf } from './runs.mjs';
import { manage, query, reachable, refusal, requestTime } from './wire.mjs';

// A Conversation's session keeps the archived mark its Conversation has (#674): the pinned release's own sidebar flag,
// set on the API listener with the profile's key (v0.23.0 PATCH /api/sessions/<id>, gateway/platforms/api_server.py
// _handle_patch_session, set_session_archived), which hides the session and its compression lineage and keeps every
// message; the flag is the only field sent, so nothing else of the session, and none of the Agent's memory, changes.
// Marked, missing (the profile keeps no such session: there is nothing to mark), refused (the key) or unreachable.
export async function markSession({address,profile,key},session,archived) {
 if(typeof session!=='string'||!sessionIdLike.test(session)||session.includes('..')||typeof archived!=='boolean') return 'missing';
 if(!isHermesAddressAllowed(address)) return 'unreachable';
 try {
  const response=await engineRequest({address,key},{method:'PATCH',path:onProfile(profile,`/api/sessions/${encodeURIComponent(session)}`),body:{archived}});
  if(response.ok) return 'marked';
  if(response.status===404) return 'missing';
  return refusal(response);
 } catch { return 'unreachable'; }
}
// The words an Agent wrote in the message that paused its Run (#647): the model asks with clarify, or calls a tool that
// waits for approval, in an assistant message that may also carry its answer so far. The pinned release keeps that
// message in the session before it runs the call (agent/turn_tool_round.py), but the run record has no text until the
// Run completes, and then only what came after the pause (the interim text is an SSE event only, api_server_runs.py
// _interim_cb). So the paused message is the session's latest one but its tool results, after the person's last
// message; its words are kept, as a reply's are, when it made a call. Null when it has none or the session cannot be read.
const pausedPage=50;
/** @param {any} connection @param {string} session @returns {Promise<string|null>} */
export async function pausedWords(connection,session) {
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
export const engineName=/(^|[^\p{L}])hermes(?![\p{L}])/iu;
export const toolName=/^[\w.:-]{1,64}$/;
const previewSize=300; const sessionPage=500;
// A download's whole body is read under the request's own signal, up to the size gtmworks serves (25 MiB), so it gets
// longer than a JSON call: a slow Engine must not cut a file the person asked for at five seconds.
export const downloadTime=60000;
// shortcut: a session past 20 pages (10,000 messages) shows the steps of its first 10,000; upgrade if chats grow so long.
const sessionPages=20;
export const sessionIdLike=/^[\w.:-]{1,200}$/;
/** @param {unknown} preview */
export const cleanPreview=preview=>{
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
// A Card the Agent made in the turn (spec #831, #844): the Engine's own Kanban tool (v0.23.0 tools/kanban_tools.py
// _handle_create, registered as kanban_create) called with a title and the profile it gives the Card to, whose result is
// the Engine's `ok` naming the task made. It is read from the session, as every step is, and gtmworks keeps none of it
// (ADR 0033); the profile stays on the server, which names the Agent it is (lib/conversation-steps.ts).
const cardTool='kanban_create';
const taskId=/^t_[A-Za-z0-9_-]{1,62}$/; const profileName=/^[A-Za-z0-9_-]{1,64}$/;
/** @param {unknown} raw @param {unknown} content @returns {{id:string,title:string,profile:string}|null} */
function cardMade(raw,content) {
 const args=parsed(raw); const data=parsed(content);
 if(!args||typeof args!=='object'||!data||typeof data!=='object'||data.ok!==true||typeof data.task_id!=='string'||!taskId.test(data.task_id)) return null;
 const title=typeof args.title==='string'?Array.from(args.title.toWellFormed().replace(/[\u0000-\u001f\u007f-\u009f]+/g,' ').replace(/\s+/g,' ').trim()).slice(0,200).join(''):'';
 const profile=typeof args.assignee==='string'&&profileName.test(args.assignee)?args.assignee:null;
 return title&&profile?{id:data.task_id,title,profile}:null;
}
/** @param {any[]} messages @returns {import('../engine.mjs').SessionTurn[]} */
function turnsOf(messages) {
 /** @type {(import('../engine.mjs').SessionTurn&{last:number,calls:Map<string,number>,creates:Set<number>,cards:Map<number,unknown>})[]} */
 const turns=[];
 for(const message of messages) {
  const at=Number(message?.timestamp);
  if(message?.role==='user'&&message.display_kind!=='hidden'&&Number.isFinite(at)) { turns.push({at,seconds:0,steps:[],last:at,calls:new Map(),creates:new Set(),cards:new Map()}); continue; }
  const turn=turns.at(-1); if(!turn) continue;
  if(Number.isFinite(at)&&at>turn.last) turn.last=at;
  if(message?.role==='assistant') for(const call of Array.isArray(parsed(message.tool_calls))?parsed(message.tool_calls):[]) {
   const tool=call?.function?.name;
   if(typeof tool!=='string'||!toolName.test(tool)||/hermes/i.test(tool)) continue;
   if(typeof call.id==='string') turn.calls.set(call.id,turn.steps.length);
   if(tool===scheduleTool&&parsed(call.function.arguments)?.action==='create') turn.creates.add(turn.steps.length);
   if(tool===cardTool) turn.cards.set(turn.steps.length,call.function.arguments);
   turn.steps.push({tool,preview:previewOf(call.function.arguments),state:'started'});
  }
  if(message?.role==='tool'&&turn.calls.has(message.tool_call_id)) {
   const at=/** @type {number} */(turn.calls.get(message.tool_call_id));
   const step=turn.steps[at];
   step.state=failedResult(step.tool,message.content)?'failed':'done';
   if(step.state==='failed'&&sandboxDown(message.content)) step.sandbox=true;
   const routine=step.state==='done'&&turn.creates.has(at)?routineMade(message.content):null;
   if(routine) step.routine=routine;
   const card=step.state==='done'&&turn.cards.has(at)?cardMade(turn.cards.get(at),message.content):null;
   if(card) step.card=card;
  }
 }
 return turns.map(({at,last,steps})=>({at,seconds:Math.round(last-at),steps}));
}
// A Conversation opens on the last messages its Engine session holds (#875), one page of 50 at a time, the 50 before
// for scrolling back (the Engine's own routes as the probe measured them, docs/engine-probes/conversation-read.md):
// `order=latest&limit=50&offset=`, with compacted messages asked for so a person's older words are still theirs, and
// inline images. A page that starts in the middle of a turn also asks for the page before it, so the first reply on it
// can carry the call its turn made; only the requested page is drawn.
// shortcut: one turn longer than a page loses the tool calls before it; upgrade if a turn grows past 50 messages.
const messagePage=50;
/** @param {any} message */
const startsTurn=message=>message?.role==='user'&&(message.display_kind!=='hidden'||/^\s*\[CONTEXT COMPACTION/i.test(String(message.content??'')));
/** @returns {Promise<import('../engine.mjs').SessionMessagesRead>} */
export async function readSessionMessages(connection,session,{offset=0,limit=messagePage}={}) {
 const none=state=>({state,messages:null,prefix:[],suffix:[],more:false});
 if(typeof session!=='string'||!sessionIdLike.test(session)||session.includes('..')) return none('missing');
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>messagePage) return none('unreachable');
 if(!reachable(connection)) return none('unreachable');
 const read=async(from,size)=>{
  const {response,result}=await manage(connection,`/api/sessions/${encodeURIComponent(session)}/messages${query(connection.profile)}&order=latest&limit=${size}&offset=${from}&include_compacted=true&inline_images=true`,{timeout:requestTime});
  return {response,result};
 };
 try {
  const {response,result}=await read(offset,limit);
  if(response.status===404) return none('missing');
  if(!response.ok) return none(refusal(response));
  if(!Array.isArray(result?.messages)) return none('unreachable');
  const messages=result.messages;
  let prefix=[];
  if(messages.length&&!startsTurn(messages[0])) {
   try {
    const before=await read(offset+messages.length,messagePage);
    if(before.response.ok&&Array.isArray(before.result?.messages)) prefix=before.result.messages;
   } catch { /* The page still reads; its first turn may only lack steps. */ }
  }
  // A turn can also cross the newer edge: the page's last words may be interim and its reply on the page after it. The
  // first page after is read for context, never drawn, so the reply is drawn once (on the newer page).
  let suffix=[];
  if(offset>0&&messages.length>=limit) {
   try {
    const after=await read(Math.max(0,offset-limit),limit);
    if(after.response.ok&&Array.isArray(after.result?.messages)) suffix=after.result.messages;
   } catch { /* The page still reads; its last turn may draw interim words. */ }
  }
  return {state:'found',messages,prefix,suffix,more:messages.length>=limit};
 } catch { return none('unreachable'); }
}

// The tool calls of the turn that starts at `from` and reaches `to`, in order, as a reply's steps (#875): the session's
// own assistant messages beside it, never matched to it by time. Null when the turn made none.
/** @param {any[]} messages @param {number} from @param {number} to @returns {{list:import('../engine.mjs').RunStep[],seconds:number}|null} */
export function stepsBetween(messages,from,to) {
 const turn=turnsOf(messages.slice(from,to+1))[0];
 return turn?.steps.length?{list:turn.steps,seconds:turn.seconds}:null;
}

// A session's token use (#347), its detail's, read on its own request (ADR 0030): null when the Engine does not know the
// session or cannot be asked.
/** @param {any} connection @param {string} session @returns {Promise<import('../engine.mjs').SessionUsage|null>} */
export async function readSessionUsage(connection,session) {
 if(typeof session!=='string'||!sessionIdLike.test(session)||session.includes('..')||!reachable(connection)) return null;
 try {
  const {response,result}=await manage(connection,`/api/sessions/${encodeURIComponent(session)}${query(connection.profile)}`,{timeout:requestTime});
  return response.ok?usageOf(result):null;
 } catch { return null; }
}

/** @returns {Promise<import('../engine.mjs').SessionRead>} */
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
 return profileUsage(connection,days);
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
