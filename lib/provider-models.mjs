import { readCompanySignIns } from './company-sign-in.mjs';
import { keyTarget } from './provider-keys.mjs';
import { entryId, providerOfEntry } from './provider-entry.mjs';
import { readProviderOrder, providerOn } from './provider-order.mjs';
import { keyAccount } from './provider-names.mjs';
import { signInProviders } from './engine/handle.mjs';

// The models a Company's Providers offer, and which of them the Owner switched on (#620, spec #611; GLOSSARY: Provider).
// A Provider is one row of the Providers list: a subscription the Company signed in to, or an API key it holds, each
// named by its kind and the Engine's provider id (`sub-anthropic`, `key-openrouter`). The pinned Engine keeps no model
// list per credential (v0.23.0 agent/credential_pool.py), so the switches are the database's (company_provider_models);
// a model a Provider lists with no switch is on. A model choice, in the chat's "+" menu or on an Agent, is offered once
// while at least one eligible Provider of its provider lists it and has it on, and is gone when none does (#735): a
// Provider that does not list a model never keeps it on. A choice is provider/model, as the
// Engine lists and takes it: an Agent keeps that, never a Provider or a secret.

const modelPattern=/^[^\s/][^\s]{0,199}$/;

// An entry's `models` is null when it is the only eligible Provider of its provider: then the choice's own list says what
// it serves, and its Provider's list is not read (#661).
/** @typedef {{entries:{id:string,provider:string,models:string[]|null}[],off:Set<string>}} ModelAccess */
const switchKey=(entry,model)=>`${entry}\u0000${model}`;
/** Whether an eligible Provider of this provider lists the model and has it switched on. @param {ModelAccess} access @param {{provider:string,model:string}} choice */
export const modelEnabled=(access,{provider,model})=>access.entries.some(entry=>entry.provider===provider&&(entry.models===null||entry.models.includes(model))&&!access.off.has(switchKey(entry.id,model)));
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

// The Company's eligible Providers: each subscription signed in for any of its Agents, and each key its shared space
// holds. Null when the Engine could not say, so nothing is offered rather than a choice no Provider serves. `listedAt`
// reads one profile's model list once per request. Two Providers share a provider only where a key's provider has a
// subscription too, so with a subscription signed in, the lists its models come from are started here, beside the key
// read: knowing each Provider's models then adds no Engine round trip in series (#735, #661).
/** @param {any} db @param {string} company @param {any} [engine] the Company's Engine handle the caller holds */
async function eligible(db,company,engine) {
 const [signIns,target]=await Promise.all([readCompanySignIns(db,{company}),keyTarget(db,company)]);
 const at=engine??target?.engine;
 if(!signIns.signIns||!target) return null;
 /** @type {Map<string,Promise<import('./engine.mjs').AgentModels>>} */
 const reads=new Map();
 /** @param {string} profile @returns {Promise<import('./engine.mjs').AgentModels>} */
 const listedAt=profile=>{
  if(!reads.has(profile)) reads.set(profile,(at.on(profile)?.models.read()??Promise.resolve({state:'failed',current:null,models:[]})).catch(()=>({state:'unreachable',current:null,models:[]})));
  return /** @type {Promise<import('./engine.mjs').AgentModels>} */(reads.get(profile));
 };
 const subscribed=signInProviders.filter(provider=>signIns.signIns[provider]?.state&&signIns.signIns[provider].state!=='notConnected');
 // Where a partly connected subscription's models are also read, beside the shared space's: a sign-in an older version
 // left on the Company's profile ("main Agent only") is read there, one left on Agents' own profiles on the first of
 // them that lists it, in the database's order of the Company's profiles.
 const own=typeof signIns.profile==='string'?signIns.profile:null;
 const others=(signIns.profiles??[]).filter(name=>name!==own);
 const signedOn=provider=>signIns.signIns[provider].state==='mainAgentOnly'?(own?[own]:[]):signIns.signIns[provider].state==='someAgentsOnly'?others:[];
 if(subscribed.length) listedAt(target.space);
 for(const provider of subscribed) { const [first]=signedOn(provider); if(first) listedAt(first); }
 const keys=await target.keys.keys({space:target.space,profiles:[]});
 if(keys.state!=='found'||!Array.isArray(keys.keys)) return null;
 return {space:target.space,listedAt,accounts:signIns.accounts??null,entries:[...subscribed.map(provider=>({id:entryId('subscription',provider),provider,from:signedOn(provider)})),
  ...keys.keys.filter(row=>row.set).map(row=>({id:entryId('key',row.provider),provider:row.provider,from:[]}))]};
}
/** @param {any} db @param {string} company */
async function switches(db,company) {
 const {data,error}=await db.from('company_provider_models').select('entry,model,enabled').eq('company_id',company);
 return error||!Array.isArray(data)?null:data;
}

// The Company's eligible Providers with the models switched off on each, read together. Null when either is unread.
/** @param {any} db @param {string} company @param {any} [engine] */
async function readSwitched(db,company,engine) {
 const [found,rows]=await Promise.all([eligible(db,company,engine),switches(db,company)]);
 if(!found||!rows) return null;
 return {found,off:new Set(rows.filter(row=>row.enabled===false).map(row=>switchKey(row.entry,row.model)))};
}

// The models each eligible Provider lists, by its id: the Company's shared space's list for its provider and, for a
// partly connected subscription, the first profile in its `from` that lists any, even when the space lists models of
// its provider: those may be only what a key of the same provider reaches (#638). The space's come first, each model
// once, marked served where the provider itself said it serves the key (#643). The Providers list and the pickers both
// read it, so they cannot disagree (#735). Null when the space's list is unread.
/** @param {NonNullable<Awaited<ReturnType<typeof eligible>>>} found @returns {Promise<Map<string,{model:string,served:boolean}[]>|null>} */
async function providerLists(found) {
 const space=await found.listedAt(found.space);
 if(space.state!=='found') return null;
 /** @param {import('./engine.mjs').AgentModels} listed @param {string} provider */
 const modelsOf=(listed,provider)=>{
  if(listed.state!=='found') return [];
  const rows=new Map();
  for(const option of listed.models) if(option.provider===provider&&!rows.has(option.model)) rows.set(option.model,option.served===true);
  return [...rows].map(([model,served])=>({model,served}));
 };
 /** @param {{model:string,served:boolean}[]} rows */
 const once=rows=>rows.filter((row,at)=>rows.findIndex(other=>other.model===row.model)===at);
 /** @param {{provider:string,from:string[]}} entry */
 const offeredBy=async entry=>{
  const atSpace=modelsOf(space,entry.provider);
  for(const profile of entry.from) { const there=modelsOf(await found.listedAt(profile),entry.provider); if(there.length) return once([...atSpace,...there]); }
  return atSpace;
 };
 return new Map(await Promise.all(found.entries.map(async entry=>/** @type {[string,{model:string,served:boolean}[]]} */([entry.id,await offeredBy(entry)]))));
}

// What the pickers filter by: the Company's eligible Providers, the models each lists, and the models switched off on
// each. Null when unread, a Provider's list included.
// A Provider the Owner switched off (#619) offers nothing: a key switched off, or a subscription whose every account the
// Engine lists is switched off. Its sign-in or key stays in the Engine; only the offer goes. An order that could not be
// read offers nothing, as an unread Engine does; a subscription whose accounts the Engine did not list is offered only
// while no account of its kind is switched off, since which of them it holds is unknown.
/** @param {any} db @param {{company:string,engine?:any}} request @returns {Promise<ModelAccess|null>} */
export async function readModelAccess(db,{company,engine}) {
 const [read,order]=await Promise.all([readSwitched(db,company,engine),readProviderOrder(db,company)]);
 if(!read||!order) return null;
 const accounts=read.found.accounts;
 const on=entry=>{
  if(entry.id===entryId('key',entry.provider)) return providerOn(order,{provider:entry.provider,account:keyAccount});
  if(!accounts) return !Object.entries(order).some(([key,placed])=>key.startsWith(`${entry.provider}:`)&&key!==`${entry.provider}:${keyAccount}`&&!placed.enabled);
  const held=accounts.filter(row=>row.provider===entry.provider);
  return !held.length||held.some(row=>providerOn(order,{provider:entry.provider,account:row.account}));
 };
 const kept=read.found.entries.filter(on);
 // Only where two of them share a provider does a switch on one need the other's list (#735).
 const shared=new Set(kept.filter((entry,at)=>kept.findIndex(other=>other.provider===entry.provider)!==at).map(entry=>entry.provider));
 const lists=shared.size?await providerLists(read.found):null;
 if(shared.size&&!lists) return null;
 return {entries:kept.map(entry=>({id:entry.id,provider:entry.provider,models:lists&&shared.has(entry.provider)?(lists.get(entry.id)??[]).map(row=>row.model):null})),off:read.off};
}

// What the Providers list draws for every Member: each eligible Provider's models, as the Company's shared space lists
// them for its provider (and, for a subscription signed in elsewhere, the profile that holds it), each with its switch.
// Null when unread.
/** @param {any} db @param {{company:string}} request
 * @returns {Promise<Record<string,{model:string,enabled:boolean,served?:true}[]>|null>} */
export async function readProviderModels(db,{company}) {
 const read=await readSwitched(db,company);
 if(!read) return null;
 const {found,off}=read;
 const lists=await providerLists(found);
 if(!lists) return null;
 return Object.fromEntries(found.entries.map(entry=>[entry.id,(lists.get(entry.id)??[]).map(({model,served})=>({model,enabled:!off.has(switchKey(entry.id,model)),...served?{served:true}:{}}))]));
}

// The Owner turns one model of one Provider on or off; the database refuses anyone else (set_provider_model).
/** @param {any} db @param {{company:unknown,entry:unknown,model:unknown,enabled:unknown}} change @returns {Promise<{status:number,body:Record<string,unknown>}>} */
export async function changeProviderModel(db,{company,entry,model,enabled}) {
 if(!providerOfEntry(entry)||typeof model!=='string'||!modelPattern.test(model)||typeof enabled!=='boolean') return {status:400,body:{error:'providerModelInvalid'}};
 const {data,error}=await db.rpc('set_provider_model',{c:company,provider_entry:entry,provider_model:model,turned_on:enabled});
 if(error) return error.code==='42501'?{status:403,body:{error:'providerModelNotAllowed'}}:error.code==='22023'?{status:400,body:{error:'providerModelInvalid'}}:{status:502,body:{error:'providerModelFailed'}};
 return {status:200,body:{entry,model,enabled:data===true}};
}
