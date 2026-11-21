import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRoutines, createRoutine, triggerRoutine, isSilentReply, readRoutineReplies } from '../lib/hermes.mjs';
import { readAgentMorning, changeAgentMorning, moveAgentMorning, withMorningLease, morningName } from '../lib/agent-morning.mjs';
import { morningTime, morningCron, morningMarker } from '../lib/morning-schedule.mjs';
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
// The signed-in person's database as the lib uses it: the Agents they see, the Role check and the log.
// The Company's lease, shared by every session of a test as the database shares it (take_morning_lease).
const leases=new Map();
function session({agents=agentRows(),refuse=null,keyProfiles=[]}={}) {
 const logged=[];
 const db={
  rpc:async(name,args)=>{
   if(name==='take_morning_lease') { const held=leases.get(args.c); if(held?.live&&held.holder!==args.holder) return {data:false,error:null}; leases.set(args.c,{holder:args.holder,live:true,profiles:held?.profiles??[]}); return {data:true,error:null}; }
   if(name==='renew_morning_lease') { const held=leases.get(args.c); return {data:held?.live===true&&held.holder===args.holder,error:null}; }
   if(name==='morning_lease_profiles') { const held=leases.get(args.c); if(!held?.live||held.holder!==args.holder) return {data:null,error:null}; held.profiles=[...new Set([...held.profiles,...args.adding])].filter(profile=>!args.settled.includes(profile)).sort(); return {data:held.profiles,error:null}; }
   if(name==='drop_morning_lease') { const held=leases.get(args.c); if(held?.holder===args.holder) held.live=false; return {data:null,error:null}; }
   if(name==='company_app_agents') return {data:agents,error:null};
   if(name==='company_key_profiles') return {data:keyProfiles,error:null};
   if(name==='check_agent_setting') return refuse?{data:null,error:{message:refuse}}:{data:null,error:null};
   if(name==='log_agent_morning') { if(refuse) return {data:null,error:{message:refuse}}; logged.push(args); return {data:null,error:null}; }
   throw new Error(`unexpected rpc ${name}`);
  },
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
  assert.deepEqual([before.state,before.routine],['found',null],'nothing is made until it is switched on');
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
  await createRoutine(at(fake,leadProfile),{name:morningName,prompt:`${morningMarker}\nSummary`,schedule:'15 6 * * *',timezone:'Africa/Cairo'});
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
  const {routine}=await createRoutine(at(fake,leadProfile),{name:morningName,prompt:`${morningMarker}\nSummary`,schedule:'0 9 * * *',timezone:'Africa/Cairo'});
  const {db}=session();
  fake.settings.cronReply='[SILENT]';
  await triggerRoutine(at(fake,leadProfile),{id:routine.id});
  const last=await readRoutineReplies(at(fake,leadProfile),{id:routine.id,limit:1});
  assert.deepEqual([last.state,last.runs?.[0]?.reply],['found','[SILENT]']);
  const ranAt=new Date(jobs(fake,leadProfile)[0].last_run_at);
  const tomorrow=new Date(ranAt.getTime()+864e5);
  assert.equal((await readAgentMorning(db,{company,agent:lead,hermes:install(fake),now:tomorrow})).quietYesterday,true);
  assert.equal((await readAgentMorning(db,{company,agent:lead,hermes:install(fake),now:ranAt})).quietYesterday,false,'today is not yesterday');
  assert.equal((await readAgentMorning(db,{company,agent:lead,hermes:install(fake),now:new Date(ranAt.getTime()+3*864e5)})).quietYesterday,false);
  // Today's run has happened too: yesterday's silence is still explained.
  const [silent]=[...fake.settings.sessions].find(([id])=>id.startsWith(`cron_${routine.id}_`));
  const yesterdayRun=fake.settings.sessions.get(silent);
  yesterdayRun.started_at-=864e5/1000; yesterdayRun.messages.forEach(message=>{ message.timestamp-=864e5/1000; });
  fake.settings.cronReply='Good morning. Two drafts wait on you.';
  await triggerRoutine(at(fake,leadProfile),{id:routine.id});
  const today=new Date(jobs(fake,leadProfile)[0].last_run_at);
  assert.equal((await readAgentMorning(db,{company,agent:lead,hermes:install(fake),now:today})).quietYesterday,true,'yesterday was quiet, whatever today sent');
  const tomorrowAgain=new Date(today.getTime()+864e5);
  assert.equal((await readAgentMorning(db,{company,agent:lead,hermes:install(fake),now:tomorrowAgain})).quietYesterday,false,'a message was sent');
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

test('the daily message is the job gtmworks marked, whatever its name: one renamed in a chat stays it, and a Routine merely named "Good morning" never becomes it', async () => {
 const fake=await engine();
 try {
  const {db}=session();
  await createRoutine(at(fake,leadProfile),{name:morningName,prompt:'Tell me the weather',schedule:'0 7 * * *'});
  assert.equal((await readAgentMorning(db,{company,agent:lead,hermes:install(fake)})).routine,null,'a Routine someone named so is not the daily message');
  await changeAgentMorning(db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)});
  assert.equal(jobs(fake,leadProfile).find(job=>job.prompt==='Tell me the weather').schedule.expr,'0 7 * * *','and it is never changed from this page');
  const marked=jobs(fake,leadProfile).find(job=>job.prompt.startsWith(morningMarker));
  marked.name='Morning digest';
  const read=await readAgentMorning(db,{company,agent:lead,hermes:install(fake)});
  assert.deepEqual([read.routine?.on,read.routine?.time],[true,'9:00'],'renamed, it is still the daily message');
  await changeAgentMorning(db,{company,agent:lead,on:false,time:'9:00',hermes:install(fake)});
  assert.equal(jobs(fake,leadProfile).filter(job=>job.prompt.startsWith(morningMarker)).length,1,'never a second');
 } finally { await fake.close(); }
});

test('a schedule set in a chat that is no cron expression is kept as it is when the switch is saved', async () => {
 const fake=await engine();
 try {
  const {db,logged}=session();
  await createRoutine(at(fake,leadProfile),{name:morningName,prompt:`${morningMarker}\nSummary`,schedule:'0 9 * * *'});
  Object.assign(fake.settings.cron.get(leadProfile)[0],{schedule:{kind:'interval',minutes:720,display:'every 720m'},schedule_display:'every 720m'});
  const read=await readAgentMorning(db,{company,agent:lead,hermes:install(fake)});
  assert.deepEqual([read.routine?.time,read.routine?.schedule.expr,read.routine?.schedule.display],[null,null,'every 720m']);
  const saved=await changeAgentMorning(db,{company,agent:lead,on:false,time:'keep',hermes:install(fake)});
  assert.deepEqual(saved,{state:'written',morning:{on:false,time:'keep'}});
  const [job]=jobs(fake,leadProfile);
  assert.deepEqual([job.schedule.kind,job.state],['interval','paused'],'paused, its schedule untouched');
  assert.ok(!writes(fake).some(request=>request.method==='PUT'),'no schedule was sent');
  assert.deepEqual(logged.map(row=>[row.old_value,row.new_value]),[['other','off']]);
 } finally { await fake.close(); }
});

test('a save whose second step fails still logs what the Engine holds', async () => {
 const fake=await engine();
 try {
  const {db,logged}=session();
  await changeAgentMorning(db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)});
  const busy={pause:async()=>({state:'busy'})};
  const answer=await changeAgentMorning(db,{company,agent:lead,on:false,time:'7:30',hermes:install(fake),driver:busy});
  assert.equal(answer.state,'busy');
  assert.equal(jobs(fake,leadProfile)[0].schedule.expr,'30 7 * * *');
  assert.deepEqual(logged.map(row=>[row.old_value,row.new_value]),[['off','9:00'],['9:00','7:30']],'the new time the Engine holds is in the log');
 } finally { await fake.close(); }
});

test('a daily message that cannot move to the new main Agent is paused where it is, never left sending from another Agent', async () => {
 const fake=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'8:00',zone:'Africa/Cairo',hermes:install(fake)});
  // Ads is main now, but its profile is not its own yet.
  const rows=agentRows(ads).map(row=>row.agent===ads?{...row,own:false}:row);
  assert.equal((await moveAgentMorning(session({agents:rows}).db,{company,from:lead,to:ads,hermes:install(fake)})).state,'paused');
  assert.equal(jobs(fake,leadProfile)[0].state,'paused');
  assert.equal(jobs(fake,adsProfile).length,0);
  // A new copy whose old one will not go is taken back: never two.
  const fresh=await engine();
  try {
   await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'8:00',zone:'Africa/Cairo',hermes:install(fresh)});
   const stuck={delete:async(connection,{id})=>connection.profile===leadProfile?{state:'busy'}:(await import('../lib/hermes.mjs')).deleteRoutine(connection,{id})};
   assert.equal((await moveAgentMorning(session({agents:agentRows(ads)}).db,{company,from:lead,to:ads,hermes:install(fresh),driver:stuck})).state,'moved');
   // The main Agent gets the message, and the copy that will not go is paused.
   assert.deepEqual(jobs(fresh,adsProfile).map(job=>job.state),['scheduled']);
   assert.deepEqual(jobs(fresh,leadProfile).map(job=>job.state),['paused']);
  } finally { await fresh.close(); }
  // Agents read before the change name a removed main Agent's profile, so its message still moves to the replacement.
  const third=await engine();
  try {
   await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'8:00',zone:'Africa/Cairo',hermes:install(third)});
   const gone=session({agents:[agentRows(ads)[1]]});
   assert.equal((await moveAgentMorning(gone.db,{company,from:lead,to:ads,agents:agentRows(lead),hermes:install(third)})).state,'moved');
   assert.equal(jobs(third,adsProfile).length,1); assert.equal(jobs(third,leadProfile).length,0);
  } finally { await third.close(); }
 } finally { await fake.close(); }
});

test('two people switching it on at the same moment leave one daily message, not two', async () => {
 const fake=await engine();
 try {
  const [one,two]=await Promise.all([
   changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)}),
   changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)}),
  ]);
  assert.deepEqual([one.state,two.state],['written','written']);
  assert.equal(jobs(fake,leadProfile).filter(job=>job.prompt.startsWith(morningMarker)).length,1);
  // One left by an earlier race is removed by the next save.
  const [kept]=jobs(fake,leadProfile);
  fake.settings.cron.get(leadProfile).push({...kept,id:'abcdefabcdef'});
  await changeAgentMorning(session().db,{company,agent:lead,on:false,time:'9:00',hermes:install(fake)});
  assert.deepEqual(jobs(fake,leadProfile).map(job=>[job.id,job.state]),[[kept.id,'paused']]);
 } finally { await fake.close(); }
});

test('a save that lands just after the main Agent changed leaves no job sending from the old one, and removing the last Agent pauses it', async () => {
 const fake=await engine();
 try {
  // The Owner makes Ads main while the Manager's save waits on the Engine: the move finds nothing, the save makes a job.
  let rows=agentRows(lead);
  const db={...session().db,rpc:async(name,args)=>name==='company_app_agents'?{data:rows,error:null}:session().db.rpc(name,args)};
  const slowRead={read:async connection=>{ const listed=await readRoutines(connection); rows=agentRows(ads); return listed; }};
  const answer=await changeAgentMorning(db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake),driver:slowRead});
  assert.equal(answer.state,'notMain','the save is refused');
  assert.ok(jobs(fake,leadProfile).every(job=>!job.prompt.startsWith(morningMarker)||job.state==='paused'),'nothing sends from the old main Agent');
  // The last Agent removed: its message is paused where it is.
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'8:00',zone:'Africa/Cairo',hermes:install(fake)});
  const on=jobs(fake,leadProfile).filter(job=>job.prompt.startsWith(morningMarker)&&job.state!=='paused');
  assert.equal(on.length,1);
  // Lead was the last Agent: after the removal no Agent is listed, and the Agents read before it name Lead's profile.
  assert.equal((await moveAgentMorning(session({agents:[]}).db,{company,agents:agentRows(lead),hermes:install(fake)})).state,'paused');
  assert.ok(jobs(fake,leadProfile).filter(job=>job.prompt.startsWith(morningMarker)).every(job=>job.state==='paused'));
 } finally { await fake.close(); }
});

test('overlapping main-Agent changes leave the daily message on the Agent that is main at the end', async () => {
 const fake=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'7:00',zone:'Africa/Cairo',hermes:install(fake)});
  // Lead → Ads → Lead, the second change landing while the first still moves: the first ends with Lead main again.
  let rows=agentRows(ads);
  const db={...session().db,rpc:async(name,args)=>name==='company_app_agents'?{data:rows,error:null}:session().db.rpc(name,args)};
  const switching={create:async(connection,routine)=>{ const made=await createRoutine(connection,routine); rows=agentRows(lead); return made; }};
  assert.equal((await moveAgentMorning(db,{company,from:lead,to:ads,agents:agentRows(lead),hermes:install(fake),driver:switching})).state,'moved');
  const onLead=jobs(fake,leadProfile).filter(job=>job.prompt.startsWith(morningMarker));
  assert.equal(onLead.length,1,'the message is back on the main Agent');
  assert.deepEqual([onLead[0].schedule.expr,onLead[0].state],['0 7 * * *','scheduled']);
  assert.equal(jobs(fake,adsProfile).filter(job=>job.prompt.startsWith(morningMarker)).length,0,'none left on the Agent that stopped being main');
 } finally { await fake.close(); }
});

test('the settle carries how the message is now: a stale paused copy never wins, a removed Agent racing a save is seen, and an unreadable profile still leaves nothing sending', async () => {
 // A → B could not delete A's job (left paused); then B → A: A takes B's switched-on job, not its stale paused copy.
 const fake=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'7:30',zone:'Africa/Cairo',hermes:install(fake)});
  const stuck={delete:async(connection,{id})=>connection.profile===leadProfile?{state:'busy'}:(await import('../lib/hermes.mjs')).deleteRoutine(connection,{id})};
  await moveAgentMorning(session({agents:agentRows(ads)}).db,{company,agents:agentRows(lead),hermes:install(fake),driver:stuck});
  assert.deepEqual(jobs(fake,leadProfile).map(job=>job.state),['paused']);
  assert.deepEqual(jobs(fake,adsProfile).map(job=>job.state),['scheduled']);
  assert.equal((await moveAgentMorning(session({agents:agentRows(lead)}).db,{company,agents:agentRows(ads),hermes:install(fake)})).state,'moved');
  const back=jobs(fake,leadProfile).filter(job=>job.prompt.startsWith(morningMarker));
  assert.deepEqual(back.map(job=>[job.state,job.schedule.expr]),[['scheduled','30 7 * * *']],'the message stays on, as it was set');
  assert.equal(jobs(fake,adsProfile).length,0);
 } finally { await fake.close(); }
 // The main Agent removed (the last one) while a first save waits on the Engine: the save's own pre-read names its profile.
 const second=await engine();
 try {
  let rows=agentRows(lead);
  const db={...session().db,rpc:async(name,args)=>name==='company_app_agents'?{data:rows,error:null}:session().db.rpc(name,args)};
  const removing={read:async connection=>{ const listed=await readRoutines(connection); rows=[]; return listed; }};
  assert.equal((await changeAgentMorning(db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(second),driver:removing})).state,'notMain');
  assert.ok(jobs(second,leadProfile).filter(job=>job.prompt.startsWith(morningMarker)).every(job=>job.state==='paused'),'nothing sends from the removed Agent');
 } finally { await second.close(); }
 // The new main Agent's profile cannot be read: the old copy is paused all the same, and the read's failure is the answer.
 const third=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(third)});
  third.settings.profiles.delete(adsProfile);
  const answer=await moveAgentMorning(session({agents:agentRows(ads)}).db,{company,agents:agentRows(lead),hermes:install(third)});
  assert.notEqual(answer.state,'moved');
  assert.deepEqual(jobs(third,leadProfile).map(job=>job.state),['paused']);
 } finally { await third.close(); }
});

test('an extra copy that will not go is paused, a change the log cannot hold answers failed, and a switch-off made during a move is kept', async () => {
 const fake=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)});
  const [kept]=jobs(fake,leadProfile);
  fake.settings.cron.get(leadProfile).push({...kept,id:'abcdefabcdef'});
  const refusing={delete:async()=>({state:'refused'})};
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',hermes:install(fake),driver:refusing});
  assert.deepEqual(jobs(fake,leadProfile).map(job=>[job.id,job.state]),[[kept.id,'scheduled'],['abcdefabcdef','paused']],'the extra never sends beside the one kept');
 } finally { await fake.close(); }
 const second=await engine();
 try {
  const {db}=session();
  const failing={...db,rpc:async(name,args)=>name==='log_agent_morning'?{data:null,error:{message:'down'}}:db.rpc(name,args)};
  const said=console.error; console.error=()=>{};
  try { assert.equal((await changeAgentMorning(failing,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(second)})).state,'failed'); }
  finally { console.error=said; }
  assert.equal(jobs(second,leadProfile).length,1,'the Engine holds it all the same');
 } finally { await second.close(); }
 const third=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(third)});
  // The move reads Lead's job as on; a save switches it off on Lead while the copy is being made on Ads.
  const savingOff={create:async(connection,routine)=>{ const made=await createRoutine(connection,routine); Object.assign(jobs(third,leadProfile)[0],{enabled:false,state:'paused'}); return made; }};
  await moveAgentMorning(session({agents:agentRows(ads)}).db,{company,agents:agentRows(lead),hermes:install(third),driver:savingOff});
  assert.deepEqual(jobs(third,adsProfile).map(job=>job.state),['paused'],'the switch-off is kept');
  assert.equal(jobs(third,leadProfile).length,0);
 } finally { await third.close(); }
});

test('saves and main-Agent changes run one at a time under the Company lease; a pause that fails too, and a log refused during a race, are answered failed', async () => {
 const fake=await engine();
 try {
  // Two saves at once: the second waits for the first's lease, so there is one job and two log rows in order.
  const {db,logged}=session();
  const [one,two]=await Promise.all([
   changeAgentMorning(db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)}),
   changeAgentMorning(db,{company,agent:lead,on:true,time:'10:00',zone:'Africa/Cairo',hermes:install(fake)}),
  ]);
  assert.deepEqual([one.state,two.state],['written','written']);
  assert.equal(jobs(fake,leadProfile).length,1);
  assert.deepEqual(logged.map(row=>[row.old_value,row.new_value]),[['off','9:00'],['9:00','10:00']]);
  assert.ok([...leases.values()].every(held=>!held.live),'every lease is given back');
  // An extra copy that can be neither deleted nor paused: the save answers failed, never written.
  const [kept]=jobs(fake,leadProfile);
  fake.settings.cron.get(leadProfile).push({...kept,id:'abcdefabcdef'});
  const stuck={delete:async()=>({state:'refused'}),pause:async()=>({state:'unreachable'})};
  assert.equal((await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'10:00',hermes:install(fake),driver:stuck})).state,'failed');
 } finally { await fake.close(); leases.clear(); }
 const second=await engine();
 try {
  // The main Agent changes before this save makes its job, and the log then refuses it (Lead is no longer main): the
  // job is settled onto Ads all the same before the save answers.
  let rows=agentRows(lead);
  const base=session().db;
  const db={rpc:async(name,args)=>name==='company_app_agents'?{data:rows,error:null}:name==='log_agent_morning'?{data:null,error:{message:'agentSettingInvalid'}}:base.rpc(name,args)};
  const switching={read:async connection=>{ const listed=await readRoutines(connection); rows=agentRows(ads); return listed; }};
  const said=console.error; console.error=()=>{};
  try { assert.equal((await changeAgentMorning(db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(second),driver:switching})).state,'notMain'); }
  finally { console.error=said; }
  assert.equal(jobs(second,leadProfile).filter(job=>job.prompt.startsWith(morningMarker)).length,0,'nothing left on the old main Agent');
  assert.deepEqual(jobs(second,adsProfile).map(job=>job.state),['scheduled'],'the message is on the main Agent');
 } finally { await second.close(); leases.clear(); }
});

test('a holder whose lease ran out and was taken stops before its next Engine write, and a move carries an interval schedule', async () => {
 const fake=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)});
  // The save's lease is taken by another holder (it ran out) while the save reads the Engine.
  const stealing={read:async connection=>{ const listed=await readRoutines(connection); leases.set(company,{holder:'someone-else',live:true,profiles:[]}); return listed; }};
  const before=writes(fake).length;
  assert.equal((await changeAgentMorning(session().db,{company,agent:lead,on:false,time:'9:00',hermes:install(fake),driver:stealing})).state,'busy');
  assert.equal(writes(fake).length,before,'no write after the lease was lost');
  assert.equal(jobs(fake,leadProfile)[0].state,'scheduled');
  // Taken and given back again before this holder goes on: the lease is free, but this holder's reads may be stale (a
  // save meanwhile retimed it), so it stops all the same, never pausing the job at a time it did not read.
  const takenAndGiven={read:async connection=>{ const listed=await readRoutines(connection); leases.set(company,{holder:'someone-else',live:false,profiles:[]}); return listed; }};
  assert.equal((await changeAgentMorning(session().db,{company,agent:lead,on:false,time:'9:00',hermes:install(fake),driver:takenAndGiven})).state,'busy');
  assert.equal(writes(fake).length,before,'no write after the lease ran out, taken or not');
  // Ran out with nobody taking it: stopped too.
  const ranOut={read:async connection=>{ const listed=await readRoutines(connection); leases.get(company).live=false; return listed; }};
  assert.equal((await changeAgentMorning(session().db,{company,agent:lead,on:false,time:'9:00',hermes:install(fake),driver:ranOut})).state,'busy');
  assert.equal(writes(fake).length,before);
  assert.equal(jobs(fake,leadProfile)[0].state,'scheduled');
  leases.clear();
 } finally { await fake.close(); leases.clear(); }
 const second=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(second)});
  Object.assign(jobs(second,leadProfile)[0],{schedule:{kind:'interval',minutes:720,display:'every 720m'},schedule_display:'every 720m'});
  assert.equal((await moveAgentMorning(session({agents:agentRows(ads)}).db,{company,agents:agentRows(lead),hermes:install(second)})).state,'moved');
  assert.deepEqual(jobs(second,adsProfile).map(job=>[job.schedule.kind,job.schedule.minutes,job.state]),[['interval',720,'scheduled']]);
  assert.equal(jobs(second,leadProfile).length,0);
 } finally { await second.close(); }
});

test('a move the new main Agent cannot take keeps the source, paused, and answers failed; a removed Agent\'s copy is reached later through the Company\'s profiles', async () => {
 // The copy cannot be made on Ads: Lead's job is paused, not deleted, and the settle says failed.
 const fake=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)});
  const noCreate={create:async()=>({state:'refused'})};
  assert.equal((await moveAgentMorning(session({agents:agentRows(ads)}).db,{company,agents:agentRows(lead),hermes:install(fake),driver:noCreate})).state,'failed');
  assert.deepEqual(jobs(fake,leadProfile).map(job=>job.state),['paused'],'kept, never deleted, and sending from nowhere');
  assert.equal(jobs(fake,adsProfile).length,0);
 } finally { await fake.close(); }
 // The copy is made but cannot follow a new time saved on Lead meanwhile: it is paused, Lead's is kept paused, failed.
 const second=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(second)});
  const retimed={create:async(connection,routine)=>{ const made=await createRoutine(connection,routine); Object.assign(jobs(second,leadProfile)[0],{schedule:{kind:'cron',expr:'0 7 * * *',display:'0 7 * * *'}}); return made; },change:async()=>({state:'unreachable'})};
  assert.equal((await moveAgentMorning(session({agents:agentRows(ads)}).db,{company,agents:agentRows(lead),hermes:install(second),driver:retimed})).state,'failed');
  assert.deepEqual(jobs(second,adsProfile).map(job=>job.state),['paused']);
  assert.deepEqual(jobs(second,leadProfile).map(job=>[job.state,job.schedule.expr]),[['paused','0 7 * * *']],'the source keeps how it was set');
 } finally { await second.close(); }
 // Lead was removed and its settle failed; Lead is in no list now but the Company's profiles still name it, so the next
 // settle brings its copy to Ads.
 const third=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(third)});
  const onlyAds=[{...agentRows(ads)[1]}];
  assert.equal((await moveAgentMorning(session({agents:onlyAds,keyProfiles:[{profile:leadProfile,kind:'removed'},{profile:adsProfile,kind:'agent'}]}).db,{company,hermes:install(third)})).state,'moved');
  assert.deepEqual(jobs(third,adsProfile).map(job=>[job.state,job.schedule.expr]),[['scheduled','0 9 * * *']]);
  assert.equal(jobs(third,leadProfile).length,0);
 } finally { await third.close(); }
});

test('a create whose answer is lost is found again for an interval schedule as for a time', async () => {
 const fake=await engine();
 try {
  fake.settings.loseCronCreates=1;
  const made=await createRoutine(at(fake,adsProfile),{name:morningName,prompt:`${morningMarker}\nSummary`,schedule:'every 720m'});
  assert.equal(made.state,'done','the job the Engine made is recognized');
  assert.equal(made.routine.schedule.minutes,720);
  assert.equal(jobs(fake,adsProfile).length,1);
 } finally { await fake.close(); }
});

test('a removed Agent\'s profile is kept with the lease until a settle succeeds, whatever forgets it meanwhile', async () => {
 const fake=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)});
  const onlyAds=[{...agentRows(ads)[1],main:true}];
  // Lead is removed with Ads as its replacement; the settle that follows cannot make the copy on Ads, so it fails.
  const failedMove=await withMorningLease(session({agents:onlyAds}).db,company,fence=>moveAgentMorning(session({agents:onlyAds}).db,{company,agents:agentRows(lead),hermes:install(fake),driver:{create:async()=>({state:'refused'})},fence}));
  assert.equal(failedMove.state,'failed');
  assert.deepEqual(leases.get(company).profiles,[adsProfile,leadProfile],'every profile it looked at is still to settle');
  // The Company's own list forgot Lead's profile meanwhile (a key cleanup); the next settle still reaches it.
  const db=session({agents:onlyAds,keyProfiles:[]}).db;
  assert.equal((await withMorningLease(db,company,fence=>moveAgentMorning(db,{company,hermes:install(fake),fence}))).state,'moved');
  // The failed settle paused Lead's copy so it sent from nowhere; it arrives on Ads as it was left.
  assert.deepEqual(jobs(fake,adsProfile).map(job=>[job.state,job.schedule.expr]),[['paused','0 9 * * *']]);
  assert.equal(jobs(fake,leadProfile).length,0);
  assert.deepEqual(leases.get(company).profiles,[],'and once settled, nothing is left to settle');
 } finally { await fake.close(); leases.clear(); }
});

test('a move follows an interval set on the source while the copy is made, and fails when the source cannot be read again', async () => {
 const fake=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)});
  const toInterval={create:async(connection,routine)=>{ const made=await createRoutine(connection,routine); Object.assign(jobs(fake,leadProfile)[0],{schedule:{kind:'interval',minutes:720,display:'every 720m'},schedule_display:'every 720m'}); return made; }};
  assert.equal((await moveAgentMorning(session({agents:agentRows(ads)}).db,{company,agents:agentRows(lead),hermes:install(fake),driver:toInterval})).state,'moved');
  assert.deepEqual(jobs(fake,adsProfile).map(job=>[job.schedule.kind,job.schedule.minutes,job.state]),[['interval',720,'scheduled']],'the interval set meanwhile is kept');
  assert.equal(jobs(fake,leadProfile).length,0);
 } finally { await fake.close(); }
 const second=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(second)});
  // The source's second read is not answered: how the message is now is unknown, so the source is kept, paused.
  let reads=0;
  const blind={read:async connection=>connection.profile===leadProfile&&++reads>1?{state:'unreachable'}:readRoutines(connection)};
  assert.equal((await moveAgentMorning(session({agents:agentRows(ads)}).db,{company,agents:agentRows(lead),hermes:install(second),driver:blind})).state,'failed');
  assert.deepEqual(jobs(second,leadProfile).map(job=>[job.state,job.schedule.expr]),[['paused','0 9 * * *']],'kept, never deleted');
  assert.deepEqual(jobs(second,adsProfile).map(job=>job.state),['paused']);
 } finally { await second.close(); }
});

test('a copy that will not go beside the moved one fails the move, and later reads and saves keep the one that is on', async () => {
 const fake=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)});
  // Ads already holds an old paused 7:00 copy that the Engine will not delete.
  await createRoutine(at(fake,adsProfile),{name:morningName,prompt:`${morningMarker}\nOld`,schedule:'0 7 * * *',timezone:'Africa/Cairo',paused:true});
  const [stale]=jobs(fake,adsProfile);
  const keepStale={delete:async(connection,routine)=>routine.id===stale.id?{state:'refused'}:(await import('../lib/hermes.mjs')).deleteRoutine(connection,routine)};
  assert.equal((await moveAgentMorning(session({agents:agentRows(ads)}).db,{company,agents:agentRows(lead),hermes:install(fake),driver:keepStale})).state,'failed','the main Agent holds more than one: said');
  const shown=await readAgentMorning(session({agents:agentRows(ads)}).db,{company,agent:ads,hermes:install(fake)});
  assert.deepEqual([shown.routine?.on,shown.routine?.time],[true,'9:00'],'the page reads the moved copy, not the old one');
  // A later save keeps the one that is on and changes it; the old one still will not go, so it answers failed.
  const saved=await changeAgentMorning(session({agents:agentRows(ads)}).db,{company,agent:ads,on:true,time:'10:00',hermes:install(fake),driver:keepStale});
  assert.equal(saved.state,'failed');
  const on=jobs(fake,adsProfile).filter(job=>job.state==='scheduled');
  assert.deepEqual(on.map(job=>job.schedule.expr),['0 10 * * *'],'the moved copy was kept and retimed');
  assert.equal(jobs(fake,adsProfile).find(job=>job.id===stale.id)?.state,'paused');
 } finally { await fake.close(); leases.clear(); }
});

test('a create the Engine finishes late, after the next move, lands paused and never sends from the old Agent', async () => {
 const fake=await engine();
 try {
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',zone:'Africa/Cairo',hermes:install(fake)});
  // Lead → Ads: the Engine gets the create but answers nothing in time; it finishes the create later.
  let late=null;
  const slow={create:async(connection,routine)=>{ late=()=>createRoutine(connection,routine); return {state:'unreachable'}; }};
  assert.equal((await moveAgentMorning(session({agents:agentRows(ads)}).db,{company,agents:agentRows(lead),hermes:install(fake),driver:slow})).state,'failed');
  // Ads → Lead again before the Engine finished it: the message is on Lead.
  const back=await moveAgentMorning(session({agents:agentRows(lead)}).db,{company,agents:agentRows(ads),hermes:install(fake)});
  assert.equal(back.state,'moved');
  await changeAgentMorning(session().db,{company,agent:lead,on:true,time:'9:00',hermes:install(fake)});
  assert.deepEqual(jobs(fake,leadProfile).map(job=>job.state),['scheduled']);
  // Now the late create lands on Ads: paused, so nothing sends from an Agent that is not the main one.
  await late();
  assert.deepEqual(jobs(fake,adsProfile).map(job=>job.state),['paused']);
  assert.equal((await moveAgentMorning(session().db,{company,agents:agentRows(lead),hermes:install(fake)})).state,'moved');
  assert.equal(jobs(fake,adsProfile).length,0,'and the next settle removes it');
  assert.deepEqual(jobs(fake,leadProfile).map(job=>[job.state,job.schedule.expr]),[['scheduled','0 9 * * *']]);
 } finally { await fake.close(); leases.clear(); }
});
