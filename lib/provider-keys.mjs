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
// while it holds a key, and the database forgets it once it holds none.

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
 const listed=kinds=>data.filter(row=>kinds.includes(row?.kind)&&typeof row.profile==='string')
  .map(row=>({profile:row.profile,agent:typeof row.agent==='string'&&row.kind!=='removed'?row.agent:null,name:typeof row.name==='string'?row.name:null}));
 return {connection:{address:target.address,profile:target.profile,key:target.key},space,agents:listed(['company','agent']),removed:listed(['removed'])};
}
/** @param {{profile:string,agent:string|null,name:string|null}[]} reached @param {Record<string,string>} states @param {string} field @param {string[]} done */
// The Company's own profile names no Agent once its keeper is gone; it is still listed, with agent and name null.
const agentsOf=(reached,states,field,done)=>reached
 .map(found=>({agent:found.agent,name:found.name,[field]:done.includes(states[found.profile])}));

// What a member sees: each provider the Engine takes a key for and whether the Company holds one. An active Owner also
// sees the Agents whose own profile lacks a key the Company holds ("Waiting on you"), and those still holding a key the Company removed, so the removal can be retried, and those the Engine could not read (unknown). waiting and leftover are null when what a change missed cannot be read; keys is null when unknown.
// A removed Agent's profile is leftover while it holds any key, and never waiting.
/** @param {any} db @param {any} service @param {{company:string,encryptionKey:string|undefined,driver?:Partial<typeof drivers>}} request */
export async function readCompanyKeys(db,service,{company,encryptionKey,driver={}}) {
 const target=await keyTarget(db,service,company,encryptionKey);
 if(!target) return {keys:null,waiting:null,leftover:null,unknown:null};
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 const isOwner=!error&&owner===true;
 const readKeys=()=>(driver.read||drivers.read)(target.connection,{space:target.space,profiles:isOwner?target.agents.map(found=>found.profile):[]});
 // The Owner's read settles which keys the database counts as held (settle_provider_key_holds) to what the space holds,
 // queued with the Company's key changes so it never meets one half done: a hold the log seeded wrong, a change the
 // Engine never answered, or one the previous app version made, is right again from here.
 const read=isOwner?await oneAtATime(company,async()=>{
  const found=await readKeys();
  if(found.state==='found') await serviceCall(service,'settle_provider_key_holds',{c:company,held:found.keys.filter(key=>key.set).map(key=>key.provider)},'Provider key holds not settled');
  return found;
 }):await readKeys();
 if(read.state!=='found') return {keys:null,waiting:null,leftover:null,unknown:null};
 if(!isOwner) return {keys:read.keys,waiting:null,leftover:null,unknown:null};
 // A profile a change missed reads the same as one it reached when it kept an older key; the database remembers it.
 const named=list=>[...target.agents,...target.removed].filter(found=>list.has(found.profile)).map(found=>({agent:found.agent,name:found.name}));
 const removed=target.removed.map(found=>found.profile);
 const [kept,{data:unfinished,error:unread}]=await Promise.all([
  removed.length?(driver.held||drivers.held)(target.connection,{space:target.space,profiles:removed}):null,
  db.rpc('company_key_unfinished_profiles',{c:company})]);
 const unknown=named(new Set([...read.unread,...(kept?kept.unread??removed:[])]));
 if(unread||!Array.isArray(unfinished)) return {keys:read.keys,waiting:null,leftover:null,unknown};
 const waiting=new Set(read.lacking); const leftover=new Set([...read.leftover,...(kept?.holding??[])]);
 for(const row of unfinished) {
  const held=read.keys.some(key=>key.provider===row?.provider&&key.set);
  for(const profile of Array.isArray(row?.profiles)?row.profiles:[]) if(!held) leftover.add(profile); else if(!removed.includes(profile)) waiting.add(profile);
 }
 return {keys:read.keys,waiting:named(waiting),leftover:named(leftover),unknown};
}

// Each set and removal the Engine applied is in the Company's log by its provider (record_provider_key_change, Owner
// only). The Engine already holds the change, so a failed write is not the change's failure: the answer says it was not
// logged, and the Owner's next change of that provider logs again.
/** @param {any} db @param {{c:string,provider:string,present:boolean}} change @returns {Promise<boolean>} */
async function logChange(db,change) {
 try {
  const {error}=await db.rpc('record_provider_key_change',change);
  if(!error) return true;
  console.error('Provider key change not logged',error.code||'');
 } catch { console.error('Provider key change not logged'); }
 return false;
}
// A service-role call the change records itself with. Its data, or undefined when it failed, logged by its code only.
/** @param {any} service @param {string} name @param {object} args @param {string} failed */
async function serviceCall(service,name,args,failed) {
 try {
  const {data,error}=await service.rpc(name,args);
  if(!error) return {data};
  console.error(failed,error.code||'');
 } catch { console.error(failed); }
 return undefined;
}
const written=states=>Object.keys(states).filter(profile=>states[profile]==='written');
// The set ends the waits of the profiles it gave key and model. An Agent made while it wrote waits on a profile the set
// never named: finish answers each one still waiting, which gets the key the same way, a few rounds at most.
/** @param {(held:boolean|null,reached:string[])=>Promise<unknown>} finish @param {(profiles:string[])=>Promise<any>} write @param {Record<string,string>} states */
async function endWaits(finish,write,states) {
 const named=new Set(Object.keys(states));
 let waiting=await finish(true,written(states));
 for(let round=0;round<3;round++) {
  const late=Array.isArray(waiting)?waiting.filter(profile=>typeof profile==='string'&&!named.has(profile)):[];
  if(!late.length) return;
  for(const profile of late) named.add(profile);
  const set=await write(late);
  if(set.state!=='written') return;
  waiting=await finish(true,written(set.profiles));
 }
}
// A removed Agent's profile the removal reached and that now holds no key, or that the Engine no longer serves, is not
// listed again (forget_agent_profile_leftovers). One the Engine could not read stays listed.
/** @param {any} service @param {any} use @param {string} company @param {NonNullable<Awaited<ReturnType<typeof keyTarget>>>} target @param {Record<string,string>} states */
async function forgetLeftovers(service,use,company,target,states) {
 const reached=target.removed.map(found=>found.profile).filter(profile=>['removed','nothing'].includes(states[profile]));
 if(!reached.length) return;
 const kept=await use.held(target.connection,{space:target.space,profiles:reached});
 if(kept.state!=='found') return;
 const profiles=reached.filter(profile=>!kept.holding.includes(profile)&&!kept.unread.includes(profile));
 if(profiles.length) await serviceCall(service,'forget_agent_profile_leftovers',{c:company,profiles},'Agent profile leftovers not forgotten');
}
// What the answer says when the record of the change could not be written; the Engine holds the change either way.
const unrecorded=(logged,kept)=>({...(logged?{}:{logged:false}),...(kept?{}:{unfinishedKept:false})});
// The profiles this change did not reach, kept until a later change reaches them (record_unfinished_provider_key).
/** @param {any} db @param {string} company @param {string} provider @param {Record<string,string>} states @param {string[]} done @returns {Promise<boolean>} */
async function keepUnfinished(db,company,provider,states,done) {
 const missed=Object.keys(states).filter(profile=>!done.includes(states[profile]));
 try {
  const {error}=await db.rpc('record_unfinished_provider_key',{c:company,key_provider:provider,missed});
  if(!error) return true;
  console.error('Unfinished provider key not kept',error.code||'');
 } catch { console.error('Unfinished provider key not kept'); }
 return false;
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
 // its own profile, and one made before is among the profiles. A begin the database did not take still ends in a finish,
 // which records the hold itself, and the Owner's next read settles the rest.
 await serviceCall(service,'begin_provider_key_change',{c:company,key_provider:provider},'Provider key change not begun');
 // A change the Engine did not answer is left changing, so later Agents wait until the Owner's next read settles it.
 /** @param {boolean|null} held @param {string[]} reached */
 const finish=async(held,reached)=>(await serviceCall(service,'finish_provider_key_change',{c:company,key_provider:provider,now_held:held,reached},'Provider key change not finished'))?.data;
 /** @param {string} state */
 const failed=async state=>{ if(state!=='unreachable') await finish(null,[]); return refused(state); };
 const target=await keyTarget(db,service,company,encryptionKey);
 if(!target) return failed('noSpace');
 const at={space:target.space,profiles:target.agents.map(found=>found.profile),provider};
 if(intent==='set') {
  /** @param {string[]} profiles */
  const write=profiles=>use.set(target.connection,{...at,profiles,value:/** @type {string} */(value)});
  const set=await write(at.profiles);
  if(set.state!=='written') return failed(set.state);
  const logged=await logChange(db,{c:company,provider,present:true});
  const kept=await keepUnfinished(db,company,provider,set.profiles,['written','noModel']);
  await endWaits(finish,write,set.profiles);
  return {status:200,body:{provider,model:set.model,agents:agentsOf(target.agents,set.profiles,'written',['written','noModel']),...unrecorded(logged,kept)}};
 }
 const removed=await use.remove(target.connection,{...at,profiles:[...at.profiles,...target.removed.map(found=>found.profile)]});
 if(removed.state!=='removed'&&removed.state!=='nothing') return failed(removed.state);
 await finish(false,[]);
 const logged=removed.state!=='removed'||await logChange(db,{c:company,provider,present:false});
 const kept=await keepUnfinished(db,company,provider,removed.profiles,['removed','nothing']);
 await forgetLeftovers(service,use,company,target,removed.profiles);
 return {status:200,body:{provider,agents:agentsOf([...target.agents,...target.removed],removed.profiles,'removed',['removed','nothing']),...unrecorded(logged,kept)}};
}
