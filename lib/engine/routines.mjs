import { cleanPreview, engineName, isSilentReply, sessionIdLike } from './sessions.mjs';
import { ownProfile } from './skills.mjs';
import { manage, query, reachable, refusal, stepState, requestTime } from './wire.mjs';

// An Agent's Routines (#31) are the cron jobs of its own Engine profile (ADR 0016, decision of 2026-11-16): the Engine
// schedules and runs them, and gtmworks keeps no copy. Every call names the profile (v0.23.0 hermes_cli/web_routers/
// cron.py: list 735, create 750, update 781, pause 786, resume 791, trigger 796, delete 806, each with ?profile=). For a
// job's own routes the Engine takes the profile as a hint only and acts on whichever profile holds the id
// (_job_owner_profile), so a job is first found in this profile's own list, and an id that is not there is never sent:
// one Agent's Routine can never be changed through another's.
const routineId=/^[0-9a-f]{6,64}$/;
const textOf=value=>typeof value==='string'?value:'';
const timeOf=value=>typeof value==='string'&&!Number.isNaN(Date.parse(value))?new Date(value).toISOString():null;
/** @param {any} job @returns {import('../engine.mjs').Routine} */
function routineOf(job) {
 const schedule=job.schedule&&typeof job.schedule==='object'?job.schedule:{};
 const on=job.enabled!==false&&job.state!=='paused';
 return {id:job.id,name:textOf(job.name),prompt:textOf(job.prompt),
  schedule:{kind:typeof schedule.kind==='string'?schedule.kind:'unknown',expr:typeof schedule.expr==='string'?schedule.expr:null,
   minutes:Number.isSafeInteger(schedule.minutes)?schedule.minutes:null,display:cleanPreview(job.schedule_display??schedule.display)},
  timezone:typeof job.timezone==='string'&&job.timezone?job.timezone:null,on,
  state:['scheduled','paused','running','completed','error'].includes(job.state)?job.state:on?'scheduled':'paused',
  nextRunAt:on?timeOf(job.next_run_at):null,lastRunAt:timeOf(job.last_run_at),
  lastStatus:job.last_status==null?null:job.last_status==='ok'?'ok':'failed',lastError:cleanPreview(job.last_error)};
}
const ownJob=(job,profile)=>job&&typeof job==='object'&&typeof job.id==='string'&&routineId.test(job.id)&&(job.profile===undefined||job.profile===profile);
/** @param {any} connection @returns {Promise<import('../engine.mjs').RoutineList>} */
export async function readRoutines(connection) {
 const none=state=>({state,routines:null});
 if(!ownProfile.test(connection.profile)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const listed=await manage(connection,`/api/cron/jobs${query(connection.profile)}`);
  if(!listed.response.ok) return none(refusal(listed.response));
  if(!Array.isArray(listed.result)) return none('failed');
  // The list asked for one profile holds that profile's jobs alone; any other is dropped, never shown as this Agent's.
  // Every one is kept (the body is bounded by boundedJson), so a change can always find the Routine it names.
  return {state:'found',routines:listed.result.filter(job=>ownJob(job,connection.profile)).map(routineOf)};
 } catch { return none('unreachable'); }
}
// A schedule gtmworks sends: a five-field cron expression of plain numbers (what Settings writes), checked before the
// Engine is asked, and an IANA zone the person's clock is in, which the Engine checks again.
const cronExpression=/^[0-9*,/-]{1,20}( [0-9*,/-]{1,20}){4}$/;
const zoneName=/^[A-Za-z_+-]{1,40}(\/[A-Za-z0-9_+-]{1,40}){0,2}$/;
// An interval as the Engine writes one ("every 720m"), which a Routine moved with its Agent keeps (#182).
const intervalSchedule=/^every [1-9]\d{0,5}m$/;
// Whether a listed job's schedule is the one a create sent: its cron expression, or an interval of the same minutes.
/** @param {{expr:string|null,minutes:number|null}} listed @param {string} sent */
const sameSchedule=(listed,sent)=>listed.expr===sent||(listed.expr===null&&intervalSchedule.test(sent)&&listed.minutes===Number(sent.slice(6,-1)));
/** @param {unknown} schedule */
export const isRoutineSchedule=schedule=>typeof schedule==='string'&&cronExpression.test(schedule);
/** @param {any} connection @param {string} id */
async function ownRoutine(connection,id) {
 if(!ownProfile.test(connection.profile)||typeof id!=='string'||!routineId.test(id)) return {state:'failed'};
 const listed=await readRoutines(connection);
 if(listed.state!=='found') return {state:listed.state};
 return listed.routines.some(routine=>routine.id===id)?{state:'found'}:{state:'missing'};
}
/** @param {{response:Response,result:any}} answer @param {string} profile */
const routineAnswer=(answer,profile)=>{
 if(answer.response.ok&&ownJob(answer.result,profile)) return {state:'done',routine:routineOf(answer.result)};
 if(answer.response.status===404) return {state:'missing'};
 if(answer.response.status===400||answer.response.status===422) return {state:'refused'};
 if(answer.response.status===409) return {state:'busy'};
 return {state:stepState(answer)};
};
// `paused` makes it switched off from the start (CronJobCreate's `paused`), as a daily message moved to a new main Agent
// while it is off (#182).
/** @param {any} connection @param {{name:string,prompt:string,schedule:string,timezone?:string|null,paused?:boolean}} routine @returns {Promise<import('../engine.mjs').RoutineChange>} */
export async function createRoutine(connection,{name,prompt,schedule,timezone=null,paused=false}) {
 if(!ownProfile.test(connection.profile)||typeof name!=='string'||typeof prompt!=='string'||!prompt.trim()||!(isRoutineSchedule(schedule)||intervalSchedule.test(schedule))||(timezone!==null&&!zoneName.test(timezone))) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 const body={name:name.trim(),prompt:prompt.trim(),schedule,deliver:'local',...(timezone?{timezone}:{}),...(paused===true?{paused:true}:{})};
 // The Engine takes no key for a create, so an answer that is lost (a timeout, a dropped connection, a gateway's 5xx)
 // leaves it unknown whether the job was made. The profile's list is read before and after: a job that was not there
 // before and is this one is the create's, answered as done, so the person is never offered a second create.
 const before=await readRoutines(connection);
 if(before.state!=='found') return {state:before.state};
 const known=new Set(before.routines.map(routine=>routine.id));
 let answer=null;
 try { answer=await manage(connection,`/api/cron/jobs${query(connection.profile)}`,{method:'POST',body}); } catch { answer=null; }
 if(answer&&answer.response.status<500) return routineAnswer(answer,connection.profile);
 const after=await readRoutines(connection);
 const made=after.state==='found'?after.routines.find(routine=>!known.has(routine.id)&&routine.name===body.name&&routine.prompt===body.prompt&&sameSchedule(routine.schedule,schedule)):null;
 return made?{state:'done',routine:made}:{state:'unreachable'};
}
/** @param {any} connection @param {string} id @param {string} path @param {{method?:string,body?:any}} [request] */
async function onOwnRoutine(connection,id,path,request={method:'POST'}) {
 const own=await ownRoutine(connection,id);
 if(own.state!=='found') return {state:own.state};
 try { return routineAnswer(await manage(connection,`/api/cron/jobs/${id}${path}${query(connection.profile)}`,request),connection.profile); }
 catch { return {state:'unreachable'}; }
}
// A new schedule (and the zone it is read in) for one Routine; its prompt and name stay the Engine's.
/** @param {any} connection @param {{id:string,schedule:string,timezone?:string|null}} change @returns {Promise<import('../engine.mjs').RoutineChange>} */
export async function changeRoutine(connection,{id,schedule,timezone=null}) {
 if(!(isRoutineSchedule(schedule)||intervalSchedule.test(schedule))||(timezone!==null&&!zoneName.test(timezone))) return {state:'failed'};
 return onOwnRoutine(connection,id,'',{method:'PUT',body:{updates:{schedule,...(timezone?{timezone}:{})}}});
}
/** @param {any} connection @param {{id:string}} routine */
export const pauseRoutine=(connection,{id})=>onOwnRoutine(connection,id,'/pause');
/** @param {any} connection @param {{id:string}} routine */
export const resumeRoutine=(connection,{id})=>onOwnRoutine(connection,id,'/resume');
// Run now: the Engine claims the job and runs it once, outside its schedule; one already running answers busy.
/** @param {any} connection @param {{id:string}} routine */
export const triggerRoutine=(connection,{id})=>onOwnRoutine(connection,id,'/trigger',{method:'POST',timeout:30000});
/** @param {any} connection @param {{id:string}} routine @returns {Promise<{state:'deleted'|'missing'|'refused'|'unreachable'|'failed'|'busy'}>} */
export async function deleteRoutine(connection,{id}) {
 const own=await ownRoutine(connection,id);
 if(own.state!=='found') return {state:own.state};
 try {
  const removed=await manage(connection,`/api/cron/jobs/${id}${query(connection.profile)}`,{method:'DELETE'});
  if(removed.response.ok&&removed.result?.ok===true) return {state:'deleted'};
  return removed.response.status===404?{state:'missing'}:{state:stepState(removed)};
 } catch { return {state:'unreachable'}; }
}

// What a Routine's newest runs answered (#182): its run history (GET /api/cron/jobs/<id>/runs?profile=&limit=, newest
// first, each agent run a cron session) and each session's newest messages (order=latest), whose last assistant text is
// that run's reply. A run with no session (a script-only fire) or no text has no reply. The job is first found in the
// Agent's own list, as every other call on one Routine.
/** @param {any} connection @param {{id:string,limit?:number}} routine @returns {Promise<{state:'found',runs:{at:string|null,reply:string|null}[]}|{state:'missing'|'refused'|'unreachable'|'failed',runs:null}>} */
export async function readRoutineReplies(connection,{id,limit=3}) {
 const none=state=>({state,runs:null});
 const own=await ownRoutine(connection,id);
 if(own.state!=='found') return none(own.state);
 const count=Number.isInteger(limit)?Math.min(Math.max(limit,1),10):3;
 try {
  const listed=await manage(connection,`/api/cron/jobs/${id}/runs${query(connection.profile)}&limit=${count}`,{timeout:requestTime});
  if(!listed.response.ok) return none(listed.response.status===404?'missing':refusal(listed.response));
  const rows=Array.isArray(listed.result?.runs)?listed.result.runs.slice(0,count):[];
  const runs=await Promise.all(rows.map(async run=>{
   const started=Number(run?.started_at);
   const at=Number.isFinite(started)?new Date(started*1000).toISOString():null;
   const session=typeof run?.id==='string'?run.id:'';
   if(!sessionIdLike.test(session)||session.includes('..')||session.startsWith('cron_output:')) return {at,reply:null};
   const read=await manage(connection,`/api/sessions/${encodeURIComponent(session)}/messages${query(connection.profile)}&order=latest&limit=20&inline_images=false`,{timeout:requestTime}).catch(()=>null);
   if(!read?.response.ok||!Array.isArray(read.result?.messages)) return {at,reply:null};
   const last=read.result.messages.findLast(message=>message?.role==='assistant'&&typeof message.content==='string'&&message.content.trim());
   return {at,reply:last?last.content:null};
  }));
  return {state:'found',runs};
 } catch { return none('unreachable'); }
}

// A Routine's finished runs (#183), newest first, each with its session: the morning message records each run of the
// daily job once, by its session, and reads the night's Routine results between two mornings by when each run ended
// (v0.23.0 GET /api/cron/jobs/<id>/runs, web_routers/cron.py 485-538: an agent run is a `source: cron` session with
// started_at and ended_at in epoch seconds). A run still going, or one with no session (a script-only fire), is left out.
/** @param {any} connection @param {{id:string,limit?:number}} routine @returns {Promise<{state:'found',full:boolean,runs:{session:string,startedAt:string,endedAt:string}[]}|{state:'missing'|'refused'|'unreachable'|'failed',runs:null}>} */
export async function readRoutineRuns(connection,{id,limit=20}) {
 const none=state=>({state,runs:null});
 const own=await ownRoutine(connection,id);
 if(own.state!=='found') return none(own.state);
 try {
  const listed=await manage(connection,`/api/cron/jobs/${id}/runs${query(connection.profile)}&limit=${Math.max(1,Math.min(100,Math.trunc(limit)||20))}`,{timeout:requestTime});
  if(!listed.response.ok) return none(listed.response.status===404?'missing':refusal(listed.response));
  if(!Array.isArray(listed.result?.runs)) return none('failed');
  const epoch=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?new Date(value*1000).toISOString():null;
  const count=Math.max(1,Math.min(100,Math.trunc(limit)||20));
  // `full`: the Engine answered as many rows as asked for, so older runs may lie beyond what it lists.
  return {state:'found',full:listed.result.runs.length>=count,runs:listed.result.runs.flatMap(run=>{
   const session=run?.source==='cron'&&typeof run.id==='string'&&sessionIdLike.test(run.id)&&!run.id.includes('..')&&!run.id.startsWith('cron_output:')?run.id:null;
   const startedAt=epoch(run?.started_at), endedAt=epoch(run?.ended_at);
   return session&&startedAt&&endedAt&&run.is_active!==true?[{session,startedAt,endedAt}]:[];
  })};
 } catch { return none('unreachable'); }
}
// The Routines of a profile the Engine runs now (#699), each with its run's start: the newest run of each of the
// profile's own jobs, when the Engine lists it as still active (v0.23.0 GET /api/cron/jobs/<id>/runs, newest first,
// `is_active` while its session has not ended). A job whose runs could not be read is left out, so it is read again on
// the next pass; a list that could not be read answers its state.
/** @param {any} connection @returns {Promise<{state:'found',running:{id:string,startedAt:string}[]}|{state:'refused'|'unreachable'|'failed',running:null}>} */
export async function readRunningRoutines(connection) {
 const listed=await readRoutines(connection);
 if(listed.state!=='found') return {state:listed.state,running:null};
 const running=await Promise.all(listed.routines.map(async routine=>{
  try {
   const read=await manage(connection,`/api/cron/jobs/${routine.id}/runs${query(connection.profile)}&limit=1`,{timeout:requestTime});
   const run=read.response.ok&&Array.isArray(read.result?.runs)?read.result.runs[0]:null;
   const started=typeof run?.started_at==='number'&&Number.isFinite(run.started_at)&&run.started_at>0?new Date(run.started_at*1000).toISOString():null;
   return run?.source==='cron'&&run.is_active===true&&started?[{id:routine.id,startedAt:started}]:[];
  } catch { return []; }
 }));
 return {state:'found',running:running.flat()};
}
// One run's reply (#183): the last assistant text of its session, or null for a reply the Engine sends nothing for
// (isSilentReply) or one that names the Engine.
/** @param {any} connection @param {string} session @returns {Promise<{state:'found',reply:string|null}|{state:'missing'|'refused'|'unreachable',reply:null}>} */
export async function readRunReply(connection,session) {
 const none=state=>({state,reply:null});
 if(typeof session!=='string'||!sessionIdLike.test(session)||session.includes('..')) return none('missing');
 if(!reachable(connection)) return none('unreachable');
 try {
  const {response,result}=await manage(connection,`/api/sessions/${encodeURIComponent(session)}/messages${query(connection.profile)}&order=latest&limit=20&inline_images=false`,{timeout:requestTime});
  if(response.status===404) return none('missing');
  if(!response.ok) return none(refusal(response));
  if(!Array.isArray(result?.messages)) return none('unreachable');
  const last=result.messages.findLast(message=>message?.role==='assistant'&&typeof message.content==='string'&&message.content.trim());
  const text=last?last.content.toWellFormed().replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]+/g,' ').trim():'';
  return {state:'found',reply:!text||isSilentReply(text)||engineName.test(text)?null:text};
 } catch { return none('unreachable'); }
}
