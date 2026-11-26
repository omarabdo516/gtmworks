import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNoEngine } from './engine-records.mjs';
import { withDriver, engineServing } from './engine-records.mjs';
import { readAgent, writeAgentAbout } from '../lib/engine/agents.mjs';
import { readAgentAbout, changeAgentAbout } from '../lib/agent-about.mjs';
import { companyProfile } from '../lib/agent-toolsets.mjs';
// The driver calls a test answers its own way, by their names before #782, as the Engine handle names them.
const DRIVER={'read':'agents.read','about':'agents.writeAbout'};

// #161: the Agent page's About is its own Engine profile's description. The database says which profile is the Agent's
// and whether it is its own (an Agent still on the Company's shared profile changes the main Agent too, so it is
// refused), checks that the person is an active Owner or Manager who sees the Agent, and writes one Company log row.
const company='10000000-0000-0000-0000-000000000001';
const [lead,helper]=['3b000000-0000-0000-0000-000000000011','3b000000-0000-0000-0000-000000000021'];
const rows=[
 {agent:lead,name:'Lead',connection:'f0000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:true,own:true},
 {agent:helper,name:'Helper',connection:'f0000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:false,own:false},
];
// The database as the signed-in person reaches it: check_agent_setting answers the Role and visibility check (`refuse`
// names its refusal), and every log_agent_setting call is kept.
function sessions(fake,{refuse=null,agents=rows,target=true}={}) {
 const logged=[];
 const db={rpc:async(name,args)=>{
  if(name==='company_engine_target') return {data:target?[{profile:companyProfile(args.c)}]:[],error:null};
  if(name==='company_app_agents') return {data:agents,error:null};
  if(name==='check_agent_setting') return {data:null,error:refuse?{message:refuse}:null};
  if(name==='log_agent_setting') { logged.push(args); return {data:null,error:null}; }
  return {data:null,error:{message:'unexpected'}};
 }};
 process.env.BUNDLED_HERMES_URL=fake.address; process.env.HERMES_API_KEY='test-only-key';
 return {db,logged};
}
const driverAt=fake=>{ const at=target=>({...target,managementAddress:fake.managementAddress}); return {read:target=>readAgent(at(target),target.profile),about:(target,change)=>writeAgentAbout(at(target),change)}; };
const profileOn=(fake,name,meta={})=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{},display_name:null,description:'',description_auto:true,bot_title:null,...meta});

test('an Agent\'s About is read from its own profile, with its name and title, and an Agent sharing the Company profile says so', async () => {
 const fake=await engineServing(company);
 try {
  profileOn(fake,companyProfile(company),{display_name:'Lead',description:'Runs the team.',description_auto:false,bot_title:'Marketing lead'});
  const {db}=sessions(fake);
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>readAgentAbout(db,{company,agent:lead})),
   {state:'found',own:true,displayName:'Lead',description:'Runs the team.',descriptionAuto:false,botTitle:'Marketing lead'});
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>readAgentAbout(db,{company,agent:helper})),
   {state:'found',own:false,displayName:'Lead',description:'Runs the team.',descriptionAuto:false,botTitle:'Marketing lead'});
 } finally { await fake.close(); }
});

test('About is written on the Agent\'s own profile and logged once, with the field and no text', async () => {
 const fake=await engineServing(company);
 try {
  profileOn(fake,companyProfile(company),{description:'Old words.'});
  const {db,logged}=sessions(fake);
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentAbout(db,{company,agent:lead,description:' Plans and runs the Meta ads. '})),
   {state:'written',description:'Plans and runs the Meta ads.'});
  assert.equal(fake.settings.profiles.get(companyProfile(company)).description,'Plans and runs the Meta ads.');
  assert.deepEqual(logged,[{c:company,agent:lead,field:'about',old_value:null,new_value:null}],'the row names the field, never the text');
 } finally { await fake.close(); }
});

test('an Agent on the Company profile is refused before the Engine is asked, as are a person the database refuses and a bad request', async () => {
 const fake=await engineServing(company);
 try {
  profileOn(fake,companyProfile(company));
  const shared=sessions(fake);
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentAbout(shared.db,{company,agent:helper,description:'Words.'})),{state:'notOwn',description:null});
  assert.deepEqual(shared.logged,[],'nothing is logged for a change that did not happen');
  const refused=sessions(fake,{refuse:'agentSettingNotAllowed'});
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentAbout(refused.db,{company,agent:lead,description:'Words.'})),{state:'notAllowed',description:null});
  assert.deepEqual(await withDriver(DRIVER,{read:async()=>assert.fail('the Engine is not read'),about:async()=>assert.fail('the Engine is not written')},()=>changeAgentAbout(refused.db,{company,agent:lead,description:'Words.'})),{state:'notAllowed',description:null});
  assert.equal(fake.settings.managementRequests.filter(request=>request.method==='PUT').length,0,'a refused change writes nothing');
  const noEngine=sessions(fake,{target:false});
  assert.deepEqual(await withNoEngine(company,()=>withDriver(DRIVER,driverAt(fake),()=>changeAgentAbout(noEngine.db,{company,agent:lead,description:'Words.'}))),{state:'noEngine',description:null});
  for(const change of [{company:'',agent:lead,description:'Words.'},{company,agent:'Lead',description:'Words.'},{company,agent:lead,description:7}])
   assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentAbout(refused.db,{...change})),{state:'invalid',description:null},JSON.stringify(change));
 } finally { await fake.close(); }
});

test('a write the Engine fails is that state, and nothing is logged', async () => {
 const fake=await engineServing(company);
 try {
  profileOn(fake,companyProfile(company));
  const {db,logged}=sessions(fake);
  fake.settings.managementStatus=500;
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentAbout(db,{company,agent:lead,description:'Words.'})),{state:'failed',description:null});
  fake.settings.managementStatus=401;
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentAbout(db,{company,agent:lead,description:'Words.'})),{state:'refused',description:null});
  assert.deepEqual(logged,[]);
 } finally { await fake.close(); }
});
