import { provideSharedSpace, writeSharedSkill, shareSkills } from './hermes.mjs';
import { knowledgeSkill } from './company-knowledge-skill.mjs';
import { engineOf } from './company-engine.mjs';
import { workerHealth } from './engine-health.mjs';

// One shared Skills folder per Company in the bundled Engine (#122, ADR 0016): the Skills of the Company's shared space
// `cs-<company id>`, a profile no Run starts on. The database lists each Company with a recorded profile
// (shared_skills_work): its space's folder once made, the lessons its Owners and Managers approved, and its profiles
// not yet confirmed to read that folder. For each, the worker makes the space once, writes the lessons as the Skill
// "team-lessons", and has each listed profile read that folder alone, auto-load the Skill and hold it locked,
// recording each one it read back; until then no Run starts on that profile. A space or Skill the Engine lost is
// forgotten, so the Company's profiles wait while it is made again. What a Run is told does not change: an approved
// rule still goes with the Runs of the Agent it was told to (lib/conversation-runs.mjs). Beside it the Company knowledge
// (#344), the Skill "company-knowledge": made empty once here, its text written only by the people who edit it
// (lib/company-knowledge-skill.mjs), and auto-loaded and locked by every profile in the same way.
const skill='team-lessons';
const knowledge='company-knowledge';
// The shared Skills' names: no profile's own skill may take one, or it would hide the shared one (lib/company-skills.mjs).
export const sharedSkillNames=[skill,knowledge];
// The Engine refuses a longer SKILL.md (v0.23.0 tools/skill_manager_tool.py 110); the oldest lessons give way first.
const mostCharacters=100000;

/** @param {string[]} lessons the approved lessons, oldest first */
export function teamLessons(lessons) {
 const head=`---\nname: ${skill}\ndescription: Lessons the team approved for every agent\n---\nLessons the team approved. Follow each one.\n\n`;
 const lines=lessons.map(lesson=>`- ${lesson.replace(/\s+/g,' ').trim()}\n`);
 let size=head.length+lines.reduce((total,line)=>total+line.length,0);
 while(size>mostCharacters) size-=lines.shift().length;
 return lines.length?head+lines.join(''):`${head}None yet.\n`;
}

/** @param {any} db @param {string} name @param {object} args */
async function called(db,name,args) {
 const {data,error}=await db.rpc(name,args);
 if(error) throw new Error(error.message);
 return data;
}

/** @param {any} db @param {{hermes?:{address:string,profile:string,key:string,managementAddress?:string}|null,engine?:(company:string|null|undefined)=>object|null,
 *  driver?:{provide:typeof provideSharedSpace,write:typeof writeSharedSkill,share:typeof shareSkills}}} options */
// What the worker last kept for each Company (#772): its row as listed (lessons, folder, profiles). A Company whose row
// is the one last kept is not asked of the Engine again until the slow pass for drift (every five minutes); one whose
// Engine did not answer is left alone until its wait is over (lib/engine-health.mjs).
export const skillsMemory={marks:new Map(),drift:0};
const driftEvery=300000;
export async function keepSharedSkills(db,{hermes,engine=engineOf,driver={provide:provideSharedSpace,write:writeSharedSkill,share:shareSkills},memory=skillsMemory,health=workerHealth,now=Date.now}) {
 const done={made:0,written:0,shared:0};
 const {data:work,error}=await db.rpc('shared_skills_work');
 if(error) throw new Error(error.message);
 const drift=now()-memory.drift>=driftEvery; if(drift) memory.drift=now();
 for(const row of work||[]) {
  const mark=JSON.stringify([row.profile,row.folder,row.lessons,row.profiles]);
  if(!drift&&memory.marks.get(row.company_id)===mark) continue;
  const at=hermes??await engine(row.company_id);
  if(!at) continue;
  if(at.address&&!health.ready(at.address)) continue;
  try {
   if(await keepOne(db,driver,at,row,done)===true) memory.marks.set(row.company_id,mark);
   if(at.address) health.answered(at.address);
  }
  catch(failure) { console.error('Shared Skills not kept:',row.company_id,failure?.message||'unknown error'); }
 }
 return done;
}

async function keepOne(db,driver,hermes,{company_id:company,profile:space,folder:recorded,lessons,profiles},done) {
 let folder=recorded; let kept=true;
 if(!folder) {
  const made=await driver.provide(hermes,{name:space});
  if(made.state!=='provided') return;
  folder=await called(db,'record_shared_space',{c:company,folder:made.folder});
  done.made++;
 }
 const lost=()=>called(db,'forget_shared_space',{c:company});
 const written=await driver.write(hermes,{space,name:skill,content:teamLessons(lessons)});
 if(written.state==='missing') return await lost();
 // A profile is pointed at the folder only once the Skill is there to lock.
 if(written.state!=='written'&&written.state!=='unchanged') return;
 if(written.state==='written') done.written++;
 const known=await driver.write(hermes,{space,name:knowledge,content:knowledgeSkill({}),onlyNew:true});
 if(known.state==='missing') return await lost();
 if(known.state!=='written'&&known.state!=='unchanged') return;
 for(const {profile} of profiles) {
  let all=true;
  for(const name of [skill,knowledge]) {
   const shared=await driver.share(hermes,{profile,folder,skill:name});
   if(shared.state==='missing') return await lost();
   if(shared.state==='shadowed') console.error('Shared Skills hidden by a profile\'s own Skill:',company,profile);
   all=all&&shared.state==='shared';
  }
  if(all&&await called(db,'record_shared_skills',{c:company,engine_profile:profile})) done.shared++;
  kept=kept&&all;
 }
 return kept;
}
