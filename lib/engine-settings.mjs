import { hermesAt } from './bundled-hermes.mjs';
import { signInTarget } from './company-sign-in.mjs';
import { readConfig, readSavedConfig, readConfigSchema, readConfigDefaults, writeConfig } from './hermes.mjs';
import { settingLabels } from './engine-setting-labels.mjs';

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
  choices:['none','minimal','low','medium','high','xhigh','max','ultra'],default:'medium'},
 {key:'tts.speed',where:'profile',type:'number',label:settingLabels['tts.speed'],source:'tools/tts_tool_providers.py 199',default:1},
 {key:'stt.language',where:'profile',type:'string',label:settingLabels['stt.language'],source:'hermes_cli/config_defaults.py 1148'},
]);

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
const drivers={config:readConfig,saved:readSavedConfig,schema:readConfigSchema,defaults:readConfigDefaults,write:writeConfig};
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
  const current=valueAt(entry.where==='install'?root.config:config.config,entry.key);
  settings.push({key:entry.key,where:entry.where,type:entry.type,choices,default:fallback===undefined?null:fallback,
   value:current===undefined?fallback??null:current,limits:entry.limits??null,label:entry.label});
 }
 return {state:'found',settings};
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
  const {error}=await db.rpc('log_agent_setting',{c:company,agent,setting,old_value:oldValue,new_value:newValue});
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

// An Owner changes one setting for one Agent, or for the whole Company: the same value written to each Agent profile and
// the Company's shared space, because the Engine has no Company level. The answer names each Agent and whether the value
// reached it; a change the Engine holds is one row in the Company log per Agent it changed. No other Company's profile is
// ever named.
/** @param {any} db @param {{company:string,agent?:string|null,setting:unknown,value:unknown,hermes?:{address:string,key:string}|null,driver?:object,list?:EngineSetting[]}} request */
export async function changeCompanySetting(db,{company,agent=null,setting,value,hermes=hermesAt(),driver={},list=engineSettings}) {
 if(engineOwnsSetting(setting)) return {status:400,body:{error:'settingNotAllowed'}};
 const entry=settingEntry(setting,list);
 if(!entry) return {status:400,body:{error:'settingUnknown'}};
 if(entry.where!=='profile') return {status:409,body:{error:'settingInstallOnly'}};
 // Checked on the server for every write: a person who is not an active Owner of the Company changes nothing.
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return {status:403,body:{error:'settingNotAllowed'}};
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
