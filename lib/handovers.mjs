import { engineFor as defaultEngine, outcomeOf, startOutcomeNotReached, startOutcomeUnknown } from './engine.mjs';
import { agentInstructionsFor } from './conversation-runs.mjs';
import { engineOf, onProfile } from './company-engine.mjs';

/** @typedef {typeof defaultEngine} EngineFor */
/** @typedef {{id:number,state:'waiting'|'target'|'returning'|'follow_up',conversation:string,run:string|null,profile:string|null,attempt:number,company?:string|null}} DueHandover */

// #317: Lead hands a job to another Agent, and gtmworks moves the two Runs (decision 0043: only the Lead hands work
// over). A `hand_to_agent` call in Lead's reply is written to agent_handovers when Lead's Run closes
// (lead_hand_to_agent, lib/agent-tools.mjs); this driver then starts the job on the target Agent's own profile (ADR
// 0016), and once it ends, a follow-up Lead Run in the same Conversation session reports what came of it. The Engine
// itself carries neither the handover nor the target's result: gtmworks's own record is what the chat draws. In a
// channel (#150) the same two Runs move, in each Agent's own session of that channel, and the channel's record draws the
// row, the target's answer and Lead's reply.
//
// The Target's Run is offered no gtmworks tools, and nobody reads its chat, so its question is answered empty and its
// request to act is denied, as a channel's or a note's Run is. The follow-up Run writes the reply and hands nothing on:
// a chain of handovers is no part of this ticket. Nothing is sent to the person by the Target.
// A job command's handover (#358) has no follow-up Lead Run: Lead never judged the job, so the target's words are kept
// as that Agent's own message in the chat and the handover ends there (close_handover_target, answers_person).
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
  if(!due||due.length<page) return {started,closed};
  after=/** @type {DueHandover} */ (due.at(-1)).id;
 }
}

/** @param {DueHandover} row @param {any} service @param {{address:string,key:string}|null} hermes @param {EngineFor} engineFor */
async function startOne(row,service,hermes,engineFor) {
 const {data:rows,error}=await service.rpc('begin_handover',{h:row.id});
 if(error) throw error;
 const begun=rows?.[0]; if(!begun) return 0;
 const connection=onProfile(begun.profile,begun.company,hermes??await engineOf(begun.company));
 // No Hermes to reach is no proof the Engine refused: the handover stays as it is and the next pass asks again.
 if(!connection) return 0;
 // An Agent on its own profile has its instructions as that profile's soul (ADR 0016); the Lead's follow-up carries the
 // Conversation's Agent instructions, as every Run on the Company's profile does (lib/conversation-runs.mjs).
 const instructions=[agentInstructionsFor(connection,begun.instructions)].filter(Boolean).join('\n\n');
 const started=await engineFor(connection).start({conversation:begun.session,input:begun.input,idempotencyKey:`handover:${row.id}:${begun.state==='waiting'?'target':'return'}`,...(instructions?{instructions}:{}),retry:begun.attempt>1});
 // A handover's start that never reached its Engine is still read as a refusal of its first attempt, as before #413 (#514).
 const run=startOutcomeNotReached(started)?null:started;
 if(startOutcomeUnknown(run)) return 0;
 // The leg `begin_handover` claimed, and its attempt, come back with the start: the answer names both, so a Run id that
 // arrives after another leg was claimed records nothing (#354).
 const {data:recorded,error:unrecorded}=await service.rpc('answer_handover',{h:row.id,attempt:begun.attempt,leg:begun.state,run});
 if(unrecorded) throw unrecorded;
 return recorded&&run?1:0;
}

/** @param {DueHandover} row @param {any} service @param {Map<string,any>} engines @param {{address:string,key:string}|null} hermes @param {EngineFor} engineFor */
async function closeOne(row,service,engines,hermes,engineFor) {
 // An Agent removed since its Run started can never answer: the job is lost, and Lead still hears of it.
 if(!row.profile) return row.state==='target'?closeTarget(service,row,'lost',null):closeFollowUp(service,row,'lost',null);
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
 const outcome=outcomeOf(result);
 if(!outcome) return 0;
 if(row.state==='target') {
  // The Target's words are Lead's input for the follow-up, and the record of what came of the job. A command's reply is
  // the person's message in the chat, which holds far more than a summary (#358), so the whole reply goes and only the
  // database cuts the summary to its own length. Postgres cannot store a NUL character.
  const words=outcome==='completed'&&result.reply?result.reply.replaceAll('\u0000',''):null;
  return closeTarget(service,row,outcome,words);
 }
 const reply=outcome==='completed'&&result.reply?result.reply.replaceAll('\u0000',''):null;
 return closeFollowUp(service,row,outcome,reply);
}

/** @param {any} service @param {DueHandover} row @param {'completed'|'failed'|'stopped'|'lost'} outcome @param {string|null} summary */
async function closeTarget(service,row,outcome,summary) {
 const {data:saved,error}=await service.rpc('close_handover_target',{h:row.id,run:row.run,run_outcome:outcome,words:summary});
 if(error) throw error;
 return saved?1:0;
}

/** @param {any} service @param {DueHandover} row @param {'completed'|'failed'|'stopped'|'lost'} outcome @param {string|null} reply */
async function closeFollowUp(service,row,outcome,reply) {
 const {data:saved,error}=await service.rpc('close_handover_follow_up',{h:row.id,run:row.run,run_outcome:outcome,reply});
 if(error) throw error;
 return saved?1:0;
}
