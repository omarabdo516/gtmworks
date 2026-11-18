// The Company knowledge (#27): what every Agent of a Company must know, in five parts, kept once per Company as the
// shared Skill company-knowledge (#344, lib/company-knowledge-skill.mjs). An Owner or a Manager edits a part and every
// Member reads it. The database checks the same parts in the same order (public.company_knowledge_parts);
// tests/company-knowledge.test.mjs keeps the two equal.

// [key, message key of its title, English heading in the Skill]
export const knowledgeParts=[
 ['voice','knowVoice','Brand voice'],
 ['audience','knowAudience','Audience'],
 ['products','knowProducts','Products and prices'],
 ['banned','knowBanned','Banned claims'],
 ['decisions','knowDecisions','Decisions']];

/** @param {unknown} requested */
export const pickPart=requested=>knowledgeParts.find(([part])=>part===requested)?.[0]??'voice';

// A part's text as the reference shows it (knowBodyHTML): each non-blank line, trimmed, is a paragraph, and a line that
// starts with "•" or "-" is a bullet; bullets in a row form one list.
/** @param {string} body @returns {({kind:'p',text:string}|{kind:'ul',items:string[]})[]} */
export const knowledgeBlocks=body=>{
 /** @type {({kind:'p',text:string}|{kind:'ul',items:string[]})[]} */
 const blocks=[];
 for(const line of String(body??'').split('\n').map(line=>line.trim()).filter(Boolean)) {
  if(!/^[•-]/.test(line)) { blocks.push({kind:'p',text:line}); continue; }
  const item=line.replace(/^[•-]\s*/,''); const last=blocks.at(-1);
  if(last?.kind==='ul') last.items.push(item); else blocks.push({kind:'ul',items:[item]});
 }
 return blocks;
};
