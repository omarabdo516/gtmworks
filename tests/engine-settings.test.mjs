import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readConfig, readSavedConfig, readConfigSchema, readConfigDefaults, writeConfig } from '../lib/hermes.mjs';
import { engineSettings, engineOwnsSetting, settingsSchemaProblems, readSettings, writeSetting, readAgentSettings, changeCompanySetting } from '../lib/engine-settings.mjs';
import { companyProfile } from '../lib/agent-levels.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// The one list of Engine settings gtmworks reads and writes (#125, ADR 0016), pinned to the Engine release in the install
// (ADR 0010). The fixture is picked from that release's own schema and defaults, so a setting the Engine does not have,
// or one whose type changed, fails here rather than in a screen.
const fixture=JSON.parse(readFileSync(new URL('./engine-schema.json',import.meta.url),'utf8'));
const en=JSON.parse(readFileSync(new URL('../lib/messages/en.json',import.meta.url),'utf8'));
const ar=JSON.parse(readFileSync(new URL('../lib/messages/ar.json',import.meta.url),'utf8'));
const company='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
const [lead,writer,helper]=['3a000000-0000-0000-0000-000000000011','3a000000-0000-0000-0000-000000000021','3a000000-0000-0000-0000-000000000041'];
const hex=id=>id.replaceAll('-','');
const space=`cs-${hex(company)}`;
const spaceOther=`cs-${hex(other)}`;
const agentProfile=id=>`ag-${hex(id)}`;
const at=(object,key)=>key.split('.').reduce((found,part)=>found&&typeof found==='object'?found[part]:undefined,object);
const setup=fake=>{ fake.settings.configDefaults=fixture.defaults; fake.settings.configSchema={fields:fixture.schema,category_order:[]}; };
const profileOn=(fake,name,config={})=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config,credentials:{}});
const connection=(fake,profile)=>({address:fake.address,managementAddress:fake.managementAddress,profile,key:fake.settings.key});
const rows=[
 {agent:lead,name:'Lead',connection:'f1000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:true,own:true},
 {agent:writer,name:'Writer',connection:'f1000000-0000-0000-0000-000000000021',profile:agentProfile(writer),main:false,own:true},
 {agent:helper,name:'Helper',connection:'f1000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:false,own:false},
 {agent:'3a000000-0000-0000-0000-000000000051',name:'Other Lead',connection:'f1000000-0000-0000-0000-000000000031',profile:companyProfile(other),main:true,own:true},
 {agent:'3a000000-0000-0000-0000-000000000061',name:'Other Writer',connection:'f1000000-0000-0000-0000-000000000041',profile:agentProfile('3a000000-0000-0000-0000-000000000061'),main:false,own:true},
];
const rowsByCompany={[company]:rows.filter(row=>[lead,writer,helper].includes(row.agent)),[other]:rows.filter(row=>![lead,writer,helper].includes(row.agent))};
function database({agents=rowsByCompany,owner=true,logFails=false}={}) {
 const logged=[];
 const db={rpc:async(name,args)=>{
  if(name==='is_company_owner') return {data:owner,error:null};
  if(name==='company_engine_target') return {data:[{profile:companyProfile(args.c),one_company:false,profiles:[]}],error:null};
  if(name==='company_app_agents') return {data:agents[args.c]||[],error:null};
  if(name==='log_engine_setting') { if(logFails) return {data:null,error:{code:'42501',message:'settingNotAllowed'}}; logged.push(args); return {data:null,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 return {db,logged};
}
// The service reaches the fake through these, as it reaches the bundled Engine's listener in the app.
const driver=fake=>({
 config:target=>readConfig({...target,managementAddress:fake.managementAddress}),
 saved:target=>readSavedConfig({...target,managementAddress:fake.managementAddress}),
 schema:target=>readConfigSchema({...target,managementAddress:fake.managementAddress}),
 defaults:target=>readConfigDefaults({...target,managementAddress:fake.managementAddress}),
 write:(target,config)=>writeConfig({...target,managementAddress:fake.managementAddress},config),
});
const requestsOf=(fake,method)=>fake.settings.managementRequests.filter(request=>request.method===method);

test('every listed setting is in the pinned Engine schema, or names the source line that has it', () => {
 assert.equal(engineSettings.length,15,'the ticket\'s list');
 assert.deepEqual(settingsSchemaProblems(engineSettings,{fields:fixture.schema},fixture.defaults),[],'the list and the pinned fixture agree');
 const keys=engineSettings.map(entry=>entry.key);
 assert.equal(new Set(keys).size,keys.length,'no setting is listed twice');
 for(const entry of engineSettings) {
  assert.ok(['profile','install'].includes(entry.where),`${entry.key} says where it is held`);
  assert.ok(typeof entry.label==='string'&&entry.label,`${entry.key} names its label`);
  assert.equal(engineOwnsSetting(entry.key),false,`${entry.key} is not a key gtmworks owns`);
  const field=fixture.schema[entry.key];
  if(field) {
   assert.equal(entry.type,field.type,`${entry.key} keeps the Engine's type`);
   assert.deepEqual(at(fixture.defaults,entry.key),entry.default===undefined?at(fixture.defaults,entry.key):entry.default,`${entry.key} keeps the Engine's default`);
   if(field.type==='select'&&Array.isArray(field.options)) assert.ok(entry.choices===undefined||field.options.every(choice=>entry.choices.includes(choice)),`${entry.key} takes only Engine choices`);
   continue;
  }
  // Two settings the Engine reads but its schema does not carry: the list says so and names the source that decides them.
  assert.ok(typeof entry.source==='string'&&entry.source,`${entry.key} names the source line the schema lacks`);
  assert.notEqual(entry.default,undefined,`${entry.key} states its default`);
 }
 const reasoning=engineSettings.find(entry=>entry.key==='agent.reasoning_effort');
 assert.deepEqual(reasoning.choices,[fixture.source.reasoning.off,...fixture.source.reasoning.choices],'reasoning effort is off plus the Engine\'s own choices');
 assert.equal(reasoning.default,fixture.source.reasoning.absent,'an absent reasoning effort reads as medium');
 assert.equal(reasoning.source,fixture.source.reasoning.file);
 const speed=engineSettings.find(entry=>entry.key==='tts.speed');
 assert.equal(speed.type,'number');
 assert.equal(speed.default,fixture.source.ttsSpeed.absent,'an absent speed is the Engine\'s 1');
 assert.equal(speed.source,fixture.source.ttsSpeed.file);
 for(const key of ['agent.disabled_toolsets','platform_toolsets','platform_toolsets.api_server','skills.external_dirs','skills.create_dir','mcp_servers','mcp_servers.klaviyo','auth.token','approvals.mode','terminal.timeout','gateway.host','model.api_key','delegation.base_url']) {
  assert.equal(engineOwnsSetting(key),true,`${key} is gtmworks's`);
 }
 for(const key of ['memory.write_approval','skills.write_approval','delegation.max_concurrent_children']) assert.equal(engineOwnsSetting(key),false,`${key} is a setting, not an approval key`);
});

test('every listed setting has its label in both catalogues, without the Engine\'s name or a config key', () => {
 for(const entry of engineSettings) {
  for(const [language,catalogue] of [['en',en],['ar',ar]]) {
   const label=catalogue[entry.label];
   assert.ok(typeof label==='string'&&label,`${entry.key} has an ${language} label`);
   assert.doesNotMatch(label,/hermes|هيرمس|هرمس/i,`${entry.key}'s ${language} label names no engine`);
   if(entry.key.includes('.')) assert.ok(!label.includes(entry.key),`${entry.key}'s ${language} label holds no config key`);
   assert.ok(!/(^|[\s“"«(])[a-z]+_[a-z_]+/.test(label),`${entry.key}'s ${language} label holds no key fragment`);
  }
 }
 assert.ok(en.settingUnknown&&ar.settingUnknown,'a setting this version no longer lists still has a word');
});

test('a profile reads back each listed setting with its type, choices, default, value, limits and place', async () => {
 const fake=await fakeHermes();
 try {
  setup(fake);
  profileOn(fake,agentProfile(writer),{delegation:{model:'openai/gpt-5.5',max_concurrent_children:3,reasoning_effort:'high',api_key:'sk-test-only-should-never-leave'},memory:{memory_enabled:false,memory_char_limit:3000},skills:{write_approval:true},display:{personality:'Warm'},timezone:'Africa/Cairo',stt:{language:'ar'},tts:{speed:1.5}});
  // The model is the profile's own, not the config's dict: the profile list answers provider/model (#29).
  Object.assign(fake.settings.profiles.get(agentProfile(writer)),{provider:'openrouter',model:'anthropic/claude-opus-4.6'});
  const read=await readSettings(connection(fake,agentProfile(writer)));
  assert.equal(read.state,'found',JSON.stringify(read));
  const setting=key=>read.settings.find(found=>found.key===key);
  assert.deepEqual(
   (({where,type,default:fallback,value,limits,label})=>({where,type,default:fallback,value,limits,label}))(setting('delegation.max_concurrent_children')),
   {where:'profile',type:'number',default:10,value:3,limits:{min:1,integer:true,source:'tools/delegate_tool_config.py 104-117'},label:'settingSubagentLimit'});
  assert.equal(setting('model').value,'openrouter/anthropic/claude-opus-4.6');
  assert.equal(setting('delegation.model').value,'openai/gpt-5.5');
  assert.equal(setting('delegation.reasoning_effort').value,'high');
  assert.deepEqual(setting('delegation.reasoning_effort').choices,fixture.schema['delegation.reasoning_effort'].options);
  assert.equal(setting('memory.memory_enabled').value,false);
  assert.equal(setting('memory.memory_char_limit').value,3000);
  assert.equal(setting('skills.write_approval').value,true);
  assert.equal(setting('display.personality').value,'Warm');
  assert.equal(setting('timezone').value,'Africa/Cairo');
  assert.equal(setting('stt.language').value,'ar');
  assert.equal(setting('agent.reasoning_effort').value,'medium','the Engine has no value, so the page shows its medium');
  assert.deepEqual(setting('agent.reasoning_effort').choices,['none','minimal','low','medium','high','xhigh','max','ultra']);
  assert.equal(setting('tts.speed').value,1.5);
  assert.equal(setting('tts.speed').default,1);
  assert.equal(JSON.stringify(read).includes('sk-test-only-should-never-leave'),false,'no API key value leaves the reader');
  assert.equal(fake.settings.managementRequests.some(request=>request.path.includes('api_key')),false,'no route reads a key by name');

  // A setting held for the whole install is read from the root profile and marked so, and a listed key ending api_key is
  // dropped rather than returned.
  fake.settings.defaultConfig={model:'install-model'};
  const install=await readSettings(connection(fake,agentProfile(writer)),{list:[{key:'model',where:'install',type:'string',label:'settingModel'},
   {key:'delegation.api_key',where:'profile',type:'string',label:'settingUnknown'}]});
  assert.deepEqual(install.settings.map(found=>({key:found.key,where:found.where,value:found.value})),[{key:'model',where:'install',value:'install-model'}]);
 } finally { await fake.close(); }
});

test('a write checks type, choices and limits first, sends only its own keys, and counts only a matching read-back', async () => {
 const fake=await fakeHermes();
 try {
  setup(fake);
  profileOn(fake,agentProfile(writer));
  const connectionAt=connection(fake,agentProfile(writer));
  const saved=await writeSetting(connectionAt,{setting:'delegation.max_concurrent_children',value:3});
  assert.equal(saved.state,'saved',JSON.stringify(saved));
  assert.deepEqual(saved.old,10);
  const put=requestsOf(fake,'PUT').at(-1);
  assert.equal(put.path,`/api/config?profile=${agentProfile(writer)}`);
  assert.deepEqual(put.body,{config:{delegation:{max_concurrent_children:3}}},'a write states only its own key');
  assert.equal(fake.settings.profiles.get(agentProfile(writer)).config.delegation.max_concurrent_children,3);
  assert.equal((await writeSetting(connectionAt,{setting:'agent.reasoning_effort',value:'low'})).state,'saved','a setting outside the schema is written too');
  assert.deepEqual(requestsOf(fake,'PUT').at(-1).body,{config:{agent:{reasoning_effort:'low'}}});
  assert.equal((await writeSetting(connectionAt,{setting:'tts.speed',value:1.5})).state,'saved');
  // Each kind of bad value is refused before a write is sent.
  const before=requestsOf(fake,'PUT').length;
  const bad=[['delegation.max_concurrent_children','3','type'],['delegation.max_concurrent_children',0,'limit'],['delegation.max_concurrent_children',2.5,'type'],
   ['delegation.reasoning_effort','loud','choice'],['memory.memory_enabled','yes','type'],['timezone','Not/AZone','choice']];
  for(const [setting,value,problem] of bad) assert.deepEqual(await writeSetting(connectionAt,{setting,value}),{state:'invalid',problem},`${setting} ${String(value)}`);
  assert.equal(requestsOf(fake,'PUT').length,before,'no bad value reached the Engine');
  assert.deepEqual(await writeSetting(connectionAt,{setting:'delegation.base_url',value:'http://elsewhere'}),{state:'owned'});
  assert.deepEqual(await writeSetting(connectionAt,{setting:'not.a.setting',value:1}),{state:'unknown'});
  assert.deepEqual(await writeSetting(connectionAt,{setting:'model',value:'x',list:[{key:'model',where:'install',type:'string',label:'settingModel'}]}),{state:'installOnly'});
  assert.equal(requestsOf(fake,'PUT').length,before,'an unlisted, owned or install key never reaches the Engine');
  fake.settings.staleConfig=true;
  assert.deepEqual(await writeSetting(connectionAt,{setting:'delegation.max_spawn_depth',value:2}),{state:'mismatch',old:1});
 } finally { await fake.close(); }
});

test('a Company-wide write reaches every Agent profile and the shared space, names each Agent, and touches no other Company', async () => {
 const fake=await fakeHermes();
 try {
  setup(fake);
  for(const row of rows) profileOn(fake,row.profile);
  profileOn(fake,space); profileOn(fake,spaceOther);
  fake.settings.configWriteFail=new Set([agentProfile(writer)]);
  const {db,logged}=database();
  const read=await readAgentSettings(db,{company,agent:lead,hermes:{address:fake.address,key:fake.settings.key},driver:driver(fake)});
  assert.deepEqual(read.agents.map(agent=>[agent.id,agent.settings.length]),[[lead,15]],'the service reads one Agent\'s profile');
  const before=requestsOf(fake,'PUT').length;
  const changed=await changeCompanySetting(db,{company,setting:'memory.memory_char_limit',value:2400,hermes:{address:fake.address,key:fake.settings.key},driver:driver(fake)});
  assert.equal(changed.state,'written',JSON.stringify(changed));
  assert.deepEqual(changed.agents,[
   {agent:lead,name:'Lead',written:true},
   {agent:writer,name:'Writer',written:false},
   {agent:helper,name:'Helper',written:true},
  ],'the answer names each Agent and whether the write reached it');
  assert.equal(changed.space,true,'the shared space takes the same value');
  assert.equal(fake.settings.profiles.get(companyProfile(company)).config.memory.memory_char_limit,2400);
  assert.equal(fake.settings.profiles.get(space).config.memory.memory_char_limit,2400);
  assert.equal(fake.settings.profiles.get(agentProfile(writer)).config.memory?.memory_char_limit,undefined,'the failing profile keeps its value');
  for(const untouched of [companyProfile(other),agentProfile('3a000000-0000-0000-0000-000000000061'),spaceOther])
   assert.equal(fake.settings.profiles.get(untouched).config.memory?.memory_char_limit,undefined,`${untouched} is another Company's`);
  const paths=requestsOf(fake,'PUT').slice(before).map(request=>request.path);
  assert.equal(paths.some(path=>path.includes(companyProfile(other))||path.includes(agentProfile('3a000000-0000-0000-0000-000000000061'))||path.includes(spaceOther)),false,'no request names another Company');
  assert.deepEqual(logged.map(entry=>[entry.agent,entry.setting,entry.old_value,entry.new_value]),[
   [lead,'memory.memory_char_limit',2200,2400],
   [helper,'memory.memory_char_limit',2200,2400],
  ],'one log row per changed Agent, with the setting and both values');
  // A per-Agent write is refused for an Agent sharing another Agent's profile, before the Engine is asked.
  const refused=await changeCompanySetting(db,{company,agent:helper,setting:'memory.memory_char_limit',value:2600,hermes:{address:fake.address,key:fake.settings.key},driver:driver(fake)});
  assert.deepEqual(refused.state,'shared');
  assert.equal(requestsOf(fake,'PUT').length,paths.length+before,'no Engine write is sent');
  // A person below Owner changes nothing, before the Engine is asked.
  const denied=await changeCompanySetting(database({owner:false}).db,{company,setting:'memory.memory_char_limit',value:2600,hermes:{address:fake.address,key:fake.settings.key},driver:driver(fake)});
  assert.deepEqual(denied.state,'notAllowed');
 } finally { await fake.close(); }
});

test('a change the Engine holds is not called logged when its log row fails, one Agent or the whole Company', async () => {
 const fake=await fakeHermes();
 try {
  setup(fake);
  for(const row of rows) profileOn(fake,row.profile);
  profileOn(fake,space);
  const one=await changeCompanySetting(database({logFails:true}).db,{company,agent:writer,setting:'memory.memory_char_limit',value:2400,hermes:{address:fake.address,key:fake.settings.key},driver:driver(fake)});
  assert.equal(one.state,'written',JSON.stringify(one));
  assert.equal(one.logged,false,'the per-Agent path says the row is missing, as the Company-wide path does');
  assert.equal(fake.settings.profiles.get(agentProfile(writer)).config.memory.memory_char_limit,2400,'the Engine still holds the change');
  const all=await changeCompanySetting(database({logFails:true}).db,{company,setting:'memory.memory_char_limit',value:2600,hermes:{address:fake.address,key:fake.settings.key},driver:driver(fake)});
  assert.equal(all.state,'written',JSON.stringify(all));
  assert.equal(all.logged,false);
 } finally { await fake.close(); }
});
