import { agentGate, agentTarget } from './agent-gate.mjs';

// An Agent's page in Settings (#161): its About is the description of its own profile in the bundled Engine, read from
// the profile list the driver already reads (lib/engine/agents.mjs readAgent) and written on the Engine's description route.
// `db` is the signed-in person's own session: the database says which profile is the Agent's and whether it is its own
// (company_app_agents `own`; an Agent still on the Company's shared profile would change the main Agent too, so it is
// refused), check_agent_setting checks an active Owner or Manager who sees the Agent before the Engine is written, and
// log_agent_setting writes one row of the Company log once the Engine holds the change. The profile never leaves this
// module. The Engine's name for the Agent, its About and its title are read too, and Name and Role stay read-only rows:
// the pinned Engine has no management route that writes a named profile's display_name, and none that writes bot_title.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What the Agent's page shows of the Engine's own fields, or null when the Agent is not one the person sees. When the
// Engine cannot be read the state says why and the fields are empty, so the page still draws.
/** @param {any} db @param {{company:string,agent:string}} request */
export async function readAgentAbout(db,{company,agent}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return null;
 const target=await agentTarget(db,company,agent);
 if(target.state!=='found'||!target.engine) return null;
 const read=await target.engine.agents.read(/** @type {string} */(target.profile));
 if(read.state!=='found'||!read.agent) return {state:read.state,own:target.own,displayName:null,description:'',descriptionAuto:true,botTitle:null};
 return {state:'found',own:target.own,displayName:read.agent.displayName??null,description:read.agent.description??'',descriptionAuto:read.agent.descriptionAuto!==false,botTitle:read.agent.botTitle??null};
}

// One field of an Agent's settings changed from its page, saved at once and logged: About is the profile's description.
// States: written (with what the Engine kept), invalid, notOwn (an Agent sharing the Company's profile, or one not
// seen), notAllowed (below Manager), noEngine, or the Engine's refused / unreachable / failed. Later fields join here
// with their own server checks.
/** @param {any} db @param {{company:string,agent:unknown,description:unknown}} request
 * @returns {Promise<{state:'written',description:string}|{state:'invalid'|'notOwn'|'notAllowed'|'noEngine'|'refused'|'unreachable'|'failed',description:null}>} */
export async function changeAgentAbout(db,{company,agent,description}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)||typeof description!=='string') return {state:'invalid',description:null};
 const gate=await agentGate(db,{company,agent,check:'check_agent_setting'});
 if(gate.state!=='allowed') return {state:gate.state,description:null};
 const target=gate.target;
 const written=await target.engine.agents.writeAbout({name:target.profile,description});
 if(written.state!=='written') return {state:written.state,description:null};
 const {error:logError}=await db.rpc('log_agent_setting',{c:company,agent,field:'about',old_value:null,new_value:null});
 if(logError) return {state:'failed',description:null};
 return {state:'written',description:written.description};
}
