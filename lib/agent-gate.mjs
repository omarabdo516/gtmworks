import { signInTarget } from './company-sign-in.mjs';

// The one gate every field of an Agent's page passes before the Engine is written (#161, #162, #176, #179): the request is
// well formed, the Agent has its own Engine profile (an Agent still on the Company's shared profile would change another
// Agent too), and the database allows this person this change. `own:false` is for a read-only action, Listen, which a
// person may ask on a shared profile because it changes nothing. The profile never leaves the modules that call this.
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

/** @param {any} db @param {{company:string,agent:unknown,hermes?:{address:string,key:string}|null,check?:string,own?:boolean,missing?:'notOwn'|'notAllowed'}} request */
export async function agentGate(db,{company,agent,hermes,check='check_agent_setting',own=true,missing='notOwn'}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return {state:'invalid'};
 const target=await agentTarget(db,company,agent,hermes);
 if(target.state==='noEngine') return {state:'noEngine'};
 if(target.state!=='found'||(own&&!target.own)) return {state:missing};
 const {error}=await db.rpc(check,{c:company,agent});
 if(error) return {state:error.message==='agentSettingNotAllowed'?'notAllowed':'failed'};
 return {state:'allowed',target};
}
