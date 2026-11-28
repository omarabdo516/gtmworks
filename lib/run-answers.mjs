// How a question or a request to act of a Conversation's open Run was answered through this server (#878): the answer
// a person sent, or the choice they made, kept in this process's memory alone for a short while, so the person's other
// tab, whose live read sees the Engine stop waiting, shows the card answered as it was rather than as not allowed. It
// is never stored: an answer this server did not deliver (the Engine's time limit passed, or the server restarted)
// reads as none, and the card then shows as not allowed, never as allowed (spec #864).
// shortcut: one web server process serves an install (server.js); upgrade to a shared store if gtmworks runs several.

/** @typedef {{answer:string|string[]}|{choice:import('./engine.mjs').PermissionChoice}} RunAnswer */
const keepFor=15*60*1000;
const mostKept=2000;
/** @type {Map<string,{at:number,answer:RunAnswer}>} */
const kept=new Map();
const keyOf=(/** @type {string} */ run,/** @type {string} */ id)=>`${run}\n${id}`;

/** @param {string} run @param {string} id @param {RunAnswer} answer */
export function keepAnswer(run,id,answer) {
 const now=Date.now();
 for(const [key,entry] of kept) if(now-entry.at>keepFor||kept.size>=mostKept) kept.delete(key); else break;
 kept.delete(keyOf(run,id));
 kept.set(keyOf(run,id),{at:now,answer});
}

// An answer kept before it was delivered (so a tab that sees the Engine stop waiting at once still finds it) is let go
// again when the Engine did not take it.
/** @param {string} run @param {string} id */
export function forgetAnswer(run,id) { kept.delete(keyOf(run,id)); }

/** @param {string} run @param {string} id @returns {RunAnswer|null} */
export function answerOf(run,id) {
 const entry=kept.get(keyOf(run,id));
 return entry&&Date.now()-entry.at<=keepFor?entry.answer:null;
}
