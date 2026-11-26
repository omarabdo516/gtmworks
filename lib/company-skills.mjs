import { companyEngine, seenAgents } from './engine/handle.mjs';
import { essentialSkill } from './engine/skills.mjs';
import { sharedSkillNames } from './shared-skills.mjs';
import { holdAgentChange, madeAndLogged } from './agent-change-log.mjs';

// A Company's skills (#343, ADR 0011, ADR 0016) live only in the bundled Engine: each Agent's own profile, and the
// Company's shared folder (team-lessons, written by lib/shared-skills.mjs) that every profile reads. `db` is the
// signed-in person's own session, which says which Agents they see and the profile each runs on, checks that they may
// change skills (Owner or Manager, and no secret in the text) and holds each change before the Engine is asked, then logs
// it once the Engine holds it as one row of the Company log (lib/agent-change-log.mjs, #370). The profile never leaves
// this module.
const refusals={skillNotAllowed:'notAllowed',skillSecret:'secret'};
// What the skills screen says for each refusal of a change (app/c/[slug]/[[...section]]/skills.tsx).
export const skillProblems={invalid:'skillProblemHeader',shared:'skillProblemShared',notOwn:'skillProblemNotOwn',notAllowed:'skillProblemNotAllowed',secret:'skillProblemSecret'};
// A refusal that names no skill: the Agent or the Engine is not there.
const nameless=new Set(['invalid','notOwn','noEngine']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The Engine refuses a longer SKILL.md (v0.23.0 tools/skill_manager_tool.py 110).
const mostCharacters=100000;

/** @param {any} db @param {string} company */
async function skillAgents(db,company) {
 const data=await seenAgents(db,company);
 return data?data.map(row=>({id:row.agent,name:row.name,own:row.own===true,profile:row.profile})):null;
}

// The name a SKILL.md gives itself in its header, or null.
/** @param {unknown} content */
function skillName(content) {
 if(typeof content!=='string'||content.length>mostCharacters) return null;
 const header=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
 const name=header&&/(?:^|\n)name:[ \t]*["']?([^\n"']*)["']?[ \t]*(?:\r?\n|$)/.exec(header)?.[1]?.trim();
 return name&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)?name:null;
}

// Every Agent the person sees, each with its profile's skills (null when that profile cannot be read now), or null
// when the Company has no profile of its own in the bundled Engine or the database does not answer.
// A Company with no Agent in the Engine yet has none: an empty list, not an unread one.
/** @param {any} db @param {{company:string}} request */
export async function readCompanySkills(db,{company}) {
 const agents=await skillAgents(db,company);
 if(agents?.length===0) return [];
 const target=agents&&await companyEngine(company,{reader:db});
 if(!target) return null;
 const reads=new Map(await Promise.all([...new Set(agents.map(agent=>agent.profile))].map(async profile=>/** @type {const} */([profile,await target.on(profile).skills.read()]))));
 return agents.map(({id,name,own,profile})=>{ const found=reads.get(profile); return {id,name,own,skills:found?.state==='found'?found.skills:null}; });
}

// One Agent's own skills for its page in Settings (#180): each with the Engine's description, category, lock and
// provenance, in the Engine's order, and marked when the Engine's learning graph says the Agent wrote it. The Company's
// shared skills (provenance external) belong to the team's page, not the Agent's, and the essential skill is never
// drawn, so both are left out. `own` says whether the profile is the Agent's alone: one still on the Company's shared
// profile is refused a change. null when the person does not see the Agent, and a reason when the Engine cannot be read.
/** @param {any} db @param {{company:string,agent:string}} request */
export async function readAgentSkills(db,{company,agent}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return null;
 const [target,agents]=await Promise.all([companyEngine(company,{reader:db}),skillAgents(db,company)]);
 const one=target&&agents?.find(found=>found.id===agent);
 if(!target||!one) return null;
 const profile=target.on(one.profile);
 const [read,graph]=await Promise.all([profile.skills.read(),profile.skills.learned()]);
 if(read.state!=='found') return {state:read.state,own:one.own,skills:null};
 const learned=new Set(graph.state==='found'?(graph.learned||[]):[]);
 return {state:'found',own:one.own,skills:read.skills.filter(skill=>!skill.shared).map(skill=>({...skill,learned:learned.has(skill.name)}))};
}

// The Agent's own profile for a change the database allows and holds, or the change's refusal as a state.
/** @param {any} db @param {string} company @param {unknown} agent @param {string} name @param {'skill_written'|'skill_enabled'|'skill_disabled'} act @param {string|null} body */
async function changeTarget(db,company,agent,name,act,body) {
 if(typeof agent!=='string'||!uuid.test(agent)) return {state:'invalid'};
 if(name===essentialSkill) return {state:'essential'};
 if(sharedSkillNames.includes(name)) return {state:'shared'};
 const target=await companyEngine(company,{reader:db});
 if(!target) return {state:'noEngine'};
 const one=(await skillAgents(db,company))?.find(found=>found.id===agent&&found.own);
 if(!one) return {state:'notOwn'};
 const {held,refusal}=await holdAgentChange(db,{company,agent,act,skill:name,body});
 if(!held) return {state:refusals[refusal]||'failed'};
 return {state:'allowed',held,target:target.on(one.profile)};
}

// One SKILL.md written into one Agent's own profile, then logged; a write whose log is late is still written, with
// logPending. States: written, invalid (no id or no usable header),
// notOwn (an Agent sharing the Company's profile, or one not seen), shared (a shared skill's name), notAllowed (below
// Manager), secret (the text looks like a key), noEngine, or the Engine's failed / refused / unreachable.
/** @param {any} db @param {{company:string,agent:unknown,content:unknown}} request */
export async function changeCompanySkill(db,{company,agent,content}) {
 // A browser sends a textarea with CRLF line endings, and the Engine reads a SKILL.md back with LF ones.
 const text=typeof content==='string'?content.replace(/\r\n?/g,'\n'):content;
 const name=skillName(text);
 if(!name) return {state:'invalid',name:null};
 const change=await changeTarget(db,company,agent,name,'skill_written',/** @type {string} */(text));
 if(change.state!=='allowed'||!change.held||!change.target) return {state:change.state,name:nameless.has(change.state)?null:name};
 const {target}=change;
 const written=await madeAndLogged(db,change.held,'written',()=>target.skills.write({name,content:/** @type {string} */(text)}));
 return {...written,name};
}

// One of an Agent's own skills switched on or off for that Agent alone, then logged. States: changed, or those of a write.
/** @param {any} db @param {{company:string,agent:unknown,name:unknown,enabled:unknown}} request */
export async function changeCompanySkillEnabled(db,{company,agent,name,enabled}) {
 if(typeof name!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)||typeof enabled!=='boolean') return {state:'invalid',name:null};
 const change=await changeTarget(db,company,agent,name,enabled?'skill_enabled':'skill_disabled',null);
 if(change.state!=='allowed'||!change.held||!change.target) return {state:change.state,name:nameless.has(change.state)?null:name};
 const {target}=change;
 const toggled=await madeAndLogged(db,change.held,'changed',()=>target.skills.enable({name,enabled}));
 return {...toggled,name};
}
