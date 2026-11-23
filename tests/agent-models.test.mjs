import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProfileModels, writeProfileModel, readModels, readConfig, readSavedConfig, readConfigSchema, readConfigDefaults, writeConfig } from '../lib/hermes.mjs';
import { readSettings, writeSetting, readCompanyModels, changeCompanySetting, changeCompanySettings } from '../lib/engine-settings.mjs';
import { readCompanyKeys } from '../lib/provider-keys.mjs';
import { companyProfile } from '../lib/agent-toolsets.mjs';
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
// The rows the database answers with (company_agent_models): the main Agent keeps the Company profile, which is still its
// own and choosable (#425, ADR 0016), the writer and the critic their own; only the critic chose a model of its own.
const rows=({choices={[critic]:'anthropic/claude-opus-4-6'}}={})=>[
 {agent:lead,name:'Lead',profile:companyProfileName,own:true,choosable:true,model_choice:choices[lead]??null,subagents:false},
 {agent:writer,name:'Writer',profile:own(writer),own:true,choosable:true,model_choice:null,subagents:false},
 {agent:critic,name:'Critic',profile:own(critic),own:true,choosable:true,model_choice:choices[critic]??null,subagents:false},
];
function database({owner=true,rowsFor=rows(),refuse={}}={}) {
 const calls=[];
 const db={rpc:async(name,args)=>{
  calls.push({name,args});
  if(refuse[name]) return {data:null,error:{code:refuse[name],message:name}};
  if(name==='is_company_owner') return {data:owner,error:null};
  if(name==='company_engine_target') return {data:[{profile:companyProfileName,profiles:[]}],error:null};
  if(name==='company_app_agents') return {data:rowsFor.filter(row=>row.agent!==lead),error:null};
  if(name==='company_agent_models') return {data:rowsFor,error:null};
  if(name==='company_key_profiles') return {data:[{profile:space,kind:'space',agent:null,name:null},
   ...rowsFor.filter(row=>row.choosable).map(row=>({profile:row.profile,kind:'agent',agent:row.agent,name:row.name}))],error:null};
  if(name==='settle_provider_key_holds'||name==='forget_agent_profile_leftovers') return {data:null,error:null};
  if(name==='company_key_unfinished_profiles') return {data:[],error:null};
  if(name==='log_engine_setting'||name==='set_agent_model'||name==='set_agent_subagents') return {data:null,error:null};
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 // No Provider has a model switched off (#620, company_provider_models), and none is switched off (#619, provider_order).
 db.from=table=>({select:()=>({eq:async()=>['company_provider_models','provider_order'].includes(table)?{data:[],error:null}:{data:null,error:{message:`unexpected ${table}`}}})});
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
   {name:'Lead',model:'openrouter/openai/gpt-5.5',choice:null,choosable:true},
   {name:'Writer',model:'openrouter/openai/gpt-5.5',choice:null,choosable:true},
   {name:'Critic',model:'anthropic/claude-opus-4-6',choice:'anthropic/claude-opus-4-6',choosable:true},
  ]);
  assert.ok(read.models.agents.filter(agent=>agent.choosable).every(agent=>agent.options.length>0),'each Agent that can choose gets the choices its own profile lists');
  // The main Agent's `co-` profile is its own (#425): its Owner gets the choices that profile lists.
  assert.ok(read.models.agents.find(agent=>agent.name==='Lead').options.length>0);
  assert.ok(calls.some(call=>call.name==='company_agent_models'&&call.args.c===company));
  // One Agent's page asks the Engine for that Agent's choices only, never the shared space's (#661).
  const before=requestsTo(fake,'/api/model/options').length;
  const one=await readCompanyModels(db,{company,agent:writer,owner:true,hermes:install(fake),driver:driver(fake)});
  assert.deepEqual(one.models.default.options,[]);
  assert.ok(one.models.agents[0].options.length>0);
  assert.equal(requestsTo(fake,'/api/model/options').length-before,1,'one Engine read of the model list, the Agent\'s own');
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
  assert.equal(result.state,'written',JSON.stringify(result));
  assert.equal(result.space,true);
  assert.deepEqual(result.agents.map(agent=>[agent.name,agent.written]),[['Lead',true],['Writer',true],['Critic',false]]);
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

test('a Company default leaves a main Agent that chose its own model on its choice, though another Agent still shares its profile', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  Object.assign(fake.settings.profiles.get(companyProfileName),{provider:'anthropic',model:'claude-fable-5-1'});
  // Lead chose its own model; Mover still runs on Lead's `co-` profile while the worker moves it, and follows the default.
  const mover='3a000000-0000-0000-0000-000000000041';
  const {db,logged}=database({rowsFor:[...rows({choices:{[lead]:'anthropic/claude-fable-5-1',[critic]:'anthropic/claude-opus-4-6'}}),
   {agent:mover,name:'Mover',profile:companyProfileName,own:false,choosable:false,model_choice:null,subagents:false}]});
  const result=await changeCompanySetting(db,{company,setting:'model',value:'openrouter/anthropic/claude-opus-4.6',hermes:install(fake),driver:driver(fake)});
  assert.equal(result.state,'written',JSON.stringify(result));
  assert.deepEqual(requestsTo(fake,'/model').map(request=>request.path),[`/api/profiles/${space}/model`,`/api/profiles/${own(writer)}/model`]);
  assert.equal(fake.settings.profiles.get(companyProfileName).model,'claude-fable-5-1','the main Agent keeps its own choice');
  assert.deepEqual(result.agents.map(agent=>[agent.name,agent.written]),[['Lead',false],['Writer',true],['Critic',false],['Mover',false]]);
  assert.deepEqual(result.failed,[],'a profile left alone for its chooser is no failure');
  assert.deepEqual(logged().map(row=>row.agent),[writer]);
 } finally { await fake.close(); }
});

test('the default model is written to the shared space before any Agent, so a space the Engine refuses changes none', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  // The Engine serves the profile list but refuses the shared space's model write.
  fake.settings.profiles.delete(space);
  const {db,logged}=database();
  const before=requestsTo(fake,'/model').length;
  const result=await changeCompanySetting(db,{company,setting:'model',value:'openrouter/anthropic/claude-opus-4.6',hermes:install(fake),driver:driver(fake)});
  assert.notEqual(result.state,'written',JSON.stringify(result));
  assert.deepEqual(requestsTo(fake,'/model').slice(before).map(request=>request.path),[`/api/profiles/${space}/model`],'the shared space is the only write sent');
  assert.equal(fake.settings.profiles.get(companyProfileName).model,'openai/gpt-5.5','no follower took the new default');
  assert.equal(fake.settings.profiles.get(own(writer)).model,'openai/gpt-5.5');
  assert.deepEqual(logged(),[],'nothing changed, so nothing is logged');
 } finally { await fake.close(); }
});

test('a default that reaches the Company but not an Agent names it, and sending it again lands on that Agent', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  // The Engine no longer serves Writer's own profile, so its write fails after the shared space and Lead took the model.
  fake.settings.profiles.delete(own(writer));
  const {db,logged}=database();
  const partial=await changeCompanySetting(db,{company,setting:'model',value:'openrouter/anthropic/claude-opus-4.6',hermes:install(fake),driver:driver(fake)});
  assert.equal(partial.state,'written',JSON.stringify(partial));
  assert.equal(partial.space,true);
  assert.deepEqual(partial.failed,[{agent:writer,name:'Writer'}],'the Agent the default did not reach is named');
  assert.deepEqual(partial.agents.map(agent=>[agent.name,agent.written]),[['Lead',true],['Writer',false],['Critic',false]]);
  assert.equal(fake.settings.profiles.get(companyProfileName).model,'anthropic/claude-opus-4.6');
  assert.deepEqual(logged().map(row=>row.agent),[lead],'only the Agent that changed is logged');
  // The Owner sends the same default again once the profile is back: it reaches Writer and names no failure.
  profileOn(fake,own(writer),{provider:'openrouter',model:'openai/gpt-5.5'});
  const retried=await changeCompanySetting(db,{company,setting:'model',value:'openrouter/anthropic/claude-opus-4.6',hermes:install(fake),driver:driver(fake)});
  assert.equal(retried.state,'written',JSON.stringify(retried));
  assert.deepEqual(retried.failed,[]);
  assert.equal(fake.settings.profiles.get(own(writer)).model,'anthropic/claude-opus-4.6');
  assert.deepEqual(logged().map(row=>row.agent),[lead,writer]);
 } finally { await fake.close(); }
});

test('one Agent\'s model is written to its own profile and remembered as its choice; following the default clears it', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  const {db,calls,logged}=database();
  const chosen=await changeCompanySetting(db,{company,agent:writer,setting:'model',value:'openrouter/anthropic/claude-opus-4.6',hermes:install(fake),driver:driver(fake)});
  assert.equal(chosen.state,'written',JSON.stringify(chosen));
  assert.deepEqual(requestsTo(fake,'/model').map(request=>request.path),['/api/profiles/'+own(writer)+'/model']);
  assert.deepEqual(calls.filter(call=>call.name==='set_agent_model').map(call=>call.args),[{
   agent:writer,model:'openrouter/anthropic/claude-opus-4.6',
  }]);
  assert.deepEqual(logged().map(row=>[row.agent,row.new_value]),[[writer,'openrouter/anthropic/claude-opus-4.6']]);
  // The answer names the model the profile now runs on, so the page shows it with no read of itself (#661).
  assert.equal(chosen.running,'openrouter/anthropic/claude-opus-4.6');
  // Following the default again writes the default to that profile and forgets the choice.
  const marks=[]; const timing={mark:step=>marks.push(step)};
  const follow=await changeCompanySetting(db,{company,agent:writer,setting:'model',value:null,hermes:install(fake),driver:driver(fake),timing});
  assert.equal(follow.state,'written',JSON.stringify(follow));
  assert.deepEqual([follow.model,follow.running],[null,'openrouter/openai/gpt-5.5'],'it follows the default, and runs on it');
  // Each step of the save is marked for the agent_setting_saved line, in the order it ran.
  assert.deepEqual(marks,['queue','owner','reads','engineWrite','record']);
  assert.equal(fake.settings.profiles.get(own(writer)).model,'openai/gpt-5.5');
  assert.deepEqual(calls.filter(call=>call.name==='set_agent_model').at(-1).args,{agent:writer,model:null});
  // The main Agent on the Company profile chooses its own as well (#425): written to `co-` and remembered as its choice.
  const main=await changeCompanySetting(db,{company,agent:lead,setting:'model',value:'openrouter/anthropic/claude-opus-4.6',hermes:install(fake),driver:driver(fake)});
  assert.equal(main.state,'written',JSON.stringify(main));
  assert.equal(requestsTo(fake,'/model').at(-1).path,`/api/profiles/${companyProfileName}/model`);
  assert.equal(fake.settings.profiles.get(companyProfileName).model,'anthropic/claude-opus-4.6');
  assert.deepEqual(calls.filter(call=>call.name==='set_agent_model').at(-1).args,{agent:lead,model:'openrouter/anthropic/claude-opus-4.6'});
  // An Agent the worker is still moving holds a record but runs on the Company profile: it is not choosable either.
  const moving=rows(); moving[1]={...moving[1],own:false};
  const mid=await changeCompanySetting(database({rowsFor:moving}).db,{company,agent:writer,setting:'model',value:'openrouter/openai/gpt-5.5',hermes:install(fake),driver:driver(fake)});
  assert.equal(mid.state,'shared');
 } finally { await fake.close(); }
});

test('only the Owner changes a model, and a refused or unknown Agent changes nothing', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  const refused=await changeCompanySetting(database({owner:false}).db,{company,setting:'model',value:'openrouter/openai/gpt-5.5',hermes:install(fake),driver:driver(fake)});
  assert.deepEqual(refused,{state:'notAllowed'});
  const unknown=await changeCompanySetting(database().db,{company,agent:'3a000000-0000-0000-0000-0000000000ff',setting:'model',value:'openrouter/openai/gpt-5.5',hermes:install(fake),driver:driver(fake)});
  assert.equal(unknown.state,'agentUnknown');
  const bad=await changeCompanySetting(database().db,{company,setting:'model',value:'no-slash',hermes:install(fake),driver:driver(fake)});
  assert.equal(bad.state,'invalid');
  assert.equal(requestsTo(fake,'/model').length,0);
 } finally { await fake.close(); }
});

test('the Owner turns sub-agents on for one Agent, logged, and its settings are written only while it is on', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  const {db,calls,logged}=database();
  const on=await changeCompanySetting(db,{company,agent:writer,setting:'subagents',value:true});
  assert.deepEqual(on,{state:'written',setting:'subagents',agent:writer,subagents:true});
  assert.deepEqual(calls.filter(call=>call.name==='set_agent_subagents').map(call=>call.args),[{agent:writer,enabled:true}]);
  assert.deepEqual(logged().map(row=>[row.agent,row.setting,row.old_value,row.new_value]),[[writer,'subagents',false,true]]);
  // The main Agent on the Company profile has its own switch too (#425); an Agent sharing a profile it does not keep has
  // none; only a boolean is a value.
  assert.deepEqual(await changeCompanySetting(db,{company,agent:lead,setting:'subagents',value:true}),{state:'written',setting:'subagents',agent:lead,subagents:true});
  const sharing=rows(); sharing[1]={...sharing[1],own:false,choosable:false};
  assert.equal((await changeCompanySetting(database({rowsFor:sharing}).db,{company,agent:writer,setting:'subagents',value:true})).state,'shared');
  // While the worker still moves another Agent off the main Agent's profile, the profile is shared: refused, as every
  // other per-Agent write is, until the move finishes.
  const moving=[...rows(),{agent:'3a000000-0000-0000-0000-000000000041',name:'Mover',profile:companyProfileName,own:false,choosable:false,model_choice:null,subagents:false}];
  assert.equal((await changeCompanySetting(database({rowsFor:moving}).db,{company,agent:lead,setting:'subagents',value:true})).state,'shared');
  assert.equal((await changeCompanySetting(database({rowsFor:moving}).db,{company,agent:lead,setting:'model',value:'openrouter/openai/gpt-5.5',hermes:install(fake),driver:driver(fake)})).state,'shared');
  assert.equal((await changeCompanySetting(db,{company,agent:writer,setting:'subagents',value:'yes'})).state,'invalid');
  assert.equal((await changeCompanySetting(database({owner:false}).db,{company,agent:writer,setting:'subagents',value:true})).state,'notAllowed');
  // A delegation setting is refused while sub-agents are off, and written through #125's route when they are on.
  const off=await changeCompanySetting(db,{company,agent:writer,setting:'delegation.reasoning_effort',value:'high',hermes:install(fake),driver:driver(fake)});
  assert.deepEqual(off,{state:'subagentsOff'});
  assert.equal(requestsTo(fake,'/api/config').length,0);
  const enabled=rows(); enabled[1]={...enabled[1],subagents:true};
  const written=await changeCompanySetting(database({rowsFor:enabled}).db,{company,agent:writer,setting:'delegation.max_concurrent_children',value:4,hermes:install(fake),driver:driver(fake)});
  assert.equal(written.state,'written',JSON.stringify(written));
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

test('a sub-agent\'s model is one save of the provider and the bare model id the Engine reads apart', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  enabled: {
   const on=rows(); on[1]={...on[1],subagents:true};
   const {db}=database({rowsFor:on});
   const before=fake.settings.managementRequests.length;
   const saved=await changeCompanySettings(db,{company,agent:writer,settings:{'delegation.provider':'openrouter','delegation.model':'anthropic/claude-opus-4.6'},hermes:install(fake),driver:driver(fake)});
   assert.equal(saved.state,'written',JSON.stringify(saved));
   assert.deepEqual(fake.settings.profiles.get(own(writer)).config.delegation,{provider:'openrouter',model:'anthropic/claude-opus-4.6'},'the Engine gets the provider and the model id, never provider/model in one key');
   assert.deepEqual(fake.settings.managementRequests.slice(before).filter(request=>request.method==='PUT'&&request.path.includes('/api/config')).map(request=>request.body),[
    {config:{delegation:{provider:'openrouter',model:'anthropic/claude-opus-4.6'}}},
   ],'the pair is one config update');
   // Both values are checked before the one write: a bad second value sends nothing.
   const refused=await changeCompanySettings(db,{company,agent:writer,settings:{'delegation.provider':'anthropic','delegation.max_concurrent_children':'3'},hermes:install(fake),driver:driver(fake)});
   assert.deepEqual(refused,{state:'invalid',problem:'type'});
   assert.equal(fake.settings.managementRequests.slice(before).filter(request=>request.method==='PUT').length,1,'no write follows a refused pair');
   // A write the Engine refuses leaves neither half of the pair stored.
   fake.settings.configWriteFail.add(own(writer));
   const failed=await changeCompanySettings(db,{company,agent:writer,settings:{'delegation.provider':'anthropic','delegation.model':'claude-opus-4-6'},hermes:install(fake),driver:driver(fake)});
   assert.notEqual(failed.state,'written',JSON.stringify(failed));
   assert.deepEqual(fake.settings.profiles.get(own(writer)).config.delegation,{provider:'openrouter',model:'anthropic/claude-opus-4.6'},'neither key changed');
   fake.settings.configWriteFail.delete(own(writer));
   // A write the Engine accepts but does not apply is a mismatch, not a save.
   fake.settings.staleConfig=true;
   const stale=await changeCompanySettings(db,{company,agent:writer,settings:{'delegation.provider':'anthropic','delegation.model':'claude-opus-4-6'},hermes:install(fake),driver:driver(fake)});
   assert.deepEqual(stale,{state:'mismatch',old:'openrouter'});
  }
 } finally { await fake.close(); }
});

// #436: a Company default reads which Agents chose a model, then writes every other profile. One Agent's own model chosen
// while that write waits on the Engine used to be overwritten there while the database kept the choice; the two writes now
// run one after the other for the Company, so after both the Engine holds what the record says.
test('an Agent\'s own model chosen during a Company default ends with the Engine holding that Agent\'s choice', async () => {
 const fake=await fakeHermes();
 try {
  seed(fake); schema(fake);
  // The Company's Claude subscription is a Provider of the Writer's Anthropic model (#620).
  fake.settings.defaultCredentials.anthropic='test-only-claude-oauth';
  // The record is the database's: a choice remembered by set_agent_model is what the next read answers.
  const state=rows();
  const {db}=database({rowsFor:state});
  const answer=db.rpc;
  db.rpc=async(name,args)=>{
   if(name==='set_agent_model') { const row=state.find(found=>found.agent===args.agent); row.model_choice=args.model; }
   return answer(name,args);
  };
  // Settled once the Agent's own choice has ended; made before the Company-wide write starts, so the hold below waits on it.
  let agentFinished=()=>{};
  const agentEnded=new Promise(resolve=>{ agentFinished=resolve; });
  let released=null;
  // The default's Engine writes wait until the Agent's own choice has finished, or a while when that choice waits on the
  // default itself.
  const held={...driver(fake),writeModel:async(target,change)=>{
   released??=Promise.race([agentEnded,new Promise(resolve=>setTimeout(resolve,300))]);
   await released;
   return driver(fake).writeModel(target,change);
  }};
  const companyDefault=changeCompanySetting(db,{company,setting:'model',value:'openrouter/openai/gpt-5.4',hermes:install(fake),driver:held});
  // The Agent's choice starts once the default has read which Agents chose their own.
  while(!released) await new Promise(resolve=>setTimeout(resolve,5));
  const agentDone=changeCompanySetting(db,{company,agent:writer,setting:'model',value:'anthropic/claude-opus-4-6',hermes:install(fake),driver:driver(fake)}).finally(agentFinished);
  const [wide,chosen]=await Promise.all([companyDefault,agentDone]);
  assert.equal(wide.state,'written',JSON.stringify(wide));
  assert.equal(chosen.state,'written',JSON.stringify(chosen));
  assert.equal(state.find(row=>row.agent===writer).model_choice,'anthropic/claude-opus-4-6','the database keeps the Writer\'s choice');
  const engine=fake.settings.profiles.get(own(writer));
  assert.deepEqual([engine.provider,engine.model],['anthropic','claude-opus-4-6'],'the Engine holds the Writer\'s choice too');
  for(const name of [space,companyProfileName]) assert.equal(fake.settings.profiles.get(name).model,'openai/gpt-5.4',`${name} takes the default`);
 } finally { await fake.close(); }
});
