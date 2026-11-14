import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
export async function fakeHermes({managementPort=0}={}) {
 // Run ids are unique across fakes, as Hermes's are: the database refuses a Member's run already used elsewhere (#287).
 const instance=randomUUID().slice(0,8);
 // runs: one entry per run Hermes created; the same Idempotency-Key replays the same run.
 const settings={version:'0.23.0',status:200,key:'test-only-key',features:{run_submission:true,run_events_sse:true},requests:/** @type {{method?:string,path?:string,authorization?:string,session?:string,idempotency?:string}[]} */([]),runs:/** @type {{id:string,key?:string,session?:string,input:string,instructions?:string,reads:number}[]} */([]),pendingReads:0,reply:input=>`Reply to: ${input}`,
  // How a finished run ends and the usage it reports; a run cleared from runs is one Hermes lost (404).
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
  // Profiles the Run API answers 404 for, as Hermes does for one it does not serve.
  unknownProfiles:/** @type {string[]} */([]),
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
    if(!run) { run={id:`run_${instance}_${settings.runs.length+1}`,key,session:request.headers['x-hermes-session-key'],input:JSON.parse(raw).input,instructions:JSON.parse(raw).instructions,reads:0}; settings.runs.push(run); }
    return send(response,202,{run_id:run.id,status:'started',replayed:run.reads>0});
   }
   if(runPath&&request.method==='GET') {
    const run=settings.runs.find(run=>run.id===runPath[1]);
    if(!run) return send(response,404,{error:{message:`Run not found: ${runPath[1]}`,code:'run_not_found'}});
    const done=run.reads++>=settings.pendingReads;
    return send(response,200,{object:'hermes.run',run_id:run.id,status:done?settings.ending:'running',session_id:run.session,...(done&&settings.ending==='completed'?{output:settings.reply(run.input)}:{}),...(done&&settings.usage?{usage:settings.usage}:{})});
   }
   send(response,200,request.url.endsWith('/health')?{status:'ok',platform:'hermes-agent',version:settings.version}:{object:'hermes.api_server.capabilities',platform:'hermes-agent',features:settings.features});
  });
 });
 // The routes and answers observed on the pinned release's dashboard (port 9119), authenticated by its session token.
 const management=createServer((request,response)=>{
  let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',()=>{
   let body=null; try { body=raw?JSON.parse(raw):null; } catch { body=null; }
   settings.managementRequests.push({method:request.method,path:request.url,authorization:request.headers.authorization,body});
   if(request.headers.authorization!==`Bearer ${settings.key}`) return send(response,401,{error:'session_expired',message:request.headers.authorization});
   if(settings.managementStatus!==200) return send(response,settings.managementStatus,{detail:request.headers.authorization});
   const url=new URL(request.url,'http://management');
   if(url.pathname==='/api/profiles'&&request.method==='GET') return send(response,200,{profiles:[{name:'default',path:'/opt/data',is_default:true,model:'default-model',provider:'auto'},...[...settings.profiles].map(([name,profile])=>({name,path:`/opt/data/profiles/${name}`,is_default:false,model:profile.model,provider:profile.provider}))]});
   if(url.pathname==='/api/profiles'&&request.method==='POST') {
    if(body?.name==='default'||settings.profiles.has(body?.name)) return send(response,400,{detail:`A profile named '${body.name}' already exists. Choose another name.`});
    settings.profiles.set(body.name,{soul:body.soul||'',provider:'auto',model:'',key:null,config:{},credentials:{}});
    return send(response,200,{ok:true,name:body.name,path:`/opt/data/profiles/${body.name}`,model_set:false,model_error:'No provider given',soul_set:Boolean(body.soul)});
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
    if(!step&&request.method==='DELETE') { delete home.credentials[provider]; return send(response,200,{ok:true,provider}); }
   }
   send(response,404,{detail:'Not Found'});
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 await new Promise(resolve=>management.listen(managementPort,'127.0.0.1',resolve));
 const closing=listener=>new Promise(resolve=>{listener.close(resolve);listener.closeAllConnections();});
 return {settings,address:`http://127.0.0.1:${server.address().port}`,managementAddress:`http://127.0.0.1:${management.address().port}`,close:()=>Promise.all([closing(server),closing(management)]).then(()=>{})};
}
