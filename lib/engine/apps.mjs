import { setTimeout as sleep } from 'node:timers/promises';
import { apps, appByKey, appConfig, appKey, appState, customApp, offeredApp } from '../app-catalogue.mjs';
import { sandboxServer, sandboxCommandOf } from '../sandbox-command.mjs';
import { engineRequest } from './transport.mjs';
import { agentName, manage, query, reachable, refusal, stepState } from './wire.mjs';

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
// One app's own test (#770): connected when its server answers, attention when it does not.
/** @param {any} connection @param {string} key @returns {Promise<{state:'connected'|'attention'}>} */
export async function testApp(connection,key) {
 return {state:/** @type {'connected'|'attention'} */ (appState(true,await reaches(connection,key)))};
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
export async function readApps(connection,{test=true}={}) {
 if(!companyScope(connection)) return noApps('failed');
 if(!reachable(connection)) return noApps('unreachable');
 try {
  const [listed,config]=await Promise.all([manage(connection,`/api/mcp/catalog${query(connection.profile)}`),manage(connection,`/api/config${query(connection.profile)}`)]);
  for(const read of [listed,config]) if(!read.response.ok) return noApps(refusal(read.response));
  const entries=listed.result?.entries;
  if(!Array.isArray(entries)) return noApps('failed');
  const servers=config.result?.mcp_servers&&typeof config.result.mcp_servers==='object'?config.result.mcp_servers:{};
  const offered=apps.flatMap(entry=>{
   // A preset's card is the form until a server of its name is in the profile; that server is then its card (below).
   if(entry.source==='own') return entry.preset&&Object.hasOwn(servers,entry.key)?[]:[{entry,installed:false,on:false,fields:null}];
   if(entry.source==='remote') { const server=servers[entry.key]; return [{entry,installed:Boolean(server),on:Boolean(server)&&server.enabled!==false,fields:null}]; }
   const found=entries.find(one=>one?.name===entry.key);
   if(!found) return [];
   const installed=found.installed===true;
   const fields=Array.isArray(found.required_env)?found.required_env.flatMap(field=>typeof field?.name==='string'?[{name:field.name,prompt:typeof field.prompt==='string'?field.prompt:'',required:field.required!==false}]:[]):[];
   return [{entry,installed,on:installed&&found.enabled===true,fields:fields.length?fields:null}];
  });
  const knownKeys=new Set(apps.filter(entry=>!entry.preset).map(entry=>entry.key));
  const custom=Object.keys(servers).filter(key=>!knownKeys.has(key)&&appKey.test(key)).sort().map(key=>{
   const server=servers[key];
   // A command server gtmworks wrote runs in the work sandbox (#459); its card shows the command as the Owner typed it.
   const command=sandboxCommandOf(server);
   if(command) return {entry:{...customApp(key),auth:'command',command:command.command,args:command.args},installed:true,on:server?.enabled!==false,fields:null};
   const auth=server?.auth==='oauth'?'oauth':server?.headers&&typeof server.headers==='object'&&Object.keys(server.headers).some(name=>name.toLowerCase()==='authorization')?'header':'none';
   return {entry:{...customApp(key),auth,...(typeof server?.url==='string'?{url:server.url}:{})},installed:true,on:server?.enabled!==false,fields:null};
  });
  return {state:'found',apps:await Promise.all([...offered,...custom].map(async({entry,installed,on,fields})=>({key:entry.key,name:entry.name,mark:entry.mark,category:entry.category,source:entry.source,
   ...(entry.url?{url:entry.url}:{}),...(entry.command?{command:entry.command,args:entry.args}:{}),...(entry.preset?{preset:entry.preset}:{}),...(entry.docs?{docs:entry.docs}:{}),...(entry.auth?{auth:entry.auth}:{}),...(entry.care?{care:entry.care}:{}),...(fields?{fields}:{}),installed,
   // Without `test` (#770) an app that is on reads `checking`: its own test is its own request (testApp), so one slow app
   // never holds the list.
   state:!test&&on?'checking':appState(on,on&&await reaches(connection,entry.key))})))};
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
// Connecting prepares the app, then asks Hermes for the vendor's sign-in page. Only an OAuth entry gets here; a token or
// no-sign-in server is turned on by prepareApp alone.
/** @param {any} connection @param {string} key @param {string} redirectUri */
export async function startAppSignIn(connection,key,redirectUri,{fields={},token,url:serverAddress,auth}={}) {
 const stopped=offeredApp(key)?await prepareApp(connection,key,redirectUri,{fields,token}):await prepareServer(connection,{key,url:serverAddress,auth,token,redirectUri});
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
  const catalogue=Boolean(offeredApp(key));
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
  const answered=await engineRequest(connection,{listener:'management',path:`/api/mcp/oauth/callback/${encodeURIComponent(key)}?${forwarded}`,key:null,deadline:10000});
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
  const removed=await manage(connection,serverPath(connection,key),{method:'DELETE'});
  return {state:removed.response.status===404||removed.response.ok&&removed.result?.ok===true?'disconnected':stepState(removed)};
 } catch { return {state:'unreachable'}; }
}

// Off for one Agent, kept in its profile: a server the Owner added is known only by its configuration, so switching it
// off for an Agent keeps that (address and sign-in kind) and only stops the Agent's Runs from getting it; Remove deletes.
/** @param {any} connection @param {string} key */
export async function turnOffApp(connection,key) {
 if(offeredApp(key)||!appKey.test(String(key))||key==='own'||!companyScope(connection)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const turned=await manage(connection,serverPath(connection,key,'/enabled'),{method:'PUT',body:{enabled:false,profile:connection.profile}});
  return {state:turned.response.status===404||turned.response.ok&&turned.result?.ok===true?'disconnected':stepState(turned)};
 } catch { return {state:'unreachable'}; }
}
