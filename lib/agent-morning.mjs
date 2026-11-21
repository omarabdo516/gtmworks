import { engineOf } from './company-engine.mjs';
import { readRoutines, createRoutine, changeRoutine, pauseRoutine, resumeRoutine, deleteRoutine, readRoutineLastReply, isSilentReply } from './hermes.mjs';
import { dayOffset } from './routine-schedule.mjs';
import { morningCron, morningLevel, morningTime } from './morning-schedule.mjs';

// Good morning (#182): the main Agent's daily message is one scheduled job of the main Agent's own Engine profile, made,
// timed, paused and resumed through the engine contract of #31. gtmworks keeps no schedule of its own: the switch and
// the time on the Agent's page are read from that job, found by its name in the profile's own list. Scheduled work is
// Agent level 3 (ADR 0014), so below it the message is never switched on. The Owner and the Managers change it
// (check_agent_setting, asked before the Engine), and each change is one row of the Company log with the old and the new
// value (log_agent_morning: "off" or the time). The message's words and its card are #183.

// The job's name: how the daily message is told apart from the Agent's other Routines.
export const morningName='Good morning';
// What the job asks for. A reply of [SILENT] is the Engine's own way to send nothing (cron/scheduler.py).
const morningPrompt='Write the morning summary for the team: what is waiting on people today and what ran overnight. '
 +'If there is nothing new since the last summary, reply with exactly [SILENT] and nothing else.';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownProfile=/^(co|ag)-[0-9a-f]{32}$/;
const zoneName=/^[A-Za-z_+-]{1,40}(\/[A-Za-z0-9_+-]{1,40}){0,2}$/;
const drivers={read:readRoutines,create:createRoutine,change:changeRoutine,pause:pauseRoutine,resume:resumeRoutine,delete:deleteRoutine,lastReply:readRoutineLastReply};
const ownedBy=row=>row?.own===true&&ownProfile.test(row.profile);

/** @param {import('./engine.mjs').Routine[]} routines */
const findMorning=routines=>routines.find(routine=>routine.name===morningName)??null;
// What the log keeps for a state: "off", or the time (the schedule's own words when it is not a daily time).
const logValue=routine=>!routine||!routine.on?'off':morningTime(routine)??(routine.schedule.expr||'other');

/** @param {any} db @param {string} company */
async function shownAgents(db,company) {
 const {data,error}=await db.rpc('company_app_agents',{c:company});
 return error||!Array.isArray(data)?null:data;
}
/** @param {any} db @param {string} company */
async function companyLevel(db,company) {
 const {data}=await db.from('companies').select('agent_level').eq('id',company).maybeSingle();
 return Number(data?.agent_level)||1;
}

// The main Agent's daily message as its page draws it. States: found (with `routine` null when none was ever made), or
// notMain, notOwn (an Agent whose profile is not its own yet), invalid, failed, noEngine, or the Engine's
// refused / unreachable. `quietYesterday` is true when the job ran yesterday, in its own zone, and sent nothing.
/** @param {any} db @param {{company:string,agent:string,hermes?:any,driver?:Partial<typeof drivers>,now?:Date}} request */
export async function readAgentMorning(db,{company,agent,hermes=engineOf(company),driver={},now=new Date()}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return {state:'invalid'};
 const agents=await shownAgents(db,company);
 if(!agents) return {state:'failed'};
 const target=agents.find(row=>row.agent===agent);
 if(!target||target.main!==true) return {state:'notMain'};
 if(!ownedBy(target)) return {state:'notOwn'};
 const [level,engine]=await Promise.all([companyLevel(db,company),hermes]);
 if(!engine) return {state:'noEngine'};
 const at={...engine,profile:target.profile};
 const listed=await (driver.read||drivers.read)(at);
 if(listed.state!=='found') return {state:listed.state};
 const routine=findMorning(listed.routines);
 let quietYesterday=false;
 if(routine?.lastRunAt&&routine.lastStatus==='ok'&&dayOffset(routine.lastRunAt,routine.timezone,now)===-1) {
  const last=await (driver.lastReply||drivers.lastReply)(at,{id:routine.id});
  quietYesterday=last.state==='found'&&!!last.at&&dayOffset(last.at,routine.timezone,now)===-1&&isSilentReply(last.reply);
 }
 return {state:'found',level,allowed:level>=morningLevel,
  routine:routine?{id:routine.id,on:routine.on,time:morningTime(routine),schedule:routine.schedule,timezone:routine.timezone}:null,quietYesterday};
}

// One save of the switch and the time from the main Agent's page, as the signed-in person. `on` is the switch, `time` the
// select's value ("9:00"), `zone` the browser's IANA zone, used only when the job is first made. Switching on the first
// time makes the job; a new time changes it, switching off pauses it and switching on again resumes it, so there is never
// a second one. Below level 3 it is never switched on. States: written (with what the Engine now holds), invalid,
// notMain, notOwn, notAllowed, levelLow, failed, noEngine, or the Engine's refused / unreachable / busy / missing.
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
 const [level,engine]=await Promise.all([companyLevel(db,company),hermes]);
 if(!engine) return {state:'noEngine'};
 const at={...engine,profile:target.profile};
 const call=name=>driver[name]||drivers[name];
 const listed=await call('read')(at);
 if(listed.state!=='found') return {state:listed.state};
 let routine=findMorning(listed.routines);
 const old=logValue(routine);
 // Below level 3 the switch cannot be turned on; one left on from before may still be switched off.
 if(on&&!routine?.on&&level<morningLevel) return {state:'levelLow'};
 // The time is one of the select's clocks, or the job's own schedule left as it is (one changed in a chat).
 const schedule=morningCron(time)??(routine&&time===routine.schedule.expr?time:null);
 if(!schedule) return {state:'invalid'};
 const step=answer=>{ if(answer.state!=='done') return answer.state; routine=answer.routine; return null; };
 if(!routine) {
  if(on) {
   const failed=step(await call('create')(at,{name:morningName,prompt:morningPrompt,schedule,timezone}));
   if(failed) return {state:failed};
  }
 } else {
  if(routine.schedule.expr!==schedule) {
   const failed=step(await call('change')(at,{id:routine.id,schedule,timezone:routine.timezone}));
   if(failed) return {state:failed};
  }
  if(on!==routine.on) {
   const failed=step(await call(on?'resume':'pause')(at,{id:routine.id}));
   if(failed) return {state:failed};
  }
 }
 const kept=logValue(routine);
 if(kept!==old) {
  const {error}=await db.rpc('log_agent_morning',{c:company,agent,old_value:old,new_value:kept});
  if(error) console.error('Good morning change not logged:',company,agent,error.message||'unknown error');
 }
 return {state:'written',morning:{on:routine?.on===true,time:routine?morningTime(routine)??routine.schedule.expr??time:time}};
}

// The Owner made another Agent the main one (#182): the daily message moves to the new main Agent's own profile with the
// same time, zone and switch, and none is left on the old one. A job already on the new profile (one an earlier move
// left) is replaced, so there is never a second. States: moved, none (there was no message), kept (the two Agents share a
// profile, or one is not its own yet, so there is nothing to move), failed, noEngine, or the Engine's own.
/** @param {any} db @param {{company:string,from:string,to:string,hermes?:any,driver?:Partial<typeof drivers>}} request */
export async function moveAgentMorning(db,{company,from,to,hermes=engineOf(company),driver={}}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof from!=='string'||!uuid.test(from)||typeof to!=='string'||!uuid.test(to)) return {state:'invalid'};
 const agents=await shownAgents(db,company);
 if(!agents) return {state:'failed'};
 const [old,next]=[agents.find(row=>row.agent===from),agents.find(row=>row.agent===to)];
 if(!ownedBy(old)||!ownedBy(next)||old.profile===next.profile) return {state:'kept'};
 const engine=await hermes;
 if(!engine) return {state:'noEngine'};
 const call=name=>driver[name]||drivers[name];
 const [fromAt,toAt]=[{...engine,profile:old.profile},{...engine,profile:next.profile}];
 const [listedFrom,listedTo]=await Promise.all([call('read')(fromAt),call('read')(toAt)]);
 if(listedFrom.state!=='found') return {state:listedFrom.state};
 if(listedTo.state!=='found') return {state:listedTo.state};
 const routine=findMorning(listedFrom.routines);
 if(!routine) return {state:'none'};
 if(!routine.schedule.expr) return {state:'failed'};
 for(const left of listedTo.routines.filter(each=>each.name===morningName)) {
  const removed=await call('delete')(toAt,{id:left.id});
  if(removed.state!=='deleted') return {state:removed.state};
 }
 const made=await call('create')(toAt,{name:morningName,prompt:routine.prompt||morningPrompt,schedule:routine.schedule.expr,timezone:routine.timezone,paused:!routine.on});
 if(made.state!=='done') return {state:made.state};
 const removed=await call('delete')(fromAt,{id:routine.id});
 return removed.state==='deleted'?{state:'moved'}:{state:removed.state};
}
