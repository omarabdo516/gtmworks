import { engineOf } from './company-engine.mjs';
import { appByKey, appKey, serverKeyOf } from './app-catalogue.mjs';
import { signInTarget } from './company-sign-in.mjs';
import { prepareServer, startAppSignIn, testServer, disconnectApp, cancelAppSignIn } from './hermes.mjs';
import { uuid, callbackOf, badToken, latestSignIn } from './company-apps.mjs';

// The Owner's own MCP server (#458): one card in the apps sheet adds any remote server by its name, address and sign-in
// kind, and the Agent it is added to gets every tool the server lists. gtmworks keeps no server and no token: the Engine's
// own profile is the only record, and a pasted token goes straight to the Engine's server route and never to a database
// call, a log row or a response. A command (stdio) server would run inside the Engine's own container (ADR 0018), so a
// body naming one is refused before the Engine is asked.

const actions=['add','test'];
const drivers={prepare:prepareServer,start:startAppSignIn,test:testServer,disconnect:disconnectApp,cancel:cancelAppSignIn};
// The address is the one thing that reaches the Engine, so it is a URL of http or https with no credentials and no more
// than a server address needs.
const addressOk=value=>{
 if(typeof value!=='string'||!value||value.length>2000||/[\s\u0000-\u001f]/.test(value)) return false;
 try { const url=new URL(value); return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&Boolean(url.hostname); } catch { return false; }
};

// The Owner adds or tests one server for one Agent whose profile is its own. `add` starts the sign-in for an OAuth server
// and returns its https page; a token or no-sign-in server is turned on at once and its state is the Engine's reach. `test`
// probes without leaving a server the profile did not have; a server already there is probed as it stands.
/** @param {any} db @param {{company:string,person:string,agent:unknown,action:unknown,name:unknown,url:unknown,kind:unknown,token?:unknown,command?:unknown,args?:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function changeCompanyServer(db,{company,person,agent,action,name,url,kind='none',token,command,args,hermes=engineOf(company),driver={}}) {
 const use={...drivers,...driver};
 // A command or its arguments never reaches the Engine: it would run in the Engine's container (ADR 0018, ADR 0020).
 if(command!==undefined||args!==undefined) return {status:400,body:{error:'appsCommandRefused'}};
 if(!actions.includes(String(action))||typeof agent!=='string'||!uuid.test(agent)) return {status:400,body:{error:'appsInvalid'}};
 if(typeof name!=='string'||!name.trim()||!addressOk(url)||!['none','header','oauth'].includes(String(kind))) return {status:400,body:{error:'appsServerInvalid'}};
 const key=serverKeyOf(name);
 if(!appKey.test(key)) return {status:400,body:{error:'appsServerInvalid'}};
 if(appByKey(key)) return {status:400,body:{error:'appsServerInvalid'}};
 if(kind==='header'&&(typeof token!=='string'||badToken(token))) return {status:400,body:{error:'appsTokenInvalid'}};
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
 if(String(action)==='test') {
  // A probe never touches a server of that name: it is added fresh under a temporary key and removed again. A removal
  // that fails answers a failure, even when the tools were listed; the leftover card is the Owner's to Remove, and the
  // next Test of this name replaces it.
  const testKey=`${key}-test`.slice(0,64);
  await use.disconnect(at,testKey);
  let tested=null; let stopped=null; let cleaned='disconnected';
  try {
   stopped=await use.prepare(at,{...server,key:testKey});
   if(!stopped) tested=await use.test(at,testKey);
  } finally {
   const removed=await use.disconnect(at,testKey);
   if(removed.state!=='disconnected') cleaned=removed.state;
  }
  if(cleaned!=='disconnected') return failed('failed');
  if(stopped) return failed(stopped);
  if(tested&&(tested.state==='connected'||tested.state==='attention')) return {status:200,body:{key,state:tested.state,tools:tested.tools}};
  return failed(tested?.state??'failed');
 }
 if(kind==='oauth') {
  // A person has one open sign-in per server; an earlier one gives way to the new one, as every app's does.
  const open=await latestSignIn(db,{app:key,person,open:true});
  if(open) { const before=open.company_id===company?target:await signInTarget(db,open.company_id,hermes); if(before) await use.cancel(before,open.flow_id); }
  const started=await use.start(at,key,callbackOf(key),{url,auth:server.auth,token});
  if(started.state==='busy') return {status:409,body:{error:'appsBusy'}};
  if(started.state!=='started') return failed(started.state);
  const kept=await db.rpc('start_app_sign_in',{c:company,app_key:key,flow:started.flow,agent:one.agent});
  if(kept.error) { await use.cancel(at,started.flow); return {status:403,body:{error:'appsNotAllowed'}}; }
  return {status:200,body:{key,url:started.url}};
 }
 const stopped=await use.prepare(at,server);
 if(stopped) return failed(stopped);
 const tested=await use.test(at,key);
 if(tested.state==='attention') return {status:200,body:{key,state:'attention'}};
 if(tested.state!=='connected') return failed(tested.state);
 const logged=await db.rpc('record_app_connected',{c:company,app_key:key,agent:one.agent});
 return logged.error?failed('failed'):{status:200,body:{key,state:'connected'}};
}
