import { commentLimit, nameOf, reach, wrote } from './company-card-talk.mjs';

// A Card that needs review is passed or sent back, by an Agent as Hermes does it or by a person (spec #831, #839;
// docs/engine-probes/kanban-board.md). A worker hands its work in with kanban_request_review (its Run ends
// `review_requested` with its summary, the Card in `review`); the Engine's own tick then starts a reviewing Agent, which
// passes with kanban_complete or returns with kanban_request_changes(reason). A person decides instead:
//
// - A pass completes the Card with its Agent's summary and one more line naming the person, because the Engine records no
//   identity of its own. The Engine keeps that summary on a Run of no length it makes for the completion, which no claim
//   names; only there is the line read as a person's, so an Agent that writes the same words is still the Agent.
// - A return is the reason as a comment under the person's name, then a move back to ready, which restores the Agent that
//   did the work (review_reopened), and a dispatcher tick, so that Agent's next Run reads the reason at once.
// - A reviewing Agent the Engine already started is stopped first (reclaim, which puts the Card back in review), so the
//   decision is the person's alone, as the install proof's check does it.
//
// `db` is the signed-in person's own session: the route has checked their Role (Owner or Manager) before anything here
// reaches the Engine. No answer names a profile, the Engine's address or its key.

/** The line a person's pass adds to the Agent's summary. @param {string} name */
const passLine=name=>`Passed by ${name.replace(/\s+/g,' ').trim()}`;
/** The person a pass's summary names, or null. @param {string|null} summary */
const passer=summary=>(summary??'').trimEnd().match(/(?:^|\n\n)Passed by ([^\n]+)$/)?.[1]?.trim()||null;
/** The summary without the pass's line. @param {string} summary */
export const withoutPassLine=summary=>summary.trimEnd().replace(/(?:^|\n\n)Passed by [^\n]+$/,'');

/** @typedef {{state:'requested'|'passed'|'sentBack',profile:string|null,person:string|null,text:string|null,at:number|null}} ReviewState */

/**
 * The Card's latest review, from the Engine's own record of it: handed in (its Agent and summary), passed or sent back (by
 * an Agent's profile or a person's name, a return with its reason); null for a Card that never waited on a review, or
 * one done since without one. With it, the Runs that passed the Card (by a person's name, or null for an Agent) and the
 * moves back to ready a person made (the event's id, by their name).
 * @param {import('./engine/board.mjs').EngineCardDetail} task @param {(name:string)=>boolean} isProfile
 * @returns {{review:ReviewState|null,passes:Map<number,string|null>,returns:Map<number,string>}}
 */
export function reviewsOf(task,isProfile) {
 /** @type {ReviewState|null} */
 let review=null;
 const passes=new Map(); const returns=new Map();
 const claimed=new Set(task.events.filter(event=>event.kind==='claimed'&&event.run!=null).map(event=>event.run));
 const runOf=(/** @type {number|null} */ id)=>task.runs.find(run=>run.id===id);
 task.events.forEach((event,index)=>{
  const run=runOf(event.run);
  if(event.kind==='review_requested') review={state:'requested',profile:run?.profile??null,person:null,text:run?.summary??null,at:event.at};
  else if(event.kind==='changes_requested') review={state:'sentBack',profile:run?.profile??null,person:null,text:run?.summary??null,at:event.at};
  else if(event.kind==='review_reopened') {
   // A person's return: the comment gtmworks wrote under their name just before the move.
   const before=task.events[index-1];
   const person=before?.kind==='commented'&&before.author&&!isProfile(before.author)?before.author:null;
   const reason=person?[...task.comments].reverse().find(comment=>comment.author===person&&(comment.at??0)<=(event.at??Infinity)):null;
   review={state:'sentBack',profile:null,person,text:reason?.body??null,at:event.at};
   if(person) returns.set(event.id,person);
  } else if(event.kind==='completed') {
   if(review?.state!=='requested'||!run) { review=null; return; }
   const person=claimed.has(run.id)?null:passer(run.summary);
   review={state:'passed',profile:person?null:run.profile,person,text:null,at:event.at};
   passes.set(run.id,person);
  }
 });
 return {review,passes,returns};
}

const anyProfile=(/** @type {string} */ name)=>/^(ag|co)-[0-9a-f]{32}$/.test(name);
/** @typedef {import('./company-card-talk.mjs').Refused} Refused */

/**
 * The Card as the person may decide its review: the Engine, the task and their name, with a reviewing Agent the Engine
 * started stopped first; or why not.
 * @param {any} db @param {string} company @param {string} person @param {unknown} card
 */
async function deciding(db,company,person,card) {
 const found=await reach(db,company,card);
 if('state' in found) return found;
 const {engine,task}=found;
 if(reviewsOf(task,anyProfile).review?.state!=='requested'||!['review','running'].includes(task.status)) return {state:/** @type {const} */('notInReview')};
 const name=await nameOf(db,person);
 if(!name) return {state:/** @type {const} */('failed')};
 if(task.status==='running') {
  const stopped=await engine.board.stop({id:task.id,reason:`Stopped by ${name}, who decides the review`});
  if(stopped.state!=='stopped'&&stopped.state!=='idle') return wrote(stopped.state);
 }
 return {engine,task,name};
}

/**
 * Passes a Card that waits on a review: it is done, with its Agent's summary and the line naming the person.
 * @param {any} db the person's own session @param {{company:string,person:string,card:unknown}} pass
 * @returns {Promise<{state:'passed'|'notInReview'|Refused}>}
 */
export async function passCard(db,{company,person,card}) {
 const found=await deciding(db,company,person,card);
 if('state' in found) return found;
 const {engine,task,name}=found;
 const handedIn=[...task.runs].reverse().find(run=>run.outcome==='review_requested')?.summary?.trim()??'';
 const done=await engine.board.complete({id:task.id,summary:[handedIn,passLine(name)].filter(Boolean).join('\n\n')});
 if(done.state==='conflict') return {state:'notInReview'};
 if(done.state!=='completed') return wrote(done.state);
 return {state:'passed'};
}

/**
 * Sends a Card that waits on a review back with the person's reason: the reason is a comment under their name, and the
 * Agent that did the work goes on at once, its next Run given the reason. A return needs a reason.
 * @param {any} db the person's own session @param {{company:string,person:string,card:unknown,reason:unknown}} back
 * @returns {Promise<{state:'sentBack'|'notInReview'|Refused}>}
 */
export async function sendBackCard(db,{company,person,card,reason}) {
 const text=typeof reason==='string'?reason.trim():'';
 if(!text||text.length>commentLimit) return {state:'invalid'};
 const found=await deciding(db,company,person,card);
 if('state' in found) return found;
 const {engine,task,name}=found;
 const commented=await engine.board.comment({id:task.id,author:name,body:text});
 if(commented.state!=='commented') return wrote(commented.state);
 const moved=await engine.board.move({id:task.id,status:'ready'});
 // The comment stays, as any comment does, when the Card left its review meanwhile.
 if(moved.state==='conflict') return {state:'notInReview'};
 if(moved.state!=='moved') return wrote(moved.state);
 await engine.board.dispatch();
 return {state:'sentBack'};
}
