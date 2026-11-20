import { engineOf } from './company-engine.mjs';
import { signInTarget } from './company-sign-in.mjs';
import { readSkills, writeSkill, setSkillEnabled, readLearningGraph, essentialSkill } from './hermes.mjs';
import { sharedSkillNames } from './shared-skills.mjs';

// A Company's skills (#343, ADR 0011, ADR 0016) live only in the bundled Engine: each Agent's own profile, and the
// Company's shared folder (team-lessons, written by lib/shared-skills.mjs) that every profile reads. `db` is the
// signed-in person's own session, which says which Agents they see and the profile each runs on, checks that they may
// change skills (check_skill_write: Owner or Manager, and no secret in the text) and logs each change to the Company log
// (log_skill_change). The profile never leaves this module.
const drivers={read:readSkills,write:writeSkill,enable:setSkillEnabled,learned:readLearningGraph};
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
 const {data,error}=await db.rpc('company_app_agents',{c:company});
 return error||!Array.isArray(data)?null:data.map(row=>({id:row.agent,name:row.name,own:row.own===true,profile:row.profile}));
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
/** @param {any} db @param {{company:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function readCompanySkills(db,{company,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const agents=await skillAgents(db,company);
 if(agents?.length===0) return [];
 const target=agents&&await signInTarget(db,company,hermes);
 if(!target) return null;
 const read=driver.read||drivers.read;
 const reads=new Map(await Promise.all([...new Set(agents.map(agent=>agent.profile))].map(async profile=>/** @type {const} */([profile,await read({...target,profile})]))));
 return agents.map(({id,name,own,profile})=>{ const found=reads.get(profile); return {id,name,own,skills:found?.state==='found'?found.skills:null}; });
}

// One Agent's own skills for its page in Settings (#180): each with the Engine's description, category, lock and
// provenance, in the Engine's order, and marked when the Engine's learning graph says the Agent wrote it. The Company's
// shared skills (provenance external) belong to the team's page, not the Agent's, and the essential skill is never
// drawn, so both are left out. `own` says whether the profile is the Agent's alone: one still on the Company's shared
// profile is refused a change. null when the person does not see the Agent, and a reason when the Engine cannot be read.
/** @param {any} db @param {{company:string,agent:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function readAgentSkills(db,{company,agent,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return null;
 const [target,agents]=await Promise.all([signInTarget(db,company,hermes),skillAgents(db,company)]);
 const one=target&&agents?.find(found=>found.id===agent);
 if(!target||!one) return null;
 const profile={...target,profile:one.profile};
 const [read,graph]=await Promise.all([(driver.read||drivers.read)(profile),(driver.learned||drivers.learned)(profile)]);
 if(read.state!=='found') return {state:read.state,own:one.own,skills:null};
 const learned=new Set(graph.state==='found'?(graph.learned||[]):[]);
 return {state:'found',own:one.own,skills:read.skills.filter(skill=>!skill.shared).map(skill=>({...skill,learned:learned.has(skill.name)}))};
}

// The Agent's own profile for a change the database allows, or the change's refusal as a state.
/** @param {any} db @param {string} company @param {unknown} agent @param {string} name @param {string|null} body @param {{address:string,key:string}|null} hermes */
async function changeTarget(db,company,agent,name,body,hermes) {
 if(typeof agent!=='string'||!uuid.test(agent)) return {state:'invalid'};
 if(name===essentialSkill) return {state:'essential'};
 if(sharedSkillNames.includes(name)) return {state:'shared'};
 const target=await signInTarget(db,company,hermes);
 if(!target) return {state:'noEngine'};
 const one=(await skillAgents(db,company))?.find(found=>found.id===agent&&found.own);
 if(!one) return {state:'notOwn'};
 const {error}=await db.rpc('check_skill_write',{c:company,agent,body});
 if(error) return {state:refusals[error.message]||'failed'};
 return {state:'allowed',target:{...target,profile:one.profile}};
}
/** @param {any} db @param {string} company @param {string} agent @param {string} skill @param {'written'|'enabled'|'disabled'} act */
async function logged(db,company,agent,skill,act) {
 const {error}=await db.rpc('log_skill_change',{c:company,agent,skill,act});
 if(error) throw new Error('log_skill_change refused');
}

// One SKILL.md written into one Agent's own profile, then logged. States: written, invalid (no id or no usable header),
// notOwn (an Agent sharing the Company's profile, or one not seen), shared (a shared skill's name), notAllowed (below
// Manager), secret (the text looks like a key), noEngine, or the Engine's failed / refused / unreachable.
/** @param {any} db @param {{company:string,agent:unknown,content:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function changeCompanySkill(db,{company,agent,content,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 // A browser sends a textarea with CRLF line endings, and the Engine reads a SKILL.md back with LF ones.
 const text=typeof content==='string'?content.replace(/\r\n?/g,'\n'):content;
 const name=skillName(text);
 if(!name) return {state:'invalid',name:null};
 const change=await changeTarget(db,company,agent,name,/** @type {string} */(text),hermes);
 if(change.state!=='allowed') return {state:change.state,name:nameless.has(change.state)?null:name};
 const written=await (driver.write||drivers.write)(change.target,{name,content:/** @type {string} */(text)});
 if(written.state==='written') await logged(db,company,/** @type {string} */(agent),name,'written');
 return {state:written.state,name};
}

// One of an Agent's own skills switched on or off for that Agent alone, then logged. States: changed, or those of a write.
/** @param {any} db @param {{company:string,agent:unknown,name:unknown,enabled:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function changeCompanySkillEnabled(db,{company,agent,name,enabled,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 if(typeof name!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)||typeof enabled!=='boolean') return {state:'invalid',name:null};
 const change=await changeTarget(db,company,agent,name,null,hermes);
 if(change.state!=='allowed') return {state:change.state,name:nameless.has(change.state)?null:name};
 const toggled=await (driver.enable||drivers.enable)(change.target,{name,enabled});
 if(toggled.state==='changed') await logged(db,company,/** @type {string} */(agent),name,enabled?'enabled':'disabled');
 return {state:toggled.state,name};
}
