import { agentEngine, companyEngine } from './engine/handle.mjs';
import { essentialSkill } from './engine/handle.mjs';
import { readSettings, learningModeOf } from './engine-settings.mjs';

// One learned Skill's page in Settings › Learning (#181): the Skill's current text from GET /api/skills/content for the
// Agent's own Engine profile, beside that Agent's name and its learning mode (#28). The pinned Engine has no management
// route over the Skill ledger (engine.md), so nothing before or after the last change and no version are read, and the
// page offers no restore. The person's role is read from the database here, not taken from the address: a Viewer has no
// Learning section, so the page is refused for them, and a person outside the Company has none. The Engine is reached
// only through the Engine handle (lib/engine/, ADR 0008); the profile never leaves this module.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const skillName=/^[a-z0-9][a-z0-9_-]{0,63}$/;
// Who reads the Learning section: every Role but a Viewer. The database answers for the signed-in person.
const readers=new Set(['owner','manager','contributor']);

/** @param {any} db @param {string} company @param {unknown} person */
async function mayReadLearning(db,company,person) {
 if(typeof person!=='string'||!uuid.test(person)) return false;
 const {data,error}=await db.from('members').select('role').eq('company_id',company).eq('person_id',person).is('removed_at',null).maybeSingle();
 return !error&&readers.has(data?.role);
}

// What one Skill's page draws, or null when this person has no page here. States: found with the text, and absent /
// refused / unreachable / failed when the Engine cannot give it. The Agent and its mode are kept even then, so the page
// still says whose Skill it is.
/** @param {any} db @param {{company:string,agent:string,name:string,person:string}} request */
export async function readCompanySkillPage(db,{company,agent,name,person}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)||typeof name!=='string'||!skillName.test(name)) return null;
 // The Engine's essential skill is never drawn in gtmworks, and its name is the Engine's, so no page names it (#180).
 if(name===essentialSkill) return null;
 if(!await mayReadLearning(db,company,person)) return null;
 const [seen,engine]=await Promise.all([agentEngine(db,{company,agent}),companyEngine(company,{reader:db})]);
 const one=seen.agent; const profile=seen.engine;
 if(!engine||!one||!profile) return null;
 const [read,settings]=await Promise.all([profile.skills.readOwn({name}),readSettings(profile,{root:engine.on('default')})]);
 const page={agent:{id:one.agent,name:one.name,own:one.own===true},skill:name,mode:settings.state==='found'?learningModeOf(settings.settings):null};
 return read.state==='found'?{state:'found',...page,content:read.content}:{state:read.state,...page,content:null};
}
