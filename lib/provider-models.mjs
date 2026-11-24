import { engineOf } from './company-engine.mjs';
import { readCompanySignIns } from './company-sign-in.mjs';
import { keyTarget } from './provider-keys.mjs';
import { entryId, providerOfEntry } from './provider-entry.mjs';
import { readProviderOrder, providerOn } from './provider-order.mjs';
import { keyAccount } from './provider-names.mjs';
import { readProviderKeys, readModels, signInProviders } from './hermes.mjs';

// The models a Company's Providers offer, and which of them the Owner switched on (#620, spec #611; GLOSSARY: Provider).
// A Provider is one row of the Providers list: a subscription the Company signed in to, or an API key it holds, each
// named by its kind and the Engine's provider id (`sub-anthropic`, `key-openrouter`). The pinned Engine keeps no model
// list per credential (v0.23.0 agent/credential_pool.py), so the switches are the database's (company_provider_models);
// a model with no switch is on. A model choice, in the chat's "+" menu or on an Agent, is offered once while at least
// one eligible Provider of its provider switches it on, and is gone when none does. A choice is provider/model, as the
// Engine lists and takes it: an Agent keeps that, never a Provider or a secret.

const modelPattern=/^[^\s/][^\s]{0,199}$/;

/** @typedef {{entries:{id:string,provider:string}[],off:Set<string>}} ModelAccess */
const switchKey=(entry,model)=>`${entry}\u0000${model}`;
/** Whether an eligible Provider of this provider has the model switched on. @param {ModelAccess} access @param {{provider:string,model:string}} choice */
export const modelEnabled=(access,{provider,model})=>access.entries.some(entry=>entry.provider===provider&&!access.off.has(switchKey(entry.id,model)));
/** The choices to offer, each once, in the Engine's order. @template {{provider:string,model:string}} T @param {T[]} options @param {ModelAccess|null} access @returns {T[]} */
export function offeredModels(options,access) {
 if(!access) return [];
 const seen=new Set();
 return options.filter(option=>{
  const key=`${option.provider}/${option.model}`;
  if(seen.has(key)||!modelEnabled(access,option)) return false;
  seen.add(key); return true;
 });
}

// The Engine reads, replaced in tests; `signIns` reads one profile's sign-ins (readCompanySignIns' own by default).
/** @type {{keys:typeof readProviderKeys,options:typeof readModels,signIns?:any}} */
const drivers={keys:readProviderKeys,options:readModels};
// The Company's eligible Providers: each subscription signed in for any of its Agents, and each key its shared space
// holds. Null when the Engine could not say, so nothing is offered rather than a choice no Provider serves.
/** @param {any} db @param {string} company @param {any} hermes @param {Partial<typeof drivers>} use */
async function eligible(db,company,hermes,use) {
 const [signIns,target]=await Promise.all([readCompanySignIns(db,{company,hermes,driver:use.signIns?{read:use.signIns}:{}}),keyTarget(db,null,company,hermes)]);
 if(!signIns.signIns||!target) return null;
 // The Engine record's own fields (a separate management address) stay with the connection keyTarget names.
 const connection={...hermes,...target.connection};
 const keys=await (use.keys||drivers.keys)(connection,{space:target.space,profiles:[]});
 if(keys.state!=='found'||!Array.isArray(keys.keys)) return null;
 const subscribed=signInProviders.filter(provider=>signIns.signIns[provider]?.state&&signIns.signIns[provider].state!=='notConnected');
 // Where a subscription's models are listed when the shared space has none of its own: a sign-in an older version left
 // on the Company's profile ("main Agent only") is read there, one left on Agents' own profiles on the first of them
 // that lists it, in the database's order of the Company's profiles.
 const own=typeof signIns.profile==='string'?signIns.profile:null;
 const others=(signIns.profiles??[]).filter(name=>name!==own);
 const signedOn=provider=>signIns.signIns[provider].state==='mainAgentOnly'?(own?[own]:[]):signIns.signIns[provider].state==='someAgentsOnly'?others:[];
 return {connection,space:target.space,accounts:signIns.accounts??null,entries:[...subscribed.map(provider=>({id:entryId('subscription',provider),provider,from:signedOn(provider)})),
  ...keys.keys.filter(row=>row.set).map(row=>({id:entryId('key',row.provider),provider:row.provider,from:[]}))]};
}
/** @param {any} db @param {string} company */
async function switches(db,company) {
 const {data,error}=await db.from('company_provider_models').select('entry,model,enabled').eq('company_id',company);
 return error||!Array.isArray(data)?null:data;
}

// The Company's eligible Providers with the models switched off on each, read together. Null when either is unread.
/** @param {any} db @param {string} company @param {any} hermes @param {Partial<typeof drivers>} driver */
async function readSwitched(db,company,hermes,driver) {
 const [found,rows]=await Promise.all([eligible(db,company,await hermes,driver),switches(db,company)]);
 if(!found||!rows) return null;
 return {found,off:new Set(rows.filter(row=>row.enabled===false).map(row=>switchKey(row.entry,row.model)))};
}

// What the pickers filter by: the Company's eligible Providers and the models switched off on each. Null when unread.
// A Provider the Owner switched off (#619) offers nothing: a key switched off, or a subscription whose every account the
// Engine lists is switched off. Its sign-in or key stays in the Engine; only the offer goes. An order that could not be
// read offers nothing, as an unread Engine does; a subscription whose accounts the Engine did not list is offered only
// while no account of its kind is switched off, since which of them it holds is unknown.
/** @param {any} db @param {{company:string,hermes?:any,driver?:Partial<typeof drivers>}} request @returns {Promise<ModelAccess|null>} */
export async function readModelAccess(db,{company,hermes=engineOf(company),driver={}}) {
 const [read,order]=await Promise.all([readSwitched(db,company,hermes,driver),readProviderOrder(db,company)]);
 if(!read||!order) return null;
 const accounts=read.found.accounts;
 const on=entry=>{
  if(entry.id===entryId('key',entry.provider)) return providerOn(order,{provider:entry.provider,account:keyAccount});
  if(!accounts) return !Object.entries(order).some(([key,placed])=>key.startsWith(`${entry.provider}:`)&&key!==`${entry.provider}:${keyAccount}`&&!placed.enabled);
  const held=accounts.filter(row=>row.provider===entry.provider);
  return !held.length||held.some(row=>providerOn(order,{provider:entry.provider,account:row.account}));
 };
 return {entries:read.found.entries.filter(on),off:read.off};
}

// What the Providers list draws for every Member: each eligible Provider's models, as the Company's shared space lists
// them for its provider (or, for a subscription signed in elsewhere, the profile that holds it), each with its switch.
// Null when unread.
/** @param {any} db @param {{company:string,hermes?:any,driver?:Partial<typeof drivers>}} request
 * @returns {Promise<Record<string,{model:string,enabled:boolean,served?:true}[]>|null>} */
export async function readProviderModels(db,{company,hermes=engineOf(company),driver={}}) {
 const read=await readSwitched(db,company,hermes,driver);
 if(!read) return null;
 const {found,off}=read;
 const reads=new Map();
 const listedAt=profile=>{ if(!reads.has(profile)) reads.set(profile,(driver.options||drivers.options)({...found.connection,profile})); return reads.get(profile); };
 const space=await listedAt(found.space);
 if(space.state!=='found') return null;
 // Each model once, marked served where the provider itself said it serves the key (#643).
 const modelsOf=(listed,provider)=>{
  if(listed.state!=='found') return [];
  const rows=new Map();
  for(const option of listed.models) if(option.provider===provider&&!rows.has(option.model)) rows.set(option.model,option.served===true);
  return [...rows].map(([model,served])=>({model,served}));
 };
 // A subscription the space lists no model for is read where it is signed in (eligible's `from`).
 const offeredBy=async entry=>{
  const atSpace=modelsOf(space,entry.provider);
  if(atSpace.length) return atSpace;
  for(const profile of entry.from) { const there=modelsOf(await listedAt(profile),entry.provider); if(there.length) return there; }
  return [];
 };
 return Object.fromEntries(await Promise.all(found.entries.map(async entry=>[entry.id,(await offeredBy(entry)).map(({model,served})=>({model,enabled:!off.has(switchKey(entry.id,model)),...served?{served:true}:{}}))])));
}

// The Owner turns one model of one Provider on or off; the database refuses anyone else (set_provider_model).
/** @param {any} db @param {{company:unknown,entry:unknown,model:unknown,enabled:unknown}} change @returns {Promise<{status:number,body:Record<string,unknown>}>} */
export async function changeProviderModel(db,{company,entry,model,enabled}) {
 if(!providerOfEntry(entry)||typeof model!=='string'||!modelPattern.test(model)||typeof enabled!=='boolean') return {status:400,body:{error:'providerModelInvalid'}};
 const {data,error}=await db.rpc('set_provider_model',{c:company,provider_entry:entry,provider_model:model,turned_on:enabled});
 if(error) return error.code==='42501'?{status:403,body:{error:'providerModelNotAllowed'}}:error.code==='22023'?{status:400,body:{error:'providerModelInvalid'}}:{status:502,body:{error:'providerModelFailed'}};
 return {status:200,body:{entry,model,enabled:data===true}};
}
