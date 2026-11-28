// How a question or a request to act of a Conversation's open Run was answered through this server (#878): the answer
// a person sent, or the choice they made, kept in this process's memory alone for a short while, so the person's other
// tab, whose live read sees the Engine stop waiting, shows the card answered as it was rather than as not allowed. It
// is never stored: an answer this server did not deliver (the Engine's time limit passed, or the server restarted)
// reads as none, and the card then shows as not allowed, never as allowed (spec #864).
// An answer is claimed before it is delivered and confirmed once the Engine took it: while it is only claimed, the card
// stays open for every tab (a read that sees the Engine stop waiting then waits for the delivery's outcome), so no tab
// shows a choice the Engine never took. A claim the Engine did not take is let go, and the card then settles as none.
// shortcut: one web server process serves an install (server.js); upgrade to a shared store if gtmworks runs several.

/** @typedef {{answer:string|string[]}|{choice:import('./engine.mjs').PermissionChoice}} RunAnswer */
const keepFor=15*60*1000;
const mostKept=2000;
/** @type {Map<string,{at:number,answer:RunAnswer,confirmed:boolean}>} */
const kept=new Map();
const keyOf=(/** @type {string} */ run,/** @type {string} */ id)=>`${run}\n${id}`;

const live=(/** @type {{at:number}|undefined} */ entry)=>!!entry&&Date.now()-entry.at<=keepFor;

// Claims the card for this answer, unless a tab already claimed it: true when this one is the claim to deliver.
/** @param {string} run @param {string} id @param {RunAnswer} answer */
export function claimAnswer(run,id,answer) {
 const now=Date.now();
 for(const [key,entry] of kept) if(now-entry.at>keepFor||kept.size>=mostKept) kept.delete(key); else break;
 if(live(kept.get(keyOf(run,id)))) return false;
 kept.set(keyOf(run,id),{at:now,answer,confirmed:false});
 return true;
}
/** @param {string} run @param {string} id */
export function confirmAnswer(run,id) { const entry=kept.get(keyOf(run,id)); if(entry) entry.confirmed=true; }
/** @param {string} run @param {string} id */
export function forgetAnswer(run,id) { kept.delete(keyOf(run,id)); }

// The answer delivered for a card, `claimed` while its delivery is still on its way, or none.
/** @param {string} run @param {string} id @returns {RunAnswer|'claimed'|null} */
export function answerOf(run,id) {
 const entry=kept.get(keyOf(run,id));
 return !live(entry)?null:entry?.confirmed?entry.answer:'claimed';
}
