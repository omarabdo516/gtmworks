import { engineOf } from './company-engine.mjs';
import { appUrl } from './app-origin.mjs';
import { appByKey, appKey, knownApp, mergedState } from './app-catalogue.mjs';
import { signInTarget } from './company-sign-in.mjs';
import { readApps, readSession, readUsage, prepareApp, prepareServer, prepareCommandServer, startAppSignIn, pollAppSignIn, cancelAppSignIn, finishAppSignIn, disconnectApp, turnOffApp, testServer } from './hermes.mjs';

// A Company's apps (#30, #458), each on or off per Agent: an app is on for an Agent when its server is in that Agent's own
// profile in the bundled Engine (ADR 0016), which is the only record of it. `db` is the signed-in person's own session,
// which says which Agents they see, the profile each runs on and whether they are the Owner; the Engine is reached with
// the install's key (#342). The browser gets each app's state and, to connect, the vendor's https sign-in page; the
// Engine's flow stays on the server, kept as the person's own sign-in in the database, and nothing the Engine says beyond
// a state is passed on. A token a person pastes goes only to the Engine: it is never a database argument, a log row or a
// response.

const drivers={read:readApps,session:readSession,usage:readUsage,prepare:prepareApp,prepareServer,prepareCommand:prepareCommandServer,test:testServer,start:startAppSignIn,poll:pollAppSignIn,cancel:cancelAppSignIn,finish:finishAppSignIn,disconnect:disconnectApp,turnOff:turnOffApp};
const actions=['connect','poll','cancel','disconnect'];
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Where the vendor sends the person back: gtmworks's own address, never the Engine's private listener.
export const callbackOf=key=>appUrl(`/api/apps/callback/${key}`).href;
// A key the routes accept: a catalogue or ready-made app's, or a server the Owner added (not the form's own card).
const serverKey=key=>{ const entry=appByKey(key); return entry&&entry.source!=='own'?entry.key:appKey.test(String(key))&&key!=='own'?String(key):null; };
// A catalogue entry's declared field and a pasted token are validated here before either reaches the Engine.
const fieldName=/^[A-Z][A-Z0-9_]{1,63}$/;
const badFields=fields=>fields!==undefined&&(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.entries(fields).some(([name,value])=>!fieldName.test(name)||typeof value!=='string'||value.length>4096||/[\r\n\u0000-\u001f]/.test(value)));
export const badToken=token=>token!==undefined&&(typeof token!=='string'||!token||token.length>8192||/[\r\n\u0000-\u001f]/.test(token));

// The newest sign-in of an app the person started in a Company (for an Agent), or in any Company; `open` keeps only
// those not yet finished. Row-level security shows a person only the sign-ins of Companies they are an Owner of.
/** @param {any} db @param {{app:string,person?:string,company?:string,agent?:string,open?:boolean}} filter */
export async function latestSignIn(db,{app,person,company,agent,open}) {
 let request=db.from('company_app_sign_ins').select('company_id,agent_id,flow_id,finished_at,companies(slug)').eq('app',app);
 if(person) request=request.eq('started_by',person);
 if(company) request=request.eq('company_id',company);
 if(agent) request=request.eq('agent_id',agent);
 if(open) request=request.is('finished_at',null);
 const {data,error}=await request.order('started_at',{ascending:false}).limit(1).maybeSingle();
 return error?null:data;
}

// The Company's Agents the person sees on the bundled Engine, the main one first, each with its profile; null when the
// database does not answer. The profile never leaves this module.
/** @param {any} db @param {string} company @returns {Promise<{id:string,name:string,connection:string,main:boolean,own:boolean,profile:string}[]|null>} */
async function appAgents(db,company) {
 const {data,error}=await db.rpc('company_app_agents',{c:company});
 if(error||!Array.isArray(data)) return null;
 return data.map(row=>({id:row.agent,name:row.name,connection:row.connection,main:row.main===true,own:row.own===true,profile:row.profile}));
}

// What a member who sees the section reads: the apps the Engine offers the Company, each with every Agent's state read
// from that Agent's profile (one read per profile, the main profile's included, which lists the apps) and the state
// they make together. null when the Company has no profile of its own in the bundled Engine, or the Engine or the
// database does not answer. An Agent whose profile cannot be read now has no state, never a guessed off.
/** @param {any} db @param {{company:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function readCompanyApps(db,{company,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const target=await signInTarget(db,company,hermes);
 if(!target) return null;
 const agents=await appAgents(db,company);
 if(!agents) return null;
 const read=driver.read||drivers.read;
 const profiles=[...new Set([target.profile,...agents.map(agent=>agent.profile)])];
 const reads=new Map(await Promise.all(profiles.map(async profile=>/** @type {const} */([profile,await read({...target,profile})]))));
 const listed=reads.get(target.profile);
 if(listed?.state!=='found') return null;
 // Every server an Agent's own profile holds that the catalogue does not name is its own card (#458), once, merged
 // across the profiles it is on.
 const cards=[...listed.apps];
 const seen=new Set(cards.map(app=>app.key));
 for(const found of reads.values()) if(found.state==='found') for(const app of found.apps) {
  if(app.source!=='custom'||seen.has(app.key)) continue;
  seen.add(app.key); cards.push(app);
 }
 return cards.map(app=>{
  const each=agents.map(({id,name:agentName,connection,main,own,profile})=>{
   const found=reads.get(profile);
   return {id,name:agentName,connection,main,own,state:found?.state==='found'?found.apps.find(entry=>entry.key===app.key)?.state??'off':null};
  });
  return {...app,state:mergedState(each),agents:each};
 });
}

// The Engine profile of one Agent the person sees, with the Engine's sign-in target, or null (readAgentApps, readAgentTools).
/** @param {any} db @param {string} company @param {string} agent @param {{address:string,key:string}|null} hermes */
async function agentProfile(db,company,agent,hermes) {
 // Both reads at once: the chat's steps wait on this before Hermes is asked (decision 0042).
 const [target,agents]=await Promise.all([signInTarget(db,company,hermes),appAgents(db,company)]);
 const one=target&&agents?.find(found=>found.id===agent);
 return one?{...target,profile:one.profile}:null;
}

// One Agent's apps by key and state, read from that Agent's profile alone (#203: a Conversation's connect card shows its
// app's state now). null when the Company has no profile of its own in the bundled Engine, the person does not see the
// Agent, or the Engine or the database does not answer.
/** @param {any} db @param {{company:string,agent:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request
 * @returns {Promise<Record<string,import('./app-catalogue.mjs').AppState>|null>} */
export async function readAgentApps(db,{company,agent,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const profile=await agentProfile(db,company,agent,hermes);
 if(!profile) return null;
 const read=await (driver.read||drivers.read)(profile);
 return read.state==='found'?Object.fromEntries(read.apps.map(app=>[app.key,app.state])):null;
}

// One Agent's Hermes session (#346, #347), read from that Agent's profile alone: a Conversation's steps and token use,
// which gtmworks never keeps. null as readAgentApps, and when the Engine does not know the session.
/** @param {any} db @param {{company:string,agent:string,session:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request
 * @returns {Promise<{turns:import('./engine.mjs').SessionTurn[],usage:import('./engine.mjs').SessionUsage|null}|null>} */
export async function readAgentSession(db,{company,agent,session,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const profile=await agentProfile(db,company,agent,hermes);
 if(!profile) return null;
 const read=await (driver.session||drivers.session)(profile,session);
 return read.turns&&{turns:read.turns,usage:read.usage};
}

// One channel reply's Hermes session (#148), read on the profile its Run was pinned to: the steps of a channel's
// replies, which gtmworks never keeps. The database gave the profile only for a session a member of that channel reads
// (channel_run_sessions), so a channel's own Agent is read even when it is hidden from a member elsewhere. null as
// readAgentSession.
/** @param {any} db @param {{company:string,session:string,profile:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request
 * @returns {Promise<{turns:import('./engine.mjs').SessionTurn[],usage:import('./engine.mjs').SessionUsage|null}|null>} */
export async function readChannelAgentSession(db,{company,session,profile,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 if(typeof profile!=='string'||!profile) return null;
 const target=await signInTarget(db,company,hermes);
 if(!target) return null;
 const read=await (driver.session||drivers.session)({...target,profile},session);
 return read.turns&&{turns:read.turns,usage:read.usage};
}

// A Company's token use over the last `days` (#347), each Agent's profile's own as Hermes counts it, for an Owner or a
// Manager (#32): one entry per profile with the Agents on it, the main one first, and that profile's by_model rows
// without a price. null for anyone else, or when the Company has no profile of its own in the bundled Engine or the
// database does not answer; a profile Hermes does not answer for has unknown usage (nulls).
/** @param {any} db @param {{company:string,days:number,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function readCompanyUsage(db,{company,days,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const {data:manage}=await db.rpc('can_manage_company',{target:company});
 if(manage!==true) return null;
 const target=await signInTarget(db,company,hermes);
 const agents=target&&await appAgents(db,company);
 if(!agents) return null;
 const read=driver.usage||drivers.usage;
 return Promise.all([...new Set(agents.map(agent=>agent.profile))].map(async profile=>{
  const {input,output,sessions,models}=await read({...target,profile},days);
  return {agents:agents.filter(agent=>agent.profile===profile).map(({id,name})=>({id,name})),input,output,sessions,models};
 }));
}

// One Agent's connected tools (#204), in the list's order: each app in that Agent's profile with its state (connected,
// attention, or turnedOff when it is there but switched off), and each listed app the Agent was made to use
// (hermes_agents.apps, by name) that its profile lacks, as missing. null as readAgentApps.
/** @param {any} db @param {{company:string,agent:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request
 * @returns {Promise<{key:string,name:string,mark:string,state:'connected'|'attention'|'turnedOff'|'missing'}[]|null>} */
export async function readAgentTools(db,{company,agent,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const profile=await agentProfile(db,company,agent,hermes);
 if(!profile) return null;
 const [read,made]=await Promise.all([(driver.read||drivers.read)(profile),
  db.from('hermes_agents').select('apps').eq('company_id',company).eq('id',agent).maybeSingle()]);
 if(read.state!=='found'||made.error) return null;
 const asked=new Set((made.data?.apps||[]).map(name=>knownApp(name)?.key));
 return read.apps.flatMap(app=>app.installed||asked.has(app.key)?[{key:app.key,name:app.name,mark:app.mark,
  state:!app.installed?'missing':app.state==='off'?'turnedOff':app.state}]:[]);
}

// An Owner connects, follows, cancels or disconnects an app for one Agent, in that Agent's own profile and no other;
// a disconnect with no Agent turns the app off for every Agent that has it. A server the Owner added is followed,
// cancelled and removed through the same steps; it is added through lib/company-servers.mjs. A field a catalogue entry
// declares and a token are passed straight to the Engine and nowhere else. Returns the answer and its HTTP status.
/** @param {any} db @param {{company:string,agent?:unknown,person:string,app:unknown,action:unknown,fields?:unknown,token?:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function changeCompanyApp(db,{company,agent,person,app,action,fields={},token,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const use={...drivers,...driver};
 const entry=appByKey(app); const key=serverKey(app);
 if(!key||!actions.includes(String(action))||agent!==undefined&&(typeof agent!=='string'||!uuid.test(agent))) return {status:400,body:{error:'appsInvalid'}};
 if(badFields(fields)||badToken(token)) return {status:400,body:{error:badToken(token)?'appsTokenInvalid':'appsInvalid'}};
 // Checked on the server for every step: a person who is not an active Owner of the Company changes nothing.
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return {status:403,body:{error:'appsNotAllowed'}};
 if(agent===undefined&&action!=='disconnect') return {status:400,body:{error:'appsInvalid'}};
 const target=await signInTarget(db,company,hermes);
 if(!target) return {status:409,body:{error:'appsNoEngine'}};
 const failed=state=>({status:state==='unreachable'?503:502,body:{error:'appsFailed'}});
 const agents=await appAgents(db,company);
 if(!agents) return failed('unreachable');
 // Off for one Agent keeps a server the Owner added in its profile, switched off, so its card and address stay; Remove
 // (no Agent) and every catalogue app delete it.
 const disconnect=async(/** @type {{id:string,profile:string}} */ one,keep=false)=>{
  const removed=await (keep?use.turnOff:use.disconnect)({...target,profile:one.profile},key);
  if(removed.state!=='disconnected') return removed.state;
  const logged=await db.rpc('record_app_disconnected',{c:company,app_key:key,agent:one.id});
  // The Engine already removed it: a failed log write fails the step and never stops the other Agents' removals.
  return logged.error?'failed':null;
 };
 if(agent===undefined) {
  // Every own Agent that has it, or whose profile cannot be read now, is asked; all are tried, the first failure answers.
  const reads=await Promise.all(agents.filter(one=>one.own).map(async one=>({one,read:await use.read({...target,profile:one.profile})})));
  // Every Agent whose profile holds the server, a switched-off copy included: Remove leaves no copy behind.
  const having=reads.filter(({read})=>read.state!=='found'||Boolean(read.apps.find(found=>found.key===key)?.installed)).map(({one})=>one);
  const stopped=[]; for(const one of having) stopped.push(await disconnect(one));
  const first=stopped.find(state=>state!==null);
  return first?failed(first):{status:200,body:{status:'off'}};
 }
 // Only an Agent the person sees whose profile is its own: an Agent still on the main profile shares it with the main
 // Agent, and another Company's is never listed. The Engine is not asked.
 const one=agents.find(found=>found.id===agent&&found.own);
 if(!one) return {status:409,body:{error:'appsAgentNotOwn'}};
 const at={...target,profile:one.profile};
 if(action==='connect') {
  // A server the Owner added lives only in the profiles it is on; its address and sign-in kind are read from one of them,
  // never from the request. Turning it on for another Agent copies nothing but those two, so a token is asked again.
  // A command server (#459) is copied the same way: its command and arguments, never its ssh entry, so each Agent's copy
  // starts in that Agent's own work folder.
  let url=null; let auth=entry?.auth??null; let command=null;
  if(!entry) {
   const served=await Promise.all(agents.filter(found=>found.own).map(async found=>({profile:found.profile,read:await use.read({...target,profile:found.profile})})));
   const defs=served.flatMap(({profile,read})=>{
    const app=read.state==='found'?read.apps.find(found=>found.key===key&&found.source==='custom'):null;
    if(app?.auth==='command'&&typeof app.command==='string'&&Array.isArray(app.args)) return [{profile,url:null,auth:'command',command:{command:app.command,args:app.args},same:JSON.stringify([app.command,app.args])}];
    return app&&typeof app.url==='string'?[{profile,url:app.url,auth:app.auth??'none',command:null,same:app.url}]:[];
   });
   // This Agent's own profile first; otherwise another profile's copy, but only when they agree on the address or command.
   const own=defs.find(found=>found.profile===one.profile);
   const differ=new Set(defs.map(found=>found.same)).size>1;
   if(!own&&differ) return {status:400,body:{error:'appsServerInvalid'}};
   const chosen=own??defs[0];
   if(!chosen) return {status:400,body:{error:'appsInvalid'}};
   url=chosen.url; auth=chosen.auth; command=chosen.command;
  }
  // A token or a field the Engine's catalogue declares is typed in the app's own page: this one-press route asks the
  // browser to open it rather than guessing or refusing.
  const noFields=!fields||typeof fields!=='object'||Object.keys(fields).length===0;
  if(auth==='header'&&!token) return {status:200,body:{needs:'details'}};
  if(entry?.source==='engine'&&noFields) {
   const read=await use.read(at);
   const declared=read.state==='found'?read.apps.find(found=>found.key===key)?.fields:null;
   if(declared?.length) return {status:200,body:{needs:'details'}};
  }
  // A token server, or one with no sign-in, is turned on by the driver alone; its reach is the state the card shows.
  if(auth!=='oauth') {
   const stopped=entry?await use.prepare(at,key,null,{fields,token}):command?await use.prepareCommand(at,{key,...command}):await use.prepareServer(at,{key,url,auth,token,redirectUri:null});
   if(stopped) return failed(stopped);
   const tested=await use.test(at,key);
   if(tested.state==='attention') return {status:200,body:{status:'attention'}};
   if(tested.state!=='connected') return failed(tested.state);
   const logged=await db.rpc('record_app_connected',{c:company,app_key:key,agent:one.id});
   return logged.error?failed('failed'):{status:200,body:{status:'connected'}};
  }
  // A person has one open sign-in per app, in whichever Company and for whichever Agent they start it: the vendor's way
  // back then always matches it. An earlier one left open (its window closed) gives way to the new one;
  // start_app_sign_in forgets it.
  const open=await latestSignIn(db,{app:key,person,open:true});
  if(open) { const before=open.company_id===company?target:await signInTarget(db,open.company_id,hermes); if(before) await use.cancel(before,open.flow_id); }
  const started=await use.start(at,key,callbackOf(key),entry?{fields,token}:{url,auth,token});
  if(started.state==='busy') return {status:409,body:{error:'appsBusy'}};
  if(started.state!=='started') return failed(started.state);
  const kept=await db.rpc('start_app_sign_in',{c:company,app_key:key,flow:started.flow,agent:one.id});
  if(kept.error) { await use.cancel(at,started.flow); return {status:403,body:{error:'appsNotAllowed'}}; }
  return {status:200,body:{url:started.url}};
 }
 if(action==='disconnect') {
  const stopped=await disconnect(one,!entry);
  return stopped?failed(stopped):{status:200,body:{status:'off'}};
 }
 // A sign-in is closed only when it connected (finish_app_sign_in), here or by the vendor's way back.
 const open=await latestSignIn(db,{app:key,person,company,agent:one.id});
 if(!open) return {status:200,body:{status:action==='poll'?'failed':'cancelled'}};
 if(open.finished_at) return {status:200,body:{status:'connected'}};
 if(action==='cancel') {
  const cancelled=await use.cancel(at,open.flow_id);
  return cancelled.state==='cancelled'?{status:200,body:{status:'cancelled'}}:failed(cancelled.state);
 }
 const polled=await use.poll(at,open.flow_id);
 if(polled.state==='approved') {
  const finished=await db.rpc('finish_app_sign_in',{app_key:key,flow:open.flow_id});
  if(finished.error) throw finished.error;
  return {status:200,body:{status:'connected'}};
 }
 if(polled.state==='waiting') return {status:200,body:{status:'waiting'}};
 return ['refused','unreachable'].includes(polled.state)?failed(polled.state):{status:200,body:{status:'failed'}};
}

// The vendor sent the person back to gtmworks (/api/apps/callback/<app>). The answer goes on to the Engine only for an
// open sign-in of that app the person started, in a Company they are still an Owner of, and in the profile of the Agent
// it was started for (none: the main profile, as the previous version started it); the connect is then logged once.
// Returns where to send the person: the Company's slug (null when no sign-in of theirs is known) and the outcome.
/** @param {any} db @param {{person:string,app:string,answer:Record<string,string>,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function finishCompanyAppSignIn(db,{person,app,answer,hermes=null,driver={}}) {
 const use={...drivers,...driver};
 const key=serverKey(app);
 // Only an open sign-in is matched: the answer of a sign-in that was replaced or already finished is never applied to
 // another one.
 const open=key?await latestSignIn(db,{app:key,person,open:true}):null;
 if(!key||!open) return {slug:null,outcome:'failed'};
 const slug=typeof open.companies?.slug==='string'?open.companies.slug:null;
 const target=await signInTarget(db,open.company_id,hermes);
 if(!target) return {slug,outcome:'failed'};
 const profile=open.agent_id?(await appAgents(db,open.company_id))?.find(found=>found.id===open.agent_id&&found.own)?.profile:target.profile;
 if(!profile) return {slug,outcome:'failed'};
 const finished=await use.finish({...target,profile},{key,flow:open.flow_id,answer});
 if(finished.state==='approved') {
  const logged=await db.rpc('finish_app_sign_in',{app_key:key,flow:open.flow_id});
  if(logged.error) throw logged.error;
  return {slug,outcome:'connected'};
 }
 return {slug,outcome:finished.state==='waiting'?'waiting':'failed'};
}
