import { hermesAt } from './bundled-hermes.mjs';
import { editMemoryNote, forgetMemoryNote, readMemoryNotes, resetMemory } from './hermes.mjs';

// An Agent's memory (#350) lives only in its own profile in the bundled Engine (ADR 0016, ADR 0017), and gtmworks keeps
// no copy: it reads that one profile's notes through the engine contract, and an Owner may clear them. `db` is the
// signed-in person's own session: company_app_agents says which Agents they see, so an Agent hidden from them is not
// found, and the database says who may reset one (check_memory_reset, log_memory_reset: an active Owner, and one row in
// the Company log with no note text). The profile never leaves this module.
const drivers={read:readMemoryNotes,reset:resetMemory,edit:editMemoryNote,forget:forgetMemoryNote};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The Agent as the reader sees it, with the profile its memory is in; no row at all for an Agent hidden from them.
/** @param {any} db @param {string} company @param {unknown} agent */
async function memoryAgent(db,company,agent) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return {state:'invalid'};
 const {data,error}=await db.rpc('company_app_agents',{c:company});
 if(error||!Array.isArray(data)) return {state:'failed'};
 const found=data.find(row=>row?.agent===agent);
 return found?{state:'found',agent:found}:{state:'missing'};
}
const state=(found,main)=>({state:found,main,notes:null});

// The notes of the Agent's memory, and whether it is the Company's main Agent (#121: its memory still holds what the
// Company's Agents remembered before each Agent got a profile of its own). States: found, missing (an Agent the reader
// does not see), invalid, noEngine, or the Engine's refused / unreachable / failed.
/** @param {any} db @param {{company:string,agent:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function readAgentMemory(db,{company,agent,hermes=hermesAt(),driver={}}) {
 const target=await memoryAgent(db,company,agent);
 if(target.state!=='found') return state(target.state,false);
 const main=target.agent.main===true;
 if(!hermes) return state('noEngine',main);
 const read=await (driver.read||drivers.read)({...hermes,profile:target.agent.profile});
 return read.state==='found'?{state:'found',main,notes:read.notes}:state(read.state,main);
}

// An Owner clears the Agent's memory, then it is logged once. States: reset, missing, invalid, notAllowed (not an active
// Owner), noEngine, or the Engine's refused / unreachable / failed. A refusal changes nothing and logs nothing.
/** @param {any} db @param {{company:string,agent:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function resetAgentMemory(db,{company,agent,hermes=hermesAt(),driver={}}) {
 const target=await memoryAgent(db,company,agent);
 if(target.state!=='found') return {state:target.state};
 if(!hermes) return {state:'noEngine'};
 const {error}=await db.rpc('check_memory_reset',{c:company,agent});
 if(error) return {state:error.message==='memoryNotAllowed'?'notAllowed':'failed'};
 const reset=await (driver.reset||drivers.reset)({...hermes,profile:target.agent.profile});
 if(reset.state!=='reset') return {state:reset.state};
 // The Engine already cleared it: a log the database refuses is not the reset's failure, but it is never silent.
 const logged=await db.rpc('log_memory_reset',{c:company,agent});
 return logged.error?{state:'failed'}:{state:'reset'};
}

// One note of the Agent's memory is rewritten (#191), after the database checks that the reader may edit it (an active
// Owner or Manager of the Company) and before the Engine is asked. The note's own text is never logged: the Company log
// keeps one row naming the person and the Agent (log_memory_edit). States: edited, missing (an Agent the reader does not
// see), invalid, notAllowed, noEngine, stale (it changed since it was read), refused (empty or over the limit), or the
// Engine's unreachable / failed. A refusal changes nothing and logs nothing.
/** @param {any} db @param {{company:string,agent:unknown,note:string,text:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function editAgentMemory(db,{company,agent,note,text,hermes=hermesAt(),driver={}}) {
 const target=await memoryAgent(db,company,agent);
 if(target.state!=='found') return {state:target.state};
 if(!hermes) return {state:'noEngine'};
 const {error}=await db.rpc('check_memory_edit',{c:company,agent,note});
 if(error) return {state:error.message==='memoryNotAllowed'?'notAllowed':error.message==='memoryInvalid'?'invalid':'failed'};
 const edited=await (driver.edit||drivers.edit)({...hermes,profile:target.agent.profile},{note,text});
 if(edited.state!=='edited') return {state:edited.state};
 // The Engine holds the change: a log the database refuses is not the edit's failure, but it is never silent.
 const logged=await db.rpc('log_memory_edit',{c:company,agent});
 return logged.error?{state:'failed'}:{state:'edited'};
}

// One note is removed from the Agent's memory (#191), the Owner's alone, as a reset is: the database checks it
// (check_memory_forget) before the Engine is asked, and one row of the Company log records it (log_memory_forget) with no
// note text. States as editAgentMemory, with forgotten in place of edited.
/** @param {any} db @param {{company:string,agent:unknown,note:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function forgetAgentMemory(db,{company,agent,note,hermes=hermesAt(),driver={}}) {
 const target=await memoryAgent(db,company,agent);
 if(target.state!=='found') return {state:target.state};
 if(!hermes) return {state:'noEngine'};
 const {error}=await db.rpc('check_memory_forget',{c:company,agent,note});
 if(error) return {state:error.message==='memoryNotAllowed'?'notAllowed':error.message==='memoryInvalid'?'invalid':'failed'};
 const forgotten=await (driver.forget||drivers.forget)({...hermes,profile:target.agent.profile},{note});
 if(forgotten.state!=='forgotten') return {state:forgotten.state};
 const logged=await db.rpc('log_memory_forget',{c:company,agent});
 return logged.error?{state:'failed'}:{state:'forgotten'};
}
