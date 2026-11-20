import { engineOf } from './company-engine.mjs';
import { appUrl } from './app-origin.mjs';
import { appByKey, appKey, serverKeyOf } from './app-catalogue.mjs';
import { signInTarget } from './company-sign-in.mjs';
import { prepareServer, startAppSignIn, testServer } from './hermes.mjs';

// The Owner's own MCP server (#458): one card in the apps sheet adds any remote server by its name, address and sign-in
// kind, and the Agent it is added to gets every tool the server lists. gtmworks keeps no server and no token: the Engine's
// own profile is the only record, and a pasted token goes straight to the Engine's server route and never to a database
// call, a log row or a response. A command (stdio) server would run inside the Engine's own container (ADR 0018), so a
// body naming one is refused before the Engine is asked.

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fieldName=/^[A-Z][A-Z0-9_]{1,63}$/;
const actions=['add','test'];
const drivers={prepare:prepareServer,start:startAppSignIn,test:testServer};
const callbackOf=key=>appUrl(`/api/apps/callback/${key}`).href;
// A token is a header value: one string, no control characters, the Engine's own cap for a pasted secret.
const tokenOk=token=>typeof token==='string'&&token.length>0&&token.length<=8192&&!/[\r\n\u0000-\u001f]/.test(token);
// The address is the one thing that reaches the Engine, so it is a URL of http or https with no credentials and no more
// than a server address needs.
const addressOk=value=>{
 if(typeof value!=='string'||!value||value.length>2000||/[\s\u0000-\u001f]/.test(value)) return false;
 try { const url=new URL(value); return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&Boolean(url.hostname); } catch { return false; }
};
const badFields=fields=>fields!==undefined&&(fields===null||typeof fields!=='object'||Array.isArray(fields)||Object.entries(fields).some(([name,value])=>!fieldName.test(name)||typeof value!=='string'||value.length>4096||/[\r\n\u0000-\u001f]/.test(value)));

// The Owner adds or tests one server for one Agent whose profile is its own. `add` starts the sign-in for an OAuth server
// and returns its https page; a token or no-sign-in server is turned on at once and its state is the Engine's reach.
/** @param {any} db @param {{company:string,person:string,agent:unknown,action:unknown,name:unknown,url:unknown,kind:unknown,token?:unknown,fields?:unknown,command?:unknown,args?:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function changeCompanyServer(db,{company,person,agent,action,name,url,kind='none',token,fields,command,args,hermes=engineOf(company),driver={}}) {
 const use={...drivers,...driver};
 // A command or its arguments never reaches the Engine: it would run in the Engine's container (ADR 0018, ADR 0020).
 if(command!==undefined||args!==undefined) return {status:400,body:{error:'appsCommandRefused'}};
 if(!actions.includes(String(action))||typeof agent!=='string'||!uuid.test(agent)) return {status:400,body:{error:'appsInvalid'}};
 if(typeof name!=='string'||!name.trim()||!addressOk(url)||!['none','header','oauth'].includes(String(kind))||badFields(fields)) return {status:400,body:{error:'appsServerInvalid'}};
 const key=serverKeyOf(name);
 if(!appKey.test(key)) return {status:400,body:{error:'appsServerInvalid'}};
 if(appByKey(key)) return {status:400,body:{error:'appsServerInvalid'}};
 if(kind==='header'&&!tokenOk(token)) return {status:400,body:{error:'appsTokenInvalid'}};
 // Checked on the server as every app step is: a person who is not an active Owner changes nothing.
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return {status:403,body:{error:'appsNotAllowed'}};
 const target=await signInTarget(db,company,hermes);
 if(!target) return {status:409,body:{error:'appsNoEngine'}};
 const failed=state=>({status:state==='unreachable'?503:502,body:{error:'appsFailed'}});
 const {data:agents,error:agentsError}=await db.rpc('company_app_agents',{c:company});
 const one=!agentsError&&Array.isArray(agents)?agents.find(found=>found.agent===agent&&found.own===true):null;
 if(!one) return {status:409,body:{error:'appsAgentNotOwn'}};
 const at={...target,profile:one.profile};
 const server={key,url,auth:String(kind),token,redirectUri:kind==='oauth'?callbackOf(key):null};
 const stopped=await use.prepare(at,server);
 if(stopped) return failed(stopped);
 if(String(action)==='test') {
  const tested=await use.test(at,key);
  if(tested.state==='connected'||tested.state==='attention') return {status:200,body:{key,state:tested.state,tools:tested.tools}};
  return failed(tested.state);
 }
 if(kind==='oauth') {
  const open=await latestOpenSignIn(db,{app:key,person});
  if(open) { const before=open.company_id===company?target:await signInTarget(db,open.company_id,hermes); if(before) await use.cancel(before,open.flow_id); }
  const started=await use.start(at,key,callbackOf(key),{url,auth:server.auth,token});
  if(started.state==='busy') return {status:409,body:{error:'appsBusy'}};
  if(started.state!=='started') return failed(started.state);
  const kept=await db.rpc('start_app_sign_in',{c:company,app_key:key,flow:started.flow,agent:one.agent});
  if(kept.error) { await use.cancel(at,started.flow); return {status:403,body:{error:'appsNotAllowed'}}; }
  return {status:200,body:{key,url:started.url}};
 }
 const tested=await use.test(at,key);
 if(tested.state==='attention') return {status:200,body:{key,state:'attention'}};
 if(tested.state!=='connected') return failed(tested.state);
 const logged=await db.rpc('record_app_connected',{c:company,app_key:key,agent:one.agent});
 return logged.error?failed('failed'):{status:200,body:{key,state:'connected'}};
}

// The newest open sign-in of a server the person started, in any Company: the vendor's way back always matches one.
/** @param {any} db @param {{app:string,person:string}} filter */
async function latestOpenSignIn(db,{app,person}) {
 const {data,error}=await db.from('company_app_sign_ins').select('company_id,flow_id').eq('app',app).eq('started_by',person).is('finished_at',null).order('started_at',{ascending:false}).limit(1).maybeSingle();
 return error?null:data;
}
