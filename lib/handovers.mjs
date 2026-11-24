import { engineFor as defaultEngine, endOf, startOutcomeNotReached, startOutcomeUnknown } from './engine.mjs';
import { agentInstructionsFor } from './conversation-runs.mjs';
import { engineOf, onProfile } from './company-engine.mjs';
import { handoverToolSpecText, runToolCall } from './agent-tools.mjs';
import { logFallbackMove } from './fallback-model.mjs';

/** @typedef {typeof defaultEngine} EngineFor */
/** @typedef {{id:number,state:'waiting'|'target'|'handing'|'answering'|'returning'|'follow_up',conversation:string,run:string|null,profile:string|null,attempt:number,company?:string|null}} DueHandover */

// #317: an Agent hands a job to another Agent, and gtmworks moves the Runs (decision 0057, which replaced 0043's "only
// the Lead"). A `hand_to_agent` call in the asking Agent's reply is written to agent_handovers when its Run closes
// (lead_hand_to_agent, lib/agent-tools.mjs); this driver then starts the job on the target Agent's own profile (ADR
// 0016), and once it ends, a follow-up Run of the asking Agent in the Conversation's session reports what came of it.
// The Engine itself carries neither the handover nor the target's result: gtmworks's own record is what the chat draws.
// In a channel (#150) the same Runs move, in each Agent's own session of that channel.
//
// #477: the asked Agent may hand on in turn, with no depth limit and no check against an Agent already in the chain.
// Its Run is offered hand_to_agent and no tool that shows the person a card (nobody reads its chat, so its question is
// answered empty and its request to act is denied); its own Engine tools are its own. A call it makes is kept as a child
// of the handover its Run serves (handover_hand_to_agent), in the same chat or channel. Its leg then waits
// (`handing`) until every child has ended, and the asked Agent gets one more Run in its own handover session with what
// came back (`answering`): that reply is its answer, passed up to its parent as a target's answer is. A child has no
// follow-up of its own: its answer goes to the Agent that asked it, and only the top handover's follow-up speaks in the
// chat. The follow-up Run writes the reply and hands nothing on.
// A job command's handover (#358) has no follow-up Run: Lead never judged the job, so the target's words are kept as
// that Agent's own message in the chat and the handover ends there (close_handover_target, answers_person).
const page=500;

/** @param {any} service @param {{hermes?:{address:string,key:string}|null,engineFor?:EngineFor,conversation?:string|null,channel?:string|null}} options
 * @returns {Promise<{started:number,closed:number}>} */
export async function driveHandovers(service,{hermes=null,engineFor=defaultEngine,conversation=null,channel=null}={}) {
 const engines=new Map(); let started=0; let closed=0; let after=0;
 for(;;) {
  const {data:due,error}=await service.rpc('handovers_due',{just_conversation:conversation,just_channel:channel,after});
  if(error) throw error;
  for(const row of /** @type {DueHandover[]} */ (due||[])) {
   // One handover that cannot move is logged and skipped, so it never holds up the others.
   try { if(row.run) closed+=await closeOne(row,service,engines,hermes,engineFor); else started+=await startOne(row,service,hermes,engineFor); }
   catch(failure) { console.error('Handover not moved:',row.id,failure?.message||'unknown error'); }
  }
  if(!due||due.length<page) break;
  after=/** @type {DueHandover} */ (due.at(-1)).id;
 }
 await stopStoppedRuns(service,engines,hermes,engineFor);
 return {started,closed};
}

// #478: a Run Stop ended a Handover on is asked of its Engine on every pass until it ended, and stopped again while it
// still runs, so a stop the Engine missed at the press (unreachable, a timeout) still lands; so is a place's own Run Stop
// found open, until it closed. A Run that ended, whatever
// its end, or whose Agent is gone, has nothing left to stop.
/** @param {any} service @param {Map<string,any>} engines @param {{address:string,key:string}|null} hermes @param {EngineFor} engineFor */
async function stopStoppedRuns(service,engines,hermes,engineFor) {
 for(let after=0;;) {
  const {data:stopping,error}=await service.rpc('handover_runs_stopping',{after});
  if(error) throw error;
  for(const row of /** @type {{id:number,run:string,profile:string|null,company:string}[]} */ (stopping||[])) {
   try {
    const key=`${row.company}:${row.profile}`;
    if(row.profile&&!engines.has(key)) { const connection=onProfile(row.profile,row.company,hermes??await engineOf(row.company)); engines.set(key,connection&&engineFor(connection)); }
    const engine=row.profile?engines.get(key):null;
    if(row.profile&&!engine) continue;
    const result=engine?await engine.read(row.run):{state:'lost'};
    if(result.state==='unreachable') { engines.set(key,null); continue; }
    if(result.state==='running') { await engine.stop(row.run); continue; }
    const {error:uncleared}=await service.rpc('handover_run_stopped',{h:row.id,run:row.run});
    if(uncleared) throw uncleared;
   } catch(failure) { console.error('Stopped handover Run not stopped yet:',row.id,failure?.message||'unknown error'); }
  }
  if(!stopping||stopping.length<page) break;
  after=stopping.at(-1).id;
 }
 // A place's own Run Stop found open (a channel message's, or the chat's own) is stopped again while its Engine says it
 // runs; it leaves the list once its own driver closed it.
 const {data:own,error:unread}=await service.rpc('stopped_runs_open',{});
 if(unread) throw unread;
 for(const row of /** @type {{run:string,profile:string|null,company:string}[]} */ (own||[])) {
  try {
   const key=`${row.company}:${row.profile}`;
   if(!row.profile) continue;
   if(!engines.has(key)) { const connection=onProfile(row.profile,row.company,hermes??await engineOf(row.company)); engines.set(key,connection&&engineFor(connection)); }
   const engine=engines.get(key);
   if(!engine) continue;
   const result=await engine.read(row.run);
   if(result.state==='unreachable') { engines.set(key,null); continue; }
   if(result.state==='running') await engine.stop(row.run);
  } catch(failure) { console.error('Stopped Run not stopped yet:',row.run,failure?.message||'unknown error'); }
 }
}

// Each leg's start has its own idempotency key: the asked Agent's job, its answer once its children ended (#477), and the
// asking Agent's follow-up.
const legKeys=/** @type {Record<string,string>} */({waiting:'target',handing:'answer',returning:'return'});

/** @param {DueHandover} row @param {any} service @param {{address:string,key:string}|null} hermes @param {EngineFor} engineFor */
async function startOne(row,service,hermes,engineFor) {
 const {data:rows,error}=await service.rpc('begin_handover',{h:row.id});
 if(error) throw error;
 const begun=rows?.[0]; if(!begun) return 0;
 const connection=onProfile(begun.profile,begun.company,hermes??await engineOf(begun.company));
 // A start that never reached an Engine (#514), because there is none to send it to or the one there is not running, is
 // no attempt: it is handed back (release_handover_start), so the leg stays due as never started and its next start is a
 // first attempt again, until the Engine answers or the leg's own time limit ends it. No Hermes is no proof the Engine
 // refused, so the leg is never answered as failed for it. Only the attempt that began is handed back.
 const release=async()=>{
  const {error:unreleased}=await service.rpc('release_handover_start',{h:row.id,attempt:begun.attempt,leg:begun.state});
  if(unreleased) throw unreleased;
  return 0;
 };
 if(!connection) return release();
 // An Agent on its own profile has its instructions as that profile's soul (ADR 0016); the Lead's follow-up carries the
 // Conversation's Agent instructions, as every Run on the Company's profile does (lib/conversation-runs.mjs).
 const instructions=[agentInstructionsFor(connection,begun.instructions)].filter(Boolean).join('\n\n');
 const key=legKeys[begun.state]; if(!key) return 0;
 // The asked Agent's job is offered hand_to_agent naming the Company's other Agents (#477), pinned with the handover at
 // its first start, so a retry sends the same text whoever the team became meanwhile. Its answer and the follow-up are
 // offered no gtmworks tool: they write the answer, or the reply.
 // A job command's Agent (#358), and every other leg, is given no list of targets, and offered nothing.
 const tools=begun.state==='waiting'&&Array.isArray(begun.targets)?await pinnedTools(service,row.id,begun.targets):[];
 const run=await engineFor(connection).start({conversation:begun.session,input:begun.input,idempotencyKey:`handover:${row.id}:${key}`,...(instructions?{instructions}:{}),...(tools.length?{tools}:{}),retry:begun.attempt>1});
 if(startOutcomeNotReached(run)) return release();
 if(startOutcomeUnknown(run)) return 0;
 // The leg `begin_handover` claimed, and its attempt, come back with the start: the answer names both, so a Run id that
 // arrives after another leg was claimed records nothing (#354).
 const {data:recorded,error:unrecorded}=await service.rpc('answer_handover',{h:row.id,attempt:begun.attempt,leg:begun.state,run});
 if(unrecorded) throw unrecorded;
 // #478: the person pressed Stop while this start was on its way, so the handover ended as stopped before its Run id was
 // kept. The Run it started is kept as the one to stop, and stopped here, as Stop stopped the chain's other Runs.
 if(!recorded&&typeof run==='string') {
  const {data:kept,error:unkept}=await service.rpc('stop_late_handover_run',{h:row.id,run});
  if(unkept) throw unkept;
  // Kept to stop, so a stop the Engine misses now is asked again on the next pass.
  if(kept===true) await engineFor(connection).stop(run);
 }
 return recorded&&run?1:0;
}

/** The tools pinned with a handover's asked Agent, pinning them first when none are. @param {any} service @param {number} h
 * @param {unknown[]} targets @returns {Promise<import('./engine.mjs').ToolSpec[]>} */
async function pinnedTools(service,h,targets) {
 const {data:pinned,error}=await service.rpc('pin_handover_tools',{h,spec:handoverToolSpecText(targets)});
 if(error) throw error;
 return typeof pinned==='string'&&pinned?[JSON.parse(pinned)]:[];
}

/** @param {DueHandover} row @param {any} service @param {Map<string,any>} engines @param {{address:string,key:string}|null} hermes @param {EngineFor} engineFor */
async function closeOne(row,service,engines,hermes,engineFor) {
 // An Agent removed since its Run started can never answer: the job is lost, and the Agent that asked still hears of it.
 if(!row.profile) return row.state==='target'?closeTarget(service,row,'lost',null):row.state==='answering'?closeAnswer(service,row,'lost',null):closeFollowUp(service,row,'lost',null);
 const key=`${row.company}:${row.profile}`;
 if(!engines.has(key)) { const connection=onProfile(row.profile,row.company,hermes??await engineOf(row.company)); engines.set(key,connection&&engineFor(connection)); }
 const engine=engines.get(key);
 if(!engine) return 0;
 const result=await engine.read(/** @type {string} */ (row.run));
 // One unreachable Engine is not asked again in this pass, and its Run stays where it is.
 if(result.state==='unreachable') { engines.set(key,null); return 0; }
 // Nobody can answer the Target's question or allow its action: an empty answer is no answer, and a denial is no yes.
 if(result.question) await engine.answer(/** @type {string} */ (row.run),result.question.id,'');
 if(result.permission) await engine.permit(/** @type {string} */ (row.run),result.permission.id,'deny');
 // A leg that failed for a cause a retry cannot fix keeps that cause (no_model #428, no_credit, key_refused or
 // model_missing #530): the chat or the channel says what to fix, as a Conversation's own reply does (#422, #457).
 const ended=endOf(result);
 if(!ended) return 0;
 // A leg the Company's Fallback model answered is logged in Activity once (#644).
 await logFallbackMove(service,{company:row.company,run:/** @type {string} */ (row.run),result,engine});
 if(row.state==='target') {
  // #477: each job the asked Agent handed on is kept under this handover before its leg closes, so the leg waits for
  // them. A call is kept once per run and call, so a pass that closes nothing keeps nothing twice. A Run that wrote only
  // its calls completed all the same (the Engine takes the call blocks out of its reply), as a chat's Run does.
  let handedOn=false;
  if(result.state==='completed') for(const call of result.toolCalls) {
   if(call.name!=='hand_to_agent') continue;
   const done=await runToolCall({db:service,engine,profile:row.profile,handover:{id:row.id},run:/** @type {string} */ (row.run)},call);
   if(done.state==='created') handedOn=true;
   else if(done.state!=='ignored') console.error('Handover call not kept:',row.id,call.id,done.state);
  }
  const outcome=handedOn?'completed':ended;
  // The Target's words are Lead's input for the follow-up, and the record of what came of the job. A command's reply is
  // the person's message in the chat, which holds far more than a summary (#358), so the whole reply goes and only the
  // database cuts the summary to its own length. Postgres cannot store a NUL character.
  const words=outcome==='completed'&&result.reply?.replaceAll('\u0000','').trim()?result.reply.replaceAll('\u0000',''):null;
  return closeTarget(service,row,outcome,words);
 }
 // The asked Agent's answer once its children ended (#477): passed up as its leg's answer.
 const words=ended==='completed'&&result.reply?result.reply.replaceAll('\u0000',''):null;
 if(row.state==='answering') return closeAnswer(service,row,ended,words);
 return closeFollowUp(service,row,ended,words);
}

/** @param {any} service @param {DueHandover} row @param {import('./engine.mjs').RunEnd} outcome @param {string|null} summary */
async function closeTarget(service,row,outcome,summary) {
 const {data:saved,error}=await service.rpc('close_handover_target',{h:row.id,run:row.run,run_outcome:outcome,words:summary});
 if(error) throw error;
 return saved?1:0;
}

/** @param {any} service @param {DueHandover} row @param {import('./engine.mjs').RunEnd} outcome @param {string|null} answer */
async function closeAnswer(service,row,outcome,answer) {
 const {data:saved,error}=await service.rpc('close_handover_answer',{h:row.id,run:row.run,run_outcome:outcome,answer});
 if(error) throw error;
 return saved?1:0;
}

/** @param {any} service @param {DueHandover} row @param {import('./engine.mjs').RunEnd} outcome @param {string|null} reply */
async function closeFollowUp(service,row,outcome,reply) {
 const {data:saved,error}=await service.rpc('close_handover_follow_up',{h:row.id,run:row.run,run_outcome:outcome,reply});
 if(error) throw error;
 return saved?1:0;
}
