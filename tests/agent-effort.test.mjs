import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyEngine } from '../lib/engine/handle.mjs';
import { withNoEngine } from './engine-records.mjs';
import { withDriver, engineServing } from './engine-records.mjs';
import { readFileSync } from 'node:fs';
import { readConfig, readSavedConfig, readConfigSchema, readConfigDefaults, writeConfig } from '../lib/engine/config.mjs';
import { readProfileModels, readModels } from '../lib/engine/models.mjs';
import { engineSettings, readSettings, writeSetting, readCompanyModels } from '../lib/engine-settings.mjs';
import { changeAgentEffort } from '../lib/agent-effort.mjs';
import { effortDefault, effortHintKey, effortLabelKey, effortLevels, knownEffort } from '../lib/engine-effort.mjs';
import { companyProfile } from '../lib/agent-toolsets.mjs';
// A profile's handle on the Company's Engine, as the settings reader and writer take it.
const profileOf=async(/** @type {string} */ profile)=>/** @type {any} */(await companyEngine(company))?.on(profile);
// The driver calls a test answers its own way, by their names before #782, as the Engine handle names them.
const DRIVER={'config':'config.read','saved':'config.readSaved','schema':'config.schema','defaults':'config.defaults','write':'config.write','profileModels':'models.ofProfiles','options':'models.read','writeModel':'models.write','voices':'speech.voices','speak':'speech.speak','read':'skills.read','learned':'skills.learned'};

// #179: an Agent's thinking level is the key `agent.reasoning_effort` of its own Engine profile, written through #125's
// writeSetting (one key, read back) and never through a route of its own. The Engine's own source decides the eight
// choices (hermes_constants.py 1073: `none` plus `minimal`…`ultra`); an absent value reads as medium. Only the Owner
// changes it: check_agent_owner_setting before the Engine is written, and one log row with the old and new level.
const company='10000000-0000-0000-0000-000000000001';
const [lead,writer,helper]=['3b000000-0000-0000-0000-000000000011','3b000000-0000-0000-0000-000000000021','3b000000-0000-0000-0000-000000000031'];
const hex=id=>id.replaceAll('-','');
const space=`cs-${hex(company)}`;
const co=companyProfile(company);
const own=id=>`ag-${hex(id)}`;
const en=JSON.parse(readFileSync(new URL('../lib/messages/en.json',import.meta.url),'utf8'));
const ar=JSON.parse(readFileSync(new URL('../lib/messages/ar.json',import.meta.url),'utf8'));

const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:fake.settings.key});
const profileOn=(fake,name,config={})=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config,credentials:{}});
const driver=fake=>({
 config:target=>readConfig({...target,managementAddress:fake.managementAddress}),
 saved:target=>readSavedConfig({...target,managementAddress:fake.managementAddress}),
 schema:target=>readConfigSchema({...target,managementAddress:fake.managementAddress}),
 defaults:target=>readConfigDefaults({...target,managementAddress:fake.managementAddress}),
 write:(target,config)=>writeConfig({...target,managementAddress:fake.managementAddress},config),
 profileModels:(target,profiles)=>readProfileModels({...target,managementAddress:fake.managementAddress},profiles),
 options:target=>readModels({...target,managementAddress:fake.managementAddress}),
});
const requestsTo=(fake,method)=>fake.settings.managementRequests.filter(request=>request.method===method);

// The rows the database answers with (company_app_agents and company_agent_models): the main Agent keeps the Company
// profile, the writer its own, and the helper still shares the Company profile (nothing may be written for it alone).
const agentRows=()=>[
 {agent:lead,name:'Lead',profile:co,own:true,choosable:true,model_choice:null,subagents:false},
 {agent:writer,name:'Writer',profile:own(writer),own:true,choosable:true,model_choice:null,subagents:false},
 {agent:helper,name:'Helper',profile:co,own:false,choosable:false,model_choice:null,subagents:false},
];
function database({agents=agentRows(),refuse=null,target=true}={}) {
 const calls=[];
 const db={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='company_engine_target') return {data:target?[{profile:co,profiles:[]}]:[],error:null};
  if(name==='company_app_agents') return {data:agents,error:null};
  if(name==='company_agent_models') return {data:agents,error:null};
  if(name==='check_agent_owner_setting') return {data:null,error:refuse?{message:refuse}:null};
  if(name==='log_engine_setting') return {data:null,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 return {db,calls,logged:()=>calls.filter(call=>call.name==='log_engine_setting').map(call=>call.args)};
}

test('the eight levels are the Engine\'s own, with the reference\'s words and lines only where it words them', () => {
 assert.deepEqual(effortLevels,['none','minimal','low','medium','high','xhigh','max','ultra']);
 assert.equal(effortDefault,'medium');
 // The settings list reads the same constant, so no screen can invent a ninth level.
 assert.deepEqual(engineSettings.find(entry=>entry.key==='agent.reasoning_effort').choices,effortLevels);
 assert.equal(engineSettings.find(entry=>entry.key==='agent.reasoning_effort').default,effortDefault);
 assert.deepEqual(effortLevels.filter(level=>effortHintKey(level)!==null),['low','medium','high','max']);
 assert.equal(knownEffort('high'),'high');
 assert.equal(knownEffort('loud'),null);
 // Every level has a label in both catalogues, a key and never the raw config value.
 for(const level of effortLevels) {
  const key=effortLabelKey(level);
  assert.ok(typeof en[key]==='string'&&en[key],`${level} has an English label`);
  assert.ok(typeof ar[key]==='string'&&ar[key],`${level} has an Arabic label`);
  assert.notEqual(en[key],level,`${level}'s label is not its raw config value`);
  assert.doesNotMatch(en[key],/hermes|هيرمس|هرمس/i,`${level}'s label names no engine`);
 }
 for(const level of ['low','medium','high','max']) {
  const key=effortHintKey(level);
  assert.ok(typeof en[key]==='string'&&en[key],`${level} has an English line`);
  assert.ok(typeof ar[key]==='string'&&ar[key],`${level} has an Arabic line`);
 }
});

test('a profile reads its own level, an absent one reads as medium, and a write leaves every other key as it was', async () => {
 const fake=await engineServing(company);
 try {
  profileOn(fake,co,{agent:{reasoning_effort:'high',reasoning_overrides:{'openai/gpt-5.5':'max'},reasoning_echo:false},
   memory:{memory_char_limit:2600}});
  const read=await readSettings(await profileOf(co));
  assert.equal(read.state,'found');
  assert.equal(read.settings.find(setting=>setting.key==='agent.reasoning_effort').value,'high');
  const before=requestsTo(fake,'PUT').length;
  assert.deepEqual(await writeSetting(await profileOf(co),{setting:'agent.reasoning_effort',value:'low'}),
   {state:'saved',old:'high',new:'low'});
  const put=requestsTo(fake,'PUT').at(-1);
  assert.deepEqual(put.body,{config:{agent:{reasoning_effort:'low'}}},'only its own key is sent');
  assert.deepEqual(fake.settings.profiles.get(co).config,{agent:{reasoning_effort:'low',reasoning_overrides:{'openai/gpt-5.5':'max'},reasoning_echo:false},
   memory:{memory_char_limit:2600}},'every other key of the profile is as it was');
  assert.equal(requestsTo(fake,'PUT').length,before+1);
  // A profile that saved nothing reads the reference's medium, and so does one whose saved level is not the Engine's.
  profileOn(fake,co,{});
  assert.equal((await readSettings(await profileOf(co))).settings.find(setting=>setting.key==='agent.reasoning_effort').value,'medium');
  profileOn(fake,co,{agent:{reasoning_effort:'loud'}});
  assert.equal((await readSettings(await profileOf(co))).settings.find(setting=>setting.key==='agent.reasoning_effort').value,'loud',
   'the reader returns what the profile saved; the page reads an unknown level as medium');
 } finally { await fake.close(); }
});

test('the Owner saves a level: the Engine holds it and one log row has the old and the new', async () => {
 const fake=await engineServing(company);
 try {
  profileOn(fake,co,{agent:{reasoning_effort:'medium'},memory:{memory_char_limit:2600}});
  const {db,logged}=database();
  assert.deepEqual(await withDriver(DRIVER,driver(fake),()=>changeAgentEffort(db,{company,agent:lead,effort:'high'})),
   {state:'written',effort:'high'});
  assert.equal(fake.settings.profiles.get(co).config.agent.reasoning_effort,'high');
  assert.equal(fake.settings.profiles.get(co).config.memory.memory_char_limit,2600,'the rest of the profile is untouched');
  assert.deepEqual(logged(),[{c:company,agent:lead,setting:'agent.reasoning_effort',old_value:'medium',new_value:'high'}]);
  // The same level again is written without a second row: the Engine already holds it.
  assert.deepEqual(await withDriver(DRIVER,driver(fake),()=>changeAgentEffort(db,{company,agent:lead,effort:'high'})),
   {state:'written',effort:'high'});
  assert.equal(logged().length,1);
 } finally { await fake.close(); }
});

test('the models section reads each Agent\'s own level, an absent one as medium', async () => {
 const fake=await engineServing(company);
 try {
  for(const name of [space,co,own(writer)]) profileOn(fake,name);
  Object.assign(fake.settings.profiles.get(co),{provider:'openrouter',model:'openai/gpt-5.5'});
  Object.assign(fake.settings.profiles.get(own(writer)),{provider:'anthropic',model:'claude-opus-4-6'});
  fake.settings.profiles.get(co).config={agent:{reasoning_effort:'high'}};
  fake.settings.profiles.get(own(writer)).config={agent:{reasoning_effort:'loud'}};
  const {db}=database();
  const read=await withDriver(DRIVER,driver(fake),()=>readCompanyModels(db,{company,owner:false}));
  // Lead saved none and the Writer saved a level the Engine does not have: both read as the reference's Medium.
  assert.deepEqual(read.models.agents.map(agent=>[agent.name,agent.effort]),[['Lead','high'],['Writer','medium'],['Helper','high']]);
 } finally { await fake.close(); }
});

test('only the Owner changes the level: a shared profile, a refused Role and a bad value change nothing and log nothing', async () => {
 const fake=await engineServing(company);
 try {
  profileOn(fake,co,{agent:{reasoning_effort:'medium'}});
  const shared=database();
  assert.deepEqual(await withDriver(DRIVER,driver(fake),()=>changeAgentEffort(shared.db,{company,agent:helper,effort:'high'})),
   {state:'notOwn',effort:null},'an Agent still on the shared Company profile is refused');
  assert.deepEqual(shared.logged(),[]);
  const refused=database({refuse:'agentSettingNotAllowed'});
  assert.deepEqual(await withDriver(DRIVER,{config:async()=>assert.fail('the Engine is not read'),write:async()=>assert.fail('the Engine is not written')},()=>changeAgentEffort(refused.db,{company,agent:lead,effort:'high'})),
   {state:'notAllowed',effort:null},'a Manager, a Contributor and a Viewer are refused before the Engine is asked');
  assert.deepEqual(refused.logged(),[]);
  const noEngine=database({target:false});
  assert.deepEqual(await withNoEngine(company,()=>withDriver(DRIVER,driver(fake),()=>changeAgentEffort(noEngine.db,{company,agent:lead,effort:'high'}))),
   {state:'noEngine',effort:null});
  const before=requestsTo(fake,'PUT').length;
  for(const effort of ['loud','','Medium',7,null,'none '])
   assert.deepEqual(await withDriver(DRIVER,driver(fake),()=>changeAgentEffort(database().db,{company,agent:lead,effort})),
    {state:'invalid',effort:null},JSON.stringify(effort));
  for(const bad of [{company:'',agent:lead,effort:'high'},{company,agent:'Lead',effort:'high'}])
   assert.deepEqual(await withDriver(DRIVER,driver(fake),()=>changeAgentEffort(database().db,{...bad})),{state:'invalid',effort:null});
  assert.equal(requestsTo(fake,'PUT').length,before,'a refused change writes nothing');
  assert.equal(fake.settings.profiles.get(co).config.agent.reasoning_effort,'medium');
 } finally { await fake.close(); }
});

test('an Engine that fails the write or the read-back is that state, and nothing is logged', async () => {
 const fake=await engineServing(company);
 try {
  profileOn(fake,co,{agent:{reasoning_effort:'medium'}});
  const {db,logged}=database();
  fake.settings.failStep='config';
  assert.deepEqual(await withDriver(DRIVER,driver(fake),()=>changeAgentEffort(db,{company,agent:lead,effort:'high'})),
   {state:'unreachable',effort:null});
  fake.settings.failStep='';
  fake.settings.managementStatus=401;
  assert.deepEqual(await withDriver(DRIVER,driver(fake),()=>changeAgentEffort(db,{company,agent:lead,effort:'high'})),
   {state:'refused',effort:null});
  fake.settings.managementStatus=200;
  fake.settings.staleConfig=true;
  assert.deepEqual(await withDriver(DRIVER,driver(fake),()=>changeAgentEffort(db,{company,agent:lead,effort:'high'})),
   {state:'mismatch',effort:null});
  assert.deepEqual(logged(),[],'a level the Engine did not keep is never logged as saved');
 } finally { await fake.close(); }
});
