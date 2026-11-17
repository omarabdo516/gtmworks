// A fake engine that speaks the engine contract (lib/engine.mjs) in memory: no subscription, no network. It replies,
// fails, replies slowly (pendingReads reads report running first) and stops, as a real driver would. A run may ask its
// person questions first (`questions`), one at a time: it waits, running, until each is answered, expired (`expire`, the
// engine's own time limit) or the run is stopped, and its reply is given the answers (null for one never answered).
// A run's tool calls (`steps`, #141) are its numbered events: each call's start, then its end unless it never ended;
// `forget` drops a run's oldest events and `sweep` all of them, as an engine that keeps them only for a while does.
import { randomUUID } from 'node:crypto';
/** @typedef {{id:string,text:string,choices:string[],multiple:boolean,answer?:string|null,settled:'answered'|'expired'|null}} FakeQuestion */
/** @typedef {{tool:string,preview?:string|null,call?:string|null,failed?:boolean,open?:boolean}} FakeStep */
/** @typedef {{id:string,key:string,conversation:string,input:string,instructions:string|null,tools:import('../lib/engine.mjs').ToolSpec[],history:import('../lib/engine.mjs').HistoryEntry[]|null,reads:number,stopped:boolean,ended:boolean,asked:FakeQuestion[],events:import('../lib/engine.mjs').RunStepEvent[],oldest:number,swept:boolean}} FakeRun */
/** @returns {{settings:{ending:'completed'|'failed',pendingReads:number,reply:(input:string,answers:(string|null)[])=>string,toolCalls:(input:string)=>import('../lib/engine.mjs').ToolCall[],usage:{input:number,output:number}|null,agentProfile:import('../lib/engine.mjs').ProvidedAgent['state'],questions:(input:string)=>{text:string,choices?:string[],multiple?:boolean}[],unreachableAnswers:number,steps:(input:string)=>FakeStep[],seconds:number,unreachableSteps:number},runs:FakeRun[],connections:object[],eventReads:{count:number},agentReads:string[],provided:{name:string,instructions:string,level:number}[],removed:string[],answers:{run:string,question:string,text:string}[],expire:(run:string)=>boolean,forget:(run:string,count:number)=>void,sweep:(run:string)=>void,engineFor:(connection:object)=>import('../lib/engine.mjs').Engine}} */
export function fakeEngine() {
 const settings={ending:/** @type {'completed'|'failed'} */('completed'),pendingReads:0,reply:(/** @type {string} */ input)=>`Reply to: ${input}`,toolCalls:/** @type {(input:string)=>import('../lib/engine.mjs').ToolCall[]} */(()=>[]),usage:/** @type {{input:number,output:number}|null} */({input:14000,output:12}),
  // How providing an Agent's own profile ends: with no subscription, a made profile has no model to answer with.
  agentProfile:/** @type {import('../lib/engine.mjs').ProvidedAgent['state']} */('noModel'),
  // The questions a run asks before its reply, and how many answers find the engine unreachable first.
  questions:/** @type {(input:string)=>{text:string,choices?:string[],multiple?:boolean}[]} */(()=>[]),unreachableAnswers:0,
  // The tool calls a run makes, its length in seconds, and how many reads of its events find the engine unreachable.
  steps:/** @type {(input:string)=>FakeStep[]} */(()=>[]),seconds:41,unreachableSteps:0};
 // Run ids are unique across fakes, as an engine's are: the database refuses a Member's run already used elsewhere (#287).
 const instance=randomUUID().slice(0,8);
 const runs=/** @type {FakeRun[]} */([]);
 const connections=/** @type {object[]} */([]);
 const agentReads=/** @type {string[]} */([]);
 const provided=/** @type {{name:string,instructions:string,level:number}[]} */([]);
 const removed=/** @type {string[]} */([]);
 const answers=/** @type {{run:string,question:string,text:string}[]} */([]);
 // How many reads of a run's events were made.
 const eventReads={count:0};
 // The engine's own time limit runs out on the question a run waits for: it stops waiting, and the run goes on.
 const expire=(/** @type {string} */ id)=>{ const waiting=runs.find(run=>run.id===id)?.asked.find(question=>!question.settled); if(waiting) waiting.settled='expired'; return !!waiting; };
 const forget=(/** @type {string} */ id,/** @type {number} */ count)=>{ const run=runs.find(run=>run.id===id); if(run) run.oldest+=count; };
 const sweep=(/** @type {string} */ id)=>{ const run=runs.find(run=>run.id===id); if(run) run.swept=true; };
 const eventsOf=(/** @type {FakeStep[]} */ steps)=>steps.flatMap((step,index)=>{
  const call=step.call===undefined?`call_${index+1}`:step.call; const seq=2*index;
  return [{seq,step:{call:call??`seq:${seq}`,tool:step.tool,preview:step.preview??null,state:/** @type {const} */('started')}},
   ...(step.open?[]:[{seq:seq+1,step:{call,tool:step.tool,preview:null,state:step.failed?/** @type {const} */('failed'):/** @type {const} */('done')}}])];
 });
 const agents=/** @type {Map<string,import('../lib/engine.mjs').Agent>} */(new Map());
 /** @type {import('../lib/engine.mjs').Engine} */
 const engine={
  // The same idempotency key is the same run.
  // A run's instructions (the sender's own note) are kept with it, as an engine keeps them for that run only.
  async start({conversation,input,idempotencyKey,instructions,tools,history}) {
   let run=runs.find(run=>run.key===idempotencyKey);
   if(!run) {
    const id=`fake_run_${instance}_${runs.length+1}`;
    const asked=settings.questions(input).map((question,index)=>({id:`${id}_q${index+1}`,text:question.text,choices:question.choices??[],multiple:question.multiple===true,settled:null}));
    run={id,key:idempotencyKey,conversation,input,instructions:instructions??null,tools:tools??[],history:history??null,reads:0,stopped:false,ended:false,asked,events:eventsOf(settings.steps(input)),oldest:0,swept:false}; runs.push(run);
   }
   return run.id;
  },
  async read(id) {
   const run=runs.find(run=>run.id===id);
   if(!run) return {state:'lost',reply:null,session:null,usage:null,toolCalls:[]};
   if(run.stopped) return {state:'stopped',reply:null,session:run.conversation,usage:settings.usage,toolCalls:[]};
   const waiting=run.asked.find(question=>!question.settled);
   if(waiting) return {state:'running',reply:null,session:run.conversation,usage:null,toolCalls:[],question:{id:waiting.id,text:waiting.text,choices:[...waiting.choices],multiple:waiting.multiple}};
   if(run.reads++<settings.pendingReads) return {state:'running',reply:null,session:run.conversation,usage:null,toolCalls:[]};
   run.ended=true;
   return settings.ending==='completed'?{state:'completed',reply:settings.reply(run.input,run.asked.map(question=>question.answer??null)),session:run.conversation,usage:settings.usage,toolCalls:settings.toolCalls(run.input)}:{state:'failed',reply:null,session:run.conversation,usage:settings.usage,toolCalls:[]};
  },
  async stop(id) {
   const run=runs.find(run=>run.id===id);
   if(!run||run.stopped||run.reads>settings.pendingReads) return false;
   run.stopped=true; return true;
  },
  // A run's events after a number: those it still keeps, a loss when older ones it had are gone, and its end once the
  // run has ended.
  async *steps(id,{after=-1}={}) {
   eventReads.count++;
   const run=runs.find(run=>run.id===id);
   if(settings.unreachableSteps>0) { settings.unreachableSteps--; yield {end:'unreachable'}; return; }
   if(!run||run.swept) { yield {end:'gone'}; return; }
   const kept=run.events.filter(event=>event.seq>=run.oldest&&event.seq>after);
   if(run.events.some(event=>event.seq>after&&event.seq<run.oldest)) yield {lost:true};
   for(const event of kept) yield structuredClone(event);
   yield {end:run.ended||run.stopped?'ended':'closed'};
  },
  async length(id) { const run=runs.find(run=>run.id===id); return run&&(run.ended||run.stopped)?settings.seconds:null; },
  // A question still waited for takes the first answer; one answered already says so again; any other is gone.
  async answer(id,question,text) {
   answers.push({run:id,question,text});
   if(settings.unreachableAnswers>0) { settings.unreachableAnswers--; return 'unreachable'; }
   const run=runs.find(run=>run.id===id);
   const asked=run?.asked.find(each=>each.id===question);
   if(!run||!asked||run.stopped||asked.settled==='expired') return 'gone';
   if(!asked.settled) Object.assign(asked,{settled:'answered',answer:text});
   return 'answered';
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
 return {settings,runs,connections,agentReads,provided,removed,answers,eventReads,expire,forget,sweep,engineFor:connection=>{ connections.push(connection); return engine; }};
}
