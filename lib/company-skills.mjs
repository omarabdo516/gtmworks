import { hermesAt } from './bundled-hermes.mjs';
import { signInTarget } from './company-sign-in.mjs';
import { readSkills, writeSkill } from './hermes.mjs';

// A Company's skills (#343, ADR 0011, ADR 0016) live only in the bundled Engine: each Agent's own profile, and the
// Company's shared folder (team-lessons, written by lib/shared-skills.mjs) that every profile reads. `db` is the
// signed-in person's own session, which says which Agents they see and the profile each runs on; `service` only reads
// the key of the Company's bundled Connection. The profile never leaves this module.
const drivers={read:readSkills,write:writeSkill};
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
/** @param {any} db @param {any} service @param {{company:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function readCompanySkills(db,service,{company,hermes=hermesAt(),driver={}}) {
 const target=await signInTarget(db,company,hermes);
 const agents=target&&await skillAgents(db,company);
 if(!agents) return null;
 const read=driver.read||drivers.read;
 const reads=new Map(await Promise.all([...new Set(agents.map(agent=>agent.profile))].map(async profile=>/** @type {const} */([profile,await read({...target,profile})]))));
 return agents.map(({id,name,own,profile})=>{ const found=reads.get(profile); return {id,name,own,skills:found?.state==='found'?found.skills:null}; });
}

// One SKILL.md written into one Agent's own profile. The caller has checked the person may change skills. States:
// written, invalid (no id or no usable header), notOwn (an Agent sharing the Company's profile, or one not seen),
// shared (the name is the shared folder's), noEngine, or the Engine's failed / refused / unreachable.
/** @param {any} db @param {any} service @param {{company:string,agent:unknown,content:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function changeCompanySkill(db,service,{company,agent,content,hermes=hermesAt(),driver={}}) {
 const name=skillName(content);
 if(!name||typeof agent!=='string'||!uuid.test(agent)) return {state:'invalid',name:null};
 const target=await signInTarget(db,company,hermes);
 if(!target) return {state:'noEngine',name:null};
 const one=(await skillAgents(db,company))?.find(found=>found.id===agent&&found.own);
 if(!one) return {state:'notOwn',name:null};
 const written=await (driver.write||drivers.write)({...target,profile:one.profile},{name,content:/** @type {string} */(content)});
 return {state:written.state,name};
}
