import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
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
 const settings={version:'0.23.0',status:200,key:'test-only-key',features:{run_submission:true,run_events_sse:true},requests:/** @type {{method?:string,path?:string,authorization?:string,session?:string,idempotency?:string}[]} */([]),runs:/** @type {{id:string,key?:string,session?:string,input:string,instructions?:string,history?:{role:string,content:string}[],body?:string,reads:number,stopped?:boolean,asked:{prompt_id:string,question:string,choices:string[],multi_select:boolean,answer?:string,settled:'answered'|'expired'|null}[],approvals:{request_id:string,description:string,command:string,choices:string[],choice?:string,settled:'answered'|'expired'|null}[]}[]} */([]),pendingReads:0,loseStarts:0,stallEvents:false,reply:input=>`Reply to: ${input}`,
  // How a finished run ends and the usage it reports; a run cleared from runs is one Hermes lost (404).
  // A run first asks the questions `questions` gives for its input (clarify, #138), one at a time, as the pinned release
  // does: it stays running with the question in pending_controls until it is answered on the run's clarify route,
  // expires (expire(run), Hermes's clarify_timeout) or the run is stopped. The reply is given the answers. `answers`
  // keeps every clarify request's status and body.
  questions:/** @type {(input:string)=>{question:string,choices?:string[],multi_select?:boolean}[]} */(()=>[]),
  answers:/** @type {{run:string,status:number,body:any}[]} */([]),
  expire(run) { const waiting=settings.runs.find(found=>found.id===run)?.asked.find(asked=>!asked.settled); if(waiting) waiting.settled='expired'; return !!waiting; },
  // After its questions a run stops to ask before each action `approvals` gives for its input (#163), one at a time, as
  // the pinned release does (api_server_runs.py _make_approval_notify): its status is waiting_for_approval with the
  // request in `approval` until it is answered on the run's approval route, times out (expireApproval(run), the
  // profile's approvals.timeout) or the run is stopped. The reply is given each request's choice, null for one that timed
  // out.
  approvals:/** @type {(input:string)=>{description:string,command:string,choices?:string[]}[]} */(()=>[]),
  // `permits` keeps every approval request's status and body; with `flatPermitErrors` the route answers a refusal's code
  // at the top of its body instead of under `error`.
  permits:/** @type {{run:string,status:number,body:any}[]} */([]),flatPermitErrors:false,
  expireApproval(run) { const waiting=settings.runs.find(found=>found.id===run)?.approvals.find(asking=>!asking.settled); if(waiting) waiting.settled='expired'; return !!waiting; },
  ending:'completed',usage:/** @type {object|undefined} */({input_tokens:14000,output_tokens:12}),
  // The management listener (Hermes's dashboard, a second port): its profiles, and the status it answers with when
  // not 200. A profile made through it has its own Run API key, none until /api/env sets it, as in the pinned release.
  managementStatus:200,profiles:/** @type {Map<string,{soul:string,provider:string,model:string,key:string|null,config:any,credentials:Record<string,string>,display_name?:string|null,description?:string,description_auto?:boolean,bot_title?:string|null,env?:Record<string,string>}>} */(new Map()),failStep:/** @type {''|'model'|'env'|'config'} */(''),
  managementRequests:/** @type {{method?:string,path?:string,authorization?:string,body:any}[]} */([]),
  // The default profile's config and model sign-ins (a profile made through the listener keeps its own), and the
  // sign-in sessions Hermes runs: approve(session) finishes one as the person would in their browser. The Engine's own
  // config defaults and schema are what its config routes serve (#125); configWriteFail is a profile whose next config
  // write answers 500, as a profile home that cannot be written does.
  defaultConfig:/** @type {any} */({}),defaultCredentials:/** @type {Record<string,string>} */({}),
  configDefaults:/** @type {any} */({}),configSchema:/** @type {{fields:Record<string,any>,category_order:string[]}} */({fields:{},category_order:[]}),
  configWriteFail:/** @type {Set<string>} */(new Set()),
  signInSessions:/** @type {Map<string,{provider:string,profile:string,status:string}>} */(new Map()),
  // Ignore the disabled list when reporting toolsets, as a Hermes that did not apply it would.
  ignoreDisabled:false,staleConfig:false,
  // Profiles the Run API answers 404 for, as Hermes does for one it does not serve; a removed profile joins them.
  unknownProfiles:/** @type {string[]} */([]),
  // The root profile's model block, which a new profile copies (hermes_cli/profiles.py, _seed_model_config); none
  // leaves a new profile with no model. A removal whose identity settlement stays pending still answers ok.
  seedModel:/** @type {{provider:string,model:string}|null} */(null),settlementPending:false,
  // The MCP catalogue the pinned release ships (optional-mcps/), the tools each app's server offers, the apps whose
  // server does not answer, and the OAuth sign-ins of apps (hermes_cli/web_routers/mcp.py): a sign-in's token stays on
  // disk when its server is removed, as in the pinned release. approveApps:false keeps a delivered sign-in waiting.
  catalog:['klaviyo','canva','notion','airtable','webflow','wordpress-com','amplitude','mixpanel','attio','close','calendly','figma','gamma','intercom'],
  appTools:/** @type {Record<string,string[]>} */({}),appsUnreachable:/** @type {Set<string>} */(new Set()),appTokens:/** @type {Set<string>} */(new Set()),approveApps:true,
  appFlows:/** @type {Map<string,{server:string,profile:string,status:string,state:string,redirect:string}>} */(new Map()),appCallbacks:/** @type {string[]} */([]),
  // Each profile's own Skills by name (their SKILL.md text), and the Skills each profile locked, as `profile:name`.
  skills:/** @type {Map<string,Map<string,string>>} */(new Map()),skillLocks:/** @type {Set<string>} */(new Set()),skillsOff:/** @type {Set<string>} */(new Set()),
  // The provenance `GET /api/skills` reports for a profile's own Skill (`hub`, `bundled` or `agent`), as `profile:name`;
  // the shared folder's are always external. The Skills a profile learned on its own, whose learning graph node says
  // `createdBy:"agent"` (#180).
  skillProvenance:/** @type {Map<string,string>} */(new Map()),learnedSkills:/** @type {Map<string,Set<string>>} */(new Map()),
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
  modelNeedsKey:false,
  // Models a Run may not run on (#158): a Run naming one is answered 400 before it is made, as the pinned release answers a
  // provider or model it cannot resolve (api_server_runs.py 803-809).
  refusedModels:/** @type {Set<string>} */(new Set()),defaultEnv:/** @type {Record<string,string>} */({}),modelOptionsFail:false,envFail:/** @type {Set<string>} */(new Set()),envReadFail:/** @type {Set<string>} */(new Set()),envDropped:/** @type {Set<string>} */(new Set()),envHang:/** @type {Set<string>} */(new Set()),
  // A run's events (#141): `emit` adds one (tool.started, tool.completed, message.delta and the like) to its stream,
  // `forget` drops its oldest ones as the 1,000-event backlog does, `sweep` drops its whole stream as Hermes does five
  // minutes after the start when nobody reads it. A run reports `runSeconds` from its start to its end. `stallEvents`
  // makes the events route take a request and never answer it, as a stalled Hermes or proxy does.
  emit(/** @type {string} */ run,/** @type {any} */ event) { push(run,event); },
  forget(/** @type {string} */ run,/** @type {number} */ count) { streams.get(run)?.backlog.splice(0,count); },
  sweep(/** @type {string} */ run) { const stream=streams.get(run); streams.delete(run); for(const reader of stream?.readers||[]) reader.end(); },
  backlogLimit:1000,runSeconds:41,
  // Sessions by id (#346): the profile each belongs to and its messages as the listener returns them
  // (hermes_cli/web_routers/sessions.py get_session_messages), oldest first: role, content, tool_calls, tool_call_id,
  // tool_name and timestamp; and (#347) the session's token use as its detail reports it (get_session_detail), with the
  // time it started in seconds, which the profile's usage analytics count from, and the model it ran on (#32), which
  // the analytics group into by_model.
  sessions:/** @type {Map<string,{profile:string,messages:any[],input_tokens?:unknown,output_tokens?:unknown,model?:string,started_at?:number}>} */(new Map()),
  approve(session) { const found=settings.signInSessions.get(session); if(!found) return; found.status='approved'; credentialsOf(found.profile)[found.provider]=`codex-token-${randomUUID()}`; }};
 const profileOf=name=>name==='default'?{config:settings.defaultConfig,credentials:settings.defaultCredentials}:settings.profiles.get(name);
 const credentialsOf=name=>profileOf(name)?.credentials||{};
 // The toolsets the pinned release lets an api_server Run use when its profile names none (hermes-api-server).
 const defaultToolsets=['web','browser','terminal','file','code_execution','vision','image_gen','skills','todo','memory','session_search','delegation','cronjob','connections'];
 const configurable=['web','browser','terminal','file','code_execution','vision','video','image_gen','video_gen','x_search','tts','skills','todo','kanban','memory','session_search','connections','clarify','delegation','cronjob','computer_use'];
 const enabledToolsets=config=>{
  const listed=Array.isArray(config?.platform_toolsets?.api_server)?config.platform_toolsets.api_server:defaultToolsets;
  const disabled=settings.ignoreDisabled?[]:config?.agent?.disabled_toolsets||[];
  return configurable.filter(name=>listed.includes(name)&&!disabled.includes(name));
 };
 const merge=(base,over)=>{ const out={...base}; for(const [key,value] of Object.entries(over||{})) out[key]=value&&typeof value==='object'&&!Array.isArray(value)&&base?.[key]&&typeof base[key]==='object'?merge(base[key],value):value; return out; };
 // The description and category a SKILL.md's front matter gives it, as the Engine lists them.
 const skillHeader=content=>{
  const header=/^---\r?\n([\s\S]*?)\r?\n---/.exec(content||'')?.[1]||'';
  const field=name=>(new RegExp(`(?:^|\\n)${name}:[ \\t]*["']?([^\\n"']*)["']?[ \\t]*(?:\\r?\\n|$)`).exec(header)?.[1]||'').trim();
  return {description:field('description'),category:field('category')||null};
 };
 const send=(response,code,body)=>{response.writeHead(code,{'Content-Type':'application/json',Location:'/must-not-follow'});response.end(JSON.stringify(body));};
 const server=createServer((request,response)=>{
  let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',()=>{
   settings.requests.push({method:request.method,path:request.url,authorization:request.headers.authorization,session:request.headers['x-hermes-session-key'],idempotency:request.headers['idempotency-key']});
   const managed=settings.profiles.get(decodeURIComponent(request.url.match(/^\/p\/([^/]+)\//)?.[1]||''));
   const key=managed?managed.key:settings.key;
   const status=key&&request.headers.authorization===`Bearer ${key}`?settings.status:401;
   if(managed&&status===401) return send(response,401,{error:{message:request.headers.authorization,code:'gateway_auth_failed'}});
   if(status!==200) return send(response,status,{error:{message:request.headers.authorization}});
   const toolsetsPath=request.url.match(/^\/p\/([^/]+)\/v1\/toolsets$/);
   if(toolsetsPath&&!profileOf(decodeURIComponent(toolsetsPath[1]))&&settings.unknownProfiles.includes(decodeURIComponent(toolsetsPath[1]))) return send(response,404,{error:'Unknown or unconfigured profile'});
   if(toolsetsPath) { const enabled=enabledToolsets(profileOf(decodeURIComponent(toolsetsPath[1]))?.config); return send(response,200,{object:'list',platform:'api_server',data:configurable.map(name=>({name,enabled:enabled.includes(name)}))}); }
   const runPath=request.url.match(/^\/p\/[^/]+\/v1\/runs(?:\/([^/]+))?$/);
   if(runPath&&request.method==='POST'&&!runPath[1]) {
    const key=request.headers['idempotency-key'];
    let run=settings.runs.find(run=>key&&run.key===key);
    // As the pinned release does (api_server_runs.py, run idempotency): the same key with another body is a conflict.
    if(run&&run.body!==raw) return send(response,409,{error:{message:'Idempotency-Key reused with a different request',code:'idempotency_conflict'}});
    if(!run) {
     const sent=JSON.parse(raw);
     if(settings.refusedModels.has(sent.model)) return send(response,400,{error:{message:`Model '${sent.model}' is not available`,type:'invalid_request_error'}});
     const asked=settings.questions(sent.input).map(each=>({prompt_id:randomUUID().replaceAll('-','').slice(0,10),question:each.question,choices:each.choices??[],multi_select:each.multi_select===true,settled:null}));
     const approvals=settings.approvals(sent.input).map(each=>({request_id:randomUUID().replaceAll('-',''),description:each.description,command:each.command,choices:each.choices??['once','session','always','deny'],settled:null}));
     run={id:`run_${instance}_${settings.runs.length+1}`,key,session:request.headers['x-hermes-session-key'],input:sent.input,instructions:sent.instructions,history:sent.conversation_history,body:raw,reads:0,asked,approvals,created:Date.now()/1000}; settings.runs.push(run);
     streams.set(run.id,{backlog:[],next:0,ended:false,readers:new Set()});
    }
    // A start whose answer is lost: the run exists, but the connection closes before any answer (loseStarts of them).
    if(settings.loseStarts>0) { settings.loseStarts--; request.socket.destroy(); return; }
    return send(response,202,{run_id:run.id,status:'started',replayed:run.reads>0});
   }
   if(runPath&&request.method==='GET') {
    const run=settings.runs.find(run=>run.id===runPath[1]);
    if(!run) return send(response,404,{error:{message:`Run not found: ${runPath[1]}`,code:'run_not_found'}});
    // As measured on the pinned release (#141, the install check): a Run's record has when it was made and nothing of when
    // it ended; its end is in its events.
    const times={created_at:run.created};
    if(run.stopped) { endEvents(run.id,'run.cancelled'); return send(response,200,{object:'hermes.run',run_id:run.id,status:'cancelled',session_id:run.session,pending_controls:[],...times}); }
    // As measured on the pinned release: the skip hint is appended to the question, and the first of two or more
    // choices is marked recommended.
    const waiting=run.asked?.find(asked=>!asked.settled);
    if(waiting) return send(response,200,{object:'hermes.run',run_id:run.id,status:'running',session_id:run.session,pending_controls:[{kind:'clarify',prompt_id:waiting.prompt_id,execution_generation:1,
     question:`${waiting.question}\nReply "skip" to skip this question.`,choices:waiting.choices.map((choice,index)=>index===0&&waiting.choices.length>=2?`${choice} (Recommended)`:choice),multi_select:waiting.multi_select}]});
    // The request as the pinned release sends it (api_server.py _approval_request_event): its words, the envelope, the
    // choices it takes back.
    const asking=run.approvals?.find(each=>!each.settled);
    if(asking) return send(response,200,{object:'hermes.run',run_id:run.id,status:'waiting_for_approval',session_id:run.session,last_event:'approval.request',...times,pending_controls:[],
     approval:{command:asking.command,description:asking.description,pattern_key:'recursive delete',pattern_keys:['recursive delete'],request_id:asking.request_id,timeout_s:300,
      event:'approval.request',run_id:run.id,timestamp:Date.now()/1000,choices:asking.choices}});
    const done=run.reads++>=settings.pendingReads;
    if(done) endEvents(run.id,settings.ending==='completed'?'run.completed':'run.failed');
    return send(response,200,{object:'hermes.run',run_id:run.id,status:done?settings.ending:'running',session_id:run.session,...times,...(done&&settings.ending==='completed'?{output:settings.reply(run.input,(run.asked||[]).map(asked=>asked.answer??null),(run.approvals||[]).map(asking=>asking.choice??null))}:{}),...(done&&settings.usage?{usage:settings.usage}:{}),pending_controls:[]});
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
 const management=createServer((request,response)=>{
  let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',()=>{
   let body=null; try { body=raw?JSON.parse(raw):null; } catch { body=null; }
   settings.managementRequests.push({method:request.method,path:request.url,authorization:request.headers.authorization,body});
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
   // A session answers only under its own profile; a page holds at most 500 messages, from `offset`.
   const sessionMessages=url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
   if(sessionMessages&&request.method==='GET') {
    const id=decodeURIComponent(sessionMessages[1]); const found=settings.sessions.get(id);
    if(!found||found.profile!==(url.searchParams.get('profile')||'default')) return send(response,404,{detail:'Session not found'});
    const limit=Math.min(Number(url.searchParams.get('limit')??500),500); const offset=Number(url.searchParams.get('offset')??0);
    const page=found.messages.slice(offset,offset+limit);
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
    if(settings.failStep==='model') return send(response,500,{detail:'Internal Server Error'});
    // _write_profile_model checks a pick against the profile's own keys (profiles.py 124-150); modelNeedsKey turns it on.
    const keyed=settings.envRows.find(row=>row.primary&&row.provider===body?.provider);
    if(settings.modelNeedsKey&&keyed&&!profile.env?.[keyed.env]) return send(response,400,{detail:`No credentials for ${body.provider} in this profile`});
    Object.assign(profile,{provider:body.provider,model:body.model});
    return send(response,200,{ok:true,provider:body.provider,model:body.model});
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
   // What a profile learned on its own (#180; hermes_cli/web_routers/status.py 746, agent/learning_graph.py 218-245):
   // skill nodes whose `createdBy` is "agent", beside memory nodes. Only the names and who wrote them matter here.
   if(url.pathname==='/api/learning/graph'&&request.method==='GET') {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    const learned=[...(settings.learnedSkills.get(scoped)||[])];
    return send(response,200,{nodes:[...learned.map(name=>({id:name,label:name,kind:'skill',createdBy:'agent'})),
     {id:'memory-1',label:'A memory',kind:'memory',createdBy:'memory'}],edges:[],clusters:[],memory:[]});
   }
   // The model providers a profile is signed in to (hermes_cli/web_routers/models.py, get_model_options): a profile with
   // no credential of its own uses the root profile's, and its current provider without one is listed unauthenticated.
   if(url.pathname==='/api/model/options'&&request.method==='GET') {
    if(settings.modelOptionsFail) return send(response,503,{detail:'busy'});
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    const own=settings.profiles.get(scoped)||{provider:'auto',model:''};
    const signedIn=['openai-codex','anthropic'].filter(id=>home.credentials[id]||settings.defaultCredentials[id]);
    const providers=signedIn.map(slug=>({slug,name:slug,is_current:slug===own.provider,models:own.provider===slug&&own.model?[own.model]:[],source:'authenticated'}));
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
    return send(response,200,{entries:settings.catalog.map(name=>({name,description:'',transport:'http',auth_type:'oauth',url:`https://mcp.${name}.example/mcp`,default_enabled:null,installed:Boolean(servers[name]),enabled:Boolean(servers[name])&&servers[name].enabled!==false})),diagnostics:[]});
   }
   if(url.pathname==='/api/mcp/catalog/install'&&request.method==='POST') {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    if(!settings.catalog.includes(body?.name)) return send(response,404,{detail:`No catalog entry '${body?.name}'`});
    // As Hermes leaves an OAuth entry it cannot probe yet: no tool filter, every tool on once signed in.
    keepServers({...servers,[body.name]:{url:`https://mcp.${body.name}.example/mcp`,auth:'oauth',enabled:body.enable!==false}});
    return send(response,200,{ok:true,name:body.name,background:false});
   }
   const server=url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)(?:\/(test|auth))?$/);
   if(server) {
    const name=decodeURIComponent(server[1]);
    if(!home||!servers[name]) return send(response,404,{detail:`Server '${name}' not found`});
    if(!server[2]&&request.method==='DELETE') { const rest={...servers}; delete rest[name]; keepServers(rest); return send(response,200,{ok:true}); }
    if(server[2]==='test'&&request.method==='POST') {
     if(settings.appsUnreachable.has(name)) return send(response,200,{ok:false,error:'Connection failed: /opt/data/mcp-tokens secret detail',tools:[]});
     if(!settings.appTokens.has(`${scoped}:${name}`)) return send(response,200,{ok:false,error:'OAuth authentication required — no token found.',tools:[]});
     return send(response,200,{ok:true,tools:(settings.appTools[name]||[`get_${name}`,`delete_${name}`]).map(tool=>({name:tool,description:''})),prompts:0,resources:0});
    }
    if(server[2]==='auth'&&request.method==='POST') {
     if([...settings.appFlows.values()].some(flow=>flow.server===name&&flow.profile===scoped&&['authorization_required','callback_received'].includes(flow.status))) return send(response,409,{detail:`MCP OAuth for '${name}' is already in progress`});
     const id=randomUUID().replaceAll('-',''); const state=randomUUID();
     const redirect=servers[name].oauth?.redirect_uri||`http://${request.headers.host}/api/mcp/oauth/callback/${name}`;
     settings.appFlows.set(id,{server:name,profile:scoped,status:'authorization_required',state,redirect});
     return send(response,200,{flow_id:id,server_name:name,status:'authorization_required',authorization_url:`https://auth.${name}.example/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirect)}`,error:null});
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
   const oauth=url.pathname.match(/^\/api\/providers\/oauth(?:\/([^/]+))?(?:\/(start|poll)(?:\/([^/]+))?)?$/);
   if(oauth) {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    const [,provider,step,session]=oauth;
    // As in the pinned release (hermes_cli/auth.py read_credential_pool, _load_provider_state), a profile with no
    // credential of its own for a provider reads the default (root) profile's, and its status says logged in.
    const credentialFor=id=>home.credentials[id]||(scoped!=='default'?settings.defaultCredentials[id]:undefined);
    if(!provider&&request.method==='GET') return send(response,200,{providers:[
     {id:'openai-codex',name:'ChatGPT or Codex Subscription',flow:'device_code',status:{logged_in:Boolean(credentialFor('openai-codex')),token_preview:credentialFor('openai-codex')?.slice(-6)||null}},
     {id:'anthropic',name:'Anthropic Account',flow:'external',cli_command:'hermes auth add anthropic',status:{logged_in:Boolean(credentialFor('anthropic')),token_preview:credentialFor('anthropic')?.slice(-6)||null}}]});
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
     if(!home.credentials[provider]) return send(response,409,{detail:`No stored credentials were removed for ${provider==='anthropic'?'Anthropic Account':'ChatGPT or Codex Subscription'}.`});
     delete home.credentials[provider]; return send(response,200,{ok:true,provider});
    }
   }
   send(response,404,{detail:'Not Found'});
  });
 });
 await new Promise(resolve=>server.listen(port,host,resolve));
 await new Promise(resolve=>management.listen(managementPort,host,resolve));
 const closing=listener=>new Promise(resolve=>{listener.close(resolve);listener.closeAllConnections();});
 return {settings,address:`http://${host}:${server.address().port}`,managementAddress:`http://${host}:${management.address().port}`,close:()=>Promise.all([closing(server),closing(management)]).then(()=>{})};
}
