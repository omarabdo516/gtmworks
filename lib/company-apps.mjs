import { hermesAt } from './bundled-hermes.mjs';
import { appUrl } from './app-origin.mjs';
import { appByKey, knownApp, mergedState } from './app-catalogue.mjs';
import { signInTarget } from './company-sign-in.mjs';
import { readApps, readSession, readUsage, startAppSignIn, pollAppSignIn, cancelAppSignIn, finishAppSignIn, disconnectApp } from './hermes.mjs';

// A Company's apps (#30), each on or off per Agent: an app is on for an Agent when its server is in that Agent's own
// profile in the bundled Engine (ADR 0016), which is the only record of it. `db` is the signed-in person's own session,
// which says which Agents they see, the profile each runs on and whether they are the Owner; the Engine is reached with
// the install's key (#342). The browser gets each app's state and, to connect,
// the vendor's https sign-in page; the Engine's flow stays on the server, kept as the person's own sign-in in the
// database, and nothing the Engine says beyond a state is passed on.

const drivers={read:readApps,session:readSession,usage:readUsage,start:startAppSignIn,poll:pollAppSignIn,cancel:cancelAppSignIn,finish:finishAppSignIn,disconnect:disconnectApp};
const actions=['connect','poll','cancel','disconnect'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Where the vendor sends the person back: gtmworks's own address, never the Engine's private listener.
const callbackOf=key=>appUrl(`/api/apps/callback/${key}`).href;

// The newest sign-in of an app the person started in a Company (for an Agent), or in any Company; `open` keeps only
// those not yet finished. Row-level security shows a person only the sign-ins of Companies they are an Owner of.
/** @param {any} db @param {{app:string,person?:string,company?:string,agent?:string,open?:boolean}} filter */
async function latestSignIn(db,{app,person,company,agent,open}) {
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
export async function readCompanyApps(db,{company,hermes=hermesAt(),driver={}}) {
 const target=await signInTarget(db,company,hermes);
 if(!target) return null;
 const agents=await appAgents(db,company);
 if(!agents) return null;
 const read=driver.read||drivers.read;
 const profiles=[...new Set([target.profile,...agents.map(agent=>agent.profile)])];
 const reads=new Map(await Promise.all(profiles.map(async profile=>/** @type {const} */([profile,await read({...target,profile})]))));
 const listed=reads.get(target.profile);
 if(listed?.state!=='found') return null;
 return listed.apps.map(({key,name,mark,category})=>{
  const each=agents.map(({id,name:agentName,connection,main,own,profile})=>{
   const found=reads.get(profile);
   return {id,name:agentName,connection,main,own,state:found?.state==='found'?found.apps.find(entry=>entry.key===key)?.state??'off':null};
  });
  return {key,name,mark,category,state:mergedState(each),agents:each};
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
export async function readAgentApps(db,{company,agent,hermes=hermesAt(),driver={}}) {
 const profile=await agentProfile(db,company,agent,hermes);
 if(!profile) return null;
 const read=await (driver.read||drivers.read)(profile);
 return read.state==='found'?Object.fromEntries(read.apps.map(app=>[app.key,app.state])):null;
}

// One Agent's Hermes session (#346, #347), read from that Agent's profile alone: a Conversation's steps and token use,
// which gtmworks never keeps. null as readAgentApps, and when the Engine does not know the session.
/** @param {any} db @param {{company:string,agent:string,session:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request
 * @returns {Promise<{turns:import('./engine.mjs').SessionTurn[],usage:import('./engine.mjs').SessionUsage|null}|null>} */
export async function readAgentSession(db,{company,agent,session,hermes=hermesAt(),driver={}}) {
 const profile=await agentProfile(db,company,agent,hermes);
 if(!profile) return null;
 const read=await (driver.session||drivers.session)(profile,session);
 return read.turns&&{turns:read.turns,usage:read.usage};
}

// A Company's token use over the last `days` (#347), each Agent's profile's own as Hermes counts it, for an Owner only:
// one entry per profile with the Agents on it, the main one first. null for anyone else, or when the Company has no
// profile of its own in the bundled Engine or the database does not answer; a profile Hermes does not answer for has
// unknown usage (nulls).
/** @param {any} db @param {{company:string,days:number,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function readCompanyUsage(db,{company,days,hermes=hermesAt(),driver={}}) {
 const {data:owner}=await db.rpc('is_company_owner',{c:company});
 if(owner!==true) return null;
 const target=await signInTarget(db,company,hermes);
 const agents=target&&await appAgents(db,company);
 if(!agents) return null;
 const read=driver.usage||drivers.usage;
 return Promise.all([...new Set(agents.map(agent=>agent.profile))].map(async profile=>{
  const {input,output,sessions}=await read({...target,profile},days);
  return {agents:agents.filter(agent=>agent.profile===profile).map(({id,name})=>({id,name})),input,output,sessions};
 }));
}

// One Agent's connected tools (#204), in the list's order: each app in that Agent's profile with its state (connected,
// attention, or turnedOff when it is there but switched off), and each listed app the Agent was made to use
// (hermes_agents.apps, by name) that its profile lacks, as missing. null as readAgentApps.
/** @param {any} db @param {{company:string,agent:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request
 * @returns {Promise<{key:string,name:string,mark:string,state:'connected'|'attention'|'turnedOff'|'missing'}[]|null>} */
export async function readAgentTools(db,{company,agent,hermes=hermesAt(),driver={}}) {
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
// a disconnect with no Agent turns the app off for every Agent that has it. Returns the answer and its HTTP status.
/** @param {any} db @param {{company:string,agent?:unknown,person:string,app:unknown,action:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function changeCompanyApp(db,{company,agent,person,app,action,hermes=hermesAt(),driver={}}) {
 const use={...drivers,...driver};
 const entry=appByKey(app);
 if(!entry||!actions.includes(String(action))||agent!==undefined&&(typeof agent!=='string'||!uuid.test(agent))) return {status:400,body:{error:'appsInvalid'}};
 const key=entry.key;
 // Checked on the server for every step: a person who is not an active Owner of the Company changes nothing.
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return {status:403,body:{error:'appsNotAllowed'}};
 if(agent===undefined&&action!=='disconnect') return {status:400,body:{error:'appsInvalid'}};
 const target=await signInTarget(db,company,hermes);
 if(!target) return {status:409,body:{error:'appsNoEngine'}};
 const failed=state=>({status:state==='unreachable'?503:502,body:{error:'appsFailed'}});
 const agents=await appAgents(db,company);
 if(!agents) return failed('unreachable');
 const disconnect=async(/** @type {{id:string,profile:string}} */ one)=>{
  const removed=await use.disconnect({...target,profile:one.profile},key);
  if(removed.state!=='disconnected') return removed.state;
  const logged=await db.rpc('record_app_disconnected',{c:company,app_key:key,agent:one.id});
  // The Engine already removed it: a failed log write fails the step and never stops the other Agents' removals.
  return logged.error?'failed':null;
 };
 if(agent===undefined) {
  // Every own Agent that has it, or whose profile cannot be read now, is asked; all are tried, the first failure answers.
  const reads=await Promise.all(agents.filter(one=>one.own).map(async one=>({one,read:await use.read({...target,profile:one.profile})})));
  const having=reads.filter(({read})=>read.state!=='found'||(read.apps.find(found=>found.key===key)?.state??'off')!=='off').map(({one})=>one);
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
  // A person has one open sign-in per app, in whichever Company and for whichever Agent they start it: the vendor's way
  // back then always matches it. An earlier one left open (its window closed) gives way to the new one;
  // start_app_sign_in forgets it.
  const open=await latestSignIn(db,{app:key,person,open:true});
  if(open) { const before=open.company_id===company?target:await signInTarget(db,open.company_id,hermes); if(before) await use.cancel(before,open.flow_id); }
  const started=await use.start(at,key,callbackOf(key));
  if(started.state==='busy') return {status:409,body:{error:'appsBusy'}};
  if(started.state!=='started') return failed(started.state);
  const kept=await db.rpc('start_app_sign_in',{c:company,app_key:key,flow:started.flow,agent:one.id});
  if(kept.error) { await use.cancel(at,started.flow); return {status:403,body:{error:'appsNotAllowed'}}; }
  return {status:200,body:{url:started.url}};
 }
 if(action==='disconnect') {
  const stopped=await disconnect(one);
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
export async function finishCompanyAppSignIn(db,{person,app,answer,hermes=hermesAt(),driver={}}) {
 const use={...drivers,...driver};
 const entry=appByKey(app);
 // Only an open sign-in is matched: the answer of a sign-in that was replaced or already finished is never applied to
 // another one.
 const open=entry?await latestSignIn(db,{app:entry.key,person,open:true}):null;
 if(!entry||!open) return {slug:null,outcome:'failed'};
 const slug=typeof open.companies?.slug==='string'?open.companies.slug:null;
 const target=await signInTarget(db,open.company_id,hermes);
 if(!target) return {slug,outcome:'failed'};
 const profile=open.agent_id?(await appAgents(db,open.company_id))?.find(found=>found.id===open.agent_id&&found.own)?.profile:target.profile;
 if(!profile) return {slug,outcome:'failed'};
 const finished=await use.finish({...target,profile},{key:entry.key,flow:open.flow_id,answer});
 if(finished.state==='approved') {
  const logged=await db.rpc('finish_app_sign_in',{app_key:entry.key,flow:open.flow_id});
  if(logged.error) throw logged.error;
  return {slug,outcome:'connected'};
 }
 return {slug,outcome:finished.state==='waiting'?'waiting':'failed'};
}
