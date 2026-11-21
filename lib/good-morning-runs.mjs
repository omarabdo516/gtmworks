import { engineOf as companyEngine, onProfile } from './company-engine.mjs';
import { readRoutines, readRoutineRuns, readRunReply } from './hermes.mjs';
import { morningMarker } from './morning-schedule.mjs';

// The morning message (#183). Each run of a Company's Good morning job (#182, lib/agent-morning.mjs) is read back from the main Agent's Engine
// profile once it has finished: the Engine lists it as a session with the run's reply (v0.23.0 GET
// /api/cron/jobs/<id>/runs and /api/sessions/<id>/messages; docs/engine-probes/good-morning.md). The worker records it
// as the Company's morning, with every Routine result of the Company's Agents since the morning before it, and the
// database opens a new Conversation with the main Agent for each Member with anything in a part of their card
// (record_good_morning). A reply of [SILENT] is recorded with no greeting and opens none; a job switched off records
// nothing. The card is drawn from these records when the Conversation is read, never from the Engine.
const ownProfile=/^(co|ag)-[0-9a-f]{32}$/;
// A run is read for a day at most: one the worker could not reach within a day greets no one any more.
const freshFor=20*3600*1000;
const firstNight=24*3600*1000;
const retryFor=3600*1000;
// Enough for a Routine that runs every 15 minutes through a whole day (96 runs); the Engine's own most.
const runsRead=100;
const mostResults=200;
const drivers={routines:readRoutines,runs:readRoutineRuns,reply:readRunReply};

// The day a run greets, in the job's own zone (the time the person chose is read there).
/** @param {string} iso @param {string|null} zone */
export const dayIn=(iso,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
// A result's line is the first line of its run's reply.
/** @param {string} reply */
const lineOf=reply=>{ const line=reply.split('\n').map(part=>part.trim()).find(Boolean)||''; const points=Array.from(line); return points.length<=300?line:`${points.slice(0,299).join('').trimEnd()}…`; };

// What ran overnight: every finished run, between `since` and `until`, of each Routine of the Company's Agents (the
// Good morning job left out), each with its Agent, its Routine's name and the first line of its reply. A profile two
// Agents share is read once, for its first Agent. A read the Engine did not answer (away, refused, failed) makes the night
// incomplete (`complete: false`), so the caller tries the morning again rather than record it without those results; a
// Routine or run that is gone (missing) has nothing more to give and is not waited for.
/** @param {any} service @param {{company:string,hermes:{address:string,key:string},job:string,since:string,until:string,driver:typeof drivers}} request */
async function overnight(service,{company,hermes,job,since,until,driver}) {
 const {data:agents,error}=await service.rpc('good_morning_agents',{c:company});
 if(error) throw new Error(error.message);
 const seen=new Set(); const results=[]; let complete=true;
 for(const agent of agents||[]) {
  if(!ownProfile.test(agent.profile)||seen.has(agent.profile)) continue;
  seen.add(agent.profile);
  const at=onProfile(agent.profile,company,hermes);
  if(!at) continue;
  const listed=await driver.routines(at);
  if(listed.state!=='found') { complete=false; continue; }
  for(const routine of listed.routines) {
   // A Routine that never ran has no result. Any other is read whole: a run that started before the previous morning
   // and ended after it belongs to this night, so a run's end, not the Routine's last start, decides.
   if(routine.id===job||!routine.lastRunAt) continue;
   const runs=await driver.runs(at,{id:routine.id,limit:runsRead});
   if(runs.state!=='found') { if(runs.state!=='missing') complete=false; continue; }
   // The Engine lists at most the newest 100 runs and has no paging (web_routers/cron.py 485-538): a full list whose
   // oldest run still ended after the previous morning is a night longer than the Engine shows, said in the server log.
   if(runs.full&&(!runs.runs.length||runs.runs.at(-1).endedAt>since)) console.warn('Good morning: a Routine ran more often overnight than the Engine lists:',company,routine.id);
   for(const run of runs.runs) {
    if(run.endedAt<=since||run.endedAt>until||results.length>=mostResults) continue;
    const reply=await driver.reply(at,run.session);
    if(reply.state!=='found') { if(reply.state!=='missing') complete=false; continue; }
    if(!reply.reply) continue;
    results.push({agent:agent.id,routine:(routine.name||routine.prompt).trim().slice(0,200),line:lineOf(reply.reply),at:run.endedAt});
   }
  }
 }
 return {complete,results:results.filter(result=>result.routine&&result.line)};
}

// One pass: each Company's new runs of its Good morning job, oldest first. Answers how many mornings were recorded.
/** @param {any} service @param {{engineOf?:(company:string,db?:any)=>Promise<{address:string,key:string}|null>,driver?:Partial<typeof drivers>,now?:()=>Date}} [options] */
export async function driveGoodMornings(service,{engineOf=companyEngine,driver={},now=()=>new Date()}={}) {
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
  // #182's job, found by the marker it writes at the head of the prompt; the first in the Engine's order, as #182 keeps.
  const job=listed.routines.find(routine=>routine.prompt.startsWith(morningMarker));
  if(!job) continue;
  const runs=await use.runs(at,{id:job.id,limit:5});
  if(runs.state!=='found'||!runs.runs.length) continue;
  const fresh=runs.runs.filter(run=>now().getTime()-Date.parse(run.endedAt)<freshFor);
  if(!fresh.length) continue;
  const {data:seen}=await service.rpc('good_morning_seen',{c:row.company_id,sessions:fresh.map(run=>run.session)});
  const known=new Set((seen||[]).map(value=>typeof value==='string'?value:value?.good_morning_seen));
  // Switched off: each finished run not yet read is kept as sent nothing, so switching it on again waits for a new run
  // and never delivers the morning that was switched off.
  if(!job.on) {
   for(const run of fresh.filter(each=>!known.has(each.session))) {
    const {error:failed}=await service.rpc('record_good_morning',{c:row.company_id,agent:row.agent_id,session:run.session,greeting_day:dayIn(run.startedAt,job.timezone),ran:run.startedAt,greeting:null,results:[]});
    if(failed) console.error('Good morning not recorded:',row.company_id,failed.message);
   }
   continue;
  }
  let last=row.last_ran_at?new Date(row.last_ran_at).toISOString():null;
  for(const run of fresh.filter(each=>!known.has(each.session)).reverse()) {
   const reply=await use.reply(at,run.session);
   if(reply.state!=='found') continue;
   const since=last&&last<run.startedAt?last:new Date(Date.parse(run.startedAt)-firstNight).toISOString();
   const night=reply.reply?await overnight(service,{company:row.company_id,hermes,job:job.id,since,until:run.startedAt,driver:use}):{complete:true,results:[]};
   // An incomplete night is tried again on the next passes; after an hour the morning goes with what could be read, so
   // an Engine away that long does not keep "Waiting on you" from the Members.
   if(!night.complete&&now().getTime()-Date.parse(run.endedAt)<retryFor) break;
   const results=night.results;
   const {error:failed}=await service.rpc('record_good_morning',{c:row.company_id,agent:row.agent_id,session:run.session,greeting_day:dayIn(run.startedAt,job.timezone),ran:run.startedAt,greeting:reply.reply,results});
   if(failed) { console.error('Good morning not recorded:',row.company_id,failed.message); continue; }
   recorded+=1; if(reply.reply) last=run.startedAt;
  }
 }
 return recorded;
}
