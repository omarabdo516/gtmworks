// A change an Agent's Engine profile holds always gets its one row of the Company log (#370): an Agent's memory reset,
// one note edited or forgotten (lib/agent-memory.mjs) and a skill written or switched (lib/company-skills.mjs). The
// database checks the change and holds it for the signed-in person before the Engine is asked (hold_agent_change). When
// the Engine answers that it holds the change, its held record becomes that one row (finish_agent_change); when it
// refuses the change, the record is dropped (drop_agent_change). Finishing a record twice writes nothing the second time,
// so each is retried here, first while the person waits and then in the background for ten minutes. An answer that does
// not say what the Engine did (unreachable, failed, or a call that throws) leaves the record held: after fifteen minutes
// the worker's pass writes its row marked unconfirmed (finish_held_agent_changes). A log that is late is never the
// change's failure: the person is told the change was made. No note's text is sent or kept.
// A wait; one in the background (`quiet`) never keeps the process running by itself.
/** @param {number} ms @param {boolean} [quiet] */
const pause=(ms,quiet=false)=>new Promise(resolve=>{ const timer=setTimeout(resolve,ms); if(quiet) timer.unref?.(); });
// The waits before each retry of a log or drop that the database did not take while the person waits for the answer.
const retries=[200,1000];
// A finish or drop the database did not take then is tried on after the answer, every thirty seconds for nine minutes,
// so it lands before the worker's pass takes the record as unconfirmed fifteen minutes after it was held.
const later=Array.from({length:18},()=>30000);
// The Engine's answers that do not say whether it made the change, unless the driver says it asked nothing (unsent):
// the record stays held for the pass.
const unknown=new Set(['unreachable','failed']);

// The change checked and held: its record's id, or the database's refusal (its message) when it is not allowed.
/** @param {any} db @param {{company:string,agent:string,act:string,skill?:string|null,note?:string|null,body?:string|null}} change */
export async function holdAgentChange(db,{company,agent,act,skill=null,note=null,body=null}) {
 const {data,error}=await db.rpc('hold_agent_change',{c:company,agent,act,skill,note,body});
 if(error||typeof data!=='string') return {held:null,refusal:error?.message||'failed'};
 return {held:data,refusal:null};
}

// One call to the database, tried again after each wait until it answers without an error. Whether it ever did.
/** @param {() => Promise<{error:unknown}>} call @param {number[]} waits @param {boolean} [quiet] */
async function untilTaken(call,waits,quiet=false) {
 for(let attempt=0;;attempt++) {
  const {error}=await call().then(answer=>answer,error=>({error}));
  if(!error) return true;
  if(attempt>=waits.length) return false;
  await pause(waits[attempt],quiet);
 }
}

// One call that settles the held record, tried while the person waits and then in the background. Whether the
// database took it before the answer.
/** @param {() => Promise<{error:unknown}>} call @param {string} what @param {{waits?:number[],laterWaits?:number[]}} options */
async function settle(call,what,{waits=retries,laterWaits=later}) {
 if(await untilTaken(call,waits)) return true;
 pause(laterWaits[0]??0,true).then(()=>untilTaken(call,laterWaits.slice(1),true)).then(taken=>{ if(!taken) console.error(`held agent change: ${what} was not taken; the worker's pass logs it as unconfirmed`); });
 return false;
}

// A change made in the Engine, once the database held it: `make` asks the Engine and answers its state, and `done` is
// the state that says the Engine holds it. Answers the Engine's state, with logPending when its row is not written yet.
/** @param {any} db @param {string} held @param {string} done @param {() => Promise<{state:string,unsent?:boolean}>} make @param {{waits?:number[],laterWaits?:number[]}} [options] @returns {Promise<{state:string,logPending?:true}>} */
export async function madeAndLogged(db,held,done,make,options={}) {
 // A call that throws says nothing of what the Engine did, as unreachable does: the record stays held.
 const {state,unsent}=await make();
 if(state===done) {
  return await settle(()=>db.rpc('finish_agent_change',{change:held}),`the log of ${held}`,options)?{state}:{state,logPending:true};
 }
 if(!unknown.has(state)||unsent===true) await settle(()=>db.rpc('drop_agent_change',{change:held}),`the drop of ${held}`,options);
 return {state};
}

// The worker's pass: every change still held fifteen minutes after it was held is logged once, as unconfirmed
// (finish_held_agent_changes).
/** @param {any} db */
export async function logHeldAgentChanges(db) {
 const {data,error}=await db.rpc('finish_held_agent_changes');
 if(error) throw new Error(`finish_held_agent_changes: ${error.message}`);
 return {logged:typeof data==='number'?data:0};
}
