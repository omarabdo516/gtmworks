import { savedConnectionKey } from './connection-key.mjs';
import { engineFor as defaultEngine } from './engine.mjs';
import { engineReady } from './agent-tools.mjs';

// `db` is the Owner's own session, so answer_agent_request checks the Owner. «Make it» needs the Engine to have the
// Company's profile ready first (ADR 0014); `service` only reads the bundled Connection's key, by its id and the Company
// (ADR 0008).
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
