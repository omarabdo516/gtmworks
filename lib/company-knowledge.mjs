// The Company knowledge (#27): what every Agent of a Company must know, in five parts, kept once per Company. An Owner or
// a Manager edits a part, every Member reads it, and every run of the Company's Agents is given its text as it was at
// the run's first start (pin_run_knowledge). The database keeps the same parts in the same order
// (public.company_knowledge_parts); tests/company-knowledge.test.mjs keeps the two equal.

// [key, message key of its title, English heading in a run's instructions]
export const knowledgeParts=[
 ['voice','knowVoice','Brand voice'],
 ['audience','knowAudience','Audience'],
 ['products','knowProducts','Products and prices'],
 ['banned','knowBanned','Banned claims'],
 ['decisions','knowDecisions','Decisions']];

/** @param {unknown} requested */
export const pickPart=requested=>knowledgeParts.find(([part])=>part===requested)?.[0]??'voice';

// The pinned parts as a run's instructions, in the registry's order, each under its heading; nothing when every part is
// empty. Agents also keep memories of their own, so they are told not to keep this text: the next run brings the latest.
/** @param {unknown} parts */
export const knowledgeInstructions=parts=>{
 const given=Array.isArray(parts)?parts:[];
 const sections=knowledgeParts.flatMap(([part,,heading])=>{
  const body=given.find(entry=>entry?.part===part)?.body;
  return typeof body==='string'&&body.trim()?[`## ${heading}\n${body.trim()}`]:[];
 });
 return sections.length?`The company keeps the knowledge below for all of its agents. Follow it in all your work for this company. Its people keep it up to date and every run is given its latest text, so do not save it to your memory.\n\n${sections.join('\n\n')}`:undefined;
};

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
