import { savedConnectionKey } from './connection-key.mjs';
import { engineFor as defaultEngine } from './engine.mjs';
import { engineReady } from './agent-tools.mjs';

// An Owner answers a Member's request for an Agent (#17) from "Waiting on you". `db` is the Owner's own session: the
// database checks they are an active Owner and answers once (answer_agent_request). «Make it» makes the Agent on the
// Company's own profile, as an Owner's create_agent does, so the Engine must have that profile ready first; the
// service role only reads the key of the Company's bundled Connection, by its id and the Company (ADR 0008). «No» asks
// no Engine. The answer is one state; a refusal leaves the request as it was.
/** @typedef {'made'|'declined'|'engineNotReady'|'engineUnreachable'|'notAllowed'|'notFound'|'answered'|'reasonMissing'|'notMade'|'failed'} RequestAnswer */

const refusals=/** @type {Record<string,RequestAnswer>} */({'42501':'notAllowed',P0002:'notFound','55000':'notMade',agentRequestAnswered:'answered',agentRequestReasonMissing:'reasonMissing'});

/** @param {any} db @param {any} service @param {string} company @param {string|undefined} encryptionKey @param {typeof defaultEngine} engineFor */
async function companyEngine(db,service,company,encryptionKey,engineFor) {
 const {data,error}=await db.rpc('company_engine_target',{c:company});
 const target=Array.isArray(data)?data[0]:data;
 if(error||!target?.connection||!target.profile) return 'engineNotReady';
 let key=null; try { key=await savedConnectionKey(service,{id:target.connection,company},encryptionKey); } catch { key=null; }
 return key?engineReady(engineFor({address:target.address,profile:target.profile,key}),target.profile):'engineNotReady';
}

/** @param {any} db @param {any} service @param {{company:string,request:number,make:boolean,reason?:string|null,encryptionKey:string|undefined,engineFor?:typeof defaultEngine}} answer @returns {Promise<RequestAnswer>} */
export async function answerRequest(db,service,{company,request,make,reason=null,encryptionKey,engineFor=defaultEngine}) {
 if(make) {
  const ready=await companyEngine(db,service,company,encryptionKey,engineFor);
  if(ready!=='ready') return ready;
 }
 const {data,error}=await db.rpc('answer_agent_request',{c:company,request,make,reason:make?null:reason});
 if(error) return refusals[error.code==='22023'?error.message:error.code]??'failed';
 return data==='made'||data==='declined'?data:'failed';
}
