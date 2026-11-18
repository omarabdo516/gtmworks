import { hermesAt } from './bundled-hermes.mjs';
import { signInTarget } from './company-sign-in.mjs';
import { readAgent, writeAgentAbout } from './hermes.mjs';

// An Agent's page in Settings (#161): its About is the description of its own profile in the bundled Engine, read from
// the profile list the driver already reads (lib/hermes.mjs readAgent) and written on the Engine's description route.
// `db` is the signed-in person's own session: the database says which profile is the Agent's and whether it is its own
// (company_app_agents `own`; an Agent still on the Company's shared profile would change the main Agent too, so it is
// refused), check_agent_setting checks an active Owner or Manager who sees the Agent before the Engine is written, and
// log_agent_setting writes one row of the Company log once the Engine holds the change. The profile never leaves this
// module. The Engine's name for the Agent, its About and its title are read too, and Name and Role stay read-only rows:
// the pinned Engine has no management route that writes a named profile's display_name, and none that writes bot_title.

const drivers={read:readAgent,about:writeAgentAbout};
const refusals={agentSettingNotAllowed:'notAllowed'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The Agent's own Engine profile, with whether it is the Agent's own: noEngine when the Company has no profile of its
// own in the bundled Engine, noAgent when the person does not see that Agent.
/** @param {any} db @param {string} company @param {string} agent @param {{address:string,key:string}|null} hermes */
export async function agentTarget(db,company,agent,hermes) {
 const [target,listed]=await Promise.all([signInTarget(db,company,hermes),db.rpc('company_app_agents',{c:company})]);
 if(!target) return {state:'noEngine'};
 const one=Array.isArray(listed?.data)&&listed.data.find(row=>row?.agent===agent);
 return one?{state:'found',...target,profile:one.profile,own:one.own===true}:{state:'noAgent'};
}

// What the Agent's page shows of the Engine's own fields, or null when the Agent is not one the person sees. When the
// Engine cannot be read the state says why and the fields are empty, so the page still draws.
/** @param {any} db @param {{company:string,agent:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function readAgentAbout(db,{company,agent,hermes=hermesAt(),driver={}}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return null;
 const target=await agentTarget(db,company,agent,hermes);
 if(target.state!=='found') return null;
 const read=await (driver.read||drivers.read)({...target,profile:target.profile},target.profile);
 if(read.state!=='found'||!read.agent) return {state:read.state,own:target.own,displayName:null,description:'',descriptionAuto:true,botTitle:null};
 return {state:'found',own:target.own,displayName:read.agent.displayName??null,description:read.agent.description??'',descriptionAuto:read.agent.descriptionAuto!==false,botTitle:read.agent.botTitle??null};
}

// One field of an Agent's settings changed from its page, saved at once and logged: About is the profile's description.
// States: written (with what the Engine kept), invalid, notOwn (an Agent sharing the Company's profile, or one not
// seen), notAllowed (below Manager), noEngine, or the Engine's refused / unreachable / failed. Later fields join here
// with their own server checks.
/** @param {any} db @param {{company:string,agent:unknown,description:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request
 * @returns {Promise<{state:'written',description:string}|{state:'invalid'|'notOwn'|'notAllowed'|'noEngine'|'refused'|'unreachable'|'failed',description:null}>} */
export async function changeAgentAbout(db,{company,agent,description,hermes=hermesAt(),driver={}}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)||typeof description!=='string') return {state:'invalid',description:null};
 const target=await agentTarget(db,company,agent,hermes);
 if(target.state==='noEngine') return {state:'noEngine',description:null};
 if(target.state!=='found') return {state:'notOwn',description:null};
 if(!target.own) return {state:'notOwn',description:null};
 const {error}=await db.rpc('check_agent_setting',{c:company,agent});
 if(error) return {state:refusals[error.message]||'failed',description:null};
 const written=await (driver.about||drivers.about)(target,{name:target.profile,description});
 if(written.state!=='written') return {state:written.state,description:null};
 const {error:logError}=await db.rpc('log_agent_setting',{c:company,agent,field:'about',old_value:null,new_value:null});
 if(logError) return {state:'failed',description:null};
 return {state:'written',description:written.description};
}
