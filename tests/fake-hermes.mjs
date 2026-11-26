import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
// #422: the pinned release's line for a Run on an Engine with no model provider (api_server_runs.py, the provider-auth
// failure's user_text around AuthError no_provider_configured in hermes_cli/auth.py).
export const noProviderError='⚠️ Provider authentication failed: Hermes is not connected to any AI provider yet. Run `hermes model` to pick one, type `/login` in chat, or add a key with `hermes auth add <provider>`. (Advanced: put an API key such as OPENROUTER_API_KEY in /opt/data/.env.)';
// #457: the pinned release's lines for a Run whose model call cannot succeed on a retry, in the Run record's output
// (agent/turn_failure_copy.py, agent/turn_recovery.py). A failed Run carries no error code, only that English text.
export const creditExhaustedError='Billing or credits exhausted: HTTP 400: Your credit balance is too low to access the Anthropic API. Add credits in the Anthropic Console, then retry.';
export const apiKeyRefusedError='Anthropic rejected your API key, so the model can\'t be reached. Add a new key with `hermes auth add anthropic`, or sign in again.';
export const signInRefusedError='Anthropic rejected your sign-in, so the model can\'t be reached. Sign in again with `hermes login`.';
export const modelMissingError='Model \'claude-fable\' isn\'t available on Anthropic. Pick another model with `hermes model`.';
// #642, measured on the pinned release with a ChatGPT account answering HTTP 429 usage_limit_reached (resets_in_seconds
// 435483): the first Run's exhausted copy (agent/turn_failure_copy.py exhausted_copy, with turn_recovery.py
// _stamp_limit_reset's last line), and every later Run's, which the Engine answers without a model call once the account
// is marked exhausted (gateway/run.py _rate_limit_reply, locales/en.yaml gateway.errors.usage_limit_resets).
export const usageLimitFirstError='ChatGPT or Codex Subscription rate-limited every one of 3 attempts — its usage limit resets in ~121h. Send /retry after that, or switch models with /model. To avoid this in future, add a backup provider with `hermes fallback add`.\n\nProvider said: HTTP 429: The usage limit has been reached\n\nLimit resets at 19:24 (in 120h 58m).';
export const usageLimitError='⏱️ The AI model service\'s usage limit is reached; it resets in ~121h. Use /retry after that, or /model to switch models.';
export const failedRunText='Something else went wrong while the model was answering.';
// #712: one grab of a Screen, as the pinned Engine's display.thumbnail sends it (tools/bot_desktop/thumbnail.py: a JPEG
// data URL): a 16 by 10 JPEG whose comment names the grab, so every grab is a picture of its own.
const screenJpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAKABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDGooor6Q8w/9k=','base64');
/** @param {string} viewer */
// The kind of one request to the fake Engine (#762): a Run's start, read, events or other control, a session read,
// memory, a soul, skills, apps (MCP), or other.
/** @param {string} method @param {string} url */
export function requestKind(method,url) {
 const path=url.split('?')[0].replace(/^\/p\/[^/]+/,'');
 if(path==='/v1/runs'&&method==='POST') return 'runStart';
 if(/^\/v1\/runs\/[^/]+\/events$/.test(path)) return 'runEvents';
 if(/^\/v1\/runs\/[^/]+$/.test(path)&&method==='GET') return 'runRead';
 if(path.startsWith('/v1/runs')) return 'runControl';
 if(path.startsWith('/api/sessions')) return 'session';
 if(path.startsWith('/api/memory')||path.startsWith('/api/learning')) return 'memory';
 if(/^\/api\/profiles\/[^/]+\/soul$/.test(path)) return 'soul';
 if(path.startsWith('/api/skills')) return 'skills';
 if(path.startsWith('/api/mcp')) return 'apps';
 return 'other';
}
export const viewerHash=viewer=>createHash('sha256').update(viewer).digest('hex').slice(0,12);
/** @param {number} grab */
export function screenFrame(grab) {
 const note=Buffer.from(`grab ${grab}`);
 return Buffer.concat([screenJpeg.subarray(0,2),Buffer.from([0xff,0xfe,0,note.length+2]),note,screenJpeg.subarray(2)]);
}
// The Engine's own dashboard, small (#869; hermes_cli/web_server_dashboard.py mount_spa): its first page at `/` and at any
// page's path, with the absolute code addresses rewritten under the prefix a reverse proxy names (X-Forwarded-Prefix) and
// that prefix given to the page as __HERMES_BASE_PATH__; its code at /assets/, where the second page's code is asked
// for at the root, as the dashboard's lazily loaded pages ask (Probe B, docs/engine-probes/engine-dashboard.md); an API
// route, /api/status; and its live parts (#870), each a socket opened with a single-use ticket from
// POST /api/auth/ws-ticket: the chat, /api/ws, which says gateway.ready; its terminal, /api/pty, which writes a prompt;
// and the Kanban board's event stream, /api/plugins/kanban/events, which reports each Card made with
// POST /api/plugins/kanban/tasks. Every request needs the Engine's key, as the gated dashboard does. Answers whether the
// request was the dashboard's.
const dashboardPage=prefix=>`<!doctype html><html><head><meta charset="utf-8"><title>Hermes Agent - Dashboard</title><script>window.__HERMES_BASE_PATH__=${JSON.stringify(prefix)};</script><script type="module" src="${prefix}/assets/index.js"></script></head><body><div id="root"></div></body></html>`;
const dashboardCode=`const base=window.__HERMES_BASE_PATH__||'';
const root=document.getElementById('root');
async function draw(){
 const path=location.pathname.slice(base.length)||'/';
 if(path.startsWith('/sessions')){ const {render}=await import('/assets/sessions.js'); render(root); return; }
 root.innerHTML='<h1>Hermes dashboard</h1><nav><a id="to-sessions" href="'+base+'/sessions">Sessions</a></nav><p id="engine-status">Reading…</p><p id="engine-socket">Connecting…</p>';
 root.querySelector('#to-sessions').addEventListener('click',event=>{ event.preventDefault(); history.pushState(null,'',base+'/sessions'); draw(); });
 fetch(base+'/api/status').then(answer=>answer.json()).then(status=>{ root.querySelector('#engine-status').textContent='Engine '+status.version; });
 const ticket=await (await fetch(base+'/api/auth/ws-ticket',{method:'POST'})).json();
 const socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+base+'/api/ws?ticket='+ticket.ticket);
 socket.addEventListener('message',event=>{ const line=root.querySelector('#engine-socket'); if(line) line.textContent=JSON.parse(event.data).type; });
 socket.addEventListener('close',()=>{ const line=root.querySelector('#engine-socket'); if(line) line.textContent='closed'; });
}
addEventListener('popstate',draw);
draw();
`;
const dashboardSessions='export function render(root){ root.innerHTML=\'<h1>Sessions</h1><p id="sessions-page">Every session of every Agent</p>\'; }\n';
function dashboardAnswer(settings,request,response) {
 const url=new URL(request.url||'/','http://management');
 const path=url.pathname;
 const page=path==='/'||path==='/sessions'||path.startsWith('/sessions/');
 if(!page&&!path.startsWith('/assets/')&&path!=='/api/status'&&path!=='/api/auth/ws-ticket'&&path!=='/api/plugins/kanban/tasks') return false;
 const prefix=String(request.headers['x-forwarded-prefix']??'').replace(/\/$/,'');
 settings.dashboardRequests.push({method:request.method||'GET',path:request.url||'/',authorization:request.headers.authorization,cookie:request.headers.cookie,prefix});
 const answer=(status,type,body)=>{ response.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'}); response.end(body); };
 if(request.headers.authorization!==`Bearer ${settings.key}`) { answer(401,'application/json','{"detail":"Unauthorized"}'); return true; }
 if(page) answer(200,'text/html; charset=utf-8',dashboardPage(prefix));
 else if(path==='/assets/index.js') answer(200,'text/javascript',dashboardCode);
 else if(path==='/assets/sessions.js') answer(200,'text/javascript',dashboardSessions);
 else if(path==='/api/status') answer(200,'application/json',JSON.stringify({version:settings.version}));
 else if(path==='/api/auth/ws-ticket'&&request.method==='POST') { const ticket=randomUUID(); settings.dashboardTickets.add(ticket); answer(200,'application/json',JSON.stringify({ticket})); }
 else if(path==='/api/plugins/kanban/tasks'&&request.method==='POST') {
  const chunks=[]; request.on('data',chunk=>chunks.push(chunk));
  request.on('end',()=>{
   let title=''; try { title=String(JSON.parse(Buffer.concat(chunks).toString('utf8')).title??''); } catch { /* no body */ }
   const task={id:randomUUID(),title};
   for(const socket of settings.dashboardSockets) if(socket.path==='/api/plugins/kanban/events') socket.send(JSON.stringify({events:[{kind:'created',task}],cursor:Date.now()}));
   answer(200,'application/json',JSON.stringify({task}));
  });
 }
 else answer(404,'application/json','{"error":"not found"}');
 return true;
}
// `host` is the loopback address both listeners take: a spec that needs the management listener on its fixed port 9119
// (the driver's default beside the Hermes address) takes an address of its own, so lanes never share that port. `port`
// fixes the gateway's (tests/lane.mjs laneHermes: the address the app under test is given).
export async function fakeHermes({port=0,managementPort=0,host='127.0.0.1'}={}) {
 // Run ids are unique across fakes, as Hermes's are: the database refuses a Member's run already used elsewhere (#287).
 const instance=randomUUID().slice(0,8);
 // Each run's event stream (#141; api_server_runs.py _RunStream): its numbered events in memory, the last `backlogLimit`
 // of them kept, and the readers following it. A null event is the stream's end, as in the pinned release.
 const streams=/** @type {Map<string,{backlog:{seq:number,event:any}[],next:number,ended:boolean,readers:Set<import('node:http').ServerResponse>}>} */(new Map());
 const frame=(/** @type {{seq:number,event:any}} */ {seq,event})=>`id: ${seq}\ndata: ${JSON.stringify({...event,seq})}\n\n`;
 const push=(/** @type {string} */ id,/** @type {any} */ event)=>{
  const stream=streams.get(id); if(!stream||stream.ended) return;
  const item={seq:stream.next++,event:event&&{...event,run_id:id,timestamp:event.timestamp??Date.now()/1000}};
  stream.backlog.push(item); while(stream.backlog.length>settings.backlogLimit) stream.backlog.shift();
  if(!event) stream.ended=true;
  for(const reader of stream.readers) if(event) reader.write(frame(item)); else reader.end(': stream closed\n\n');
 };
 // A run that ended sends its own end, stamped with the Engine's clock `runSeconds` after the run was made, then the
 // stream closes.
 const endEvents=(/** @type {string} */ id,/** @type {string} */ name)=>{ if(streams.get(id)?.ended===false) { const run=settings.runs.find(each=>each.id===id); push(id,{event:name,...(run?{timestamp:run.created+settings.runSeconds}:{})}); push(id,null); } };
 // runs: one entry per run Hermes created; the same Idempotency-Key replays the same run.
 // What a Run's input says in words: the text part of its last message when it carries images (#155), or the message
 // itself, so a fake's reply, questions and approvals read a person's words as they always did.
 const inputText=input=>typeof input==='string'?input:Array.isArray(input)?(input.at(-1)?.content??[]).flatMap(part=>part.type==='text'?[part.text]:[]).join(''):String(input);
 const settings={version:'0.23.0',status:200,key:'test-only-key',features:{run_submission:true,run_events_sse:true},requests:/** @type {{method?:string,path?:string,authorization?:string,session?:string,idempotency?:string}[]} */([]),runs:/** @type {{id:string,profile?:string,key?:string,session?:string,input:any,instructions?:string,history?:{role:string,content:string}[],body?:string,reads:number,stopped?:boolean,asked:{prompt_id:string,question:string,choices:string[],multi_select:boolean,answer?:string,settled:'answered'|'expired'|null}[],approvals:{request_id:string,description:string,command:string,patternKeys:string[],kept:string[],choices:string[],choice?:string,settled:'answered'|'expired'|null}[]}[]} */([]),pendingReads:0,loseStarts:0,heldElsewhere:/** @type {((run:string)=>boolean)|null} */(null),openNow:0,openAtMost:0,answerDelay:0,managed:/** @type {{method?:string,path?:string}[]} */([]),managedFail:/** @type {((method:string,path:string)=>number|null)|null} */(null),managedDelay:/** @type {((method:string,path:string)=>number|null)|null} */(null),
  // The most rows a cron job's run history lists (#535: the pinned Engine lists 100 at most).
  cronRunsAtMost:100,startDelay:0,stallEvents:false,reply:input=>`Reply to: ${input}`,
  // How a finished run ends and the usage it reports; a run cleared from runs is one Hermes lost (404).
  // A run first asks the questions `questions` gives for its input (clarify, #138), one at a time, as the pinned release
  // does: it stays running with the question in pending_controls until it is answered on the run's clarify route,
  // expires (expire(run), Hermes's clarify_timeout) or the run is stopped. The reply is given the answers. `answers`
  // keeps every clarify request's status and body. A question with `said` is asked in an assistant message that also
  // carries those words (#647): the run's session holds that message, its clarify call unanswered, while the run waits,
  // as the pinned release persists a tool-call turn before it runs the call (agent/turn_tool_round.py).
  questions:/** @type {(input:string)=>{question:string,choices?:string[],multi_select?:boolean,said?:string}[]} */(()=>[]),
  answers:/** @type {{run:string,status:number,body:any}[]} */([]),
  expire(run) { const waiting=settings.runs.find(found=>found.id===run)?.asked.find(asked=>!asked.settled); if(waiting) waiting.settled='expired'; return !!waiting; },
  // After its questions a run stops to ask before each action `approvals` gives for its input (#163), one at a time, as
  // the pinned release does (api_server_runs.py _make_approval_notify): its status is waiting_for_approval with the
  // request in `approval` until it is answered on the run's approval route, times out (expireApproval(run), the
  // profile's approvals.timeout) or the run is stopped. The reply is given each request's choice, null for one that timed
  // out.
  // A request is a flagged command, reported under its `keys` (its description, or 'recursive delete' when that is
  // blank), or with `app` an app's tool on an untrusted server, in the trust gate's own words with the placeholder key
  // mcp_elicitation (tools/mcp_tool_handlers.py _ask_for_call). Always keeps the command's keys, or mcp:<server>/<tool>,
  // in the run's profile's command_allowlist (#166), and a later request whose kept key is there is not asked: it reads
  // as allowed (`standing`), as tools/approval.py _approval_scope does, at once after the list changes.
  approvals:/** @type {(input:string)=>{description?:string,command?:string,choices?:string[],keys?:string[],app?:{server:string,tool:string},said?:string}[]} */(()=>[]),
  // `permits` keeps every approval request's status and body; with `flatPermitErrors` the route answers a refusal's code
  // at the top of its body instead of under `error`.
  permits:/** @type {{run:string,status:number,body:any}[]} */([]),flatPermitErrors:false,
  expireApproval(run) { const waiting=settings.runs.find(found=>found.id===run)?.approvals.find(asking=>!asking.settled); if(waiting) waiting.settled='expired'; return !!waiting; },
  ending:'completed',failure:/** @type {string|undefined} */(undefined),usage:/** @type {object|undefined} */({input_tokens:14000,output_tokens:12}),
  // The management listener (Hermes's dashboard, a second port): its profiles, and the status it answers with when
  // not 200. A profile made through it has its own Run API key, none until /api/env sets it, as in the pinned release.
  managementStatus:200,profiles:/** @type {Map<string,{soul:string,provider:string,model:string,key:string|null,config:any,credentials:Record<string,string>,display_name?:string|null,description?:string,description_auto?:boolean,bot_title?:string|null,env?:Record<string,string>}>} */(new Map()),failStep:/** @type {''|'model'|'env'|'config'} */(''),modelWriteDelay:0,
  managementRequests:/** @type {{method?:string,path?:string,authorization?:string,range?:string,body:any}[]} */([]),
  // The default profile's config and model sign-ins (a profile made through the listener keeps its own), and the
  // sign-in sessions Hermes runs: approve(session) finishes one as the person would in their browser. The Engine's own
  // config defaults and schema are what its config routes serve (#125); configWriteFail is a profile whose next config
  // write answers 500, as a profile home that cannot be written does.
  defaultConfig:/** @type {any} */({}),defaultCredentials:/** @type {Record<string,string>} */({}),
  // The root profile's credential pool (auth.json credential_pool), where `hermes auth add anthropic --type oauth` (the
  // install's `gtmworks sign-in claude`) puts a Claude subscription with no ~/.anthropic_oauth.json, so the Engine's own
  // sign-in status does not see it (#438).
  defaultPool:/** @type {Record<string,{id:string,label:string,auth_type:'oauth'|'api_key',source:string,priority:number,access_token:string,last_status?:string|null,place?:number,off?:boolean}[]>} */({}),
  // The pinned Engine with scripts/engine-pool-order.sh (#621): PUT /api/credentials/pool/<provider>/order puts the root's
  // rows of a provider in the Owner's order and marks those switched off. A Run on a subscription takes the first account
  // of its provider switched on and not exhausted; an account in `outOfQuota` answers it with a usage limit, so the Engine
  // marks it exhausted and sends the same model call on the next one, recording the move in `switches` (GET
  // /api/credentials/pool/switches), and the Run's one reply is made once on the account that answered (`answeredOn`).
  // With none left, the Run walks the fallback chain its profile's own config holds (#622; v0.23.0 `fallback_providers`
  // and the older `fallback_model`, loaded for every Run, agent/turn_recovery.py), once and in order: each entry's
  // provider's accounts in turn, recorded in `fallbacks`. With no chain, or every entry's accounts out of quota too, the
  // Run fails with `noAccountText`, the pinned Engine's exhausted rate-limit copy (agent/turn_failure_copy.py). Each model
  // call names the account and its provider (`modelCalls`).
  outOfQuota:/** @type {Set<string>} */(new Set()),switches:/** @type {{id:string,provider:string,from:string,to:string,at:number}[]} */([]),
  answeredOn:/** @type {Map<string,string>} */(new Map()),modelCalls:/** @type {{run:string,account:string,provider?:string,model?:string}[]} */([]),
  fallbacks:/** @type {{run:string,provider:string,model:string}[]} */([]),
  // A Run that finds every account already exhausted makes no model call and fails at once with the gateway's
  // usage-limit line instead (#642, measured), `usageLimitText`.
  usageLimitText:usageLimitError,
  noAccountText:usageLimitFirstError,
  configDefaults:/** @type {any} */({}),configSchema:/** @type {{fields:Record<string,any>,category_order:string[]}} */({fields:{},category_order:[]}),
  configWriteFail:/** @type {Set<string>} */(new Set()),
  // Audio (#162; hermes_cli/web_routers/audio.py 223-352): the sound the speak route answers with, the provider's refusal
  // text as a 400, an audio body past the driver's 4 MB cap (speakLarge), and the ElevenLabs list a profile's own key
  // unlocks. `speakRefusal` is what the shipped image answers with no speech package installed.
  speakDataUrl:'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU5LjI3LjEwMAAAAAAAAAAAAAAA',
  speakRefusal:'',speakLarge:false,
  elevenLabsVoices:{available:true,voices:[{voice_id:'pNInz6obpgDQGcFmaJgB',name:'Rachel',label:'Rachel'},{voice_id:'21m00Tcm4TlvDq8ikWAM',name:'Bella',label:'Bella'}]},
  signInSessions:/** @type {Map<string,{provider:string,profile:string,status:string}>} */(new Map()),
  // Ignore the disabled list when reporting toolsets, as a Hermes that did not apply it would.
  ignoreDisabled:false,staleConfig:false,
  // An Agent's Screen (#712), per profile as the pinned Engine keeps it (tools/bot_desktop): running or not, the Engine's
  // `supported` and the programs the sandbox lacks, and who holds its lease (the Agent, or a person). The sandbox has one
  // display, so a start fails while another profile's Screen runs (sandbox_host.py: display :20). `screenCalls` keeps
  // every /api/ws request with the token it came with; `screenStartDelay` holds a start as the Engine's does while the
  // desktop comes up; `screenPictureUrl` replaces what a grab sends.
  // The Engine's own dashboard (#869): every request to its pages, code and API, with the key and the cookies it came with
  // and the prefix it was served under, and every socket it opened. See dashboardAnswer.
  dashboardRequests:/** @type {{method:string,path:string,authorization?:string,cookie?:string,prefix?:string}[]} */([]),
  dashboardTickets:/** @type {Set<string>} */(new Set()),dashboardSockets:/** @type {Set<import('ws').WebSocket&{path:string}>} */(new Set()),
  screens:/** @type {Map<string,{running?:boolean,supported?:boolean,missing?:string[],holder?:'agent'|'human',viewer?:string|null}>} */(new Map()),
  screenCalls:/** @type {{method:string,params:any,token:string|null}[]} */([]),screenStartDelay:0,screenPictureUrl:/** @type {string|null} */(null),screenGrabs:0,
  // #713: the live stream (/api/display/ws, hermes_cli/web_routers/display.py): every ticket display.observe minted, and
  // every keyboard and pointer message that reached a Screen, which the Engine lets through only from the viewer holding
  // its lease (tools/bot_desktop/rfb_filter.py). `screenStreams` counts the streams open now.
  screenTickets:/** @type {Map<string,{profile:string,viewer:string,expires:number}>} */(new Map()),
  screenInputs:/** @type {{profile:string,viewer:string,kind:'key'|'pointer',down?:boolean,key?:number,x?:number,y?:number,mask?:number}[]} */([]),screenStreams:0,
  // Profiles the Run API answers 404 for, as Hermes does for one it does not serve; a removed profile joins them.
  unknownProfiles:/** @type {string[]} */([]),
  // The root profile's model block, which a new profile copies (hermes_cli/profiles.py, _seed_model_config); none
  // leaves a new profile with no model. A removal whose identity settlement stays pending still answers ok.
  seedModel:/** @type {{provider:string,model:string}|null} */(null),settlementPending:false,
  // The MCP catalogue the pinned release ships (optional-mcps/), the tools each app's server offers, the apps whose
  // server does not answer, and the OAuth sign-ins of apps (hermes_cli/web_routers/mcp.py): a sign-in's token stays on
  // disk when its server is removed, as in the pinned release. approveApps:false keeps a delivered sign-in waiting.
  catalog:['klaviyo','canva','notion','airtable','webflow','wordpress-com','amplitude','mixpanel','attio','close','calendly','figma','gamma','intercom'],
  catalogAuth:/** @type {Record<string,'oauth'|'none'>} */({}),catalogEnv:/** @type {Record<string,{name:string,prompt:string,required:boolean}[]>} */({}),
  serverTokens:/** @type {Map<string,string>} */(new Map()),
  appTools:/** @type {Record<string,string[]>} */({}),appsUnreachable:/** @type {Set<string>} */(new Set()),appTokens:/** @type {Set<string>} */(new Set()),approveApps:true,
  appFlows:/** @type {Map<string,{server:string,profile:string,status:string,state:string,redirect:string}>} */(new Map()),appCallbacks:/** @type {string[]} */([]),appAuthScheme:/** @type {'https'|'http'} */('https'),
  // Each profile's own Skills by name (their SKILL.md text), and the Skills each profile locked, as `profile:name`.
  skills:/** @type {Map<string,Map<string,string>>} */(new Map()),skillLocks:/** @type {Set<string>} */(new Set()),skillsOff:/** @type {Set<string>} */(new Set()),
  // The provenance `GET /api/skills` reports for a profile's own Skill (`hub`, `bundled` or `agent`), as `profile:name`;
  // the shared folder's are always external. The Skills a profile learned on its own, whose learning graph node says
  // `createdBy:"agent"` (#180).
  skillProvenance:/** @type {Map<string,string>} */(new Map()),learnedSkills:/** @type {Map<string,Set<string>>} */(new Map()),
  // Each profile's memory (#350): the entries of its MEMORY.md and its USER.md, as the memory tool parses them (the
  // learning graph lists one node per entry, its id carrying the entry's position and a digest of its text).
  memory:/** @type {Map<string,{memory:string[],profile:string[]}>} */(new Map()),
  // Each profile's Routines (#31): its cron jobs, as the pinned release keeps them in the profile's own cron/jobs.json
  // (cron/jobs.py create_job). `cronOutcome` is how a run now ends ('ok' or 'error'). `routineAsks` names the Routine a
  // chat Run's input asks for: the Run makes it with the Engine's own cronjob tool, so only on a profile whose Runs are
  // offered that toolset, in that Run's own profile (tools/cronjob_tools.py).
  cron:/** @type {Map<string,any[]>} */(new Map()),cronOutcome:/** @type {'ok'|'error'} */('ok'),loseCronCreates:0,
  // What a Routine's run now answers (#182): each run is a cron session of the job's profile, `cron_<id>_<time>`, holding
  // the prompt and this reply, listed newest first by the job's runs route.
  // A function of the job answers each job its own way (#183: the night's results beside the morning's greeting).
  cronReply:/** @type {string|((job:any)=>string)} */('Here is what ran overnight.'),
  routineAsks:/** @type {(input:string)=>{name:string,prompt:string,schedule:string}|null} */(()=>null),
  profilesListStatus:/** @type {number|null} */(null),
  // Each session archived on a profile ("profile:session", #674), every flag sent to one, and the status a flag is
  // answered with instead (an Engine busy or going away).
  archivedSessions:/** @type {Set<string>} */(new Set()),
  sessionMarks:/** @type {{profile:string,session:string,body:any,authorization?:string}[]} */([]),
  sessionMarkStatus:/** @type {number|null} */(null),
  // Each reveal of a key's real value (/api/env/reveal), by profile and key, never the value. A key in revealFail is
  // answered 500, as an Engine that could not read the .env.
  reveals:/** @type {{profile:string,key:string}[]} */([]),revealFail:/** @type {Set<string>} */(new Set()),
  // The provider keys a profile's .env takes (hermes_cli/web_routers/config_env.py 264-330): each provider's primary
  // password row, and rows that are not one (an alias, a URL, a tool's key). Each profile keeps its own values in `env`;
  // the root's are defaultEnv. A provider listed in providerModels offers those models once its key is set. A profile in
  // envFail answers a key write or removal with a 500, and one in envDropped closes the connection, as an Engine that
  // went away; envHang never answers a key write for that profile.
  envRows:[{env:'OPENROUTER_API_KEY',provider:'openrouter',label:'OpenRouter',primary:true,password:true,category:'provider'},
   {env:'ANTHROPIC_API_KEY',provider:'anthropic',label:'Anthropic',primary:true,password:true,category:'provider'},
   {env:'ANTHROPIC_TOKEN',provider:'anthropic',label:'Anthropic',primary:false,password:true,category:'provider'},
   {env:'DEEPSEEK_API_KEY',provider:'deepseek',label:'DeepSeek',primary:true,password:true,category:'provider'},
   {env:'OPENROUTER_BASE_URL',provider:'openrouter',label:'OpenRouter',primary:false,password:false,category:'provider'},
   {env:'FIRECRAWL_API_KEY',provider:'',label:'',primary:false,password:true,category:'tool'}],
  providerModels:/** @type {Record<string,string[]>} */({openrouter:['anthropic/claude-opus-4.6','openai/gpt-5.5'],anthropic:['claude-opus-4-6']}),
  // The models a signed-in subscription lists beside the profile's own (#620); none by default.
  subscriptionModels:/** @type {Record<string,string[]>} */({}),
  modelNeedsKey:false,
  // Models a Run may not run on (#158): a Run naming one is answered 400 before it is made, as the pinned release answers a
  // provider or model it cannot resolve (api_server_runs.py 803-809).
  refusedModels:/** @type {Set<string>} */(new Set()),defaultEnv:/** @type {Record<string,string>} */({}),modelOptionsFail:false,poolFail:false,poolNamedFail:false,envFail:/** @type {Set<string>} */(new Set()),envReadFail:/** @type {Set<string>} */(new Set()),envDropped:/** @type {Set<string>} */(new Set()),envHang:/** @type {Set<string>} */(new Set()),
  // A run's events (#141): `emit` adds one (tool.started, tool.completed, message.delta and the like) to its stream,
  // `forget` drops its oldest ones as the 1,000-event backlog does, `sweep` drops its whole stream as Hermes does five
  // minutes after the start when nobody reads it. A run reports `runSeconds` from its start to its end. `stallEvents`
  // makes the events route take a request and never answer it, as a stalled Hermes or proxy does.
  // How many requests of each kind this Engine received (#762), so a test asserts a ceiling on what a page asked of it
  // instead of a time a shared runner cannot hold. `since` counts only the requests after that index of `requests`.
  counts(/** @type {number} */ since=0) {
   /** @type {Record<string,number>} */ const counts={};
   for(const request of settings.requests.slice(since)) { const kind=requestKind(request.method||'GET',request.path||''); counts[kind]=(counts[kind]??0)+1; }
   return counts;
  },
  emit(/** @type {string} */ run,/** @type {any} */ event) { push(run,event); },
  forget(/** @type {string} */ run,/** @type {number} */ count) { streams.get(run)?.backlog.splice(0,count); },
  sweep(/** @type {string} */ run) { const stream=streams.get(run); streams.delete(run); for(const reader of stream?.readers||[]) reader.end(); },
  backlogLimit:1000,runSeconds:41,sessionDelay:0,memoryDelay:0,memoryInFlight:0,memoryAtOnce:0,
  // The folders the dashboard's file routes read (#194), by the Engine's own absolute path: each entry is the folder's
  // path to the entries `/api/files?path=` reports (a name, whether it is a folder, its size, its mtime, and `resolves`:
  // the path a link points at, which is the entry itself unless it leaves the folder), and `fileBytes` holds a file's
  // bytes by the same path. A folder not in `files` is not found. The Company's work folder (#395) is the volume the
  // Engine mounts read-only at /opt/data/work and the work sandbox holds at /work: `/api/fs/read-text` and
  // `/api/fs/download` with a profile read the profile's ssh workspace (hermes_cli/ssh_workspace_fs.py), so they answer
  // a /work path from those same entries and no path of the Engine's own disk.
  files:/** @type {Map<string,{name:string,isFolder?:boolean,size?:number,mtime?:number,resolves?:string,broken?:boolean}[]>} */(new Map()),
  // The pictures a profile generated (#353), as the Engine's own folder `<profile home>/cache/generated/images`
  // (agent/provider_media.py, GENERATED_SUBDIR, cache_dir) holds them. The Engine makes that folder when the first
  // image lands and not before, so a profile with no entry here has no folder and `/api/files?path=` answers it 404.
  images:/** @type {Map<string,{name:string,isFolder?:boolean,size?:number,mtime?:number,resolves?:string,broken?:boolean}[]>} */(new Map()),
  fileBytes:/** @type {Map<string,{body:string|Uint8Array,type?:string}>} */(new Map()),
  filesUnreadable:/** @type {Set<string>} */(new Set()),
  // The work sandbox is stopped (#395, #398): the profile's ssh workspace cannot be reached, so `/api/fs/*` answers 503
  // while the Engine's own read-only mount still lists the work folder.
  sandboxDown:false,
  // Files the Engine refuses to read (403) by the path asked, as its guard refuses a sensitive file or one that resolves
  // outside the root it reads under (hermes_cli/web_routers/files.py).
  filesRefused:/** @type {Set<string>} */(new Set()),
  // The path `/api/files?path=` and `/api/fs/read-text?path=` answer with, when it is not the one asked for: a folder or
  // a file that is a link somewhere else, which the Engine resolves and reports as its own `path` (by the path asked).
  resolved:/** @type {Map<string,string>} */(new Map()),
  // One recording as text (#160): the profile it was sent for, the MIME type and how many bytes, and the words the
  // Engine hears ('' is silence). A `transcriptionStatus` that is not 200 answers with `transcriptionDetail`, and the
  // pinned image's missing speech-to-text provider is that detail with a 400, as its route answers.
  transcriptions:/** @type {{profile:string,mimeType:unknown,bytes:number}[]} */([]),transcriptionTranscript:'The words the engine heard',
  transcriptionStatus:200,transcriptionDetail:'No STT provider available. Configure stt.provider or install a local speech model.',
  // Sessions by id (#346): the profile each belongs to and its messages as the listener returns them
  // (hermes_cli/web_routers/sessions.py get_session_messages), oldest first: role, content, tool_calls, tool_call_id,
  // tool_name and timestamp; and (#347) the session's token use as its detail reports it (get_session_detail), with the
  // time it started in seconds, which the profile's usage analytics count from, and the model it ran on (#32), which
  // the analytics group into by_model.
  sessions:/** @type {Map<string,{profile:string,messages:any[],input_tokens?:unknown,output_tokens?:unknown,model?:string,started_at?:number,ended_at?:number}>} */(new Map()),
  // A ChatGPT sign-in on the root, as the pinned Engine with scripts/engine-codex-accounts.sh saves it (#618): the first
  // account is the singleton and its `device_code` pool row; another account is a `manual:device_code` row of its own
  // and the first stays as it was. `account` names the ChatGPT account the person signed in with; the same one again
  // renews its row in place.
  approve(session,account=`account-${randomUUID()}`) {
   const found=settings.signInSessions.get(session); if(!found) return; found.status='approved';
   const token=`codex-token-${randomUUID()}`;
   if(found.profile!=='default'||found.provider!=='openai-codex') { credentialsOf(found.profile)[found.provider]=token; return; }
   const rows=settings.defaultPool['openai-codex']||=[];
   const same=rows.find(row=>row.account===account);
   if(same) { same.access_token=token; if(same.source==='device_code') settings.defaultCredentials['openai-codex']=token; return; }
   const first=!rows.length;
   if(first) settings.defaultCredentials['openai-codex']=token;
   rows.push({id:randomUUID().replaceAll('-','').slice(0,6),label:`${account}@example.com`,auth_type:'oauth',source:first?'device_code':'manual:device_code',priority:rows.length,access_token:token,account});
  }};
 const profileOf=name=>name==='default'?{config:settings.defaultConfig,credentials:settings.defaultCredentials}:settings.profiles.get(name);
 const allowlistOf=name=>{ const list=profileOf(name)?.config?.command_allowlist; return Array.isArray(list)?list:[]; };
 // A request in the pinned release's words, with the keys it is reported under and the ones an always answer keeps.
 // The message a run paused in (#647), kept in its session once: the person's message, then the assistant message with
 // its words and the call that waits.
 const paused=(run,call,tool,said)=>{
  // A pause with no words is kept too once the session holds an earlier paused message, so those words are not read again.
  if(!run.session||said===undefined&&!settings.sessions.has(run.session)) return;
  const found=settings.sessions.get(run.session)??{profile:run.profile,messages:[]};
  settings.sessions.set(run.session,found);
  if(found.messages.some(message=>message.tool_calls?.some(each=>each.id===call))) return;
  const at=Date.now()/1000;
  if(found.messages.at(-1)?.role!=='assistant') found.messages.push({role:'user',content:inputText(run.input),timestamp:at});
  found.messages.push({role:'assistant',content:said??'',tool_calls:[{id:call,type:'function',function:{name:tool,arguments:'{}'}}],timestamp:at});
 };
 const requestOf=each=>each.app?{description:each.description??`Server '${each.app.server}' is configured 'trust: untrusted'. Approve to run '${each.app.tool}' once, for this session, or always, or deny to block it.`,
  command:each.command??`MCP tool '${each.app.tool}' on UNTRUSTED server '${each.app.server}' wants to run. This tool is write-capable (no readOnlyHint=true annotation) and may modify external state.`,
  patternKeys:['mcp_elicitation'],kept:[`mcp:${each.app.server}/${each.app.tool}`]}
  :(keys=>({description:each.description??'',command:each.command??'',patternKeys:keys,kept:keys}))(each.keys??[each.description||'recursive delete']);
 const credentialsOf=name=>profileOf(name)?.credentials||{};
 // A cron job as the pinned release stores and lists it (cron/jobs.py create_job, web_server_cron.py
 // _annotate_cron_job). Only the shapes gtmworks reads are parsed: a five-field cron expression and "every <n>m|h".
 const cronStore=name=>{ if(!settings.cron.has(name)) settings.cron.set(name,[]); return settings.cron.get(name); };
 const parseCron=text=>{
  const value=String(text||'').trim();
  if(/^(\S+\s+){4}\S+$/.test(value)&&value.split(/\s+/).every(part=>/^[\d*,/-]+$/.test(part))) return {kind:'cron',expr:value,display:value};
  const every=/^every\s+(\d+)\s*(m|h)$/i.exec(value);
  if(every) { const minutes=Number(every[1])*(every[2].toLowerCase()==='h'?60:1); return {kind:'interval',minutes,display:`every ${minutes}m`}; }
  return null;
 };
 const nextRun=()=>new Date(Date.now()+864e5).toISOString();
 const cronJob=({name,prompt,schedule,timezone=null,paused=false,origin=null})=>{
  const parsed=parseCron(schedule); if(!parsed) throw new Error(`Invalid schedule '${schedule}'`);
  return {id:randomUUID().replaceAll('-','').slice(0,12),name:name||prompt.slice(0,50),prompt,skills:[],skill:null,schedule:parsed,schedule_display:parsed.display,
   repeat:{times:null,completed:0},enabled:!paused,state:paused?'paused':'scheduled',paused_at:null,paused_reason:null,created_at:new Date().toISOString(),
   next_run_at:paused?null:nextRun(),last_run_at:null,last_status:null,last_error:null,deliver:'local',origin,...(timezone?{timezone}:{})};
 };
 // The profile that holds a job: the hint when it does, else whichever profile does (web_routers/cron.py _job_owner_profile).
 const cronOwner=(id,hint)=>hint&&settings.cron.get(hint)?.some(job=>job.id===id)?hint:[...settings.cron].find(([,jobs])=>jobs.some(job=>job.id===id))?.[0]??null;
 // A job stored with a profile of its own (a test of an answer that mixed profiles) keeps it.
 const annotated=(job,name)=>({...job,profile:job.profile??name,profile_name:job.profile??name,hermes_home:name==='default'?'/opt/data':`/opt/data/profiles/${name}`,is_default_profile:name==='default',scheduler_heartbeat_age_s:3});
 // The toolsets the pinned release lets an api_server Run use when its profile names none (hermes-api-server).
 const defaultToolsets=['web','browser','terminal','file','code_execution','vision','image_gen','skills','todo','memory','session_search','delegation','cronjob','connections'];
 const configurable=['web','browser','terminal','file','code_execution','vision','video','image_gen','video_gen','x_search','tts','skills','todo','kanban','memory','session_search','connections','clarify','delegation','cronjob','computer_use'];
 const enabledToolsets=config=>{
  const listed=Array.isArray(config?.platform_toolsets?.api_server)?config.platform_toolsets.api_server:defaultToolsets;
  const disabled=settings.ignoreDisabled?[]:config?.agent?.disabled_toolsets||[];
  return configurable.filter(name=>listed.includes(name)&&!disabled.includes(name));
 };
 // An Engine that lists a profile's MCP servers beside the configurable toolsets, as toolsets.py's registry resolves one
 // to `mcp-<server>` (a server with `enabled:false` is off). The pinned release leaves them out of /v1/toolsets; this is
 // the shape a later one that lists them answers with (#391).
 const appToolsets=config=>Object.entries(config?.mcp_servers||{}).filter(([,server])=>server&&typeof server==='object'&&server.enabled!==false).map(([name])=>({name:`mcp-${name}`,enabled:true}));
 const merge=(base,over)=>{ const out={...base}; for(const [key,value] of Object.entries(over||{})) out[key]=value&&typeof value==='object'&&!Array.isArray(value)&&base?.[key]&&typeof base[key]==='object'?merge(base[key],value):value; return out; };
 // The description and category a SKILL.md's front matter gives it, as the Engine lists them.
 const skillHeader=content=>{
  const header=/^---\r?\n([\s\S]*?)\r?\n---/.exec(content||'')?.[1]||'';
  const field=name=>(new RegExp(`(?:^|\\n)${name}:[ \\t]*["']?([^\\n"']*)["']?[ \\t]*(?:\\r?\\n|$)`).exec(header)?.[1]||'').trim();
  return {description:field('description'),category:field('category')||null};
 };
 const send=(response,code,body)=>{response.writeHead(code,{'Content-Type':'application/json',Location:'/must-not-follow'});response.end(JSON.stringify(body));};
 // The type the pinned release gives a managed file (mimetypes.guess_type, files.py _fs_mime_type).
 const mimeOf=name=>{const ext=(/\.([a-z0-9]+)$/i.exec(name)?.[1]||'').toLowerCase();
  return {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',csv:'text/csv',md:'text/markdown',txt:'text/plain',json:'application/json'}[ext]||'application/octet-stream';};
  // The entries of one folder: those a test set for it, or a profile's generated images folder (#353), which the Engine
  // makes when its first image lands and not before — a profile with none has no such folder at all.
  const generatedRoot=/^\/opt\/data\/profiles\/([^/]+)\/cache\/generated\/images$/;
  const entriesAt=path=>{ const generated=generatedRoot.exec(path); return settings.files.get(path)??(generated?settings.images.get(generated[1]):undefined); };
 // The memory an Agent's profile holds (#350): MEMORY.md's entries first, then USER.md's, each named by its position in
 // the combined list and a digest of its text (agent/learning_graph.py memory_node_id, memory_fingerprint).
 const memoryCards=name=>{
  const files=settings.memory.get(name)||{memory:[],profile:[]}; const cards=[];
  for(const source of ['memory','profile']) for(const text of files[source]) cards.push({source,text});
  return cards.map((card,index)=>({...card,index,id:`memory:${card.source}:${index}:${createHash('sha256').update(card.text.trim(),'utf8').digest('hex').slice(0,12)}`}));
 };
 const memoryTitle=text=>{ const first=text.split('\n')[0].trim().replace(/^#+\s*/,''); return first.length>80?`${first.slice(0,80)}…`:first; };
 const server=createServer((request,response)=>{
  // How many requests are open on this listener at once, and the most ever (#781), and a wait before each is read.
  settings.openNow++; settings.openAtMost=Math.max(settings.openAtMost,settings.openNow);
  response.on('close',()=>{ settings.openNow--; });
  if(settings.answerDelay>0) { request.pause(); setTimeout(()=>request.resume(),settings.answerDelay); }
  let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',()=>{
   settings.requests.push({method:request.method,path:request.url,authorization:request.headers.authorization,session:request.headers['x-hermes-session-key'],idempotency:request.headers['idempotency-key']});
   const managed=settings.profiles.get(decodeURIComponent(request.url.match(/^\/p\/([^/]+)\//)?.[1]||''));
   const key=managed?managed.key:settings.key;
   const status=key&&request.headers.authorization===`Bearer ${key}`?settings.status:401;
   if(managed&&status===401) return send(response,401,{error:{message:request.headers.authorization,code:'gateway_auth_failed'}});
   if(status!==200) return send(response,status,{error:{message:request.headers.authorization}});
   const toolsetsPath=request.url.match(/^\/p\/([^/]+)\/v1\/toolsets$/);
   if(toolsetsPath&&!profileOf(decodeURIComponent(toolsetsPath[1]))&&settings.unknownProfiles.includes(decodeURIComponent(toolsetsPath[1]))) return send(response,404,{error:'Unknown or unconfigured profile'});
   if(toolsetsPath) { const enabled=enabledToolsets(profileOf(decodeURIComponent(toolsetsPath[1]))?.config); return send(response,200,{object:'list',platform:'api_server',data:[...configurable.map(name=>({name,enabled:enabled.includes(name)})),...appToolsets(profileOf(decodeURIComponent(toolsetsPath[1]))?.config)]}); }
   // A session's sidebar flag (#674; api_server.py _handle_patch_session): archived on the profile's own sessions, a
   // session the profile does not keep is 404 session_not_found, and a field it does not take is refused.
   const sessionPatch=request.method==='PATCH'&&request.url.match(/^\/p\/([^/]+)\/api\/sessions\/([^/?]+)$/);
   if(sessionPatch) {
    const [owner,id]=[decodeURIComponent(sessionPatch[1]),decodeURIComponent(sessionPatch[2])];
    const body=JSON.parse(raw||'{}');
    settings.sessionMarks.push({profile:owner,session:id,body,authorization:request.headers.authorization});
    if(settings.sessionMarkStatus) return send(response,settings.sessionMarkStatus,{error:{message:'Service unavailable'}});
    if(Object.keys(body).some(field=>!['title','end_reason','pinned','archived','hidden','unread'].includes(field))) return send(response,400,{error:{message:'Unsupported session fields',code:'unsupported_session_field'}});
    const kept=settings.sessions.get(id)?.profile===owner||settings.runs.some(run=>run.session===id&&run.profile===owner);
    if(!kept) return send(response,404,{error:{message:`Session not found: ${id}`,code:'session_not_found'}});
    if(body.archived===true) settings.archivedSessions.add(`${owner}:${id}`); else if(body.archived===false) settings.archivedSessions.delete(`${owner}:${id}`);
    return send(response,200,{object:'hermes.session',session:{id,archived:settings.archivedSessions.has(`${owner}:${id}`)}});
   }
   const runPath=request.url.match(/^\/p\/[^/]+\/v1\/runs(?:\/([^/]+))?$/);
   if(runPath&&request.method==='POST'&&!runPath[1]) {
    const key=request.headers['idempotency-key'];
    let run=settings.runs.find(run=>key&&run.key===key);
    // As the pinned release does (api_server_runs.py, run idempotency): the same key with another body is a conflict.
    if(run&&run.body!==raw) return send(response,409,{error:{message:'Idempotency-Key reused with a different request',code:'idempotency_conflict'}});
    if(!run) {
     const sent=JSON.parse(raw);
     if(settings.refusedModels.has(sent.model)) return send(response,400,{error:{message:`Model '${sent.model}' is not available`,type:'invalid_request_error'}});
     const asked=settings.questions(inputText(sent.input)).map(each=>({prompt_id:randomUUID().replaceAll('-','').slice(0,10),question:each.question,choices:each.choices??[],multi_select:each.multi_select===true,said:each.said,settled:null}));
     const approvals=settings.approvals(inputText(sent.input)).map(each=>({request_id:randomUUID().replaceAll('-',''),...requestOf(each),choices:each.choices??['once','session','always','deny'],said:each.said,settled:null}));
     const runProfile=decodeURIComponent(request.url.match(/^\/p\/([^/]+)\//)?.[1]||'default');
     const asks=settings.routineAsks(inputText(sent.input));
     if(asks&&enabledToolsets(profileOf(runProfile)?.config).includes('cronjob')) cronStore(runProfile).push(cronJob({...asks,origin:{platform:'api_server'}}));
     run={id:`run_${instance}_${settings.runs.length+1}`,profile:runProfile,key,session:request.headers['x-hermes-session-key'],input:sent.input,instructions:sent.instructions,history:sent.conversation_history,body:raw,reads:0,asked,approvals,created:Date.now()/1000}; settings.runs.push(run);
     const runProvider=sent.provider??profileOf(runProfile)?.provider;
     const runModel=sent.model??profileOf(runProfile)?.model;
     const accounts=(settings.defaultPool[runProvider]||[]).filter(row=>row.auth_type==='oauth');
     // One provider's accounts in the pool's order: each switched on and not exhausted is asked until one has quota.
     const tryAccounts=(provider,model,rows,{record})=>{
      let using=null;
      for(const row of rows) {
       if(row.off||row.last_status==='exhausted') continue;
       settings.modelCalls.push({run:run.id,account:row.id,provider,model});
       if(using&&record) settings.switches.push({id:randomUUID().replaceAll('-',''),provider,from:using.id,to:row.id,at:Date.now()/1000});
       using=row;
       if(!settings.outOfQuota.has(row.id)) { settings.answeredOn.set(run.id,row.id); run.served={provider,model}; return true; }
       row.last_status='exhausted';
      }
      return false;
     };
     // The pair that answered (api_server_runs.py _served_runtime): the Run's own, or the fallback entry it moved to.
     if(runProvider&&runModel) run.served={provider:runProvider,model:runModel};
     run.requested=sent.provider&&sent.model?{provider:sent.provider,model:sent.model}:null;
     if(accounts.length&&!tryAccounts(runProvider,runModel,accounts,{record:true})) {
      const saved=profileOf(runProfile)?.config||{};
      const entries=raw=>(Array.isArray(raw)?raw:raw&&typeof raw==='object'?[raw]:[]).filter(entry=>entry?.provider&&entry?.model);
      for(const entry of [...entries(saved.fallback_providers),...entries(saved.fallback_model)]) {
       settings.fallbacks.push({run:run.id,provider:entry.provider,model:entry.model});
       if(tryAccounts(entry.provider,entry.model,settings.defaultPool[entry.provider]||[],{record:false})) break;
      }
      if(!settings.answeredOn.has(run.id)) run.outOfAccounts=true;
     }
     streams.set(run.id,{backlog:[],next:0,ended:false,readers:new Set()});
    }
    // A start whose answer is lost: the run exists, but the connection closes before any answer (loseStarts of them).
    if(settings.loseStarts>0) { settings.loseStarts--; request.socket.destroy(); return; }
    // A slow Engine (#756): the start is answered this many milliseconds late, the run already made.
    const started={run_id:run.id,status:'started',replayed:run.reads>0};
    if(settings.startDelay>0) { setTimeout(()=>send(response,202,started),settings.startDelay); return; }
    return send(response,202,started);
   }
   if(runPath&&request.method==='GET') {
    const run=settings.runs.find(run=>run.id===runPath[1]);
    // A Run a spec's in-process fake engine started on this profile (`heldElsewhere`) is this Engine's too: the lane's
    // worker reads it here as still running, never as lost, and the spec's own reader closes it (#889).
    if(!run&&settings.heldElsewhere?.(runPath[1])) return send(response,200,{object:'hermes.run',run_id:runPath[1],status:'running',pending_controls:[]});
    if(!run) return send(response,404,{error:{message:`Run not found: ${runPath[1]}`,code:'run_not_found'}});
    // As measured on the pinned release (#141, the install check): a Run's record has when it was made and nothing of when
    // it ended; its end is in its events.
    const times={created_at:run.created};
    if(run.stopped) { endEvents(run.id,'run.cancelled'); return send(response,200,{object:'hermes.run',run_id:run.id,status:'cancelled',session_id:run.session,pending_controls:[],...times}); }
    // As measured on the pinned release: the skip hint is appended to the question, and the first of two or more
    // choices is marked recommended.
    const waiting=run.asked?.find(asked=>!asked.settled);
    if(waiting) paused(run,waiting.prompt_id,'clarify',waiting.said);
    if(waiting) return send(response,200,{object:'hermes.run',run_id:run.id,status:'running',session_id:run.session,pending_controls:[{kind:'clarify',prompt_id:waiting.prompt_id,execution_generation:1,
     question:`${waiting.question}\nReply "skip" to skip this question.`,choices:waiting.choices.map((choice,index)=>index===0&&waiting.choices.length>=2?`${choice} (Recommended)`:choice),multi_select:waiting.multi_select}]});
    // The request as the pinned release sends it (api_server.py _approval_request_event): its words, the envelope, the
    // choices it takes back.
    const standing=allowlistOf(run.profile);
    for(const each of run.approvals||[]) { if(each.settled) continue; if(!each.kept.some(key=>standing.includes(key))) break; Object.assign(each,{settled:'answered',choice:'standing'}); }
    const asking=run.approvals?.find(each=>!each.settled);
    if(asking) paused(run,asking.request_id,'terminal',asking.said);
    if(asking) return send(response,200,{object:'hermes.run',run_id:run.id,status:'waiting_for_approval',session_id:run.session,last_event:'approval.request',...times,pending_controls:[],
     approval:{command:asking.command,description:asking.description,pattern_key:asking.patternKeys[0],pattern_keys:asking.patternKeys,request_id:asking.request_id,timeout_s:300,
      event:'approval.request',run_id:run.id,timestamp:Date.now()/1000,choices:asking.choices}});
    const done=run.reads++>=settings.pendingReads;
    if(done&&run.outOfAccounts) { endEvents(run.id,'run.failed'); return send(response,200,{object:'hermes.run',run_id:run.id,status:'failed',session_id:run.session,...times,
     output:settings.modelCalls.some(call=>call.run===run.id)?settings.noAccountText:settings.usageLimitText,pending_controls:[]}); }
    if(done) endEvents(run.id,settings.ending==='completed'?'run.completed':'run.failed');
    return send(response,200,{object:'hermes.run',run_id:run.id,status:done?settings.ending:'running',session_id:run.session,...times,...(done&&settings.ending==='completed'&&run.served?{runtime:{...run.served,route_source:run.requested?'raw_request':'global',...(run.requested?{requested:run.requested}:{})}}:{}),...(done&&settings.ending==='completed'?{output:settings.reply(inputText(run.input),(run.asked||[]).map(asked=>asked.answer??null),(run.approvals||[]).map(asking=>asking.choice??null))}:{}),...(done&&settings.ending==='failed'&&settings.failure?{[settings.failure===noProviderError?'error':'output']:settings.failure}:{}),...(done&&settings.usage?{usage:settings.usage}:{}),pending_controls:[]});
   }
   // The run's own routes (api_server_runs.py): stop, the answer to the question it waits for, which takes exactly
   // request_id, execution_generation and answer, and the choice for the request it waits on (_handle_run_approval).
   const runAction=request.url.match(/^\/p\/[^/]+\/v1\/runs\/([^/]+)\/(stop|clarify|approval)$/);
   if(runAction&&request.method==='POST') {
    const run=settings.runs.find(run=>run.id===runAction[1]);
    if(runAction[2]==='stop') {
     if(!run) return send(response,404,{error:{message:`Run not found: ${runAction[1]}`,code:'run_not_found'}});
     run.stopped=true; return send(response,200,{run_id:run.id,status:'stopping'});
    }
    let body=null; try { body=JSON.parse(raw); } catch { body=null; }
    if(runAction[2]==='approval') {
     const permitted=(status,result)=>{ settings.permits.push({run:runAction[1],status,body}); return send(response,status,settings.flatPermitErrors&&result.error?result.error:result); };
     if(!run) return permitted(404,{error:{message:`Run not found: ${runAction[1]}`,code:'run_not_found'}});
     if(!body||typeof body!=='object') return permitted(400,{error:{message:'Invalid JSON'}});
     const choice=String(body.choice??'').trim().toLowerCase(); const id=typeof body.request_id==='string'?body.request_id.trim():'';
     if(body.request_id!==undefined&&(!id||id.length>256)) return permitted(400,{error:{message:'Approval request_id is invalid.',code:'invalid_approval_request'}});
     if(!['once','session','always','deny'].includes(choice)) return permitted(400,{error:{message:'Invalid approval choice',code:'invalid_approval_choice'}});
     const ended=run.stopped||!run.asked.some(each=>!each.settled)&&!run.approvals.some(each=>!each.settled)&&run.reads>settings.pendingReads;
     if(ended) return permitted(409,{error:{message:`Run has no active approval session: ${run.id}`,code:'approval_not_active'}});
     const asking=run.approvals.find(each=>!each.settled&&(!id||each.request_id===id));
     if(!asking) return permitted(409,{error:{message:`Run has no pending approval: ${run.id}`,code:'approval_not_pending'}});
     Object.assign(asking,{settled:'answered',choice});
     if(choice==='always') { const home=profileOf(run.profile); if(home) { home.config={...home.config,command_allowlist:[...new Set([...allowlistOf(run.profile),...asking.kept])]}; if(run.profile==='default') settings.defaultConfig=home.config; } }
     return permitted(200,{object:'hermes.run.approval_response',run_id:run.id,choice,...(id?{request_id:id}:{}),resolved:1});
    }
    const answered=(status,result)=>{ settings.answers.push({run:runAction[1],status,body}); return send(response,status,result); };
    if(!body||typeof body!=='object'||Object.keys(body).sort().join()!=='answer,execution_generation,request_id'||typeof body.answer!=='string') return answered(400,{error:{message:'Invalid parameters',code:'invalid_params'}});
    if(!run) return answered(404,{error:{message:`Run not found: ${runAction[1]}`,code:'run_not_found'}});
    const asked=run.asked?.find(each=>each.prompt_id===body.request_id);
    const ended=run.stopped||!run.asked?.some(each=>!each.settled)&&run.reads>settings.pendingReads;
    if(!asked||body.execution_generation!==1||ended||asked.settled==='expired') return answered(409,{error:{message:'Stale generation',code:'stale_generation'}});
    if(asked.settled) return answered(409,{error:{message:'No clarify request is pending',code:'approval_not_pending'}});
    Object.assign(asked,{settled:'answered',answer:body.answer});
    return answered(200,{run_id:run.id,status:'resolved',prompt_id:asked.prompt_id});
   }
   // A run's events, read again after `last_seq` (or Last-Event-ID): the stream opens with a comment, says so when older
   // events it had are gone, replays the rest and follows the run until it ends.
   const eventsPath=request.url.match(/^\/p\/[^/]+\/v1\/runs\/([^/?]+)\/events(?:\?(.*))?$/);
   if(eventsPath&&request.method==='GET') {
    if(settings.stallEvents) return;
    const stream=streams.get(decodeURIComponent(eventsPath[1]));
    if(!stream) return send(response,404,{error:{message:`Run not found: ${eventsPath[1]}`,code:'run_not_found'}});
    const raw=request.headers['last-event-id']??new URLSearchParams(eventsPath[2]||'').get('last_seq');
    const parsed=Number.parseInt(String(raw??''),10); const last=Number.isNaN(parsed)?-1:Math.max(-1,parsed);
    response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'}); response.write(': open\n\n');
    const replay=stream.backlog.filter(item=>item.seq>last);
    if(replay.length&&replay[0].seq>last+1) response.write(`data: ${JSON.stringify({event:'replay.truncated',run_id:eventsPath[1],oldest_retained_seq:replay[0].seq})}\n\n`);
    for(const item of replay) { if(!item.event) return response.end(': stream closed\n\n'); response.write(frame(item)); }
    if(stream.ended) return response.end(': stream closed\n\n');
    stream.readers.add(response); response.on('close',()=>stream.readers.delete(response));
    return;
   }
   send(response,200,request.url.endsWith('/health')?{status:'ok',platform:'hermes-agent',version:settings.version}:{object:'hermes.api_server.capabilities',platform:'hermes-agent',features:settings.features});
  });
 });
 // The routes and answers observed on the pinned release's dashboard (port 9119), authenticated by its session token.
 const manage=(/** @type {import('node:http').IncomingMessage} */ request,/** @type {import('node:http').ServerResponse} */ response)=>{
  let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',()=>{
   let body=null; try { body=raw?JSON.parse(raw):null; } catch { body=null; }
   settings.managementRequests.push({method:request.method,path:request.url,authorization:request.headers.authorization,range:request.headers.range,body});
   const url=new URL(request.url,'http://management');
   // The vendor's redirect reaches Hermes's OAuth callback with no session token; it answers with its own page.
   const callback=url.pathname.match(/^\/api\/mcp\/oauth\/callback\/([^/]+)$/);
   if(callback&&request.method==='GET') {
    settings.appCallbacks.push(url.search);
    const page=(code,html)=>{response.writeHead(code,{'Content-Type':'text/html'});response.end(html);};
    const flow=[...settings.appFlows.values()].find(found=>found.server===decodeURIComponent(callback[1])&&found.status==='authorization_required'&&found.state===url.searchParams.get('state'));
    if(!flow) return page(404,'<h1>OAuth flow expired</h1><p>Return to Hermes and try again.</p>');
    if(url.searchParams.get('error')) { flow.status='error'; return page(400,'<h1>Authorization failed</h1><p>Return to Hermes for details.</p>'); }
    if(settings.approveApps) { flow.status='approved'; settings.appTokens.add(`${flow.profile}:${flow.server}`); }
    else flow.status='callback_received';
    return page(200,'<h1>Authorization received</h1><p>You can close this tab and return to Hermes.</p>');
   }
   if(request.headers.authorization!==`Bearer ${settings.key}`) return send(response,401,{error:'session_expired',message:request.headers.authorization});
   if(settings.managementStatus!==200) return send(response,settings.managementStatus,{detail:request.headers.authorization});
   // An Agent's Library (#194, #395). `/api/files?path=` lists a folder under the managed root with each entry's size,
   // time and resolved path (hermes_cli/web_routers/files.py 616, web_server_files.py _managed_file_entry), refusing a
   // path outside it (403), and `/api/files/download?path=` serves one file of it (files.py 813). `/api/fs/read-text` and
   // `/api/fs/download` with a profile read that profile's ssh workspace, the work sandbox (files.py 1032 and 1356 through
   // _remote_fs_backend): a /work path is the work folder, and any other path is not a file the sandbox holds (404).
   if(url.pathname.startsWith('/api/fs/')&&settings.sandboxDown) return send(response,503,{detail:'SSH workspace unavailable'});
   if(/^\/api\/(fs\/(read-text|download)|files\/download)$/.test(url.pathname)&&settings.filesRefused.has(url.searchParams.get('path')||'')) return send(response,403,{detail:'Access denied'});
   if(url.pathname==='/api/files'&&request.method==='GET') {
    const path=(url.searchParams.get('path')||'').replace(/\/+$/,'');
    if(!path.startsWith('/opt/data/')) return send(response,403,{detail:'Path outside managed files root'});
    if(settings.filesUnreadable.has(path)) return send(response,500,{detail:'Could not read directory'});
    const entries=entriesAt(path);
    if(!entries) return send(response,404,{detail:'Path not found'});
    return send(response,200,{path:settings.resolved.get(path)??path,parent:null,root:'/opt/data',locked_root:'/opt/data',can_change_path:false,entries:entries.map(entry=>{
     const folder=entry.isFolder===true;
     const at=entry.broken?`${path}/${entry.name}`:entry.resolves??`${path}/${entry.name}`;
     return {name:entry.name,path:at,is_directory:folder,size:folder||entry.broken?null:entry.size??0,mtime:folder||entry.broken?null:entry.mtime??1763500000,
      mime_type:folder||entry.broken?null:mimeOf(entry.name),...(entry.broken?{broken_link:true}:{})};
    })});
   }
   // One file by the Engine's path its folder lists it under, or null with the answer already sent.
   const fileAt=(path,engine)=>{
    const cut=engine.lastIndexOf('/');
    const entry=(entriesAt(engine.slice(0,cut))||[]).find(item=>item.name===engine.slice(cut+1));
    if(!entry||entry.broken) { send(response,404,{detail:'File not found'}); return null; }
    if(entry.isFolder===true) { send(response,400,{detail:'Path points to a directory'}); return null; }
    return {entry,file:settings.fileBytes.get(engine)||{body:`the bytes of ${entry.name}`,type:mimeOf(entry.name)}};
   };
   // The sandbox's /work is the Engine's /opt/data/work; a path the sandbox does not hold is null.
   const inSandbox=path=>path.startsWith('/work/')&&!path.split('/').includes('..')?`/opt/data${path}`:null;
   // The Engine's one read that names its ssh workspace (#398): `/api/fs/list?path=` lists a folder the sandbox holds;
   // the 503 above answers while the sandbox is stopped (hermes_cli/web_routers/files.py 1012 through _fs_backend).
   if(url.pathname==='/api/fs/list'&&request.method==='GET') return send(response,200,{entries:[]});
   const attachment=(name,type,body)=>{
    response.writeHead(200,{'Content-Type':type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'Content-Length':body.length});
    return response.end(request.method==='HEAD'?undefined:body);
   };
   if(url.pathname==='/api/files/download'&&request.method==='GET') {
    const path=url.searchParams.get('path')||'';
    if(!path.startsWith('/opt/data/')) return send(response,403,{detail:'Path outside managed files root'});
    const found=fileAt(path,path); if(!found) return;
    // A `Range: bytes=0-<n>` is answered with that first part (206) and the whole size in Content-Range, as Starlette's
    // FileResponse does.
    const whole=Buffer.from(found.file.body); const range=/^bytes=0-(\d+)$/.exec(String(request.headers.range||''));
    if(!range) return attachment(found.entry.name,mimeOf(found.entry.name),whole);
    // An empty file has no first byte: the range cannot be satisfied (416), as Starlette answers it.
    if(!whole.length) { response.writeHead(416,{'Content-Range':'bytes */0'}); return response.end(); }
    const part=whole.subarray(0,Number(range[1])+1);
    response.writeHead(206,{'Content-Type':mimeOf(found.entry.name),'Content-Range':`bytes 0-${Math.max(part.length-1,0)}/${whole.length}`,'Content-Length':part.length});
    return response.end(part);
   }
   // A text file's first part (#195): `/api/fs/read-text` answers the bytes up to 512 KB decoded as UTF-8, the whole
   // size, the type, whether more follows and whether it reads as binary (hermes_cli/web_routers/files.py 1032-1079).
   if(url.pathname==='/api/fs/read-text'&&request.method==='GET') {
    const path=url.searchParams.get('path')||'';
    const engine=inSandbox(path); if(!engine) return send(response,404,{detail:'File not found'});
    const found=fileAt(path,engine); if(!found) return;
    const data=Buffer.from(found.file.body);
    return send(response,200,{binary:data.includes(0),byteSize:data.length,language:'text',mimeType:found.file.type??mimeOf(found.entry.name),path:settings.resolved.get(path)??path,
     text:data.subarray(0,512*1024).toString('utf8'),truncated:data.length>512*1024});
   }
   if(url.pathname==='/api/fs/download'&&['GET','HEAD'].includes(request.method)) {
    const path=url.searchParams.get('path')||'';
    const engine=inSandbox(path); if(!engine) return send(response,404,{detail:'File not found'});
    const found=fileAt(path,engine); if(!found) return;
    return attachment(found.entry.name,found.file.type??mimeOf(found.entry.name),Buffer.from(found.file.body));
   }
   // A session answers only under its own profile; a page holds at most 500 messages, from `offset`.
   // One recording as text (#160; hermes_cli/web_routers/audio.py 89-149): the body is a data URL and its MIME type,
   // the answer the transcript and the provider. Only its size and type are kept here, never the recording.
   if(url.pathname==='/api/audio/transcribe'&&request.method==='POST') {
    const profile=url.searchParams.get('profile')||'default';
    const dataUrl=typeof body?.data_url==='string'?body.data_url:'';
    settings.transcriptions.push({profile,mimeType:body?.mime_type,bytes:Math.max(0,dataUrl.length-(dataUrl.indexOf(',')+1))});
    if(settings.transcriptionStatus!==200) return send(response,settings.transcriptionStatus,{detail:settings.transcriptionDetail});
    return send(response,200,{ok:true,transcript:settings.transcriptionTranscript,provider:'local'});
   }
   const sessionMessages=url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
   if(sessionMessages&&request.method==='GET') {
    const id=decodeURIComponent(sessionMessages[1]); const found=settings.sessions.get(id);
    if(!found||found.profile!==(url.searchParams.get('profile')||'default')) return send(response,404,{detail:'Session not found'});
    const limit=Math.min(Number(url.searchParams.get('limit')??500),500); const offset=Number(url.searchParams.get('offset')??0);
    const page=url.searchParams.get('order')==='latest'?found.messages.slice(Math.max(0,found.messages.length-limit)):found.messages.slice(offset,offset+limit);
    return send(response,200,{session_id:id,profile:found.profile,messages:page,pagination:{limit,offset,order:url.searchParams.get('order')||'oldest',returned:page.length}});
   }
   // A profile's usage over the last `days` (#347): the sums of its sessions started since then, null with none, as
   // the pinned release's SQL sums are. #32: by_model groups the sessions that named a model, tokens descending, with
   // the price the pinned release answers beside them so a reader can prove it drops it; the release also merges
   // auxiliary usage in, which this fake does not keep.
   if(url.pathname==='/api/analytics/usage'&&request.method==='GET') {
    const since=Date.now()/1000-Number(url.searchParams.get('days')??30)*86400; const profile=url.searchParams.get('profile')||'default';
    const counted=[...settings.sessions.values()].filter(found=>found.profile===profile&&(found.started_at??Date.now()/1000)>since);
    const sum=(/** @type {'input_tokens'|'output_tokens'} */ key)=>counted.length?counted.reduce((total,found)=>total+Number(found[key]??0),0):null;
    const byModel=[...counted.reduce((grouped,found)=>{
     if(typeof found.model!=='string'||!found.model) return grouped;
     const row=grouped.get(found.model)||{model:found.model,input_tokens:0,output_tokens:0,estimated_cost:0,sessions:0,api_calls:0};
     row.input_tokens+=Number(found.input_tokens??0); row.output_tokens+=Number(found.output_tokens??0); row.sessions+=1; row.api_calls+=1;
     return grouped.set(found.model,row);
    },new Map()).values()].map(row=>({...row,estimated_cost:Math.round((row.input_tokens+row.output_tokens)/1000*0.62*100)/100}))
     .sort((a,b)=>(b.input_tokens+b.output_tokens)-(a.input_tokens+a.output_tokens));
    return send(response,200,{daily:[],by_model:byModel,by_task:[],totals:{total_input:sum('input_tokens'),total_output:sum('output_tokens'),total_sessions:counted.length},period_days:Number(url.searchParams.get('days')??30),skills:[],tools:[]});
   }
   const sessionDetail=url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
   if(sessionDetail&&request.method==='GET') {
    const id=decodeURIComponent(sessionDetail[1]); const found=settings.sessions.get(id);
    if(!found||found.profile!==(url.searchParams.get('profile')||'default')) return send(response,404,{detail:'Session not found'});
    return send(response,200,{id,profile:found.profile,started_at:found.started_at??Date.now()/1000,message_count:found.messages.length,input_tokens:found.input_tokens??0,output_tokens:found.output_tokens??0});
   }
   // A profile list that answers with this status instead (an Engine busy or going away).
   if(url.pathname==='/api/profiles'&&request.method==='GET'&&settings.profilesListStatus) return send(response,settings.profilesListStatus,{detail:'Service unavailable'});
   if(url.pathname==='/api/profiles'&&request.method==='GET') return send(response,200,{profiles:[{name:'default',path:'/opt/data',is_default:true,model:'default-model',provider:'auto',display_name:null,description:'',description_auto:true,bot_title:null},...[...settings.profiles].map(([name,profile])=>({name,path:`/opt/data/profiles/${name}`,is_default:false,model:profile.model,provider:profile.provider,display_name:profile.display_name??null,description:profile.description??'',description_auto:profile.description_auto!==false,bot_title:profile.bot_title??null}))]});
   if(url.pathname==='/api/profiles'&&request.method==='POST') {
    if(body?.name==='default'||settings.profiles.has(body?.name)) return send(response,400,{detail:`A profile named '${body.name}' already exists. Choose another name.`});
    settings.profiles.set(body.name,{soul:body.soul||'',provider:settings.seedModel?.provider||'auto',model:settings.seedModel?.model||'',key:null,config:{},credentials:{},display_name:null,description:typeof body.description==='string'?body.description:'',description_auto:true,bot_title:null});
    return send(response,200,{ok:true,name:body.name,path:`/opt/data/profiles/${body.name}`,model_set:false,model_error:'No provider given',soul_set:Boolean(body.soul)});
   }
   // As delete_profile_endpoint answers (hermes_cli/web_routers/profiles.py 984-1002).
   const removing=url.pathname.match(/^\/api\/profiles\/([^/]+)$/);
   if(removing&&request.method==='DELETE') {
    const name=decodeURIComponent(removing[1]);
    if(name==='default'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) return send(response,400,{detail:name==='default'?'Cannot delete the default profile (~/.hermes).':`Invalid profile name '${name}'`});
    if(!settings.profiles.has(name)) return send(response,404,{detail:`Profile '${name}' does not exist.`});
    settings.profiles.delete(name); settings.unknownProfiles.push(name);
    const path=`/opt/data/profiles/${name}`;
    return send(response,200,settings.settlementPending?{ok:true,path,identity_settled:false,settlement_pending:true,retry_command:`hermes profile delete ${name}`}:{ok:true,path});
   }
   const profilePath=url.pathname.match(/^\/api\/profiles\/([^/]+)\/(soul|model|description)$/);
   const profile=profilePath&&settings.profiles.get(decodeURIComponent(profilePath[1]));
   if(profilePath&&!profile) return send(response,404,{detail:'Profile not found'});
   if(profilePath?.[2]==='soul'&&request.method==='GET') return send(response,200,{content:profile.soul,exists:true});
   if(profilePath?.[2]==='soul'&&request.method==='PUT') { if(typeof body?.content!=='string') return send(response,422,{detail:'content'}); profile.soul=body.content; return send(response,200,{ok:true}); }
   // A person wrote the description (hermes_cli/web_routers/profiles.py 1042-1053): trimmed, stored, never auto again.
   if(profilePath?.[2]==='description'&&request.method==='PUT') {
    if(typeof body?.description!=='string') return send(response,422,{detail:'description'});
    profile.description=body.description.trim();
    profile.description_auto=false;
    return send(response,200,{ok:true,description:profile.description,description_auto:false});
   }
   if(profilePath?.[2]==='model'&&request.method==='PUT') {
    const answer=()=>{
     if(settings.failStep==='model') return send(response,500,{detail:'Internal Server Error'});
     // _write_profile_model checks a pick against the profile's own keys (profiles.py 124-150); modelNeedsKey turns it on.
     const keyed=settings.envRows.find(row=>row.primary&&row.provider===body?.provider);
     if(settings.modelNeedsKey&&keyed&&!profile.env?.[keyed.env]) return send(response,400,{detail:`No credentials for ${body.provider} in this profile`});
     Object.assign(profile,{provider:body.provider,model:body.model});
     return send(response,200,{ok:true,provider:body.provider,model:body.model});
    };
    // A slow Engine (#661): the model write answers only after modelWriteDelay ms.
    if(settings.modelWriteDelay>0) { setTimeout(answer,settings.modelWriteDelay); return; }
    return answer();
   }
   // The real value of one env var (hermes_cli/web_routers/config_env.py reveal_env_var): 404 when the profile's .env
   // holds none.
   if(url.pathname==='/api/env/reveal'&&request.method==='POST') {
    const named=body?.profile||url.searchParams.get('profile')||'default';
    const env=named==='default'?settings.defaultEnv:settings.profiles.get(named)?.env||{};
    const value=env?.[body?.key];
    settings.reveals.push({profile:named,key:body?.key});
    if(settings.revealFail.has(body?.key)) return send(response,500,{detail:'Internal Server Error'});
    return value===undefined?send(response,404,{detail:`${body?.key} not found in .env`}):send(response,200,{key:body.key,value});
   }
   if(url.pathname==='/api/env') {
    const named=url.searchParams.get('profile')||'default';
    const target=settings.profiles.get(named);
    const envOf=()=>named==='default'?settings.defaultEnv:(target.env||={});
    if(request.method==='GET') {
     if(settings.envReadFail.has(named)) return send(response,500,{detail:'Internal Server Error'});
     if(named!=='default'&&!target) return send(response,404,{detail:`Profile '${named}' does not exist.`});
     const env=envOf();
     // The Engine's own preview of a set value, which gtmworks must never pass on.
     const preview=value=>value?`${value.slice(0,4)}...${value.slice(-4)}`:null;
     const rows=Object.fromEntries(settings.envRows.map(row=>[row.env,{is_set:Boolean(env[row.env]),redacted_value:preview(env[row.env]),description:'',url:null,category:row.category,is_password:row.password,tools:[],advanced:false,channel_managed:false,provider:row.provider,provider_label:row.label,provider_profiles:[],provider_primary:row.primary,custom:false}]));
     for(const [name,value] of Object.entries(env)) if(!rows[name]) rows[name]={is_set:true,redacted_value:preview(value),description:'',url:null,category:'custom',is_password:true,tools:[],advanced:false,channel_managed:false,provider:'',provider_label:'',provider_profiles:[],provider_primary:false,custom:true};
     return send(response,200,rows);
    }
    if(settings.envDropped.has(named)) { request.socket.destroy(); return; }
    if(request.method==='PUT') {
     if(settings.envHang.has(named)) return;
     if(settings.failStep==='env'||settings.envFail.has(named)||!target) return send(response,500,{detail:'Internal Server Error'});
     if(typeof body?.value==='string'&&(body.value.includes('...')||body.value.includes('***'))) return send(response,400,{detail:'Refusing to save a redacted credential preview'});
     if(body?.key==='API_SERVER_KEY') target.key=body.value;
     else envOf()[body?.key]=body?.value;
     return send(response,200,{ok:true,key:body?.key,config_updates:[]});
    }
    if(request.method==='DELETE') {
     if(settings.envFail.has(named)) return send(response,500,{detail:'Internal Server Error'});
     if(!target) return send(response,404,{detail:`Profile '${named}' does not exist.`});
     const env=envOf();
     if(!env[body?.key]) return send(response,404,{detail:`${body?.key} not found in .env`});
     delete env[body.key];
     return send(response,200,{ok:true,key:body.key,removed:true,pool_pruned:0,providers:[],config_scrubbed:[],found:true});
    }
   }
   const scoped=url.searchParams.get('profile')||'default';
   const home=profileOf(scoped);
   // Audio (#162): the list of voices only ElevenLabs offers, unlocked by the profile's own key, and one spoken sample
   // with the profile's saved tts.* settings (hermes_cli/web_routers/audio.py 223-352). The sound is base64 inside the
   // JSON answer, so it can pass the driver's 4 MB cap (speakLarge); a provider that cannot speak answers 400 with its own
   // words, as the shipped image does with no speech package installed.
   if(url.pathname==='/api/audio/elevenlabs/voices'&&request.method==='GET') {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    const env=(scoped==='default'?settings.defaultEnv:settings.profiles.get(scoped)?.env)||{};
    if(!env.ELEVENLABS_API_KEY) return send(response,200,{available:false,voices:[]});
    return send(response,200,settings.elevenLabsVoices);
   }
   if(url.pathname==='/api/audio/speak'&&request.method==='POST') {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    if(typeof body?.text!=='string'||!body.text.trim()) return send(response,400,{detail:'Text is required'});
    if(settings.speakRefusal) return send(response,400,{detail:settings.speakRefusal});
    if(settings.speakLarge) return send(response,200,{ok:true,data_url:`data:audio/mpeg;base64,${'A'.repeat(4*1024*1024+16)}`,mime_type:'audio/mpeg',provider:'edge'});
    return send(response,200,{ok:true,data_url:settings.speakDataUrl,mime_type:'audio/mpeg',provider:(home.config?.tts?.provider)||'edge'});
   }
   // The Engine's defaults take no profile and its schema is built from them (web_routers/config_env.py 95-110).
   if(url.pathname==='/api/config/defaults'&&request.method==='GET') return send(response,200,settings.configDefaults);
   if(url.pathname==='/api/config/schema'&&request.method==='GET') {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    return send(response,200,settings.configSchema);
   }
   if(url.pathname==='/api/config'&&['GET','PUT'].includes(request.method)) {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    if(request.method==='GET') {
     // As get_config answers: saved values over the Engine's defaults, or the saved values alone with
     // include_defaults=false; a dict-form model is flattened and its context length surfaced (web_server_config.py 587-599).
     const merged=url.searchParams.get('include_defaults')==='false'?structuredClone(home.config):merge(settings.configDefaults,home.config);
     const model=merged?.model;
     if(model&&typeof model==='object') merged.model=model.default??model.name??'';
     merged.model_context_length=model&&typeof model==='object'&&Number.isInteger(model.context_length)?model.context_length:0;
     return send(response,200,merged);
    }
    if(settings.failStep==='config'||settings.configWriteFail.has(scoped)||!body?.config||typeof body.config!=='object') return send(response,500,{detail:'Internal server error'});
    // A stale Hermes answers the write and keeps the old config.
    if(!settings.staleConfig) home.config=merge(home.config,body.config);
    if(scoped==='default') settings.defaultConfig=home.config;
    return send(response,200,{ok:true});
   }
   // Learning (hermes_cli/web_routers/status.py 746-800, agent/learning_graph.py): the graph lists a profile's skills and
 // its memory entries side by side, and one node's text is read on its own. A skill's name resolves to its SKILL.md
 // here too, so what keeps a skill out of memory is the contract's own guard, not this fake.
 if(url.pathname==='/api/learning/graph'&&request.method==='GET') {
  const named=url.searchParams.get('profile')||'default';
  if(!profileOf(named)) return send(response,404,{detail:`Profile '${named}' does not exist.`});
  // A skill node says `createdBy:"agent"` only for what the profile learned on its own (#180: settings.learnedSkills).
  const learned=settings.learnedSkills.get(named)||new Set();
  const cards=memoryCards(named); const skillNames=[...new Set([...(settings.skills.get(named)||new Map()).keys(),...learned])];
  return send(response,200,{
   nodes:[...skillNames.map(name=>({id:name,label:name,kind:'skill',timestamp:null,category:null,useCount:3,state:'active',createdBy:learned.has(name)?'agent':'user',pinned:false})),
    ...cards.map(card=>({id:card.id,label:memoryTitle(card.text),kind:'memory',memorySource:card.source,timestamp:null,category:'memory',useCount:0,state:'active',createdBy:'memory',pinned:false}))],
   edges:[],clusters:[],
   memory:cards.map(card=>({source:card.source,title:memoryTitle(card.text),body:card.text,fingerprint:card.id.split(':')[3]})),
   stats:{memory_nodes:cards.length,memory_skill_edges:0,learned_skills:skillNames.length}});
 }
 if(url.pathname==='/api/learning/node'&&request.method==='GET') {
  const named=url.searchParams.get('profile')||'default';
  if(!profileOf(named)) return send(response,404,{detail:`Profile '${named}' does not exist.`});
  const id=url.searchParams.get('id')||'';
  const card=memoryCards(named).find(found=>found.id===id);
  if(card) return send(response,200,{ok:true,kind:'memory',id,label:memoryTitle(card.text),content:card.text});
  const skill=settings.skills.get(named)?.get(id);
  return skill?send(response,200,{ok:true,kind:'skill',id,label:id,content:skill}):send(response,404,{detail:'not found'});
 }
 // A note rewritten or removed by its id (status.py 780-795, agent/learning_mutations.py edit_node/delete_node): an id
 // whose entry changed under the reader is stale, an empty note is refused, and a note over its file's limit too.
 if(url.pathname==='/api/learning/node'&&['PUT','DELETE'].includes(request.method)) {
  const named=url.searchParams.get('profile')||'default';
  if(!profileOf(named)) return send(response,404,{detail:`Profile '${named}' does not exist.`});
  const id=body?.id;
  if(typeof id!=='string'||!/^memory:(memory|profile):\d{1,9}(:[0-9a-f]{12})?$/.test(id)) return send(response,400,{detail:`bad memory node id: ${id}`});
  const source=id.split(':')[1]; const files=settings.memory.get(named)||{memory:[],profile:[]};
  const card=memoryCards(named).find(found=>found.id===id);
  const at=card?files[source].indexOf(card.text):-1;
  if(!card||at<0) return send(response,400,{detail:'memory node id is stale — refresh the graph'});
  const name=source==='memory'?'MEMORY.md':'USER.md';
  if(request.method==='DELETE') {
   files[source].splice(at,1); settings.memory.set(named,files);
   return send(response,200,{ok:true,message:`deleted memory from ${name}`});
  }
  if(typeof body?.content!=='string'||!body.content.trim()) return send(response,400,{detail:'empty memory — use delete to remove it'});
  const replacement=body.content.trim();
  const next=[...files[source].slice(0,at),replacement,...files[source].slice(at+1)];
  const limit=source==='memory'?2200:1375;
  if(next.join('\n§\n').length>limit) return send(response,400,{detail:'Replacement would put memory at '+(next.join('\n§\n').length)+'/'+limit+' chars. Shorten the new content.'});
  files[source]=next; settings.memory.set(named,files);
  return send(response,200,{ok:true,message:`updated memory in ${name}`});
 }

 // A reset deletes that profile's MEMORY.md and USER.md only, and is refused without a profile while the backend serves
 // several (ops.py 535-553, _common.py destructive_profile).
 if(url.pathname==='/api/memory/reset'&&request.method==='POST') {
  const named=url.searchParams.get('profile');
  if(!named) return send(response,400,{detail:'POST /api/memory/reset requires an explicit profile: this backend serves several profiles'});
  if(!profileOf(named)) return send(response,404,{detail:`Profile '${named}' does not exist.`});
  const target=body?.target??'all';
  if(!['all','memory','user'].includes(target)) return send(response,400,{detail:'target must be all, memory, or user'});
  const files=settings.memory.get(named)||{memory:[],profile:[]}; const deleted=[];
  if(['all','memory'].includes(target)&&files.memory.length) { files.memory=[]; deleted.push('MEMORY.md'); }
  if(['all','user'].includes(target)&&files.profile.length) { files.profile=[]; deleted.push('USER.md'); }
  settings.memory.set(named,files);
  return send(response,200,{ok:true,deleted});
 }
 // Skills (hermes_cli/web_routers/skills.py): a profile sees its own and those of each folder its
   // skills.external_dirs names (a profile's folder is its home's `skills`), and keeps its own locks.
   const skillsPath=url.pathname.match(/^\/api\/skills(?:\/(content|lock|toggle))?$/);
   if(skillsPath) {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    const owners=[scoped,...(home.config?.skills?.external_dirs||[]).map(folder=>/^\/opt\/data\/profiles\/([^/]+)\/skills$/.exec(folder)?.[1]).filter(owner=>settings.profiles.has(owner))];
    const listed=[
     {name:'hermes-agent',owner:scoped,provenance:'bundled',description:'',category:null},
     ...owners.flatMap((owner,at)=>[...(settings.skills.get(owner)||new Map())].filter(([name])=>name!=='hermes-agent').map(([name,content])=>({
      name,owner,content,provenance:at?'external':settings.skillProvenance.get(`${scoped}:${name}`)||'agent',...skillHeader(content)})))];
    const name=skillsPath[1]==='content'&&request.method==='GET'?url.searchParams.get('name'):body?.name;
    const found=listed.find(skill=>skill.name===name);
    const missing=()=>send(response,404,{detail:`Skill '${name}' not found.`});
    if(!skillsPath[1]&&request.method==='GET') return send(response,200,listed.map(skill=>({name:skill.name,description:skill.description,category:skill.category,locked:settings.skillLocks.has(`${scoped}:${skill.name}`),enabled:skill.name==='hermes-agent'||!settings.skillsOff.has(`${scoped}:${skill.name}`),usage:0,provenance:skill.provenance})));
    // A switch is the profile's own (skills.disabled), on any name, listed or not. The essential skill answers ok but
    // stays on, as the Engine drops it from the disabled list (#180).
    if(skillsPath[1]==='toggle'&&request.method==='PUT') { if(name!=='hermes-agent') settings.skillsOff[body.enabled?'delete':'add'](`${scoped}:${name}`); return send(response,200,{ok:true,name,enabled:body.enabled}); }
    if(!skillsPath[1]&&request.method==='POST') {
     if(found) return send(response,400,{detail:`A skill named '${name}' already exists.`});
     if(!settings.skills.has(scoped)) settings.skills.set(scoped,new Map());
     settings.skills.get(scoped).set(name,body.content);
     return send(response,200,{success:true,message:`Skill '${name}' created.`});
    }
    if(!found) return missing();
    if(skillsPath[1]==='content'&&request.method==='GET') return send(response,200,{name,content:settings.skills.get(found.owner).get(name),path:`/opt/data/profiles/${found.owner}/skills/${name}/SKILL.md`});
    if(skillsPath[1]==='content'&&request.method==='PUT') { settings.skills.get(found.owner).set(name,body.content); return send(response,200,{success:true,message:`Skill '${name}' updated.`}); }
    if(skillsPath[1]==='lock'&&request.method==='PUT') { settings.skillLocks[body.locked?'add':'delete'](`${scoped}:${name}`); return send(response,200,{ok:true,name,locked:body.locked}); }
   }
   // The model providers a profile is signed in to (hermes_cli/web_routers/models.py, get_model_options): a profile with
   // no credential of its own uses the root profile's, and its current provider without one is listed unauthenticated.
   if(url.pathname==='/api/model/options'&&request.method==='GET') {
    if(settings.modelOptionsFail) return send(response,503,{detail:'busy'});
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    const own=settings.profiles.get(scoped)||{provider:'auto',model:''};
    const signedIn=['openai-codex','anthropic'].filter(id=>home.credentials[id]||settings.defaultCredentials[id]);
    const providers=signedIn.map(slug=>({slug,name:slug,is_current:slug===own.provider,models:[...new Set([...settings.subscriptionModels[slug]||[],...own.provider===slug&&own.model?[own.model]:[]])],source:'authenticated'}));
    const env=(scoped==='default'?settings.defaultEnv:settings.profiles.get(scoped).env)||{};
    for(const row of settings.envRows.filter(row=>row.primary&&env[row.env]&&!signedIn.includes(row.provider)))
     providers.push({slug:row.provider,name:row.label,is_current:row.provider===own.provider,models:settings.providerModels[row.provider]||[],source:'env'});
    if(own.provider!=='auto'&&!signedIn.includes(own.provider)) providers.push({slug:own.provider,name:own.provider,is_current:true,authenticated:false,models:own.model?[own.model]:[],source:'configured-current'});
    return send(response,200,{providers,model:own.model,provider:own.provider});
   }
   // Apps (hermes_cli/web_routers/mcp.py): the catalogue with what this profile installed, an install, a probe with the
   // stored sign-in, an OAuth sign-in through a flow, and removal. A flow is not tied to a profile in its own routes.
   const flowPath=url.pathname.match(/^\/api\/mcp\/oauth\/flows\/([^/]+)$/);
   if(flowPath) {
    const flow=settings.appFlows.get(decodeURIComponent(flowPath[1]));
    if(request.method==='DELETE') { if(!flow) return send(response,200,{ok:true,status:'expired'}); if(flow.status!=='approved') flow.status='error'; return send(response,200,{ok:true,status:flow.status}); }
    if(!flow) return send(response,404,{detail:'OAuth flow not found or expired'});
    return send(response,200,{flow_id:flowPath[1],server_name:flow.server,status:flow.status==='callback_received'?'authorization_required':flow.status,authorization_url:null,error:flow.status==='error'?'Secret detail from /opt/data':null,tools:[]});
   }
   const servers=home?.config?.mcp_servers||{};
   const keepServers=next=>{ home.config={...home.config,mcp_servers:next}; if(scoped==='default') settings.defaultConfig=home.config; };
   if(url.pathname==='/api/mcp/catalog'&&request.method==='GET') {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    return send(response,200,{entries:settings.catalog.map(name=>({name,description:'',transport:'http',auth_type:settings.catalogAuth[name]||'oauth',url:`https://mcp.${name}.example/mcp`,required_env:settings.catalogEnv[name]||[],default_enabled:null,installed:Boolean(servers[name]),enabled:Boolean(servers[name])&&servers[name].enabled!==false})),diagnostics:[]});
   }
   if(url.pathname==='/api/mcp/catalog/install'&&request.method==='POST') {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    if(!settings.catalog.includes(body?.name)) return send(response,404,{detail:`No catalog entry '${body?.name}'`});
    // As Hermes leaves an entry it cannot probe yet: no tool filter, every tool on once signed in.
    const auth=settings.catalogAuth[body.name]||'oauth';
    keepServers({...servers,[body.name]:{url:`https://mcp.${body.name}.example/mcp`,...(auth==='oauth'?{auth:'oauth'}:{}),enabled:body.enable!==false}});
    return send(response,200,{ok:true,name:body.name,background:false});
   }
   // The dashboard's own server routes (hermes_cli/web_routers/mcp.py): add a remote server by address, replace the whole
   // map for a filter removal, and a summary shaped like _mcp_server_summary.
   if(url.pathname==='/api/mcp/servers'&&['POST','PUT'].includes(request.method)) {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    if(request.method==='PUT') {
     if(!body?.servers||typeof body.servers!=='object'||Array.isArray(body.servers)) return send(response,400,{detail:'servers'});
     keepServers(body.servers); return send(response,200,{ok:true});
    }
    const name=(body?.name||'').trim();
    // hermes_cli/web_server_mcp.py _normalize_mcp_server_create: exactly one of an address or a command (stdio), and a
    // stdio server takes no HTTP sign-in.
    if(!name||Boolean((body?.url||'').trim())===Boolean((body?.command||'').trim())) return send(response,400,{detail:'Provide exactly one of URL or command'});
    if(Object.hasOwn(servers,name)) return send(response,409,{detail:`Server '${name}' already exists`});
    const auth=(body.auth||'none').toLowerCase();
    if(!['none','oauth','header'].includes(auth)) return send(response,400,{detail:'Unsupported auth mode'});
    if(body.command) {
     if(auth!=='none'||body.bearer_token!==undefined) return send(response,400,{detail:'HTTP authentication is not supported for stdio MCP servers'});
     keepServers({...servers,[name]:{command:body.command,...(Array.isArray(body.args)&&body.args.length?{args:[...body.args]}:{})}});
     return send(response,200,{name,transport:'stdio',url:null,command:body.command,args:body.args||[],auth:null,enabled:true,tools:null,source:'config',plugin:null});
    }
    if(auth==='header'&&!body.bearer_token) return send(response,400,{detail:'Bearer token is required'});
    const cfg={url:body.url,...(auth==='oauth'?{auth:'oauth'}:{}),...(auth==='header'?{headers:{Authorization:'Bearer MCP_BEARER_TOKEN'}}:{})};
    if(auth==='header') settings.serverTokens.set(`${scoped}:${name}`,String(body.bearer_token));
    keepServers({...servers,[name]:cfg});
    return send(response,200,{name,transport:'http',url:body.url,auth:auth==='none'?null:auth,enabled:true,tools:null,source:'config',plugin:null});
   }
   const server=url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)(?:\/(test|auth|enabled))?$/);
   if(server) {
    const name=decodeURIComponent(server[1]);
    if(!home||!servers[name]) return send(response,404,{detail:`Server '${name}' not found`});
    if(server[2]==='enabled'&&request.method==='PUT') { keepServers({...servers,[name]:{...servers[name],enabled:Boolean(body?.enabled)}}); return send(response,200,{ok:true,name,enabled:Boolean(body?.enabled)}); }
    if(!server[2]&&request.method==='DELETE') { const rest={...servers}; delete rest[name]; keepServers(rest); return send(response,200,{ok:true}); }
    if(server[2]==='test'&&request.method==='POST') {
     if(settings.appsUnreachable.has(name)) return send(response,200,{ok:false,error:'Connection failed: /opt/data/mcp-tokens secret detail',tools:[]});
     if(servers[name].auth==='oauth'&&!settings.appTokens.has(`${scoped}:${name}`)) return send(response,200,{ok:false,error:'OAuth authentication required — no token found.',tools:[]});
     if(servers[name].auth==='header'&&!settings.serverTokens.has(`${scoped}:${name}`)) return send(response,200,{ok:false,error:'Bearer token required.',tools:[]});
     return send(response,200,{ok:true,tools:(settings.appTools[name]||[`get_${name}`,`delete_${name}`]).map(tool=>({name:tool,description:''})),prompts:0,resources:0});
    }
    if(server[2]==='auth'&&request.method==='POST') {
     if([...settings.appFlows.values()].some(flow=>flow.server===name&&flow.profile===scoped&&['authorization_required','callback_received'].includes(flow.status))) return send(response,409,{detail:`MCP OAuth for '${name}' is already in progress`});
     const id=randomUUID().replaceAll('-',''); const state=randomUUID();
     const redirect=servers[name].oauth?.redirect_uri||`http://${request.headers.host}/api/mcp/oauth/callback/${name}`;
     settings.appFlows.set(id,{server:name,profile:scoped,status:'authorization_required',state,redirect});
     return send(response,200,{flow_id:id,server_name:name,status:'authorization_required',authorization_url:`${settings.appAuthScheme}://auth.${name}.example/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirect)}`,error:null});
    }
   }
   // Model sign-in (hermes_cli/web_routers/oauth.py): ChatGPT through a device code, Claude from the command line only.
   const cancel=url.pathname.match(/^\/api\/providers\/oauth\/sessions\/([^/]+)$/);
   if(cancel&&request.method==='DELETE') {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    const found=settings.signInSessions.get(cancel[1]);
    if(!found) return send(response,200,{ok:false,message:'session not found'});
    if(found.profile!==scoped) return send(response,400,{detail:'OAuth session profile mismatch'});
    found.status='cancelled'; settings.signInSessions.delete(cancel[1]); return send(response,200,{ok:true,session_id:cancel[1]});
   }
   // The credential pool (hermes_cli/web_routers/ops.py 351-377): a profile with no entries of its own for a provider
   // reads the root's (read_credential_pool), and load_pool seeds the profile's ANTHROPIC_API_KEY after the manual rows
   // (agent/credential_pool.py _normalize_pool_priorities). Each entry carries a token preview gtmworks must never pass on.
   if(url.pathname==='/api/credentials/pool'&&request.method==='GET') {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    if(settings.poolFail) return send(response,500,{detail:'Internal Server Error'});
    // A read that names its profile (the accounts list, #618) failing alone, while the sign-in status still reads.
    if(settings.poolNamedFail&&url.searchParams.has('profile')) return send(response,500,{detail:'Internal Server Error'});
    const pool={...settings.defaultPool};
    const env=(scoped==='default'?settings.defaultEnv:settings.profiles.get(scoped)?.env)||{};
    if(env.ANTHROPIC_API_KEY) pool.anthropic=[...pool.anthropic||[],{id:'envkey',label:'ANTHROPIC_API_KEY',auth_type:'api_key',source:'env:ANTHROPIC_API_KEY',priority:(pool.anthropic||[]).length,access_token:env.ANTHROPIC_API_KEY}];
    return send(response,200,{providers:Object.entries(pool).filter(([,entries])=>entries.length).map(([provider,entries])=>({provider,
     entries:entries.map((entry,at)=>({index:at+1,id:entry.id,label:entry.label,auth_type:entry.auth_type,source:entry.source,priority:entry.priority,last_status:entry.last_status??null,request_count:0,token_preview:`...${entry.access_token.slice(-4)}`,has_refresh:entry.auth_type==='oauth'}))}))});
   }
   // The Owner's order of a provider's root accounts and their switches (scripts/engine-pool-order.sh): the rows it
   // names first, in its order, each kept off or on; the rest after, on. The root is named, as the patch's route asks.
   const poolOrder=url.pathname.match(/^\/api\/credentials\/pool\/([^/]+)\/order$/);
   if(poolOrder&&request.method==='PUT') {
    if(!url.searchParams.get('profile')) return send(response,400,{detail:'profile is required on a multi-profile host'});
    const listed=body?.entries;
    if(!Array.isArray(listed)||!listed.every(entry=>typeof entry?.id==='string'&&typeof entry.off==='boolean')) return send(response,400,{detail:'entries must list each pool entry id once'});
    const rows=settings.defaultPool[poolOrder[1]]||[];
    for(const row of rows) { const at=listed.findIndex(entry=>entry.id===row.id); if(at<0) { delete row.place; delete row.off; } else { row.place=at; row.off=listed[at].off; } }
    rows.sort((a,b)=>(a.place??64)-(b.place??64));
    return send(response,200,{ok:true,provider:poolOrder[1],entries:rows.map(row=>({id:row.id,off:row.off===true}))});
   }
   if(url.pathname==='/api/credentials/pool/switches'&&request.method==='GET') return send(response,200,{switches:settings.switches.slice(-100)});
   // One pool entry leaves by its 1-based index (ops.py 438-488); the singleton's row takes the singleton with it. A
   // root not named is refused on an Engine serving several profiles (destructive_profile), as every Company's does.
   const poolEntry=url.pathname.match(/^\/api\/credentials\/pool\/([^/]+)\/(\d+)$/);
   if(poolEntry&&request.method==='DELETE') {
    if(!url.searchParams.get('profile')) return send(response,400,{detail:'profile is required on a multi-profile host'});
    if(scoped!=='default') return send(response,404,{detail:'No pool entry at that index'});
    const rows=settings.defaultPool[poolEntry[1]]||[];
    const at=Number(poolEntry[2])-1;
    if(at<0||at>=rows.length) return send(response,404,{detail:'No pool entry at that index'});
    const [removed]=rows.splice(at,1);
    if(removed.source==='device_code'||removed.source==='hermes_pkce') delete settings.defaultCredentials[poolEntry[1]];
    return send(response,200,{ok:true,provider:poolEntry[1],count:rows.length,cleaned:[],hints:[]});
   }
   const oauth=url.pathname.match(/^\/api\/providers\/oauth(?:\/([^/]+))?(?:\/(start|poll)(?:\/([^/]+))?)?$/);
   if(oauth) {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    const [,provider,step,session]=oauth;
    // As in the pinned release (hermes_cli/auth.py read_credential_pool, _load_provider_state), a profile with no
    // credential of its own for a provider reads the default (root) profile's, and its status says logged in.
    const credentialFor=id=>home.credentials[id]||(scoped!=='default'?settings.defaultCredentials[id]:undefined);
    // Claude's status reads the sign-in file, then the profile's ANTHROPIC_API_KEY, which it reports as logged in with
    // source env_var; it never reads the credential pool (hermes_cli/web_server_oauth.py 43-73, _anthropic_oauth_status).
    const envKey=((scoped==='default'?settings.defaultEnv:settings.profiles.get(scoped)?.env)||{}).ANTHROPIC_API_KEY;
    const anthropicStatus=()=>credentialFor('anthropic')?{logged_in:true,source:'hermes_pkce',token_preview:credentialFor('anthropic').slice(-6)}
     :envKey?{logged_in:true,source:'env_var',source_label:'ANTHROPIC_API_KEY',token_preview:envKey.slice(-6)}:{logged_in:false,source:null,token_preview:null};
    if(!provider&&request.method==='GET') return send(response,200,{providers:[
     {id:'openai-codex',name:'ChatGPT or Codex Subscription',flow:'device_code',status:{logged_in:Boolean(credentialFor('openai-codex')),token_preview:credentialFor('openai-codex')?.slice(-6)||null}},
     {id:'anthropic',name:'Anthropic Account',flow:'external',cli_command:'hermes auth add anthropic',status:anthropicStatus()}]});
    if(!['openai-codex','anthropic'].includes(provider)) return send(response,400,{detail:`Unknown provider ${provider}`});
    if(step==='start'&&request.method==='POST') {
     if(provider==='anthropic') return send(response,400,{detail:'anthropic uses an external CLI; run `hermes auth add anthropic` manually'});
     const id=randomUUID().replaceAll('-','');
     settings.signInSessions.set(id,{provider,profile:scoped,status:'pending'});
     return send(response,200,{session_id:id,flow:'device_code',user_code:'ABCD-1234',verification_url:'https://auth.provider.test/codex/device',expires_in:900,poll_interval:5});
    }
    if(step==='poll'&&request.method==='GET') {
     const found=settings.signInSessions.get(session);
     if(!found) return send(response,404,{detail:'Session not found or expired'});
     if(found.profile!==scoped) return send(response,400,{detail:'OAuth session profile mismatch'});
     return send(response,200,{session_id:session,status:found.status,error_message:found.status==='error'?'secret detail':null});
    }
    // clear_provider_auth clears the scoped profile's own store only, and nothing there is a 409 (oauth.py 774-815).
    if(!step&&request.method==='DELETE') {
     // A Claude status read from a key is refused before anything is cleared (oauth.py 659-672, 775-785); otherwise the
     // sign-in file and the provider's whole pool section in the scoped store go (clear_provider_auth).
     if(provider==='anthropic'&&anthropicStatus().source==='env_var') return send(response,400,{detail:'Anthropic Account cannot be disconnected automatically. Remove the API key from Settings → Keys instead.'});
     if(scoped==='default'&&settings.defaultPool[provider]?.length) { delete settings.defaultPool[provider]; delete home.credentials[provider]; return send(response,200,{ok:true,provider}); }
     if(!home.credentials[provider]) return send(response,409,{detail:`No stored credentials were removed for ${provider==='anthropic'?'Anthropic Account':'ChatGPT or Codex Subscription'}.`});
     delete home.credentials[provider]; return send(response,200,{ok:true,provider});
    }
   }
   // A profile's Routines (#31, hermes_cli/web_routers/cron.py 735-806): every route takes ?profile=, and a job's own
   // routes act on whichever profile holds it, the hint only preferred, as the pinned release does.
   if(url.pathname==='/api/cron/jobs'&&request.method==='GET') {
    const named=url.searchParams.get('profile')||'all';
    if(named!=='all'&&!profileOf(named)) return send(response,404,{detail:`Profile '${named}' does not exist.`});
    return send(response,200,named==='all'?[...settings.cron].flatMap(([name,jobs])=>jobs.map(job=>annotated(job,name))):cronStore(named).map(job=>annotated(job,named)));
   }
   if(url.pathname==='/api/cron/jobs'&&request.method==='POST') {
    const named=url.searchParams.get('profile')||'default';
    if(!profileOf(named)) return send(response,404,{detail:`Profile '${named}' does not exist.`});
    if(typeof body?.schedule!=='string') return send(response,422,{detail:'schedule'});
    if(!String(body.prompt||'').trim()) return send(response,400,{detail:'A prompt, skill or script is required.'});
    let job; try { job=cronJob({name:body.name,prompt:body.prompt,schedule:body.schedule,timezone:body.timezone,paused:body.paused===true}); } catch(failure) { return send(response,400,{detail:failure.message}); }
    cronStore(named).push(job);
    // A create whose answer is lost after the job was made (loseCronCreates of them): the connection closes unanswered.
    if(settings.loseCronCreates>0) { settings.loseCronCreates--; request.socket.destroy(); return; }
    return send(response,200,annotated(job,named));
   }
   const cronPath=url.pathname.match(/^\/api\/cron\/jobs\/([^/]+)(?:\/(pause|resume|trigger|runs))?$/);
   if(cronPath) {
    const owner=cronOwner(decodeURIComponent(cronPath[1]),url.searchParams.get('profile'));
    if(!owner) return send(response,404,{detail:'Job not found'});
    const jobs=cronStore(owner); const job=jobs.find(found=>found.id===decodeURIComponent(cronPath[1]));
    if(!cronPath[2]&&request.method==='GET') return send(response,200,annotated(job,owner));
    // The job's run history, newest first (_list_cron_job_runs_sync): one row per cron session. A session the test marks
    // `active` is a run still going: no end, listed as active (#699).
    if(cronPath[2]==='runs'&&request.method==='GET') {
     const limit=Math.max(1,Math.min(Number(url.searchParams.get('limit')??20),100));
     const runs=[...settings.sessions].filter(([id,found])=>found.profile===owner&&id.startsWith(`cron_${job.id}_`)).map(([id,found])=>({id,source:'cron',started_at:found.started_at??0,ended_at:found.active?null:found.ended_at??found.started_at??0,is_active:found.active===true,title:job.name,profile:owner}))
      .sort((a,b)=>b.started_at-a.started_at).slice(0,Math.min(limit,settings.cronRunsAtMost));
     return send(response,200,{runs,limit});
    }
    if(!cronPath[2]&&request.method==='DELETE') { jobs.splice(jobs.indexOf(job),1); return send(response,200,{ok:true}); }
    if(!cronPath[2]&&request.method==='PUT') {
     const updates=body?.updates; if(!updates||typeof updates!=='object') return send(response,422,{detail:'updates'});
     if('schedule' in updates) { const parsed=parseCron(updates.schedule); if(!parsed) return send(response,400,{detail:`Invalid schedule '${updates.schedule}'`}); job.schedule=parsed; job.schedule_display=parsed.display; if(job.state!=='paused') job.next_run_at=nextRun(); }
     for(const key of ['name','prompt','timezone']) if(typeof updates[key]==='string') job[key]=updates[key];
     return send(response,200,annotated(job,owner));
    }
    if(request.method==='POST'&&cronPath[2]==='pause') { Object.assign(job,{enabled:false,state:'paused',paused_at:new Date().toISOString(),next_run_at:null}); return send(response,200,annotated(job,owner)); }
    if(request.method==='POST'&&cronPath[2]==='resume') { Object.assign(job,{enabled:true,state:'scheduled',paused_at:null,paused_reason:null,next_run_at:nextRun()}); return send(response,200,annotated(job,owner)); }
    // A paused job run now is resumed and claimed at once (_trigger_cron_job_sync's force).
    if(request.method==='POST'&&cronPath[2]==='trigger') {
     const started=Date.now()/1000;
     settings.sessions.set(`cron_${job.id}_${Math.round(started*1000)}`,{profile:owner,started_at:started,ended_at:started+0.01,messages:[{role:'user',content:job.prompt,timestamp:started},...(settings.cronOutcome==='ok'?[{role:'assistant',content:typeof settings.cronReply==='function'?settings.cronReply(job):settings.cronReply,timestamp:started+0.005}]:[])]});
     Object.assign(job,{enabled:true,state:'scheduled',paused_at:null,last_run_at:new Date(started*1000).toISOString(),last_status:settings.cronOutcome,last_error:settings.cronOutcome==='error'?'The model did not answer.':null,next_run_at:job.next_run_at||nextRun()});
     return send(response,200,annotated(job,owner));
    }
   }
   send(response,404,{detail:'Not Found'});
  });
 };
 // `sessionDelay` holds a session's read that long (#766), and Infinity never answers it, as a busy Engine does.
 const management=createServer((request,response)=>{
  if(dashboardAnswer(settings,request,response)) return;
  // What the management listener was asked (#782), as `requests` keeps the API listener's.
  settings.managed.push({method:request.method,path:request.url});
  // `managedFail` answers a request it names with that status (#782): one profile's read failing while the rest answer.
  const failing=settings.managedFail?.(request.method||'GET',request.url||'');
  if(failing) return send(response,failing,{detail:'Internal Server Error'});
  // `managedDelay` holds a request it names that many milliseconds (#791): one part of a screen slow while the rest answer.
  const held=settings.managedDelay?.(request.method||'GET',request.url||'');
  if(held) { setTimeout(()=>manage(request,response),held); return; }
  if(settings.sessionDelay>0&&request.method==='GET'&&/^\/api\/sessions\/[^/]+\/messages(\?|$)/.test(request.url||'')) { if(Number.isFinite(settings.sessionDelay)) setTimeout(()=>manage(request,response),settings.sessionDelay); return; }
  // `memoryDelay` holds a memory read that long (#769), Infinity for ever; `memoryAtOnce` is the most memory reads it held at once.
  if(settings.memoryDelay>0&&request.method==='GET'&&/^\/api\/learning\/(graph|node)(\?|$)/.test(request.url||'')) {
   settings.memoryInFlight++; settings.memoryAtOnce=Math.max(settings.memoryAtOnce,settings.memoryInFlight);
   response.on('close',()=>{ settings.memoryInFlight--; });
   if(Number.isFinite(settings.memoryDelay)) setTimeout(()=>manage(request,response),settings.memoryDelay); return;
  }
  manage(request,response);
 });
 // The management listener's JSON-RPC socket (#712; tui_gateway/ws.py, methods_display.py), opened with the session
 // token as `?token=` (web_server_chat.py): newline-free JSON frames, the gateway.ready event first, and the display
 // methods the Screen uses, each naming its profile. A profile the Engine does not have is refused with 4064 before
 // the method runs; a display failure is 5300 with the Engine's English reason.
 const sockets=new WebSocketServer({noServer:true});
 management.on('upgrade',(request,socket,head)=>{
  const url=new URL(request.url||'/','http://management');
  // The dashboard's sockets (#869, #870), each opened with a ticket the dashboard minted, used once.
  if(['/api/ws','/api/pty','/api/plugins/kanban/events'].includes(url.pathname)&&settings.dashboardTickets.delete(url.searchParams.get('ticket')??'')) {
   settings.dashboardRequests.push({method:'GET',path:request.url||'/',authorization:request.headers.authorization,cookie:request.headers.cookie,prefix:String(request.headers['x-forwarded-prefix']??'')});
   sockets.handleUpgrade(request,socket,head,ws=>{
    const live=Object.assign(ws,{path:url.pathname});
    settings.dashboardSockets.add(live); ws.on('close',()=>settings.dashboardSockets.delete(live));
    if(url.pathname==='/api/ws') ws.send(JSON.stringify({type:'gateway.ready'}));
    else if(url.pathname==='/api/pty') ws.send('\x1b[1mHermes\x1b[0m > ');
   });
   return;
  }
  if(url.pathname==='/api/display/ws') { sockets.handleUpgrade(request,socket,head,ws=>displayStream(ws,url.searchParams.get('display_ticket')??'')); return; }
  if(url.pathname!=='/api/ws'||url.searchParams.get('token')!==settings.key) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
  sockets.handleUpgrade(request,socket,head,ws=>{
   // The viewer ids display.observe minted on this connection: acquire and release take only those (methods_display.py
   // _foreign_viewer_id), so an id read off the wire or minted for another connection is refused.
   const minted=new Set();
   ws.send(JSON.stringify({jsonrpc:'2.0',method:'event',params:{type:'gateway.ready',payload:{heartbeat:true}}}));
   ws.on('message',async raw=>{
    let call; try { call=JSON.parse(String(raw)); } catch { return; }
    const params=call?.params&&typeof call.params==='object'?call.params:{};
    settings.screenCalls.push({method:call.method,params,token:url.searchParams.get('token')});
    const ok=result=>ws.send(JSON.stringify({jsonrpc:'2.0',id:call.id,result}));
    const fail=(code,message)=>ws.send(JSON.stringify({jsonrpc:'2.0',id:call.id,error:{code,message}}));
    const name=typeof params.profile==='string'?params.profile:'';
    if(!settings.profiles.has(name)) return fail(4064,`Profile '${name}' does not exist.`);
    const screen=settings.screens.get(name)??{}; settings.screens.set(name,screen);
    const status=()=>({profile:name,supported:screen.supported!==false,installed:!screen.missing?.length,missing:screen.missing??[],running:screen.running===true,pid:null,
     display:screen.running?':20':null,socket:null,geometry:'1440x900',install_command:null,browser:null,blocker:screen.missing?.length?`missing: ${screen.missing.join(', ')}`:null,
     memory_available_mb:null,memory_limit_mb:null,placement:'terminal:ssh',image_switch:null,
     lease:lease(),profile_key:`/opt/data/profiles/${name}`});
    // The lease as the Engine shows it (tools/bot_desktop/lease.py public_view): the holder's viewer id only as its hash.
    function lease() { return {holder:screen.holder??'agent',viewer_id:null,viewer_hash:screen.holder==='human'?viewerHash(screen.viewer??'0123456789ab'):null,since:0,epoch:0,reason:null}; }
    const foreign=()=>{ if(minted.has(String(params.viewer_id??''))) return false; fail(5300,'viewer_id was not minted for this connection; call display.observe first'); return true; };
    if(call.method==='display.status') return ok(status());
    if(call.method==='display.start') {
     if(settings.screenStartDelay) await new Promise(resolve=>setTimeout(resolve,settings.screenStartDelay));
     if(screen.missing?.length) return fail(5300,`bot desktop needs ${screen.missing.join(', ')} in the sandbox`);
     if([...settings.screens].some(([other,held])=>other!==name&&held.running)) return fail(5300,'sandbox desktop did not publish its display within 20s:\nXvnc exited during startup');
     screen.running=true;
     return ok(status());
    }
    if(call.method==='display.thumbnail') {
     if(screen.holder==='human') return ok({data_url:null,suppressed:'human_has_control'});
     if(!screen.running) return ok({data_url:null});
     return ok({data_url:settings.screenPictureUrl??`data:image/jpeg;base64,${screenFrame(++settings.screenGrabs).toString('base64')}`});
    }
    if(call.method==='display.observe') {
     if(!screen.running) return fail(5300,'this profile\'s Bot Desktop is not running; call display.start first');
     const viewer=randomUUID().replaceAll('-',''); minted.add(viewer);
     const ticket=randomUUID();
     settings.screenTickets.set(ticket,{profile:name,viewer,expires:Date.now()+30000});
     return ok({ticket,path:'/api/display/ws',viewer_id:viewer,...status()});
    }
    // Last writer wins (lease.acquire): the Engine itself never refuses a take while another viewer holds.
    if(call.method==='display.lease.acquire') {
     if(foreign()) return;
     screen.holder='human'; screen.viewer=String(params.viewer_id);
     return ok({lease:lease()});
    }
    // A release by a viewer that does not hold is ignored; one with no viewer and `force` releases whoever holds.
    if(call.method==='display.lease.release') {
     if(params.viewer_id===undefined||params.viewer_id===null) {
      if(screen.holder==='human'&&!params.force) return fail(5300,'viewer_id required to release another viewer\'s lease (or pass force: true)');
      screen.holder='agent'; screen.viewer=null; return ok({lease:lease()});
     }
     if(foreign()) return;
     if(screen.holder==='human'&&screen.viewer===params.viewer_id) { screen.holder='agent'; screen.viewer=null; }
     return ok({lease:lease()});
    }
    fail(-32601,`unknown method: ${call.method}`);
   });
  });
 });
 // The live stream of a Screen (hermes_cli/web_routers/display.py): accepted, then closed with 4401 unless it brings a
 // ticket display.observe minted, unused and under 30 seconds old; with one, raw RFB 3.8 as binary frames from a Screen
 // of 64 by 40 with no password, which answers each full request with one plain picture. Keyboard and pointer messages
 // reach the Screen only from the viewer that holds its lease; the stream also ends when its Screen stops.
 function displayStream(ws,ticket) {
  const held=settings.screenTickets.get(ticket); settings.screenTickets.delete(ticket);
  if(!held||held.expires<Date.now()) { ws.close(4401,'display ticket missing, expired or used'); return; }
  // Read afresh each time: a test may put a new state in place for the profile.
  const screen=()=>settings.screens.get(held.profile)??{};
  if(!screen().running) { ws.close(4001,'Bot Desktop is not running'); return; }
  settings.screenStreams++;
  // The stream ends with its Screen: the Engine's bridge reads the end of Xvnc's socket and closes the viewer's.
  const watch=setInterval(()=>{ if(!screen().running) ws.close(4001,'Bot Desktop is not running'); },200);
  ws.on('close',()=>{ settings.screenStreams--; clearInterval(watch); });
  const width=64, height=40;
  let stage='version', buffer=Buffer.alloc(0);
  const u16=n=>{ const b=Buffer.alloc(2); b.writeUInt16BE(n); return b; }; const u32=n=>{ const b=Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  ws.send(Buffer.from('RFB 003.008\n'));
  const allowed=()=>screen().holder==='human'&&screen().viewer===held.viewer;
  const lengths={0:20,3:10,4:8,5:6};
  ws.on('message',(data,binary)=>{
   if(!binary) { ws.close(1003,'RFB is binary'); return; }
   buffer=Buffer.concat([buffer,Buffer.from(/** @type {Buffer} */(data))]);
   for(;;) {
    if(stage==='version') { if(buffer.length<12) return; buffer=buffer.subarray(12); stage='security'; ws.send(Buffer.from([1,1])); continue; }
    if(stage==='security') { if(buffer.length<1) return; buffer=buffer.subarray(1); stage='init'; ws.send(u32(0)); continue; }
    if(stage==='init') {
     if(buffer.length<1) return; buffer=buffer.subarray(1); stage='ready';
     const name=Buffer.from(`${held.profile}`);
     ws.send(Buffer.concat([u16(width),u16(height),Buffer.from([32,24,0,1]),u16(255),u16(255),u16(255),Buffer.from([16,8,0,0,0,0]),u32(name.length),name]));
     continue;
    }
    if(!buffer.length) return;
    const type=buffer[0];
    let size=lengths[type];
    if(type===2) { if(buffer.length<4) return; size=4+4*buffer.readUInt16BE(2); }
    else if(type===6) { if(buffer.length<8) return; size=8+buffer.readUInt32BE(4); }
    else if(size===undefined) { ws.close(1003,`unknown RFB message ${type}`); return; }
    if(buffer.length<size) return;
    const message=buffer.subarray(0,size); buffer=buffer.subarray(size);
    if(type===3&&message[1]===0) ws.send(Buffer.concat([Buffer.from([0,0]),u16(1),u16(0),u16(0),u16(width),u16(height),u32(0),Buffer.alloc(width*height*4,0x80)]));
    if(type===4&&allowed()) settings.screenInputs.push({profile:held.profile,viewer:held.viewer,kind:'key',down:message[1]===1,key:message.readUInt32BE(4)});
    if(type===5&&allowed()) settings.screenInputs.push({profile:held.profile,viewer:held.viewer,kind:'pointer',mask:message[1],x:message.readUInt16BE(2),y:message.readUInt16BE(4)});
   }
  });
 }
 await new Promise(resolve=>server.listen(port,host,resolve));
 await new Promise(resolve=>management.listen(managementPort,host,resolve));
 const closing=listener=>new Promise(resolve=>{listener.close(resolve);listener.closeAllConnections();});
 return {settings,address:`http://${host}:${server.address().port}`,managementAddress:`http://${host}:${management.address().port}`,close:()=>{ for(const ws of sockets.clients) ws.terminate(); return Promise.all([closing(server),closing(management)]).then(()=>{}); }};
}
