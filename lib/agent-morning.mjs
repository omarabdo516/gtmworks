import { randomUUID } from 'node:crypto';
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
// The one that is on when there is one (the copy a move or a save made on), else the first in the Engine's order: a read
// and every later save agree on it whatever an extra that would not go left beside it.
const findMorning=routines=>{ const all=marked(routines); return all.find(each=>each.on)??all[0]??null; };
// There is one daily message: a second marked job (two people switching it on at the same moment, each finding none) is
// removed, the first in the Engine's own order kept, which every request agrees on. A delete another request already
// made answers missing, which is fine.
/** @param {(name:string)=>any} call @param {any} at @param {import('./engine.mjs').Routine[]} routines */
async function keepOne(call,at,routines,stuck=[],prefer=null) {
 const all=marked(routines);
 const kept=all.find(each=>each.id===prefer)??findMorning(routines);
 const extra=all.filter(each=>each!==kept);
 // An extra that will not go (an Engine that refused or did not answer) is paused, so it never sends beside the one kept,
 // and put in `stuck`: the caller answers that it failed. `prefer` names the
// copy to keep when there is one (a copy just made from how the message is now), else the first in the Engine's order.
 for(const each of extra) {
  const removed=await call('delete')(at,{id:each.id});
  if(removed.state==='deleted'||removed.state==='missing') continue;
  // Not gone: it is paused so it never sends, and the caller answers failed, as the main Agent holds more than one.
  if(each.on) await call('pause')(at,{id:each.id});
  stuck.push(each.id);
 }
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

// Good morning's changes run one at a time per Company (agent_morning_leases): a save of the switch or the time, and a
// change of the main Agent with the move it makes, each hold the Company's lease from their first read to their last
// write, so neither can run between the other's steps. A lease is waited for a little while (it lasts 60 seconds at
// most, so a holder that stopped cannot keep it); one still held after that answers busy.
const leaseWait=15000;
/** @typedef {(()=>Promise<boolean>)&{holder?:string,reclaim?:()=>Promise<boolean>,profiles?:(adding:string[],settled?:string[])=>Promise<string[]|null>}} Fence */
/** @template T @param {any} db @param {string} company @param {(fence:Fence)=>Promise<T>} work @returns {Promise<T|{state:'busy'|'notAllowed'|'failed'}>} */
export async function withMorningLease(db,company,work,{wait=leaseWait}={}) {
 const holder=randomUUID();
 for(const started=Date.now();;) {
  const {data,error}=await db.rpc('take_morning_lease',{c:company,holder});
  if(error) return {state:error.message==='agentSettingNotAllowed'?'notAllowed':'failed'};
  if(data===true) break;
  if(Date.now()-started>wait) return {state:'busy'};
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 // The fence every write passes first, to the Engine or to the Agents: it renews this holder's lease for another 60
 // seconds and answers false once the lease ran out, taken by another or not (what this holder read may be stale), and
 // the holder stops (leaseLost). A write starts with the whole lease ahead of it, longer than the Engine's longest write
 // (15 seconds, then a read for a lost create), so none is still on its way when another holder starts.
 /** @type {Fence} */
 const fence=async()=>{ const {data,error}=await db.rpc('renew_morning_lease',{c:company,holder}); return !error&&data===true; };
 // The Engine profiles a change of the main Agent must still settle the message on, kept with the lease until a settle
 // left it on the main Agent alone (null when the lease is no longer this holder's).
 fence.holder=holder;
 // Takes the lease again when it ran out and nobody else took it (a cleanup after a lost lease); false when another holds it.
 fence.reclaim=async()=>{ const {data,error}=await db.rpc('take_morning_lease',{c:company,holder}); return !error&&data===true; };
 fence.profiles=async(adding,settled=[])=>{ const {data,error}=await db.rpc('morning_lease_profiles',{c:company,holder,adding,settled}); return error||!Array.isArray(data)?null:data; };
 try { return await work(fence); }
 catch(failure) { if(failure===leaseLost) return {state:'busy'}; throw failure; }
 finally { await db.rpc('drop_morning_lease',{c:company,holder}).then(()=>{},()=>{}); }
}
const leaseLost=Symbol('leaseLost');
const writes=new Set(['create','change','pause','resume','delete']);
// The driver as a run uses it: every write passes the lease's fence first (none outside a lease, as in tests of one step).
/** @param {Partial<typeof drivers>} driver @param {(()=>Promise<boolean>)|null} fence */
// `hold` is a pause sent to stop a copy that must not send (a move that failed), and `drop` the delete of the copy that
// move made itself: they pass no fence, so they are sent also once the lease ran out. Neither ever sends the message.
const caller=(driver,fence)=>name=>{
 if(name==='hold') return driver.pause||drivers.pause;
 if(name==='drop') return driver.delete||drivers.delete;
 const call=driver[name]||drivers[name];
 if(!fence||!writes.has(name)) return call;
 return async(...args)=>{ if(!await fence()) throw leaseLost; return call(...args); };
};
// A schedule as a create takes it: the job's cron expression, or its interval as the Engine writes one ("every 720m").
/** @param {{expr:string|null,minutes:number|null}} schedule */
/** @param {any[]} rows */
const profilesOf=rows=>[...new Set(rows.map(row=>row?.profile).filter(profile=>typeof profile==='string'&&ownProfile.test(profile)))];
const scheduleText=schedule=>schedule.expr??(Number.isInteger(schedule.minutes)&&schedule.minutes>0?`every ${schedule.minutes}m`:null);

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
export async function changeAgentMorning(db,request) {
 const {company,agent,on,time}=request;
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)||typeof on!=='boolean'||typeof time!=='string') return {state:'invalid'};
 return withMorningLease(db,company,fence=>changeOnce(db,{...request,fence}));
}
/** @param {any} db @param {{company:string,agent:any,on:any,time:any,zone?:unknown,hermes?:any,driver?:Partial<typeof drivers>}} request */
async function changeOnce(db,{company,agent,on,time,zone,hermes=engineOf(company),driver={},fence=null}) {
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
 // Profiles an earlier change of the main Agent left to settle (its settle failed) are settled first: the message is
 // on the main Agent alone before this save changes it, and a save that cannot get there changes nothing and fails.
 const pending=fence?.profiles?await fence.profiles([]):[];
 if(!pending) return {state:'busy'};
 if(pending.length) {
  const settled=await settleAgentMorning(db,{company,hermes:engine,driver,fence});
  if(settled.state!=='moved'&&settled.state!=='none') return {state:'failed'};
 }
 const at={...engine,profile:target.profile};
 const call=caller(driver,fence);
 const listed=await call('read')(at);
 if(listed.state!=='found') return {state:listed.state};
 const stuck=[];
 let routine=await keepOne(call,at,listed.routines,stuck);
 const old=logValue(routine);
 // The time is one of the select's clocks, or the job's own schedule left as it is (one changed in a chat).
 const kept=routine&&(time===keep||time===routine.schedule.expr);
 const schedule=kept?null:morningCron(time);
 if(!kept&&!schedule) return {state:'invalid'};
 let failed=null;
 const step=answer=>{ if(answer.state!=='done') { failed=answer.state; return false; } routine=answer.routine; return true; };
 if(!routine) {
  // Made paused and switched on once it is read back: a create the Engine finishes late, after this request gave up on
  // it and the lease went to another, lands paused and never sends.
  if(on&&step(await call('create')(at,{name:morningName,prompt:morningPrompt,schedule:/** @type {string} */(schedule),timezone,paused:true}))) {
   // Another save may have made one at the same moment: read again and keep the one both agree on.
   const again=await call('read')(at);
   if(again.state==='found') routine=await keepOne(call,at,again.routines,stuck,routine?.id)??routine;
   if(routine&&!routine.on) step(await call('resume')(at,{id:routine.id}));
  }
 } else {
  const moved=!schedule||routine.schedule.expr===schedule||step(await call('change')(at,{id:routine.id,schedule,timezone:routine.timezone}));
  if(moved&&on!==routine.on) step(await call(on?'resume':'pause')(at,{id:routine.id}));
 }
 const now=logValue(routine);
 if(now!==old) {
  // Tried again a little later: a row the database did not write leaves the log without the change for good, as a later
  // save finds the Engine already holding it. One that still fails is said, and the save answers that it failed.
  // The change's own key makes a write tried again after a lost answer one row, never two (log_agent_morning).
  const entry={c:company,agent,old_value:old,new_value:now,change:randomUUID()};
  let logged=await db.rpc('log_agent_morning',entry);
  for(let attempt=1;logged.error&&attempt<3;attempt++) { await new Promise(resolve=>setTimeout(resolve,attempt*250)); logged=await db.rpc('log_agent_morning',entry); }
  if(logged.error) { console.error('Good morning change not logged:',company,agent,logged.error.message||'unknown error'); failed??='failed'; }
 }
 // A save holds the Company's lease, so the main Agent does not change under it; this check is the last guard all the
 // same: were the Agent no longer the main one, whatever this save did is settled onto the main Agent (with the Agents
 // it read first, so a removed one is seen) and the save refused, before any other answer.
 const after=await shownAgents(db,company);
 if(after&&after.find(row=>row.agent===agent)?.main!==true) {
  await settleAgentMorning(db,{company,also:agents,hermes:engine,driver,fence});
  return {state:'notMain'};
 }
 if(!failed&&stuck.length) failed='failed';
 if(failed) return {state:failed};
 return {state:'written',morning:{on:routine?.on===true,time:routine?morningTime(routine)??routine.schedule.expr??keep:time}};
}

// Where the daily message lives, settled against the main Agent as the database holds it now (#182). Make it main, the
// main Agent removed (with or without a replacement), and a save that raced either all end here, and overlapping ones
// agree: the message is one job on the current main Agent's own profile, moved there with its time, zone and switch from
// wherever it was, and none is left on another Agent. A copy that will not go, or every copy while the main Agent's
// profile is not its own yet (or there is no main Agent), is paused, so the message never sends from an Agent that is
// not the main one. `also` is company_app_agents as read before a change, so a removed Agent's profile is still looked
// at. States: moved (the main Agent holds it), paused, none (there is no message), failed, noEngine, or the Engine's own.
/** @param {any} db @param {{company:string,also?:any[]|null,hermes?:any,driver?:Partial<typeof drivers>}} request */
async function settleAgentMorning(db,{company,also=null,hermes=engineOf(company),driver={},fence=null}) {
 if(typeof company!=='string'||!uuid.test(company)) return {state:'invalid'};
 const engine=await hermes;
 if(!engine) return {state:'noEngine'};
 // When the main Agent changed again while this settled, it settles once more on the one that is main now (bounded):
 // whichever request ends last leaves the message there.
 let rows=await shownAgents(db,company);
 const {data:keyProfiles}=await db.rpc('company_key_profiles',{c:company});
 // The profiles a settle before this one left to settle (kept with the lease, so a failed settle is finished here even
 // once the Company's own list no longer names a removed Agent's profile), with this change's own.
 const pending=fence?.profiles?await fence.profiles(profilesOf(also??[])):[];
 if(!pending) throw leaseLost;
 const known=[...(Array.isArray(keyProfiles)?keyProfiles:[]),...pending.map(profile=>({profile}))];
 for(let pass=0;pass<3;pass++) {
  if(!rows) return {state:'failed'};
  const settled=await settleOnce(rows,{also,engine,driver,fence,known,mainNow:async()=>(await shownAgents(db,company))?.find(row=>row.main===true)?.profile??null});
  const now=await shownAgents(db,company);
  // A recheck that cannot be read leaves it unknown whether the main Agent moved meanwhile: it is answered as failed.
  if(!now) return {state:'failed'};
  if(now.find(row=>row.main===true)?.agent===rows.find(row=>row.main===true)?.agent) {
   // Settled on the main Agent alone: the profiles it looked at need nothing more.
   if(fence?.profiles&&(settled.state==='moved'||settled.state==='none')&&!await fence.profiles([],settled.profiles)) throw leaseLost;
   return {state:settled.state};
  }
  rows=now;
 }
 return {state:'failed'};
}
/** @param {any[]} rows @param {{also:any[]|null,engine:any,driver:Partial<typeof drivers>}} request */
// A settle whose lease runs out stops before its next write; it first pauses every copy away from the main Agent it read,
// and removes the copy it made and had not confirmed, with requests that pass no fence: the main Agent may already have
// changed (the change is committed before the settle), so the message must not go on sending from the one before.
// The cleanup a settle sends to stop copies that must not send (`hold`, `drop`) runs while this settle holds the lease:
// it renews it, or takes it again when it ran out and nobody took it since. Holding it, no change of the main Agent can
// run between the cleanup's re-read and its requests (manage_hermes_agent_leased needs it). When another holder has it,
// there is no cleanup: that holder's own settle reads every profile and settles them. Under the lease the main Agent is
// read again, and the profile of the one that is main now, when it is not the one this settle read, is left alone.
// Answers the profile to spare, or false when there is to be no cleanup.
/** @param {any} fence @param {(()=>Promise<string|null>)|undefined} mainNow @param {string|null} readMain */
async function cleanupGrant(fence,mainNow,readMain) {
 if(fence&&!await fence()&&!await fence.reclaim?.()) return false;
 const now=mainNow?await mainNow().catch(()=>null):null;
 return now&&now!==readMain?now:null;
}
async function settleOnce(rows,request) {
 const seen={away:[],made:null,main:rows.find(row=>row.main===true)?.profile??null};
 try { return await settleSteps(rows,request,seen); }
 catch(failure) {
  if(failure!==leaseLost) throw failure;
  const call=caller(request.driver,null);
  const answer=async ask=>{ try { return (await ask).state; } catch { return 'failed'; } };
  // The grant is renewed before every request, so the cleanup never outlives its lease.
  const grant=()=>cleanupGrant(request.fence,request.mainNow,seen.main).catch(()=>false);
  for(const {at,profile,routine} of seen.away) {
   const spared=await grant(); if(spared===false) throw failure;
   if(profile!==spared) await answer(call('hold')(at,{id:routine.id}));
  }
  if(seen.made) {
   const spared=await grant(); if(spared===false) throw failure;
   if(seen.made.at.profile!==spared) {
    const gone=await answer(call('drop')(seen.made.at,{id:seen.made.id}));
    if(gone!=='deleted'&&gone!=='missing'&&(await grant())!==false) await answer(call('hold')(seen.made.at,{id:seen.made.id}));
   }
  }
  throw failure;
 }
}
/** @param {any[]} rows @param {any} request @param {{away:any[],made:{at:any,id:string}|null}} seen */
async function settleSteps(rows,{also,engine,driver,fence,known,mainNow},seen) {
 const call=caller(driver,fence);
 const stuck=[];
 const main=rows.find(row=>row.main===true);
 const before=Array.isArray(also)?also:[];
 // Every profile of the Company: the Agents' now and before the change, and every one the Company has had (a removed
 // Agent's profile stays listed in company_key_profiles), so a copy a failed settle left anywhere is reached later.
 const profiles=profilesOf([...rows,...before,...known]);
 const lists=await Promise.all(profiles.map(async profile=>({profile,at:{...engine,profile},listed:await call('read')({...engine,profile})})));
 const read=lists.filter(each=>each.listed.state==='found');
 const failed=lists.find(each=>each.listed.state!=='found');
 const home=ownedBy(main)?read.find(each=>each.profile===main.profile)??null:null;
 const copies=each=>marked(each.listed.routines).map(routine=>({at:each.at,profile:each.profile,routine}));
 const away=read.filter(each=>each!==home).flatMap(copies);
 seen.away=away;
 // Every switched-on copy away from the main Agent is paused (kept, never deleted), and the settle answers failed: the
 // outcome is said, and nothing sends from another Agent.
 // Paused whatever it was read as: Recurring tasks may have switched it on since (a pause of one already paused is a
 // no-op), and one gone meanwhile is fine.
 const holdAway=async()=>{ for(const {at,profile,routine} of away) { const spared=await cleanupGrant(fence,mainNow,seen.main); if(spared===false) { stuck.push('lease'); return; } if(profile===spared) continue; const paused=(await call('hold')(at,{id:routine.id})).state; if(paused!=='done'&&paused!=='missing') stuck.push(routine.id); } };
 // A profile that cannot be read leaves the outcome unknown.
 if(failed||(ownedBy(main)&&!home)) { await holdAway(); return {state:failed?failed.listed.state:'failed'}; }
 const own=home?copies(home):[];
 // Which copy says how the message is now: the one the main Agent before this change held (it is what people last set;
 // of two there, the one that is on, as the page and every save read it),
 // else one that is on (a copy left behind is only ever paused), else the one the main Agent holds already.
 const previous=before.find(row=>row?.main===true)?.profile;
 const fromPrevious=away.filter(each=>each.profile===previous);
 const truth=fromPrevious.find(each=>each.routine.on)??fromPrevious[0]??[...own,...away].find(each=>each.routine.on)??own[0]??away[0]??null;
 let kept=null;
 let unconfirmed=false;
 if(home&&truth) {
  if(own.includes(truth)) kept=await keepOne(call,home.at,home.listed.routines,stuck,truth.routine.id);
  else if(scheduleText(truth.routine.schedule)) {
   // The main Agent's own copy is out of date: it goes (or, when it will not, is paused and passed over), and the one
   // that says how the message is now is brought over and kept.
   for(const {routine} of own) {
    const removed=await call('delete')(home.at,{id:routine.id});
    if(removed.state!=='deleted'&&removed.state!=='missing'&&routine.on&&(await call('pause')(home.at,{id:routine.id})).state!=='done') stuck.push(routine.id);
   }
   // Made paused, as a save makes it, and switched on below once the source is read again.
   const {routine}=truth;
   const made=await call('create')(home.at,{name:routine.name||morningName,prompt:routine.prompt,schedule:/** @type {string} */(scheduleText(routine.schedule)),timezone:routine.timezone,paused:true});
   if(made.state!=='done') unconfirmed=true;
   else {
    seen.made={at:home.at,id:made.routine.id};
    const again=await call('read')(home.at);
    kept=again.state==='found'?await keepOne(call,home.at,again.routines,stuck,made.routine.id)??made.routine:made.routine;
    // A save may have switched it off or retimed it on the old Agent while it was brought over: the copy follows that,
    // and one that cannot follow is not taken as the message.
    const source=await call('read')(truth.at);
    // A source that cannot be read again, or is gone, leaves it unknown how the message is now: not confirmed. The
    // schedule is compared whole, a daily time or an interval.
    const now=source.state==='found'?source.routines.find(each=>each.id===truth.routine.id)??null:null;
    const wanted=now?scheduleText(now.schedule):null;
    // Its words changed in a chat meanwhile: the copy holds the old ones, so the move is not confirmed and the source,
    // with the new words, is kept.
    if(!now||!wanted||now.prompt!==kept.prompt) unconfirmed=true;
    else if(wanted!==scheduleText(kept.schedule)||(now.timezone??null)!==(kept.timezone??null)) { const changed=await call('change')(home.at,{id:kept.id,schedule:wanted,timezone:now.timezone}); if(changed.state==='done'&&scheduleText(changed.routine.schedule)===wanted&&(changed.routine.timezone??null)===(now.timezone??null)) kept=changed.routine; else unconfirmed=true; }
    if(now&&!unconfirmed&&now.on!==kept.on) { const flipped=await call(now.on?'resume':'pause')(home.at,{id:kept.id}); if(flipped.state==='done') kept=flipped.routine; else unconfirmed=true; }
   }
  } else kept=await keepOne(call,home.at,home.listed.routines,stuck);
 }
 // The main Agent does not hold the message as it is: its copy is paused, the source is kept (paused, never deleted) so
 // nothing is lost and nothing sends from another Agent, and the settle answers failed.
 if(unconfirmed) {
  // Removed or paused whatever it was read as: a resume of it that did not answer may still land, and this request, sent
  // after it to the same job, is the last word.
  // It is removed, as it does not say how the message is: the source then stays the one a later settle brings over. One
  // that will not go is paused, also once the lease ran out.
  const spared=kept?await cleanupGrant(fence,mainNow,seen.main):null;
  if(spared===false) stuck.push('lease');
  else if(kept&&home.profile!==spared) {
   const gone=(await call('drop')(home.at,{id:kept.id})).state;
   if(gone!=='deleted'&&gone!=='missing') {
    const again=await cleanupGrant(fence,mainNow,seen.main);
    if(again===false||home.profile===again) stuck.push(again===false?'lease':kept.id);
    else { const held=(await call('hold')(home.at,{id:kept.id})).state; if(held!=='done'&&held!=='missing') stuck.push(kept.id); }
   }
  }
  await holdAway();
  return {state:'failed'};
 }
 // The copy made is confirmed: from here a lost lease leaves it in place.
 seen.made=null;
 // Every copy away from the main Agent goes once the main Agent holds one; one that will not go, or any while the main
 // Agent holds none, is paused.
 let paused=false;
 for(const {at,routine} of away) {
  const gone=kept?(await call('delete')(at,{id:routine.id})).state==='deleted':false;
  if(!gone) { const held=(await call('pause')(at,{id:routine.id})).state; if(held!=='done'&&held!=='missing') stuck.push(routine.id); }
  if(!gone) paused=true;
 }
 if(stuck.length) return {state:'failed'};
 return {state:kept?'moved':paused?'paused':'none',profiles};
}

// The main Agent changed (#182): Make it main, or the main Agent removed with a replacement or with none left. The
// message is settled on the main Agent as it is now; `agents` is company_app_agents as read before the change.
/** @param {any} db @param {{company:string,agents?:any[]|null,hermes?:any,driver?:Partial<typeof drivers>}} request */
export const moveAgentMorning=(db,{company,agents=null,hermes=engineOf(company),driver={},fence=null})=>settleAgentMorning(db,{company,also:agents,hermes,driver,fence});
