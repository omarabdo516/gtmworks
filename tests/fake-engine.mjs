// A fake engine that speaks the engine contract (lib/engine.mjs) in memory: no subscription, no network. It replies,
// fails, replies slowly (pendingReads reads report running first) and stops, as a real driver would.
import { randomUUID } from 'node:crypto';
/** @typedef {{id:string,key:string,conversation:string,input:string,instructions:string|null,tools:import('../lib/engine.mjs').ToolSpec[],history:import('../lib/engine.mjs').HistoryEntry[]|null,reads:number,stopped:boolean}} FakeRun */
/** @returns {{settings:{ending:'completed'|'failed',pendingReads:number,reply:(input:string)=>string,toolCalls:(input:string)=>import('../lib/engine.mjs').ToolCall[],usage:{input:number,output:number}|null,agentProfile:import('../lib/engine.mjs').ProvidedAgent['state']},runs:FakeRun[],connections:object[],agentReads:string[],provided:{name:string,instructions:string,level:number}[],removed:string[],engineFor:(connection:object)=>import('../lib/engine.mjs').Engine}} */
export function fakeEngine() {
 const settings={ending:/** @type {'completed'|'failed'} */('completed'),pendingReads:0,reply:(/** @type {string} */ input)=>`Reply to: ${input}`,toolCalls:/** @type {(input:string)=>import('../lib/engine.mjs').ToolCall[]} */(()=>[]),usage:/** @type {{input:number,output:number}|null} */({input:14000,output:12}),
  // How providing an Agent's own profile ends: with no subscription, a made profile has no model to answer with.
  agentProfile:/** @type {import('../lib/engine.mjs').ProvidedAgent['state']} */('noModel')};
 // Run ids are unique across fakes, as an engine's are: the database refuses a Member's run already used elsewhere (#287).
 const instance=randomUUID().slice(0,8);
 const runs=/** @type {FakeRun[]} */([]);
 const connections=/** @type {object[]} */([]);
 const agentReads=/** @type {string[]} */([]);
 const provided=/** @type {{name:string,instructions:string,level:number}[]} */([]);
 const removed=/** @type {string[]} */([]);
 const agents=/** @type {Map<string,import('../lib/engine.mjs').Agent>} */(new Map());
 /** @type {import('../lib/engine.mjs').Engine} */
 const engine={
  // The same idempotency key is the same run.
  // A run's instructions (the sender's own note) are kept with it, as an engine keeps them for that run only.
  async start({conversation,input,idempotencyKey,instructions,tools,history}) {
   let run=runs.find(run=>run.key===idempotencyKey);
   if(!run) { run={id:`fake_run_${instance}_${runs.length+1}`,key:idempotencyKey,conversation,input,instructions:instructions??null,tools:tools??[],history:history??null,reads:0,stopped:false}; runs.push(run); }
   return run.id;
  },
  async read(id) {
   const run=runs.find(run=>run.id===id);
   if(!run) return {state:'lost',reply:null,session:null,usage:null,toolCalls:[]};
   if(run.stopped) return {state:'stopped',reply:null,session:run.conversation,usage:settings.usage,toolCalls:[]};
   if(run.reads++<settings.pendingReads) return {state:'running',reply:null,session:run.conversation,usage:null,toolCalls:[]};
   return settings.ending==='completed'?{state:'completed',reply:settings.reply(run.input),session:run.conversation,usage:settings.usage,toolCalls:settings.toolCalls(run.input)}:{state:'failed',reply:null,session:run.conversation,usage:settings.usage,toolCalls:[]};
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
   agentReads.push(name);
   const agent=agents.get(name);
   return agent?{state:'found',agent}:{state:'missing',agent:null};
  },
  // A profile under the reserved name is made, or the one there finished; a made one stays until it is removed.
  async provideAgent({name,instructions,level}) {
   provided.push({name,instructions,level});
   if(['provided','noModel','forbidden'].includes(settings.agentProfile)) agents.set(name,{name,instructions,model:null,ready:true});
   return {state:settings.agentProfile};
  },
  async removeAgent(name) {
   removed.push(name);
   if(name==='default'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) return {state:'refused'};
   return {state:agents.delete(name)?'removed':'missing'};
  },
 };
 return {settings,runs,connections,agentReads,provided,removed,engineFor:connection=>{ connections.push(connection); return engine; }};
}
