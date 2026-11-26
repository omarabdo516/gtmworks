import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepRunningRoutines } from '../lib/routine-runs.mjs';
import { createRoutine, readRunningRoutines } from '../lib/engine/routines.mjs';
import { engineRecord, engineServing } from './engine-records.mjs';

// A running Routine is its Agent's work (#699): the Engine runs it and gtmworks keeps no copy, so each pass of the
// worker reads which Routines each Agent's profile runs now and keeps that set (keep_running_routines), which the state
// read counts as working while the worker keeps seeing it.
const company='10000000-0000-0000-0000-000000000001';
const [lead,ads,twin]=['3a000000-0000-0000-0000-000000000001','3a000000-0000-0000-0000-000000000011','3a000000-0000-0000-0000-000000000012'];
const hex=id=>id.replaceAll('-','');
const leadProfile=`ag-${hex(lead)}`, adsProfile=`ag-${hex(ads)}`;
const install=fake=>({address:fake.address,profile:'default',key:'test-only-key'});
const at=(fake,profile)=>({...install(fake),profile});
const profileOn=(fake,name)=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
// The Company's Engine, as its record names it.
async function engine() { const fake=await engineServing(company); profileOn(fake,leadProfile); profileOn(fake,adsProfile); return fake; }
// A run of the Routine the Engine is still running: a cron session with no end, listed as active.
const running=(fake,profile,routine,startedAt)=>fake.settings.sessions.set(`cron_${routine.id}_${startedAt.getTime()}`,{profile,started_at:startedAt.getTime()/1000,active:true,messages:[]});
const ended=(fake,profile,routine,startedAt)=>fake.settings.sessions.set(`cron_${routine.id}_${startedAt.getTime()}`,{profile,started_at:startedAt.getTime()/1000,ended_at:startedAt.getTime()/1000+1,messages:[]});

// The worker's database: each Company's main Agent, its Agents, and each set kept for a profile.
function service({agents=[{id:lead,profile:leadProfile,is_default:true,name:'Lead'},{id:ads,profile:adsProfile,is_default:false,name:'Ads'}]}={}) {
 const kept=[];
 const db={kept,rpc:async(name,args)=>{
  if(name==='good_morning_work') return {data:[{company_id:company,agent_id:lead,profile:leadProfile,last_ran_at:null}],error:null};
  if(name==='good_morning_agents') return db.agentsFail?{data:null,error:{message:'agents refused'}}:{data:agents,error:null};
  if(name==='keep_running_routines') { kept.push(args); return {data:args.running.length,error:null}; }
  throw new Error(`unexpected ${name}`);
 }};
 return db;
}

test('the Engine names each Routine of a profile it runs now, with its run\'s start, and none it has finished', async () => {
 const fake=await engine();
 try {
  const {routine:busy}=await createRoutine(at(fake,adsProfile),{name:'Leads',prompt:'Check the leads',schedule:'*/15 * * * *'});
  const {routine:done}=await createRoutine(at(fake,adsProfile),{name:'Report',prompt:'Write the report',schedule:'0 9 * * *'});
  const startedAt=new Date(Date.now()-60_000);
  ended(fake,adsProfile,busy,new Date(Date.now()-3_600_000));
  running(fake,adsProfile,busy,startedAt);
  ended(fake,adsProfile,done,new Date(Date.now()-120_000));
  assert.deepEqual(await readRunningRoutines(at(fake,adsProfile)),{state:'found',running:[{id:busy.id,startedAt:startedAt.toISOString()}]});
  assert.deepEqual(await readRunningRoutines(at(fake,leadProfile)),{state:'found',running:[]},'another profile runs none of them');
 } finally { await fake.close(); }
});

test('each pass keeps, for each Agent\'s own profile, the Routines it runs now; a profile two Agents share is kept once', async () => {
 const fake=await engine();
 try {
  const {routine}=await createRoutine(at(fake,adsProfile),{name:'Leads',prompt:'Check the leads',schedule:'*/15 * * * *'});
  const startedAt=new Date(Date.now()-60_000);
  running(fake,adsProfile,routine,startedAt);
  const db=service({agents:[{id:lead,profile:leadProfile,is_default:true,name:'Lead'},{id:ads,profile:adsProfile,is_default:false,name:'Ads'},{id:twin,profile:adsProfile,is_default:false,name:'Twin'},{id:'3a000000-0000-0000-0000-000000000013',profile:'default',is_default:false,name:'Shared'}]});
  await keepRunningRoutines(db);
  assert.deepEqual(db.kept,[
   {c:company,at_profile:leadProfile,agent:lead,running:[]},
   {c:company,at_profile:adsProfile,agent:ads,running:[{routine_id:routine.id,started_at:startedAt.toISOString()}]}]);
  // The run ends: the next pass keeps the profile's set without it.
  fake.settings.sessions.get(`cron_${routine.id}_${startedAt.getTime()}`).active=false;
  db.kept.length=0;
  await keepRunningRoutines(db);
  assert.deepEqual(db.kept.map(row=>row.running),[[],[]]);
 } finally { await fake.close(); }
});

test('a run the Engine still lists as active hours after it started is not kept, so a run it lost never holds its Agent working', async () => {
 const fake=await engine();
 try {
  const {routine}=await createRoutine(at(fake,adsProfile),{name:'Leads',prompt:'Check the leads',schedule:'*/15 * * * *'});
  running(fake,adsProfile,routine,new Date(Date.now()-7*3_600_000));
  const db=service();
  await keepRunningRoutines(db);
  assert.deepEqual(db.kept.find(row=>row.at_profile===adsProfile).running,[]);
 } finally { await fake.close(); }
});

test('a profile the Engine did not answer for keeps nothing, so its last set ages out in the database rather than being cleared', async () => {
 const fake=await engine();
 try {
  const db=service();
  fake.settings.managedFail=(method,path)=>path.startsWith('/api/cron/jobs')&&path.includes(adsProfile)?500:null;
  await keepRunningRoutines(db);
  fake.settings.managedFail=null;
  assert.deepEqual(db.kept.map(row=>row.at_profile),[leadProfile]);
  db.kept.length=0;
  engineRecord(company,null);
  await keepRunningRoutines(db);
  assert.deepEqual(db.kept,[],'a Company with no Engine keeps nothing');
  engineRecord(company,fake);
  db.agentsFail=true;
  await keepRunningRoutines(db);
  assert.deepEqual(db.kept,[],'nor one whose Agents the database did not list');
 } finally { await fake.close(); }
});
