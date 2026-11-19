import { engineFor as defaultEngine, outcomeOf, startOutcomeUnknown } from './engine.mjs';
import { agentInstructionsFor, askedOf, imageInput, requestedOf } from './conversation-runs.mjs';
import { channelImages, discardChannelFiles, keepChannelFiles } from './channel-files.mjs';
import { hermesAt, onProfile } from './bundled-hermes.mjs';
import { runToolCall, channelToolSpecTexts } from './agent-tools.mjs';
// The tools a channel Run is offered (#148, #149, #150): the draft (#136), the review (#137), the handed step (#139) and
// the handover to another Agent of the channel (#150), as a Conversation's Run is.
const cardTools=new Set(['show_draft','show_review','hand_over','hand_to_agent']);

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
/** @param {RunSource} source @param {{message:number,ordinal?:number}} row */
const runKey=(source,row)=>`${source.key}:${row.message}${row.ordinal>1?`:${row.ordinal}`:''}`;
const duePage=500;
/** @type {Record<string,{refused:'channelNotFound'|'channelNotAllowed'|'channelFailed',status:400|403|404}>} */
const refusals={P0002:{refused:'channelNotFound',status:404},'42501':{refused:'channelNotAllowed',status:403}};

/** @param {any} db @param {any} service @param {{company?:string,channel:string,sendKey:string,message:string,files?:File[],hermes?:{address:string,key:string}|null,engineFor?:EngineFor}} post
 * @returns {Promise<{message:number}|{refused:'channelNotFound'|'channelNotAllowed'|'channelFailed',status:400|403|404}>} */
export async function postChannelMessage(db,service,{company,channel,sendKey,message,files=[],hermes=hermesAt(),engineFor=defaultEngine}) {
 const filesPlace={company:company??'',channel,messageKey:sendKey};
 // The images are kept and written before the message is posted, as a Conversation's are kept before its Agent is asked
 // (#155): the message's insert links them to it, so the Run it starts already reads them, and a post the database
 // refuses leaves nothing of the send behind. A message that calls no Agent keeps them under its turn, with no Run.
 if(files.length) {
  const kept=await keepChannelFiles(db,service,{...filesPlace,files});
  if(kept.error) return {refused:kept.error==='channelNotFound'||kept.error==='channelNotAllowed'?kept.error:'channelFailed',
   status:kept.error==='channelNotFound'?404:kept.error==='channelNotAllowed'?403:400};
 }
 const {data:id,error}=await db.rpc('post_channel_message',{ch:channel,message_key:sendKey,message});
 // The message was refused, so the files kept for it go too: the sender is told the send failed, and nothing of it stays.
 if(error) { if(files.length) await discardChannelFiles(db,service,filesPlace); return refusals[error.code]||{refused:'channelFailed',status:400}; }
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
 const engines=new Map(); const began=new Set(); let started=0; let closed=0; let after=0;
 for(;;) {
  const {data:due,error}=await service.rpc(source.due,{...scope,just_message:message,after});
  if(error) throw error;
  // A Run of a message that is next in line only becomes due once its Agent's reply is in: a channel's page is read
  // again while a Run was moved (#152), and a Run this pass already started is never started a second time by that
  // second read. A note has one Run with nothing after it, so its page is read once: a later pass closes it, as before.
  const rows=(due||[]).filter(row=>row.run||!began.has(`${row.message}:${row.ordinal??1}`));
  let moved=0;
  for(const row of rows) {
   try {
    if(row.run) { const done=await closeOne(source,service,row,engines,hermes,engineFor); closed+=done; moved+=done; }
    else {
     began.add(`${row.message}:${row.ordinal??1}`);
     const done=await startOne(source,service,row,hermes,engineFor); started+=done; moved+=done;
    }
   } catch(failure) { console.error(`${source.label} run not moved:`,row.message,failure?.message||'unknown error'); }
  }
  if(!due||due.length<duePage) { if(source!==sources.channel||!moved||!rows.length) return {started,closed}; after=0; continue; }
  after=due.at(-1).message;
 }
}

/** @param {RunSource} source @param {any} service @param {{message:number,ordinal?:number}} row @param {{address:string,key:string}|null} hermes @param {EngineFor} engineFor */
async function startOne(source,service,row,hermes,engineFor) {
 const message=row.message;
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
 // A channel message that carries images gives its Run one image part per file (#156), as a Conversation's does; its
 // turn's own words are the text part. A message with none reads nowhere, as before; a note has no files at all.
 const images=source===sources.channel&&begun.has_files?await channelImages(service,message):undefined;
 const run=connection?await engineFor(connection).start({conversation:begun.session,input:images?.length?imageInput(begun.input,images):begun.input,idempotencyKey:runKey(source,{message,ordinal:begun.ordinal??row.ordinal}),...(instructions?{instructions}:{}),...(tools?{tools}:{}),retry:begun.attempt>1}):null;
 if(startOutcomeUnknown(run)) return 0;
 // A channel's answer names the Run that began, by its place (#354): a refusal for one Agent's attempt must never end
 // another's, since both may be a first attempt of their own leg. A note's answer takes no place.
 const {data:recorded,error:unrecorded}=await service.rpc(source.answer,{message,attempt:begun.attempt,run,...(source===sources.channel?{ordinal:begun.ordinal??row.ordinal??1}:{})});
 if(unrecorded) throw unrecorded;
 return recorded&&run?1:0;
}

// The tools a channel Run was pinned with, or pins now at its first start; undefined when it is offered none.
/** @param {any} service @param {number} message @returns {Promise<import('./engine.mjs').ToolSpec[]|undefined>} */
async function pinnedChannelTools(service,message) {
 const {data:names,error:unnamed}=await service.rpc('channel_handover_agents',{message});
 if(unnamed) throw unnamed;
 // #150: inside a channel only the main Agent hands work over, and only to the channel's other Agents, which the
 // database names or leaves empty when this Run's Agent may not hand over. The names are the tool's enum, and the text
 // is pinned with the Run, so a retry sends the same request and a later Agent added to the channel changes nothing.
 const specs=channelToolSpecTexts(Array.isArray(names)?names:[]);
 const {data,error}=await service.rpc('pin_channel_run',{message,specs});
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
 // A channel's Run asks the whole team (#149), and the main Agent's own one question its message's sender alone (#143):
 // the question is kept on every read, and every answer claimed for it is delivered before the Run may close. A question
 // no card can settle (#354) — no words, no choices to pick, or several at once, which a card offers one of — is answered
 // empty at once, as a note's is, and keeps no card: the Run is never held open by one nobody can press. A note's Run is
 // answered at once with nothing too: nobody can answer it (#138).
 if(result.question) {
  if(source===sources.channel) {
   const question=askedOf(result.question);
   const answerable=!!question.text&&question.choices.length>0&&!question.multiple;
   if(!answerable) await engine.answer(row.run,question.id,'');
   const {data:claims,error}=await service.rpc('track_channel_question',{message:row.message,run:row.run,asking:answerable?question:null,ended:result.state!=='running',read_started_at:started});
   if(error) throw error;
   for(const claim of claims||[]) {
    const delivered=await engine.answer(row.run,claim.question,claim.answer);
    if(delivered==='unreachable') return 0;
    const {error:unsettled}=await service.rpc('settle_channel_question',{card:claim.card,verdict:delivered==='answered'?'answered':'closed'});
    if(unsettled) throw unsettled;
   }
  } else await engine.answer(row.run,result.question.id,'');
 }
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

// A Member of the channel answers the question its Agent's Run waits on (#149): a pick names the card and the choice's
// index. `db` is their own session, so the database checks they are in the channel and may write there, and that the main
// Agent's question is theirs to answer (answer_channel_question); the first answer is kept for everyone. The press is
// answered once the answer is kept, and delivering it runs in `later` (the route's after()); if it dies there the
// channel's next read delivers it.
/** @param {any} db @param {any} service @param {{company:string,channel:string,card:number,choice?:number|null,answer?:string|null,answerKey:string,hermes?:{address:string,key:string}|null,engineFor?:EngineFor,later:(deliver:()=>Promise<void>)=>void}} claim
 * @returns {Promise<{state:'claimed'|'taken'|'closed'}|{code:string|undefined}>} */
export async function answerChannelQuestion(db,service,{company,channel,card,choice=null,answer=null,answerKey,hermes=hermesAt(),engineFor=defaultEngine,later}) {
 const {data:state,error}=await db.rpc('answer_channel_question',{c:company,channel,card,choice,answer,answer_key:answerKey});
 if(error) return {code:error.code};
 if(state==='claimed') later(async()=>{
  try { await driveChannelRuns(service,{hermes,engineFor,channel}); }
  catch(failure) { console.error('Channel answer not delivered yet:',channel,failure?.code||failure?.name||'unknown error'); }
 });
 return {state};
}

// A Member of the channel presses "Done it" on a step its Agent handed the team (#149): the database keeps who and when
// once, and the first press writes the message that asks that Agent to pick up, as a Run of the channel (#140). `db` is
// their own session, so the database checks they are in the channel and may write there (mark_channel_hand_done). The
// press is answered once it is kept; the Run starts in `later`, and if it dies there the channel's next read starts it.
/** @param {any} db @param {any} service @param {{company:string,channel:string,card:number,hermes?:{address:string,key:string}|null,engineFor?:EngineFor,later:(deliver:()=>Promise<void>)=>void}} press
 * @returns {Promise<{state:'done',at:string,first:boolean,message?:number}|{code:string|undefined}>} */
export async function markChannelHandDone(db,service,{company,channel,card,hermes=hermesAt(),engineFor=defaultEngine,later}) {
 const {data,error}=await db.rpc('mark_channel_hand_done',{c:company,channel,card});
 if(error) return {code:error.code};
 if(data?.first&&typeof data.message==='number') later(async()=>{
  try { await driveChannelRuns(service,{hermes,engineFor,channel,message:data.message}); }
  catch(failure) { console.error('Channel hand turn not started:',channel,failure?.message||'unknown error'); }
 });
 return data;
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
