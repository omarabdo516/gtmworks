import { signInTarget } from './company-sign-in.mjs';
import { readProviderKeys, setProviderKey, removeProviderKey } from './hermes.mjs';

// A Company's model-provider API key (#124, ADR 0016). The Owner gives it once; gtmworks passes it straight to the
// bundled Engine for the Company's shared space and each of its Agent profiles, and keeps it nowhere: it is in memory
// only for the calls to the Engine, and no answer, log line or database row holds it. `db` is the signed-in person's
// own session: the database says which Engine profiles are the Company's (company_key_profiles, members only) and
// whether the person is an active Owner (is_company_owner). `service` only reads the install key of the Company's
// bundled Connection (signInTarget, ADR 0008). An Agent made after the key was set has no key in its own profile until
// the Owner sets it again; the Owner's read names those Agents.

const drivers={read:readProviderKeys,set:setProviderKey,remove:removeProviderKey};
const slug=/^[a-z0-9][a-z0-9._-]{0,63}$/;
const outcomes={
 unknownProvider:[400,'keyProviderUnknown'],invalid:[400,'keyInvalid'],noSpace:[409,'keyNoSpace'],notAllowed:[403,'keyNotAllowed'],
 refused:[502,'keyFailed'],failed:[502,'keyFailed'],unreachable:[503,'keyFailed'],
};
/** @param {string} state */
const refused=state=>{ const [status,error]=outcomes[/** @type {keyof typeof outcomes} */(state)]||outcomes.failed; return {status,body:{error}}; };

// The Engine connection and the Company's profiles in it, or null when the Company has no profile of its own in the
// bundled Engine or its shared space is not made yet. `agents` are the profiles a key is written to beside the space.
/** @param {any} db @param {any} service @param {string} company @param {string|undefined} encryptionKey */
async function keyTarget(db,service,company,encryptionKey) {
 const target=await signInTarget(db,service,company,encryptionKey);
 if(!target) return null;
 const {data,error}=await db.rpc('company_key_profiles',{c:company});
 if(error||!Array.isArray(data)) return null;
 const space=data.find(row=>row?.kind==='space'&&typeof row.profile==='string')?.profile;
 if(!space) return null;
 const agents=data.filter(row=>['company','agent'].includes(row?.kind)&&typeof row.profile==='string')
  .map(row=>({profile:row.profile,agent:typeof row.agent==='string'?row.agent:null,name:typeof row.name==='string'?row.name:null}));
 return {connection:{address:target.address,profile:target.profile,key:target.key},space,agents};
}
/** @param {NonNullable<Awaited<ReturnType<typeof keyTarget>>>} target @param {Record<string,string>} states @param {string} field @param {string[]} done */
const agentsOf=(target,states,field,done)=>target.agents.filter(found=>found.agent)
 .map(found=>({agent:found.agent,name:found.name,[field]:done.includes(states[found.profile])}));

// What a member sees: each provider the Engine takes a key for and whether the Company holds one. An active Owner also
// sees the Agents whose own profile lacks a key the Company holds ("Waiting on you"), and those still holding a key the Company removed, so the removal can be retried, and those the Engine could not read (unknown). waiting and leftover are null when what a change missed cannot be read; keys is null when unknown.
/** @param {any} db @param {any} service @param {{company:string,encryptionKey:string|undefined,driver?:Partial<typeof drivers>}} request */
export async function readCompanyKeys(db,service,{company,encryptionKey,driver={}}) {
 const target=await keyTarget(db,service,company,encryptionKey);
 if(!target) return {keys:null,waiting:null,leftover:null,unknown:null};
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 const isOwner=!error&&owner===true;
 const read=await (driver.read||drivers.read)(target.connection,{space:target.space,profiles:isOwner?target.agents.map(found=>found.profile):[]});
 if(read.state!=='found') return {keys:null,waiting:null,leftover:null,unknown:null};
 if(!isOwner) return {keys:read.keys,waiting:null,leftover:null,unknown:null};
 // A profile a change missed reads the same as one it reached when it kept an older key; the database remembers it.
 const named=list=>target.agents.filter(found=>found.agent&&list.has(found.profile)).map(found=>({agent:found.agent,name:found.name}));
 const unknown=named(new Set(read.unread));
 const {data:unfinished,error:unread}=await db.rpc('company_key_unfinished_profiles',{c:company});
 if(unread||!Array.isArray(unfinished)) return {keys:read.keys,waiting:null,leftover:null,unknown};
 const waiting=new Set(read.lacking); const leftover=new Set(read.leftover);
 for(const row of unfinished) {
  const held=read.keys.some(key=>key.provider===row?.provider&&key.set);
  for(const profile of Array.isArray(row?.profiles)?row.profiles:[]) (held?waiting:leftover).add(profile);
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

// An Owner sets or removes the Company's key for one provider. Returns the answer and its HTTP status.
/** @param {any} db @param {any} service @param {{company:string,provider:unknown,intent:unknown,value?:unknown,encryptionKey:string|undefined,driver?:Partial<typeof drivers>}} request */
export async function changeCompanyKey(db,service,{company,provider,intent,value,encryptionKey,driver={}}) {
 const use={...drivers,...driver};
 if(typeof provider!=='string'||!slug.test(provider)||typeof intent!=='string'||!['set','remove'].includes(intent)||intent==='set'&&typeof value!=='string') return refused('invalid');
 // Checked on the server for every change: a person who is not an active Owner of the Company changes nothing.
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return refused('notAllowed');
 const target=await keyTarget(db,service,company,encryptionKey);
 if(!target) return refused('noSpace');
 const at={space:target.space,profiles:target.agents.map(found=>found.profile),provider};
 if(intent==='set') {
  const set=await use.set(target.connection,{...at,value:/** @type {string} */(value)});
  if(set.state!=='written') return refused(set.state);
  const logged=await logChange(db,{c:company,provider,present:true});
  const kept=await keepUnfinished(db,company,provider,set.profiles,['written','noModel']);
  return {status:200,body:{provider,model:set.model,agents:agentsOf(target,set.profiles,'written',['written','noModel']),...unrecorded(logged,kept)}};
 }
 const removed=await use.remove(target.connection,at);
 if(removed.state!=='removed'&&removed.state!=='nothing') return refused(removed.state);
 const logged=removed.state!=='removed'||await logChange(db,{c:company,provider,present:false});
 const kept=await keepUnfinished(db,company,provider,removed.profiles,['removed','nothing']);
 return {status:200,body:{provider,agents:agentsOf(target,removed.profiles,'removed',['removed','nothing']),...unrecorded(logged,kept)}};
}
