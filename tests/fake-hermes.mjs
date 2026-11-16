import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
// `host` is the loopback address both listeners take: a spec that needs the management listener on its fixed port 9119
// (the driver's default beside the Hermes address) takes an address of its own, so lanes never share that port.
export async function fakeHermes({managementPort=0,host='127.0.0.1'}={}) {
 // Run ids are unique across fakes, as Hermes's are: the database refuses a Member's run already used elsewhere (#287).
 const instance=randomUUID().slice(0,8);
 // runs: one entry per run Hermes created; the same Idempotency-Key replays the same run.
 const settings={version:'0.23.0',status:200,key:'test-only-key',features:{run_submission:true,run_events_sse:true},requests:/** @type {{method?:string,path?:string,authorization?:string,session?:string,idempotency?:string}[]} */([]),runs:/** @type {{id:string,key?:string,session?:string,input:string,instructions?:string,history?:{role:string,content:string}[],body?:string,reads:number,stopped?:boolean,asked:{prompt_id:string,question:string,choices:string[],multi_select:boolean,answer?:string,settled:'answered'|'expired'|null}[]}[]} */([]),pendingReads:0,loseStarts:0,reply:input=>`Reply to: ${input}`,
  // How a finished run ends and the usage it reports; a run cleared from runs is one Hermes lost (404).
  // A run first asks the questions `questions` gives for its input (clarify, #138), one at a time, as the pinned release
  // does: it stays running with the question in pending_controls until it is answered on the run's clarify route,
  // expires (expire(run), Hermes's clarify_timeout) or the run is stopped. The reply is given the answers. `answers`
  // keeps every clarify request's status and body.
  questions:/** @type {(input:string)=>{question:string,choices?:string[],multi_select?:boolean}[]} */(()=>[]),
  answers:/** @type {{run:string,status:number,body:any}[]} */([]),
  expire(run) { const waiting=settings.runs.find(found=>found.id===run)?.asked.find(asked=>!asked.settled); if(waiting) waiting.settled='expired'; return !!waiting; },
  ending:'completed',usage:/** @type {object|undefined} */({input_tokens:14000,output_tokens:12}),
  // The management listener (Hermes's dashboard, a second port): its profiles, and the status it answers with when
  // not 200. A profile made through it has its own Run API key, none until /api/env sets it, as in the pinned release.
  managementStatus:200,profiles:/** @type {Map<string,{soul:string,provider:string,model:string,key:string|null,config:any,credentials:Record<string,string>}>} */(new Map()),failStep:/** @type {''|'model'|'env'|'config'} */(''),
  managementRequests:/** @type {{method?:string,path?:string,authorization?:string,body:any}[]} */([]),
  // The default profile's config and model sign-ins (a profile made through the listener keeps its own), and the
  // sign-in sessions Hermes runs: approve(session) finishes one as the person would in their browser.
  defaultConfig:/** @type {any} */({}),defaultCredentials:/** @type {Record<string,string>} */({}),
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
  skills:/** @type {Map<string,Map<string,string>>} */(new Map()),skillLocks:/** @type {Set<string>} */(new Set()),
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
     const asked=settings.questions(sent.input).map(each=>({prompt_id:randomUUID().replaceAll('-','').slice(0,10),question:each.question,choices:each.choices??[],multi_select:each.multi_select===true,settled:null}));
     run={id:`run_${instance}_${settings.runs.length+1}`,key,session:request.headers['x-hermes-session-key'],input:sent.input,instructions:sent.instructions,history:sent.conversation_history,body:raw,reads:0,asked}; settings.runs.push(run);
    }
    // A start whose answer is lost: the run exists, but the connection closes before any answer (loseStarts of them).
    if(settings.loseStarts>0) { settings.loseStarts--; request.socket.destroy(); return; }
    return send(response,202,{run_id:run.id,status:'started',replayed:run.reads>0});
   }
   if(runPath&&request.method==='GET') {
    const run=settings.runs.find(run=>run.id===runPath[1]);
    if(!run) return send(response,404,{error:{message:`Run not found: ${runPath[1]}`,code:'run_not_found'}});
    if(run.stopped) return send(response,200,{object:'hermes.run',run_id:run.id,status:'cancelled',session_id:run.session,pending_controls:[]});
    // As measured on the pinned release: the skip hint is appended to the question, and the first of two or more
    // choices is marked recommended.
    const waiting=run.asked?.find(asked=>!asked.settled);
    if(waiting) return send(response,200,{object:'hermes.run',run_id:run.id,status:'running',session_id:run.session,pending_controls:[{kind:'clarify',prompt_id:waiting.prompt_id,execution_generation:1,
     question:`${waiting.question}\nReply "skip" to skip this question.`,choices:waiting.choices.map((choice,index)=>index===0&&waiting.choices.length>=2?`${choice} (Recommended)`:choice),multi_select:waiting.multi_select}]});
    const done=run.reads++>=settings.pendingReads;
    return send(response,200,{object:'hermes.run',run_id:run.id,status:done?settings.ending:'running',session_id:run.session,...(done&&settings.ending==='completed'?{output:settings.reply(run.input,(run.asked||[]).map(asked=>asked.answer??null))}:{}),...(done&&settings.usage?{usage:settings.usage}:{}),pending_controls:[]});
   }
   // The run's own routes (api_server_runs.py): stop, and the answer to the question it waits for, which takes exactly
   // request_id, execution_generation and answer.
   const runAction=request.url.match(/^\/p\/[^/]+\/v1\/runs\/([^/]+)\/(stop|clarify)$/);
   if(runAction&&request.method==='POST') {
    const run=settings.runs.find(run=>run.id===runAction[1]);
    if(runAction[2]==='stop') {
     if(!run) return send(response,404,{error:{message:`Run not found: ${runAction[1]}`,code:'run_not_found'}});
     run.stopped=true; return send(response,200,{run_id:run.id,status:'stopping'});
    }
    let body=null; try { body=JSON.parse(raw); } catch { body=null; }
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
   if(url.pathname==='/api/profiles'&&request.method==='GET') return send(response,200,{profiles:[{name:'default',path:'/opt/data',is_default:true,model:'default-model',provider:'auto'},...[...settings.profiles].map(([name,profile])=>({name,path:`/opt/data/profiles/${name}`,is_default:false,model:profile.model,provider:profile.provider}))]});
   if(url.pathname==='/api/profiles'&&request.method==='POST') {
    if(body?.name==='default'||settings.profiles.has(body?.name)) return send(response,400,{detail:`A profile named '${body.name}' already exists. Choose another name.`});
    settings.profiles.set(body.name,{soul:body.soul||'',provider:settings.seedModel?.provider||'auto',model:settings.seedModel?.model||'',key:null,config:{},credentials:{}});
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
   const profilePath=url.pathname.match(/^\/api\/profiles\/([^/]+)\/(soul|model)$/);
   const profile=profilePath&&settings.profiles.get(decodeURIComponent(profilePath[1]));
   if(profilePath&&!profile) return send(response,404,{detail:'Profile not found'});
   if(profilePath?.[2]==='soul'&&request.method==='GET') return send(response,200,{content:profile.soul,exists:true});
   if(profilePath?.[2]==='model'&&request.method==='PUT') {
    if(settings.failStep==='model') return send(response,500,{detail:'Internal Server Error'});
    Object.assign(profile,{provider:body.provider,model:body.model});
    return send(response,200,{ok:true,provider:body.provider,model:body.model});
   }
   if(url.pathname==='/api/env'&&request.method==='PUT') {
    const target=settings.profiles.get(url.searchParams.get('profile'));
    if(settings.failStep==='env'||!target) return send(response,500,{detail:'Internal Server Error'});
    if(body?.key==='API_SERVER_KEY') target.key=body.value;
    return send(response,200,{ok:true,key:body?.key});
   }
   const scoped=url.searchParams.get('profile')||'default';
   const home=profileOf(scoped);
   if(url.pathname==='/api/config'&&['GET','PUT'].includes(request.method)) {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    if(request.method==='GET') return send(response,200,home.config);
    if(settings.failStep==='config'||!body?.config||typeof body.config!=='object') return send(response,500,{detail:'Internal server error'});
    // A stale Hermes answers the write and keeps the old config.
    if(!settings.staleConfig) home.config=merge(home.config,body.config);
    if(scoped==='default') settings.defaultConfig=home.config;
    return send(response,200,{ok:true});
   }
   // Skills (hermes_cli/web_routers/skills.py): a profile sees its own and those of each folder its
   // skills.external_dirs names (a profile's folder is its home's `skills`), and keeps its own locks.
   const skillsPath=url.pathname.match(/^\/api\/skills(?:\/(content|lock))?$/);
   if(skillsPath) {
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    const owners=[scoped,...(home.config?.skills?.external_dirs||[]).map(folder=>/^\/opt\/data\/profiles\/([^/]+)\/skills$/.exec(folder)?.[1]).filter(owner=>settings.profiles.has(owner))];
    const listed=owners.flatMap((owner,at)=>[...(settings.skills.get(owner)||new Map()).keys()].map(name=>({name,owner,provenance:at?'external':'agent'})));
    const name=skillsPath[1]==='content'&&request.method==='GET'?url.searchParams.get('name'):body?.name;
    const found=listed.find(skill=>skill.name===name);
    const missing=()=>send(response,404,{detail:`Skill '${name}' not found.`});
    if(!skillsPath[1]&&request.method==='GET') return send(response,200,listed.map(skill=>({name:skill.name,description:'',category:null,locked:settings.skillLocks.has(`${scoped}:${skill.name}`),enabled:true,usage:0,provenance:skill.provenance})));
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
    if(!home) return send(response,404,{detail:`Profile '${scoped}' does not exist.`});
    const own=settings.profiles.get(scoped)||{provider:'auto',model:''};
    const signedIn=['openai-codex','anthropic'].filter(id=>home.credentials[id]||settings.defaultCredentials[id]);
    const providers=signedIn.map(slug=>({slug,name:slug,is_current:slug===own.provider,models:own.provider===slug&&own.model?[own.model]:[],source:'authenticated'}));
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
     return send(response,200,{session_id:id,flow:'device_code',user_code:'ABCD-1234',verification_url:'https://auth.openai.com/codex/device',expires_in:900,poll_interval:5});
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
 await new Promise(resolve=>server.listen(0,host,resolve));
 await new Promise(resolve=>management.listen(managementPort,host,resolve));
 const closing=listener=>new Promise(resolve=>{listener.close(resolve);listener.closeAllConnections();});
 return {settings,address:`http://${host}:${server.address().port}`,managementAddress:`http://${host}:${management.address().port}`,close:()=>Promise.all([closing(server),closing(management)]).then(()=>{})};
}
