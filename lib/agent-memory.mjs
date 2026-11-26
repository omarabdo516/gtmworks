import { agentEngine } from './engine/handle.mjs';
import { holdAgentChange, madeAndLogged } from './agent-change-log.mjs';

// An Agent's memory (#350) lives only in its own profile in the bundled Engine (ADR 0016, ADR 0017), and gtmworks keeps
// no copy: it reads that one profile's notes through the Engine handle, and an Owner may clear them. `db` is the
// signed-in person's own session: company_app_agents says which Agents they see, so an Agent hidden from them is not
// found, and the database says who may reset one (an active Owner) and writes one row in the Company log with no note
// text. Every change is held by the database before the Engine is asked and logged once the Engine holds it
// (lib/agent-change-log.mjs, #370), so a log that is late never reads as a failed change. The profile never leaves this
// module.
// The state for a change the database did not hold: its refusal, or failed when it did not answer.
/** @param {string} refusal */
const refusedAs=refusal=>refusal==='memoryNotAllowed'?'notAllowed':refusal==='memoryInvalid'?'invalid':'failed';
// A memory the reader cannot read, with no notes: the reason and whether the Agent is the main one.
/** @param {string} found @param {boolean} main */
const unread=(found,main)=>({state:found,main,notes:null});

// The notes of the Agent's memory, and whether it is the Company's main Agent (#121: its memory still holds what the
// Company's Agents remembered before each Agent got a profile of its own). States: found, missing (an Agent the reader
// does not see), invalid, noEngine, or the Engine's refused / unreachable / failed.
/** @param {any} db @param {{company:string,agent:unknown}} request */
export async function readAgentMemory(db,{company,agent}) {
 const target=await agentEngine(db,{company,agent});
 const main=target.agent?.main===true;
 if(!target.engine) return unread(target.state,main);
 const read=await target.engine.memory.read();
 return read.state==='found'?{state:'found',main,notes:read.notes}:unread(read.state,main);
}

// An Owner clears the Agent's memory, then it is logged once. States: reset, missing, invalid, notAllowed (not an active
// Owner), noEngine, or the Engine's refused / unreachable / failed. A refusal changes nothing and logs nothing. A reset
// whose log the database did not take yet is still reset, with logPending: the worker's pass logs it.
/** @param {any} db @param {{company:string,agent:unknown}} request */
export async function resetAgentMemory(db,{company,agent}) {
 const target=await agentEngine(db,{company,agent});
 if(!target.engine) return {state:target.state};
 const engine=target.engine;
 const {held,refusal}=await holdAgentChange(db,{company,agent,act:'memory_reset'});
 if(!held) return {state:refusedAs(refusal)};
 return madeAndLogged(db,held,'reset',()=>engine.memory.reset());
}

// One note of the Agent's memory is rewritten (#191), after the database checks that the reader may edit it (an active
// Owner or Manager of the Company) and before the Engine is asked. The note's own text is never logged: the Company log
// keeps one row naming the person and the Agent. States: edited, missing (an Agent the reader does not
// see), invalid, notAllowed, noEngine, stale (it changed since it was read), refused (empty or over the limit), or the
// Engine's unreachable / failed. A refusal changes nothing and logs nothing.
/** @param {any} db @param {{company:string,agent:unknown,note:string,text:string}} request */
export async function editAgentMemory(db,{company,agent,note,text}) {
 const target=await agentEngine(db,{company,agent});
 if(!target.engine) return {state:target.state};
 const engine=target.engine;
 const {held,refusal}=await holdAgentChange(db,{company,agent,act:'memory_edit',note});
 if(!held) return {state:refusedAs(refusal)};
 return madeAndLogged(db,held,'edited',()=>engine.memory.edit({note,text}));
}

// One note is removed from the Agent's memory (#191), the Owner's alone, as a reset is: the database checks it
// before the Engine is asked, and one row of the Company log records it with no
// note text. States as editAgentMemory, with forgotten in place of edited.
/** @param {any} db @param {{company:string,agent:unknown,note:string}} request */
export async function forgetAgentMemory(db,{company,agent,note}) {
 const target=await agentEngine(db,{company,agent});
 if(!target.engine) return {state:target.state};
 const engine=target.engine;
 const {held,refusal}=await holdAgentChange(db,{company,agent,act:'memory_forget',note});
 if(!held) return {state:refusedAs(refusal)};
 return madeAndLogged(db,held,'forgotten',()=>engine.memory.forget({note}));
}
