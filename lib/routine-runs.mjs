import { engineOf as companyEngine, onProfile } from './company-engine.mjs';
import { readRunningRoutines } from './hermes.mjs';

// A running Routine is its Agent's work (#699, spec #694). The Engine schedules and runs a Routine and gtmworks keeps no
// copy of it (ADR 0016), so each pass of the worker's own loop (worker/index.mjs, every 15 seconds) reads which
// Routines each Agent's own profile runs now and keeps that whole set in the database (keep_running_routines), where
// the state read counts it as working (agent_work). A Routine that ended is left out of the next set; its end is
// kept in routine_results by the Good morning pass, as before.
// Bounded both ways. The database counts a set only while this pass keeps refreshing it (two minutes), so a worker that
// stopped or an Engine that went away leaves no Agent working longer than that; a profile the Engine did not answer for
// keeps nothing, so its last set ages out there. And a run the Engine still lists as active this long after it started
// is one it lost (its session never ended), so it is not kept and never holds its Agent working.
const ownProfile=/^(co|ag)-[0-9a-f]{32}$/;
const longestRun=6*3600*1000;
const drivers={running:readRunningRoutines};

// One pass over every Company with its main Agent on its own profile (good_morning_work, the list the morning pass
// reads), each of its Agents' own profiles once, for the first Agent on it (as the Routine results are kept). Answers
// how many sets were kept.
/** @param {any} service @param {{engineOf?:(company:string,db?:any)=>Promise<{address:string,key:string}|null>,driver?:Partial<typeof drivers>,now?:()=>Date}} [options] */
export async function keepRunningRoutines(service,{engineOf=companyEngine,driver={},now=()=>new Date()}={}) {
 const use={...drivers,...driver};
 const {data:work,error}=await service.rpc('good_morning_work');
 if(error) throw new Error(error.message);
 let kept=0;
 for(const company of new Set((work||[]).map(row=>row.company_id))) {
  const hermes=await engineOf(company,service);
  if(!hermes) continue;
  const {data:agents,error:unlisted}=await service.rpc('good_morning_agents',{c:company});
  if(unlisted) { console.error('Running Routines not kept:',company,unlisted.message); continue; }
  const seen=new Set();
  for(const agent of agents||[]) {
   if(!ownProfile.test(agent.profile)||seen.has(agent.profile)) continue;
   seen.add(agent.profile);
   const at=onProfile(agent.profile,company,hermes);
   if(!at) continue;
   const read=await use.running(at);
   if(read.state!=='found') continue;
   const running=read.running.filter(run=>now().getTime()-Date.parse(run.startedAt)<longestRun).map(run=>({routine_id:run.id,started_at:run.startedAt}));
   const {error:failed}=await service.rpc('keep_running_routines',{c:company,at_profile:agent.profile,agent:agent.id,running});
   if(failed) { console.error('Running Routines not kept:',company,failed.message); continue; }
   kept+=1;
  }
 }
 return kept;
}
