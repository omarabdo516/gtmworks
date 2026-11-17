import { signInTarget } from './company-sign-in.mjs';
import { readProviderKeys, readHeldKeys, setProviderKey, removeProviderKey } from './hermes.mjs';

// A Company's model-provider API key (#124, ADR 0016). The Owner gives it once; gtmworks passes it straight to the
// bundled Engine for the Company's shared space and each of its Agent profiles, and keeps it nowhere: it is in memory
// only for the calls to the Engine, and no answer, log line or database row holds it. `db` is the signed-in person's
// own session: the database says which Engine profiles are the Company's (company_key_profiles, members only) and
// whether the person is an active Owner (is_company_owner). `service` reads the install key of the Company's bundled
// Connection (signInTarget, ADR 0008) and, once the Owner is checked, records that the Company's key is changing and
// how the change ended (#299): an Agent made from the change's start until a set gives its own profile key and model
// waits there, held from every Run, and never runs on Lead's profile. The Owner's read names the Agents whose profile
// lacks the key. A removed Agent's profile stays in the Engine, so a removal still reaches it, the Owner's read names it
// while it holds a key the Company removed, and the database forgets it once it holds none.

const drivers={read:readProviderKeys,held:readHeldKeys,set:setProviderKey,remove:removeProviderKey};
const slug=/^[a-z0-9][a-z0-9._-]{0,63}$/;
const outcomes={
 unknownProvider:[400,'keyProviderUnknown'],invalid:[400,'keyInvalid'],noSpace:[409,'keyNoSpace'],notAllowed:[403,'keyNotAllowed'],
 refused:[502,'keyFailed'],failed:[502,'keyFailed'],unreachable:[503,'keyFailed'],
};
/** @param {string} state */
const refused=state=>{ const [status,error]=outcomes[/** @type {keyof typeof outcomes} */(state)]||outcomes.failed; return {status,body:{error}}; };

// The Engine connection and the Company's profiles in it, or null when the Company has no profile of its own in the
// bundled Engine or its shared space is not made yet. `agents` are the profiles a key is written to beside the space;
// `removed` are those of removed Agents, which a removal reaches too, named without the Agent that is gone.
/** @param {any} db @param {any} service @param {string} company @param {string|undefined} encryptionKey */
async function keyTarget(db,service,company,encryptionKey) {
 const target=await signInTarget(db,service,company,encryptionKey);
 if(!target) return null;
 const {data,error}=await db.rpc('company_key_profiles',{c:company});
 if(error||!Array.isArray(data)) return null;
 const space=data.find(row=>row?.kind==='space'&&typeof row.profile==='string')?.profile;
 if(!space) return null;
 const listed=kinds=>profilesOf(data,kinds);
 return {connection:{address:target.address,profile:target.profile,key:target.key},space,agents:listed(['company','agent']),removed:listed(['removed'])};
}
/** @param {any[]} rows @param {string[]} kinds */
const profilesOf=(rows,kinds)=>rows.filter(row=>kinds.includes(row?.kind)&&typeof row.profile==='string')
 .map(row=>({profile:row.profile,agent:typeof row.agent==='string'&&row.kind!=='removed'?row.agent:null,name:typeof row.name==='string'?row.name:null}));
/** @param {{profile:string,agent:string|null,name:string|null}[]} reached @param {Record<string,string>} states @param {string} field @param {string[]} done */
// The Company's own profile names no Agent once its keeper is gone; it is still listed, with agent and name null.
const agentsOf=(reached,states,field,done)=>reached
 .map(found=>({agent:found.agent,name:found.name,[field]:done.includes(states[found.profile])}));

// What a member sees: each provider the Engine takes a key for and whether the Company holds one. An active Owner also
// sees the Agents whose own profile lacks a key the Company holds ("Waiting on you"), and those still holding a key the Company removed, so the removal can be retried, and those the Engine could not read (unknown). waiting and leftover are null when what a change missed cannot be read; keys is null when unknown.
// A removed Agent's profile is never waiting. It is leftover while it holds a key of a provider the Company no longer
// holds, or of one it holds that a set since its removal did not write, as no set writes it: that key may be the old value.
/** @param {any} db @param {any} service @param {{company:string,encryptionKey:string|undefined,driver?:Partial<typeof drivers>}} request */
export async function readCompanyKeys(db,service,{company,encryptionKey,driver={}}) {
 const target=await keyTarget(db,service,company,encryptionKey);
 if(!target) return {keys:null,waiting:null,leftover:null,unknown:null};
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 const isOwner=!error&&owner===true;
 const readKeys=()=>(driver.read||drivers.read)(target.connection,{space:target.space,profiles:isOwner?target.agents.map(found=>found.profile):[]});
 const removed=target.removed.map(found=>found.profile);
 const readHeld=async()=>removed.length?(driver.held||drivers.held)(target.connection,{space:target.space,profiles:removed}):null;
 // The Owner's read settles which keys the database counts as held (settle_provider_key_holds) to what the space holds,
 // and forgets the removed Agents' profiles left holding none, queued with this process's key changes so it never meets
 // one half done; the database leaves alone one another process began within its window. A hold the log seeded wrong,
 // or one the previous app version changed, is right again from here.
 const {read,kept}=isOwner?await oneAtATime(company,async()=>{
  const [found,held]=await Promise.all([readKeys(),readHeld()]);
  if(found.state==='found') await rpcCall(service,'settle_provider_key_holds',{c:company,held:found.keys.filter(key=>key.set&&slug.test(key.provider)).map(key=>key.provider)},'Provider key holds not settled');
  if(held) await forgetEmptied(service,company,removed,held);
  return {read:found,kept:held};
 }):{read:await readKeys(),kept:null};
 if(read.state!=='found') return {keys:null,waiting:null,leftover:null,unknown:null};
 if(!isOwner) return {keys:read.keys,waiting:null,leftover:null,unknown:null};
 // A profile a change missed reads the same as one it reached when it kept an older key; the database remembers it.
 const named=list=>[...target.agents,...target.removed].filter(found=>list.has(found.profile)).map(found=>({agent:found.agent,name:found.name}));
 const {data:unfinished,error:unread}=await db.rpc('company_key_unfinished_profiles',{c:company});
 const unknown=named(new Set([...read.unread,...(kept?kept.unread??removed:[])]));
 if(unread||!Array.isArray(unfinished)) return {keys:read.keys,waiting:null,leftover:null,unknown};
 const live=provider=>read.keys.some(key=>key.provider===provider&&key.set);
 const stale=kept?.state==='found'?Object.keys(kept.held).filter(profile=>kept.held[profile].some(provider=>!live(provider))):[];
 const waiting=new Set(read.lacking); const leftover=new Set([...read.leftover,...stale]);
 for(const row of unfinished) {
  const held=live(row?.provider);
  for(const profile of Array.isArray(row?.profiles)?row.profiles:[]) {
   if(!held) leftover.add(profile);
   else if(!removed.includes(profile)) waiting.add(profile);
   else if(kept?.state==='found'&&kept.held[profile]?.includes(row.provider)) leftover.add(profile);
  }
 }
 return {keys:read.keys,waiting:named(waiting),leftover:named(leftover),unknown};
}

// Each set and removal the Engine applied is in the Company's log by its provider (record_provider_key_change, Owner
// only). The Engine already holds the change, so a failed write is not the change's failure: the answer says it was not
// logged, and the Owner's next change of that provider logs again.
/** @param {any} db @param {{c:string,provider:string,present:boolean}} change @returns {Promise<boolean>} */
async function logChange(db,change) {
 return !!await rpcCall(db,'record_provider_key_change',change,'Provider key change not logged');
}
// A database call a change or read records itself with, through the person's session or the service role. Its data, or
// undefined when it failed, logged by its code only: the request carries a key, so nothing else of it is logged.
/** @param {any} client @param {string} name @param {object} args @param {string} failed */
async function rpcCall(client,name,args,failed) {
 try {
  const {data,error}=await client.rpc(name,args);
  if(!error) return {data};
  console.error(failed,error.code||'');
 } catch { console.error(failed); }
 return undefined;
}
const written=states=>Object.keys(states).filter(profile=>states[profile]==='written');
// The set ends the waits of the profiles it gave key and model. An Agent made while it wrote waits on a profile the set
// never named: finish answers each one still waiting, which gets the key the same way, a few rounds at most. Returns
// every profile's state, the late ones' included, so one a round could not write is kept as unfinished.
/** @param {(held:boolean|null,reached:string[])=>Promise<unknown>} finish @param {(profiles:string[])=>Promise<any>} write @param {Record<string,string>} states */
async function endWaits(finish,write,states) {
 const all={...states};
 let waiting=await finish(true,written(states));
 for(let round=0;round<3;round++) {
  const late=Array.isArray(waiting)?waiting.filter(profile=>typeof profile==='string'&&!Object.hasOwn(all,profile)):[];
  if(!late.length) break;
  const set=await write(late);
  Object.assign(all,set.state==='written'?set.profiles:Object.fromEntries(late.map(profile=>[profile,set.state])));
  if(set.state!=='written') break;
  waiting=await finish(true,written(set.profiles));
 }
 return all;
}
// A removed Agent's profile left holding no key of any provider, or that the Engine no longer serves, is not listed again
// (forget_agent_profile_leftovers). One the Engine could not read stays listed.
/** @param {any} service @param {string} company @param {string[]} profiles @param {Awaited<ReturnType<typeof readHeldKeys>>} kept */
async function forgetEmptied(service,company,profiles,kept) {
 if(kept.state!=='found') return;
 const emptied=profiles.filter(profile=>!kept.unread.includes(profile)&&!kept.held[profile]?.length);
 if(emptied.length) await rpcCall(service,'forget_agent_profile_leftovers',{c:company,profiles:emptied},'Agent profile leftovers not forgotten');
}
// What the answer says when the record of the change could not be written; the Engine holds the change either way.
const unrecorded=(logged,kept)=>({...(logged?{}:{logged:false}),...(kept?{}:{unfinishedKept:false})});
// The profiles this change did not reach, kept until a later change reaches them (record_unfinished_provider_key).
/** @param {any} db @param {string} company @param {string} provider @param {Record<string,string>} states @param {string[]} done @returns {Promise<boolean>} */
async function keepUnfinished(db,company,provider,states,done) {
 const missed=Object.keys(states).filter(profile=>!done.includes(states[profile]));
 return !!await rpcCall(db,'record_unfinished_provider_key',{c:company,key_provider:provider,missed},'Unfinished provider key not kept');
}

// One change of a Company's keys at a time: two at once would interleave their writes to the space and the profiles,
// and each would clear what the other missed. The web server is one process (Dockerfile), so a queue here holds them.
/** @type {Map<string,Promise<unknown>>} */
const changing=new Map();
/** @template T @param {string} company @param {()=>Promise<T>} work @returns {Promise<T>} */
function oneAtATime(company,work) {
 const run=(changing.get(company)||Promise.resolve()).then(work,work);
 const tail=run.catch(()=>{});
 changing.set(company,tail);
 tail.then(()=>{ if(changing.get(company)===tail) changing.delete(company); });
 return run;
}

// An Owner sets or removes the Company's key for one provider. Returns the answer and its HTTP status.
/** @param {any} db @param {any} service @param {{company:string,provider:unknown,intent:unknown,value?:unknown,encryptionKey:string|undefined,driver?:Partial<typeof drivers>}} request */
export async function changeCompanyKey(db,service,request) {
 const {company,provider,intent,value}=request;
 if(typeof provider!=='string'||!slug.test(provider)||typeof intent!=='string'||!['set','remove'].includes(intent)||intent==='set'&&typeof value!=='string') return refused('invalid');
 return oneAtATime(company,()=>changeOnce(db,service,{...request,provider,intent}));
}
/** @param {any} db @param {any} service @param {{company:string,provider:string,intent:string,value?:unknown,encryptionKey:string|undefined,driver?:Partial<typeof drivers>}} request */
async function changeOnce(db,service,{company,provider,intent,value,encryptionKey,driver={}}) {
 const use={...drivers,...driver};
 // Checked on the server for every change: a person who is not an active Owner of the Company changes nothing.
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return refused('notAllowed');
 // Before the profiles to write are read, under the lock lead_create_agent takes: an Agent made from here on waits on
 // its own profile, and one made before is among the profiles. Without that record an Agent made during the change could
 // go on Lead's profile as the key reaches it, so a change the database did not begin asks the Engine nothing.
 if(!await rpcCall(service,'begin_provider_key_change',{c:company,key_provider:provider},'Provider key change not begun')) return refused('failed');
 // How the change ends unless a finish already recorded it, so it never stays changing. A set the Engine did not answer,
 // or one that threw once its write was asked for, may already be in the space: it ends held and unanswered (answered
 // false), so later Agents wait until the hold is settled from the space. A change that wrote nothing, and a removal the
 // Engine did not answer, leave the hold and an earlier unanswered set's mark as they were (null): a removal never marks one.
 /** @type {{held:boolean|null,reached:string[],answered:boolean|null}} */
 const end={held:null,reached:[],answered:null};
 let finished=false;
 /** @param {boolean|null} held @param {string[]} reached @param {boolean|null} [answered] */
 const finish=async(held,reached,answered=true)=>{
  const done=await rpcCall(service,'finish_provider_key_change',{c:company,key_provider:provider,now_held:held,reached,answered},'Provider key change not finished');
  if(done) finished=true;
  return done?.data;
 };
 const wroteNothing=()=>Object.assign(end,{held:null,answered:null});
 try {
  const target=await keyTarget(db,service,company,encryptionKey);
  if(!target) return refused('noSpace');
  const at={space:target.space,profiles:target.agents.map(found=>found.profile),provider};
  if(intent==='set') {
   Object.assign(end,{held:true,answered:false});
   const set=await use.set(target.connection,{...at,value:/** @type {string} */(value)});
   // 'failed' can come back after the space's write was sent, so the key may be there, as when the Engine never answered.
   if(set.state!=='written') { if(!['unreachable','failed'].includes(set.state)) wroteNothing(); return refused(set.state); }
   Object.assign(end,{reached:written(set.profiles),answered:true});
   const logged=await logChange(db,{c:company,provider,present:true});
   /** @param {string[]} profiles */
   const writeLate=profiles=>use.set(target.connection,{...at,profiles,value:/** @type {string} */(value),profilesOnly:true});
   const states=await endWaits(finish,writeLate,set.profiles);
   const kept=await keepUnfinished(db,company,provider,{...states,...Object.fromEntries(target.removed.map(found=>[found.profile,'removedProfile']))},['written','noModel']);
   // The Agents the late rounds reached were made during the set, so only a fresh read of the profiles names them.
   const late=Object.keys(states).filter(profile=>!Object.hasOwn(set.profiles,profile));
   const listed=late.length?(await rpcCall(db,'company_key_profiles',{c:company},'Provider key profiles not read'))?.data:null;
   const named=Array.isArray(listed)?profilesOf(listed,['agent']).filter(found=>late.includes(found.profile)):[];
   return {status:200,body:{provider,model:set.model,agents:agentsOf([...target.agents,...named],states,'written',['written','noModel']),...unrecorded(logged,kept)}};
  }
  const removed=await use.remove(target.connection,{...at,profiles:[...at.profiles,...target.removed.map(found=>found.profile)]});
  if(removed.state!=='removed'&&removed.state!=='nothing') return refused(removed.state);
  Object.assign(end,{held:false,answered:true});
  const logged=removed.state!=='removed'||await logChange(db,{c:company,provider,present:false});
  const kept=await keepUnfinished(db,company,provider,removed.profiles,['removed','nothing']);
  const reached=target.removed.map(found=>found.profile).filter(profile=>['removed','nothing'].includes(removed.profiles[profile]));
  if(reached.length) await forgetEmptied(service,company,reached,await use.held(target.connection,{space:target.space,profiles:reached}));
  return {status:200,body:{provider,agents:agentsOf([...target.agents,...target.removed],removed.profiles,'removed',['removed','nothing']),...unrecorded(logged,kept)}};
 } finally { if(!finished) await finish(end.held,end.reached,end.answered); }
}
