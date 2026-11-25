import { engineFor as defaultEngine, endOf, startOutcomeNotReached, startOutcomeUnknown } from './engine.mjs';
import { isAgentProfile } from './agent-toolsets.mjs';
import { engineOf, onProfile, stopOnProfiles } from './company-engine.mjs';
import { cut, conversationToolSpecTexts, runToolCall } from './agent-tools.mjs';
import { leadInstructions } from './lead-offer.mjs';
import { jobCommandIn, mentionedAgent } from './composer-mentions.mjs';
import { companyAgents } from './sidebar.mjs';
import { downloadAgentFile } from './hermes.mjs';
import { keepReplyFiles, storageUpload } from './reply-files.mjs';
import { filesAsImages, MessageFileGone } from './message-files.ts';
import { logFallbackMove } from './fallback-model.mjs';
import { waitLine } from './diagnostics.mjs';

// The Agent a message calls (#153): lib/composer-mentions.mjs, where the composer reads it too (#700).
export { mentionedAgent };

// A person's message in their conversation (ADR 0029, #764): stored first, its Run started after. `db` is the person's
// own session, so the database checks they may write in the company (any Member but a Viewer, #287) and the
// conversation is theirs; `service` is a service-role client. The author of the message is always the signed-in person
// of `db`: nothing in `send` names who wrote it.
// The database decides what the message is (queue_conversation_turn): addressed to a person (@<Member name>), it is kept
// as a note and no run starts; otherwise it is stored as the sender's waiting turn, busy Agent or not, and the one
// starter of turns (startQueuedTurns) starts its Run: `later` is given that start, which the route runs once its answer
// has gone (next/server after) and which the worker's pass over waiting turns runs too, whatever happens to the request.
// The claim on a turn keeps the two from starting it twice. Without `later` the start runs before this answers (tests,
// the install's checks), and the answer then says how it went.
// While the Agent waits on a question (#138), the message is its answer instead: it goes to the waiting Run and starts
// none, and the same send key finds the same answer; delivering it is given to `later` too.
// A message's images (#155) are kept with its turn before the turn is stored (`keepFiles`), so the starter always reads
// them from the Conversation's files: a new Conversation is made first (open_only), with every check.
// Returns the conversation (marked queued while its Run has not started, addressed when no run starts, answered when it
// answered the question), a database refusal code, or a refusal to show.
/** @param {any} db @param {any} service @param {{person?:string,company:string,conversation:string,sendKey:string,agent?:string,message:string,keepFiles?:()=>Promise<{error?:string}>,hermes?:{address:string,key:string}|null|Promise<{address:string,key:string}|null>,engineFor?:typeof defaultEngine,later?:(work:()=>Promise<void>)=>void|Promise<void>}} send
 * @returns {Promise<{conversation:string,queued?:true,addressed?:true,answered?:true}|{code:string|undefined}|{error:string,status:number}>} */
export async function sendMessage(db,service,{company,conversation,sendKey,agent:chosen,message,keepFiles,hermes,engineFor=defaultEngine,later}) {
 const inline=!later;
 // Checked before anything is stored: an id that is someone else's is refused.
 const {data:stored,error:refused}=await db.rpc('conversation_agent',{conversation,c:company});
 if(refused) return {code:refused.code};
 // Only a Conversation already there can wait on a question. One whose answer is already on its way (sent from another
 // tab) takes this message as its next turn, as any message while the Agent works.
 if(stored) {
  const {data:state,error}=await db.rpc('answer_question',{c:company,conversation,card:null,choice:null,answer:message,answer_key:sendKey});
  if(error) return {code:error.code};
  if(state==='claimed') {
   const deliver=async()=>{
    try { await closeOpenRuns(service,{hermes:await hermes??null,conversation,engineFor}); }
    catch(failure) { console.error('Answer not delivered yet:',conversation,failure?.message||'unknown error'); }
   };
   if(inline) await deliver(); else await later(deliver);
   return {conversation,answered:true};
  }
 }
 let agent=stored||chosen;
 // A new chat's first message that calls an Agent the sender sees goes to that Agent, not to the one whose empty chat
 // was open (#153; design-reference: send, mentionedAgent). The sender's own session lists only the Agents they see.
 if(!stored&&chosen) agent=mentionedAgent(message,(await db.from('hermes_agents').select('id,name,is_default').eq('company_id',company)).data||[])||chosen;
 if(!agent) agent=(await db.from('hermes_agents').select('id').eq('company_id',company).eq('is_default',true).maybeSingle()).data?.id;
 const {data:inCompany}=agent?await db.from('hermes_agents').select('id,is_default').eq('id',agent).eq('company_id',company).maybeSingle():{data:null};
 if(!inCompany) return {error:'conversationNotFound',status:404};
 // A job command sent to the main Agent hands its job to the Agent of that role in this same chat (#358): the person's
 // message and a handover row are kept together (command_handover), and the worker starts the target's Run and stores
 // its reply as the chat's answer from that Agent (lib/handovers.mjs). The command is gtmworks's own, so it never waits
 // on the model; words that are no listed command of an Agent this person sees, or that carry no job, run as typed.
 if(inCompany.is_default===true&&!keepFiles&&/^\s*\//.test(message)) {
  // The Agents this person sees, as the sidebar lists them, so a command the composer offers is the one handed over.
  const visible=await companyAgents(db,company);
  const job=jobCommandIn(message,visible.map(agent=>({id:agent.id,name:agent.name,role:agent.template})));
  if(job) {
   const {data:handed,error:unhanded}=await db.rpc('command_handover',{conversation,c:company,agent:inCompany.id,message_key:sendKey,message,role:job.role,goal:job.goal});
   if(unhanded) return {code:unhanded.code};
   if(handed) return {conversation};
  }
 }
 const queue=(/** @type {boolean} */ openOnly)=>db.rpc('queue_conversation_turn',{conversation,c:company,agent:inCompany.id,message_key:sendKey,message,open_only:openOnly});
 // The files first: kept under the Conversation's row (made now if it is new), before the turn the starter claims.
 if(keepFiles) {
  if(!stored) { const {error:unopened}=await queue(true); if(unopened) return {code:unopened.code}; }
  const kept=await keepFiles();
  if(kept.error) return {error:kept.error,status:kept.error==='conversationFailed'?500:403};
 }
 const {data:turn,error:unqueued}=await queue(false);
 if(unqueued) return {code:unqueued.code};
 if(turn?.state==='note') return {conversation,addressed:true};
 if(turn?.state==='answered') return {conversation,answered:true};
 if(turn?.state==='sent') return {conversation};
 if(turn?.state==='failed') return {conversation,queued:true};
 /** @type {Map<string,TurnOutcome>} */ const outcomes=new Map();
 const start=async()=>{
  try { await startQueuedTurns(service,{conversation,hermes:await hermes,engineFor,outcomes}); }
  catch(failure) { console.error('Conversation turn not started yet:',conversation,failure?.message||'unknown error'); }
 };
 if(!inline) { await later(start); return {conversation,queued:true}; }
 await start();
 // How the turn the request started itself went (no `later`): its Run started, it failed (with the Conversation's model
 // refused when so), or it still waits (an Engine not reached, a start whose outcome is unknown, a profile not ready,
 // another turn ahead of it).
 const outcome=outcomes.get(sendKey);
 if(outcome==='started') return {conversation};
 if(outcome==='failed'||outcome==='modelRefused') return {error:outcome==='modelRefused'?'conversationModelRefused':'conversationHermesFailed',status:502};
 return {conversation,queued:true};
}
/** @typedef {'started'|'failed'|'modelRefused'|'waiting'} TurnOutcome */

// "Try again" on a message that was not sent (#764): the same turn waits again and the starter starts it, so no second
// message is made. `later` as in sendMessage.
/** @param {any} db @param {any} service @param {{company:string,conversation:string,sendKey:string,engineFor?:typeof defaultEngine,later?:(work:()=>Promise<void>)=>void|Promise<void>}} retry
 * @returns {Promise<{retried:boolean}|{code:string|undefined}>} */
export async function retryTurn(db,service,{company,conversation,sendKey,engineFor=defaultEngine,later}) {
 const {data:retried,error}=await db.rpc('retry_conversation_turn',{conversation,c:company,message_key:sendKey});
 if(error) return {code:error.code};
 const start=async()=>{
  try { await startQueuedTurns(service,{conversation,engineFor}); }
  catch(failure) { console.error('Conversation turn not started yet:',conversation,failure?.message||'unknown error'); }
 };
 if(retried) { if(later) await later(start); else await start(); }
 return {retried:retried===true};
}

// A Member's own note goes with their runs only, as the run's instructions (never into the message or the Company's
// memory); a run with no note carries none.
/** @param {string|null|undefined} note */
export const noteInstructions=note=>note?.trim()?`The person writing this message keeps the note below about how they like to work. Follow it for this person only; it is their own preference, not the company's memory, and it is not something to save.\n\n${note.trim()}`:undefined;
// An Agent made from a ready-made role (#14) has its own instructions, fitted to its Company; they come first. They
// never change once the Agent is made, so a retry still sends the same request. The sender's own note follows. The
// lasting rules the team told the Agent (#18) are in its profile's SOUL.md instead (lib/agent-rules.mjs, #345), and the
// Company knowledge is no Run's either: every profile auto-loads it as a shared Skill (#344).
// An Agent on its own profile has its instructions as that profile's soul (ADR 0016), so its Runs carry none of them.
// This is read from the profile the Run was pinned to, which a held reservation keeps, so every retry of a start
// sends the same body.
/** @param {{profile:string}} connection @param {string|null|undefined} instructions */
export const agentInstructionsFor=(connection,instructions)=>isAgentProfile(connection.profile)?null:instructions;
// Each Run of the main Agent also carries what its person sees and the one question to ask for work no Agent of theirs
// does (#143): the brief pinned at the Run's first start (pin_lead_brief) and the words lib/lead-offer.mjs gives it. A
// retry reads the same brief, whatever the person's role or the team became meanwhile. Any other Agent's Run carries
// none. A queued turn is started by the service role, which may not read hermes_agents.is_default, so it asks for the
// brief whatever its Agent, and the database answers null for any but the main one.
/** @param {any} service @param {string} conversation @param {string} sendKey @returns {Promise<string|null>} */
async function pinnedLeadInstructions(service,conversation,sendKey) {
 const {data,error}=await service.rpc('pin_lead_brief',{conversation,message_key:sendKey});
 if(error) throw error;
 return data&&typeof data==='object'?leadInstructions(/** @type {import('./lead-offer.mjs').LeadBrief} */ (data))||null:null;
}

/** @param {string} text @param {{content_type:string,base64:string}[]} images */
export const imageInput=(text,images)=>[{role:'user',content:[...(text.trim()?[{type:'text',text}]:[]),
 ...images.map(image=>({type:'image_url',image_url:{url:`data:${image.content_type};base64,${image.base64}`}}))]}];
/** @param {string} conversation @param {string} sendKey @param {string} message @param {{agentInstructions:string|null|undefined,lead?:string|null,note:string|null|undefined,tools:import('./engine.mjs').ToolSpec[]|undefined,history:import('./engine.mjs').HistoryEntry[]|undefined,model?:import('./engine.mjs').ModelChoice|null,images?:{content_type:string,base64:string}[]|null}} parts */
const runInput=(conversation,sendKey,message,{agentInstructions,lead,note,tools,history,model,images})=>{
 const instructions=[agentInstructions,lead,noteInstructions(note)].filter(Boolean).join('\n\n');
 // A message with no images is sent as its text, as every message was before.
 const input=images?.length?imageInput(message,images):message;
 return {conversation,input,idempotencyKey:`${conversation}:${sendKey}`,...(instructions?{instructions}:{}),...(tools?{tools}:{}),...(history?{history}:{}),...(model?{model}:{})};
};
// The images a message carries (#155), read from the Conversation's own files by its send key in the order they were
// chosen and handed over as base64: the one image part the Engine reads for each. A turn that waited behind another
// Run reads them here, so its request holds the same images as the send that stored them, and a retry of it sends the
// same body again. `db` is a service-role client: the file rows and the bytes are the sender's own, named by a key only
// their send made.
/** @param {any} db @param {string} conversation @param {string} sendKey @returns {Promise<{content_type:string,base64:string}[]|undefined>} */
async function pinnedImages(db,conversation,sendKey) {
 const {data,error}=await db.from('conversation_attachments').select('content_type,path').eq('conversation_id',conversation).eq('send_key',sendKey).order('position');
 if(error) throw error;
 return filesAsImages(db,data||[],'conversationFileMissing');
}
// A run's tools are pinned at its first start (pin_run): the tools its sender may then use with this Agent
// (create_agent, save_rule or suggest_rule), as the text sent. Every retry sends those, whatever a later version
// offers, and a run the previous app version already tried to start keeps what that version sent (#14's tools).
// hand_to_agent's text names the Company's other Agents (#475), as the database lists them for this Run.
/** @param {any} service @param {string} conversation @param {string} sendKey @returns {Promise<{tools:import('./engine.mjs').ToolSpec[]|undefined}>} */
async function pinnedRun(service,conversation,sendKey) {
 const {data:agents,error:unlisted}=await service.rpc('conversation_handover_agents',{conversation,message_key:sendKey});
 if(unlisted) throw unlisted;
 const {data,error}=await service.rpc('pin_run',{conversation,message_key:sendKey,specs:conversationToolSpecTexts(Array.isArray(agents)?agents:[])});
 if(error) throw error;
 return {tools:typeof data?.tools==='string'?JSON.parse(data.tools):undefined};
}

// Every Run of a Conversation that began before its Agent moved to its own profile (#121) carries the Conversation's
// record as its history (pin_run_history), pinned so a retry sends the same; every other Run carries none.
/** @param {any} service @param {string} conversation @param {string} sendKey @returns {Promise<import('./engine.mjs').HistoryEntry[]|undefined>} */
async function pinnedHistory(service,conversation,sendKey) {
 const {data,error}=await service.rpc('pin_run_history',{conversation,message_key:sendKey});
 if(error) throw error;
 return Array.isArray(data)&&data.length?data:undefined;
}

// The model the Owner chose for the Conversation (#158), pinned at the Run's first start (pin_run_model), or none.
/** @param {any} service @param {string} conversation @param {string} sendKey @returns {Promise<import('./engine.mjs').ModelChoice|null>} */
async function pinnedModel(service,conversation,sendKey) {
 const {data,error}=await service.rpc('pin_run_model',{conversation,message_key:sendKey});
 if(error) throw error;
 return typeof data?.provider==='string'&&typeof data?.model==='string'?{provider:data.provider,model:data.model}:null;
}

// Turns that waited while the Agent was busy start once a Conversation's open run has ended, up to four Conversations at
// once and one turn at a time within each, oldest first: the worker runs this after closing runs, and a person reading
// their conversation runs it for that one. The database lists the waiting Conversations page by page behind a stable
// cursor, so a full page of Conversations that cannot start yet never hides a ready one. It claims a turn only
// while nothing runs there and records it as its own sender's message (the queue kept who sent it), with the Agent's own
// instructions and that sender's note as the run's instructions. Only a turn the engine definitely did not start is
// marked failed, so the next one can go and its sender sees it was not sent; one whose start may have happened is asked
// again on a later pass. `db` is a service-role client.
const startsAtOnce=4;
// `hermes` is the Engine to start on when the caller already has it, null when the Company has none; left out, each
// turn's Company answers which Engine serves it.
// `outcomes`, when given, is told how each turn this pass took went, by its send key.
/** @param {any} db @param {{hermes?:{address:string,key:string}|null,conversation?:string|null,engineFor?:typeof defaultEngine,outcomes?:Map<string,TurnOutcome>}} options */
export async function startQueuedTurns(db,{hermes,conversation=null,engineFor=defaultEngine,outcomes}) {
 const waiting=[];
 for(let after=null;;) {
  const {data,error}=await db.rpc('queued_conversations',{just:conversation,after});
  if(error) throw error;
  const page=data||[];
  waiting.push(...page);
  if(page.length<500) break;
  after=page.at(-1).conversation;
 }
 let started=0;
 // Four lanes take the next waiting Conversation as each finishes, so one slow start holds up only its own lane.
 let next=0;
 const lane=async()=>{ while(next<waiting.length) if(await startQueuedTurn(db,waiting[next++].conversation,{hermes,engineFor,outcomes})) started++; };
 await Promise.all(Array.from({length:startsAtOnce},lane));
 return started;
}

// One Conversation's waiting turn, if the database claims it and the Engine starts it: recorded and true, or nothing and
// false. Every failure is logged and holds up no other Conversation. A stored image that is gone fails the turn for its
// sender, so the Conversation's next turn can start; any other failure may pass and waits for the next pass. The turn's
// Company answers which Engine serves it.
/** @param {any} db @param {string} id @param {{hermes:{address:string,key:string}|null|undefined,engineFor:typeof defaultEngine,outcomes?:Map<string,TurnOutcome>}} options */
async function startQueuedTurn(db,id,{hermes,engineFor,outcomes}) {
 let turn;
 const told=(/** @type {TurnOutcome} */ outcome)=>{ if(turn) outcomes?.set(turn.send_key,outcome); };
 try {
  const {data:claimed,error:unclaimed}=await db.rpc('claim_conversation_turn',{conversation:id});
  if(unclaimed) throw unclaimed;
  turn=claimed?.[0]; if(!turn) return false;
  // A turn already attempted (its start marked unknown, or begun by a stopped worker or another claimer) is a retry.
  let retry=turn.retry===true;
  const connection=onProfile(turn.profile,turn.company,hermes===undefined?await engineOf(turn.company):hermes);
  // A retry waits for its own profile: it may hold the run, so it is never failed here.
  if(!connection&&retry) return false;
  let attempt=0; let tools; let history; let model=null; let agentInstructions=null; let lead=null; let images;
  if(connection) {
   ({tools}=await pinnedRun(db,id,turn.send_key));
   history=await pinnedHistory(db,id,turn.send_key);
   model=await pinnedModel(db,id,turn.send_key);
   // A turn that carries images (#155) reads them from the Conversation's files, as its send stored them.
   if(turn.has_files) images=await pinnedImages(db,id,turn.send_key);
   // pin_lead_brief answers null for any Agent but the main one (and the service role may not read hermes_agents.is_default), so it is asked for every turn.
   const {data:agent,error:unread}=await db.from('hermes_agents').select('instructions').eq('id',turn.agent).eq('company_id',turn.company).maybeSingle(); if(unread) throw unread; agentInstructions=agentInstructionsFor(connection,agent?.instructions);
   lead=await pinnedLeadInstructions(db,id,turn.send_key);
   const {data:begun,error:unbegun}=await db.rpc('begin_turn_start',{conversation:id,message_key:turn.send_key}); if(unbegun) throw unbegun; if(!begun) return false; attempt=begun;
   // From here the attempt decides (#514): marking a start unknown never lowers the count and a hand back never follows
   // one, so a first attempt is one no earlier attempt still counts, whatever the claim read while another was in flight.
   retry=attempt>1;
  }
  const run=connection&&await engineFor(connection).start({...runInput(id,turn.send_key,turn.message,{agentInstructions,lead,note:turn.note,tools,history,model,images}),retry});
  // An Engine that is not running never got the start (#514): its attempt is handed back (release_queued_start), so the
  // turn stays due as never started, its model is not refused, and its next start is a first attempt again, until the
  // Engine answers or the reservation's ten minutes end it (abandon_conversation_reservations fails such a turn).
  if(startOutcomeNotReached(run)) { const {error:unreleased}=await db.rpc('release_queued_start',{conversation:id,message_key:turn.send_key,attempt}); if(unreleased) throw unreleased; told('waiting'); return false; }
  // An unknown outcome keeps the turn and its reservation, marked (keep_unknown_start) so the worker never abandons it
  // and every later answer is read as unknown too: the next pass claims the same turn on the same profile and asks
  // again with the same idempotency key, pinned note and pinned tools, until the engine names the run.
  if(startOutcomeUnknown(run)||(!run&&retry)) { const {error:unkept}=await db.rpc('keep_unknown_start',{conversation:id,message_key:turn.send_key}); if(unkept) throw unkept; told('waiting'); return false; }
  // A definite refusal of this first attempt (or no usable profile before any attempt) fails the turn; the database
  // refuses it when another attempt was made meanwhile. A turn sent with a model is refused for it and failed in one
  // call (refuse_run_model with its attempt), so it never starts again on the model it goes back to.
  if(!run) {
   const {error:unfailed}=model
    ?await db.rpc('refuse_run_model',{conversation:id,message_key:turn.send_key,attempt})
    :await db.rpc('fail_conversation_turn',{conversation:id,message_key:turn.send_key,attempt});
   if(unfailed) throw unfailed; told(model?'modelRefused':'failed'); return false;
  }
  const {data:recorded,error:unrecorded}=await db.rpc('record_conversation_turn',{conversation:id,message_key:turn.send_key,run,started_on:turn.connection});
  if(unrecorded) throw unrecorded;
  if(recorded) await logRunStarted(db,id,turn);
  told(recorded?'started':'waiting');
  return !!recorded;
 } catch(failure) {
  console.error('Queued conversation turn not started:',id,failure?.message||'unknown error');
  // A gone image is permanent, so the turn ends with a line its sender sees and its reservation released; anything else
  // (a pinned read, a passing storage error) proves nothing and waits for the next pass.
  // A retried turn may already hold a run, so the database refuses to fail it: such a turn keeps waiting until the engine
  // names the run or the worker's day limit ends it. gtmworks's own cleanup never removes the images of a turn or Run that
  // may still need them (discard_conversation_files, #465), so only an image lost for outside reasons comes here.
  if(failure instanceof MessageFileGone&&turn) {
   try {
    const {error:unfailed}=await db.rpc('fail_conversation_turn',{conversation:id,message_key:turn.send_key,attempt:0});
    if(unfailed) throw unfailed;
    told('failed');
   } catch(unfailed) { console.error('Queued conversation turn not failed:',id,unfailed?.message||'unknown error'); }
  }
  return false;
 }
}

// From the send until the Engine started its Run (#762): one line, once the Run is recorded, from the time the turn was
// stored. A read that fails writes nothing.
/** @param {any} db @param {string} conversation @param {{company:string,send_key:string}} turn @param {(line:string)=>void} write */
async function logRunStarted(db,conversation,turn,write=console.log) {
 try {
  const {data}=await db.from('conversation_queued_turns').select('queued_at').eq('conversation_id',conversation).eq('send_key',turn.send_key).maybeSingle();
  const line=data?.queued_at&&waitLine({event:'run_started',company:turn.company,conversation,ms:Date.now()-Date.parse(data.queued_at)});
  if(line) write(line);
 } catch { /* A log line never holds a Run. */ }
}

// Stop: the database names the open run and allows only the person who started it or a Manager or Owner of the
// Company (conversation_stop_target); the run is then stopped through the engine contract on the Agent's profile.
// The run ends as stopped when it is next closed.
// #478: the same Stop ends every open Handover started from the chat, down the whole chain. The chat's own Run is stopped
// first, so it hands nothing on after the chain ended; then the database ends each open Handover as stopped
// (stop_conversation_handovers, on the same rule), so no answer or follow-up starts after it, and names the Runs they
// had going, each stopped on its own Agent's profile. A chain with no Run of the chat's own still stops.
/** @param {any} db @param {{company:string,conversation:string,hermes?:{address:string,key:string}|null|Promise<{address:string,key:string}|null>,engineFor?:typeof defaultEngine}} stop
 * @returns {Promise<{stopped:boolean}|{code:string|undefined,message?:string}|{error:'conversationNotFound',status:number}>} */
export async function stopConversationRun(db,{company,conversation,hermes=engineOf(company),engineFor=defaultEngine}) {
 const engine=await hermes;
 const {data,error}=await db.rpc('conversation_stop_target',{conversation,c:company});
 // Nothing of the chat's own open is no refusal: its chain may still be moving.
 const nothingOwn=error?.message==='conversationNothingToStop';
 if(error&&!nothingOwn) return {code:error.code,message:error.message};
 const target=nothingOwn?null:data?.[0];
 const connection=target?onProfile(target.profile,company,engine):null;
 // An Engine that cannot be reached now does not keep the chain going: the chat's own Run was kept as stopped, so the
 // worker stops it again on its next pass (stopped_runs_open).
 const own=connection?await engineFor(connection).stop(target.run).catch(()=>false):false;
 const {data:handed,error:unhanded}=await db.rpc('stop_conversation_handovers',{conversation,c:company});
 if(unhanded) return {code:unhanded.code,message:unhanded.message};
 const chain=/** @type {{run:string,profile:string|null}[]} */ (handed||[]);
 await stopOnProfiles(chain,company,engine,engineFor);
 if(chain.length||own) return {stopped:true};
 if(nothingOwn) return {code:error.code,message:error.message};
 return connection?{stopped:false}:{error:'conversationNotFound',status:404};
}

// The agent keeps working in Hermes whatever happens to the browser or to gtmworks: the worker (and a person reading
// their conversation) closes every run gtmworks left open from Hermes's own record. Closing is idempotent, so a
// restart, a second worker or a reader at the same moment never stores a reply or its usage twice (#245: every run it
// closes records the tokens Hermes reported, unknown when it reported none). `db` is a service-role client;
// a reader passes their conversation and themselves as its owner.
// Each run is read through the engine contract.
// `download` reads a file the reply hands over from the Agent's work folder (#708; tests pass their own).
/** @param {any} db @param {{hermes?:{address:string,key:string}|null,conversation?:string|null,owner?:string|null,engineFor?:typeof defaultEngine,download?:typeof downloadAgentFile}} options */
export async function closeOpenRuns(db,{hermes=null,conversation=null,owner=null,engineFor=defaultEngine,download=downloadAgentFile}) {
 const engines=new Map(); let closed=0;
 for await(const open of openRuns(db,{just:conversation,owner})) {
  // One run that cannot be closed (a database refusal) is logged and skipped, so it never stalls the others.
  try { if(await closeRun(db,open,engines,hermes,engineFor,download)) closed++; }
  catch(failure) { console.error('Conversation run not closed:',open.run,failure?.message||'unknown error'); }
 }
 return closed;
}
// Every open run the database lists, a page of 500 at a time.
/** @param {any} db @param {{just:string|null,owner:string|null}} filter */
async function* openRuns(db,{just,owner}) {
 for(let after=0;;) {
  const {data:runs,error}=await db.rpc('open_conversation_runs',{just,owner,after});
  if(error) throw error;
  yield* runs||[];
  if(!runs||runs.length<500) return;
  after=runs.at(-1).message;
 }
}

// One open run, on the Engine of the Company the database names for it (or the one the reader is given).
/** @param {any} db @param {any} open @param {Map<string,any>} engines @param {{address:string,key:string}|null} hermes @param {typeof defaultEngine} engineFor @param {typeof downloadAgentFile} download */
async function closeRun(db,open,engines,hermes,engineFor,download) {
 const key=`${open.company}:${open.profile}:${open.person}`;
 // Held: with no Hermes to reach, runs wait until there is one.
 if(!engines.has(key)) { const at=hermes??await engineOf(open.company); engines.set(key,!open.profile?{}:at?{profile:{...at,profile:open.profile}}:{held:true}); }
 const connection=engines.get(key);
 if(connection.held) return false;
 // A removed Agent can never answer: its run failed.
 const engine=connection.profile&&engineFor(connection.profile);
 const started=new Date().toISOString();
 const result=engine?await engine.read(open.run):{state:'failed',reply:null,session:null,usage:null,toolCalls:[]};
 const readEnded=new Date().toISOString();
 // One unreachable engine is not asked again in this pass, so it cannot hold up the other runs.
 if(result.state==='unreachable') { engines.set(key,{held:true}); return false; }
 // What the run asks its person (#138) is kept on every read, and every answer claimed for it is delivered before the
 // run may close: an answer the engine could not be asked for holds the run until it can. A question with no words to
 // show is answered at once with nothing, which the engine reads as unanswered.
 const question=result.question?askedOf(result.question):null;
 if(engine&&question&&!question.text) await engine.answer(open.run,question.id,'');
 const said=saidOf(result);
 const {data:claims,error:untracked}=await db.rpc('track_run_question',{conversation:open.conversation,run:open.run,asking:question?.text?withSaid(question,said):null,ended:result.state!=='running',read_started_at:started});
 if(untracked) throw untracked;
 for(const claim of claims||[]) {
  const delivered=engine?await engine.answer(open.run,claim.question,claim.answer):'gone';
  if(delivered==='unreachable') { engines.set(key,{held:true}); return false; }
  const {error:unsettled}=await db.rpc('settle_question',{card:claim.card,verdict:delivered==='answered'?'answered':'closed'});
  if(unsettled) throw unsettled;
 }
 // What the run waits on its person to allow (#163) is kept the same way, and every choice claimed for it is delivered
 // before the run may close. A request with no words to show is not allowed, at once. The profile the run was read on
 // is the one the Engine would keep an always in, so the database decides from it whether always is offered.
 const permission=result.permission?requestedOf(result.permission):null;
 if(engine&&permission&&!permission.description&&!permission.command) await engine.permit(open.run,permission.id,'deny');
 const {data:decisions,error:unkept}=await db.rpc('track_run_permission',{conversation:open.conversation,run:open.run,asking:permission&&(permission.description||permission.command)?withSaid(permission,said):null,ended:result.state!=='running',read_started_at:started,read_ended_at:readEnded,run_profile:connection.profile?.profile??null});
 if(unkept) throw unkept;
 for(const claim of decisions||[]) {
  const delivered=engine?await engine.permit(open.run,claim.permission,claim.choice):'gone';
  if(delivered==='unreachable') { engines.set(key,{held:true}); return false; }
  const {error:unsettled}=await db.rpc('settle_permission',{card:claim.card,verdict:delivered==='answered'?'decided':'closed'});
  if(unsettled) throw unsettled;
 }
 // A run that failed for a cause a retry cannot fix keeps that cause (no_model #422, no_credit, key_refused or
 // model_missing #457): the chat says what to fix instead of offering a send again.
 const outcome=endOf(result);
 if(!outcome) return false;
 // A Run the Company's Fallback model answered is logged in Activity once (#644), before the close that may end this pass.
 if(engine) await logFallbackMove(db,{company:open.company,run:open.run,result,engine});
 // A completed run's tool calls are carried out in order before the run is closed, also when the model wrote nothing
 // but the calls. A stop in between leaves the run open, and the next closer carries them out again, which makes nothing
 // twice (lead_create_agent). Only a close that read the run completed, every call carried out, says so
 // (read_completed); close_conversation_run (#227) then decides whether what the calls left is a whole reply. Token use
 // is Hermes's own (#347): the close keeps its usage arguments for the previous app version and sends none.
 if(result.state==='completed') for(const call of result.toolCalls) {
  const done=await runToolCall({db,engine,profile:connection.profile.profile,conversation:open.conversation,run:open.run},call);
  if(done.state==='engineUnreachable') { engines.set(key,{held:true}); return false; }
 }
 // Postgres cannot store a NUL character; dropping it keeps such a reply from failing forever. The files the reply hands
 // over (#708, ADR 0028) are read from the Agent's own work folder and kept in the Conversation's folder before the close,
 // which links them to the Agent's message; a closer that runs again writes the same bytes to the same paths.
 const words=outcome==='completed'?result.reply.replaceAll('\u0000',''):null;
 const kept=words===null?{reply:null,files:[],missed:[]}:await keepReplyFiles({connection:connection.profile,place:{company:open.company,folder:'conversations',scope:open.conversation},
  run:open.run,reply:words,download,upload:storageUpload(db)});
 // A Run whose every account ran out keeps when its usage resets, when the Engine named it (#642), in the same call.
 const {data:saved,error}=outcome==='no_access'&&result.resetsAt
  ?await db.rpc('close_conversation_run_out_of_usage',{conversation:open.conversation,run:open.run,hermes_session:result.session,read_completed:result.state==='completed',usage_resets_at:result.resetsAt})
  :await db.rpc('close_conversation_run',{conversation:open.conversation,run:open.run,run_outcome:outcome,reply:kept.reply,hermes_session:result.session,used_input:null,used_output:null,read_completed:result.state==='completed',
   reply_files:kept.files,missed_files:kept.missed.length?kept.missed:null});
 if(error) throw error;
 return !!saved;
}

// The Conversation's person answers the question its Agent's Run waits on (#138): a pick names the card and the
// choice's index, picks on a question where several may be picked the card and their indexes (#648), typed words have no card and mean the open question, if any. `db` is the person's own session, so the
// database checks it is their Conversation and they may write, and claims the answer once (answer_question); the claim
// is stored before the engine is called, and closing the Conversation's Runs then delivers it. If this request dies after
// the claim, the next closer (the worker, the page's next read) delivers it.
/** @param {any} db @param {any} service @param {{company:string,conversation:string,card:number|null,choice?:number|null,picks?:number[]|null,answer?:string|null,answerKey:string,hermes?:{address:string,key:string}|null,engineFor?:typeof defaultEngine}} claim
 * @returns {Promise<{state:'claimed'|'taken'|'closed'|'none'}|{code:string|undefined,message?:string}>} */
export async function answerQuestion(db,service,{company,conversation,card,choice=null,picks=null,answer=null,answerKey,hermes=engineOf(company),engineFor=defaultEngine}) {
 hermes=await hermes;
 const {data:state,error}=await db.rpc('answer_question',{c:company,conversation,card,choice,answer,answer_key:answerKey,...(picks?{picks}:{})});
 if(error) return {code:error.code,message:error.message};
 if(state==='claimed') {
  try { await closeOpenRuns(service,{hermes,conversation,engineFor}); }
  catch(failure) { console.error('Answer not delivered yet:',conversation,failure?.message||'unknown error'); }
 }
 return {state};
}

// The Conversation's person answers the request its Agent's Run waits on (#163) with one of its card's choices. `db` is
// their own session, so the database checks it is their Conversation, their role may send that choice and the engine
// offered it, and keeps the first press only (decide_permission). The press is answered as soon as the choice is kept:
// delivering it closes the Conversation's Runs, which waits on every one of them, so it runs in `later` (the route's
// after()), and if it dies there the next closer delivers it. Returns what the database kept, or its refusal code.
// Nothing the request says is ever logged.
/** @param {any} db @param {any} service @param {{company:string,conversation:string,card:number,choice:import('./engine.mjs').PermissionChoice,hermes?:{address:string,key:string}|null,engineFor?:typeof defaultEngine,later:(deliver:()=>Promise<void>)=>void}} press
 * @returns {Promise<{state:'decided'|'closed',choice:import('./engine.mjs').PermissionChoice|null,at:string|null,first:boolean}|{code:string|undefined}>} */
export async function decidePermission(db,service,{company,conversation,card,choice,hermes=engineOf(company),engineFor=defaultEngine,later}) {
 hermes=await hermes;
 const {data:pressed,error}=await db.rpc('decide_permission',{c:company,conversation,card,choice});
 if(error) return {code:error.code};
 if(pressed.first) later(async()=>{
  try { await closeOpenRuns(service,{hermes,conversation,engineFor}); }
  catch(failure) { console.error('Permission not delivered yet:',conversation,failure?.code||failure?.name||'unknown error'); }
 });
 return pressed;
}

// The question as the card keeps it (track_run_question, and a channel's track_channel_question): only the question's
// text is ever shortened, since it is never sent back; choices that cannot all be drawn (more than four, or one longer
// than 1000 characters) are left out, so the person answers in words.
/** @param {import('./engine.mjs').RunQuestion} question */
export const askedOf=question=>{
 const text=question.text.trim();
 const choices=question.choices.length<=4&&question.choices.every(choice=>choice.trim()&&choice.length<=1000)?question.choices:[];
 return {id:question.id,text:cut(text,4000),choices,multiple:question.multiple};
};

// The request as the card keeps it (track_run_permission): the engine's words trimmed, and only shortened past what the
// card holds, since they are never sent back. Postgres's jsonb takes no NUL and no half of a surrogate pair, so neither
// is kept: either would refuse every read of the Run.
/** @param {string} text */
const keptWords=text=>cut(text.replaceAll('\u0000','').toWellFormed().trim(),4000);
// What the Agent wrote in the message that paused its Run (#647) goes with the card that pause keeps, as its message
// above the card: kept as a reply is (200,000 characters, no NUL), once, on the card that first carries it.
/** @param {import('./engine.mjs').RunState} result */
export const saidOf=result=>typeof result.said==='string'?cut(result.said.replaceAll('\u0000','').toWellFormed().trim(),200000)||null:null;
/** @template {object} T @param {T} asking @param {string|null} said */
export const withSaid=(asking,said)=>said?{...asking,said}:asking;
/** @param {import('./engine.mjs').RunPermission} permission */
// What an always answer would keep (#166) goes with it, so the Company's record can say who allowed each standing entry.
export const requestedOf=permission=>({id:permission.id,description:keptWords(permission.description),command:keptWords(permission.command),choices:permission.choices,
 allows:(permission.allows??[]).filter(key=>!key.includes('\u0000')&&key.toWellFormed()===key)});
