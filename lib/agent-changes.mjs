import { engineOf } from './company-engine.mjs';
import { changeCompanySetting } from './engine-settings.mjs';
import { changeAgentInstructions } from './agent-instructions.mjs';

// An Owner's answer to a proposed change (#19): `db` is the Owner's own session, so every write below is checked for
// that Owner by the database and by #125's writers, exactly as the Owner's own save from Settings is. «Approve» writes the
// change to the Agent's own Engine profile through the same writer that save uses, which names that profile alone and
// reads the value back; only once the Engine holds it is the proposal marked approved (answer_agent_change). A write the
// Engine refused, or one that could not be read back, leaves the proposal waiting, so the Owner can try again. «Decline»
// writes nothing to the Engine.
/** @typedef {'approved'|'declined'|'notAllowed'|'notFound'|'answered'|'reasonLong'|'notApplied'|'failed'} ChangeAnswer */

const refusals=/** @type {Record<string,ChangeAnswer>} */({'42501':'notAllowed',P0002:'notFound',agentChangeAnswered:'answered',agentChangeReasonLong:'reasonLong'});

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
  const {data:row,error}=await db.from('agent_change_proposals').select('id,agent_id,change,setting,value,state').eq('company_id',company).eq('id',proposal).maybeSingle();
  if(error) return {state:'failed'};
  if(!row) return {state:'notFound'};
  // A proposal already answered is answered by the database alone: the change is never written twice.
  if(row.state==='waiting') {
   const applied=await apply(db,{company,proposal:row,hermes:await hermes,settingDriver,instructionsDriver});
   if(applied!=='written') return {state:'notApplied',applied};
  }
 }
 const {data,error}=await db.rpc('answer_agent_change',{c:company,proposal,approve,reason:approve?null:reason});
 if(error) return {state:refusals[error.code==='22023'?error.message:error.code]??'failed'};
 return {state:data==='approved'||data==='declined'?data:'failed'};
}
