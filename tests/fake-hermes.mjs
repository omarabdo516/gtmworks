import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
export async function fakeHermes() {
 // Run ids are unique across fakes, as Hermes's are: the database refuses a Member's run already used elsewhere (#287).
 const instance=randomUUID().slice(0,8);
 // runs: one entry per run Hermes created; the same Idempotency-Key replays the same run.
 const settings={version:'0.23.0',status:200,key:'test-only-key',features:{run_submission:true,run_events_sse:true},requests:/** @type {{method?:string,path?:string,authorization?:string,session?:string,idempotency?:string}[]} */([]),runs:/** @type {{id:string,key?:string,session?:string,input:string,reads:number}[]} */([]),pendingReads:0,reply:input=>`Reply to: ${input}`,
  // How a finished run ends and the usage it reports; a run cleared from runs is one Hermes lost (404).
  ending:'completed',usage:/** @type {object|undefined} */({input_tokens:14000,output_tokens:12}),
  // The management listener (Hermes's dashboard, a second port): its profiles, and the status it answers with when
  // not 200. A profile made through it has its own Run API key, none until /api/env sets it, as in the pinned release.
  managementStatus:200,profiles:/** @type {Map<string,{soul:string,provider:string,model:string,key:string|null}>} */(new Map()),failStep:/** @type {''|'model'|'env'} */(''),
  managementRequests:/** @type {{method?:string,path?:string,authorization?:string,body:any}[]} */([])};
 const send=(response,code,body)=>{response.writeHead(code,{'Content-Type':'application/json',Location:'/must-not-follow'});response.end(JSON.stringify(body));};
 const server=createServer((request,response)=>{
  let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',()=>{
   settings.requests.push({method:request.method,path:request.url,authorization:request.headers.authorization,session:request.headers['x-hermes-session-key'],idempotency:request.headers['idempotency-key']});
   const managed=settings.profiles.get(decodeURIComponent(request.url.match(/^\/p\/([^/]+)\//)?.[1]||''));
   const key=managed?managed.key:settings.key;
   const status=key&&request.headers.authorization===`Bearer ${key}`?settings.status:401;
   if(managed&&status===401) return send(response,401,{error:{message:request.headers.authorization,code:'gateway_auth_failed'}});
   if(status!==200) return send(response,status,{error:{message:request.headers.authorization}});
   const runPath=request.url.match(/^\/p\/[^/]+\/v1\/runs(?:\/([^/]+))?$/);
   if(runPath&&request.method==='POST'&&!runPath[1]) {
    const key=request.headers['idempotency-key'];
    let run=settings.runs.find(run=>key&&run.key===key);
    if(!run) { run={id:`run_${instance}_${settings.runs.length+1}`,key,session:request.headers['x-hermes-session-key'],input:JSON.parse(raw).input,reads:0}; settings.runs.push(run); }
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
    settings.profiles.set(body.name,{soul:body.soul||'',provider:'auto',model:'',key:null});
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
   send(response,404,{detail:'Not Found'});
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 await new Promise(resolve=>management.listen(0,'127.0.0.1',resolve));
 const closing=listener=>new Promise(resolve=>{listener.close(resolve);listener.closeAllConnections();});
 return {settings,address:`http://127.0.0.1:${server.address().port}`,managementAddress:`http://127.0.0.1:${management.address().port}`,close:()=>Promise.all([closing(server),closing(management)]).then(()=>{})};
}
