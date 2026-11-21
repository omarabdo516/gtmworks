// A change an Agent's Engine profile holds always gets its one row of the Company log (#370): an Agent's memory reset,
// one note edited or forgotten (lib/agent-memory.mjs) and a skill written or switched (lib/company-skills.mjs). The
// database checks the change and holds it for the signed-in person before the Engine is asked (hold_agent_change); once
// the Engine holds it, its held record becomes that one row (finish_agent_change), and a refusal from the Engine drops it
// (drop_agent_change). Logging a record twice writes nothing the second time, so a failed log is retried here, and a
// record still held ten minutes later is logged by the worker's pass (finish_held_agent_changes). A log that is late is
// never the change's failure: the person is told the change was made. No note's text is sent or kept.
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// The waits before each retry of a log or drop that the database did not take.
const retries=[200,1000];

// The change checked and held: its record's id, or the database's refusal (its message) when it is not allowed.
/** @param {any} db @param {{company:string,agent:string,act:string,skill?:string|null,note?:string|null,body?:string|null}} change */
export async function holdAgentChange(db,{company,agent,act,skill=null,note=null,body=null}) {
 const {data,error}=await db.rpc('hold_agent_change',{c:company,agent,act,skill,note,body});
 if(error||typeof data!=='string') return {held:null,refusal:error?.message||'failed'};
 return {held:data,refusal:null};
}

// One call to the database, tried again after each wait until it answers without an error. Whether it ever did.
/** @param {() => Promise<{error:unknown}>} call @param {number[]} waits */
async function untilTaken(call,waits) {
 for(let attempt=0;;attempt++) {
  const {error}=await call().then(answer=>answer,error=>({error}));
  if(!error) return true;
  if(attempt>=waits.length) return false;
  await pause(waits[attempt]);
 }
}

// The Engine holds the change: its one row of the Company log. 'logged', or 'pending' when the database did not take it
// now and the worker's pass will.
/** @param {any} db @param {string} held @param {{waits?:number[]}} [options] */
async function logAgentChange(db,held,{waits=retries}={}) {
 return await untilTaken(()=>db.rpc('finish_agent_change',{change:held}),waits)?'logged':'pending';
}

// The Engine refused the change, so it is never logged.
/** @param {any} db @param {string} held @param {{waits?:number[]}} [options] */
async function dropAgentChange(db,held,{waits=retries}={}) {
 await untilTaken(()=>db.rpc('drop_agent_change',{change:held}),waits);
}

// A change made in the Engine, once the database held it: `make` asks the Engine and answers its state, and `done` is
// the state that says the Engine holds it. Answers the Engine's state, with logPending when the log is left to the pass.
/** @template {{state:string}} T @param {any} db @param {string} held @param {string} done @param {() => Promise<T>} make @param {{waits?:number[]}} [options] */
export async function madeAndLogged(db,held,done,make,options) {
 // A call that throws is taken as one that never reached the Engine, as the contract's own unreachable is.
 const made=await make().catch(async error=>{ await dropAgentChange(db,held,options); throw error; });
 if(made.state!==done) { await dropAgentChange(db,held,options); return made; }
 return (await logAgentChange(db,held,options))==='logged'?made:{...made,logPending:true};
}

// The worker's pass: every change still held ten minutes after it was held is logged once (finish_held_agent_changes).
/** @param {any} db */
export async function logHeldAgentChanges(db) {
 const {data,error}=await db.rpc('finish_held_agent_changes');
 if(error) throw new Error(`finish_held_agent_changes: ${error.message}`);
 return {logged:typeof data==='number'?data:0};
}
