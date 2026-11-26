import { companyEngine } from './engine/handle.mjs';
import { engineReady } from './agent-tools.mjs';

// `db` is the Owner's own session, so answer_agent_request checks the Owner. «Make it» needs the Engine to have the
// Company's profile ready first (ADR 0014), reached with the install's key (#342).
/** @typedef {'made'|'declined'|'engineNotReady'|'engineUnreachable'|'notAllowed'|'notFound'|'answered'|'reasonMissing'|'notMade'|'failed'} RequestAnswer */

const refusals=/** @type {Record<string,RequestAnswer>} */({'42501':'notAllowed',P0002:'notFound','55000':'notMade',agentRequestAnswered:'answered',agentRequestReasonMissing:'reasonMissing'});

/** @param {any} db @param {string} company */
async function profileReady(db,company) {
 const engine=await companyEngine(company,{reader:db});
 const own=engine?.profile?engine.on(engine.profile):null;
 return own?engineReady(own.runs,own.profile):'engineNotReady';
}

/** @param {any} db @param {{company:string,request:number,make:boolean,reason?:string|null}} answer @returns {Promise<RequestAnswer>} */
export async function answerRequest(db,{company,request,make,reason=null}) {
 if(make) {
  const ready=await profileReady(db,company);
  if(ready!=='ready') return ready;
 }
 const {data,error}=await db.rpc('answer_agent_request',{c:company,request,make,reason:make?null:reason});
 if(error) return refusals[error.code==='22023'?error.message:error.code]??'failed';
 return data==='made'||data==='declined'?data:'failed';
}
