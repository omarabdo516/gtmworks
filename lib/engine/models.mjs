import { keepServed } from '../served-models.mjs';
import { designProfiles } from './apps.mjs';
import { readSavedConfig, writeConfig } from './config.mjs';
import { servedModels } from './providers.mjs';
import { agentName, manage, query, reachable, refusal, stepState } from './wire.mjs';

// The models a Run on this profile may choose (#158): each model of each provider the Engine lists for it, but a provider
// that lost its sign-in (authenticated:false), and the profile's own provider and model, from the same read canAnswer
// makes. found, refused or unreachable; the list is empty unless found.
/** @param {any} connection @returns {Promise<import('../engine.mjs').AgentModels>} */
export async function readModels(connection) {
 const none=state=>({state,current:null,models:[]});
 if(!reachable(connection)) return none('unreachable');
 try {
  const read=await manage(connection,`/api/model/options${query(connection.profile)}`,{timeout:20000});
  if(!read.response.ok) return none(refusal(read.response));
  const {model,provider,providers}=read.result||{};
  if(!Array.isArray(providers)) return none('unreachable');
  const text=value=>typeof value==='string'&&value.trim()&&value.length<=200;
  const rows=providers.filter(row=>text(row?.slug)&&row.authenticated!==false&&Array.isArray(row.models));
  const served=await Promise.all(rows.map(row=>servedModels(connection,connection.profile,row.slug)));
  // served: the provider itself said it serves the model to this profile's key (#643).
  const models=rows.flatMap((row,at)=>keepServed(row.models.filter(text),served[at])
   .map(name=>({provider:row.slug,providerName:text(row.name)?row.name:row.slug,model:name,...served[at]?{served:/** @type {true} */(true)}:{}})));
  return {state:'found',current:text(provider)&&text(model)?{provider,model}:null,models};
 } catch { return none('unreachable'); }
}

// Each named profile's own model, as the Engine's profile list reports it (#29, ADR 0016): provider and model, or null for
// a profile the Engine lists with none. The config route's `model` is not this read: its value is a dict there
// (hermes_cli/web_routers/config_env.py 81-92, web_server_config.py 587-599), and PUT /api/profiles/<name>/model is the
// only route that sets it (profiles.py 1056-1068).
/** @param {any} connection @param {string[]} profiles */
export async function readProfileModels(connection,profiles) {
 const none=state=>({state,models:null});
 if(!Array.isArray(profiles)||!profiles.every(name=>typeof name==='string'&&agentName.test(name))) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const read=await manage(connection,'/api/profiles');
  if(!read.response.ok) return none(refusal(read.response));
  if(!Array.isArray(read.result?.profiles)) return none('failed');
  /** @type {Record<string,{provider:string,model:string}|null>} */
  const models={};
  for(const name of profiles) {
   const row=read.result.profiles.find(found=>found?.name===name);
   const provider=typeof row?.provider==='string'?row.provider:''; const model=typeof row?.model==='string'?row.model:'';
   models[name]=row&&provider&&model?{provider,model}:null;
  }
  return {state:'found',models};
 } catch { return none('unreachable'); }
}
// One profile's model written through the Engine's own route and read back from the profile list before it counts as
// saved. A profile the Engine does not serve, a refused key and an answer that keeps another model are states, never
// thrown.
/** @param {any} connection @param {{profile:string,provider:string,model:string}} change */
export async function writeProfileModel(connection,{profile,provider,model}) {
 const none=state=>({state,provider:null,model:null});
 if(!agentName.test(profile)||typeof provider!=='string'||!provider.trim()||typeof model!=='string'||!model.trim()) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const written=await manage(connection,`/api/profiles/${encodeURIComponent(profile)}/model`,{method:'PUT',body:{provider,model}});
  if(!written.response.ok||written.result?.ok!==true) return none(stepState(written));
  const found=await designProfiles(connection,[profile]);
  if(!found.designs) return none(found.state);
  const design=found.designs.get(profile);
  if(design) {
   const mirrored=await manage(connection,`/api/profiles/${encodeURIComponent(design)}/model`,{method:'PUT',body:{provider,model}});
   if(!mirrored.response.ok||mirrored.result?.ok!==true) return none(stepState(mirrored));
  }
  const after=await readProfileModels(connection,[profile]);
  if(after.state!=='found') return none(after.state);
  const saved=after.models?.[profile];
  return saved&&saved.provider===provider&&saved.model===model?{state:'saved',provider,model}:{state:'mismatch',provider:null,model:null};
 } catch { return none('unreachable'); }
}

// A profile's fallback chain (#622, GLOSSARY: Fallback model): the providers its Runs move to once the credential pool
// of the chosen model's provider cannot recover (v0.23.0 agent/turn_recovery.py; the Run API loads the chain from the
// profile's own config.yaml for every Run, gateway/platforms/api_server.py 2245). The Engine takes the chain from
// `fallback_providers` and the older `fallback_model` together (hermes_cli/fallback_config.py get_fallback_chain), so
// both are read; an entry is provider and model, and anything else in it is not one gtmworks wrote. The write replaces
// `fallback_providers` whole (a config write replaces a list, config.py 1373-1388), and clears an older `fallback_model`
// that still holds an entry, with a list, as a value of None over a dict section is ignored there.
/** @param {unknown} raw @returns {{provider:string,model:string}[]} */
const chainEntries=raw=>(Array.isArray(raw)?raw:raw&&typeof raw==='object'?[raw]:[]).flatMap(entry=>{
 const provider=typeof entry?.provider==='string'?entry.provider.trim():''; const model=typeof entry?.model==='string'?entry.model.trim():'';
 return provider&&model?[{provider,model}]:[];
});
/** @param {any} connection @returns {Promise<{state:'found',chain:{provider:string,model:string}[],legacy:boolean}|{state:'refused'|'unreachable'|'failed',chain:null,legacy:false}>} */
export async function readFallbackChain(connection) {
 const read=await readSavedConfig(connection);
 if(read.state!=='found') return {state:/** @type {'refused'|'unreachable'|'failed'} */(read.state),chain:null,legacy:false};
 const legacy=chainEntries(read.config.fallback_model);
 return {state:'found',chain:[...chainEntries(read.config.fallback_providers),...legacy],legacy:legacy.length>0};
}
/** @param {any} connection @param {{chain:{provider:string,model:string}[],legacy?:boolean}} change */
export async function writeFallbackChain(connection,{chain,legacy=false}) {
 if(!Array.isArray(chain)||chain.some(entry=>typeof entry?.provider!=='string'||typeof entry?.model!=='string')) return {state:'failed'};
 const written=await writeConfig(connection,{fallback_providers:chain.map(({provider,model})=>({provider,model})),...(legacy?{fallback_model:[]}:{})});
 if(written.state!=='written') return written;
 const after=await readFallbackChain(connection);
 if(after.state!=='found') return {state:after.state};
 return {state:sameChain(after.chain,chain)?'saved':'mismatch'};
}
/** @param {{provider:string,model:string}[]} one @param {{provider:string,model:string}[]} other */
export const sameChain=(one,other)=>one.length===other.length&&one.every((entry,at)=>entry.provider===other[at].provider&&entry.model===other[at].model);
