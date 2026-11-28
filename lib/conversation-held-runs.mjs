import { companyEngine } from './engine/handle.mjs';
import { workerUpkeep } from './upkeep-schedule.mjs';
import { runEnd } from './run-outcome.mjs';

// The Runs the rows of Engine Conversations hold (#882, spec #864): a row holds its open Run until that Run's end is seen,
// and the Agent's face counts it as work (agent_work). The live read sees the end while its person has the Conversation
// open (app/api/conversation-live); one who left while it worked is not there to see it. So the worker asks the Engine
// how each held Run is, once a minute, and lets go of each that ended or that the Engine no longer knows (run-outcome's
// end); one still working, or an Engine that does not answer, is left as it is. Nothing of the Run is kept.
/** @param {any} db the worker's database @param {{health?:ReturnType<typeof import('./upkeep-schedule.mjs').upkeepSchedule>}} [options] */
export async function keepHeldConversationRuns(db,{health=workerUpkeep}={}) {
 const done={released:0};
 const {data:rows,error}=await db.rpc('held_conversation_runs');
 if(error) throw new Error(error.message);
 /** @type {Map<string,any>} */ const engines=new Map();
 for(const {company_id:company,conversation,profile,runs} of rows||[]) {
  if(!engines.has(company)) engines.set(company,await companyEngine(company));
  const engine=engines.get(company);
  if(!engine||!health.ready(engine.address)) continue;
  const on=engine.on(profile); if(!on) continue;
  for(const run of runs||[]) {
   let read;
   try { read=await on.runs.read(run); } catch { read=null; }
   if(!read||read.state==='unreachable') { health.failed(engine.address); break; }
   health.answered(engine.address);
   if(!runEnd(read)) continue;
   const {data:released,error:failed}=await db.rpc('let_go_conversation_run',{conversation,run});
   if(failed) { console.error('Conversation Run not let go:',conversation,failed.message); continue; }
   if(released) done.released++;
  }
 }
 return done;
}
