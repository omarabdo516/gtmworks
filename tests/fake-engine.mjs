// A fake engine that speaks the engine contract (lib/engine.mjs) in memory: no subscription, no network. It replies,
// fails, replies slowly (pendingReads reads report running first) and stops, as a real driver would. A run may ask its
// person questions first (`questions`), one at a time: it waits, running, until each is answered, expired (`expire`, the
// engine's own time limit) or the run is stopped, and its reply is given the answers (null for one never answered).
// After them it may stop to ask before each action (`permissions`, #163), one at a time, until a choice is taken, the
// request expires or the run is stopped, and its reply is then also given the choices (null for one never taken).
// A conversation's session (#346) reads as the turns `sessions` holds for its id, or missing.
import { randomUUID } from 'node:crypto';
/** @typedef {{id:string,text:string,choices:string[],multiple:boolean,answer?:string|null,settled:'answered'|'expired'|null}} FakeQuestion */
/** @typedef {{id:string,description:string,command:string,choices:import('../lib/engine.mjs').PermissionChoice[],choice?:string|null,settled:'answered'|'expired'|null}} FakePermission */
/** @typedef {{id:string,key:string,conversation:string,input:import('../lib/engine.mjs').RunInput,instructions:string|null,tools:import('../lib/engine.mjs').ToolSpec[],history:import('../lib/engine.mjs').HistoryEntry[]|null,reads:number,stopped:boolean,ended:boolean,asked:FakeQuestion[],permissions:FakePermission[]}} FakeRun */
// What a Run's input says in words: the text part of its last message when it carries images (#155), or the message
// itself, so a fake's reply and tools read a person's words as they always did.
const inputText=/** @param {import('../lib/engine.mjs').RunInput} input */ input=>typeof input==='string'?input:(input.at(-1)?.content.flatMap(part=>part.type==='text'?[part.text]:[]).join('')??'');
/** @returns {{settings:{ending:'completed'|'failed'|'noModel',pendingReads:number,reply:(input:string,answers:(string|null)[],choices:(string|null)[])=>string,toolCalls:(input:string)=>import('../lib/engine.mjs').ToolCall[],usage:{input:number,output:number}|null,agentProfile:import('../lib/engine.mjs').ProvidedAgent['state'],questions:(input:string)=>{text:string,choices?:string[],multiple?:boolean}[],unreachableAnswers:number,permissions:(input:string)=>{description:string,command:string,choices?:import('../lib/engine.mjs').PermissionChoice[]}[],unreachablePermits:number,sessions:Map<string,import('../lib/engine.mjs').SessionTurn[]>,sessionUsage:Map<string,import('../lib/engine.mjs').SessionUsage>,apps:Record<string,import('../lib/app-catalogue.mjs').AppState>|'refused'|'unreachable'|'failed'},runs:FakeRun[],connections:object[],appReads:{count:number},agentReads:string[],provided:{name:string,instructions:string}[],removed:string[],answers:{run:string,question:string,text:string}[],permits:{run:string,permission:string,choice:string}[],expire:(run:string)=>boolean,engineFor:(connection:object)=>import('../lib/engine.mjs').Engine}} */
export function fakeEngine() {
 const settings={ending:/** @type {'completed'|'failed'|'noModel'} */('completed'),pendingReads:0,reply:(/** @type {string} */ input)=>`Reply to: ${input}`,toolCalls:/** @type {(input:string)=>import('../lib/engine.mjs').ToolCall[]} */(()=>[]),usage:/** @type {{input:number,output:number}|null} */({input:14000,output:12}),
  // How providing an Agent's own profile ends: with no subscription, a made profile has no model to answer with.
  agentProfile:/** @type {import('../lib/engine.mjs').ProvidedAgent['state']} */('noModel'),
  // The questions a run asks before its reply, and how many answers find the engine unreachable first.
  questions:/** @type {(input:string)=>{text:string,choices?:string[],multiple?:boolean}[]} */(()=>[]),unreachableAnswers:0,
  // The requests a run waits on after them, and how many choices find the engine unreachable first.
  permissions:/** @type {(input:string)=>{description:string,command:string,choices?:import('../lib/engine.mjs').PermissionChoice[]}[]} */(()=>[]),unreachablePermits:0,
  // Each session's turns by id.
  sessions:/** @type {Map<string,import('../lib/engine.mjs').SessionTurn[]>} */(new Map()),
  // Each session's token use by id (#347); a session without one has unknown usage.
  sessionUsage:/** @type {Map<string,import('../lib/engine.mjs').SessionUsage>} */(new Map()),
  // The profile's apps by key and state (#203), or how a read of them fails.
  apps:/** @type {Record<string,import('../lib/app-catalogue.mjs').AppState>|'refused'|'unreachable'|'failed'} */({}),
  // One recording as text (#160): the transcript the engine answers with ('' is silence), and the language its profile
  // listens in; `transcription` replaces the answer with an unavailable, refused or failed one.
  transcript:'The words the engine heard',
  dictationLanguage:/** @type {string|null} */('en'),
  transcription:/** @type {import('../lib/engine.mjs').Transcription['state']|null} */(null)};
 // Run ids are unique across fakes, as an engine's are: the database refuses a Member's run already used elsewhere (#287).
 const instance=randomUUID().slice(0,8);
 const runs=/** @type {FakeRun[]} */([]);
 const connections=/** @type {object[]} */([]);
 const agentReads=/** @type {string[]} */([]);
 const provided=/** @type {{name:string,instructions:string}[]} */([]);
 const removed=/** @type {string[]} */([]);
 const answers=/** @type {{run:string,question:string,text:string}[]} */([]);
 const permits=/** @type {{run:string,permission:string,choice:string}[]} */([]);
 // How many reads of the profile's apps were made.
 const appReads={count:0};
 // The engine's own time limit runs out on the question or the request a run waits for: it stops waiting, and the run
 // goes on.
 const expire=(/** @type {string} */ id)=>{ const run=runs.find(run=>run.id===id); const waiting=run?.asked.find(question=>!question.settled)??run?.permissions.find(asking=>!asking.settled); if(waiting) waiting.settled='expired'; return !!waiting; };
 const agents=/** @type {Map<string,import('../lib/engine.mjs').Agent>} */(new Map());
 /** @type {import('../lib/engine.mjs').Engine} */
 const engine={
  // The same idempotency key is the same run.
  // A run's instructions (the sender's own note) are kept with it, as an engine keeps them for that run only.
  async start({conversation,input,idempotencyKey,instructions,tools,history}) {
   const text=inputText(input);
   let run=runs.find(run=>run.key===idempotencyKey);
   if(!run) {
    const id=`fake_run_${instance}_${runs.length+1}`;
    const asked=settings.questions(text).map((question,index)=>({id:`${id}_q${index+1}`,text:question.text,choices:question.choices??[],multiple:question.multiple===true,settled:null}));
    const permissions=settings.permissions(text).map((asking,index)=>({id:`${id}_p${index+1}`,description:asking.description,command:asking.command,choices:asking.choices??/** @type {import('../lib/engine.mjs').PermissionChoice[]} */(['once','always','deny']),settled:null}));
    run={id,key:idempotencyKey,conversation,input,instructions:instructions??null,tools:tools??[],history:history??null,reads:0,stopped:false,ended:false,asked,permissions}; runs.push(run);
   }
   return run.id;
  },
  async read(id) {
   const run=runs.find(run=>run.id===id);
   if(!run) return {state:'lost',reply:null,session:null,usage:null,toolCalls:[]};
   if(run.stopped) return {state:'stopped',reply:null,session:run.conversation,usage:settings.usage,toolCalls:[]};
   const waiting=run.asked.find(question=>!question.settled);
   if(waiting) return {state:'running',reply:null,session:run.conversation,usage:null,toolCalls:[],question:{id:waiting.id,text:waiting.text,choices:[...waiting.choices],multiple:waiting.multiple}};
   const asking=run.permissions.find(each=>!each.settled);
   if(asking) return {state:'running',reply:null,session:run.conversation,usage:null,toolCalls:[],permission:{id:asking.id,description:asking.description,command:asking.command,choices:[...asking.choices]}};
   if(run.reads++<settings.pendingReads) return {state:'running',reply:null,session:run.conversation,usage:null,toolCalls:[]};
   run.ended=true;
   return settings.ending==='completed'?{state:'completed',reply:settings.reply(inputText(run.input),run.asked.map(question=>question.answer??null),run.permissions.map(asking=>asking.choice??null)),session:run.conversation,usage:settings.usage,toolCalls:settings.toolCalls(inputText(run.input))}:{state:'failed',reply:null,session:run.conversation,usage:settings.usage,toolCalls:[],...(settings.ending==='noModel'?{noModel:/** @type {const} */(true)}:{})};
  },
  async stop(id) {
   const run=runs.find(run=>run.id===id);
   if(!run||run.stopped||run.reads>settings.pendingReads) return false;
   run.stopped=true; return true;
  },
  async transcribe({dataUrl}) {
   if(settings.transcription) return settings.transcription==='transcribed'?{state:'transcribed',text:settings.transcript}:{state:settings.transcription};
   return dataUrl.startsWith('data:audio/')?{state:'transcribed',text:settings.transcript}:{state:'refused'};
  },
  async dictation() { return {state:'found',language:settings.dictationLanguage}; },
  async session(id) { const turns=settings.sessions.get(id); return turns?{state:'found',turns:structuredClone(turns),usage:settings.sessionUsage.get(id)??null}:{state:'missing',turns:null,usage:null}; },
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
  // A request still waited on takes the first choice it offers; any other choice, or one for a request answered, expired
  // or stopped, is gone, as the engine no longer waits for it.
  async permit(id,permission,choice) {
   permits.push({run:id,permission,choice});
   if(settings.unreachablePermits>0) { settings.unreachablePermits--; return 'unreachable'; }
   const run=runs.find(run=>run.id===id);
   const asking=run?.permissions.find(each=>each.id===permission);
   if(!run||!asking||run.stopped||asking.settled||!asking.choices.includes(choice)) return 'gone';
   Object.assign(asking,{settled:'answered',choice});
   return 'answered';
  },
  async apps() {
   appReads.count++;
   const apps=settings.apps;
   return typeof apps==='string'?{state:apps,apps:null}:{state:'found',apps:Object.entries(apps).map(([key,state])=>({key,state}))};
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
  async provideAgent({name,instructions}) {
   provided.push({name,instructions});
   if(['provided','noModel','forbidden'].includes(settings.agentProfile)) agents.set(name,{name,instructions,model:null,ready:true});
   return {state:settings.agentProfile};
  },
  async removeAgent(name) {
   removed.push(name);
   if(name==='default'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) return {state:'refused'};
   return {state:agents.delete(name)?'removed':'missing'};
  },
 };
 return {settings,runs,connections,appReads,agentReads,provided,removed,answers,permits,expire,engineFor:connection=>{ connections.push(connection); return engine; }};
}
