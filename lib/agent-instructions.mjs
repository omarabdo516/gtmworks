import { engineOf } from './bundled-hermes.mjs';
import { agentGate, agentTarget } from './agent-gate.mjs';
import { readAgentInstructions as readInstructions, writeAgentInstructions as writeInstructions } from './hermes.mjs';

// An Agent's standing instructions (#176): the text of its own profile's SOUL.md outside the team's rules section, read
// for every Role and written by the Owner alone (Omar, 2026-11-18). `db` is the signed-in person's own session: the
// database says which profile is the Agent's and whether it is its own (an Agent still on the Company's shared profile
// would change the main Agent too, so it is refused), check_agent_owner_setting checks an active Owner who sees the Agent
// before the Engine is written, and log_agent_instructions writes one row of the Company log once the Engine holds the
// change, with the field and no text. The profile never leaves this module. The counter's limit is the Engine's own
// context_file_max_chars when the profile sets a positive one, else its floor of 20,000.
const drivers={read:readInstructions,instructions:writeInstructions};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty={instructions:'',sectionChars:0,limit:20000};

// What the Agent's page shows of its instructions, or null when the Agent is not one the person sees. When the Engine
// cannot be read the state says why and the field is empty, so the page still draws it read-only.
/** @param {any} db @param {{company:string,agent:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request
 * @returns {Promise<{state:'found',own:boolean,instructions:string,sectionChars:number,limit:number}|{state:'missing'|'refused'|'unreachable'|'failed',own:boolean,instructions:string,sectionChars:number,limit:number}|null>} */
export async function readAgentInstructions(db,{company,agent,hermes=engineOf(company),driver={}}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return null;
 const target=await agentTarget(db,company,agent,hermes);
 if(target.state!=='found') return null;
 const read=await (driver.read||drivers.read)(target,target.profile);
 if(read.state!=='found') return {state:read.state,own:target.own,...empty};
 return {state:'found',own:target.own,instructions:read.instructions,sectionChars:read.sectionChars,limit:read.limit};
}

// The instructions changed from the Agent's page, saved at once and logged. States: written (with what the Engine kept),
// tooLong (with the section and the limit), invalid, notOwn (an Agent sharing the Company's profile, or one not seen),
// notAllowed (the Owner alone), noEngine, or the Engine's refused / unreachable / failed.
/** @param {any} db @param {{company:string,agent:unknown,instructions:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request
 * @returns {Promise<{state:'written',instructions:string,sectionChars:number,limit:number}|{state:'tooLong'|'invalid'|'notOwn'|'notAllowed'|'noEngine'|'refused'|'unreachable'|'failed',instructions:null,sectionChars:number,limit:number}>} */
export async function changeAgentInstructions(db,{company,agent,instructions,hermes=engineOf(company),driver={}}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)||typeof instructions!=='string') return {state:'invalid',instructions:null,sectionChars:0,limit:20000};
 const gate=await agentGate(db,{company,agent,hermes,check:'check_agent_owner_setting'});
 if(gate.state!=='allowed') return {state:gate.state,instructions:null,sectionChars:0,limit:20000};
 const target=gate.target;
 const written=await (driver.instructions||drivers.instructions)(target,{profile:target.profile,instructions});
 if(written.state!=='written') return {state:written.state,instructions:null,sectionChars:written.sectionChars??0,limit:written.limit??empty.limit};
 const {error:logError}=await db.rpc('log_agent_instructions',{c:company,agent});
 if(logError) return {state:'failed',instructions:null,sectionChars:written.sectionChars,limit:written.limit};
 return {state:'written',instructions:written.instructions,sectionChars:written.sectionChars,limit:written.limit};
}
