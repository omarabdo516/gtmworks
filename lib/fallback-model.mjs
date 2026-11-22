import { engineOf } from './company-engine.mjs';
import { signInTarget } from './company-sign-in.mjs';
import { withCompanySettings } from './engine-settings.mjs';
import { modelEnabled, readModelAccess } from './provider-models.mjs';
import { readFallbackChain, sameChain, writeFallbackChain } from './hermes.mjs';

// The Company's Fallback model (#622, spec #611; GLOSSARY: Fallback model): the model its Agents move to once every
// eligible Provider of the model they chose has run out. The Company's Engine does the move itself, with its own
// fallback chain (v0.23.0 `fallback_providers`), which it walks only after the credential pool of the chosen model's
// provider has no account left (agent/turn_recovery.py: no fallback while the pool may recover), so a request moves to
// another kind of Provider only after every account of its own kind, in the Owner's order, ran out (#621). gtmworks runs
// no model loop: it keeps the Owner's choice (company_fallback_models) and gives it to every profile one of the
// Company's Agents runs on, because the Engine keeps the chain per profile and has no Company level:
//
// - None, the default, is an empty chain: the Engine then never moves a request to another provider, and a request with
//   no account left fails once, with no retry of its own (lib/hermes.mjs reads that end as `access`, the chat's one
//   out-of-access line);
// - a choice is one entry, provider and model as the pickers offer it, and only a model some eligible Provider has
//   switched on (#620) is taken;
// - the app writes it to every profile at once when the Owner changes it, and the worker gives it to a profile that
//   does not hold it (an Agent made or moved to its own profile later, an Engine made again or restored), and looks
//   again every few minutes, so an existing and a new Agent follow the same choice.
//
// A chain names a provider id and a model only, never a key or an account.

const pair=/^([a-z0-9][a-z0-9._-]{0,63})\/([^\s/][^\s]{0,199})$/;
/** @param {unknown} value @returns {{provider:string,model:string}|null} */
export const fallbackPair=value=>{ const found=typeof value==='string'?pair.exec(value):null; return found?{provider:found[1],model:found[2]}:null; };
/** @param {{provider:string,model:string}|null} choice */
export const chainFor=choice=>choice?[{provider:choice.provider,model:choice.model}]:[];

const again=5*60*1000;
const drivers={read:readFallbackChain,write:writeFallbackChain};

// What a Member reads: the Company's choice as provider/model, or null for None. Undefined when it cannot be read.
/** @param {any} db @param {string} company @returns {Promise<string|null|undefined>} */
export async function readFallbackModel(db,company) {
 const {data,error}=await db.from('company_fallback_models').select('provider,model').eq('company_id',company).maybeSingle();
 if(error) return undefined;
 return data&&typeof data.provider==='string'&&typeof data.model==='string'?`${data.provider}/${data.model}`:null;
}

// Gives one profile the chain unless it already holds it. Answers whether the profile holds it now.
/** @param {any} connection @param {string} profile @param {{provider:string,model:string}[]} chain @param {typeof drivers} use */
async function keepProfile(connection,profile,chain,use) {
 const at={...connection,profile};
 const read=await use.read(at);
 if(read.state!=='found') return false;
 if(sameChain(read.chain,chain)) return true;
 const written=await use.write(at,{chain,legacy:read.legacy});
 return written.state==='saved';
}

// The Owner picks the Fallback model, or None (`value` null). The database keeps it and refuses anyone but the Owner
// (set_company_fallback_model); then every profile the Company's Agents run on takes it, at the same time. A profile the
// Engine did not take it on now is named, and the worker gives it the choice at its next pass.
/** @param {any} db @param {{company:string,value:unknown,hermes?:any,driver?:Partial<typeof drivers>,access?:typeof readModelAccess}} change
 * @returns {Promise<{status:number,body:Record<string,unknown>}>} */
export const changeFallbackModel=(db,{company,value,hermes=engineOf(company),driver={},access=readModelAccess})=>withCompanySettings(company,async()=>{
 const choice=value===null?null:fallbackPair(value);
 if(value!==null&&!choice) return {status:400,body:{error:'fallbackInvalid'}};
 const at=await hermes;
 // A model no Provider of the Company has switched on is never taken (#620), as the pickers do not offer it; nor is one
 // whose Providers cannot be read now, since another kind of Provider is reached only by a choice known to be on.
 if(choice) {
  const found=await access(db,{company,hermes:at}).catch(()=>null);
  if(!found) return {status:502,body:{error:'fallbackFailed'}};
  if(!modelEnabled(found,choice)) return {status:400,body:{error:'settingModelNotEnabled'}};
 }
 const {data,error}=await db.rpc('set_company_fallback_model',{c:company,fallback_provider:choice?.provider??null,fallback_model:choice?.model??null});
 if(error) return error.code==='42501'?{status:403,body:{error:'fallbackNotAllowed'}}:error.code==='22023'?{status:400,body:{error:'fallbackInvalid'}}:{status:502,body:{error:'fallbackFailed'}};
 const failed=await applyFallbackModel(db,{company,chain:chainFor(choice),hermes:at,driver});
 return {status:200,body:{model:typeof data==='string'?data:null,failed}};
});

// Every profile the Owner's Agents run on takes the chain now. Answers the Agents whose profile did not, by name; all of
// them when the Engine cannot be reached. `db` is the Owner's own session.
/** @param {any} db @param {{company:string,chain:{provider:string,model:string}[],hermes?:any,driver?:Partial<typeof drivers>}} change */
async function applyFallbackModel(db,{company,chain,hermes,driver={}}) {
 const use={...drivers,...driver};
 const {data:rows}=await db.rpc('company_agent_models',{c:company});
 const agents=/** @type {{agent:string,name:string,profile:string}[]} */((Array.isArray(rows)?rows:[]).filter(row=>typeof row?.profile==='string'));
 const named=list=>list.map(row=>({agent:row.agent,name:row.name}));
 try {
  const target=await signInTarget(db,company,hermes);
  if(!target) return named(agents);
  const profiles=[...new Set([...agents.map(row=>row.profile),...(target.profile?[target.profile]:[])])];
  const held=new Map(await Promise.all(profiles.map(async profile=>[profile,await keepProfile(target,profile,chain,use).catch(()=>false)])));
  return named(agents.filter(row=>!held.get(row.profile)));
 } catch { return named(agents); }
}

/** @typedef {{sent:string,kept:Map<string,number>}} Memory */
// The worker's pass over every Company with an Engine (fallback_model_work): each profile one of its Agents runs on is
// read, and given the Company's chain when it holds another, at once for a profile not read since the choice changed and
// again every few minutes for the others. `db` is the worker's service-role client; `memory` lives as long as the worker.
// Answers how many profiles were written.
/** @param {any} db @param {{memory?:Map<string,Memory>,driver?:Partial<typeof drivers>,engineFor?:(company:string)=>Promise<any>,now?:()=>number}} [options] */
export async function keepFallbackModels(db,{memory=new Map(),driver={},engineFor=engineOf,now=Date.now}={}) {
 const use={...drivers,...driver};
 const {data,error}=await db.rpc('fallback_model_work');
 if(error) throw error;
 let written=0;
 for(const row of data||[]) {
  try {
   const at=await engineFor(row.company_id);
   if(!at) continue;
   const chain=chainFor(typeof row.provider==='string'&&typeof row.model==='string'?{provider:row.provider,model:row.model}:null);
   const sent=JSON.stringify(chain);
   const last=memory.get(row.company_id);
   const mine=last&&last.sent===sent?last:{sent,kept:new Map()};
   memory.set(row.company_id,mine);
   for(const profile of Array.isArray(row.profiles)?row.profiles:[]) {
    const kept=mine.kept.get(profile);
    if(kept!==undefined&&now()-kept<again) continue;
    const before=await use.read({...at,profile});
    if(before.state!=='found') continue;
    if(!sameChain(before.chain,chain)) {
     const done=await use.write({...at,profile},{chain,legacy:before.legacy});
     if(done.state!=='saved') { console.error('Fallback model not given to the Engine',profile,done.state); continue; }
     written++;
    }
    mine.kept.set(profile,now());
   }
  } catch(failure) { console.error('Fallback model not kept:',row.company_id,failure?.message||'unknown error'); }
 }
 return written;
}
