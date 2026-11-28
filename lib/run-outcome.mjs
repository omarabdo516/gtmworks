// How a Conversation's Run ended (#879), as its live read (app/api/conversation-live) tells the page: read from the Run's
// own record on the Engine, once its events end or before they are followed at all, so a person who comes back after
// the Run ended is told at once how it went rather than shown it again. A Run that finished well has ended; one that
// failed or was stopped did not finish, with the cause the Engine names for a failure (no model at all, #422; a model
// call no retry can fix, #457; the usage ran out, and when it resets, #642); one the Engine no longer knows is gone.
// Null while it works, or when the Engine did not answer: nothing is known of its end yet. gtmworks keeps none of it.
/** @typedef {{end:'ended',outcome?:'failed'|'stopped',cause?:'noModel'|'credit'|'key'|'model'|'access',resetsAt?:string,ranOut?:string[]}|{end:'gone'}} RunEnd */
/** @param {import('./engine.mjs').RunState} run @returns {RunEnd|null} */
export function runEnd(run) {
 if(run.state==='completed') return {end:'ended'};
 if(run.state==='lost') return {end:'gone'};
 if(run.state==='stopped') return {end:'ended',outcome:'stopped'};
 if(run.state!=='failed') return null;
 const cause=run.noModel?'noModel':run.modelRefused??null;
 return {end:'ended',outcome:'failed',...(cause?{cause}:{}),...(cause==='access'&&run.resetsAt?{resetsAt:run.resetsAt}:{})};
}
