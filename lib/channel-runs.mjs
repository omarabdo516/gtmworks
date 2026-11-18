import { engineFor as defaultEngine, outcomeOf, startOutcomeUnknown } from './engine.mjs';
import { agentInstructionsFor, requestedOf } from './conversation-runs.mjs';
import { hermesAt, onProfile } from './bundled-hermes.mjs';
import { runToolCall, toolSpecTexts } from './agent-tools.mjs';
// The card tools a channel Run is offered (#148): the draft (#136) and the review (#137), as a Conversation's Run is.
const cardTools=new Set(['show_draft','show_review']);

/** @typedef {typeof defaultEngine} EngineFor */
/** @typedef {{key:string,label:string,due:string,begin:string,answer:string,close:string}} RunSource */
// The Runs a mention starts: one per general channel message (#23) and one per Card note (#22). Both keep the same
// lifecycle in the database under their own functions; one driver moves them, and a Run's idempotency key is its
// source's key and its message id.
/** @type {{channel:RunSource,note:RunSource}} */
const sources={
 channel:{key:'channel',label:'Channel',due:'channel_runs_due',begin:'begin_channel_start',answer:'answer_channel_start',close:'close_channel_run'},
 note:{key:'note',label:'Note',due:'note_runs_due',begin:'begin_note_start',answer:'answer_note_start',close:'close_note_run'},
};
/** @param {RunSource} source @param {number} message */
const runKey=(source,message)=>`${source.key}:${message}`;
const duePage=500;
/** @type {Record<string,{refused:'channelNotFound'|'channelNotAllowed'|'channelFailed',status:400|403|404}>} */
const refusals={P0002:{refused:'channelNotFound',status:404},'42501':{refused:'channelNotAllowed',status:403}};

/** @param {any} db @param {any} service @param {{channel:string,sendKey:string,message:string,hermes?:{address:string,key:string}|null,engineFor?:EngineFor}} post
 * @returns {Promise<{message:number}|{refused:'channelNotFound'|'channelNotAllowed'|'channelFailed',status:400|403|404}>} */
export async function postChannelMessage(db,service,{channel,sendKey,message,hermes=hermesAt(),engineFor=defaultEngine}) {
 const {data:id,error}=await db.rpc('post_channel_message',{ch:channel,message_key:sendKey,message});
 if(error) return refusals[error.code]||{refused:'channelFailed',status:400};
 try { await driveChannelRuns(service,{hermes,engineFor,message:id}); }
 catch(failure) { console.error('Channel run not started:',id,failure?.message||'unknown error'); }
 return {message:id};
}

/** @param {any} service @param {{hermes?:{address:string,key:string}|null,engineFor?:EngineFor,channel?:string|null,message?:number|null}} options
 * @returns {Promise<{started:number,closed:number}>} */
export function driveChannelRuns(service,{hermes=hermesAt(),engineFor=defaultEngine,channel=null,message=null}) {
 return driveRuns(sources.channel,service,{hermes,engineFor,message,scope:{just_channel:channel}});
}

/** @param {any} service @param {{hermes?:{address:string,key:string}|null,engineFor?:EngineFor,message?:number|null}} options
 * @returns {Promise<{started:number,closed:number}>} */
export function driveNoteRuns(service,{hermes=hermesAt(),engineFor=defaultEngine,message=null}) {
 return driveRuns(sources.note,service,{hermes,engineFor,message,scope:{}});
}

/** @param {RunSource} source @param {any} service @param {{hermes:{address:string,key:string}|null,engineFor:EngineFor,message:number|null,scope:Record<string,unknown>}} options */
async function driveRuns(source,service,{hermes,engineFor,message,scope}) {
 const engines=new Map(); let started=0; let closed=0; let after=0;
 for(;;) {
  const {data:due,error}=await service.rpc(source.due,{...scope,just_message:message,after});
  if(error) throw error;
  for(const row of due||[]) {
   try {
    if(row.run) closed+=await closeOne(source,service,row,engines,hermes,engineFor);
    else started+=await startOne(source,service,row.message,hermes,engineFor);
   } catch(failure) { console.error(`${source.label} run not moved:`,row.message,failure?.message||'unknown error'); }
  }
  if(!due||due.length<duePage) return {started,closed};
  after=due.at(-1).message;
 }
}

/** @param {RunSource} source @param {any} service @param {number} message @param {{address:string,key:string}|null} hermes @param {EngineFor} engineFor */
async function startOne(source,service,message,hermes,engineFor) {
 const {data:rows,error}=await service.rpc(source.begin,{message});
 if(error) throw error;
 const begun=rows?.[0]; if(!begun) return 0;
 const connection=onProfile(begun.profile,begun.company,hermes);
 // The Agent's own instructions, which an Agent on its own profile has as the profile's soul instead (ADR 0016); the
 // Company knowledge is the profile's auto-loaded Skill (#344), never sent.
 const instructions=[connection&&agentInstructionsFor(connection,begun.instructions)].filter(Boolean).join('\n\n');
 // A channel Run's tools are pinned at its first start, as a Conversation's are (pin_channel_run): the draft and review
 // tools when the Member who called its Agent may write. A retry finds them pinned and sends the same request.
 const tools=source===sources.channel?await pinnedChannelTools(service,message):undefined;
 const run=connection?await engineFor(connection).start({conversation:begun.session,input:begun.input,idempotencyKey:runKey(source,message),...(instructions?{instructions}:{}),...(tools?{tools}:{}),retry:begun.attempt>1}):null;
 if(startOutcomeUnknown(run)) return 0;
 const {data:recorded,error:unrecorded}=await service.rpc(source.answer,{message,attempt:begun.attempt,run});
 if(unrecorded) throw unrecorded;
 return recorded&&run?1:0;
}

// The tools a channel Run was pinned with, or pins now at its first start; undefined when it is offered none.
/** @param {any} service @param {number} message @returns {Promise<import('./engine.mjs').ToolSpec[]|undefined>} */
async function pinnedChannelTools(service,message) {
 const {data,error}=await service.rpc('pin_channel_run',{message,specs:toolSpecTexts()});
 if(error) throw error;
 return typeof data?.tools==='string'?JSON.parse(data.tools):undefined;
}

/** @param {RunSource} source @param {any} service @param {{message:number,run:string,profile:string|null}} row @param {Map<string,any>} engines @param {{address:string,key:string}|null} hermes @param {EngineFor} engineFor */
async function closeOne(source,service,row,engines,hermes,engineFor) {
 if(!row.profile) return close(source,service,row,'lost',null);
 if(!engines.has(row.profile)) { const target=onProfile(row.profile,null,hermes); engines.set(row.profile,target&&engineFor(target)); }
 const engine=engines.get(row.profile);
 if(!engine) return 0;
 const started=new Date().toISOString();
 const result=await engine.read(row.run);
 const readEnded=new Date().toISOString();
 if(result.state==='unreachable') { engines.set(row.profile,null); return 0; }
 // Nobody can answer a channel's or a note's Run (#138): its question is answered at once with nothing, which the
 // engine reads as unanswered, so no answer is never a yes.
 if(result.question) await engine.answer(row.run,result.question.id,'');
 if(source===sources.channel) { if(!await trackChannelPermission(service,row,engine,result,started,readEnded)) return 0; }
 // Nobody can allow a note's Run an action (#163): its request is not allowed, at once.
 else if(result.permission) await engine.permit(row.run,result.permission.id,'deny');
 const outcome=outcomeOf(result);
 if(!outcome) return 0;
 // A completed channel Run's tool calls are carried out in order before it closes (#148): a draft or review card is kept
 // once for the message, run and call (channel_show_card), so a second closer leaves the same one. Any other call is not
 // one this channel offered, and is ignored.
 if(source===sources.channel&&result.state==='completed') for(const call of result.toolCalls) {
  if(!cardTools.has(call.name)) continue;
  const done=await runToolCall({db:service,engine,profile:row.profile,run:row.run,channel:{message:row.message}},call);
  if(done.state==='engineUnreachable') return 0;
 }
 return close(source,service,row,outcome,result);
}

// A channel's Run asks the Member who called its Agent (#165), as a Conversation's asks its person (#163): each read keeps
// the request it waits on, and every choice claimed for it is delivered before the Run may close. A request with no
// words to show is not allowed, at once. Returns false while a claim could not be delivered, which holds the Run.
/** @param {any} service @param {{message:number,run:string,profile:string|null}} row @param {any} engine @param {import('./engine.mjs').RunState} result @param {string} started @param {string} readEnded */
async function trackChannelPermission(service,row,engine,result,started,readEnded) {
 const permission=result.permission?requestedOf(result.permission):null;
 if(permission&&!permission.description&&!permission.command) await engine.permit(row.run,permission.id,'deny');
 const {data:claims,error}=await service.rpc('track_channel_permission',{message:row.message,run:row.run,asking:permission&&(permission.description||permission.command)?permission:null,ended:result.state!=='running',read_started_at:started,read_ended_at:readEnded,run_profile:row.profile});
 if(error) throw error;
 for(const claim of claims||[]) {
  const delivered=await engine.permit(row.run,claim.permission,claim.choice);
  if(delivered==='unreachable') return false;
  const {error:unsettled}=await service.rpc('settle_channel_permission',{card:claim.card,verdict:delivered==='answered'?'decided':'closed'});
  if(unsettled) throw unsettled;
 }
 return true;
}

// The Member who called the Agent answers its Run's request with one of its choices (#165). `db` is their own session,
// so the database checks they called it, may write, and may send that choice, and keeps the first press only
// (decide_channel_permission). The press is answered once the choice is kept; delivering it runs in `later` (the
// route's after()), and if it dies there the channel's next read delivers it. Nothing the request says is logged.
/** @param {any} db @param {any} service @param {{company:string,channel:string,request:number,choice:import('./engine.mjs').PermissionChoice,hermes?:{address:string,key:string}|null,engineFor?:EngineFor,later:(deliver:()=>Promise<void>)=>void}} press
 * @returns {Promise<{state:'decided'|'closed',choice:import('./engine.mjs').PermissionChoice|null,at:string|null,first:boolean}|{code:string|undefined}>} */
export async function decideChannelPermission(db,service,{company,channel,request,choice,hermes=hermesAt(),engineFor=defaultEngine,later}) {
 const {data:pressed,error}=await db.rpc('decide_channel_permission',{c:company,request,choice});
 if(error) return {code:error.code};
 if(pressed.first) later(async()=>{
  try { await driveChannelRuns(service,{hermes,engineFor,channel}); }
  catch(failure) { console.error('Permission not delivered yet:',channel,failure?.code||failure?.name||'unknown error'); }
 });
 return pressed;
}

/** @param {RunSource} source @param {any} service @param {{message:number,run:string}} row @param {'completed'|'failed'|'stopped'|'lost'} outcome @param {import('./engine.mjs').RunState|null} result */
async function close(source,service,row,outcome,result) {
 // Postgres cannot store a NUL character; dropping it keeps such a reply from failing forever.
 const reply=outcome==='completed'&&result?.reply?result.reply.replaceAll('\u0000',''):null;
 // Token use is Hermes's own (#347): the close keeps its usage arguments for the previous app version and sends none.
 const {data:saved,error}=await service.rpc(source.close,{message:row.message,run:row.run,run_outcome:outcome,reply,used_input:null,used_output:null});
 if(error) throw error;
 return saved?1:0;
}
