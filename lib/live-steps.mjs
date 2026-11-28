// The steps of a Run while it works (#646), as the page draws them: the Engine's tool calls, read as they happen through
// the engine contract (`steps`), folded into what the reader sees at each moment. A line is the whole view, never a
// change to one, so a reader who comes in late or reads again is drawn the same: the Run, its calls that ended (done or
// failed) in the Engine's order, and the call it is making now (null between calls and after the last one, when the
// Agent writes the reply). The last line says how the read ended. gtmworks keeps none of it (ADR 0017): once the reply
// is in, the session's turn is the record of the Run's steps (#346).

// shortcut: a Run past 200 calls shows its first 200 live; upgrade if Runs grow so long.
export const mostLiveSteps=200;

/** @typedef {{call:string|null,tool:string,preview:string|null,state:'started'|'done'|'failed'}} StepEvent */
/** @typedef {{call:string,tool:string,preview:string|null,state:'started'|'done'|'failed'}} LiveCall */
/** @typedef {{run:string,steps:{tool:string,preview:string|null,state:'done'|'failed'}[],now:{tool:string,preview:string|null}|null}} LiveView */
/** @typedef {LiveView|{end:'ended'|'closed'|'gone'|'unreachable'|'none',outcome?:import('./engine.mjs').RunOutcome}} LiveLine */
/** @typedef {{delta:string}} LiveDelta */

// One call starting is added once (a replay sends it again); one ending marks the call of its id, or, when the Engine
// gave the call none, the oldest open call of its tool among those it gave none either (known by their start's number,
// `#<seq>`, which no id of the Engine's holds). An end with no call it belongs to changes nothing.
/** @param {LiveCall[]} calls @param {StepEvent} step @returns {LiveCall[]} */
export function withStep(calls,step) {
 if(step.state==='started') {
  if(step.call===null||calls.some(call=>call.call===step.call)||calls.length>=mostLiveSteps) return calls;
  return [...calls,{call:step.call,tool:step.tool,preview:step.preview,state:'started'}];
 }
 const at=step.call!==null?calls.findIndex(call=>call.call===step.call&&call.state==='started'):calls.findIndex(call=>call.state==='started'&&call.tool===step.tool&&call.call.startsWith('#'));
 if(at<0) return calls;
 return calls.map((call,index)=>index===at?{...call,state:step.state}:call);
}

// The call made now is the latest one still open; several open at once show the one started last.
/** @param {string} run @param {LiveCall[]} calls @returns {LiveView} */
export function liveView(run,calls) {
 const open=calls.findLast(call=>call.state==='started');
 return {run,steps:calls.flatMap(({tool,preview,state})=>state==='started'?[]:[{tool,preview,state}]),now:open?{tool:open.tool,preview:open.preview}:null};
}

// The lines for one Run: its view at once (nothing made yet), then again each time a call starts or ends, and its end.
// Older calls the Engine no longer has are gone from the view; the rest is still drawn.
// With `reply` (#876, a Conversation whose messages are the Engine's), each piece of the reply as it is written is a line
// of its own between them, `{delta}`, which the reader adds to the words it shows; gtmworks keeps none of it. Its end
// says how the Run ended, when the Engine said so (#878: a stopped Run's reply shows as stopped).
/** @param {string} run @param {AsyncIterable<import('./engine.mjs').RunEvent>} events @param {{reply?:boolean}} [options] @returns {AsyncGenerator<LiveLine|LiveDelta>} */
export async function* liveLines(run,events,{reply=false}={}) {
 let calls=/** @type {LiveCall[]} */([]);
 yield liveView(run,calls);
 for await(const event of events) {
  if('end' in event) { yield reply&&'outcome' in event&&event.outcome?{end:event.end,outcome:event.outcome}:{end:event.end}; return; }
  if(reply&&'delta' in event) { yield {delta:event.delta}; continue; }
  if(!('step' in event)) continue;
  const next=withStep(calls,event.step);
  if(next!==calls) { calls=next; yield liveView(run,calls); }
 }
 yield {end:'closed'};
}
