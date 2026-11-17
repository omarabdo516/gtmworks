// A Run's steps (#141): the tool calls the Engine reported for it, read from its events (lib/engine.mjs) and kept with
// the Conversation (conversation_run_steps). The worker follows each open Run's events and keeps what it read
// (note_run_steps); once it read the Run's end it also keeps the Run's length, and the closer seals what is kept
// (seal_run_steps) in the pass that closes the Run as completed, without asking the Engine again. Only when no follower
// read to the end does the closer read the rest itself, within one bounded wait. A failed, stopped or lost Run is never
// sealed, so it shows none. Every read starts after the last event number kept, and adding an event already read
// changes nothing, so a follower and a closer, a read again from an earlier number or a follower started again on a
// stream that broke off all end at the same steps.

/** @typedef {import('./engine.mjs').RunStep} RunStep */
/** @typedef {{steps:RunStep[],readTo:number,broken:boolean,endedAt:number|null}} Progress */
/** @typedef {{conversation:string,run:string}} OpenRun */

// The Engine keeps a Run's last 1,000 events, so a Run never reports more calls than that.
const mostSteps=1000;
// The follower keeps what it read after every tool call, and after this many other events (the reply's chunks), so a
// follower started again reads from close to where the last one stopped, well inside what the Engine still keeps.
const noteEvery=100;

/** @type {Progress} */
const unread={steps:[],readTo:-1,broken:false,endedAt:null};

// One event read onto the steps: a call's start adds its step once, its end settles the step its id names, or, when it
// has no id, the oldest step of its tool that had none either and is still started. Nothing goes back: an ended call
// stays ended. The Run's own end keeps the time the Engine stamped on it.
/** @param {Progress} progress @param {Exclude<import('./engine.mjs').RunEvent,{end:string}>} event @returns {Progress} */
export function withEvent(progress,event) {
 if('lost' in event) return {...progress,broken:true};
 if(event.seq<=progress.readTo) return progress;
 const read={...progress,readTo:event.seq,...(event.endedAt!==undefined?{endedAt:event.endedAt}:{})};
 const step=event.step;
 if(!step) return read;
 // A call past the most a list holds is not dropped silently: the list could no longer be the Run's whole, so it is broken.
 const added=(/** @type {RunStep} */ next)=>read.steps.length>=mostSteps?{...read,broken:true}:{...read,steps:[...read.steps,next]};
 if(step.state==='started') return read.steps.some(each=>each.call===step.call)?read:added({...step,call:/** @type {string} */(step.call)});
 const at=read.steps.findIndex(each=>step.call===null?each.call.startsWith('seq:')&&each.tool===step.tool&&each.state==='started':each.call===step.call);
 if(at<0) return added({call:step.call??`seq:${event.seq}`,tool:step.tool,preview:null,state:step.state});
 if(read.steps[at].state!=='started') return read;
 return {...read,steps:read.steps.map((each,index)=>index===at?{...each,state:step.state}:each)};
}


/** @typedef {Progress&{ended:boolean,seconds:number|null,sealed:boolean}} Stored */
/** @param {any} db @param {OpenRun} open @returns {Promise<Stored|null>} */
async function progressOf(db,{conversation,run}) {
 const {data,error}=await db.rpc('run_steps_progress',{conversation,run});
 if(error) throw error;
 const row=data?.[0];
 return row?{steps:row.steps,readTo:row.read_to,broken:row.broken,endedAt:null,ended:row.ended,seconds:row.seconds,sealed:row.sealed}:null;
}
/** @param {OpenRun} open @param {Progress} progress */
const kept=({conversation,run},{steps,readTo,broken})=>({conversation,run,noted:steps,upto:readTo,lost:broken});

// Follows one open Run's events from where the last read stopped, keeping what it reads, until the stream ends, the Run
// is closed or sealed (the database refuses), or `signal` stops it. Once it read the Run's end it keeps that with the
// Run's length and answers ended, and gone when the Engine keeps no events of the Run: either way there is nothing more
// to follow. A stream that broke off (closed, unreachable) answers nothing, and a later pass follows the same stream on
// from the last number kept.
/** @param {any} db @param {import('./engine.mjs').Engine} engine @param {OpenRun} open @param {AbortSignal} signal @returns {Promise<'ended'|'gone'|undefined>} */
export async function followRun(db,engine,open,signal) {
 const stored=await progressOf(db,open);
 if(stored?.sealed||stored?.ended) return 'ended';
 let progress=stored??unread; let noted=progress;
 const note=async(/** @type {{done:boolean,took:number|null}|null} */ end=null)=>{
  if(progress===noted&&!end) return true;
  const {data,error}=await db.rpc('note_run_steps',{...kept(open,progress),...(end?{done:end.done,took:end.took}:{})});
  if(error) throw error;
  noted=progress; return data===true;
 };
 for await(const event of engine.steps(open.run,{after:progress.readTo,signal})) {
  if('end' in event) {
   if(event.end==='ended') { await note({done:true,took:await engine.length(open.run,{endedAt:progress.endedAt})}); return 'ended'; }
   await note(); return event.end==='gone'?'gone':undefined;
  }
  const next=withEvent(progress,event);
  const worth=next.steps!==progress.steps||next.broken!==progress.broken||next.readTo-noted.readTo>=noteEvery;
  progress=next;
  if(worth&&!await note()) return 'ended';
 }
}

// The closer's part, just before it closes a Run that ended completed: it seals the steps kept. When no follower read
// the Run's end, it reads the events after the last one kept and the Run's length itself, all within `wait`. A Run
// whose events were never read and that the Engine no longer keeps stores none. Steps that could not be read to the
// Run's end (events lost, the Engine unreachable or too slow) are sealed as broken and never shown. Nothing here keeps
// the Run from closing.
/** @param {any} db @param {import('./engine.mjs').Engine} engine @param {OpenRun} open @param {{wait?:number}} [options] */
export async function sealRunSteps(db,engine,open,{wait=5000}={}) {
 try {
  const stored=await progressOf(db,open);
  if(stored?.sealed) return;
  let progress=stored??unread; let end='ended'; let seconds=stored?.seconds??null;
  if(!stored?.ended) {
   const signal=AbortSignal.timeout(wait); end='unreachable';
   for await(const event of engine.steps(open.run,{after:progress.readTo,signal})) {
    if('end' in event) end=event.end; else progress=withEvent(progress,event);
   }
   if(end==='gone'&&!stored) return;
   if(end==='ended') seconds=await engine.length(open.run,{endedAt:progress.endedAt,signal});
  }
  const {error}=await db.rpc('seal_run_steps',{...kept(open,{...progress,broken:progress.broken||end!=='ended'}),took:seconds});
  if(error) throw error;
 } catch(failure) { console.error('Run steps not kept:',open.run,failure?.message||'unknown error'); }
}
