import { driveHandovers } from '../lib/handovers.mjs';
import { fakeEngine } from './fake-engine.mjs';

// The Handover tests' stand-in for the database (#477, #478): a small copy of the handover functions as 20270415990000
// and 20270415995000 define them (supabase/tests/handover_chains.sql and handover_stop.sql prove the real ones). A call
// in an asked Agent's Run is kept under the handover it serves, that leg waits until every child ended, then the asked
// Agent answers in its own handover session, and only the top handover's follow-up replies in the chat. Stop ends every
// open handover of the chat, or of one channel message, as stopped and answers each one's Run to stop on its Engine (none
// for a leg with no Run going). Each
// Agent runs on a profile of its own, routed by profile as the install's Hermes is.
export const hermes={address:'http://hermes:8642',key:'test-only-key'};
export const company='10000000-0000-0000-0000-000000000001';
export const team=/** @type {Record<string,{profile:string,job:string}>} */({
 Writer:{profile:'ag-04770000000000000000000000000013',job:'Posts and articles'},
 Ads:{profile:'ag-04770000000000000000000000000012',job:'Meta ads and their numbers'},
 Critic:{profile:'ag-04770000000000000000000000000014',job:'Reviews claims'},
 Lead:{profile:'co-10000000000000000000000000000001',job:'Runs the team'},
});
export const others=(/** @type {string} */ agent)=>Object.entries(team).filter(([name])=>name!==agent).map(([name,{job}])=>({name,job})).sort((a,b)=>a.name.localeCompare(b.name));

/** The handovers of one chat or channel, as the database keeps them, starting with the ones its own Agents made: in a
 * channel each top handover comes from a message of its own (1, 2, ...), in a Conversation all from the chat.
 * @param {'conversation'|'channel'} place @param {...{from:string,to:string,goal:string}} tops */
export function record(place,...tops) {
 const where=place==='conversation'?'c4770000-0000-0000-0000-000000000001':'d4770000-0000-0000-0000-000000000001';
 const fresh={state:'waiting',target_attempts:0,answer_attempts:0,return_attempts:0,target_run:null,answer_run:null,follow_up_run:null,target_outcome:null,follow_up_outcome:null,summary:null,tools:null,stopping_run:null,stop_requested:false};
 /** @type {any[]} */
 const rows=tops.map((top,index)=>({...fresh,id:index+1,parent:null,message:place==='channel'?index+1:null,from:top.from,to:top.to,goal:top.goal,run_id:`run-chat-${index+1}`,call_id:'call-1'}));
 const replies=/** @type {{agent:string,body:string}[]} */([]);
 const pins=/** @type {number[]} */([]);
 const session=(/** @type {string} */ agent)=>`${where}:${agent}`;
 const ok=(/** @type {unknown} */ data)=>({data,error:null});
 const open=(/** @type {any} */ row)=>row.state!=='done'&&row.state!=='failed';
 const unfinished=(/** @type {any} */ row)=>`${row.to} did not finish`;
 /** Every open handover of the place (or of one message) ends as stopped; the Runs it had going come back to be stopped.
  * @param {number|null} message */
 // A leg whose start was sent and its answer lost: only a retry with the same key learns its Run, so Stop marks it.
 const unsure=(/** @type {any} */ row)=>row.state==='waiting'&&row.target_attempts>0||row.state==='handing'&&row.answer_attempts>0||row.state==='returning'&&row.return_attempts>0;
 const end=(/** @type {any} */ row)=>{
  const was=row.state;
  if(['waiting','target','handing','answering'].includes(was)) row.target_outcome='stopped';
  else if(row.parent===null) row.follow_up_outcome='stopped';
  row.state='done';
  const run=was==='target'?{run:row.target_run,profile:team[row.to].profile}:was==='answering'?{run:row.answer_run,profile:team[row.to].profile}
   :was==='follow_up'?{run:row.follow_up_run,profile:team[row.from].profile}:null;
  row.stopping_run=run?.run??null;
  return run??{run:null,profile:null};
 };
 const stop=(/** @type {number|null} */ message)=>rows.filter(row=>open(row)&&(message===null||row.message===message))
  .map(row=>unsure(row)?(row.stop_requested=true,{run:null,profile:null}):end(row));
 // The chat's own Run still open, when a test starts one (its Agent is the first handover's asking Agent).
 const chat=/** @type {{run:string|null,agent:string}} */ ({run:null,agent:tops[0]?.from??'Writer'});
 const service={rpc:async(/** @type {string} */ name,/** @type {any} */ args)=>{
  const row=rows.find(entry=>entry.id===args.h);
  if(name==='handovers_due') return ok(rows.filter(entry=>open(entry)&&entry.id>args.after&&!(entry.state==='handing'&&rows.some(child=>child.parent===entry.id&&open(child)))).map(entry=>({id:entry.id,state:entry.state,conversation:place==='conversation'?where:null,company,
   run:{target:entry.target_run,answering:entry.answer_run,follow_up:entry.follow_up_run}[/** @type {string} */ (entry.state)]??null,
   profile:entry.state==='target'||entry.state==='answering'?team[entry.to].profile:entry.state==='follow_up'?team[entry.from].profile:null,
   attempt:entry.state==='handing'||entry.state==='answering'?entry.answer_attempts:entry.state==='returning'?entry.return_attempts:entry.target_attempts})));
  if(name==='begin_handover') {
   if(row.state==='returning'&&row.parent) { row.state='done'; return ok([]); }
   if(row.state==='waiting') { row.target_attempts+=1;
    return ok([{state:'waiting',attempt:row.target_attempts,company,profile:team[row.to].profile,session:session(row.to),input:`${row.from} asks you: ${row.goal}`,instructions:null,targets:others(row.to)}]); }
   if(row.state==='handing') {
    if(rows.some(child=>child.parent===row.id&&open(child))) return ok([]);
    row.answer_attempts+=1;
    const came=rows.filter(child=>child.parent===row.id).map(child=>child.target_outcome==='completed'?`${child.to} answered: ${child.summary}`:unfinished(child));
    return ok([{state:'handing',attempt:row.answer_attempts,company,profile:team[row.to].profile,session:session(row.to),input:`Answers for ${row.goal}:\n${came.join('\n')}`,instructions:null,targets:null}]);
   }
   if(row.state==='returning') { row.return_attempts+=1;
    return ok([{state:'returning',attempt:row.return_attempts,company,profile:team[row.from].profile,session:place==='conversation'?where:session(row.from),
     input:row.target_outcome==='completed'?`${row.to} reported: ${row.summary}`:unfinished(row),instructions:null,targets:null}]); }
   return ok([]);
  }
  if(name==='pin_handover_tools') { pins.push(row.id); row.tools??=args.spec??''; return ok(row.tools); }
  if(name==='answer_handover') {
   if(row.stop_requested) { end(row); return ok(false); }
   if(args.run===null||args.leg!==row.state) return ok(false);
   if(row.state==='waiting') Object.assign(row,{target_run:args.run,state:'target'});
   else if(row.state==='handing') Object.assign(row,{answer_run:args.run,state:'answering'});
   else Object.assign(row,{follow_up_run:args.run,state:'follow_up'});
   return ok(true);
  }
  if(name==='stop_late_handover_run') { const stopped=!!row&&row.state==='done'&&(row.target_outcome==='stopped'||row.follow_up_outcome==='stopped'); if(stopped) row.stopping_run??=args.run; return ok(stopped); }
  if(name==='handover_runs_stopping') return ok(rows.filter(entry=>entry.stopping_run&&entry.id>args.after).map(entry=>({id:entry.id,run:entry.stopping_run,company,
   profile:team[entry.follow_up_outcome==='stopped'?entry.from:entry.to].profile})));
  if(name==='handover_run_stopped') { const cleared=row?.stopping_run===args.run; if(cleared) row.stopping_run=null; return ok(cleared); }
  if(name==='handover_hand_to_agent') {
   if(row.state!=='target'||row.target_run!==args.run||!row.tools) return ok({state:'refused'});
   const target=Object.keys(team).find(agent=>agent.toLowerCase()===args.agent_name.trim().toLowerCase()&&agent!==row.to);
   if(!target) return ok({state:'ignored'});
   if(!rows.some(child=>child.run_id===args.run&&child.call_id===args.call))
    rows.push({...fresh,id:rows.length+1,parent:row.id,message:row.message,from:row.to,to:target,goal:args.goal,run_id:args.run,call_id:args.call});
   return ok({state:'created',agent:target});
  }
  if(name==='close_handover_target') {
   if(row.state!=='target'||row.target_run!==args.run) return ok(false);
   if(args.run_outcome==='completed'&&rows.some(child=>child.parent===row.id&&child.run_id===args.run)) { row.state='handing'; return ok(true); }
   Object.assign(row,{state:'returning',target_outcome:args.run_outcome,summary:args.words}); return ok(true);
  }
  if(name==='close_handover_answer') {
   if(row.state!=='answering'||row.answer_run!==args.run) return ok(false);
   Object.assign(row,{state:'returning',target_outcome:args.run_outcome,summary:args.answer}); return ok(true);
  }
  if(name==='close_handover_follow_up') {
   if(row.state!=='follow_up'||row.follow_up_run!==args.run) return ok(false);
   if(args.reply) replies.push({agent:row.from,body:args.reply});
   Object.assign(row,{state:'done',follow_up_outcome:args.run_outcome}); return ok(true);
  }
  // The person's side (#478): the Conversation's Stop, and a channel message's.
  if(name==='stop_conversation_handovers') return ok(place==='conversation'&&args.conversation===where?stop(null):[]);
  if(name==='conversation_stop_target') return chat.run?ok([{run:chat.run,profile:team[chat.agent].profile}]):{data:null,error:{code:'P0002',message:'conversationNothingToStop'}};
  if(name==='stop_channel_message') return ok(place==='channel'?stop(args.message):[]);
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 return {rows,replies,pins,service,session,where,chat};
}

/** One fake Engine per Agent, routed by profile, with every start logged in order. `ends` names the runs (by key) the
 * Engine ends otherwise than completed: failed, stopped or lost. `missedStops` is how many stop requests the Engines
 * miss (unreachable at the press) before they take one; `lostStarts` the idempotency keys whose first start is made but
 * its answer lost. @param {Record<string,'failed'|'stopped'|'lost'>} [ends] @param {{missedStops?:number,lostStarts?:string[]}} [options] */
export function engines(ends={},{missedStops=0,lostStarts=[]}={}) {
 let missing=missedStops; const losing=new Set(lostStarts);
 const fakes=Object.fromEntries(Object.keys(team).map(agent=>[agent,fakeEngine()]));
 const started=/** @type {{agent:string,key:string,session:string,input:string,tools:any[]}[]} */([]);
 const stops=/** @type {{agent:string,run:string}[]} */([]);
 const engineFor=(/** @type {any} */ connection)=>{
  const agent=/** @type {string} */ (Object.keys(team).find(name=>team[name].profile===connection.profile));
  const fake=fakes[agent]; const engine=fake.engineFor(connection);
  return {...engine,
   start:async(/** @type {any} */ args)=>{ const run=await engine.start(args); if(!started.some(entry=>entry.key===args.idempotencyKey)) started.push({agent,key:args.idempotencyKey,session:args.conversation,input:typeof args.input==='string'?args.input:'',tools:args.tools??[]});
    if(losing.delete(args.idempotencyKey)) return {state:'unknown'};
    return run; },
   stop:async(/** @type {string} */ id)=>{ stops.push({agent,run:id}); if(missing>0) { missing--; throw new Error('Engine unreachable'); } return engine.stop(id); },
   read:async(/** @type {string} */ id)=>{ const result=await engine.read(id); const run=fake.runs.find(entry=>entry.id===id);
    return run&&ends[run.key]&&result.state==='completed'?{...result,state:ends[run.key],reply:null,toolCalls:[]}:result; }};
 };
 return {fakes,started,stops,engineFor};
}
export const handOn=(/** @type {string} */ agent,/** @type {string} */ goal)=>[{id:`call-${agent}`,name:'hand_to_agent',arguments:{agent,goal}}];
/** The worker's passes, one after another, until every handover of the chain ended (or `until` holds), or the bound is
 * reached. @param {any} service @param {any} engineFor @param {any[]} rows @param {{most?:number,until?:()=>boolean}} [options] */
export const drive=async(service,engineFor,rows,{most=40,until=()=>false}={})=>{
 for(let pass=0;pass<most&&!until()&&rows.some(row=>row.state!=='done'&&row.state!=='failed');pass++) await driveHandovers(service,{hermes,engineFor});
};
