import { engineOf } from './company-engine.mjs';
import { readRoutines, createRoutine, changeRoutine, pauseRoutine, resumeRoutine, triggerRoutine, deleteRoutine, isRoutineSchedule } from './hermes.mjs';

// The Recurring tasks section (#31). A Routine is one cron job of one Agent's own Engine profile (ADR 0016, decision of
// 2026-11-16): the Engine schedules and runs it, and gtmworks keeps no copy, so every read and change goes through the
// engine contract with that Agent's profile. `db` is the signed-in person's own session: company_app_agents lists the
// Agents they see, so an Agent hidden from them has no Routines here, and the database says who may change one
// (check_routine_change: an active Owner or Manager) and logs each change (log_routine_change). The profile never leaves
// this module.
const drivers={read:readRoutines,create:createRoutine,change:changeRoutine,pause:pauseRoutine,resume:resumeRoutine,run:triggerRoutine,delete:deleteRoutine};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownProfile=/^(co|ag)-[0-9a-f]{32}$/;

/** @param {any} db @param {string} company */
async function shownAgents(db,company) {
 const {data,error}=await db.rpc('company_app_agents',{c:company});
 return error||!Array.isArray(data)?null:data;
}

// Every Agent the reader sees, main Agent first, each with its Routines as its own profile holds them, or the reason
// they could not be read (an Agent whose profile is not its own yet has none to read). States: found, invalid, failed,
// noEngine.
/** @param {any} db @param {{company:string,hermes?:any,driver?:Partial<typeof drivers>}} request */
export async function readCompanyRoutines(db,{company,hermes=engineOf(company),driver={}}) {
 if(typeof company!=='string'||!uuid.test(company)) return {state:'invalid',agents:null};
 const agents=await shownAgents(db,company);
 if(!agents) return {state:'failed',agents:null};
 hermes=await hermes;
 if(!hermes) return {state:'noEngine',agents:null};
 const read=driver.read||drivers.read;
 const rows=await Promise.all(agents.map(async row=>{
  const base={agent:row.agent,name:row.name,connection:row.connection,main:row.main===true};
  if(!ownProfile.test(row.profile)) return {...base,state:'failed',routines:null};
  const listed=await read({...hermes,profile:row.profile});
  return {...base,state:listed.state,routines:listed.routines};
 }));
 return {state:'found',agents:rows};
}

const acts={create:'routine_created',change:'routine_changed',pause:'routine_paused',resume:'routine_resumed',run:'routine_run',delete:'routine_deleted'};
export const routineActions=Object.keys(acts);
const zoneName=/^[A-Za-z_+-]{1,40}(\/[A-Za-z0-9_+-]{1,40}){0,2}$/;

// One change to one Routine of one Agent, as the reader: the Agent must be one they see, the database checks their Role
// before the Engine is asked, and the change the Engine holds is logged once. States: done, missing (an Agent or a
// Routine the reader does not see), invalid, notAllowed, noEngine, busy (it is running already), or the Engine's
// refused / unreachable / failed. A refusal changes nothing and logs nothing.
/** @param {any} db @param {{company:string,agent:unknown,action:unknown,routine?:unknown,name?:unknown,prompt?:unknown,schedule?:unknown,timezone?:unknown,hermes?:any,driver?:Partial<typeof drivers>}} request */
export async function changeAgentRoutine(db,{company,agent,action,routine,name,prompt,schedule,timezone,hermes=engineOf(company),driver={}}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)||typeof action!=='string'||!Object.hasOwn(acts,action)) return {state:'invalid'};
 const zone=typeof timezone==='string'&&zoneName.test(timezone)?timezone:null;
 if(action==='create'&&(typeof prompt!=='string'||!prompt.trim()||prompt.length>4000||(name!==undefined&&(typeof name!=='string'||name.length>200)))) return {state:'invalid'};
 if((action==='create'||action==='change')&&!isRoutineSchedule(schedule)) return {state:'invalid'};
 if(action!=='create'&&(typeof routine!=='string'||!/^[0-9a-f]{6,64}$/.test(routine))) return {state:'invalid'};
 const agents=await shownAgents(db,company);
 if(!agents) return {state:'failed'};
 const target=agents.find(row=>row.agent===agent);
 if(!target||!ownProfile.test(target.profile)) return {state:'missing'};
 hermes=await hermes;
 if(!hermes) return {state:'noEngine'};
 const {error}=await db.rpc('check_routine_change',{c:company,agent});
 if(error) return {state:error.message==='routineNotAllowed'?'notAllowed':'failed'};
 const at={...hermes,profile:target.profile};
 // The name the log keeps: a new Routine's own, else the one its profile holds now (read before a delete removes it).
 let title=null;
 if(action==='create') title=(typeof name==='string'&&name.trim()?name.trim():String(prompt).trim()).slice(0,200);
 else {
  const listed=await (driver.read||drivers.read)(at);
  if(listed.state!=='found') return {state:listed.state};
  const found=listed.routines.find(each=>each.id===routine);
  if(!found) return {state:'missing'};
  title=(found.name||found.prompt).slice(0,200);
 }
 const call=driver[action]||drivers[action];
 const answer=action==='create'?await call(at,{name:title,prompt:String(prompt),schedule:String(schedule),timezone:zone})
  :action==='change'?await call(at,{id:routine,schedule:String(schedule),timezone:zone})
  :await call(at,{id:routine});
 if(answer.state!=='done'&&answer.state!=='deleted') return {state:answer.state};
 // The Engine holds the change: a log the database refuses is not the change's failure, but it is never silent.
 const logged=await db.rpc('log_routine_change',{c:company,agent,act:acts[action],routine:title,schedule:action==='create'||action==='change'?schedule:null});
 if(logged.error) return {state:'failed'};
 return answer.state==='done'?{state:'done',routine:answer.routine}:{state:'done',routine:null};
}
