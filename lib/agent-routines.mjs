import { randomUUID } from 'node:crypto';
import { engineOf } from './company-engine.mjs';
import { withMorningLease } from './agent-morning.mjs';
import { morningMarker } from './morning-schedule.mjs';
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
// An Agent's profile is its own (company_app_agents `own`): its own `ag-` profile, or the main Agent keeping the Company's.
const ownedBy=row=>row.own===true&&ownProfile.test(row.profile);

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
  if(!ownedBy(row)) return {...base,state:'failed',routines:null};
  const listed=await read({...hermes,profile:row.profile});
  return {...base,state:listed.state,routines:listed.routines};
 }));
 return {state:'found',agents:rows};
}

// One Agent's Routines for its details (#205), as the reader: an Agent they do not see, or one whose profile is not its
// own yet, is missing; otherwise its own profile's list, or why it could not be read. States as readCompanyRoutines,
// plus missing.
/** @param {any} db @param {{company:string,agent:unknown,hermes?:any,driver?:Partial<typeof drivers>}} request */
export async function readAgentRoutines(db,{company,agent,hermes=engineOf(company),driver={}}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return {state:'invalid',routines:null};
 const agents=await shownAgents(db,company);
 if(!agents) return {state:'failed',routines:null};
 const target=agents.find(row=>row.agent===agent);
 if(!target||!ownedBy(target)) return {state:'missing',routines:null};
 hermes=await hermes;
 if(!hermes) return {state:'noEngine',routines:null};
 return (driver.read||drivers.read)({...hermes,profile:target.profile});
}

const logAttempts=3;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const acts={create:'routine_created',change:'routine_changed',pause:'routine_paused',resume:'routine_resumed',run:'routine_run',delete:'routine_deleted'};
const zoneName=/^[A-Za-z_+-]{1,40}(\/[A-Za-z0-9_+-]{1,40}){0,2}$/;
// A Routine's time zone as it is saved (#779): null when none is named (the Engine reads UTC), the zone when this server
// knows it, and false for one it does not, which is refused, so no saved Routine names a zone its times cannot be worked
// out in.
/** @param {unknown} timezone @returns {string|null|false} */
export function routineZone(timezone) {
 if(timezone===undefined||timezone===null||timezone==='') return null;
 if(typeof timezone!=='string'||!zoneName.test(timezone)) return false;
 try { new Intl.DateTimeFormat('en-US',{timeZone:timezone}); return timezone; } catch { return false; }
}

// One change to one Routine of one Agent, as the reader: the Agent must be one they see, the database checks their Role
// before the Engine is asked, and the change the Engine holds is logged once. States: done, missing (an Agent or a
// Routine the reader does not see), invalid, notAllowed, noEngine, busy (it is running already), or the Engine's
// refused / unreachable / failed. A refusal changes nothing and logs nothing.
/** @param {any} db @param {{company:string,agent:unknown,action:unknown,routine?:unknown,name?:unknown,prompt?:unknown,schedule?:unknown,timezone?:unknown,hermes?:any,driver?:Partial<typeof drivers>}} request */
export async function changeAgentRoutine(db,{company,agent,action,routine,name,prompt,schedule,timezone,hermes=engineOf(company),driver={},leaseWait}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)||typeof action!=='string'||!Object.hasOwn(acts,action)) return {state:'invalid'};
 const zone=routineZone(timezone);
 if(zone===false&&(action==='create'||action==='change')) return {state:'zoneUnknown'};
 if(action==='create'&&(typeof prompt!=='string'||!prompt.trim()||prompt.length>4000||(name!==undefined&&(typeof name!=='string'||name.length>200)))) return {state:'invalid'};
 if((action==='create'||action==='change')&&!isRoutineSchedule(schedule)) return {state:'invalid'};
 if(action!=='create'&&(typeof routine!=='string'||!/^[0-9a-f]{6,64}$/.test(routine))) return {state:'invalid'};
 const agents=await shownAgents(db,company);
 if(!agents) return {state:'failed'};
 const target=agents.find(row=>row.agent===agent);
 // Only an Agent whose profile is its own: one still on the Company's shared profile would reach the main Agent's jobs.
 if(!target||!ownedBy(target)) return {state:'missing'};
 hermes=await hermes;
 if(!hermes) return {state:'noEngine'};
 const at={...hermes,profile:target.profile};
 // The name the log keeps: a new Routine's own, else the one its profile holds now (read before a delete removes it).
 let title=null;
 let marked=action==='create'&&String(prompt).startsWith(morningMarker);
 if(action==='create') title=(typeof name==='string'&&name.trim()?name.trim():String(prompt).trim()).slice(0,200);
 else {
  const listed=await (driver.read||drivers.read)(at);
  if(listed.state!=='found') return {state:listed.state};
  const found=listed.routines.find(each=>each.id===routine);
  if(!found) return {state:'missing'};
  title=(found.name||found.prompt).slice(0,200);
  marked=found.prompt.startsWith(morningMarker);
 }
 // The database checks the Role and everything the log row will hold before the Engine is changed, so after a change
 // only an outage can keep the row from being written.
 const row={c:company,agent,act:acts[action],routine:title,schedule:action==='create'||action==='change'?String(schedule):null};
 const {error}=await db.rpc('check_routine_change',row);
 if(error) return {state:error.message==='routineNotAllowed'?'notAllowed':error.message==='routineInvalid'?'invalid':'failed'};
 const call=driver[action]||drivers[action];
 const apply=()=>action==='create'?call(at,{name:title,prompt:String(prompt),schedule:String(schedule),timezone:zone})
  :action==='change'?call(at,{id:routine,schedule:String(schedule),timezone:zone})
  :call(at,{id:routine});
 // Good morning (#182) is moved with the main Agent under the Company's lease: a change to it here takes the same lease,
 // so a move cannot read it, then undo a switch-off made between its steps. Under the lease the job is read again (a
 // move may have taken it to another Agent meanwhile) and the change made only while the lease is still this one's.
 const answer=marked?await withMorningLease(db,company,async fence=>{
  if(action!=='create') {
   const again=await (driver.read||drivers.read)(at);
   if(again.state!=='found') return {state:again.state};
   if(!again.routines.some(each=>each.id===routine)) return {state:'missing'};
  }
  // Only the main Agent's copy is the daily message: one left paused on another Agent (a move that could not delete it)
  // is never switched on, run or made again there; it can still be paused, changed or deleted.
  if(['resume','run','create'].includes(action)) {
   const rows=await shownAgents(db,company);
   if(!rows) return {state:'failed'};
   if(rows.find(row=>row.main===true)?.agent!==agent) return {state:'invalid'};
  }
  if(!await fence()) return {state:'busy'};
  return apply();
 },leaseWait===undefined?{}:{wait:leaseWait}):await apply();
 if(answer.state!=='done'&&answer.state!=='deleted') return {state:answer.state==='notAllowed'?'notAllowed':answer.state};
 // The Engine holds the change, so it is answered as done whatever the log does: answering it as failed would invite a
 // second create. A row the database could not write is said in the server log and in the answer (`logged: false`).
 // A failed write is tried again; one that still fails is said in the server log and in the answer.
 // The change's own key makes a write tried again after a lost answer one row, never two (log_routine_change).
 const entry={...row,change:randomUUID()};
 let logged=await db.rpc('log_routine_change',entry);
 for(let attempt=1;logged.error&&attempt<logAttempts;attempt++) { await pause(attempt*250); logged=await db.rpc('log_routine_change',entry); }
 if(logged.error) console.error('Routine change not logged:',company,agent,acts[action],logged.error.message||'unknown error');
 return {state:'done',routine:answer.state==='done'?answer.routine:null,logged:!logged.error};
}
