// A Run's steps (#141): the tool calls the Engine reported for it, read from its events (lib/engine.mjs) and kept with
// the Conversation (conversation_run_steps). The worker follows each open Run's events and keeps what it read
// (note_run_steps); the closer reads the rest of an ended Run's events and seals them with the Run's length
// (seal_run_steps) in the pass that closes it as completed. A failed, stopped or lost Run is never sealed, so it shows
// none. Every read starts after the last event number kept, and adding an event already read changes nothing, so a
// follower and a closer, a restart or a read again from an earlier number all end at the same steps.

/** @typedef {import('./engine.mjs').RunStep} RunStep */
/** @typedef {{steps:RunStep[],readTo:number,broken:boolean}} Progress */
/** @typedef {{conversation:string,run:string}} OpenRun */

// The Engine keeps a Run's last 1,000 events, so a Run never reports more calls than that.
const mostSteps=1000;
// The follower keeps what it read after every tool call, and after this many other events (the reply's chunks), so a
// follower started again reads from close to where the last one stopped, well inside what the Engine still keeps.
const noteEvery=100;

/** @type {Progress} */
const unread={steps:[],readTo:-1,broken:false};

// One event read onto the steps: a call's start adds its step once, its end settles the step its id names, or the oldest
// one of its tool still started when it has no id. Nothing goes back: an ended call stays ended.
/** @param {Progress} progress @param {Exclude<import('./engine.mjs').RunEvent,{end:string}>} event @returns {Progress} */
export function withEvent(progress,event) {
 if('lost' in event) return {...progress,broken:true};
 if(event.seq<=progress.readTo) return progress;
 const read={...progress,readTo:event.seq};
 const step=event.step;
 if(!step) return read;
 // A call past the most a list holds is not dropped silently: the list could no longer be the Run's whole, so it is broken.
 const added=(/** @type {RunStep} */ next)=>read.steps.length>=mostSteps?{...read,broken:true}:{...read,steps:[...read.steps,next]};
 if(step.state==='started') return read.steps.some(each=>each.call===step.call)?read:added({...step,call:/** @type {string} */(step.call)});
 const at=read.steps.findIndex(each=>step.call===null?each.tool===step.tool&&each.state==='started':each.call===step.call);
 if(at<0) return added({call:step.call??`seq:${event.seq}`,tool:step.tool,preview:null,state:step.state});
 if(read.steps[at].state!=='started') return read;
 return {...read,steps:read.steps.map((each,index)=>index===at?{...each,state:step.state}:each)};
}

/** @param {any} db @param {OpenRun} open @returns {Promise<(Progress&{sealed:boolean})|null>} */
async function progressOf(db,{conversation,run}) {
 const {data,error}=await db.rpc('run_steps_progress',{conversation,run});
 if(error) throw error;
 const row=data?.[0];
 return row?{steps:row.steps,readTo:row.read_to,broken:row.broken,sealed:row.sealed}:null;
}
/** @param {OpenRun} open @param {Progress} progress */
const kept=({conversation,run},{steps,readTo,broken})=>({conversation,run,noted:steps,upto:readTo,lost:broken});

// Follows one open Run's events from where the last read stopped, keeping what it reads, until the stream ends, the Run
// is closed or sealed (the database refuses), or `signal` stops it. Answers gone when the Engine keeps no events of the
// Run, so it is not asked again while the Run stays open.
/** @param {any} db @param {import('./engine.mjs').Engine} engine @param {OpenRun} open @param {AbortSignal} signal @returns {Promise<'gone'|undefined>} */
export async function followRun(db,engine,open,signal) {
 const stored=await progressOf(db,open);
 if(stored?.sealed) return;
 let progress=stored??unread; let noted=progress;
 const note=async()=>{
  if(progress===noted) return true;
  const {data,error}=await db.rpc('note_run_steps',kept(open,progress));
  if(error) throw error;
  noted=progress; return data===true;
 };
 for await(const event of engine.steps(open.run,{after:progress.readTo,signal})) {
  if('end' in event) { await note(); return event.end==='gone'?'gone':undefined; }
  const next=withEvent(progress,event);
  const worth=next.steps!==progress.steps||next.broken!==progress.broken||next.readTo-noted.readTo>=noteEvery;
  progress=next;
  if(worth&&!await note()) return;
 }
}

// The closer's last read of a Run that ended completed, just before it closes: the events after the last one kept, then
// the steps sealed with the Run's length. A Run whose events were never read and that the Engine no longer keeps stores
// none. Steps that could not be read to the Run's end (events lost, the Engine unreachable or too slow) are sealed as
// broken and never shown. Nothing here keeps the Run from closing.
/** @param {any} db @param {import('./engine.mjs').Engine} engine @param {OpenRun} open */
export async function sealRunSteps(db,engine,open) {
 try {
  const stored=await progressOf(db,open);
  if(stored?.sealed) return;
  let progress=stored??unread; let end='unreachable';
  for await(const event of engine.steps(open.run,{after:progress.readTo,signal:AbortSignal.timeout(5000)})) {
   if('end' in event) end=event.end; else progress=withEvent(progress,event);
  }
  if(end==='gone'&&!stored) return;
  const seconds=await engine.length(open.run);
  const {error}=await db.rpc('seal_run_steps',{...kept(open,{...progress,broken:progress.broken||end!=='ended'}),took:seconds});
  if(error) throw error;
 } catch(failure) { console.error('Run steps not kept:',open.run,failure?.message||'unknown error'); }
}
