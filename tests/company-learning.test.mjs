import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readConfig, readSavedConfig, readConfigSchema, readConfigDefaults, writeConfig, readSkills, readLearningGraph } from '../lib/hermes.mjs';
import { readAgentSettings, changeLearningMode, learningModeOf } from '../lib/engine-settings.mjs';
import { readCompanyLearning } from '../lib/company-learning.mjs';
import { companyProfile } from '../lib/agent-toolsets.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// The Learning section (#28): the Company's mode is the Engine's memory.write_approval and skills.write_approval written
// to every Agent profile (and the shared space) through #125, an Agent's override is its own profile only, and each
// Agent's mode is read back from its profile. What an Agent learned is its rules (agent_rules), the Skills the Engine's
// learning graph says it wrote on its own (#180), and the Company's approved lessons once for the Company.
const fixture=JSON.parse(readFileSync(new URL('./engine-schema.json',import.meta.url),'utf8'));
const company='10000000-0000-0000-0000-000000000001';
const [lead,writer,helper]=['3a000000-0000-0000-0000-000000000011','3a000000-0000-0000-0000-000000000021','3a000000-0000-0000-0000-000000000041'];
const omar='20000000-0000-0000-0000-000000000001';
const hex=id=>id.replaceAll('-','');
const space=`cs-${hex(company)}`;
const agentProfile=id=>`ag-${hex(id)}`;
const rows=[
 {agent:lead,name:'Lead',connection:'f1000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:true,own:true},
 {agent:writer,name:'Writer',connection:'f1000000-0000-0000-0000-000000000021',profile:agentProfile(writer),main:false,own:true},
 {agent:helper,name:'Helper',connection:'f1000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:false,own:false},
];
const at=(object,key)=>key.split('.').reduce((found,part)=>found&&typeof found==='object'?found[part]:undefined,object);
const setup=fake=>{ fake.settings.configDefaults=fixture.defaults; fake.settings.configSchema={fields:fixture.schema,category_order:[]}; };
const profileOn=(fake,name,config={})=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config,credentials:{}});
const skillMd=(name,description='Writes the Friday recap.')=>`---\nname: ${name}\ndescription: ${description}\n---\n\nDo the thing.\n`;

const ruleRows=[
 {id:'c0000000-0000-0000-0000-000000000001',agent_id:lead,body:'Answer in short points',said_by:omar,said_at:'2026-11-18T10:00:00Z',removed_at:null,suggestion:null,teller:{name:'Omar'}},
 {id:'c0000000-0000-0000-0000-000000000002',agent_id:writer,body:'No emojis',said_by:omar,said_at:'2026-11-17T10:00:00Z',removed_at:'2026-11-18T11:00:00Z',suggestion:'approved',teller:{name:'Omar'}},
 {id:'c0000000-0000-0000-0000-000000000003',agent_id:writer,body:'Send the price list only when asked',said_by:omar,said_at:'2026-11-16T10:00:00Z',removed_at:null,suggestion:'approved',teller:{name:'Omar'}},
];
function database({owner=true,agents=rows,rules=ruleRows,modes=new Map()}={}) {
 const logged=[];
 const db={rpc:async(name,args)=>{
  if(name==='is_company_owner') return {data:owner,error:null};
  if(name==='company_engine_target') return {data:[{profile:companyProfile(args.c),profiles:[]}],error:null};
  if(name==='company_app_agents') return {data:agents,error:null};
  if(name==='company_learning_modes') return {data:agents.map(row=>({agent:row.agent,learning_mode_choice:modes.get(row.agent)??null})),error:null};
  if(name==='set_agent_learning_mode') { if(args.mode===null) modes.delete(args.agent); else modes.set(args.agent,args.mode); return {data:null,error:null}; }
  if(name==='log_engine_setting') { logged.push(args); return {data:null,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 },from:(table)=>{
  if(table!=='agent_rules') return {select:()=>({eq:()=>({or:()=>({order:async()=>({data:null,error:{message:'unexpected'}})})})})};
  const query={select:()=>query,eq:()=>query,or:()=>query,order:async()=>({data:rules,error:null})};
  return query;
 }};
 return {db,logged};
}
const settingsDriver=fake=>({
 config:target=>readConfig({...target,managementAddress:fake.managementAddress}),
 saved:target=>readSavedConfig({...target,managementAddress:fake.managementAddress}),
 schema:target=>readConfigSchema({...target,managementAddress:fake.managementAddress}),
 defaults:target=>readConfigDefaults({...target,managementAddress:fake.managementAddress}),
 write:(target,config)=>writeConfig({...target,managementAddress:fake.managementAddress},config),
});
const driverAt=fake=>({
 ...settingsDriver(fake),
 read:target=>readSkills({...target,managementAddress:fake.managementAddress}),
 learned:target=>readLearningGraph({...target,managementAddress:fake.managementAddress}),
});
const requestsOf=(fake,method)=>fake.settings.managementRequests.filter(request=>request.method===method);

test('the mode is both write approvals: by itself is two offs, ask first is two ons, and one of each reads mixed', () => {
 const settings=(memory,skills)=>[{key:'memory.write_approval',value:memory},{key:'skills.write_approval',value:skills}];
 assert.equal(learningModeOf(settings(false,false)),'auto');
 assert.equal(learningModeOf(settings(true,true)),'ask');
 assert.equal(learningModeOf(settings(true,false)),'mixed');
 assert.equal(learningModeOf(settings(false,true)),'mixed');
 assert.equal(learningModeOf(null),null,'a profile whose mode cannot be read has none');
});

test('the Company\'s mode reaches every Agent profile and the shared space, and each Agent\'s two values read back', async () => {
 const fake=await fakeHermes();
 try {
  setup(fake);
  for(const row of rows) profileOn(fake,row.profile);
  profileOn(fake,space);
  const {db,logged}=database();
  const changed=await changeLearningMode(db,{company,mode:'ask',hermes:{address:fake.address,key:fake.settings.key},driver:settingsDriver(fake)});
  assert.equal(changed.state,'written',JSON.stringify(changed));
  assert.deepEqual(changed.agents.map(agent=>[agent.agent,agent.written]),[[lead,true],[writer,true],[helper,true]]);
  assert.equal(changed.space,true,'the shared space takes the same value');
  for(const name of [companyProfile(company),agentProfile(writer),space]) {
   const config=fake.settings.profiles.get(name).config;
   assert.deepEqual([at(config,'memory.write_approval'),at(config,'skills.write_approval')],[true,true],`${name} asks first`);
  }
  // Read back from each Agent's own profile through the settings reader.
  for(const agent of [lead,writer,helper]) {
   const read=await readAgentSettings(db,{company,agent,hermes:{address:fake.address,key:fake.settings.key},driver:settingsDriver(fake)});
   const listed=read.agents[0].settings;
   assert.deepEqual([listed.find(setting=>setting.key==='memory.write_approval').value,listed.find(setting=>setting.key==='skills.write_approval').value],[true,true],`${agent} reads ask first`);
   assert.equal(learningModeOf(listed),'ask');
  }
  assert.deepEqual(logged.map(entry=>[entry.agent,entry.setting,entry.old_value,entry.new_value]),[
   [lead,'memory.write_approval',false,true],[writer,'memory.write_approval',false,true],[helper,'memory.write_approval',false,true],
   [lead,'skills.write_approval',false,true],[writer,'skills.write_approval',false,true],[helper,'skills.write_approval',false,true],
  ],'each Agent is one log row per setting it changed');
  // The Agent's override writes that Agent's own profile only, and is read back beside the Company's mode.
  const beforeOverride=requestsOf(fake,'PUT').length;
  const override=await changeLearningMode(db,{company,agent:writer,mode:'auto',hermes:{address:fake.address,key:fake.settings.key},driver:settingsDriver(fake)});
  assert.equal(override.state,'written',JSON.stringify(override));
  assert.deepEqual([at(fake.settings.profiles.get(agentProfile(writer)).config,'memory.write_approval'),at(fake.settings.profiles.get(agentProfile(writer)).config,'skills.write_approval')],[false,false]);
  for(const name of [companyProfile(company),space]) assert.deepEqual([at(fake.settings.profiles.get(name).config,'memory.write_approval'),at(fake.settings.profiles.get(name).config,'skills.write_approval')],[true,true],`${name} keeps the Company's ask first`);
  const reread=await readAgentSettings(db,{company,hermes:{address:fake.address,key:fake.settings.key},driver:settingsDriver(fake)});
  assert.deepEqual(reread.agents.map(agent=>[agent.name,learningModeOf(agent.settings)]),[['Lead','ask'],['Writer','auto'],['Helper','ask']]);
  const overridePaths=requestsOf(fake,'PUT').slice(beforeOverride).map(request=>request.path);
  assert.deepEqual(overridePaths,[`/api/config?profile=${agentProfile(writer)}`,`/api/config?profile=${agentProfile(writer)}`],'the override writes that Agent\'s own profile alone, once per setting');
  // A Company-wide change leaves an Agent that chose its own mode alone: the Writer asks first while the Company turns
  // by itself, and its own profile keeps the choice.
  await changeLearningMode(db,{company,agent:writer,mode:'ask',hermes:{address:fake.address,key:fake.settings.key},driver:settingsDriver(fake)});
  const companyAuto=await changeLearningMode(db,{company,mode:'auto',hermes:{address:fake.address,key:fake.settings.key},driver:settingsDriver(fake)});
  assert.equal(companyAuto.state,'written',JSON.stringify(companyAuto));
  assert.deepEqual([at(fake.settings.profiles.get(agentProfile(writer)).config,'memory.write_approval'),at(fake.settings.profiles.get(agentProfile(writer)).config,'skills.write_approval')],[true,true],'the Writer keeps its own ask first');
  for(const name of [companyProfile(company),space]) assert.deepEqual([at(fake.settings.profiles.get(name).config,'memory.write_approval'),at(fake.settings.profiles.get(name).config,'skills.write_approval')],[false,false],`${name} follows the Company by itself`);
  // Following the Company again writes the Company's own mode to that Agent and forgets its choice.
  const follow=await changeLearningMode(db,{company,agent:writer,mode:'follow',hermes:{address:fake.address,key:fake.settings.key},driver:settingsDriver(fake)});
  assert.equal(follow.state,'written',JSON.stringify(follow));
  assert.deepEqual([at(fake.settings.profiles.get(agentProfile(writer)).config,'memory.write_approval'),at(fake.settings.profiles.get(agentProfile(writer)).config,'skills.write_approval')],[false,false],'the Writer takes the Company\'s by itself');
  const afterFollow=await readCompanyLearning(db,{company,hermes:{address:fake.address,key:fake.settings.key},driver:driverAt(fake)});
  assert.deepEqual(afterFollow.agents.map(agent=>[agent.name,agent.mode,agent.follow]),[['Lead','auto',true],['Writer','auto',true],['Helper','auto',true]],'the Writer follows the Company again');
 } finally { await fake.close(); }
});

test('the mode changes for the Owner only, before the Engine is asked, and a mode this version does not know writes nothing', async () => {
 const fake=await fakeHermes();
 try {
  setup(fake);
  for(const row of rows) profileOn(fake,row.profile);
  profileOn(fake,space);
  const before=requestsOf(fake,'PUT').length;
  const denied=await changeLearningMode(database({owner:false}).db,{company,mode:'ask',hermes:{address:fake.address,key:fake.settings.key},driver:settingsDriver(fake)});
  assert.deepEqual(denied.state,'notAllowed');
  const invalid=await changeLearningMode(database().db,{company,mode:'sometimes',hermes:{address:fake.address,key:fake.settings.key},driver:settingsDriver(fake)});
  assert.deepEqual(invalid.state,'invalid');
  assert.equal(requestsOf(fake,'PUT').length,before,'no value reached the Engine');
 } finally { await fake.close(); }
});

test('what an Agent learned is read beside its mode: its rules including a removed one, its learned Skills, and the Company\'s lessons once', async () => {
 const fake=await fakeHermes();
 try {
  setup(fake);
  profileOn(fake,companyProfile(company),{memory:{write_approval:true},skills:{write_approval:true}});
  profileOn(fake,agentProfile(writer),{memory:{write_approval:true}});
  profileOn(fake,space);
  fake.settings.skills.set(agentProfile(writer),new Map([['weekly-recap',skillMd('weekly-recap')],['hub-skill',skillMd('hub-skill')]]));
  fake.settings.skillProvenance.set(`${agentProfile(writer)}:hub-skill`,'hub');
  fake.settings.learnedSkills.set(agentProfile(writer),new Set(['weekly-recap']));
  const {db}=database();
  const read=await readCompanyLearning(db,{company,hermes:{address:fake.address,key:fake.settings.key},driver:driverAt(fake)});
  assert.equal(read.state,'found',JSON.stringify(read));
  assert.deepEqual(read.agents.map(agent=>[agent.name,agent.own,agent.shared,agent.mode]),[['Lead',true,true,'ask'],['Writer',true,false,'mixed'],['Helper',false,true,'ask']],'the main Agent profile is shared with Helper; Writer has one approval on and one off');
  assert.deepEqual(read.agents.find(agent=>agent.id===writer).learned,[{name:'weekly-recap',description:'Writes the Friday recap.'}],'only the Skill the learning graph marks is learned');
  assert.deepEqual(read.rules.map(rule=>[rule.id,rule.agent,rule.body,rule.removed,rule.shared]),[
   ['c0000000-0000-0000-0000-000000000001',lead,'Answer in short points',false,false],
   ['c0000000-0000-0000-0000-000000000002',writer,'No emojis',true,true],
   ['c0000000-0000-0000-0000-000000000003',writer,'Send the price list only when asked',false,true],
  ],'a removed rule is still listed for bringing back, and an approved rule is the team\'s');
  assert.deepEqual(read.lessons.map(lesson=>lesson.id),['c0000000-0000-0000-0000-000000000003'],'the Company\'s lessons are its approved rules that are not removed, once');
  // An Engine that cannot be read leaves the modes and the learned Skills unknown, never empty; the rules stay readable.
  const unread=await readCompanyLearning(db,{company,hermes:null,driver:{...driverAt(fake),read:async()=>({state:'unreachable',skills:null})}});
  assert.deepEqual(unread.agents.map(agent=>[agent.name,agent.mode,agent.learned]),[['Lead',null,null],['Writer',null,null],['Helper',null,null]]);
  assert.equal(unread.rules.length,3,'the rules are the database\'s, readable without the Engine');
 } finally { await fake.close(); }
});
