import { knowledgeParts } from './company-knowledge.mjs';
import { readSharedSkill, writeSharedSkill } from './hermes.mjs';
import { oneAtATime } from './one-at-a-time.mjs';

// The Company knowledge (#27, #344) is kept in the bundled Engine, as the shared Skill "company-knowledge" of the
// Company's shared space `cs-<company id>` (ADR 0016), beside "team-lessons": every Agent profile of the Company
// auto-loads it (lib/shared-skills.mjs), so no Run is told it. gtmworks keeps who may edit it (check_company_knowledge,
// log_company_knowledge) and the log of each edit, never the text.
const skill='company-knowledge';
const spaceOf=company=>`cs-${String(company).replaceAll('-','')}`;
const marker=part=>`<!-- part: ${part} -->`;
const markers=new RegExp(`^<!-- part: (${knowledgeParts.map(([part])=>part).join('|')}) -->\\n## [^\\n]*\\n`,'m');

// The Skill: each part that has text under its heading, in the parts' order, each opened by a marker the reader splits on.
/** @param {Record<string,string>} parts */
export function knowledgeSkill(parts) {
 const head=`---\nname: ${skill}\ndescription: What every agent of the company must know\n---\nThe company keeps the knowledge below for all of its agents. Follow it in all your work for this company. Its people keep it up to date, so do not save it to your memory.\n\n`;
 const sections=knowledgeParts.filter(([part])=>parts[part]).map(([part,,heading])=>`${marker(part)}\n## ${heading}\n${parts[part]}\n`);
 return sections.length?head+sections.join('\n'):`${head}None yet.\n`;
}
/** @param {string} content @returns {Record<string,string>} */
const partsOf=content=>{
 const pieces=content.split(markers); const parts={};
 for(let at=1;at<pieces.length;at+=2) if(pieces[at+1].trim()) parts[pieces[at]]=pieces[at+1].trim();
 return parts;
};

// found (with each part that has text), none when the Company has no shared space yet, or the Engine's failure.
/** @param {any} hermes @param {string} company @returns {Promise<{state:string,parts:Record<string,string>|null}>} */
export async function readKnowledge(hermes,company) {
 if(!hermes) return {state:'none',parts:{}};
 const read=await readSharedSkill(hermes,{space:spaceOf(company),name:skill});
 if(read.state==='found') return {state:'found',parts:partsOf(read.content)};
 if(read.state==='absent') return {state:'found',parts:{}};
 if(read.state==='missing') return {state:'none',parts:{}};
 return {state:read.state,parts:null};
}

// One app process serializes a Company's saves, so two parts saved at once never overwrite each other.
const saving=oneAtATime();

const refusals=['companyKnowledgeNotAllowed','companyKnowledgeInvalid','companyKnowledgeTooLong','companyKnowledgeSecret'];
// One part saved as the signed-in person (`db` is their session): check_company_knowledge checks the Role, the part and
// the text and answers it trimmed; the same text as the Skill holds changes nothing; an empty one clears the part. The
// edit is logged once the Engine holds it. The text itself is never logged. Returns a message key.
/** @param {any} db @param {any} hermes @param {{company:string,part:unknown,body:unknown}} edit */
export async function saveKnowledge(db,hermes,{company,part,body}) {
 if(typeof part!=='string'||typeof body!=='string') return 'companyKnowledgeInvalid';
 const {data:kept,error}=await db.rpc('check_company_knowledge',{c:company,part,body});
 if(error) return refusals.includes(error.message)?error.message:'companyKnowledgeFailed';
 if(typeof kept!=='string'||!hermes) return 'companyKnowledgeFailed';
 return saving(company,async()=>{
  const read=await readKnowledge(hermes,company);
  if(read.state!=='found'||!read.parts) return 'companyKnowledgeFailed';
  if((read.parts[part]??'')===kept) return 'companyKnowledgeUnchanged';
  const parts={...read.parts,[part]:kept};
  const written=await writeSharedSkill(hermes,{space:spaceOf(company),name:skill,content:knowledgeSkill(parts)});
  if(written.state!=='written'&&written.state!=='unchanged') return 'companyKnowledgeFailed';
  const {error:unlogged}=await db.rpc('log_company_knowledge',{c:company,part,cleared:!kept});
  if(unlogged) throw new Error('log_company_knowledge refused');
  return kept?'companyKnowledgeSaved':'companyKnowledgeCleared';
 });
}
