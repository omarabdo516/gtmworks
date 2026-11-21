import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRoutines, createRoutine, changeRoutine, pauseRoutine, resumeRoutine, triggerRoutine, deleteRoutine, startRun, readToolsets } from '../lib/hermes.mjs';
import { readCompanyRoutines, readAgentRoutines, changeAgentRoutine } from '../lib/agent-routines.mjs';
import { cronOf, formOf, scheduleLabel, whenOf } from '../lib/routine-schedule.mjs';
import { toolConfig, noAgentGets } from '../lib/agent-toolsets.mjs';
import { i18n } from '../lib/i18n.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// An Agent's Routines (#31) are the cron jobs of its own Engine profile (ADR 0016, decision of 2026-11-16): the contract
// lists, makes, changes, pauses, resumes, runs now and deletes them in that one profile, named on every call, and one
// Agent's list never holds another's.
const company='10000000-0000-0000-0000-000000000001';
const [ads,seo]=['3a000000-0000-0000-0000-000000000011','3a000000-0000-0000-0000-000000000021'];
const hex=id=>id.replaceAll('-','');
const adsProfile=`ag-${hex(ads)}`; const seoProfile=`ag-${hex(seo)}`;
const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const at=(fake,profile)=>({...install(fake),profile});
const profileOn=(fake,name,config={})=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config,credentials:{}});
async function twoAgents() {
 const fake=await fakeHermes();
 profileOn(fake,adsProfile); profileOn(fake,seoProfile);
 return fake;
}
const cronCalls=fake=>fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/cron/'));
const profileOfCall=request=>new URL(request.path,'http://m').searchParams.get('profile');

test('each Agent\'s Routines are made and listed in its own profile, every request names it, and one list never holds the other\'s', async () => {
 const fake=await twoAgents();
 try {
  const made=await createRoutine(at(fake,adsProfile),{name:'Ads summary',prompt:'Send me a summary of the ads',schedule:'0 9 * * *',timezone:'Africa/Cairo'});
  assert.equal(made.state,'done');
  assert.equal(made.routine.name,'Ads summary');
  assert.deepEqual(made.routine.schedule,{kind:'cron',expr:'0 9 * * *',minutes:null,display:'0 9 * * *'});
  assert.equal(made.routine.timezone,'Africa/Cairo');
  assert.equal(made.routine.on,true);
  assert.ok(made.routine.nextRunAt);
  assert.equal((await createRoutine(at(fake,seoProfile),{name:'Rankings',prompt:'Check the article rankings',schedule:'0 11 * * 1'})).state,'done');
  const adsList=await readRoutines(at(fake,adsProfile)); const seoList=await readRoutines(at(fake,seoProfile));
  assert.deepEqual(adsList.routines.map(routine=>routine.name),['Ads summary']);
  assert.deepEqual(seoList.routines.map(routine=>routine.name),['Rankings']);
  // The job made went with deliver local: its result stays on the profile, sent nowhere.
  assert.equal(fake.settings.cron.get(adsProfile)[0].deliver,'local');
  for(const request of cronCalls(fake)) assert.ok([adsProfile,seoProfile].includes(profileOfCall(request)),`${request.method} ${request.path} names a profile`);
 } finally { await fake.close(); }
});

test('pause, resume, change, run now and delete act on the Agent\'s own Routine only, each with its profile', async () => {
 const fake=await twoAgents();
 try {
  const {routine}=await createRoutine(at(fake,adsProfile),{name:'Ads summary',prompt:'Summary',schedule:'0 9 * * *'});
  const other=(await createRoutine(at(fake,seoProfile),{name:'Rankings',prompt:'Rankings',schedule:'0 11 * * 1'})).routine;
  const paused=await pauseRoutine(at(fake,adsProfile),{id:routine.id});
  assert.equal(paused.state,'done'); assert.equal(paused.routine.on,false); assert.equal(paused.routine.nextRunAt,null);
  const resumed=await resumeRoutine(at(fake,adsProfile),{id:routine.id});
  assert.equal(resumed.routine.on,true); assert.ok(resumed.routine.nextRunAt);
  const changed=await changeRoutine(at(fake,adsProfile),{id:routine.id,schedule:'30 8 * * 4',timezone:'Africa/Cairo'});
  assert.equal(changed.routine.schedule.expr,'30 8 * * 4'); assert.equal(changed.routine.timezone,'Africa/Cairo');
  const ran=await triggerRoutine(at(fake,adsProfile),{id:routine.id});
  assert.equal(ran.state,'done'); assert.equal(ran.routine.lastStatus,'ok'); assert.ok(ran.routine.lastRunAt);
  fake.settings.cronOutcome='error';
  assert.equal((await triggerRoutine(at(fake,adsProfile),{id:routine.id})).routine.lastStatus,'failed');
  for(const request of cronCalls(fake).filter(request=>request.path.includes(routine.id))) assert.equal(profileOfCall(request),adsProfile);
  // The Engine acts on whichever profile holds an id, so another Agent's id is refused here and never sent.
  const before=cronCalls(fake).length;
  for(const call of [pauseRoutine,resumeRoutine,triggerRoutine]) assert.equal((await call(at(fake,adsProfile),{id:other.id})).state,'missing');
  assert.equal((await changeRoutine(at(fake,adsProfile),{id:other.id,schedule:'0 1 * * *'})).state,'missing');
  assert.equal((await deleteRoutine(at(fake,adsProfile),{id:other.id})).state,'missing');
  assert.ok(!cronCalls(fake).slice(before).some(request=>request.path.includes(other.id)),'no request named the other Agent\'s Routine');
  assert.equal(fake.settings.cron.get(seoProfile)[0].state,'scheduled','the other Agent\'s Routine is untouched');
  assert.equal((await deleteRoutine(at(fake,adsProfile),{id:routine.id})).state,'deleted');
  assert.deepEqual((await readRoutines(at(fake,adsProfile))).routines,[]);
  assert.equal((await readRoutines(at(fake,seoProfile))).routines.length,1);
 } finally { await fake.close(); }
});

test('a list that holds another profile\'s job, a schedule that is not a plain cron expression and a profile that is not an Agent\'s are refused', async () => {
 const fake=await twoAgents();
 try {
  // An Engine answer that mixed a job of another profile into this one's list: it is never shown as this Agent's.
  fake.settings.cron.set(adsProfile,[{id:'abcdef123456',name:'Stray',prompt:'x',schedule:{kind:'cron',expr:'0 1 * * *'},enabled:true,state:'scheduled'}]);
  const stray={...fake.settings.cron.get(adsProfile)[0]};
  fake.settings.cron.get(adsProfile).push({...stray,id:'abcdef654321',profile:seoProfile});
  const listed=await readRoutines(at(fake,adsProfile));
  assert.deepEqual(listed.routines.map(routine=>routine.id),['abcdef123456']);
  assert.equal((await createRoutine(at(fake,adsProfile),{name:'x',prompt:'x',schedule:'every monday 9am'})).state,'failed');
  assert.equal((await createRoutine(at(fake,adsProfile),{name:'x',prompt:'   ',schedule:'0 9 * * *'})).state,'failed');
  assert.equal((await readRoutines(at(fake,'default'))).state,'failed');
  const unknown=await readRoutines(at(fake,'ag-ffffffffffffffffffffffffffffffff'));
  assert.deepEqual(unknown,{state:'unreachable',routines:null},'an unknown profile is no answer, never an empty list');
  fake.settings.managementStatus=401;
  assert.equal((await readRoutines(at(fake,adsProfile))).state,'refused');
 } finally { await fake.close(); }
});

// The signed-in person's session: company_app_agents lists the Agents they see, and check_routine_change answers their
// Role (`refuse` names the refusal). Every log call is kept.
// `lostAnswers` writes are kept by the database (by their change key, as log_routine_change does) but answer an error.
function session({agents,refuse=null,logFails=false,lostAnswers=0}={}) {
 const logged=[],checked=[],tries=[];
 const db={rpc:async(name,args)=>{
  if(name==='company_app_agents') return {data:agents,error:null};
  if(name==='check_routine_change') { checked.push(args); return {data:null,error:refuse?{message:refuse}:null}; }
  if(name==='log_routine_change') { tries.push(args); if(lostAnswers&&tries.length<=lostAnswers) { if(!logged.some(row=>row.change===args.change)) logged.push(args); return {data:null,error:{message:'fetch failed'}}; } if(logged.some(row=>row.change===args.change)) return {data:null,error:null}; if(logFails&&tries.length<=logFails) return {data:null,error:{message:'connection reset'}}; logged.push(args); return {data:null,error:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 return {db,logged,checked,tries};
}
// A log row without its change key, which is new for every change.
const plain=({change,...row})=>{ assert.match(change,/^[0-9a-f-]{36}$/); return row; };
const rows=[
 {agent:ads,name:'Meta Ads',connection:'f0000000-0000-0000-0000-000000000011',profile:adsProfile,main:false,own:true},
 {agent:seo,name:'SEO',connection:'f0000000-0000-0000-0000-000000000021',profile:seoProfile,main:false,own:true},
];

test('Settings reads every Agent the reader sees with its Routines, and each change is checked, made and logged once', async () => {
 const fake=await twoAgents();
 try {
  const hermes=install(fake);
  const {db,logged,checked}=session({agents:rows});
  const made=await changeAgentRoutine(db,{company,agent:ads,action:'create',prompt:'Send me the cost per lead',schedule:'0 9 * * *',timezone:'Africa/Cairo',hermes});
  assert.equal(made.state,'done');
  assert.deepEqual(logged.map(plain),[{c:company,agent:ads,act:'routine_created',routine:'Send me the cost per lead',schedule:'0 9 * * *'}]);
  const id=made.routine.id;
  for(const [action,act,extra] of [['pause','routine_paused',{}],['resume','routine_resumed',{}],['change','routine_changed',{schedule:'15 7 * * 2'}],['run','routine_run',{}]]) {
   assert.equal((await changeAgentRoutine(db,{company,agent:ads,action,routine:id,hermes,...extra})).state,'done',action);
   assert.deepEqual(plain(logged.at(-1)),{c:company,agent:ads,act,routine:'Send me the cost per lead',schedule:extra.schedule??null});
  }
  const read=await readCompanyRoutines(db,{company,hermes});
  assert.equal(read.state,'found');
  assert.deepEqual(read.agents.map(agent=>[agent.name,agent.state,agent.routines.length]),[['Meta Ads','found',1],['SEO','found',0]]);
  assert.equal(read.agents[0].routines[0].schedule.expr,'15 7 * * 2');
  assert.equal((await changeAgentRoutine(db,{company,agent:ads,action:'delete',routine:id,hermes})).state,'done');
  assert.equal(logged.at(-1).act,'routine_deleted');
  assert.equal(logged.length,6,'one row for each change');
  // The database checked the very row it then logged, once for each change.
  assert.deepEqual(checked,logged.map(plain));
  assert.equal(new Set(logged.map(row=>row.change)).size,6,'each change has its own key');
 } finally { await fake.close(); }
});

test('a Contributor or a Viewer changes nothing: the database refuses before the Engine is asked, and nothing is logged', async () => {
 const fake=await twoAgents();
 try {
  const hermes=install(fake);
  const owner=session({agents:rows});
  const {routine}=await changeAgentRoutine(owner.db,{company,agent:ads,action:'create',prompt:'Summary',schedule:'0 9 * * *',hermes});
  const before=cronCalls(fake).filter(request=>request.method!=='GET').length;
  const {db,logged}=session({agents:rows,refuse:'routineNotAllowed'});
  for(const action of ['pause','resume','run','delete']) assert.equal((await changeAgentRoutine(db,{company,agent:ads,action,routine:routine.id,hermes})).state,'notAllowed');
  assert.equal((await changeAgentRoutine(db,{company,agent:ads,action:'change',routine:routine.id,schedule:'0 1 * * *',hermes})).state,'notAllowed');
  assert.equal((await changeAgentRoutine(db,{company,agent:ads,action:'create',prompt:'More',schedule:'0 1 * * *',hermes})).state,'notAllowed');
  assert.equal(cronCalls(fake).filter(request=>request.method!=='GET').length,before,'the Engine was not changed');
  assert.deepEqual(logged,[]);
  // An Agent hidden from the reader is not found, and nothing is asked of the Engine about it.
  const hidden=session({agents:[rows[1]]});
  assert.equal((await changeAgentRoutine(hidden.db,{company,agent:ads,action:'pause',routine:routine.id,hermes})).state,'missing');
  assert.equal((await changeAgentRoutine(hidden.db,{company,agent:ads,action:'pause',routine:'not-an-id',hermes})).state,'invalid');
  assert.equal((await changeAgentRoutine(hidden.db,{company,agent:ads,action:'reboot',routine:routine.id,hermes})).state,'invalid');
  assert.equal((await readCompanyRoutines(session({agents:rows}).db,{company,hermes:null})).state,'noEngine');
 } finally { await fake.close(); }
});

// A Routine asked for in chat (#31): the Agent makes it with the Engine's cronjob tool inside its Run, in its own profile.
// Every Agent is offered that toolset (ADR 0018, spec #389, which replaced the levels the ticket was written against);
// a profile whose Runs are not offered it makes nothing.
test('a Routine asked for in chat is made in the Agent\'s own profile with the scheduling tool every Agent is offered, and the section lists it', async () => {
 const fake=await fakeHermes();
 try {
  profileOn(fake,adsProfile,toolConfig({profile:adsProfile})); profileOn(fake,seoProfile,toolConfig({profile:seoProfile}));
  fake.settings.routineAsks=input=>input.includes('every day at 9')?{name:'Lead summary',prompt:'Send me the lead summary',schedule:'0 9 * * *'}:null;
  const offered=await readToolsets({...at(fake,adsProfile)});
  assert.ok(offered.toolsets.includes('cronjob'),'the fixed set offers the scheduling tool');
  assert.deepEqual(offered.toolsets.filter(name=>noAgentGets.includes(name)),[]);
  assert.ok(await startRun({address:fake.address,profile:adsProfile,key:fake.settings.key,input:'Send me the lead summary every day at 9',sessionKey:'c1',idempotencyKey:'k1'}));
  const listed=await readCompanyRoutines(session({agents:rows}).db,{company,hermes:install(fake)});
  assert.deepEqual(listed.agents.map(agent=>[agent.name,agent.routines.map(routine=>routine.name)]),[['Meta Ads',['Lead summary']],['SEO',[]]]);
  // A profile whose Runs are not offered the tool (its config disables it) makes nothing.
  profileOn(fake,seoProfile,{agent:{disabled_toolsets:['cronjob']}});
  await startRun({address:fake.address,profile:seoProfile,key:fake.settings.key,input:'Send me the lead summary every day at 9',sessionKey:'c2',idempotencyKey:'k2'});
  assert.equal(fake.settings.cron.get(seoProfile)?.length??0,0);
 } finally { await fake.close(); }
});

test('the three schedules Settings writes are read back, in the person\'s words and their zone', () => {
 const en=i18n('en').t, ar=i18n('ar').t;
 assert.equal(cronOf({kind:'daily',h:9,m:0}),'0 9 * * *');
 assert.equal(cronOf({kind:'weekly',dow:4,h:16,m:30}),'30 16 * * 4');
 assert.equal(cronOf({kind:'hourly'}),'0 * * * *');
 assert.equal(cronOf({kind:'daily',h:24,m:0}),null);
 assert.deepEqual(formOf('30 16 * * 4'),{kind:'weekly',dow:4,h:16,m:30});
 assert.deepEqual(formOf('0 9 * * 7'),{kind:'weekly',dow:0,h:9,m:0});
 assert.equal(formOf('*/15 * * * *'),null);
 assert.equal(scheduleLabel(en,{expr:'0 9 * * *',display:null}),'Every day · 9:00 AM');
 assert.equal(scheduleLabel(ar,{expr:'0 9 * * *',display:null}),'كل يوم 9:00 الصبح');
 assert.equal(scheduleLabel(en,{expr:'0 16 * * 4',display:null}),'Every Thursday · 4:00 PM');
 assert.equal(scheduleLabel(ar,{expr:'0 16 * * 4',display:null}),'كل خميس 4:00 العصر');
 assert.equal(scheduleLabel(en,{expr:'0 * * * *',display:null}),'Every hour');
 assert.equal(scheduleLabel(en,{expr:null,display:'every 30m'}),'every 30m','a schedule made in chat keeps the Engine\'s words');
 const now=new Date('2026-11-21T10:00:00Z');
 assert.equal(whenOf(en,'en-US','2026-11-22T07:00:00Z','Africa/Cairo',now),'Tomorrow 9:00 AM');
 assert.equal(whenOf(ar,'ar-EG','2026-11-21T14:00:00Z','Africa/Cairo',now),'النهارده 4:00 العصر');
 assert.equal(whenOf(en,'en-US','2026-11-24T07:00:00Z','Africa/Cairo',now),'Tuesday 9:00 AM');
});

test('an Agent still on the Company\'s shared profile reaches no Routine: the main Agent\'s jobs are never read or changed as its own', async () => {
 const fake=await twoAgents();
 const shared='co-10000000000000000000000000000001';
 try {
  profileOn(fake,shared);
  const {routine}=await createRoutine(at(fake,shared),{name:'Morning brief',prompt:'Brief',schedule:'0 8 * * *'});
  const waiting={agent:seo,name:'SEO',connection:'f0000000-0000-0000-0000-000000000021',profile:shared,main:false,own:false};
  const {db,logged}=session({agents:[waiting]});
  const read=await readCompanyRoutines(db,{company,hermes:install(fake)});
  assert.deepEqual(read.agents.map(agent=>[agent.name,agent.state,agent.routines]),[['SEO','failed',null]]);
  assert.equal((await changeAgentRoutine(db,{company,agent:seo,action:'pause',routine:routine.id,hermes:install(fake)})).state,'missing');
  assert.equal(fake.settings.cron.get(shared)[0].state,'scheduled','the main Agent\'s Routine is untouched');
  assert.deepEqual(logged,[]);
 } finally { await fake.close(); }
});

test('the database checks the whole log row before the Engine changes, and a log write that fails afterwards still answers done', async () => {
 const fake=await twoAgents();
 try {
  const hermes=install(fake);
  const refused=session({agents:rows,refuse:'routineInvalid'});
  assert.equal((await changeAgentRoutine(refused.db,{company,agent:ads,action:'create',prompt:'Summary',schedule:'0 9 * * *',hermes})).state,'invalid');
  assert.deepEqual(refused.checked,[{c:company,agent:ads,act:'routine_created',routine:'Summary',schedule:'0 9 * * *'}]);
  assert.equal(fake.settings.cron.get(adsProfile)?.length??0,0,'nothing was made');
  // One failed write is tried again and goes through: done, logged once.
  const blip=session({agents:rows,logFails:1});
  const again=await changeAgentRoutine(blip.db,{company,agent:ads,action:'create',prompt:'Again',schedule:'0 10 * * *',hermes});
  assert.deepEqual([again.state,again.logged,blip.tries.length,blip.logged.length],['done',true,2,1]);
  // A write the database kept but whose answer was lost is tried again with the same key: still one row.
  const lost=session({agents:rows,lostAnswers:1});
  const kept=await changeAgentRoutine(lost.db,{company,agent:ads,action:'create',prompt:'Kept',schedule:'0 11 * * *',hermes});
  assert.deepEqual([kept.state,kept.logged,lost.tries.length,lost.logged.length],['done',true,2,1]);
  assert.equal(lost.tries[0].change,lost.tries[1].change,'the retry carries the same key');
  const outage=session({agents:rows,logFails:9});
  const errors=[]; const said=console.error; console.error=(...args)=>errors.push(args.join(' '));
  try {
   const made=await changeAgentRoutine(outage.db,{company,agent:ads,action:'create',prompt:'Summary',schedule:'0 9 * * *',hermes});
   assert.equal(made.state,'done','the Engine holds it, so a retry would make a second one');
   assert.equal(made.logged,false);
   assert.equal(outage.tries.length,3,'tried three times');
  } finally { console.error=said; }
  assert.equal(fake.settings.cron.get(adsProfile).length,3);
  assert.ok(errors.some(line=>line.includes('Routine change not logged')),'never silent');
 } finally { await fake.close(); }
});

test('a create whose answer is lost is found in the profile\'s list and answered done, so it is never made twice', async () => {
 const fake=await twoAgents();
 try {
  await createRoutine(at(fake,adsProfile),{name:'Earlier',prompt:'Earlier',schedule:'0 7 * * *'});
  fake.settings.loseCronCreates=1;
  const made=await createRoutine(at(fake,adsProfile),{name:'Ads summary',prompt:'Summarise the ads',schedule:'0 9 * * *'});
  assert.equal(made.state,'done');
  assert.equal(made.routine.name,'Ads summary');
  assert.deepEqual(fake.settings.cron.get(adsProfile).map(job=>job.name),['Earlier','Ads summary'],'one job, not two');
  // An Engine that made nothing answers unreachable, and nothing is claimed as made.
  fake.settings.managementStatus=503;
  assert.equal((await createRoutine(at(fake,adsProfile),{name:'Other',prompt:'Other',schedule:'0 8 * * *'})).state,'unreachable');
  fake.settings.managementStatus=200;
  assert.equal(fake.settings.cron.get(adsProfile).length,2);
 } finally { await fake.close(); }
});

// An Agent's details (#205) read that one Agent's Routines alone, in its own profile, as the reader sees it.
test('an Agent\'s details read its own Routines alone, and an Agent hidden from the reader or not on its own profile is missing', async () => {
 const fake=await twoAgents();
 try {
  const hermes=install(fake);
  await createRoutine(at(fake,adsProfile),{name:'Ads summary',prompt:'Summary',schedule:'0 9 * * *'});
  await createRoutine(at(fake,seoProfile),{name:'Rankings',prompt:'Rankings',schedule:'0 11 * * 1'});
  const {db}=session({agents:rows});
  const read=await readAgentRoutines(db,{company,agent:seo,hermes});
  assert.equal(read.state,'found');
  assert.deepEqual(read.routines.map(routine=>routine.name),['Rankings']);
  assert.ok(cronCalls(fake).filter(request=>request.method==='GET').every(request=>profileOfCall(request)!==null));
  assert.equal((await readAgentRoutines(session({agents:[rows[0]]}).db,{company,agent:seo,hermes})).state,'missing','an Agent hidden from the reader');
  assert.equal((await readAgentRoutines(session({agents:[{...rows[1],own:false}]}).db,{company,agent:seo,hermes})).state,'missing','an Agent still on the shared profile');
  assert.equal((await readAgentRoutines(db,{company,agent:'not-an-id',hermes})).state,'invalid');
  assert.equal((await readAgentRoutines(db,{company,agent:seo,hermes:null})).state,'noEngine');
 } finally { await fake.close(); }
});
