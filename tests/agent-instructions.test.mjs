import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNoEngine } from './engine-records.mjs';
import { withDriver, engineServing } from './engine-records.mjs';
import { readAgentInstructions as readDriver, writeAgentInstructions as writeDriver } from '../lib/engine/souls.mjs';
import { readAgentInstructions, changeAgentInstructions } from '../lib/agent-instructions.mjs';
import { companyProfile } from '../lib/agent-toolsets.mjs';
// The driver calls a test answers its own way, by their names before #782, as the Engine handle names them.
const DRIVER={'read':'souls.readInstructions','instructions':'souls.writeInstructions'};

// #176: an Agent's standing instructions are read from its own Engine profile and saved by the Owner alone. The database
// says which profile is the Agent's and whether it is its own (an Agent still on the Company's shared profile is
// refused), checks the Owner who sees the Agent, and writes one Company log row with the field and no text.
const company='10000000-0000-0000-0000-000000000001';
const [lead,helper]=['3b000000-0000-0000-0000-000000000011','3b000000-0000-0000-0000-000000000021'];
const section='<!-- gtmworks:rules -->\n- Be brief\n<!-- /gtmworks:rules -->';
const rows=[
 {agent:lead,name:'Lead',connection:'f0000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:true,own:true},
 {agent:helper,name:'Helper',connection:'f0000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:false,own:false},
];
// The database as the signed-in person reaches it: check_agent_owner_setting answers the Role and visibility check
// (`refuse` names its refusal), and every log_agent_instructions call is kept.
function sessions(fake,{refuse=null,agents=rows,target=true}={}) {
 const logged=[];
 const db={rpc:async(name,args)=>{
  if(name==='company_engine_target') return {data:target?[{profile:companyProfile(args.c)}]:[],error:null};
  if(name==='company_app_agents') return {data:agents,error:null};
  if(name==='check_agent_owner_setting') return {data:null,error:refuse?{message:refuse}:null};
  if(name==='log_agent_instructions') { logged.push(args); return {data:null,error:null}; }
  return {data:null,error:{message:'unexpected'}};
 }};
 process.env.BUNDLED_HERMES_URL=fake.address; process.env.HERMES_API_KEY='test-only-key';
 return {db,logged};
}
const driverAt=fake=>{ const at=target=>({...target,managementAddress:fake.managementAddress}); return {read:(target,name)=>readDriver(at(target),name),instructions:(target,change)=>writeDriver(at(target),change)}; };
const profileOn=(fake,name,meta={})=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{},...meta});

test('an Agent\'s instructions are read from its own profile outside the rules section, with the section size and limit',async()=>{
 const fake=await engineServing(company);
 try {
  profileOn(fake,companyProfile(company),{soul:`Runs the team.\n${section}\n`,config:{context_file_max_chars:30000}});
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>readAgentInstructions(sessions(fake).db,{company,agent:lead})),
   {state:'found',own:true,instructions:'Runs the team.',sectionChars:section.length,limit:30000});
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>readAgentInstructions(sessions(fake).db,{company,agent:helper})),
   {state:'found',own:false,instructions:'Runs the team.',sectionChars:section.length,limit:30000});
  // An Engine that cannot be read is that state; the page still draws the field read-only.
  fake.settings.managementStatus=401;
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>readAgentInstructions(sessions(fake).db,{company,agent:lead})),
   {state:'refused',own:true,instructions:'',sectionChars:0,limit:20000});
 } finally { await fake.close(); }
});

test('the Owner\'s save writes the profile and logs one row with the field and no text',async()=>{
 const fake=await engineServing(company);
 try {
  profileOn(fake,companyProfile(company),{soul:`Old words.\n${section}\n`});
  const {db,logged}=sessions(fake);
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentInstructions(db,{company,agent:lead,instructions:' New words. '})),
   {state:'written',instructions:' New words. ',sectionChars:section.length,limit:20000});
  assert.equal(fake.settings.profiles.get(companyProfile(company)).soul,` New words. \n${section}\n`);
  assert.deepEqual(logged,[{c:company,agent:lead}],'the row names the Agent and the field; the instructions never reach it');
 } finally { await fake.close(); }
});

test('an Agent on the Company profile, a Manager\'s refusal and a bad request are refused before the Engine is asked',async()=>{
 const fake=await engineServing(company);
 try {
  profileOn(fake,companyProfile(company),{soul:'Words.'});
  const shared=sessions(fake);
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentInstructions(shared.db,{company,agent:helper,instructions:'Other words.'})),
   {state:'notOwn',instructions:null,sectionChars:0,limit:20000});
  assert.deepEqual(shared.logged,[],'nothing is logged for a change that did not happen');
  const refused=sessions(fake,{refuse:'agentSettingNotAllowed'});
  assert.deepEqual(await withDriver(DRIVER,{read:async()=>assert.fail('the Engine is not read'),instructions:async()=>assert.fail('the Engine is not written')},()=>changeAgentInstructions(refused.db,{company,agent:lead,instructions:'Other words.'})),
   {state:'notAllowed',instructions:null,sectionChars:0,limit:20000});
  assert.equal(fake.settings.managementRequests.filter(request=>request.method==='PUT').length,0,'a refused change writes nothing');
  const noEngine=sessions(fake,{target:false});
  assert.equal((await withNoEngine(company,()=>withDriver(DRIVER,driverAt(fake),()=>changeAgentInstructions(noEngine.db,{company,agent:lead,instructions:'Other words.'})))).state,'noEngine');
  for(const change of [{company:'',agent:lead,instructions:'Words.'},{company,agent:'Lead',instructions:'Words.'},{company,agent:lead,instructions:7}])
   assert.equal((await withDriver(DRIVER,driverAt(fake),()=>changeAgentInstructions(refused.db,{...change}))).state,'invalid',JSON.stringify(change));
 } finally { await fake.close(); }
});

test('text over the Engine\'s size is tooLong and is not logged; a write the Engine fails is that state',async()=>{
 const fake=await engineServing(company);
 try {
  profileOn(fake,companyProfile(company),{soul:`Words.\n${section}\n`,config:{context_file_max_chars:section.length+2}});
  const {db,logged}=sessions(fake);
  assert.deepEqual(await withDriver(DRIVER,driverAt(fake),()=>changeAgentInstructions(db,{company,agent:lead,instructions:'123'})),
   {state:'tooLong',instructions:null,sectionChars:section.length,limit:section.length+2});
  assert.deepEqual(logged,[],'a save that did not happen logs nothing');
  fake.settings.managementStatus=500;
  assert.equal((await withDriver(DRIVER,driverAt(fake),()=>changeAgentInstructions(db,{company,agent:lead,instructions:'12'}))).state,'failed');
  fake.settings.managementStatus=401;
  assert.equal((await withDriver(DRIVER,driverAt(fake),()=>changeAgentInstructions(db,{company,agent:lead,instructions:'12'}))).state,'refused');
  assert.deepEqual(logged,[]);
 } finally { await fake.close(); }
});
