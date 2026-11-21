import { engineOf } from './company-engine.mjs';
import { readRoutines, createRoutine, changeRoutine, pauseRoutine, resumeRoutine, deleteRoutine, readRoutineReplies, isSilentReply } from './hermes.mjs';
import { dayOffset } from './routine-schedule.mjs';
import { morningCron, morningMarker, morningTime } from './morning-schedule.mjs';

// Good morning (#182): the main Agent's daily message is one scheduled job of the main Agent's own Engine profile, made,
// timed, paused and resumed through the engine contract of #31. gtmworks keeps no schedule of its own: the switch and
// the time on the Agent's page are read from that job, found by the marker gtmworks writes at the head of its prompt.
// Every Agent may do scheduled work (ADR 0018, #391), so the Owner and the Managers
// change it (check_agent_setting, asked before the Engine), and each change the Engine holds is one row of the Company
// log with the old and the new value (log_agent_morning: "off", the time, or the job's own schedule). The message's words
// and its card are #183.

// The job's name, as Recurring tasks (#31) lists it.
export const morningName='Good morning';
// What the job asks for. A reply of [SILENT] is the Engine's own way to send nothing (cron/scheduler.py).
const morningPrompt=`${morningMarker}\nWrite the morning summary for the team: what is waiting on people today and what ran overnight. `
 +'If there is nothing new since the last summary, reply with exactly [SILENT] and nothing else.';
// The select's value for a job whose schedule is no daily time and no cron expression (an interval set in a chat): the
// schedule is kept as it is.
const keep='keep';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownProfile=/^(co|ag)-[0-9a-f]{32}$/;
const zoneName=/^[A-Za-z_+-]{1,40}(\/[A-Za-z0-9_+-]{1,40}){0,2}$/;
const drivers={read:readRoutines,create:createRoutine,change:changeRoutine,pause:pauseRoutine,resume:resumeRoutine,delete:deleteRoutine,replies:readRoutineReplies};
const ownedBy=row=>row?.own===true&&ownProfile.test(row.profile);

/** @param {import('./engine.mjs').Routine[]} routines */
const marked=routines=>routines.filter(routine=>routine.prompt.startsWith(morningMarker));
/** @param {import('./engine.mjs').Routine[]} routines */
const findMorning=routines=>marked(routines)[0]??null;
// There is one daily message: a second marked job (two people switching it on at the same moment, each finding none) is
// removed, the first in the Engine's own order kept, which every request agrees on. A delete another request already
// made answers missing, which is fine.
/** @param {(name:string)=>any} call @param {any} at @param {import('./engine.mjs').Routine[]} routines */
async function keepOne(call,at,routines) {
 const [kept,...extra]=marked(routines);
 for(const each of extra) await call('delete')(at,{id:each.id});
 return kept??null;
}
// What the log keeps for a state: "off", or the time (the schedule's own expression when it is not a daily time, else
// "other").
const logValue=routine=>!routine||!routine.on?'off':morningTime(routine)??(routine.schedule.expr||'other');

/** @param {any} db @param {string} company */
async function shownAgents(db,company) {
 const {data,error}=await db.rpc('company_app_agents',{c:company});
 return error||!Array.isArray(data)?null:data;
}

// The main Agent's daily message as its page draws it. States: found (with `routine` null when none was ever made), or
// notMain, notOwn (an Agent whose profile is not its own yet), invalid, failed, noEngine, or the Engine's
// refused / unreachable. `quietYesterday` is true when the job's run of yesterday, in its own zone, sent nothing.
/** @param {any} db @param {{company:string,agent:string,hermes?:any,driver?:Partial<typeof drivers>,now?:Date}} request */
export async function readAgentMorning(db,{company,agent,hermes=engineOf(company),driver={},now=new Date()}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return {state:'invalid'};
 const agents=await shownAgents(db,company);
 if(!agents) return {state:'failed'};
 const target=agents.find(row=>row.agent===agent);
 if(!target||target.main!==true) return {state:'notMain'};
 if(!ownedBy(target)) return {state:'notOwn'};
 const engine=await hermes;
 if(!engine) return {state:'noEngine'};
 const at={...engine,profile:target.profile};
 const listed=await (driver.read||drivers.read)(at);
 if(listed.state!=='found') return {state:listed.state};
 const routine=findMorning(listed.routines);
 // Yesterday's run, whether today's has run yet or not: a job that last ran today or yesterday is read.
 let quietYesterday=false;
 const lastDay=routine?.lastRunAt?dayOffset(routine.lastRunAt,routine.timezone,now):null;
 if(routine&&(lastDay===0||lastDay===-1)) {
  const read=await (driver.replies||drivers.replies)(at,{id:routine.id,limit:3});
  const yesterday=read.state==='found'?read.runs.find(run=>run.at&&dayOffset(run.at,routine.timezone,now)===-1):null;
  quietYesterday=!!yesterday&&isSilentReply(yesterday.reply);
 }
 return {state:'found',
  routine:routine?{id:routine.id,on:routine.on,time:morningTime(routine),schedule:routine.schedule,timezone:routine.timezone}:null,quietYesterday};
}

// One save of the switch and the time from the main Agent's page, as the signed-in person. `on` is the switch, `time` the
// select's value ("9:00", the job's own cron expression, or "keep" for a schedule that is neither), `zone` the browser's
// IANA zone, used only when the job is first made. Switching on the first time makes the job; a new time changes it,
// switching off pauses it and switching on again resumes it, so there is never a second one. Whatever the Engine came to hold is logged, also when a later step failed. States: written (with what the
// Engine now holds), invalid, notMain, notOwn, notAllowed, failed, noEngine, or the Engine's refused /
// unreachable / busy / missing.
/** @param {any} db @param {{company:string,agent:unknown,on:unknown,time:unknown,zone?:unknown,hermes?:any,driver?:Partial<typeof drivers>}} request */
export async function changeAgentMorning(db,{company,agent,on,time,zone,hermes=engineOf(company),driver={}}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)||typeof on!=='boolean'||typeof time!=='string') return {state:'invalid'};
 const timezone=typeof zone==='string'&&zoneName.test(zone)?zone:null;
 const agents=await shownAgents(db,company);
 if(!agents) return {state:'failed'};
 const target=agents.find(row=>row.agent===agent);
 if(!target||target.main!==true) return {state:'notMain'};
 if(!ownedBy(target)) return {state:'notOwn'};
 const {error:refusedBy}=await db.rpc('check_agent_setting',{c:company,agent});
 if(refusedBy) return {state:refusedBy.message==='agentSettingNotAllowed'?'notAllowed':'failed'};
 const engine=await hermes;
 if(!engine) return {state:'noEngine'};
 const at={...engine,profile:target.profile};
 const call=name=>driver[name]||drivers[name];
 const listed=await call('read')(at);
 if(listed.state!=='found') return {state:listed.state};
 let routine=await keepOne(call,at,listed.routines);
 const old=logValue(routine);
 // The time is one of the select's clocks, or the job's own schedule left as it is (one changed in a chat).
 const kept=routine&&(time===keep||time===routine.schedule.expr);
 const schedule=kept?null:morningCron(time);
 if(!kept&&!schedule) return {state:'invalid'};
 let failed=null;
 const step=answer=>{ if(answer.state!=='done') { failed=answer.state; return false; } routine=answer.routine; return true; };
 if(!routine) {
  if(on&&step(await call('create')(at,{name:morningName,prompt:morningPrompt,schedule:/** @type {string} */(schedule),timezone}))) {
   // Another save may have made one at the same moment: read again and keep the one both agree on.
   const again=await call('read')(at);
   if(again.state==='found') routine=await keepOne(call,at,again.routines)??routine;
  }
 } else {
  const moved=!schedule||routine.schedule.expr===schedule||step(await call('change')(at,{id:routine.id,schedule,timezone:routine.timezone}));
  if(moved&&on!==routine.on) step(await call(on?'resume':'pause')(at,{id:routine.id}));
 }
 const now=logValue(routine);
 if(now!==old) {
  const {error}=await db.rpc('log_agent_morning',{c:company,agent,old_value:old,new_value:now});
  if(error) console.error('Good morning change not logged:',company,agent,error.message||'unknown error');
 }
 if(failed) return {state:failed};
 return {state:'written',morning:{on:routine?.on===true,time:routine?morningTime(routine)??routine.schedule.expr??keep:time}};
}

// The main Agent changed (#182): Make it main, or the main Agent removed with a replacement. The daily message moves to
// the new main Agent's own profile with the same time, zone and switch, and none is left on the old one; a job already on
// the new profile (one an earlier move left) is replaced first, so there is never a second. A message that cannot move
// (the new main Agent's profile is not its own yet, or its schedule is no cron expression) is paused where it is, so no
// Agent but the main one ever sends it. `agents` is company_app_agents as read before the change, so a removed Agent's
// profile is still known. States: moved, none (there was no message), paused, failed, noEngine, or the Engine's own.
/** @param {any} db @param {{company:string,from:string,to:string,agents?:any[]|null,hermes?:any,driver?:Partial<typeof drivers>}} request */
export async function moveAgentMorning(db,{company,from,to,agents=null,hermes=engineOf(company),driver={}}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof from!=='string'||!uuid.test(from)||typeof to!=='string'||!uuid.test(to)) return {state:'invalid'};
 const rows=agents??await shownAgents(db,company);
 if(!rows) return {state:'failed'};
 const [old,next]=[rows.find(row=>row.agent===from),rows.find(row=>row.agent===to)];
 if(!old||!ownProfile.test(old.profile)) return {state:'none'};
 const engine=await hermes;
 if(!engine) return {state:'noEngine'};
 const call=name=>driver[name]||drivers[name];
 const fromAt={...engine,profile:old.profile};
 const listedFrom=await call('read')(fromAt);
 if(listedFrom.state!=='found') return {state:listedFrom.state};
 const routine=findMorning(listedFrom.routines);
 if(!routine) return {state:'none'};
 // The same profile: the message is already where the new main Agent reads it, if that profile is its own.
 if(next&&old.profile===next.profile&&ownedBy(next)) return {state:'moved'};
 const holdIt=async()=>{ if(!routine.on) return {state:'paused'}; const paused=await call('pause')(fromAt,{id:routine.id}); return {state:paused.state==='done'?'paused':paused.state}; };
 if(!ownedBy(next)||old.profile===next.profile||!routine.schedule.expr) return holdIt();
 const toAt={...engine,profile:next.profile};
 const listedTo=await call('read')(toAt);
 if(listedTo.state!=='found') return holdIt();
 for(const left of listedTo.routines.filter(each=>each.prompt.startsWith(morningMarker))) {
  const removed=await call('delete')(toAt,{id:left.id});
  if(removed.state!=='deleted') return holdIt();
 }
 const made=await call('create')(toAt,{name:routine.name||morningName,prompt:routine.prompt,schedule:routine.schedule.expr,timezone:routine.timezone,paused:!routine.on});
 if(made.state!=='done') return holdIt();
 // The old one goes; tried again once, and if it still stays the new copy is taken back, never two.
 for(let attempt=0;attempt<2;attempt++) if((await call('delete')(fromAt,{id:routine.id})).state==='deleted') return {state:'moved'};
 await call('delete')(toAt,{id:made.routine.id});
 return holdIt();
}
