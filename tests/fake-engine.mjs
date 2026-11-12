// A fake engine that speaks the engine contract (lib/engine.mjs) in memory: no subscription, no network. It replies,
// fails, replies slowly (pendingReads reads report running first) and stops, as a real driver would.
import { randomUUID } from 'node:crypto';
/** @returns {{settings:{ending:'completed'|'failed',pendingReads:number,reply:(input:string)=>string,usage:{input:number,output:number}|null},runs:{id:string,key:string,conversation:string,input:string,reads:number,stopped:boolean}[],connections:object[],engineFor:(connection:object)=>import('../lib/engine.mjs').Engine}} */
export function fakeEngine() {
 const settings={ending:/** @type {'completed'|'failed'} */('completed'),pendingReads:0,reply:(/** @type {string} */ input)=>`Reply to: ${input}`,usage:/** @type {{input:number,output:number}|null} */({input:14000,output:12})};
 // Run ids are unique across fakes, as an engine's are: the database refuses a Member's run already used elsewhere (#287).
 const instance=randomUUID().slice(0,8);
 const runs=/** @type {{id:string,key:string,conversation:string,input:string,reads:number,stopped:boolean}[]} */([]);
 const connections=/** @type {object[]} */([]);
 const agents=/** @type {Map<string,import('../lib/engine.mjs').Agent>} */(new Map());
 /** @type {import('../lib/engine.mjs').Engine} */
 const engine={
  // The same idempotency key is the same run.
  async start({conversation,input,idempotencyKey}) {
   let run=runs.find(run=>run.key===idempotencyKey);
   if(!run) { run={id:`fake_run_${instance}_${runs.length+1}`,key:idempotencyKey,conversation,input,reads:0,stopped:false}; runs.push(run); }
   return run.id;
  },
  async read(id) {
   const run=runs.find(run=>run.id===id);
   if(!run) return {state:'lost',reply:null,session:null,usage:null};
   if(run.stopped) return {state:'stopped',reply:null,session:run.conversation,usage:settings.usage};
   if(run.reads++<settings.pendingReads) return {state:'running',reply:null,session:run.conversation,usage:null};
   return settings.ending==='completed'?{state:'completed',reply:settings.reply(run.input),session:run.conversation,usage:settings.usage}:{state:'failed',reply:null,session:run.conversation,usage:settings.usage};
  },
  async stop(id) {
   const run=runs.find(run=>run.id===id);
   if(!run||run.stopped||run.reads>settings.pendingReads) return false;
   run.stopped=true; return true;
  },
  // An Agent is made once per name; the same name again exists.
  async createAgent({name,instructions,model=null}) {
   if(agents.has(name)) return {state:'exists',agent:null};
   const agent={name,instructions,model,ready:true}; agents.set(name,agent);
   return {state:'created',agent};
  },
  async readAgent(name) {
   const agent=agents.get(name);
   return agent?{state:'found',agent}:{state:'missing',agent:null};
  },
 };
 return {settings,runs,connections,engineFor:connection=>{ connections.push(connection); return engine; }};
}
