import { engineOf } from './company-engine.mjs';
import { editMemoryNote, forgetMemoryNote, readMemoryNotes, resetMemory } from './hermes.mjs';
import { holdAgentChange, madeAndLogged } from './agent-change-log.mjs';

// An Agent's memory (#350) lives only in its own profile in the bundled Engine (ADR 0016, ADR 0017), and gtmworks keeps
// no copy: it reads that one profile's notes through the engine contract, and an Owner may clear them. `db` is the
// signed-in person's own session: company_app_agents says which Agents they see, so an Agent hidden from them is not
// found, and the database says who may reset one (an active Owner) and writes one row in the Company log with no note
// text. Every change is held by the database before the Engine is asked and logged once the Engine holds it
// (lib/agent-change-log.mjs, #370), so a log that is late never reads as a failed change. The profile never leaves this
// module.
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
// The state for a change the database did not hold: its refusal, or failed when it did not answer.
/** @param {string} refusal */
const refusedAs=refusal=>refusal==='memoryNotAllowed'?'notAllowed':refusal==='memoryInvalid'?'invalid':'failed';
// A memory the reader cannot read, with no notes: the reason and whether the Agent is the main one.
const unread=(found,main)=>({state:found,main,notes:null});

// The notes of the Agent's memory, and whether it is the Company's main Agent (#121: its memory still holds what the
// Company's Agents remembered before each Agent got a profile of its own). States: found, missing (an Agent the reader
// does not see), invalid, noEngine, or the Engine's refused / unreachable / failed.
/** @param {any} db @param {{company:string,agent:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function readAgentMemory(db,{company,agent,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const target=await memoryAgent(db,company,agent);
 if(target.state!=='found') return unread(target.state,false);
 const main=target.agent.main===true;
 if(!hermes) return unread('noEngine',main);
 const read=await (driver.read||drivers.read)({...hermes,profile:target.agent.profile});
 return read.state==='found'?{state:'found',main,notes:read.notes}:unread(read.state,main);
}

// An Owner clears the Agent's memory, then it is logged once. States: reset, missing, invalid, notAllowed (not an active
// Owner), noEngine, or the Engine's refused / unreachable / failed. A refusal changes nothing and logs nothing. A reset
// whose log the database did not take yet is still reset, with logPending: the worker's pass logs it.
/** @param {any} db @param {{company:string,agent:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function resetAgentMemory(db,{company,agent,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const target=await memoryAgent(db,company,agent);
 if(target.state!=='found') return {state:target.state};
 if(!hermes) return {state:'noEngine'};
 const {held,refusal}=await holdAgentChange(db,{company,agent,act:'memory_reset'});
 if(!held) return {state:refusedAs(refusal)};
 return madeAndLogged(db,held,'reset',()=>(driver.reset||drivers.reset)({...hermes,profile:target.agent.profile}));
}

// One note of the Agent's memory is rewritten (#191), after the database checks that the reader may edit it (an active
// Owner or Manager of the Company) and before the Engine is asked. The note's own text is never logged: the Company log
// keeps one row naming the person and the Agent. States: edited, missing (an Agent the reader does not
// see), invalid, notAllowed, noEngine, stale (it changed since it was read), refused (empty or over the limit), or the
// Engine's unreachable / failed. A refusal changes nothing and logs nothing.
/** @param {any} db @param {{company:string,agent:unknown,note:string,text:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function editAgentMemory(db,{company,agent,note,text,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const target=await memoryAgent(db,company,agent);
 if(target.state!=='found') return {state:target.state};
 if(!hermes) return {state:'noEngine'};
 const {held,refusal}=await holdAgentChange(db,{company,agent,act:'memory_edit',note});
 if(!held) return {state:refusedAs(refusal)};
 return madeAndLogged(db,held,'edited',()=>(driver.edit||drivers.edit)({...hermes,profile:target.agent.profile},{note,text}));
}

// One note is removed from the Agent's memory (#191), the Owner's alone, as a reset is: the database checks it
// before the Engine is asked, and one row of the Company log records it with no
// note text. States as editAgentMemory, with forgotten in place of edited.
/** @param {any} db @param {{company:string,agent:unknown,note:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function forgetAgentMemory(db,{company,agent,note,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const target=await memoryAgent(db,company,agent);
 if(target.state!=='found') return {state:target.state};
 if(!hermes) return {state:'noEngine'};
 const {held,refusal}=await holdAgentChange(db,{company,agent,act:'memory_forget',note});
 if(!held) return {state:refusedAs(refusal)};
 return madeAndLogged(db,held,'forgotten',()=>(driver.forget||drivers.forget)({...hermes,profile:target.agent.profile},{note}));
}
