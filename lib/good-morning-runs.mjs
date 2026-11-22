import { engineOf as companyEngine, onProfile } from './company-engine.mjs';
import { readRoutines, readRoutineRuns, readRunReply } from './hermes.mjs';
import { findMorning } from './agent-morning.mjs';
import { morningMarker } from './morning-schedule.mjs';

// The morning message (#183). Each run of a Company's Good morning job (#182, lib/agent-morning.mjs) is read back from the main Agent's Engine
// profile once it has finished: the Engine lists it as a session with the run's reply (v0.23.0 GET
// /api/cron/jobs/<id>/runs and /api/sessions/<id>/messages; docs/engine-probes/good-morning.md). The worker records it
// as the Company's morning, with every Routine result of the Company's Agents since the morning before it, and the
// database opens a new Conversation with the main Agent for each Member with anything in a part of their card
// (record_good_morning). A reply of [SILENT] is recorded with no greeting and opens none; a job switched off records
// nothing. The card is drawn from these records when the Conversation is read, never from the Engine.
// The night's Routine results are kept as each run ends (#535): the Engine lists at most the newest 100 runs of a job
// and has no paging (web_routers/cron.py 485-538), so every pass keeps each Routine's new finished runs
// (keep_routine_results) and the morning draws its night from what was kept (good_morning_night).
const ownProfile=/^(co|ag)-[0-9a-f]{32}$/;
// A run is read for a day at most: one the worker could not reach within a day greets no one any more.
const freshFor=20*3600*1000;
const firstNight=24*3600*1000;
const retryFor=3600*1000;
// The Engine's own most; a Routine is listed again only once it ran since it was last kept whole, so between two passes
// it would have to run over 100 times to lose one.
const runsRead=100;
// What the database keeps (keep_routine_results): older runs are let go there, so they are not read here.
const keptFor=30*24*3600*1000;
const drivers={routines:readRoutines,runs:readRoutineRuns,reply:readRunReply};
// Each Routine kept whole, by Company, profile and Routine, with the last run the Engine named for it then. Held by the
// worker's process: after a restart each Routine is listed once more, and what was kept already is not read again.
const keptWhole=new Map();

// The day a run greets, in the job's own zone (the time the person chose is read there).
/** @param {string} iso @param {string|null} zone */
export const dayIn=(iso,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
// A result's line is the first line of its run's reply.
/** @param {string} reply */
// How long ago a run ended.
/** @param {{endedAt:string}} run @param {()=>Date} now */
const ageOf=(run,now)=>now().getTime()-Date.parse(run.endedAt);
// The sessions a `*_seen` read answered, as PostgREST gives a set of text (plain or keyed by the function's name).
/** @param {any[]|null} rows @param {string} name */
const sessionsOf=(rows,name)=>new Set((rows||[]).map(value=>typeof value==='string'?value:value?.[name]));
const lineOf=reply=>{ const line=reply.split('\n').map(part=>part.trim()).find(Boolean)||''; const points=Array.from(line); return points.length<=300?line:`${points.slice(0,299).join('').trimEnd()}…`; };

// Keeps every new finished run of each Routine of the Company's Agents (a Good morning job, marked by #182, left out),
// each with its Agent, its Routine's name and the first line of its reply, or none for a reply that sent nothing. A
// profile two Agents share is read once, for its first Agent. A Routine whose last run is the one it was kept whole at is
// not listed again, unless `whole` asks for every list (a morning about to be drawn). A read the Engine or the database
// did not answer (away, refused, failed) leaves the kept results incomplete (`complete: false`), said in the server log
// for the database, and its runs are read on a later pass; a Routine that is gone (missing) has nothing more to give,
// and a run that is gone is kept with no line, so it is not asked for again.
/** @param {any} service @param {{company:string,hermes:{address:string,key:string},listed:Map<string,any[]>,whole:boolean,marks:Map<string,string>,driver:typeof drivers,now:()=>Date}} request */
async function keepResults(service,{company,hermes,listed,whole,marks,driver,now}) {
 const {data:agents,error}=await service.rpc('good_morning_agents',{c:company});
 if(error) { console.error('Routine results not kept:',company,error.message); return false; }
 const seenProfile=new Set(); let complete=true;
 for(const agent of agents||[]) {
  if(!ownProfile.test(agent.profile)||seenProfile.has(agent.profile)) continue;
  seenProfile.add(agent.profile);
  const at=onProfile(agent.profile,company,hermes);
  if(!at) continue;
  let routines=listed.get(agent.profile);
  if(!routines) { const read=await driver.routines(at); if(read.state!=='found') { complete=false; continue; } routines=read.routines; }
  for(const routine of routines) {
   // A Routine that never ran has no result; the daily message is no Routine result.
   if(!routine.lastRunAt||routine.prompt.startsWith(morningMarker)) continue;
   const mark=`${company}:${agent.profile}:${routine.id}`;
   if(!whole&&marks.get(mark)===routine.lastRunAt) continue;
   const runs=await driver.runs(at,{id:routine.id,limit:runsRead});
   if(runs.state!=='found') { if(runs.state!=='missing') complete=false; continue; }
   // A run's end, not the Routine's last start, decides its night, so each finished run is kept with its end.
   const recent=runs.runs.filter(run=>ageOf(run,now)<keptFor);
   const {data:seen,error:unread}=recent.length?await service.rpc('routine_results_seen',{c:company,at_profile:agent.profile,sessions:recent.map(run=>run.session)}):{data:[],error:null};
   if(unread) { console.error('Routine results not kept:',company,unread.message); complete=false; continue; }
   const known=sessionsOf(seen,'routine_results_seen');
   // A full list whose oldest run is not kept yet, of a Routine kept whole before on this worker, ran more than the
   // Engine lists between two passes: what it no longer lists is lost, said in the server log.
   if(runs.full&&marks.has(mark)&&recent.length===runs.runs.length&&!known.has(recent.at(-1).session)) console.warn('Good morning: a Routine ran more often between two passes than the Engine lists:',company,routine.id);
   const name=(routine.name||routine.prompt).trim().slice(0,200);
   const fresh=[]; let read=true;
   for(const run of recent.filter(each=>!known.has(each.session))) {
    const reply=await driver.reply(at,run.session);
    if(reply.state!=='found'&&reply.state!=='missing') { read=false; continue; }
    fresh.push({agent:agent.id,profile:agent.profile,routine_id:routine.id,session:run.session,routine:name,line:reply.reply?lineOf(reply.reply):null,at:run.endedAt});
   }
   if(fresh.length) {
    const {error:failed}=await service.rpc('keep_routine_results',{c:company,results:fresh});
    if(failed) { console.error('Routine results not kept:',company,failed.message); complete=false; continue; }
   }
   if(read) marks.set(mark,routine.lastRunAt); else complete=false;
  }
 }
 return complete;
}

// What ran overnight: the kept results with a line of the Company's Agents that ended after `since` and by `until`, the
// newest 200 (what a morning records, record_good_morning); a night with more is said in the server log.
const mostResults=200;
/** @param {any} service @param {{company:string,since:string,until:string}} request */
async function overnight(service,{company,since,until}) {
 const {data,error}=await service.rpc('good_morning_night',{c:company,since,until});
 if(error) throw new Error(error.message);
 if((data||[]).length>mostResults) console.warn('Good morning: a night held more Routine results than a morning keeps:',company,data.length);
 return (data||[]).slice(0,mostResults).map(row=>({agent:row.agent,routine:row.routine,line:row.line,at:new Date(row.at).toISOString()})).filter(result=>result.routine&&result.line);
}

// One pass: each Company's Routine results kept as they end, then its new runs of its Good morning job, oldest first.
// Answers how many mornings were recorded.
/** @param {any} service @param {{engineOf?:(company:string,db?:any)=>Promise<{address:string,key:string}|null>,driver?:Partial<typeof drivers>,now?:()=>Date,marks?:Map<string,string>}} [options] */
export async function driveGoodMornings(service,{engineOf=companyEngine,driver={},now=()=>new Date(),marks=keptWhole}={}) {
 const use={...drivers,...driver};
 const {data:work,error}=await service.rpc('good_morning_work');
 if(error) throw new Error(error.message);
 let recorded=0;
 for(const row of work||[]) {
  if(!ownProfile.test(row.profile)) continue;
  const hermes=await engineOf(row.company_id,service);
  const at=onProfile(row.profile,row.company_id,hermes);
  if(!hermes||!at) continue;
  const listed=await use.routines(at);
  if(listed.state!=='found') continue;
  // #182's job, found by the marker at the head of its prompt and chosen as Settings chooses it (the one that is on).
  const job=findMorning(listed.routines);
  let fresh=[]; let known=new Set();
  if(job) {
   const runs=await use.runs(at,{id:job.id,limit:5});
   fresh=runs.state==='found'?runs.runs.filter(run=>ageOf(run,now)<freshFor):[];
   if(fresh.length) {
    const {data:seen}=await service.rpc('good_morning_seen',{c:row.company_id,sessions:fresh.map(run=>run.session)});
    known=sessionsOf(seen,'good_morning_seen');
   }
  }
  const unread=fresh.filter(each=>!known.has(each.session));
  // Every pass keeps what ended; a morning about to be drawn lists every Routine again, so none of its night waits for
  // the Routine's next run.
  const complete=await keepResults(service,{company:row.company_id,hermes,listed:new Map([[row.profile,listed.routines]]),whole:!!job?.on&&unread.length>0,marks,driver:use,now});
  if(!job||!unread.length) continue;
  // Switched off: each finished run not yet read is kept as sent nothing, so switching it on again waits for a new run
  // and never delivers the morning that was switched off.
  if(!job.on) {
   for(const run of unread) {
    const {error:failed}=await service.rpc('record_good_morning',{c:row.company_id,agent:row.agent_id,session:run.session,greeting_day:dayIn(run.startedAt,job.timezone),ran:run.startedAt,greeting:null,results:[]});
    if(failed) console.error('Good morning not recorded:',row.company_id,failed.message);
   }
   continue;
  }
  let last=row.last_ran_at?new Date(row.last_ran_at).toISOString():null;
  for(const run of unread.reverse()) {
   const reply=await use.reply(at,run.session);
   if(reply.state!=='found') continue;
   // An incomplete night is tried again on the next passes; after an hour the morning goes with what could be read, so
   // an Engine away that long does not keep "Waiting on you" from the Members.
   if(reply.reply&&!complete&&ageOf(run,now)<retryFor) break;
   const since=last&&last<run.startedAt?last:new Date(Date.parse(run.startedAt)-firstNight).toISOString();
   const results=reply.reply?await overnight(service,{company:row.company_id,since,until:run.startedAt}):[];
   const {error:failed}=await service.rpc('record_good_morning',{c:row.company_id,agent:row.agent_id,session:run.session,greeting_day:dayIn(run.startedAt,job.timezone),ran:run.startedAt,greeting:reply.reply,results});
   if(failed) { console.error('Good morning not recorded:',row.company_id,failed.message); continue; }
   recorded+=1; if(reply.reply) last=run.startedAt;
  }
 }
 return recorded;
}
