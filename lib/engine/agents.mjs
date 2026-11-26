import { appByKey, appKey } from '../app-catalogue.mjs';
import { isAgentProfile, toolConfig, appToolset } from '../agent-toolsets.mjs';
import { engineRequest, isHermesAddressAllowed, onProfile } from './transport.mjs';
import { removeDesignProfile } from './apps.mjs';
import { readProfileModels } from './models.mjs';
import { defaultModel, keyProfile, providerTable, spaceState } from './providers.mjs';
import { spaceName } from './skills.mjs';
import { speechEnvs } from './speech.mjs';
import { agentName, boundedJson, manage, modelOf, noAgent, noProfile, query, reachable, refusal, stepState } from './wire.mjs';

export async function createAgent(connection,{name,instructions,model=null}) {
 const pair=model?modelOf(model):null;
 if(!agentName.test(name)||typeof instructions!=='string'||model&&!pair) return noAgent('failed');
 if(!reachable(connection)) return noAgent('unreachable');
 try {
  const made=await manage(connection,'/api/profiles',{method:'POST',body:{name,soul:instructions}});
  if(made.response.status===400&&typeof made.result?.detail==='string'&&made.result.detail.includes('already exists')) return noAgent('exists');
  if(!made.response.ok) return noAgent(made.response.status===400?'failed':refusal(made.response));
  if(made.result?.ok!==true||made.result.name!==name) return noAgent('failed');
  // A 200 alone is not trusted: each step answers ok:true when it was applied.
  const steps=[...(pair?[[`/api/profiles/${encodeURIComponent(name)}/model`,{provider:pair[0],model:pair[1]}]]:[]),
   [`/api/env?profile=${encodeURIComponent(name)}`,{key:'API_SERVER_KEY',value:connection.key}]];
  for(const [path,body] of steps) {
   const step=await manage(connection,path,{method:'PUT',body});
   if(!step.response.ok||step.result?.ok!==true) return noAgent('failed');
  }
  return {state:'created',agent:{name,instructions,model:pair?model:null,ready:true}};
 } catch { return noAgent('unreachable'); }
}
export async function readAgent(connection,name) {
 if(!agentName.test(name)) return noAgent('missing');
 if(!reachable(connection)) return noAgent('unreachable');
 try {
  const listed=await manage(connection,'/api/profiles');
  if(!listed.response.ok) return noAgent(refusal(listed.response));
  const profile=Array.isArray(listed.result?.profiles)?listed.result.profiles.find(found=>found?.name===name):undefined;
  if(!profile) return noAgent('missing');
  const soul=await manage(connection,`/api/profiles/${encodeURIComponent(name)}/soul`);
  if(!soul.response.ok) return noAgent(refusal(soul.response));
  // Ready when the Run API of that profile accepts the connection's key: a Run can then start for the Agent.
  const capabilities=await engineRequest(connection,{path:onProfile(name,'/v1/capabilities')});
  const text=value=>typeof value==='string'&&value?value:null;
  const [provider,model]=[text(profile.provider),text(profile.model)];
  // The name the person gave it, its About and its title are the Engine's own (v0.23.0 GET /api/profiles): gtmworks
  // never invents one (#161). No management route writes a named profile's display_name, so nothing here writes it.
  return {state:'found',agent:{name,instructions:typeof soul.result?.content==='string'?soul.result.content:'',model:provider&&model?`${provider}/${model}`:null,ready:capabilities.ok,
   displayName:text(profile.display_name),description:typeof profile.description==='string'?profile.description:'',descriptionAuto:profile.description_auto!==false,botTitle:text(profile.bot_title)}};
 } catch { return noAgent('unreachable'); }
}
// An Agent's About is its profile's description, written as a person wrote it (v0.23.0 PUT
// /api/profiles/{name}/description, hermes_cli/web_routers/profiles.py 1042-1053): the Engine trims it, stores it with
// description_auto false and answers what it kept, which is what the page then shows. The Engine sets no length limit.
/** @param {any} connection @param {{name:string,description:string}} change @returns {Promise<{state:'written',description:string}|{state:'refused'|'unreachable'|'failed',description:null}>} */
export async function writeAgentAbout(connection,{name,description}) {
 if(!agentName.test(name)||typeof description!=='string') return {state:'failed',description:null};
 if(!reachable(connection)) return {state:'unreachable',description:null};
 try {
  const written=await manage(connection,`/api/profiles/${encodeURIComponent(name)}/description`,{method:'PUT',body:{description}});
  if(!written.response.ok||written.result?.ok!==true) return {state:stepState(written),description:null};
  return typeof written.result.description==='string'?{state:'written',description:written.result.description}:{state:'failed',description:null};
 } catch { return {state:'unreachable',description:null}; }
}

// A Company's own profile in the Engine (ADR 0014): its own home, so its memory, skills, sessions and model sign-in,
// with the one fixed set of tools every Agent gets (lib/agent-toolsets.mjs). It is made in steps like an Agent's (ADR 0011):
// the profile with its soul, then its Run API key, then its tools; each step answers ok:true. The name is derived from
// the Company's id and reserved for that Company, so a profile already there under that name is a create that stopped
// part way: it is finished, never left held. A profile is never cloned from another, so it starts with no memory.
// The tools are read back from the profile's own Run API (/v1/toolsets, the toolsets a Run there gets), and a profile
// that still offers a toolset that must stay off fails, so the worker never attaches a Company to it.
/** @param {any} connection @param {{name:string,soul:string,config:object,forbidden:string[],noSkills?:boolean}} profile */
export async function provideProfile(connection,{name,soul,config,forbidden,noSkills=false}) {
 if(!agentName.test(name)||typeof soul!=='string'||!config||typeof config!=='object'||!Array.isArray(forbidden)) return noProfile('failed');
 if(!reachable(connection)) return noProfile('unreachable');
 try {
  const made=await manage(connection,'/api/profiles',{method:'POST',body:{name,soul,...(noSkills?{no_skills:true}:{})}});
  const exists=made.response.status===400&&typeof made.result?.detail==='string'&&made.result.detail.includes('already exists');
  if(!exists&&!made.response.ok) return noProfile(made.response.status===400?'failed':refusal(made.response));
  if(!exists&&(made.result?.ok!==true||made.result.name!==name)) return noProfile('failed');
  const key=await manage(connection,`/api/env${query(name)}`,{method:'PUT',body:{key:'API_SERVER_KEY',value:connection.key}});
  if(!key.response.ok||key.result?.ok!==true) return noProfile(stepState(key));
  return await writeTools(connection,{name,config,forbidden});
 } catch { return noProfile('unreachable'); }
}
// A profile's tools are written again and read back after the worker found them different from the fixed set.
/** @param {any} connection @param {{name:string,config:object,forbidden:string[]}} profile */
export async function configureProfile(connection,{name,config,forbidden}) {
 if(!agentName.test(name)||!config||typeof config!=='object'||!Array.isArray(forbidden)) return noProfile('failed');
 if(!reachable(connection)) return noProfile('unreachable');
 try { return await writeTools(connection,{name,config,forbidden}); } catch { return noProfile('unreachable'); }
}
async function writeTools(connection,{name,config,forbidden}) {
 const written=await manage(connection,`/api/config${query(name)}`,{method:'PUT',body:{config}});
 if(!written.response.ok||written.result?.ok!==true) return noProfile(stepState(written));
 const read=await readToolsets({...connection,profile:name});
 if(read.state!=='found') return noProfile(read.state);
 const wanted=Array.isArray(config.platform_toolsets?.api_server)?config.platform_toolsets.api_server:null;
 // A name beside what was written may be one of the Company's own Apps' servers (#30), which the Engine can report as a
 // toolset of its own (`<server>` or `mcp-<server>`, lib/agent-toolsets.mjs appToolset). Only then is the profile's config
 // read, to know which servers gtmworks put there; one it cannot read is not judged, never wrongly failed.
 let apps=[];
 if(wanted!==null&&read.toolsets.some(toolset=>!wanted.includes(toolset))) {
  const held=await readProfileApps({...connection,profile:name});
  if(held.state!=='found') return noProfile(held.state);
  apps=held.apps;
 }
 // What the profile offers must be exactly what was written, its Apps aside: a tool the Engine kept on, and one it did not
 // turn on, both mean the write was not applied, so the profile is never recorded as confirmed.
 const offers=read.toolsets.filter(toolset=>!appToolset(toolset,apps));
 const differs=wanted!==null&&(offers.length!==new Set(wanted).size||wanted.some(toolset=>!offers.includes(toolset)));
 return differs||offers.some(toolset=>forbidden.includes(toolset))?{state:'failed',toolsets:read.toolsets}:{state:'configured',toolsets:read.toolsets};
}
// The toolsets a Run on this profile gets, as the profile's own Run API reports them (Hermes applies the platform list
// and then agent.disabled_toolsets). Any profile is read, a pasted one too: it is only read, never changed.
/** @param {{address:string,profile:string,key:string}} connection */
export async function readToolsets(connection) {
 if(!isHermesAddressAllowed(connection.address)||!/^[a-zA-Z0-9_-]{1,100}$/.test(connection.profile)) return noProfile('unreachable');
 try {
  const response=await engineRequest(connection,{path:onProfile(connection.profile,'/v1/toolsets')});
  const result=await boundedJson(response);
  // Hermes answers 404 for a profile it does not serve (it was removed, or its data was not restored with a backup).
  if(response.status===404&&typeof result?.error==='string'&&result.error.includes('Unknown or unconfigured profile')) return noProfile('missing');
  if(!response.ok) return noProfile([401,403].includes(response.status)?'refused':'unreachable');
  if(!Array.isArray(result?.data)) return noProfile('failed');
  return {state:'found',toolsets:result.data.filter(toolset=>toolset?.enabled===true&&typeof toolset.name==='string').map(toolset=>toolset.name)};
 } catch { return noProfile('unreachable'); }
}

// The Apps the profile holds (#30), by the Engine's own name for each server: gtmworks writes a connected App's MCP server
// into the profile's config (lib/app-catalogue.mjs appConfig), and the Engine may report that server as a toolset of its
// own beside the fixed set (`<server>`, or the registry's `mcp-<server>`). The catalogue's Apps and the servers an Owner
// added by address (#458, ADR 0021, read back as readApps does: any server key of the catalogue's shape) both count; a
// key of another shape is not one gtmworks wrote, so the tool check counts it as a difference. A server turned off is off.
// States as readToolsets' are.
/** @param {{address:string,profile:string,key:string,managementAddress?:string}} connection @returns {Promise<{state:'found',apps:string[]}|{state:'failed'|'refused'|'unreachable',apps:null}>} */
export async function readProfileApps(connection) {
 const none=state=>({state,apps:null});
 if(!reachable(connection)) return none('unreachable');
 try {
  const read=await manage(connection,`/api/config${query(connection.profile)}`);
  if(!read.response.ok) return none(refusal(read.response));
  const servers=read.result?.mcp_servers;
  if(servers===undefined||servers===null) return {state:'found',apps:[]};
  if(typeof servers!=='object'||Array.isArray(servers)) return none('failed');
  return {state:'found',apps:Object.entries(servers).filter(([key,server])=>(Boolean(appByKey(key))||appKey.test(key))&&server?.enabled!==false).map(([key])=>key)};
 } catch { return none('unreachable'); }
}

// Whether a Run on this profile can answer: the Engine lists the model providers this profile has a sign-in for, marks
// the profile's own provider is_current, and lists a current provider that lost its sign-in with authenticated:false
// (v0.23.0 GET /api/model/options, hermes_cli/web_routers/models.py 138-170 and inventory.py 731-746). A profile answers
// when its model is set and its current provider is listed without authenticated:false. The read may wait on the
// Engine's model catalogue (up to 15 s).
/** @param {any} connection @param {string} name @returns {Promise<'answers'|'noModel'|'refused'|'unreachable'>} */
async function canAnswer(connection,name) {
 try {
  const read=await manage(connection,`/api/model/options${query(name)}`,{timeout:20000});
  if(!read.response.ok) return [401,403].includes(read.response.status)?'refused':read.response.status===404?'noModel':'unreachable';
  const {model,providers}=read.result||{};
  const current=Array.isArray(providers)?providers.find(row=>row?.is_current===true):undefined;
  return typeof model==='string'&&model.trim()&&current&&current.authenticated!==false?'answers':'noModel';
 } catch { return 'unreachable'; }
}

// An Agent's own profile (ADR 0016), made as a Company's is: its soul, the connection's key as its Run API key, the one
// fixed set of tools every Agent gets, read back. Only an Agent's reserved name (ag-<agent id>) is provided, since a
// profile already there under it is finished, and finishing any other name would rewrite another profile's key and tools.
/** @param {any} connection @param {{name:string,instructions:string}} agent @returns {Promise<import('../engine.mjs').ProvidedAgent>} */
// `subagents` is the Agent's own sub-agents switch (#29): a profile made while it is on gets the delegation variant, so a
// move that records the switch as written has written it.
// `providers` names the Company's shared space and its keeper's profile: a profile that cannot answer yet is given the
// Company's Providers as they stand (giveProviders, #660), so an Agent Lead makes starts with no step from the Owner. One
// they give no model, or that could not be given them now, is made all the same and answers noModel.
export async function provideAgent(connection,{name,instructions,subagents=false,providers}) {
 if(!isAgentProfile(name)||typeof instructions!=='string') return {state:'failed'};
 const config=toolConfig({profile:name,subagents:subagents===true});
 const made=await provideProfile(connection,{name,soul:instructions,config,forbidden:config.agent.disabled_toolsets});
 if(made.state!=='configured') return {state:made.state==='failed'&&made.toolsets?'forbidden':made.state==='missing'?'failed':made.state};
 const answers=await canAnswer(connection,name);
 if(!providers||!['answers','noModel'].includes(answers)) return {state:answers==='answers'?'provided':answers};
 // Given even to a profile that answers already, so it holds the Company's keys its Fallback model may need.
 const given=await giveProviders(connection,{name,...providers});
 return {state:given.state==='provided'||answers==='answers'?'provided':'noModel'};
}

// An Agent's own profile given the Company's Providers as they stand (#660, spec #611; GLOSSARY: Provider). A
// subscription needs nothing: it is the Engine root's, which every profile reads, in the Owner's order (ADR 0018, #621).
// Each API key the Company's shared space holds is read on the Engine's own reveal route and written straight into the
// profile, as an Agent's design profile is given its Agent's (designAccess): it never leaves this process or reaches a
// log. A profile with no model of its own, or one it cannot answer with, then takes the model the Company's keeper
// (Lead) runs on, or, when that one names none or a custom endpoint no route gives back, the first model the space lists
// for a key it holds. The Fallback model reaches it from the worker as it reaches every Agent's profile (#622). It is
// given the Company's speech too (giveSpeech, #863): the speech keys and the `stt` options the space holds.
// `provided` once the profile can answer; `noModel` when the Company has no account that gives it a model.
/** @param {any} connection @param {{name:string,space:string,keeper:string}} target @returns {Promise<import('../engine.mjs').ProvidedAgent>} */
export async function giveProviders(connection,{name,space,keeper}) {
 if(!isAgentProfile(name)||typeof space!=='string'||!spaceName.test(space)||typeof keeper!=='string'||!keyProfile.test(keeper)||keeper.startsWith('cs-')) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const table=await providerTable(connection,space);
  if(table.state!=='found') return {state:spaceState(table.state)};
  const held=table.rows.filter(row=>row.set);
  const copied=await copyKeys(connection,{from:space,to:name,rows:held});
  if(copied) return {state:copied};
  const spoken=await giveSpeech(connection,{from:space,to:name,given:held.map(row=>row.env)});
  if(spoken) return {state:spoken};
  // A model of the profile's own that answers is kept; one that cannot is replaced, as a missing one is.
  const before=await canAnswer(connection,name);
  if(before!=='noModel') return {state:before==='answers'?'provided':before};
  const models=await readProfileModels(connection,[name,keeper]);
  if(models.state!=='found') return {state:models.state};
  const own=models.models?.[name]; const lead=models.models?.[keeper];
  const pick=lead&&lead.provider!=='custom'?lead:await firstKeyModel(connection,space,held);
  if(!pick||own&&own.provider===pick.provider&&own.model===pick.model) return {state:'noModel'};
  const picked=await manage(connection,`/api/profiles/${encodeURIComponent(name)}/model`,{method:'PUT',body:{provider:pick.provider,model:pick.model}});
  if(!picked.response.ok||picked.result?.ok!==true) return {state:stepState(picked)};
  const answers=await canAnswer(connection,name);
  return {state:answers==='answers'?'provided':answers};
 } catch { return {state:'unreachable'}; }
}
// Each of `rows`, the provider keys one profile holds, read on the Engine's own reveal route and written straight into
// another profile: the value never leaves this process or reaches a log. Null when done, else the state it stopped in.
/** @param {any} connection @param {{from:string,to:string,rows:{env:string}[]}} copy */
export async function copyKeys(connection,{from,to,rows}) {
 for(const row of rows) {
  const revealed=await revealEnv(connection,from,row.env);
  if(typeof revealed.value!=='string') return revealed.state;
  const written=await manage(connection,`/api/env${query(to)}`,{method:'PUT',body:{key:row.env,value:revealed.value}});
  if(!written.response.ok||written.result?.ok!==true) return stepState(written);
 }
 return null;
}
// The Company's speech (#430, #863) as its shared space holds it: each speech provider's key the space holds (one a
// Provider row already gave, as Groq's, is not copied again) and the space's own `stt` section, the provider and every
// option the Owner set, so an Agent made after a save transcribes as every other Agent of the Company does. A space with
// no `stt` of its own gives nothing. Null when done, else the state it stopped in.
/** @param {any} connection @param {{from:string,to:string,given:string[]}} copy */
async function giveSpeech(connection,{from,to,given}) {
 const [config,env]=await Promise.all([manage(connection,`/api/config${query(from)}&include_defaults=false`),manage(connection,`/api/env${query(from)}`)]);
 if(!config.response.ok) return stepState(config);
 if(!env.response.ok) return stepState(env);
 const stt=config.result?.stt;
 if(!stt||typeof stt!=='object'||Array.isArray(stt)) return null;
 const rows=Object.values(speechEnvs).filter(name=>!given.includes(name)&&env.result?.[name]?.is_set===true).map(name=>({env:name}));
 const copied=await copyKeys(connection,{from,to,rows});
 if(copied) return copied;
 const written=await manage(connection,`/api/config${query(to)}`,{method:'PUT',body:{config:{stt}}});
 return written.response.ok&&written.result?.ok===true?null:stepState(written);
}
// One variable of a profile's .env, read on the Engine's reveal route: its value, or the state the read stopped in;
// `absent` when the Engine's 404 says the profile holds no such variable. The value stays in this process.
/** @param {any} connection @param {string} profile @param {string} key @returns {Promise<{value:string,state?:undefined,absent?:undefined}|{value:null,state:string,absent:boolean}>} */
export async function revealEnv(connection,profile,key) {
 const revealed=await manage(connection,'/api/env/reveal',{method:'POST',body:{key,profile}});
 return revealed.response.ok&&typeof revealed.result?.value==='string'?{value:revealed.result.value}:{value:null,state:stepState(revealed),absent:revealed.response.status===404};
}
/** @param {any} connection @param {string} space @param {{provider:string}[]} held */
async function firstKeyModel(connection,space,held) {
 for(const row of held) {
  const model=await defaultModel(connection,space,row.provider);
  if(model) return {provider:row.provider,model};
 }
 return null;
}

// DELETE /api/profiles/<name> (v0.23.0 hermes_cli/web_routers/profiles.py 984-1002): ok is removed, also with
// settlement_pending, whose profile home is already gone; 404 is missing; 400 (the default profile, a name that is not a
// profile name) and a refused key are refused; anything else, such as the 500 of a gateway that still runs the profile,
// may pass and is unreachable. The Engine waits up to 10 s for the profile's gateway to stop.
/** @param {any} connection @param {string} name @returns {Promise<import('../engine.mjs').RemovedAgent>} */
export async function removeAgent(connection,name) {
 if(typeof name!=='string'||!agentName.test(name)||name==='default') return {state:'refused'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const removed=await manage(connection,`/api/profiles/${encodeURIComponent(name)}`,{method:'DELETE',timeout:20000});
  // The Agent's Open Design profile (#544) goes with it, also when the Agent's own profile is already gone; one that cannot
  // be removed now leaves the removal unfinished, so it is asked again.
  if(removed.response.ok&&removed.result?.ok===true||removed.response.status===404) {
   const design=await removeDesignProfile(connection,name).catch(()=>'unreachable');
   if(design!=='disconnected') return {state:'unreachable'};
  }
  if(removed.response.ok&&removed.result?.ok===true) return {state:'removed'};
  if(removed.response.status===404) return {state:'missing'};
  return {state:[400,401,403].includes(removed.response.status)?'refused':'unreachable'};
 } catch { return {state:'unreachable'}; }
}
