import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSkills, writeSkill } from '../lib/hermes.mjs';
import { readCompanySkills, changeCompanySkill } from '../lib/company-skills.mjs';
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
function sessions(fake,{allowed=true}={}) {
 const db={rpc:async(name,args)=>{
  if(name==='company_engine_target') return {data:[{profile:companyProfile(args.c)}],error:null};
  if(name==='company_app_agents') return {data:rows,error:null};
  return {data:null,error:{message:'unexpected'}};
 }};
 // The install's Hermes is the fake (#342): the code reaches it as it reaches the bundled one.
 process.env.BUNDLED_HERMES_URL=fake.address; process.env.HERMES_API_KEY='test-only-key';
 const service={};
 return {db,service,allowed};
}
const driverAt=fake=>{ const at=target=>({...target,managementAddress:fake.managementAddress}); return {read:target=>readSkills(at(target)),write:(target,skill)=>writeSkill(at(target),skill)}; };
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
  const {db,service}=sessions(fake);
  const read=await readCompanySkills(db,service,{company,driver:driverAt(fake)});
  assert.deepEqual(read,[
   {id:lead,name:'Lead',own:true,skills:[{name:'team-lessons',shared:true}]},
   {id:writer,name:'Writer',own:true,skills:[{name:'weekly-recap',shared:false},{name:'team-lessons',shared:true}]},
   {id:helper,name:'Helper',own:false,skills:[{name:'team-lessons',shared:true}]},
  ]);
  const unread=await readCompanySkills(db,service,{company,driver:{read:async()=>({state:'unreachable',skills:null})}});
  assert.deepEqual(unread?.map(agent=>agent.skills),[null,null,null],'a profile that cannot be read has no list, never an empty one');
 } finally { await fake.close(); }
});

test('a skill is written into the Agent\'s own profile, rewritten whole, and never over a shared one', async () => {
 const fake=await fakeHermes();
 try {
  const shared={skills:{external_dirs:[`/opt/data/profiles/${space}/skills`]}};
  profileOn(fake,companyProfile(company),shared); profileOn(fake,agentProfile(writer),shared); profileOn(fake,space);
  fake.settings.skills.set(space,new Map([['team-lessons',skillMd('team-lessons')]]));
  const {db,service}=sessions(fake);
  const driver=driverAt(fake);
  const change=(agent,content)=>changeCompanySkill(db,service,{company,agent,content,driver});
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
