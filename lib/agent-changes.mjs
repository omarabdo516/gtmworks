import { engineOf } from './company-engine.mjs';
import { changeCompanySetting } from './engine-settings.mjs';
import { changeAgentInstructions } from './agent-instructions.mjs';

// An Owner's answer to a proposed change (#19): `db` is the Owner's own session, so every write below is checked for
// that Owner by the database and by #125's writers, exactly as the Owner's own save from Settings is. «Approve» first
// claims the proposal (claim_agent_change), so no other answer lands while the Engine is written; then writes the change
// to the Agent's own Engine profile through the same writer that save uses, which names that profile alone and reads the
// value back; and only once the Engine holds it marks the proposal approved (answer_agent_change). A write the writer
// refused before reaching the Engine gives the claim back (`cannotApply` when it never can as the Agent is now,
// `notApplied` when it may later). Any other outcome may have reached the Engine, so the claim stays: approving again
// finishes it (a repeat write reads as unchanged), and a decline cannot say that nothing changed. «Decline» writes nothing
// to the Engine.
/** @typedef {'approved'|'declined'|'notAllowed'|'notFound'|'answered'|'busy'|'applying'|'reasonLong'|'reasonMissing'|'cannotApply'|'notApplied'|'failed'} ChangeAnswer */

const refusals=/** @type {Record<string,ChangeAnswer>} */({'42501':'notAllowed',P0002:'notFound',agentChangeAnswered:'answered',agentChangeApplying:'applying',agentChangeBusy:'busy',
 agentChangeReasonLong:'reasonLong',agentChangeReasonMissing:'reasonMissing'});
// The writers' answers that only ever come before any Engine write: the change cannot be made to this Agent as it is now
// (on a profile it shares, sub-agents off, a value the setting refuses, text over the Engine's limit), or there is no
// Engine. `notAllowed` and `agentUnknown` are not here: the model's writer can answer them after the Engine saved it.
const refusedBefore=new Set(['unknown','installOnly','profileOnly','invalid','shared','subagentsOff','noDefault','tooLong','notOwn','noEngine']);
/** @param {any} error @returns {{state:ChangeAnswer}} */
const refusalOf=error=>({state:refusals[error.code==='22023'?error.message:error.code]??'failed'});

// A proposal's change, as the writer it goes through: a model, a listed setting and the sub-agent toolset go through
// #125's setting writer for that one Agent; the core instructions through #176's, which keeps the team's rules section.
/** @param {any} db @param {{company:string,proposal:{agent_id:string,change:string,setting:string|null,value:unknown},hermes:any,settingDriver?:object,instructionsDriver?:object}} request */
async function apply(db,{company,proposal,hermes,settingDriver={},instructionsDriver={}}) {
 const agent=proposal.agent_id;
 if(proposal.change==='instructions') {
  if(typeof proposal.value!=='string') return 'invalid';
  return (await changeAgentInstructions(db,{company,agent,instructions:proposal.value,hermes,driver:instructionsDriver})).state;
 }
 const setting=proposal.change==='model'?'model':proposal.change==='toolset'&&proposal.setting==='delegation'?'subagents':proposal.change==='setting'?proposal.setting:null;
 if(!setting) return 'invalid';
 return (await changeCompanySetting(db,{company,agent,setting,value:proposal.value,hermes,driver:settingDriver})).state;
}

/** @param {any} db @param {{company:string,proposal:number,approve:boolean,reason?:string|null,hermes?:any,settingDriver?:object,instructionsDriver?:object}} answer
 * @returns {Promise<{state:ChangeAnswer,applied?:string}>} */
export async function answerChange(db,{company,proposal,approve,reason=null,hermes=engineOf(company),settingDriver={},instructionsDriver={}}) {
 if(!Number.isSafeInteger(proposal)||proposal<1) return {state:'notFound'};
 const {data:owner,error:ownerError}=await db.rpc('is_company_owner',{c:company});
 if(ownerError||owner!==true) return {state:'notAllowed'};
 if(approve) {
  const {data:claim,error}=await db.rpc('claim_agent_change',{c:company,proposal});
  if(error) return refusalOf(error);
  // Answered already, or another Owner's approval is being written now: the Engine is not written twice.
  if(claim?.state==='approved') return {state:'approved'};
  if(claim?.state==='busy') return {state:'busy'};
  if(claim?.state!=='claimed') return {state:claim?.state==='declined'||claim?.state==='refused'?'answered':'failed'};
  const applied=await apply(db,{company,proposal:{agent_id:claim.agent,change:claim.change,setting:claim.setting,value:claim.value},hermes:await hermes,settingDriver,instructionsDriver});
  if(applied!=='written') {
   // A claim taken again may follow an earlier write the Engine never confirmed, so it is never given back.
   if(!refusedBefore.has(applied)||claim.retry) return {state:'notApplied',applied};
   await db.rpc('release_agent_change',{c:company,proposal});
   return {state:applied==='noEngine'?'notApplied':'cannotApply',applied};
  }
 }
 const {data,error}=await db.rpc('answer_agent_change',{c:company,proposal,approve,reason:approve?null:reason});
 if(error) return refusalOf(error);
 return {state:data==='approved'||data==='declined'?data:'failed'};
}
