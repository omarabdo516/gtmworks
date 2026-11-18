import { hermesAt } from './bundled-hermes.mjs';
import { signInTarget } from './company-sign-in.mjs';
import { readConfig, readSavedConfig, readConfigSchema, readConfigDefaults, writeConfig, readModels, readProfileModels, writeProfileModel } from './hermes.mjs';
import { settingLabels } from './engine-setting-labels.mjs';
import { effortDefault, effortLevels, knownEffort } from './engine-effort.mjs';

// The Engine settings gtmworks shows and changes (#125, ADR 0016): only the ones on this list, each with the key the
// Engine keeps it under, whether the Engine holds it per profile or for the whole install, the type and choices its own
// schema gives, and the limits its schema does not carry (with the source line that enforces them). The Engine is
// reached only through lib/hermes.mjs (ADR 0008); a Company's settings live in its Agent profiles and its shared space,
// because the Engine has no Company level. Keys gtmworks itself owns are never here and a write naming one is refused
// before any call.
/** @typedef {{key:string,where:'profile'|'install',type:'string'|'number'|'boolean'|'select',label:string,source?:string,choices?:string[],default?:unknown,limits?:{min?:number,max?:number,integer?:boolean,source:string}}} EngineSetting */
/** @type {Readonly<EngineSetting[]>} */
export const engineSettings=Object.freeze([
 {key:'model',where:'profile',type:'string',label:settingLabels.model,source:'hermes_cli/web_routers/profiles.py 1056-1068'},
 {key:'delegation.model',where:'profile',type:'string',label:settingLabels['delegation.model'],source:'hermes_cli/config_defaults.py 1316'},
 {key:'delegation.provider',where:'profile',type:'string',label:settingLabels['delegation.provider'],source:'hermes_cli/config_defaults.py 1317'},
 {key:'delegation.max_concurrent_children',where:'profile',type:'number',label:settingLabels['delegation.max_concurrent_children'],source:'hermes_cli/config_defaults.py 1359',
  limits:{min:1,integer:true,source:'tools/delegate_tool_config.py 104-117'}},
 {key:'delegation.reasoning_effort',where:'profile',type:'select',label:settingLabels['delegation.reasoning_effort'],source:'hermes_cli/config_defaults.py 1357'},
 {key:'delegation.max_spawn_depth',where:'profile',type:'number',label:settingLabels['delegation.max_spawn_depth'],source:'hermes_cli/config_defaults.py 1366',
  limits:{min:1,integer:true,source:'tools/delegate_tool_config.py 204-217'}},
 {key:'memory.memory_enabled',where:'profile',type:'boolean',label:settingLabels['memory.memory_enabled'],source:'hermes_cli/config_defaults.py 1296-1311'},
 {key:'memory.memory_char_limit',where:'profile',type:'number',label:settingLabels['memory.memory_char_limit'],source:'hermes_cli/config_defaults.py 1296-1311',
  limits:{integer:true,source:'tools/memory_tool.py 56'}},
 {key:'memory.write_approval',where:'profile',type:'boolean',label:settingLabels['memory.write_approval'],source:'hermes_cli/config_defaults.py 1303'},
 {key:'skills.write_approval',where:'profile',type:'boolean',label:settingLabels['skills.write_approval'],source:'hermes_cli/config_defaults.py 1467'},
 {key:'display.personality',where:'profile',type:'string',label:settingLabels['display.personality'],source:'hermes_cli/config_defaults.py 805'},
 {key:'timezone',where:'profile',type:'select',label:settingLabels.timezone,source:'hermes_cli/config_defaults.py 1512'},
 // The Engine reads these two but its schema does not carry them (#125, #162, #179): the source line beside each decides
 // its choices and how an absent value reads, so the list never invents a setting.
 {key:'agent.reasoning_effort',where:'profile',type:'select',label:settingLabels['agent.reasoning_effort'],source:'hermes_constants.py 1073',
  choices:[...effortLevels],default:effortDefault},
 {key:'tts.speed',where:'profile',type:'number',label:settingLabels['tts.speed'],source:'tools/tts_tool_providers.py 199',default:1},
 {key:'stt.language',where:'profile',type:'string',label:settingLabels['stt.language'],source:'hermes_cli/config_defaults.py 1148'},
]);

// An Agent's learning mode (#28) is two listed settings together: both off means it saves its notes and Skill writes by
// itself, both on means it asks first and the Engine stages them. One of each is mixed, and is shown as it reads rather
// than guessed at.
const learningSettings=Object.freeze(['memory.write_approval','skills.write_approval']);

// What gtmworks keeps itself, so a value the Engine would take is never a gtmworks setting: the tool lists, the apps, the
// shared Skills folder, and every key, sign-in, approval, terminal and gateway key. `memory.write_approval` and
// `skills.write_approval` are settings and stay listed; the Engine's `approvals.*` is not.
const ownedPrefixes=['agent.disabled_toolsets','platform_toolsets','toolsets','skills.external_dirs','skills.create_dir','skills.auto_load',
 'mcp_servers','mcp','providers','credential_pool_strategies','auth','approvals','terminal','gateway','security','secrets','vault',
 'delegation.api_key','delegation.base_url','delegation.backends','delegation.api_mode'];
const ownedLeaf=/(^|\.)(api_key|token|secret|password|passwd|credential|credentials)(\.|$)/i;
/** @param {unknown} key */
export function engineOwnsSetting(key) {
 if(typeof key!=='string'||!key) return false;
 const lower=key.toLowerCase();
 if(ownedLeaf.test(key)||/(?:^|_)api_key$|(?:^|_)token$|(?:^|_)secret$/i.test(key)) return true;
 return ownedPrefixes.some(prefix=>lower===prefix||lower.startsWith(`${prefix}.`));
}

/** @param {unknown} key @param {EngineSetting[]} list */
const settingEntry=(key,list=engineSettings)=>typeof key==='string'?list.find(entry=>entry.key===key):undefined;
const at=(object,key)=>key.split('.').reduce((found,part)=>found&&typeof found==='object'?found[part]:undefined,object);
// The Engine normalises a dict-form model to its string form on the way out (web_server_config.py 587-599).
const valueAt=(config,key)=>key==='model'&&config?.model&&typeof config.model==='object'?(config.model.default??config.model.name??''):at(config,key);
const configOf=(key,value)=>{ const out={}; let into=out; const parts=key.split('.'); parts.forEach((part,index)=>{ if(index===parts.length-1) into[part]=value; else into=into[part]={}; }); return out; };

// Type, choices and limits are checked before a write; `choices` is the Engine's schema's when the list does not state
// its own. Empty string means the value is usable.
/** @param {EngineSetting} entry @param {unknown} value @param {string[]|null} [choices] */
function settingProblem(entry,value,choices=entry.choices??null) {
 if(entry.type==='string') return typeof value==='string'?'':'type';
 if(entry.type==='boolean') return typeof value==='boolean'?'':'type';
 if(entry.type==='number') {
  if(typeof value!=='number'||!Number.isFinite(value)) return 'type';
  if(entry.limits?.integer&&!Number.isInteger(value)) return 'type';
  if(entry.limits?.min!==undefined&&value<entry.limits.min) return 'limit';
  if(entry.limits?.max!==undefined&&value>entry.limits.max) return 'limit';
  return '';
 }
 if(entry.type==='select') return Array.isArray(choices)&&choices.includes(/** @type {string} */(value))?'':'choice';
 return 'type';
}

// What the list says the pinned Engine has, checked against a schema and defaults it serves (tests/engine-schema.json
// holds the release's own; the install check reads the running one). Empty means every listed setting is there with the
// type and default the list names; an entry the schema lacks must carry its source line and its own choices.
/** @param {EngineSetting[]} list @param {{fields?:Record<string,any>}} schema @param {Record<string,unknown>} defaults */
export function settingsSchemaProblems(list,schema,defaults) {
 const problems=[];
 for(const entry of list) {
  const field=schema?.fields?.[entry.key];
  if(field) {
   if(field.type!==entry.type) problems.push(`${entry.key}: Engine type ${String(field.type)} is not ${entry.type}`);
   if(entry.default!==undefined&&at(defaults,entry.key)!==entry.default) problems.push(`${entry.key}: Engine default is not the list's`);
   continue;
  }
  if(typeof entry.source!=='string'||!entry.source) problems.push(`${entry.key}: missing from the Engine schema and names no source`);
  if(entry.type==='select'&&!Array.isArray(entry.choices)) problems.push(`${entry.key}: missing from the Engine schema and states no choices`);
 }
 return problems;
}

const readFailure=state=>({state,settings:null});
const drivers={config:readConfig,saved:readSavedConfig,schema:readConfigSchema,defaults:readConfigDefaults,write:writeConfig,profileModels:readProfileModels};
const writeState=state=>({state});

// Every listed setting as this profile holds it: the Engine's schema, its defaults and the profile's merged config,
// reduced to the list. A setting held for the whole install is read from the root profile and marked; a value whose key
// ends api_key is never returned, as the Engine returns those unredacted.
/** @param {any} connection @param {{list?:EngineSetting[],installProfile?:string,driver?:Partial<typeof drivers>}} [request] */
export async function readSettings(connection,{list=engineSettings,installProfile='default',driver={}}={}) {
 const use={...drivers,...driver};
 if(!connection||typeof connection.address!=='string'||typeof connection.profile!=='string') return readFailure('failed');
 const [schema,defaults,config]=await Promise.all([use.schema(connection),use.defaults(connection),use.config(connection)]);
 for(const read of [schema,defaults,config]) if(read.state!=='found') return readFailure(read.state);
 // The model is not read from the config (its value there is a dict): it is the profile's own model, as the profile list
 // answers it, so the reader returns provider/model exactly as the write takes it (profiles.py 1056-1068).
 let profileModel=null;
 if(list.some(entry=>entry.key==='model'&&entry.where==='profile')) {
  const read=await use.profileModels(connection,[connection.profile]);
  const found=read.state==='found'?read.models?.[connection.profile]:null;
  profileModel=found?`${found.provider}/${found.model}`:null;
 }
 let root=config;
 if(list.some(entry=>entry.where==='install')&&connection.profile!==installProfile) {
  root=await use.config({...connection,profile:installProfile});
  if(root.state!=='found') return readFailure(root.state);
 }
 /** @type {any[]} */
 const settings=[];
 for(const entry of list) {
  if(/api_key$/i.test(entry.key)) continue;
  const field=schema.schema?.fields?.[entry.key];
  const choices=entry.choices??(field&&Array.isArray(field.options)?field.options.filter(choice=>typeof choice==='string'):null);
  const fallback=entry.default!==undefined?entry.default:valueAt(defaults.config,entry.key);
  const current=entry.key==='model'&&entry.where==='profile'?profileModel:valueAt(entry.where==='install'?root.config:config.config,entry.key);
  settings.push({key:entry.key,where:entry.where,type:entry.type,choices,default:fallback===undefined?null:fallback,
   value:current===undefined?fallback??null:current,limits:entry.limits??null,label:entry.label});
 }
 return {state:'found',settings};
}

/** @param {{key:string,value:unknown}[]|null|undefined} settings */
export function learningModeOf(settings) {
 const values=learningSettings.map(key=>settings?.find(setting=>setting.key===key)?.value);
 if(values.some(value=>typeof value!=='boolean')) return null;
 return values[0]===values[1]?(values[0]?'ask':'auto'):'mixed';
}

// One listed value written into one profile's config and read back before it counts as saved. A key not on the list, one
// gtmworks owns, and one held for the whole install are refused without a request; a bad type, choice or limit too. Only
// the changed key is sent, and the read-back is the saved values alone (include_defaults=false).
/** @param {any} connection @param {{setting:unknown,value:unknown,list?:EngineSetting[],driver?:Partial<typeof drivers>}} request */
export async function writeSetting(connection,{setting,value,list=engineSettings,driver={}}) {
 const use={...drivers,...driver};
 if(engineOwnsSetting(setting)) return writeState('owned');
 const entry=settingEntry(setting,list);
 if(!entry) return writeState('unknown');
 if(entry.where!=='profile') return writeState('installOnly');
 // A profile's model has its own route; a config write would hold a dict the Engine does not apply (profiles.py 1056).
 if(entry.key==='model') return writeState('profileOnly');
 let choices=entry.choices??null;
 if(entry.type==='select'&&!choices) {
  const schema=await use.schema(connection);
  if(schema.state!=='found') return writeState(schema.state);
  const options=schema.schema?.fields?.[entry.key]?.options;
  choices=Array.isArray(options)?options.filter(choice=>typeof choice==='string'):null;
 }
 const problem=settingProblem(entry,value,choices);
 if(problem) return {state:'invalid',problem};
 const before=await use.config(connection);
 if(before.state!=='found') return writeState(before.state);
 const old=valueAt(before.config,entry.key)??entry.default??null;
 if(old===value) return {state:'unchanged',old,new:value};
 const written=await use.write(connection,configOf(entry.key,value));
 if(written.state!=='written') return {state:written.state,old};
 const after=await use.saved(connection);
 if(after.state!=='found') return {state:after.state,old};
 const saved=valueAt(after.config,entry.key);
 return saved===value?{state:'saved',old,new:value}:{state:'mismatch',old};
}

// A Company's Agents in the database: each with its own profile, and whether that profile is its own (an Agent still
// sharing the Company's profile changes it for every Agent on it).
/** @param {any} db @param {string} company */
async function companyAgents(db,company) {
 const {data,error}=await db.rpc('company_app_agents',{c:company});
 return error||!Array.isArray(data)?null:data.map(row=>({agent:row.agent,name:row.name,profile:row.profile,own:row.own===true}));
}
/** @param {any} db @param {string} company @param {string} agent @param {string|null} setting @param {unknown} oldValue @param {unknown} newValue */
async function logChange(db,company,agent,setting,oldValue,newValue) {
 try {
  const {error}=await db.rpc('log_engine_setting',{c:company,agent,setting,old_value:oldValue,new_value:newValue});
  if(error) console.error('Agent setting change not logged',error.code||'');
  return !error;
 } catch { console.error('Agent setting change not logged'); return false; }
}
const written=state=>state==='saved'||state==='unchanged';
const failureOf=state=>state==='refused'?{status:502,body:{error:'settingFailed'}}:state==='unreachable'?{status:503,body:{error:'settingFailed'}}
 :{status:502,body:{error:state==='mismatch'?'settingMismatch':'settingFailed'}};

// What a member reads: one Agent's listed settings, or every Agent's when no Agent is named. A profile that cannot be
// read now has null settings, never an empty list; a Company with no profile of its own in the Engine has null agents.
/** @param {any} db @param {{company:string,agent?:string|null,hermes?:{address:string,key:string}|null,driver?:object,list?:EngineSetting[]}} request */
export async function readAgentSettings(db,{company,agent=null,hermes=hermesAt(),driver={},list=engineSettings}) {
 const target=await signInTarget(db,company,hermes);
 if(!target) return {agents:null};
 const rows=await companyAgents(db,company);
 if(!rows) return {agents:null};
 const wanted=typeof agent==='string'&&agent?rows.filter(row=>row.agent===agent):rows;
 const reads=new Map();
 const readFor=profile=>{ if(!reads.has(profile)) reads.set(profile,readSettings({...target,profile},{list,driver})); return reads.get(profile); };
 const agents=await Promise.all(wanted.map(async row=>{
  const read=await readFor(row.profile);
  return {id:row.agent,name:row.name,own:row.own,settings:read.state==='found'?read.settings:null};
 }));
 return {agents};
}

// The Company's shared space in the Engine, named from its id as the Company's profiles are (ADR 0016): it holds the
// default model every Agent without a choice of its own runs on.
const spaceOf=company=>`cs-${company.replaceAll('-','')}`;
// A model travels as "provider/model", as the Engine's profile list and its Run API take it; none is a slash-less value.
const modelPair=/^([a-z0-9][a-z0-9._-]{0,63})\/([^\s/][^\s]{0,199})$/;
const pairOf=value=>{ const found=typeof value==='string'?modelPair.exec(value):null; return found?{provider:found[1],model:found[2]}:null; };
const modelText=found=>found?`${found.provider}/${found.model}`:null;
const modelDrivers={profileModels:readProfileModels,options:readModels,writeModel:writeProfileModel};
/** @param {any} db @param {string} company */
async function modelRows(db,company) {
 const {data,error}=await db.rpc('company_agent_models',{c:company});
 return error||!Array.isArray(data)?null:data.map(row=>({agent:row.agent,name:row.name,profile:row.profile,own:row.own===true,
  choosable:row.choosable===true,model_choice:typeof row.model_choice==='string'?row.model_choice:null,subagents:row.subagents===true}));
}
/** @param {{code?:string}|null} error */
const rpcFailure=error=>error?.code==='42501'?{status:403,body:{error:'settingNotAllowed'}}
 :error?.code==='P0002'?{status:404,body:{error:'settingAgentUnknown'}}:{status:502,body:{error:'settingFailed'}};

// What the "Subscription and models" section reads (#29, #179): the Company's default model from its shared space, and
// each Agent's own model, its thinking level, whether it chose a model, and — for the Owner — the choices that profile's
// Engine lists. Sub-agents are off unless the Owner turned them on for that Agent; only then are the Engine's five
// sub-agent settings read.
/** @param {any} db @param {{company:string,agent?:string|null,owner?:boolean,hermes?:{address:string,key:string}|null,driver?:object}} request */
export async function readCompanyModels(db,{company,agent=null,owner=false,hermes=hermesAt(),driver={}}) {
 const use={...modelDrivers,...driver};
 const target=await signInTarget(db,company,hermes);
 if(!target) return {models:null};
 const rows=await modelRows(db,company);
 if(!rows) return {models:null};
 const wanted=typeof agent==='string'&&agent?rows.filter(row=>row.agent===agent):rows;
 const space=spaceOf(company);
 const read=await use.profileModels(target,[space,...new Set(wanted.map(row=>row.profile))]);
 if(read.state!=='found') return {models:null};
 const optionsAt=async profile=>{ if(!owner) return []; const found=await use.options({...target,profile}); return found.state==='found'?found.models:[]; };
 const delegationSettings=engineSettings.filter(entry=>entry.key.startsWith('delegation.'));
 const effortSettings=engineSettings.filter(entry=>entry.key==='agent.reasoning_effort');
 const reads=new Map();
 const settingsAt=(profile,subagents)=>{
  const key=`${profile}:${subagents?'subagents':'agent'}`;
  if(!reads.has(key)) reads.set(key,readSettings({...target,profile},{list:subagents?[...effortSettings,...delegationSettings]:effortSettings,driver:use}));
  return reads.get(key);
 };
 const agents=await Promise.all(wanted.map(async row=>{
  const settings=await settingsAt(row.profile,row.subagents);
  const held=settings.state==='found'?settings.settings:[];
  const effort=held.find(setting=>setting.key==='agent.reasoning_effort')?.value;
  return {id:row.agent,name:row.name,own:row.own,choosable:row.choosable,model:modelText(read.models?.[row.profile]),
   choice:row.model_choice,subagents:row.subagents,
   options:row.choosable?await optionsAt(row.profile):[],
   // An absent level reads as the reference's medium; an Engine that could not be read leaves it unknown (null).
   effort:settings.state==='found'?knownEffort(effort)??effortDefault:null,
   settings:row.subagents?held.filter(setting=>setting.key.startsWith('delegation.')):[]};
 }));
 return {models:{default:{model:modelText(read.models?.[space]),options:await optionsAt(space)},agents}};
}

// An Owner changes one Agent's model, or the Company's default. An Agent's own choice is written to its own profile and
// remembered here as that choice; the default is written to the shared space and to every Agent profile whose Agent has
// no choice of its own, because the Engine has no Company level. Each write is read back from the profile list and logged
// per Agent it changed. An Agent that keeps the Company profile has no model of its own: the default is its model.
/** @param {any} db @param {{company:string,agent?:string|null,value:unknown,hermes?:{address:string,key:string}|null,driver?:object}} request */
async function changeCompanyModel(db,{company,agent=null,value,hermes=hermesAt(),driver={}}) {
 const use={...modelDrivers,...driver};
 const pair=value===null?null:pairOf(value);
 if(value!==null&&!pair) return {status:400,body:{error:'settingInvalid',problem:'type'}};
 const target=await signInTarget(db,company,hermes);
 if(!target) return {status:409,body:{error:'settingNoEngine'}};
 const rows=await modelRows(db,company);
 if(!rows) return {status:502,body:{error:'settingFailed'}};
 const space=spaceOf(company);
 const current=await use.profileModels(target,[space,...new Set(rows.map(row=>row.profile))]);
 if(current.state!=='found') return failureOf(current.state);
 // The Company default as the Engine holds it in the shared space; an Agent following it runs on this model.
 const fallback=pairOf(modelText(current.models?.[space]));
 const at=row=>modelText(current.models?.[row.profile]);
 if(typeof agent==='string'&&agent) {
  const row=rows.find(found=>found.agent===agent);
  if(!row) return {status:404,body:{error:'settingAgentUnknown'}};
  if(!row.choosable||!row.own) return {status:409,body:{error:'settingAgentShared'}};
  const chosen=pair??fallback;
  if(!chosen) return {status:409,body:{error:'settingNoDefault'}};
  const before=at(row);
  const writtenState=await use.writeModel(target,{profile:row.profile,...chosen});
  if(writtenState.state!=='saved') return failureOf(writtenState.state);
  // Remembered only after the Engine's read-back, so the record never says a choice the Engine does not hold.
  const {error}=await db.rpc('set_agent_model',{agent:row.agent,model:pair?value:null});
  if(error) return rpcFailure(error);
  const after=pair?value:null;
  if(before!==modelText(chosen)) await logChange(db,company,row.agent,'model',before,after);
  return {status:200,body:{setting:'model',agent:row.agent,model:after}};
 }
 // The default: the shared space first, then every Agent profile without a choice of its own.
 const following=rows.filter(row=>!row.model_choice);
 const targets=[space,...new Set(following.map(row=>row.profile))];
 /** @type {Map<string,any>} */
 const states=new Map();
 for(const profile of targets) states.set(profile,await use.writeModel(target,{profile,.../** @type {{provider:string,model:string}} */(pair)}));
 const spaceState=states.get(space);
 if(spaceState?.state!=='saved') return failureOf(spaceState?.state);
 let logged=true;
 for(const row of following) {
  if(states.get(row.profile)?.state!=='saved'||at(row)===value) continue;
  logged=(await logChange(db,company,row.agent,'model',at(row),value))&&logged;
 }
 return {status:200,body:{setting:'model',value,space:true,
  agents:rows.map(row=>({agent:row.agent,name:row.name,written:row.model_choice===null&&written(states.get(row.profile)?.state)})),
  ...(logged?{}:{logged:false})}};
}

// An Owner turns the Engine's sub-agents on or off for one Agent (#29). gtmworks keeps the choice; the worker writes the
// `delegation` toolset into that Agent's own profile and reads it back, and no Run starts there until it does. Terminal,
// files and code execution stay off for the Agent and for its children either way (lib/agent-levels.mjs).
/** @param {any} db @param {{company:string,agent?:string|null,value:unknown}} request */
async function changeAgentSubagents(db,{company,agent=null,value}) {
 if(typeof value!=='boolean'||typeof agent!=='string'||!agent) return {status:400,body:{error:'settingInvalid'}};
 const rows=await modelRows(db,company);
 if(!rows) return {status:502,body:{error:'settingFailed'}};
 const row=rows.find(found=>found.agent===agent);
 if(!row) return {status:404,body:{error:'settingAgentUnknown'}};
 if(!row.choosable) return {status:409,body:{error:'settingAgentShared'}};
 const {error}=await db.rpc('set_agent_subagents',{agent,enabled:value});
 if(error) return rpcFailure(error);
 if(row.subagents!==value) await logChange(db,company,agent,'subagents',row.subagents,value);
 return {status:200,body:{setting:'subagents',agent,subagents:value}};
}

// An Owner changes one setting for one Agent, or for the whole Company: the same value written to each Agent profile and
// the Company's shared space, because the Engine has no Company level. The answer names each Agent and whether the value
// reached it; a change the Engine holds is one row in the Company log per Agent it changed. No other Company's profile is
// ever named. A model and the sub-agent switch go through their own Engine routes (changeCompanyModel, the database's
// set_agent_subagents); the delegation settings are written only for an Agent whose Owner turned sub-agents on.
/** @param {any} db @param {{company:string,agent?:string|null,setting:unknown,value:unknown,hermes?:{address:string,key:string}|null,driver?:object,list?:EngineSetting[]}} request */
export async function changeCompanySetting(db,{company,agent=null,setting,value,hermes=hermesAt(),driver={},list=engineSettings}) {
 if(engineOwnsSetting(setting)) return {status:400,body:{error:'settingNotAllowed'}};
 const subagents=setting==='subagents';
 const entry=subagents?null:settingEntry(setting,list);
 if(!subagents&&!entry) return {status:400,body:{error:'settingUnknown'}};
 if(entry&&entry.where!=='profile') return {status:409,body:{error:'settingInstallOnly'}};
 // Checked on the server for every write: a person who is not an active Owner of the Company changes nothing.
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return {status:403,body:{error:'settingNotAllowed'}};
 if(subagents) return changeAgentSubagents(db,{company,agent,value});
 if(entry.key==='model') return changeCompanyModel(db,{company,agent,value,hermes,driver});
 if(entry.key.startsWith('delegation.')) {
  if(typeof agent!=='string'||!agent) return {status:409,body:{error:'settingSubagentsOff'}};
  const rows=await modelRows(db,company);
  const row=rows?.find(found=>found.agent===agent);
  if(!row) return {status:404,body:{error:'settingAgentUnknown'}};
  if(!row.subagents) return {status:409,body:{error:'settingSubagentsOff'}};
 }
 const target=await signInTarget(db,company,hermes);
 if(!target) return {status:409,body:{error:'settingNoEngine'}};
 const rows=await companyAgents(db,company);
 if(!rows) return {status:502,body:{error:'settingFailed'}};
 const write=(profile)=>writeSetting({...target,profile},{setting,value,list,driver});
 if(typeof agent==='string'&&agent) {
  const row=rows.find(found=>found.agent===agent);
  if(!row) return {status:404,body:{error:'settingAgentUnknown'}};
  if(rows.some(found=>found.agent!==row.agent&&found.profile===row.profile)) return {status:409,body:{error:'settingAgentShared'}};
  const result=await write(row.profile);
  if(result.state==='invalid') return {status:400,body:{error:'settingInvalid',problem:result.problem}};
  if(result.state==='saved') await logChange(db,company,row.agent,/** @type {string} */(setting),result.old,result.new);
  if(!written(result.state)) return failureOf(result.state);
  return {status:200,body:{setting,agents:[{agent:row.agent,name:row.name,written:true}]}};
 }
 const agents=rows.map(row=>({...row}));
 const profiles=[...new Set(agents.map(row=>row.profile))];
 const space=`cs-${company.replaceAll('-','')}`;
 /** @type {Map<string,any>} */
 const states=new Map();
 for(const profile of profiles) states.set(profile,await write(profile));
 states.set(space,await write(space));
 let logged=true;
 for(const row of agents) {
  const result=states.get(row.profile);
  if(result?.state==='saved') logged=(await logChange(db,company,row.agent,/** @type {string} */(setting),result.old,result.new))&&logged;
 }
 const spaceState=states.get(space);
 return {status:200,body:{setting,value,agents:agents.map(row=>({agent:row.agent,name:row.name,written:written(states.get(row.profile)?.state)})),
  space:written(spaceState?.state),...(logged?{}:{logged:false})}};
}

// The Company's learning mode (#28): "ask first" is both write approvals on, "by itself" both off, written through
// changeCompanySetting to every Agent profile and the shared space, or to one Agent's profile for an override. The same
// Owner check, the same read-back and the same one log row per Agent and setting are #125's; a mode this version does
// not know is refused before any Engine call.
/** @param {any} db @param {{company:string,agent?:string|null,mode:unknown,hermes?:{address:string,key:string}|null,driver?:object,list?:EngineSetting[]}} request */
export async function changeLearningMode(db,{company,agent=null,mode,hermes=hermesAt(),driver={},list=engineSettings}) {
 if(mode!=='auto'&&mode!=='ask') return {status:400,body:{error:'learningModeInvalid'}};
 const value=mode==='ask';
 let answer={status:200,body:{mode}};
 for(const setting of learningSettings) {
  const result=await changeCompanySetting(db,{company,agent,setting,value,hermes,driver,list});
  if(result.status!==200) return result;
  answer={status:200,body:{mode,agents:result.body.agents,space:result.body.space,...(result.body.logged===false?{logged:false}:{})}};
 }
 return answer;
}
