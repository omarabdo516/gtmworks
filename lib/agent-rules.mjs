import { writeSoulRules } from './hermes.mjs';
import { engineOf } from './company-engine.mjs';
import { inLanes, workerHealth } from './engine-health.mjs';

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
/** @param {any} db @param {{hermes?:{address:string,profile:string,key:string,managementAddress?:string}|null,engine?:(company:string|null|undefined)=>object|null,write?:typeof writeSoulRules,memory?:{marks:Map<string,string>,drift:number},health?:ReturnType<typeof import('./engine-health.mjs').engineHealth>,now?:()=>number}} options */
export async function keepAgentRules(db,{hermes,engine=engineOf,write=writeSoulRules,memory=rulesMemory,health=workerHealth,now=Date.now}) {
 const done={written:0};
 // No bundled Engine at all (a hosted install, or a caller that says so): nothing to write.
 if(hermes===null) return done;
 const {data:work,error}=await db.rpc('agent_soul_rules_all');
 if(error) throw new Error(error.message);
 const drift=now()-memory.drift>=driftEvery; if(drift) memory.drift=now();
 const due=(work||[]).filter(({company_id:company,profile,rules})=>drift||memory.marks.get(`${company}:${profile}`)!==JSON.stringify(rules));
 // A few at once, so one profile that times out never holds the others; an Engine that did not answer is left alone
 // until its wait is over (lib/engine-health.mjs), and its profiles are tried again then.
 await inLanes(due,writesAtOnce,async({company_id:company,profile,rules})=>{
  const at=hermes??await engine(company);
  if(!at) return;
  const address=/** @type {{address:string}} */ (at).address;
  if(!health.ready(address)) return;
  const written=await write(/** @type {any} */ (at),{profile,rules});
  if(written.state==='written'||written.state==='unchanged') { memory.marks.set(`${company}:${profile}`,JSON.stringify(rules)); health.answered(address); }
  if(written.state==='written') done.written++;
  else if(written.state==='unreachable') health.failed(address,written.cause??'failed');
  else if(written.cause==='errorAnswer') health.failed(address,'errorAnswer');
  else if(written.state!=='unchanged'&&written.state!=='missing') console.error('Agent rules not written:',profile,written.state);
 });
 return done;
}
