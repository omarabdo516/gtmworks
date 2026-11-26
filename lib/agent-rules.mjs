import { companyEngine } from './engine/handle.mjs';
import { inLanes, workerUpkeep } from './upkeep-schedule.mjs';

// The team's lasting rules (#18) live in each Agent's profile SOUL.md, in the section gtmworks owns (#345), not in each
// Run. Who may give and remove them, and their log, stay in the database; it lists each Agent profile on the bundled
// Engine with its team's rules in force, oldest first (agent_soul_rules_all, every profile however many), and the worker
// writes each section from that list when it changed, so a rule given, approved or removed is in step within a pass. A
// section already right is only read. Each row names its Company, and asks that Company's Engine (#380).
// The worker's mark of what it last wrote in each profile (#772): the rules a profile holds, by Company and profile, as
// gtmworks wrote them, never a copy of the Engine's file. A profile whose rules are the ones last written is not asked of
// the Engine again until the slow pass for drift (every five minutes), which reads every profile once and corrects one
// changed outside gtmworks. Kept in the worker's memory: a restart checks every profile on its first pass.
const rulesMemory={marks:new Map(),drift:0};
const driftEvery=300000; const writesAtOnce=4;
// Each Company's Engine is reached through its handle; its health in the upkeep is kept by the Engine's address.
/** @param {any} db @param {{memory?:{marks:Map<string,string>,drift:number},health?:ReturnType<typeof import('./upkeep-schedule.mjs').upkeepSchedule>,now?:()=>number}} [options] */
export async function keepAgentRules(db,{memory=rulesMemory,health=workerUpkeep,now=Date.now}={}) {
 const done={written:0};
 const {data:work,error}=await db.rpc('agent_soul_rules_all');
 if(error) throw new Error(error.message);
 const drift=now()-memory.drift>=driftEvery; if(drift) memory.drift=now();
 const due=(work||[]).filter(({company_id:company,profile,rules})=>drift||memory.marks.get(`${company}:${profile}`)!==JSON.stringify(rules));
 // A few at once, so one profile that times out never holds the others; an Engine that did not answer is left alone
 // until its wait is over (lib/upkeep-schedule.mjs), and its profiles are tried again then.
 await inLanes(due,writesAtOnce,async({company_id:company,profile,rules})=>{
  const at=await companyEngine(company);
  const root=at?.on('default');
  if(!at||!root) return;
  const address=at.address;
  if(!health.ready(address)) return;
  const written=await root.souls.writeRules({profile,rules});
  if(written.state==='written'||written.state==='unchanged') { memory.marks.set(`${company}:${profile}`,JSON.stringify(rules)); health.answered(address); }
  if(written.state==='written') done.written++;
  else if(written.state==='unreachable') health.failed(address);
  else if(written.state!=='unchanged'&&written.state!=='missing') {
   if(written.cause==='errorAnswer') health.failed(address);
   console.error('Agent rules not written:',profile,written.cause??written.state);
  }
 });
 return done;
}
