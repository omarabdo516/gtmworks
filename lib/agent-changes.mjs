import { engineOf } from './company-engine.mjs';
import { changeCompanySetting, engineSettings, readAgentSettings, readCompanyModels } from './engine-settings.mjs';
import { changeAgentInstructions, readAgentInstructions } from './agent-instructions.mjs';

// An Owner's answer to a proposed change (#19): `db` is the Owner's own session, so every write below is checked for
// that Owner by the database and by #125's writers, exactly as the Owner's own save from Settings is. «Approve» first
// claims the proposal (claim_agent_change) under a lease, so no other answer lands while that lease holds (the windows
// Hermes leaves open past it are named in the migration, 20270415000000); then writes the change
// to the Agent's own Engine profile through the same writer that save uses, which names that profile alone and reads the
// value back; and only once the Engine holds it marks the proposal approved (answer_agent_change). A write the writer
// refused before reaching the Engine gives the claim back (`cannotApply` when it never can as the Agent is now,
// `notApplied` when it may later). Any other outcome may have reached the Engine, so the proposal stays applying with its
// lease ended: approving again finishes it (a repeat write reads as unchanged), and a decline says the earlier approval
// may already be in the Agent's settings. «Decline» writes nothing
// to the Engine.
// «Edit, then approve» (#484) sends the Owner's value with the claim (`edited`): the database checks it as it checks a
// proposed value and answers it as the value to write, so the writer below writes what the Owner approved.
/** @typedef {'approved'|'declined'|'notAllowed'|'notFound'|'answered'|'busy'|'applying'|'reasonLong'|'reasonMissing'|'editInvalid'|'cannotApply'|'notApplied'|'writtenLate'|'failed'} ChangeAnswer */

const refusals=/** @type {Record<string,ChangeAnswer>} */({'42501':'notAllowed',P0002:'notFound',agentChangeAnswered:'answered',agentChangeApplying:'applying',agentChangeBusy:'busy',
 agentChangeReasonLong:'reasonLong',agentChangeReasonMissing:'reasonMissing',agentChangeEditInvalid:'editInvalid'});
// The writers' answers that only ever come before any Engine write: the change cannot be made to this Agent as it is now
// (on a profile it shares, sub-agents off, a value the setting refuses, text over the Engine's limit), or there is no
// Engine. `notAllowed` and `agentUnknown` are not here: the model's writer can answer them after the Engine saved it.
const refusedBefore=new Set(['unknown','installOnly','profileOnly','invalid','shared','subagentsOff','noDefault','tooLong','notOwn','noEngine']);
/** @param {any} error @returns {{state:ChangeAnswer}} */
const refusalOf=error=>({state:refusals[error.code==='22023'?error.message:error.code]??'failed'});

// A proposal's change, as the writer it goes through: a model, a listed setting and the sub-agent toolset go through
// #125's setting writer for that one Agent; the core instructions through #176's, which keeps the team's rules section.
// `ready` renews the claim right before the write: a setting waits its turn behind the Company's other setting writes
// (#436), so it is renewed once that turn has come, never before the wait. Anything but true writes nothing (`claimLost`).
/** @param {any} db @param {{company:string,proposal:{agent_id:string,change:string,setting:string|null,value:unknown},hermes:any,ready:()=>Promise<boolean>,settingDriver?:object,instructionsDriver?:object}} request */
async function apply(db,{company,proposal,hermes,ready,settingDriver={},instructionsDriver={}}) {
 const agent=proposal.agent_id;
 if(proposal.change==='instructions') {
  if(typeof proposal.value!=='string') return 'invalid';
  if(await ready()!==true) return 'claimLost';
  return (await changeAgentInstructions(db,{company,agent,instructions:proposal.value,hermes,driver:instructionsDriver})).state;
 }
 const setting=proposal.change==='model'?'model':proposal.change==='toolset'&&proposal.setting==='delegation'?'subagents':proposal.change==='setting'?proposal.setting:null;
 if(!setting) return 'invalid';
 return (await changeCompanySetting(db,{company,agent,setting,value:proposal.value,hermes,driver:settingDriver,ready})).state;
}

/** @param {any} db @param {{company:string,proposal:number,approve:boolean,reason?:string|null,edited?:unknown,hermes?:any,settingDriver?:object,instructionsDriver?:object}} answer
 * @returns {Promise<{state:ChangeAnswer,applied?:string}>} */
export async function answerChange(db,{company,proposal,approve,reason=null,edited,hermes=engineOf(company),settingDriver={},instructionsDriver={}}) {
 if(!Number.isSafeInteger(proposal)||proposal<1) return {state:'notFound'};
 const {data:owner,error:ownerError}=await db.rpc('is_company_owner',{c:company});
 if(ownerError||owner!==true) return {state:'notAllowed'};
 /** @type {string|null} */
 let claimed=null;
 if(approve) {
  const {data:claim,error}=await db.rpc('claim_agent_change',edited===undefined?{c:company,proposal}:{c:company,proposal,edited});
  claimed=typeof claim?.token==='string'?claim.token:null;
  if(error) return refusalOf(error);
  // Answered already, or another Owner's approval is being written now: the Engine is not written twice.
  if(claim?.state==='approved') return {state:'approved'};
  if(claim?.state==='busy') return {state:'busy'};
  if(claim?.state!=='claimed') return {state:claim?.state==='declined'||claim?.state==='refused'?'answered':'failed'};
  // The lease is renewed right before the Engine is written, once this write's turn has come: a claim lost meanwhile
  // (another Owner took over a lease that ran out, or declined it) writes nothing.
  /** @type {{state:ChangeAnswer}|null} */
  let lost=null;
  const ready=async()=>{
   const {data:held,error:renewError}=await db.rpc('renew_agent_change',{c:company,proposal,claim:claim.token});
   if(renewError) lost=refusalOf(renewError);
   else if(held!==true) lost={state:'busy'};
   return !lost;
  };
  const applied=await apply(db,{company,proposal:{agent_id:claim.agent,change:claim.change,setting:claim.setting,value:claim.value},hermes:await hermes,ready,settingDriver,instructionsDriver});
  // Nothing was written: the claim is no longer this request's, so it is neither released nor answered from here.
  if(lost) return lost;
  if(applied!=='written') {
   // A claim taken again may follow an earlier write the Engine never confirmed, so it is never given back.
   if(!refusedBefore.has(applied)||claim.retry) {
    // The write may have reached the Engine: the proposal stays applying, with this lease ended so the Owner can approve
    // again at once.
    await db.rpc('release_agent_change',{c:company,proposal,claim:claim.token,uncertain:true});
    return {state:'notApplied',applied};
   }
   await db.rpc('release_agent_change',{c:company,proposal,claim:claim.token});
   return {state:applied==='noEngine'?'notApplied':'cannotApply',applied};
  }
 }
 const {data,error}=await db.rpc('answer_agent_change',{c:company,proposal,approve,reason:approve?null:reason,claim:approve?claimed:null});
 // The Engine holds the change, but the proposal was answered meanwhile: this approval stalled past its lease (or a write it
 // lost track of landed late) and another Owner declined it. Hermes has no compare-and-set on a profile's settings, so the
 // write cannot be undone from here; such a decline is always recorded as maybe applied, and the Owner who wrote it is told.
 if(error&&approve&&['agentChangeAnswered','agentChangeBusy'].includes(error.message)) return {state:'writtenLate'};
 if(error) return refusalOf(error);
 return {state:data==='approved'||data==='declined'?data:'failed'};
}

// What a proposal's card reads when it is drawn (#484; design-reference: chgHTML's "Now" row and chg-edit): the value the
// Agent has now, read from that Agent's own Engine profile by the readers Settings uses, and — for an Owner — the field
// to edit the proposed value in before approving: the models the profile's Engine lists (`model`), the instructions with
// the Engine's limit (`instructions`), the sub-agents switch (`switch`), or the listed setting's own type, choices and
// limits (`setting`). `db` is the reader's own session, so the database decides who reads the proposal at all. Only a
// waiting proposal has a "Now": once answered, the value before it is gone. An Engine that cannot be read answers no
// value and no field, so the card is drawn as it was.
/** @typedef {{provider:string,providerName:string,model:string}} ModelOption */
/** @typedef {{kind:'model',options:ModelOption[]}|{kind:'instructions',limit:number}|{kind:'switch'}|{kind:'setting',type:'string'|'number'|'boolean'|'select',choices:string[]|null,limits:{min?:number,max?:number,integer?:boolean}|null,default:unknown}} ChangeField */
/** @param {any} db @param {{company:string,proposal:number,hermes?:any,settingDriver?:object,instructionsDriver?:object}} request
 * @returns {Promise<{state:'found',now:unknown,edit:ChangeField|null,approved?:unknown}|{state:'answered'|'notFound'}>} */
const proposableInstructions=20000;
export async function readChangeContext(db,{company,proposal,hermes=engineOf(company),settingDriver={},instructionsDriver={}}) {
 if(!Number.isSafeInteger(proposal)||proposal<1) return {state:'notFound'};
 const {data:row,error}=await db.from('agent_change_proposals').select('id,agent_id,change,setting,state,approved_value').eq('company_id',company).eq('id',proposal).maybeSingle();
 if(error||!row) return {state:'notFound'};
 if(row.state!=='waiting'&&row.state!=='applying') return {state:'answered'};
 const [{data:isOwner},engine]=await Promise.all([db.rpc('is_company_owner',{c:company}),hermes]);
 const agent=row.agent_id;
 // An approval whose Engine write was never confirmed (still applying) is finished, never edited again: approving it
 // again writes the value it was writing (claim_agent_change), so the card shows that value and offers no field.
 const retrying=row.state==='applying';
 const owner=isOwner===true&&!retrying;
 /** @param {{now:unknown,edit:ChangeField|null}} read */
 const finish=read=>({state:/** @type {const} */('found'),...read,...(retrying&&row.approved_value!==null&&row.approved_value!==undefined?{approved:row.approved_value}:{})});
 const none=finish({now:null,edit:null});
 if(!engine) return none;
 if(row.change==='instructions') {
  const read=await readAgentInstructions(db,{company,agent,hermes:engine,driver:instructionsDriver});
  if(read?.state!=='found') return none;
  // The edit is checked as a proposal is (agent_change_value_valid: at most 20,000 characters), so the field never takes
  // more than that, even where the Engine's own limit is higher.
  // The team's rules section stays in the file beside them, so the field takes only what is left of the Engine's limit.
  return finish({now:read.instructions.trim(),edit:owner&&read.own?{kind:'instructions',limit:Math.max(0,Math.min(read.limit-read.sectionChars,proposableInstructions))}:null});
 }
 const models=async()=>(await readCompanyModels(db,{company,agent,owner,hermes:engine,driver:settingDriver})).models?.agents?.[0]??null;
 if(row.change==='model') {
  const read=await models();
  if(!read) return none;
  return finish({now:read.model,edit:owner&&read.choosable&&read.options.length?{kind:'model',options:read.options}:null});
 }
 if(row.change==='toolset'&&row.setting==='delegation') {
  const read=await models();
  if(!read) return none;
  return finish({now:read.subagents,edit:owner&&read.choosable?{kind:'switch'}:null});
 }
 const entry=row.change==='setting'?engineSettings.find(found=>found.key===row.setting):undefined;
 if(!entry) return none;
 // The sub-agents' model and provider are chosen from the models the profile's Engine lists, as Settings draws them. A
 // model is written alone (delegation.model), so it is chosen among the models of the provider the sub-agents run on:
 // their own (delegation.provider), else the Agent's; a model of another provider would make a pair the Engine can't run.
 const delegated=entry.key==='delegation.model'||entry.key==='delegation.provider';
 const providerEntry=engineSettings.find(found=>found.key==='delegation.provider');
 const [read,choices]=await Promise.all([readAgentSettings(db,{company,agent,hermes:engine,driver:settingDriver,list:entry.key==='delegation.model'&&providerEntry?[entry,providerEntry]:[entry]}),
  owner&&delegated?models():null]);
 const held=read.agents?.[0]?.settings??[];
 const setting=held.find(found=>found.key===entry.key);
 if(!setting) return none;
 const ownProvider=held.find(found=>found.key==='delegation.provider')?.value;
 const runsOn=typeof ownProvider==='string'&&ownProvider?ownProvider:typeof choices?.model==='string'?choices.model.split('/')[0]:'';
 const offered=entry.key==='delegation.model'?(choices?.options??[]).filter(option=>option.provider===runsOn):choices?.options??[];
 const listed=offered.length?[...new Set(offered.map(option=>entry.key==='delegation.model'?option.model:option.provider))]:null;
 return finish({now:setting.value,edit:owner?{kind:'setting',type:listed?'select':setting.type,choices:listed??setting.choices,
  limits:setting.limits&&Object.fromEntries(['min','max','integer'].flatMap(key=>setting.limits[key]===undefined?[]:[[key,setting.limits[key]]])),default:setting.default}:null});
}
