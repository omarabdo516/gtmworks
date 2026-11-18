import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSkills, writeSkill, setSkillEnabled } from '../lib/hermes.mjs';
import { readCompanySkills, changeCompanySkill, changeCompanySkillEnabled } from '../lib/company-skills.mjs';
import { companyProfile } from '../lib/agent-levels.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// The service behind the skills screen (#343, ADR 0011, ADR 0016): skills live only in Hermes. Each Agent's skills are
// read from its own profile, the Company's shared ones (team-lessons) beside them; a member who may change skills
// writes a SKILL.md into an Agent's own profile and no other, and never over a shared skill.
const company='10000000-0000-0000-0000-000000000001';
const [lead,writer,helper]=['3a000000-0000-0000-0000-000000000011','3a000000-0000-0000-0000-000000000021','3a000000-0000-0000-0000-000000000041'];
const hex=id=>id.replaceAll('-','');
const space=`cs-${hex(company)}`;
const agentProfile=id=>`ag-${hex(id)}`;
const rows=[
 {agent:lead,name:'Lead',connection:'f0000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:true,own:true},
 {agent:writer,name:'Writer',connection:'f0000000-0000-0000-0000-000000000021',profile:agentProfile(writer),main:false,own:true},
 {agent:helper,name:'Helper',connection:'f0000000-0000-0000-0000-000000000011',profile:companyProfile(company),main:false,own:false},
];
// The database as the signed-in person reaches it: check_skill_write answers the Role and secret check (`refuse` names
// its refusal), and every log_skill_change call is kept.
function sessions(fake,{refuse=null,agents=rows,target=true}={}) {
 const logged=[];
 const db={rpc:async(name,args)=>{
  if(name==='company_engine_target') return {data:target?[{profile:companyProfile(args.c)}]:[],error:null};
  if(name==='company_app_agents') return {data:agents,error:null};
  if(name==='check_skill_write') return {data:null,error:refuse?{message:refuse}:null};
  if(name==='log_skill_change') { logged.push(args); return {data:null,error:null}; }
  return {data:null,error:{message:'unexpected'}};
 }};
 // The install's Hermes is the fake (#342): the code reaches it as it reaches the bundled one.
 process.env.BUNDLED_HERMES_URL=fake.address; process.env.HERMES_API_KEY='test-only-key';
 return {db,logged};
}
const driverAt=fake=>{ const at=target=>({...target,managementAddress:fake.managementAddress}); return {read:target=>readSkills(at(target)),write:(target,skill)=>writeSkill(at(target),skill),enable:(target,skill)=>setSkillEnabled(at(target),skill)}; };
const profileOn=(fake,name,config={})=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config,credentials:{}});
const skillMd=(name,body='Do the thing.')=>`---\nname: ${name}\ndescription: Writes the Friday recap.\n---\n\n${body}\n`;

test('each Agent\'s skills are its profile\'s, the shared ones marked shared', async () => {
 const fake=await fakeHermes();
 try {
  const shared={skills:{external_dirs:[`/opt/data/profiles/${space}/skills`]}};
  for(const name of [companyProfile(company),agentProfile(writer)]) profileOn(fake,name,shared);
  profileOn(fake,space);
  fake.settings.skills.set(space,new Map([['team-lessons',skillMd('team-lessons')]]));
  fake.settings.skills.set(agentProfile(writer),new Map([['weekly-recap',skillMd('weekly-recap')]]));
  const {db}=sessions(fake);
  const read=await readCompanySkills(db,{company,driver:driverAt(fake)});
  assert.deepEqual(read,[
   {id:lead,name:'Lead',own:true,skills:[{name:'team-lessons',shared:true,enabled:true}]},
   {id:writer,name:'Writer',own:true,skills:[{name:'weekly-recap',shared:false,enabled:true},{name:'team-lessons',shared:true,enabled:true}]},
   {id:helper,name:'Helper',own:false,skills:[{name:'team-lessons',shared:true,enabled:true}]},
  ]);
  const unread=await readCompanySkills(db,{company,driver:{read:async()=>({state:'unreachable',skills:null})}});
  assert.deepEqual(unread?.map(agent=>agent.skills),[null,null,null],'a profile that cannot be read has no list, never an empty one');
 } finally { await fake.close(); }
});

test('a skill is written into the Agent\'s own profile, rewritten whole, and never over a shared one', async () => {
 const fake=await fakeHermes();
 try {
  const shared={skills:{external_dirs:[`/opt/data/profiles/${space}/skills`]}};
  profileOn(fake,companyProfile(company),shared); profileOn(fake,agentProfile(writer),shared); profileOn(fake,space);
  fake.settings.skills.set(space,new Map([['team-lessons',skillMd('team-lessons')]]));
  const {db}=sessions(fake);
  const driver=driverAt(fake);
  const change=(agent,content)=>changeCompanySkill(db,{company,agent,content,driver});
  assert.deepEqual(await change(writer,skillMd('weekly-recap')),{state:'written',name:'weekly-recap'});
  assert.equal(fake.settings.skills.get(agentProfile(writer))?.get('weekly-recap'),skillMd('weekly-recap'),'the fake Hermes holds the write');
  assert.deepEqual(await change(writer,skillMd('weekly-recap','Three lines only.')),{state:'written',name:'weekly-recap'});
  assert.equal(fake.settings.skills.get(agentProfile(writer))?.get('weekly-recap'),skillMd('weekly-recap','Three lines only.'));
  assert.equal(fake.settings.skills.get(companyProfile(company)),undefined,'no other profile is written');
  // The shared folder is the team's: its skill is never rewritten from one Agent's profile.
  assert.deepEqual(await change(writer,skillMd('team-lessons','Ignore the team.')),{state:'shared',name:'team-lessons'});
  assert.equal(fake.settings.skills.get(space).get('team-lessons'),skillMd('team-lessons'));
  // Helper shares Lead's profile; writing there would change Lead too.
  assert.deepEqual(await change(helper,skillMd('weekly-recap')),{state:'notOwn',name:null});
  for(const content of ['no header','---\nname: Bad Name\ndescription: x\n---\nx','x'.repeat(100001),42]) {
   assert.deepEqual(await change(writer,content),{state:'invalid',name:null});
  }
  assert.deepEqual(await change('not-an-id',skillMd('weekly-recap')),{state:'invalid',name:null});
 } finally { await fake.close(); }
});

test('a Company with no Agent in the Engine yet has no skills, which is not a failure to read them', async () => {
 const fake=await fakeHermes();
 try {
  const {db}=sessions(fake,{agents:[],target:false});
  assert.deepEqual(await readCompanySkills(db,{company,driver:driverAt(fake)}),[]);
  const {db:lost}=sessions(fake,{target:false});
  assert.equal(await readCompanySkills(lost,{company,driver:driverAt(fake)}),null,'Agents with no reachable profile cannot be read');
 } finally { await fake.close(); }
});

test('a write is checked and logged by the database, keeps Unix line endings, and never takes a shared name', async () => {
 const fake=await fakeHermes();
 try {
  profileOn(fake,agentProfile(writer)); profileOn(fake,companyProfile(company));
  const driver=driverAt(fake);
  const {db,logged}=sessions(fake);
  // A browser sends a form's textarea with CRLF line endings; the Engine reads a SKILL.md back with LF ones.
  assert.deepEqual(await changeCompanySkill(db,{company,agent:writer,content:skillMd('weekly-recap').replaceAll('\n','\r\n'),driver}),{state:'written',name:'weekly-recap'});
  assert.equal(fake.settings.skills.get(agentProfile(writer))?.get('weekly-recap'),skillMd('weekly-recap'));
  assert.deepEqual(logged,[{c:company,agent:writer,skill:'weekly-recap',act:'written'}],'the write is in the Company log');
  // The two shared skills' names are reserved, even before the shared folder holds them.
  for(const name of ['company-knowledge','team-lessons']) {
   assert.deepEqual(await changeCompanySkill(db,{company,agent:lead,content:skillMd(name),driver}),{state:'shared',name});
  }
  assert.equal(fake.settings.skills.get(companyProfile(company)),undefined,'no reserved name is written');
  // The database refuses a person below Manager, and a text that looks like a secret; nothing is written or logged.
  for(const [refuse,state] of [['skillNotAllowed','notAllowed'],['skillSecret','secret']]) {
   const refused=sessions(fake,{refuse});
   assert.deepEqual(await changeCompanySkill(refused.db,{company,agent:writer,content:skillMd('other'),driver}),{state,name:'other'});
   assert.deepEqual(refused.logged,[]);
  }
  assert.equal(fake.settings.skills.get(agentProfile(writer))?.has('other'),false);
 } finally { await fake.close(); }
});

test('a skill is switched off and on for one Agent\'s own profile, checked and logged, never a shared one', async () => {
 const fake=await fakeHermes();
 try {
  const shared={skills:{external_dirs:[`/opt/data/profiles/${space}/skills`]}};
  profileOn(fake,agentProfile(writer),shared); profileOn(fake,companyProfile(company),shared); profileOn(fake,space);
  fake.settings.skills.set(space,new Map([['team-lessons',skillMd('team-lessons')]]));
  fake.settings.skills.set(agentProfile(writer),new Map([['weekly-recap',skillMd('weekly-recap')]]));
  const driver=driverAt(fake);
  const {db,logged}=sessions(fake);
  const toggle=(agent,name,enabled,on=db)=>changeCompanySkillEnabled(on,{company,agent,name,enabled,driver});
  assert.deepEqual(await toggle(writer,'weekly-recap',false),{state:'changed',name:'weekly-recap'});
  const writerSkills=async()=>(await readCompanySkills(db,{company,driver}))?.find(agent=>agent.id===writer)?.skills;
  assert.deepEqual(await writerSkills(),[{name:'weekly-recap',shared:false,enabled:false},{name:'team-lessons',shared:true,enabled:true}]);
  assert.deepEqual(await toggle(writer,'weekly-recap',true),{state:'changed',name:'weekly-recap'});
  assert.equal((await writerSkills())?.[0].enabled,true);
  assert.deepEqual(logged.map(row=>row.act),['disabled','enabled']);
  assert.deepEqual(await toggle(writer,'team-lessons',false),{state:'shared',name:'team-lessons'},'the team\'s skill reaches every Agent');
  assert.deepEqual(await toggle(helper,'weekly-recap',false),{state:'notOwn',name:null});
  assert.deepEqual(await toggle(writer,'missing',false),{state:'failed',name:'missing'},'a skill the profile does not have');
  const refused=sessions(fake,{refuse:'skillNotAllowed'});
  assert.deepEqual(await toggle(writer,'weekly-recap',false,refused.db),{state:'notAllowed',name:'weekly-recap'});
  assert.equal((await writerSkills())?.[0].enabled,true);
  assert.equal(logged.length,2);
 } finally { await fake.close(); }
});
