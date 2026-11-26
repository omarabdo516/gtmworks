// The install proof's Kanban step (spec #831, #833, scripts/check-install-profiles.mjs): the fake model's script for the
// sessions the Engine's board starts, and what the step reads off a Card's Runs.
import { randomUUID } from 'node:crypto';

/** @typedef {{role?:string,content?:unknown,tool_calls?:{function?:{name?:string}}[],tool_call_id?:string}} Message */
/** @typedef {{outcome?:string|null,summary?:string|null}} Run */

// What a session was told by its user turns, whether each is one string or a list of parts. Hermes's system prompt is
// left out: it lists the bundled Skills, `sdlc-review` among them, for every session alike (run 45849314052).
/** @param {Message[]} messages */
const userTurns=messages=>messages.filter(message=>message.role==='user')
 .map(({content})=>typeof content==='string'?content:Array.isArray(content)
  ?content.map(part=>typeof part?.text==='string'?part.text:JSON.stringify(part)).join('\n'):JSON.stringify(content??'')).join('\n');

// A reviewer is told so in its first user turn: the review dispatch preloads `sdlc-review`, and the preloaded skill's
// line opens the prompt (agent/skill_commands.py, build_preloaded_skills_prompt; gateway/session_kanban.py).
const reviewerLine='with the "sdlc-review" skill preloaded';

/** @param {string} name @param {Record<string, unknown>} args @param {string} [id] */
const call=(name,args,id=`call_${name}_${randomUUID().slice(0,8)}`)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});

/**
 * The fake model, scripted by what each session was told: the main Agent's Conversation, Card A's worker and reviewer,
 * Card B's worker and reviewer, and the decomposer. A session is told its Card's title in its own prompt; a tool's
 * result is kept by the call it answers. Card A's reviewer waits on `hold` (the person's pass, or the step's end).
 * @param {{marker:string,worker:string,person:string,hold:()=>unknown}} options
 */
export function kanbanPlan({marker,worker,person,hold}) {
 const tag={card:`KANBAN-CARD ${marker}`,job:`KANBAN-JOB ${marker}`,idea:`KANBAN-IDEA ${marker}`,ask:`KANBAN-ASK ${marker}`,
  answer:`ANSWER-${marker}`,back:`RETURN-${marker}`};
 /** @type {Map<string,string>} */
 const results=new Map();
 const seen={work:/** @type {{answer:boolean,back:boolean,person:boolean}[]} */([]),reviews:0,decomposer:/** @type {unknown[]} */([]),told:false};
 // Card A's first command also opens the person's file on the Card (#843) where the Engine's prompt names it, its
 // absolute path in the Engine's Kanban attachments folder (hermes_cli/kanban_db_context.py, _ctx_attachments), copies
 // it into the work folder and tries to write beside it: the folder is mounted read-only into the sandbox at that path.
 // Its last line says whether the write was refused.
 /** @param {string} text */
 const work=text=>{
  const file=text.match(/→ `(\/opt\/data\/kanban\/attachments\/[^`\n]+)`/)?.[1]??'/opt/data/kanban/attachments/not-named-in-the-prompt';
  const folder=file.slice(0,file.lastIndexOf('/'));
  return `hostname; pwd; printf '%s' '${marker}-card' > /work/${marker}-card.txt; cp '${file}' /work/${marker}-attachment.txt; `
   +`if touch '${folder}/${marker}-planted' 2> /dev/null; then echo planted; else echo refused; fi`;
 };
 // Hermes flags a recursive delete under the root path as dangerous (tools/approval_detection.py, probe section 3).
 const danger=`mkdir -p /tmp/${marker}-danger/gone && rm -rf /tmp/${marker}-danger/gone && echo removed`;
 /** @param {Message[]} messages @param {{tools?:{function?:{name?:string}}[],model?:unknown}} body */
 const plan=async(messages,body={})=>{
  const text=userTurns(messages);
  const called=messages.filter(message=>message.role==='assistant').flatMap(message=>(message.tool_calls||[]).map(made=>made.function?.name));
  for(const message of messages) if(message.role==='tool'&&message.tool_call_id) results.set(message.tool_call_id,typeof message.content==='string'?message.content:JSON.stringify(message.content));
  const kanbanTools=(body.tools||[]).some(tool=>String(tool.function?.name).startsWith('kanban_'));
  // A board session's own Card is the one its prompt's header names (hermes_cli/kanban_db_context.py): the prompt also
  // lists the Agent's recent work on other Cards, and Card A and Card B, worked side by side, are each that of the other.
  const own=text.match(/^# Kanban task [^:\n]+: (.*)$/m)?.[1]??'';
  if(text.includes(tag.ask)) {
   // The main Agent: it makes Card B for the second Agent once, and may be told of its result in a later user turn.
   if(text.includes('[kanban]')) seen.told=true;
   if(!called.includes('kanban_create')) return call('kanban_create',{title:tag.job,body:'Write the job and send it for review. NO-QUESTION',assignee:worker},'call_kanban_create');
   return null;
  }
  if(kanbanTools&&own&&text.includes(reviewerLine)) {
   seen.reviews++;
   if(own.includes(tag.job)) return called.includes('kanban_complete')?null:call('kanban_complete',{summary:`Reviewed and passed by the reviewing Agent. JOB-PASSED-${marker}`});
   // Card A's review is the person's: a reviewer the Engine's own tick starts meanwhile waits for them, then says nothing.
   await hold();
   return null;
  }
  if(kanbanTools&&own.includes(tag.job)) return called.includes('kanban_request_review')?null:call('kanban_request_review',{summary:`The job is written. JOB-DONE-${marker}`});
  if(kanbanTools&&own.includes(tag.card)) {
   const run={answer:text.includes(tag.answer),back:text.includes(tag.back),person:text.includes(person)};
   seen.work.push(run);
   if(!run.answer) {
    if(!called.includes('terminal')) return call('terminal',{command:work(text)},'call_kanban_work');
    if(called.filter(name=>name==='terminal').length<2) return call('terminal',{command:danger},'call_kanban_danger');
    return called.includes('kanban_block')?null:call('kanban_block',{reason:`Which colour should the brief use? QUESTION-${marker}`});
   }
   return called.includes('kanban_request_review')?null:call('kanban_request_review',{summary:run.back?`The brief, shorter and in blue. SUMMARY-2-${marker}`:`The brief, in blue. SUMMARY-1-${marker}`});
  }
  if(text.includes(tag.idea)) seen.decomposer.push(body.model);
  return null;
 };
 return {plan,tag,results,seen};
}

// The last Run of a Card that ended `review_requested` with a summary holding `mark`, or -1: a worker sent it for review.
/** @param {Run[]} runs @param {string} mark */
const requestAt=(runs,mark)=>runs.findLastIndex(run=>run.outcome==='review_requested'&&String(run.summary??'').includes(mark));

// Whether a worker sent the Card for review with the summary holding `mark` (Hermes's `kanban_request_review`).
/** @param {Run[]} runs @param {string} mark */
export const reviewRequested=(runs,mark)=>requestAt(runs,mark)>=0;

// Whether the Card was passed after its review: a Run after that request ended `completed` with a summary holding
// `passed`. A worker that completes its own Card, as every one did on run 45849314052, is no pass.
/** @param {Run[]} runs @param {string} requested @param {string} passed */
export const passedAfterReview=(runs,requested,passed)=>{
 const at=requestAt(runs,requested);
 return at>=0&&runs.slice(at+1).some(run=>run.outcome==='completed'&&String(run.summary??'').includes(passed));
};
