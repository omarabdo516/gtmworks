import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProfileModels, writeProfileModel, readModels, readConfig, readSavedConfig, readConfigSchema, readConfigDefaults, writeConfig } from '../lib/hermes.mjs';
import { readSettings, writeSetting, readCompanyModels, changeCompanySetting } from '../lib/engine-settings.mjs';
import { readCompanyKeys } from '../lib/provider-keys.mjs';
import { companyProfile } from '../lib/agent-levels.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// #29: the Company's default model and each Agent's own, written to its own Engine profile (ADR 0016, the profile is the
// Agent). gtmworks keeps only which Agents chose a model of their own; a model is never written through PUT /api/config,
// whose value for it is a dict (hermes_cli/web_routers/config_env.py 122-161, profiles.py 1056-1068).
const company='10000000-0000-0000-0000-000000000001';
const [lead,writer,critic]=['3a000000-0000-0000-0000-000000000011','3a000000-0000-0000-0000-000000000021','3a000000-0000-0000-0000-000000000031'];
const hex=id=>id.replaceAll('-','');
const space=`cs-${hex(company)}`;
const companyProfileName=companyProfile(company);
const own=id=>`ag-${hex(id)}`;
const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const connection=(fake,profile)=>({...install(fake),profile});
const model=(provider,name)=>({provider,model:name});
const profileOn=(fake,name,{provider='auto',model='',config={}}={})=>fake.settings.profiles.set(name,{soul:'',provider,model,key:fake.settings.key,config,credentials:{},env:{OPENROUTER_API_KEY:'sk-or-v1-test-0123456789abcdef'}});
const seed=fake=>{
 for(const name of [space,companyProfileName,own(writer),own(critic)]) profileOn(fake,name);
 for(const name of [space,companyProfileName,own(writer)]) Object.assign(fake.settings.profiles.get(name),{provider:'openrouter',model:'openai/gpt-5.5'});
 Object.assign(fake.settings.profiles.get(own(critic)),{provider:'anthropic',model:'claude-opus-4-6'});
};
// The rows the database answers with (company_agent_models): the main Agent keeps the Company profile, the writer and the
// critic their own; only the critic chose a model of its own.
const rows=({choices={[critic]:'anthropic/claude-opus-4-6'}}={})=>[
 {agent:lead,name:'Lead',profile:companyProfileName,own:true,choosable:false,model_choice:null,subagents:false},
 {agent:writer,name:'Writer',profile:own(writer),own:true,choosable:true,model_choice:null,subagents:false},
 {agent:critic,name:'Critic',profile:own(critic),own:true,choosable:true,model_choice:choices[critic]??null,subagents:false},
];
function database({owner=true,rowsFor=rows(),refuse={}}={}) {
 const calls=[];
 const db={rpc:async(name,args)=>{
  calls.push({name,args});
  if(refuse[name]) return {data:null,error:{code:refuse[name],message:name}};
  if(name==='is_company_owner') return {data:owner,error:null};
  if(name==='company_engine_target') return {data:[{profile:companyProfileName,one_company:false,profiles:[]}],error:null};
  if(name==='company_app_agents') return {data:rowsFor.filter(row=>row.agent!==lead),error:null};
  if(name==='company_agent_models') return {data:rowsFor,error:null};
  if(name==='company_key_profiles') return {data:[{profile:space,kind:'space',agent:null,name:null},
   ...rowsFor.filter(row=>row.choosable).map(row=>({profile:row.profile,kind:'agent',agent:row.agent,name:row.name}))],error:null};
  if(name==='settle_provider_key_holds'||name==='forget_agent_profile_leftovers') return {data:null,error:null};
  if(name==='company_key_unfinished_profiles') return {data:[],error:null};
  if(name==='log_engine_setting'||name==='set_agent_model'||name==='set_agent_subagents') return {data:null,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 return {db,calls,logged:()=>calls.filter(call=>call.name==='log_engine_setting').map(call=>call.args)};
}
const schema=(fake)=>{
 fake.settings.configDefaults={delegation:{model:'',provider:'',max_concurrent_children:10,reasoning_effort:'',max_spawn_depth:1}};
 fake.settings.configSchema={fields:{
  'delegation.model':{type:'string'},'delegation.provider':{type:'string'},
  'delegation.max_concurrent_children':{type:'number'},'delegation.max_spawn_depth':{type:'number'},
  'delegation.reasoning_effort':{type:'select',options:['','minimal','low','medium','high','xhigh','max','ultra']},
 },category_order:[]};
};
const driver=fake=>({
 config:target=>readConfig({...target,managementAddress:fake.managementAddress}),
 saved:target=>readSavedConfig({...target,managementAddress:fake.managementAddress}),
 schema:target=>readConfigSchema({...target,managementAddress:fake.managementAddress}),
 defaults:target=>readConfigDefaults({...target,managementAddress:fake.managementAddress}),
 write:(target,config)=>writeConfig({...target,managementAddress:fake.managementAddress},config),
 writeModel:(target,change)=>writeProfileModel({...target,managementAddress:fake.managementAddress},change),
 profileModels:(target,profiles)=>readProfileModels({...target,managementAddress:fake.managementAddress},profiles),
 options:target=>readModels({...target,managementAddress:fake.managementAddress}),
});
const requestsTo=(fake,pathPart)=>fake.settings.managementRequests.filter(request=>request.path.includes(pathPart));

test('the driver reads each profile\'s model from the Engine\'s profile list and writes one to that profile and reads it back', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake);
  const read=await readProfileModels(connection(fake,companyProfileName),[space,own(writer),own(critic),'ag-ffffffffffffffffffffffffffffffff']);
  assert.deepEqual(read,{state:'found',models:{
   [space]:model('openrouter','openai/gpt-5.5'),
   [own(writer)]:model('openrouter','openai/gpt-5.5'),
   [own(critic)]:model('anthropic','claude-opus-4-6'),
   'ag-ffffffffffffffffffffffffffffffff':null,
  }});
  for(const bad of ['Bad Name','',null,42]) assert.equal((await readProfileModels(connection(fake,companyProfileName),[bad])).state,'failed',String(bad));
  assert.equal((await readProfileModels({...connection(fake,companyProfileName),key:'wrong'},[space])).state,'refused');
  const written=await writeProfileModel(connection(fake,own(writer)),{profile:own(writer),provider:'openrouter',model:'anthropic/claude-opus-4.6'});
  assert.deepEqual(written,{state:'saved',provider:'openrouter',model:'anthropic/claude-opus-4.6'});
  assert.deepEqual(fake.settings.profiles.get(own(writer)),{...fake.settings.profiles.get(own(writer)),provider:'openrouter',model:'anthropic/claude-opus-4.6'});
  assert.deepEqual(requestsTo(fake,'/model').map(request=>request.path),['/api/profiles/'+own(writer)+'/model']);
  assert.deepEqual(requestsTo(fake,'/model')[0].body,{provider:'openrouter',model:'anthropic/claude-opus-4.6'});
  for(const bad of [{provider:'',model:'x'},{provider:'openrouter',model:''},{provider:42,model:'x'},null]) {
   assert.equal((await writeProfileModel(connection(fake,own(writer)),{profile:own(writer),...bad})).state,'failed');
  }
  assert.equal((await writeProfileModel(connection(fake,own(writer)),{profile:'Bad Name',provider:'openrouter',model:'x'})).state,'failed');
 } finally { await fake.close(); }
});

test('the model is not a config setting: a write there is refused, and the reader answers provider/model from the profile', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  const read=await readSettings(connection(fake,own(critic)));
  assert.equal(read.state,'found');
  assert.equal(read.settings.find(setting=>setting.key==='model').value,'anthropic/claude-opus-4-6');
  assert.equal(read.settings.find(setting=>setting.key==='model').where,'profile');
  const before=requestsTo(fake,'/api/config').length;
  const refused=await writeSetting(connection(fake,own(critic)),{setting:'model',value:'openrouter/openai/gpt-5.5'});
  assert.deepEqual(refused,{state:'profileOnly'});
  assert.equal(requestsTo(fake,'/api/config').length,before,'the write never reaches PUT /api/config');
  assert.equal(requestsTo(fake,'/model').length,0);
 } finally { await fake.close(); }
});

test('a Company reads its default model and each Agent\'s own, with the Engine\'s choices for each profile', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  const {db,calls}=database();
  const read=await readCompanyModels(db,{company,owner:true,hermes:install(fake),driver:driver(fake)});
  assert.equal(read.models.default.model,'openrouter/openai/gpt-5.5');
  assert.deepEqual(read.models.default.options.map(option=>`${option.provider}/${option.model}`),['openrouter/anthropic/claude-opus-4.6','openrouter/openai/gpt-5.5']);
  assert.deepEqual(read.models.agents.map(agent=>({name:agent.name,model:agent.model,choice:agent.choice,choosable:agent.choosable})),[
   {name:'Lead',model:'openrouter/openai/gpt-5.5',choice:null,choosable:false},
   {name:'Writer',model:'openrouter/openai/gpt-5.5',choice:null,choosable:true},
   {name:'Critic',model:'anthropic/claude-opus-4-6',choice:'anthropic/claude-opus-4-6',choosable:true},
  ]);
  assert.ok(read.models.agents.filter(agent=>agent.choosable).every(agent=>agent.options.length>0),'each Agent that can choose gets the choices its own profile lists');
  assert.deepEqual(read.models.agents.find(agent=>agent.name==='Lead').options,[],'an Agent on the Company profile has no model of its own to choose');
  assert.ok(calls.some(call=>call.name==='company_agent_models'&&call.args.c===company));
  // A member who is not the Owner gets the values and no choices to make.
  const member=await readCompanyModels(database({owner:false}).db,{company,hermes:install(fake),driver:driver(fake),owner:false});
  assert.deepEqual(member.models.agents.map(agent=>agent.options),[[],[],[]]);
  // Sub-agent settings are read for an Agent only when sub-agents are on for it.
  fake.settings.profiles.get(own(writer)).config={delegation:{max_concurrent_children:4,reasoning_effort:'high'}};
  const on=rows(); on[1]={...on[1],subagents:true};
  const withSubagents=await readCompanyModels(database({rowsFor:on}).db,{company,hermes:install(fake),driver:driver(fake),owner:false});
  const row=withSubagents.models.agents.find(agent=>agent.name==='Writer');
  assert.deepEqual(row.settings.filter(setting=>setting.key.startsWith('delegation.')).map(setting=>[setting.key,setting.value]),
   [['delegation.model',''],['delegation.provider',''],['delegation.max_concurrent_children',4],['delegation.reasoning_effort','high'],['delegation.max_spawn_depth',1]]);
  assert.deepEqual(withSubagents.models.agents.find(agent=>agent.name==='Lead').settings,[]);
 } finally { await fake.close(); }
});

test('the Company default reaches the shared space and every Agent without its own choice, and nothing else', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  const {db,logged}=database();
  const result=await changeCompanySetting(db,{company,setting:'model',value:'openrouter/anthropic/claude-opus-4.6',hermes:install(fake),driver:driver(fake)});
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.body.space,true);
  assert.deepEqual(result.body.agents.map(agent=>[agent.name,agent.written]),[['Lead',true],['Writer',true],['Critic',false]]);
  const writes=requestsTo(fake,'/model').map(request=>({path:request.path,body:request.body}));
  assert.deepEqual(writes,[
   {path:`/api/profiles/${space}/model`,body:{provider:'openrouter',model:'anthropic/claude-opus-4.6'}},
   {path:`/api/profiles/${companyProfileName}/model`,body:{provider:'openrouter',model:'anthropic/claude-opus-4.6'}},
   {path:`/api/profiles/${own(writer)}/model`,body:{provider:'openrouter',model:'anthropic/claude-opus-4.6'}},
  ]);
  // Every write is read back and logged with the Agent it changed; the critic that chose its own keeps it.
  assert.deepEqual(logged().map(row=>[row.agent,row.setting,row.old_value,row.new_value]),[
   [lead,'model','openrouter/openai/gpt-5.5','openrouter/anthropic/claude-opus-4.6'],
   [writer,'model','openrouter/openai/gpt-5.5','openrouter/anthropic/claude-opus-4.6'],
  ]);
  assert.equal(fake.settings.profiles.get(own(critic)).model,'claude-opus-4-6');
 } finally { await fake.close(); }
});

test('one Agent\'s model is written to its own profile and remembered as its choice; following the default clears it', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  const {db,calls,logged}=database();
  const chosen=await changeCompanySetting(db,{company,agent:writer,setting:'model',value:'openrouter/anthropic/claude-opus-4.6',hermes:install(fake),driver:driver(fake)});
  assert.equal(chosen.status,200,JSON.stringify(chosen));
  assert.deepEqual(requestsTo(fake,'/model').map(request=>request.path),['/api/profiles/'+own(writer)+'/model']);
  assert.deepEqual(calls.filter(call=>call.name==='set_agent_model').map(call=>call.args),[{
   agent:writer,model:'openrouter/anthropic/claude-opus-4.6',
  }]);
  assert.deepEqual(logged().map(row=>[row.agent,row.new_value]),[[writer,'openrouter/anthropic/claude-opus-4.6']]);
  // Following the default again writes the default to that profile and forgets the choice.
  const follow=await changeCompanySetting(db,{company,agent:writer,setting:'model',value:null,hermes:install(fake),driver:driver(fake)});
  assert.equal(follow.status,200,JSON.stringify(follow));
  assert.equal(fake.settings.profiles.get(own(writer)).model,'openai/gpt-5.5');
  assert.deepEqual(calls.filter(call=>call.name==='set_agent_model').at(-1).args,{agent:writer,model:null});
  // An Agent that keeps the Company profile has no model of its own, and one that chose is never overwritten by the default.
  const shared=await changeCompanySetting(db,{company,agent:lead,setting:'model',value:'openrouter/openai/gpt-5.5',hermes:install(fake),driver:driver(fake)});
  assert.equal(shared.status,409);
  assert.equal(shared.body.error,'settingAgentShared');
  // An Agent the worker is still moving holds a record but runs on the Company profile: it is not choosable either.
  const moving=rows(); moving[1]={...moving[1],own:false};
  const mid=await changeCompanySetting(database({rowsFor:moving}).db,{company,agent:writer,setting:'model',value:'openrouter/openai/gpt-5.5',hermes:install(fake),driver:driver(fake)});
  assert.deepEqual([mid.status,mid.body.error],[409,'settingAgentShared']);
 } finally { await fake.close(); }
});

test('only the Owner changes a model, and a refused or unknown Agent changes nothing', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  const refused=await changeCompanySetting(database({owner:false}).db,{company,setting:'model',value:'openrouter/openai/gpt-5.5',hermes:install(fake),driver:driver(fake)});
  assert.deepEqual(refused,{status:403,body:{error:'settingNotAllowed'}});
  const unknown=await changeCompanySetting(database().db,{company,agent:'3a000000-0000-0000-0000-0000000000ff',setting:'model',value:'openrouter/openai/gpt-5.5',hermes:install(fake),driver:driver(fake)});
  assert.equal(unknown.status,404);
  const bad=await changeCompanySetting(database().db,{company,setting:'model',value:'no-slash',hermes:install(fake),driver:driver(fake)});
  assert.equal(bad.status,400);
  assert.equal(requestsTo(fake,'/model').length,0);
 } finally { await fake.close(); }
});

test('the Owner turns sub-agents on for one Agent, logged, and its settings are written only while it is on', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  const {db,calls,logged}=database();
  const on=await changeCompanySetting(db,{company,agent:writer,setting:'subagents',value:true});
  assert.deepEqual(on,{status:200,body:{setting:'subagents',agent:writer,subagents:true}});
  assert.deepEqual(calls.filter(call=>call.name==='set_agent_subagents').map(call=>call.args),[{agent:writer,enabled:true}]);
  assert.deepEqual(logged().map(row=>[row.agent,row.setting,row.old_value,row.new_value]),[[writer,'subagents',false,true]]);
  // An Agent on the Company profile has no sub-agents switch of its own; only a boolean is a value.
  assert.equal((await changeCompanySetting(db,{company,agent:lead,setting:'subagents',value:true})).status,409);
  assert.equal((await changeCompanySetting(db,{company,agent:writer,setting:'subagents',value:'yes'})).status,400);
  assert.equal((await changeCompanySetting(database({owner:false}).db,{company,agent:writer,setting:'subagents',value:true})).status,403);
  // A delegation setting is refused while sub-agents are off, and written through #125's route when they are on.
  const off=await changeCompanySetting(db,{company,agent:writer,setting:'delegation.reasoning_effort',value:'high',hermes:install(fake),driver:driver(fake)});
  assert.deepEqual(off,{status:409,body:{error:'settingSubagentsOff'}});
  assert.equal(requestsTo(fake,'/api/config').length,0);
  const enabled=rows(); enabled[1]={...enabled[1],subagents:true};
  const written=await changeCompanySetting(database({rowsFor:enabled}).db,{company,agent:writer,setting:'delegation.max_concurrent_children',value:4,hermes:install(fake),driver:driver(fake)});
  assert.equal(written.status,200,JSON.stringify(written));
  assert.deepEqual(fake.settings.profiles.get(own(writer)).config.delegation,{max_concurrent_children:4});
 } finally { await fake.close(); }
});

test('no key, its preview or a token reaches the models page payload or a log line', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  const secret='sk-or-v1-page-payload-never-0123456789abcdef';
  fake.settings.profiles.get(space).env={OPENROUTER_API_KEY:secret};
  for(const name of [companyProfileName,own(writer),own(critic)]) fake.settings.profiles.get(name).env={OPENROUTER_API_KEY:secret};
  const {db,logged}=database();
  const read=await readCompanyModels(db,{company,owner:true,hermes:install(fake),driver:driver(fake)});
  const keys=await readCompanyKeys(db,db,{company,hermes:install(fake)});
  const answer=JSON.stringify({models:read,keys});
  for(const value of [secret,`${secret.slice(0,4)}...${secret.slice(-4)}`,secret.slice(-6),'OPENROUTER_API_KEY']) assert.ok(!answer.includes(value),value);
  await changeCompanySetting(db,{company,setting:'model',value:'openrouter/openai/gpt-5.5',hermes:install(fake),driver:driver(fake)});
  const loggedValues=JSON.stringify([...logged(),...requestsTo(fake,'/model').map(request=>request.body)]);
  for(const value of [secret,secret.slice(-6)]) assert.ok(!loggedValues.includes(value),value);
 } finally { await fake.close(); }
});
