import { isAgentProfile } from './agent-toolsets.mjs';
import { cut } from './agent-tools.mjs';

// The parts of a Run's request and of what a Run waits on that a Conversation's send (lib/conversation-start.mjs), a
// Channel's Runs (lib/channel-runs.mjs) and a Handover (lib/handovers.mjs) share.

// A Member's own note goes with their runs only, as the run's instructions (never into the message or the Company's
// memory); a run with no note carries none.
/** @param {string|null|undefined} note */
export const noteInstructions=note=>note?.trim()?`The person writing this message keeps the note below about how they like to work. Follow it for this person only; it is their own preference, not the company's memory, and it is not something to save.\n\n${note.trim()}`:undefined;
// An Agent made from a ready-made role (#14) has its own instructions, fitted to its Company; they come first. They
// never change once the Agent is made, so a retry still sends the same request. An Agent on its own profile has its
// instructions as that profile's soul (ADR 0016), so its Runs carry none of them. This is read from the profile the Run
// was pinned to, so every retry of a start sends the same body.
/** @param {{profile:string}} connection @param {string|null|undefined} instructions */
export const agentInstructionsFor=(connection,instructions)=>isAgentProfile(connection.profile)?null:instructions;

// A message's words and its images (#155), each image the one image part the Engine reads.
/** @param {string} text @param {{content_type:string,base64:string}[]} images */
export const imageInput=(text,images)=>[{role:'user',content:[...(text.trim()?[{type:'text',text}]:[]),
 ...images.map(image=>({type:'image_url',image_url:{url:`data:${image.content_type};base64,${image.base64}`}}))]}];

// The question as the card keeps it (a channel's track_channel_question): only the question's text is ever shortened,
// since it is never sent back; choices that cannot all be drawn (more than four, or one longer than 1000 characters) are
// left out, so the person answers in words.
/** @param {import('./engine.mjs').RunQuestion} question */
export const askedOf=question=>{
 const text=question.text.trim();
 const choices=question.choices.length<=4&&question.choices.every(choice=>choice.trim()&&choice.length<=1000)?question.choices:[];
 return {id:question.id,text:cut(text,4000),choices,multiple:question.multiple};
};

// The request as the card keeps it: the engine's words trimmed, and only shortened past what the card holds, since they
// are never sent back. Postgres's jsonb takes no NUL and no half of a surrogate pair, so neither is kept: either would
// refuse every read of the Run.
/** @param {string} text */
const keptWords=text=>cut(text.replaceAll('\u0000','').toWellFormed().trim(),4000);
// What the Agent wrote in the message that paused its Run (#647) goes with the card that pause keeps, as its message
// above the card: kept as a reply is (200,000 characters, no NUL), once, on the card that first carries it.
/** @param {import('./engine.mjs').RunState} result */
export const saidOf=result=>typeof result.said==='string'?cut(result.said.replaceAll('\u0000','').toWellFormed().trim(),200000)||null:null;
/** @template {object} T @param {T} asking @param {string|null} said */
export const withSaid=(asking,said)=>said?{...asking,said}:asking;
/** @param {import('./engine.mjs').RunPermission} permission */
// What an always answer would keep (#166) goes with it, so the Company's record can say who allowed each standing entry.
export const requestedOf=permission=>({id:permission.id,description:keptWords(permission.description),command:keptWords(permission.command),choices:permission.choices,
 allows:(permission.allows??[]).filter(key=>!key.includes('\u0000')&&key.toWellFormed()===key)});
