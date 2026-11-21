import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveGoodMornings, dayIn } from '../lib/good-morning-runs.mjs';
import { createRoutine, triggerRoutine, readRoutineRuns, readRunReply, pauseRoutine, resumeRoutine } from '../lib/hermes.mjs';
import { morningMarker } from '../lib/morning-schedule.mjs';
import { morningTitle } from '../lib/good-morning-title.mjs';
import { i18n } from '../lib/i18n.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// The morning message (#183): each finished run of #182's daily job, on the main Agent's own Engine profile, is read back
// by the worker and recorded once, with the Routine results of the night before it from every Agent of the Company.
const company='10000000-0000-0000-0000-000000000001';
const [lead,ads]=['3a000000-0000-0000-0000-000000000001','3a000000-0000-0000-0000-000000000011'];
const hex=id=>id.replaceAll('-','');
const leadProfile=`ag-${hex(lead)}`, adsProfile=`ag-${hex(ads)}`;
const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const at=(fake,profile)=>({...install(fake),profile});
const profileOn=(fake,name)=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
async function engine() { const fake=await fakeHermes(); profileOn(fake,leadProfile); profileOn(fake,adsProfile); return fake; }
// #182's job: the marker heads its prompt.
const dailyJob=fake=>createRoutine(at(fake,leadProfile),{name:'Good morning',prompt:`${morningMarker}\nWrite the morning summary.`,schedule:'0 9 * * *',timezone:'Africa/Cairo'});

test('a run of the job is read back from its own profile: its session and its reply, a [SILENT] reply as none', async () => {
 const fake=await engine();
 try {
  const {routine}=await dailyJob(fake);
  fake.settings.cronReply='Good morning, team. Here is today.';
  await triggerRoutine(at(fake,leadProfile),{id:routine.id});
  const runs=await readRoutineRuns(at(fake,leadProfile),{id:routine.id});
  assert.equal(runs.state,'found'); assert.equal(runs.runs.length,1);
  assert.ok(runs.runs[0].endedAt>=runs.runs[0].startedAt);
  assert.deepEqual(await readRunReply(at(fake,leadProfile),runs.runs[0].session),{state:'found',reply:'Good morning, team. Here is today.'});
  assert.equal((await readRunReply(at(fake,adsProfile),runs.runs[0].session)).state,'missing','another profile never reads it');
  fake.settings.cronReply='[SILENT]';
  await new Promise(resolve=>setTimeout(resolve,5));
  await triggerRoutine(at(fake,leadProfile),{id:routine.id});
  const newest=(await readRoutineRuns(at(fake,leadProfile),{id:routine.id})).runs[0];
  assert.deepEqual(await readRunReply(at(fake,leadProfile),newest.session),{state:'found',reply:null});
  // `full` says the Engine answered as many runs as asked for, so older ones may lie beyond its list.
  assert.equal((await readRoutineRuns(at(fake,leadProfile),{id:routine.id,limit:2})).full,true);
  assert.equal((await readRoutineRuns(at(fake,leadProfile),{id:routine.id,limit:3})).full,false);
  // Another Agent's Routine id is never asked for through this profile.
  const other=(await createRoutine(at(fake,adsProfile),{name:'Ads',prompt:'Ads',schedule:'0 * * * *'})).routine;
  assert.equal((await readRoutineRuns(at(fake,leadProfile),{id:other.id})).state,'missing');
 } finally { await fake.close(); }
});

// The worker's database: each Company's main Agent, the runs it has recorded, and each record call.
function service({agents=[{id:lead,profile:leadProfile,is_default:true,name:'Lead'},{id:ads,profile:adsProfile,is_default:false,name:'Ads'}]}={}) {
 const recorded=[];
 const db={rpc:async(name,args)=>{
  if(name==='good_morning_work') return {data:[{company_id:company,agent_id:lead,profile:leadProfile,last_ran_at:null}],error:null};
  if(name==='good_morning_agents') return {data:agents,error:null};
  if(name==='good_morning_seen') return {data:recorded.filter(row=>args.sessions.includes(row.session)).map(row=>row.session),error:null};
  if(name==='record_good_morning') { recorded.push(args); return {data:1,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 return {db,recorded};
}

test('each finished run of the job is recorded once with its greeting and the night\'s Routine results; a paused job records none', async () => {
 const fake=await engine();
 try {
  const hermes=install(fake);
  const {db,recorded}=service(); const options={engineOf:async()=>hermes};
  assert.equal(await driveGoodMornings(db,options),0,'no job, nothing to read');
  const {routine:morning}=await dailyJob(fake);
  const {routine:pausing}=await createRoutine(at(fake,adsProfile),{name:'Ad-pause routine',prompt:'Pause an ad past EGP 50 a lead',schedule:'0 * * * *'});
  fake.settings.cronReply=job=>job.name==='Ad-pause routine'?'Paused the “Video 2” ad when cost per lead hit EGP 52\nDetails follow.':'Good morning. Here is today.';
  await triggerRoutine(at(fake,adsProfile),{id:pausing.id});
  await new Promise(resolve=>setTimeout(resolve,20));
  await triggerRoutine(at(fake,leadProfile),{id:morning.id});
  assert.equal(await driveGoodMornings(db,options),1);
  const [row]=recorded;
  assert.deepEqual([row.c,row.agent,row.greeting],[company,lead,'Good morning. Here is today.']);
  assert.equal(row.greeting_day,dayIn(row.ran,'Africa/Cairo'));
  assert.deepEqual(row.results.map(result=>[result.agent,result.routine,result.line]),[[ads,'Ad-pause routine','Paused the “Video 2” ad when cost per lead hit EGP 52']]);
  assert.equal(await driveGoodMornings(db,options),0,'a run is recorded once');
  // [SILENT]: recorded with no greeting, and no night is read for it.
  fake.settings.cronReply='[SILENT]';
  await new Promise(resolve=>setTimeout(resolve,5));
  await triggerRoutine(at(fake,leadProfile),{id:morning.id});
  assert.equal(await driveGoodMornings(db,options),1);
  assert.deepEqual([recorded.at(-1).greeting,recorded.at(-1).results],[null,[]]);
  // Switched off: a run made meanwhile opens nothing (it is kept as sent nothing), and switching it on again does not
  // deliver it later.
  fake.settings.cronReply='Good morning again.';
  await new Promise(resolve=>setTimeout(resolve,5));
  await triggerRoutine(at(fake,leadProfile),{id:morning.id});
  await pauseRoutine(at(fake,leadProfile),{id:morning.id});
  await driveGoodMornings(db,options);
  assert.equal(recorded.length,3);
  assert.deepEqual([recorded.at(-1).greeting,recorded.at(-1).results],[null,[]]);
  await resumeRoutine(at(fake,leadProfile),{id:morning.id});
  assert.equal(await driveGoodMornings(db,options),0,'switched on again, the run from while it was off is never delivered');
  assert.equal(recorded.length,3);
 } finally { await fake.close(); }
});

test('a night the Engine could not read in full holds the morning for a later pass, and after an hour it goes with what was read', async () => {
 const fake=await engine();
 try {
  const hermes=install(fake); const {db,recorded}=service();
  const {routine:morning}=await dailyJob(fake);
  const {routine:ads1}=await createRoutine(at(fake,adsProfile),{name:'Ad-pause routine',prompt:'Pause',schedule:'0 * * * *'});
  fake.settings.cronReply=job=>job.name==='Ad-pause routine'?'Paused the Video 2 ad':'Good morning.';
  await triggerRoutine(at(fake,adsProfile),{id:ads1.id});
  await new Promise(resolve=>setTimeout(resolve,20));
  await triggerRoutine(at(fake,leadProfile),{id:morning.id});
  // The Ads profile's run history does not answer: nothing is recorded, so the run is read again later.
  let away=true;
  const runs=async(connection,request)=>connection.profile===adsProfile&&away?{state:'unreachable',runs:null}:readRoutineRuns(connection,request);
  assert.equal(await driveGoodMornings(db,{engineOf:async()=>hermes,driver:{runs}}),0);
  assert.deepEqual(recorded,[]);
  away=false;
  assert.equal(await driveGoodMornings(db,{engineOf:async()=>hermes,driver:{runs}}),1);
  assert.deepEqual(recorded[0].results.map(result=>result.line),['Paused the Video 2 ad'],'recorded once the night is whole');
  // An Engine away for over an hour: the next morning goes with what could be read.
  fake.settings.cronReply='Good morning again.';
  await new Promise(resolve=>setTimeout(resolve,5));
  await triggerRoutine(at(fake,leadProfile),{id:morning.id});
  away=true;
  assert.equal(await driveGoodMornings(db,{engineOf:async()=>hermes,driver:{runs},now:()=>new Date(Date.now()+2*3600*1000)}),1);
  assert.deepEqual([recorded.at(-1).greeting,recorded.at(-1).results],['Good morning again.',[]]);
 } finally { await fake.close(); }
});

test('the night holds every run that ended since the previous morning, also one that started before it, and reads the Engine\'s whole list', async () => {
 const fake=await engine();
 try {
  const hermes=install(fake); const {db}=service();
  const {routine:morning}=await dailyJob(fake);
  const {routine:often}=await createRoutine(at(fake,adsProfile),{name:'Every 15 minutes',prompt:'Check',schedule:'*/15 * * * *'});
  fake.settings.cronReply=job=>job.name==='Every 15 minutes'?'Checked the leads':'Good morning.';
  await triggerRoutine(at(fake,adsProfile),{id:often.id});
  await new Promise(resolve=>setTimeout(resolve,20));
  await triggerRoutine(at(fake,leadProfile),{id:morning.id});
  const asked=[];
  const runs=(connection,request)=>{ asked.push(request.limit); return readRoutineRuns(connection,request); };
  // The Routine's last start is earlier than the night: the previous morning was recorded after it started.
  const started=fake.settings.cron.get(adsProfile)[0].last_run_at;
  const {db:later,recorded:kept}=service();
  later.rpc=(name,args)=>name==='good_morning_work'?Promise.resolve({data:[{company_id:company,agent_id:lead,profile:leadProfile,last_ran_at:new Date(Date.parse(started)+1).toISOString()}],error:null}):db.rpc(name,args).then(answer=>{ if(name==='record_good_morning') kept.push(args); return answer; });
  // Its run started before the previous morning and ended after it, so it is this night's.
  const session=[...fake.settings.sessions.entries()].find(([,found])=>found.profile===adsProfile);
  session[1].ended_at=Date.parse(started)/1000+0.005;
  assert.equal(await driveGoodMornings(later,{engineOf:async()=>hermes,driver:{runs}}),1);
  assert.deepEqual(kept[0].results.map(result=>result.line),['Checked the leads']);
  assert.ok(asked.includes(100),'the whole list the Engine gives is read');
 } finally { await fake.close(); }
});

test('with a paused extra marked job left before it, the worker reads the one that is on, as Settings does', async () => {
 const fake=await engine();
 try {
  const hermes=install(fake); const {db,recorded}=service();
  const {routine:extra}=await dailyJob(fake);
  const {routine:kept}=await dailyJob(fake);
  fake.settings.cronReply='Good morning from the extra.';
  await triggerRoutine(at(fake,leadProfile),{id:extra.id});
  await pauseRoutine(at(fake,leadProfile),{id:extra.id});
  fake.settings.cronReply='Good morning. Here is today.';
  await new Promise(resolve=>setTimeout(resolve,5));
  await triggerRoutine(at(fake,leadProfile),{id:kept.id});
  assert.equal(await driveGoodMornings(db,{engineOf:async()=>hermes}),1);
  assert.deepEqual(recorded.map(row=>row.greeting),['Good morning. Here is today.']);
 } finally { await fake.close(); }
});

test('a Routine merely named "Good morning" is not the daily job: only the marked one is read', async () => {
 const fake=await engine();
 try {
  const hermes=install(fake); const {db,recorded}=service();
  const {routine}=await createRoutine(at(fake,leadProfile),{name:'Good morning',prompt:'Say good morning',schedule:'0 9 * * *'});
  await triggerRoutine(at(fake,leadProfile),{id:routine.id});
  assert.equal(await driveGoodMornings(db,{engineOf:async()=>hermes}),0);
  assert.deepEqual(recorded,[]);
 } finally { await fake.close(); }
});

test('the title names the day in the reader\'s language, and a day is read in the job\'s own zone', () => {
 const en=i18n('en'), ar=i18n('ar');
 assert.equal(morningTitle(en.t,'en','2026-11-11'),'Good morning · Wed, Nov 11');
 assert.equal(morningTitle(ar.t,'ar','2026-11-11'),'صباح الخير · الأربع 11 نوفمبر');
 assert.equal(dayIn('2026-11-10T23:30:00Z','Africa/Cairo'),'2026-11-11');
 assert.equal(dayIn('2026-11-10T23:30:00Z',null),'2026-11-10');
});
