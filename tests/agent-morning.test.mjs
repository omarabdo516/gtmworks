import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRoutines, createRoutine, triggerRoutine, isSilentReply, readRoutineLastReply } from '../lib/hermes.mjs';
import { readAgentMorning, changeAgentMorning, moveAgentMorning, morningName } from '../lib/agent-morning.mjs';
import { morningTime, morningCron } from '../lib/morning-schedule.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// Good morning (#182): the main Agent's daily message is one job of its own Engine profile, made, timed, paused and
// resumed through the engine contract; the page reads the switch and the time from that job alone.
const company='10000000-0000-0000-0000-000000000001';
const [lead,ads]=['3a000000-0000-0000-0000-000000000011','3a000000-0000-0000-0000-000000000021'];
const hex=id=>id.replaceAll('-','');
const leadProfile=`co-${hex(company)}`; const adsProfile=`ag-${hex(ads)}`;
const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const at=(fake,profile)=>({...install(fake),profile});
const profileOn=(fake,name)=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
const agentRows=(main=lead)=>[
 {agent:lead,name:'Lead',connection:'f0000000-0000-0000-0000-000000000011',profile:leadProfile,main:main===lead,own:true},
 {agent:ads,name:'Meta Ads',connection:'f0000000-0000-0000-0000-000000000021',profile:adsProfile,main:main===ads,own:true},
];
// The signed-in person's database as the lib uses it: the Agents they see, the Company's level, the Role check and the log.
function session({agents=agentRows(),level=3,refuse=null}={}) {
 const logged=[];
 const db={
  rpc:async(name,args)=>{
   if(name==='company_app_agents') return {data:agents,error:null};
   if(name==='check_agent_setting') return refuse?{data:null,error:{message:refuse}}:{data:null,error:null};
   if(name==='log_agent_morning') { if(refuse) return {data:null,error:{message:refuse}}; logged.push(args); return {data:null,error:null}; }
   throw new Error(`unexpected rpc ${name}`);
  },
  from:table=>{ assert.equal(table,'companies'); const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:{agent_level:level},error:null})}; return chain; },
 };
 return {db,logged};
}
async function engine() { const fake=await fakeHermes(); profileOn(fake,leadProfile); profileOn(fake,adsProfile); return fake; }
const writes=fake=>fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/cron/')&&request.method!=='GET');
const jobs=(fake,profile)=>fake.settings.cron.get(profile)??[];

test('switching on makes one job at the chosen time and zone; a new time changes it, off pauses it, on resumes it, and there is never a second', async () => {
 const fake=await engine();
 try {
  const hermes=install(fake); const {db,logged}=session();
  const before=await readAgentMorning(db,{company,agent:lead,hermes});
  assert.deepEqual([before.state,before.allowed,before.routine],['found',true,null],'nothing is made until it is switched on');
  const made=await changeAgentMorning(db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes});
  assert.deepEqual(made,{state:'written',morning:{on:true,time:'9:00'}});
  const create=writes(fake).at(-1);
  assert.equal(create.method,'POST'); assert.equal(new URL(create.path,'http://m').searchParams.get('profile'),leadProfile);
  const [job]=jobs(fake,leadProfile);
  assert.deepEqual([job.name,job.schedule.expr,job.timezone,job.deliver],[morningName,'0 9 * * *','Africa/Cairo','local']);
  assert.match(job.prompt,/\[SILENT\]/,'the prompt asks for the Engine\'s own silence when there is nothing new');
  const read=await readAgentMorning(db,{company,agent:lead,hermes});
  assert.deepEqual(read.routine&&[read.routine.on,read.routine.time,read.routine.timezone],[true,'9:00','Africa/Cairo'],'the page shows what the Engine holds');
  assert.deepEqual((await changeAgentMorning(db,{company,agent:lead,on:true,time:'10:30',zone:'Europe/London',hermes})).morning,{on:true,time:'10:30'});
  assert.equal(writes(fake).at(-1).method,'PUT');
  assert.equal(jobs(fake,leadProfile)[0].schedule.expr,'30 10 * * *');
  assert.equal(jobs(fake,leadProfile)[0].timezone,'Africa/Cairo','the zone stays the one the message was first switched on in');
  assert.deepEqual((await changeAgentMorning(db,{company,agent:lead,on:false,time:'10:30',hermes})).morning,{on:false,time:'10:30'});
  assert.match(writes(fake).at(-1).path,/\/pause\?/);
  assert.deepEqual((await changeAgentMorning(db,{company,agent:lead,on:true,time:'10:30',zone:'Asia/Tokyo',hermes})).morning,{on:true,time:'10:30'});
  assert.match(writes(fake).at(-1).path,/\/resume\?/);
  const count=writes(fake).length;
  assert.equal((await changeAgentMorning(db,{company,agent:lead,on:true,time:'10:30',hermes})).state,'written');
  assert.equal(writes(fake).length,count,'a save that changes nothing asks the Engine for nothing');
  assert.equal(jobs(fake,leadProfile).length,1,'never a second job');
  assert.equal(writes(fake).filter(request=>request.method==='POST'&&request.path.startsWith('/api/cron/jobs?')).length,1,'made once');
  assert.deepEqual(logged.map(row=>[row.old_value,row.new_value]),[['off','9:00'],['9:00','10:30'],['10:30','off'],['off','10:30']]);
  assert.ok(logged.every(row=>row.c===company&&row.agent===lead));
  // A switch off before anything was made makes nothing.
  const fresh=await engine();
  try {
   assert.deepEqual(await changeAgentMorning(db,{company,agent:lead,on:false,time:'9:00',hermes:install(fresh)}),{state:'written',morning:{on:false,time:'9:00'}});
   assert.deepEqual(writes(fresh),[]);
  } finally { await fresh.close(); }
 } finally { await fake.close(); }
});

test('a job whose schedule was changed in a chat shows that time as it is, and a save that keeps it changes nothing', async () => {
 const fake=await engine();
 try {
  await createRoutine(at(fake,leadProfile),{name:morningName,prompt:'Summary',schedule:'15 6 * * *',timezone:'Africa/Cairo'});
  const {db}=session();
  const read=await readAgentMorning(db,{company,agent:lead,hermes:install(fake)});
  assert.equal(read.routine?.time,'6:15');
  const count=writes(fake).length;
  assert.equal((await changeAgentMorning(db,{company,agent:lead,on:true,time:'6:15',hermes:install(fake)})).state,'written');
  assert.equal(writes(fake).length,count);
  fake.settings.cron.get(leadProfile)[0].schedule={kind:'cron',expr:'0 9 * * 1',display:'0 9 * * 1'};
  const weekly=await readAgentMorning(db,{company,agent:lead,hermes:install(fake)});
  assert.deepEqual([weekly.routine?.time,weekly.routine?.schedule.expr],[null,'0 9 * * 1']);
  assert.deepEqual((await changeAgentMorning(db,{company,agent:lead,on:false,time:'0 9 * * 1',hermes:install(fake)})).morning,{on:false,time:'0 9 * * 1'});
  assert.equal((await changeAgentMorning(db,{company,agent:lead,on:true,time:'25:00',hermes:install(fake)})).state,'invalid');
 } finally { await fake.close(); }
});

test('a Contributor or a Viewer is refused before the Engine is asked, and nothing is logged; another Agent has no daily message', async () => {
 const fake=await engine();
 try {
  const {db,logged}=session({refuse:'agentSettingNotAllowed'});
  assert.equal((await changeAgentMorning(db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)})).state,'notAllowed');
  assert.deepEqual(writes(fake),[]); assert.deepEqual(logged,[]);
  // They still read the row.
  assert.equal((await readAgentMorning(db,{company,agent:lead,hermes:install(fake)})).state,'found');
  const owner=session();
  assert.equal((await changeAgentMorning(owner.db,{company,agent:ads,on:true,time:'9:00',hermes:install(fake)})).state,'notMain');
  assert.equal((await readAgentMorning(owner.db,{company,agent:ads,hermes:install(fake)})).state,'notMain');
  assert.equal((await changeAgentMorning(owner.db,{company,agent:lead,on:'yes',time:'9:00',hermes:install(fake)})).state,'invalid');
  assert.equal((await readAgentMorning(owner.db,{company,agent:lead,hermes:null})).state,'noEngine');
 } finally { await fake.close(); }
});

test('below Agent level 3 the daily message is never switched on and the Engine is not asked to make it', async () => {
 const fake=await engine();
 try {
  for(const level of [1,2]) {
   const {db,logged}=session({level});
   const read=await readAgentMorning(db,{company,agent:lead,hermes:install(fake)});
   assert.deepEqual([read.state,read.allowed,read.level],['found',false,level]);
   assert.equal((await changeAgentMorning(db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)})).state,'levelLow');
   assert.deepEqual(writes(fake),[],`level ${level}: no call changes the Engine`);
   assert.deepEqual(logged,[]);
  }
  // One left on from level 3 may still be switched off.
  await createRoutine(at(fake,leadProfile),{name:morningName,prompt:'Summary',schedule:'0 9 * * *'});
  assert.deepEqual((await changeAgentMorning(session({level:1}).db,{company,agent:lead,on:false,time:'9:00',hermes:install(fake)})).morning,{on:false,time:'9:00'});
  assert.equal(jobs(fake,leadProfile)[0].state,'paused');
 } finally { await fake.close(); }
});

test('making another Agent the main one moves the daily message to its profile with the same time and state, and leaves none behind', async () => {
 for(const on of [true,false]) {
  const fake=await engine();
  try {
   const {db}=session();
   await changeAgentMorning(db,{company,agent:lead,on:true,time:'8:30',zone:'Africa/Cairo',hermes:install(fake)});
   if(!on) await changeAgentMorning(db,{company,agent:lead,on:false,time:'8:30',hermes:install(fake)});
   await createRoutine(at(fake,leadProfile),{name:'Ads report',prompt:'Report',schedule:'0 12 * * 1'});
   const owner=session({agents:agentRows(ads)});
   assert.equal((await moveAgentMorning(owner.db,{company,from:lead,to:ads,hermes:install(fake)})).state,'moved');
   assert.deepEqual(jobs(fake,leadProfile).map(job=>job.name),['Ads report'],'the old main Agent keeps its other Routines and no daily message');
   const [moved]=jobs(fake,adsProfile);
   assert.deepEqual([moved.name,moved.schedule.expr,moved.timezone,moved.state],[morningName,'30 8 * * *','Africa/Cairo',on?'scheduled':'paused']);
   const read=await readAgentMorning(owner.db,{company,agent:ads,hermes:install(fake)});
   assert.deepEqual(read.routine&&[read.routine.on,read.routine.time],[on,'8:30']);
   // Moving back replaces any left on the new profile: there is never a second.
   fake.settings.cron.get(leadProfile).push({...moved,id:'abcdefabcdef'});
   assert.equal((await moveAgentMorning(session().db,{company,from:ads,to:lead,hermes:install(fake)})).state,'moved');
   assert.equal(jobs(fake,leadProfile).filter(job=>job.name===morningName).length,1);
   assert.equal(jobs(fake,adsProfile).length,0);
  } finally { await fake.close(); }
 }
 const fake=await engine();
 try { assert.equal((await moveAgentMorning(session().db,{company,from:lead,to:ads,hermes:install(fake)})).state,'none'); } finally { await fake.close(); }
});

test('the hint\'s second sentence is drawn only when the job ran yesterday and sent nothing', async () => {
 const fake=await engine();
 try {
  const {routine}=await createRoutine(at(fake,leadProfile),{name:morningName,prompt:'Summary',schedule:'0 9 * * *',timezone:'Africa/Cairo'});
  const {db}=session();
  fake.settings.cronReply='[SILENT]';
  await triggerRoutine(at(fake,leadProfile),{id:routine.id});
  const last=await readRoutineLastReply(at(fake,leadProfile),{id:routine.id});
  assert.deepEqual([last.state,last.reply],['found','[SILENT]']);
  const ranAt=new Date(jobs(fake,leadProfile)[0].last_run_at);
  const tomorrow=new Date(ranAt.getTime()+864e5);
  assert.equal((await readAgentMorning(db,{company,agent:lead,hermes:install(fake),now:tomorrow})).quietYesterday,true);
  assert.equal((await readAgentMorning(db,{company,agent:lead,hermes:install(fake),now:ranAt})).quietYesterday,false,'today is not yesterday');
  assert.equal((await readAgentMorning(db,{company,agent:lead,hermes:install(fake),now:new Date(ranAt.getTime()+3*864e5)})).quietYesterday,false);
  fake.settings.cronReply='Good morning. Two drafts wait on you.';
  await triggerRoutine(at(fake,leadProfile),{id:routine.id});
  const after=new Date(new Date(jobs(fake,leadProfile)[0].last_run_at).getTime()+864e5);
  assert.equal((await readAgentMorning(db,{company,agent:lead,hermes:install(fake),now:after})).quietYesterday,false,'a message was sent');
 } finally { await fake.close(); }
 for(const silent of ['[SILENT]',' silent ','NO_REPLY','Nothing new.\n[SILENT]','[SILENT] nothing changed']) assert.equal(isSilentReply(silent),true,silent);
 for(const spoken of ['','Two drafts wait. Reply [SILENT] if not.','Good morning']) assert.equal(isSilentReply(spoken),false,spoken);
});

test('the time select\'s value is the clock of a daily schedule', () => {
 assert.equal(morningCron('9:00'),'0 9 * * *'); assert.equal(morningCron('10:30'),'30 10 * * *'); assert.equal(morningCron('9'),null);
 assert.equal(morningTime({schedule:{expr:'0 9 * * *'}}),'9:00'); assert.equal(morningTime({schedule:{expr:'5 7 * * *'}}),'7:05');
 assert.equal(morningTime({schedule:{expr:'0 9 * * 1'}}),null);
});

test('readRoutines still lists the daily message beside the other Routines of the profile', async () => {
 const fake=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)});
  assert.deepEqual((await readRoutines(at(fake,leadProfile))).routines.map(routine=>routine.name),[morningName]);
 } finally { await fake.close(); }
});
