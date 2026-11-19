import { signInTarget } from './company-sign-in.mjs';
import { engineOf } from './bundled-hermes.mjs';
import { engineFor as defaultEngine } from './engine.mjs';
import { engineReady } from './agent-tools.mjs';

// `db` is the Owner's own session, so answer_agent_request checks the Owner. «Make it» needs the Engine to have the
// Company's profile ready first (ADR 0014), reached with the install's key (#342).
/** @typedef {'made'|'declined'|'engineNotReady'|'engineUnreachable'|'notAllowed'|'notFound'|'answered'|'reasonMissing'|'notMade'|'failed'} RequestAnswer */

const refusals=/** @type {Record<string,RequestAnswer>} */({'42501':'notAllowed',P0002:'notFound','55000':'notMade',agentRequestAnswered:'answered',agentRequestReasonMissing:'reasonMissing'});

/** @param {any} db @param {string} company @param {{address:string,key:string}|null} hermes @param {typeof defaultEngine} engineFor */
async function companyEngine(db,company,hermes,engineFor) {
 const target=await signInTarget(db,company,hermes);
 return target?engineReady(engineFor({address:target.address,profile:target.profile,key:target.key}),target.profile):'engineNotReady';
}

/** @param {any} db @param {{company:string,request:number,make:boolean,reason?:string|null,hermes?:{address:string,key:string}|null,engineFor?:typeof defaultEngine}} answer @returns {Promise<RequestAnswer>} */
export async function answerRequest(db,{company,request,make,reason=null,hermes=engineOf(company),engineFor=defaultEngine}) {
 if(make) {
  const ready=await companyEngine(db,company,hermes,engineFor);
  if(ready!=='ready') return ready;
 }
 const {data,error}=await db.rpc('answer_agent_request',{c:company,request,make,reason:make?null:reason});
 if(error) return refusals[error.code==='22023'?error.message:error.code]??'failed';
 return data==='made'||data==='declined'?data:'failed';
}
