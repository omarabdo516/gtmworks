import { provideSharedSpace, writeSharedSkill, shareSkills } from './hermes.mjs';

// One shared Skills folder per Company in the bundled Engine (#122, ADR 0016): the Skills of the Company's shared space
// `cs-<company id>`, a profile no Run starts on. The database lists each Company with a recorded profile
// (shared_skills_work): its space's folder once made, the lessons its Owners and Managers approved, and its profiles
// not yet confirmed to read that folder. For each, the worker makes the space once, writes the lessons as the Skill
// "team-lessons", and has each listed profile read that folder alone, auto-load the Skill and hold it locked,
// recording each one it read back; until then no Run starts on that profile. A space or Skill the Engine lost is
// forgotten, so the Company's profiles wait while it is made again. What a Run is told does not change: an approved
// rule still goes with the Runs of the Agent it was told to (lib/conversation-runs.mjs).
const skill='team-lessons';
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

/** @param {any} db @param {{hermes:{address:string,profile:string,key:string,managementAddress?:string}|null,
 *  driver?:{provide:typeof provideSharedSpace,write:typeof writeSharedSkill,share:typeof shareSkills}}} options */
export async function keepSharedSkills(db,{hermes,driver={provide:provideSharedSpace,write:writeSharedSkill,share:shareSkills}}) {
 const done={made:0,written:0,shared:0};
 if(!hermes) return done;
 const {data:work,error}=await db.rpc('shared_skills_work');
 if(error) throw new Error(error.message);
 for(const row of work||[]) {
  try { await keepOne(db,driver,hermes,row,done); }
  catch(failure) { console.error('Shared Skills not kept:',row.company_id,failure?.message||'unknown error'); }
 }
 return done;
}

async function keepOne(db,driver,hermes,{company_id:company,profile:space,folder:recorded,lessons,profiles},done) {
 let folder=recorded;
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
 for(const {profile} of profiles) {
  const shared=await driver.share(hermes,{profile,folder,skill});
  if(shared.state==='missing') return await lost();
  if(shared.state==='shared'&&await called(db,'record_shared_skills',{c:company,engine_profile:profile})) done.shared++;
 }
}
