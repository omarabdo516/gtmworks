import { engineFor as defaultEngine, outcomeOf, startOutcomeUnknown } from './engine.mjs';
import { isAgentProfile } from './agent-levels.mjs';
import { hermesAt, onProfile } from './bundled-hermes.mjs';
import { cut, toolSpecTexts, runToolCall } from './agent-tools.mjs';
import { leadInstructions } from './lead-offer.mjs';
import { filesAsImages } from './message-files.ts';

// The Agent a message calls (#153), read as a channel reads one (public.channel_mention): "@" and an Agent's name, in
// any case, after the start, a space or a punctuation mark and before the end, a space or a punctuation mark (Arabic
// ، ؛ ؟ count). `agents` are the ones the sender sees. Several: the earliest wins; at one place the longest name; the
// same name: the main Agent, then by id. None: null.
const edge=/[\s\p{P}\p{S}]/u;
/** @param {string} message @param {{id:string,name:string,is_default?:boolean}[]} agents @returns {string|null} */
export function mentionedAgent(message,agents) {
 const text=message.toLowerCase(); let best=null, bestAt=0, bestLength=0;
 const ordered=[...agents].sort((a,b)=>Number(!!b.is_default)-Number(!!a.is_default)||(a.id<b.id?-1:a.id>b.id?1:0));
 for(const agent of ordered) {
  const handle=`@${agent.name.trim().toLowerCase()}`; if(handle==='@') continue;
  for(let from=0;;) {
   const at=text.indexOf(handle,from); if(at<0) break;
   const end=at+handle.length;
   if((at===0||edge.test(text[at-1]))&&(end>=text.length||edge.test(text[end]))) {
    if(best===null||at<bestAt||(at===bestAt&&handle.length>bestLength)) { best=agent.id; bestAt=at; bestLength=handle.length; }
    break;
   }
   from=at+1;
  }
 }
 return best;
}

// A person's message in their conversation, sent through the engine contract (lib/engine.mjs). `db` is the person's
// own session, so the database checks they may write in the company (any Member but a Viewer, #287) and the
// conversation is theirs before the engine is called, and pins the profile of the bundled Hermes the run goes to (#342);
// `service` is a service-role client. `hermes` is the install's Hermes address and key, which only the engine's driver
// is given. The author of the message is always the signed-in person of `db`: nothing in `send` names who wrote it.
// The database decides what the message is (reserve_conversation_turn): addressed to a person (@<Member name>), it is
// kept as a note and no run starts; while the Agent is busy it waits as the sender's own next turn (startQueuedTurns
// starts it after the open run ends); otherwise its run starts now, with the Agent's own instructions and the sender's
// own note as the run's instructions and, when the database pinned them for it, the tools it may use (lib/agent-tools.mjs).
// While the Agent waits on a question (#138), the message is its answer instead: it goes to the waiting Run and starts
// none, and the same send key finds the same answer.
// A message may carry images (#155): `images` are their bytes in base64 with the file's own type, read by the route
// before this call, and they go into the Run as the Engine's own image parts. A turn that has to wait reads its files
// from the Conversation's record when the worker starts it, so the same send key always sends the same body.
// Returns the conversation (marked queued or addressed when no run started, answered when it answered the question), a
// database refusal code, or a refusal to show.
/** @param {any} db @param {any} service @param {{person?:string,company:string,conversation:string,sendKey:string,agent?:string,message:string,images?:{content_type:string,base64:string}[],hermes?:{address:string,key:string}|null,engineFor?:typeof defaultEngine}} send
 * @returns {Promise<{conversation:string,queued?:true,addressed?:true,answered?:true}|{code:string|undefined}|{error:'conversationNotFound'|'conversationHermesFailed'|'conversationAgentLevelPending'|'conversationSendAgain',status:number}>} */
export async function sendMessage(db,service,{company,conversation,sendKey,agent:chosen,message,images,hermes=hermesAt(),engineFor=defaultEngine}) {
 // Checked before the engine is called: an id that is someone else's never reaches their engine session.
 const {data:stored,error:refused}=await db.rpc('conversation_agent',{conversation,c:company});
 if(refused) return {code:refused.code};
 // A repeated send (double click, retry) that is already stored is answered without calling the engine again.
 if(stored) { const {data:sent}=await db.from('conversation_messages').select('id').eq('conversation_id',conversation).eq('send_key',sendKey).maybeSingle(); if(sent) return {conversation}; }
 // Only a Conversation already there can wait on a question. One whose answer is already on its way (sent from another
 // tab) takes this message as its next turn, as any message while the Agent works.
 if(stored) {
  const typed=await answerQuestion(db,service,{company,conversation,card:null,answer:message,answerKey:sendKey,hermes,engineFor});
  if('code' in typed) return {code:typed.code};
  if(typed.state==='claimed') return {conversation,answered:true};
 }
 let agent=stored||chosen;
 // A new chat's first message that calls an Agent the sender sees goes to that Agent, not to the one whose empty chat
 // was open (#153; design-reference: send, mentionedAgent). The sender's own session lists only the Agents they see.
 if(!stored&&chosen) agent=mentionedAgent(message,(await db.from('hermes_agents').select('id,name,is_default').eq('company_id',company)).data||[])||chosen;
 if(!agent) agent=(await db.from('hermes_agents').select('id').eq('company_id',company).eq('is_default',true).maybeSingle()).data?.id;
 const {data:inCompany}=agent?await db.from('hermes_agents').select('id,instructions').eq('id',agent).eq('company_id',company).maybeSingle():{data:null};
 if(!inCompany) return {error:'conversationNotFound',status:404};
 // The run is reserved before the engine is called (ADR 0014): the database pins the agent's profile under the lock
 // a move to the company's own profile takes, so no move passes between this and the record, and it refuses while the
 // company profile's tools are not yet those of the company's level. A reservation whose record below never happens is
 // abandoned by the worker after ten minutes, without calling the engine (lib/company-profiles.mjs).
 const {data:turn,error:unreserved}=await db.rpc('reserve_conversation_turn',{conversation,c:company,agent:inCompany.id,message_key:sendKey,message});
 if(unreserved) return unreserved.message==='agentLevelPending'?{error:'conversationAgentLevelPending',status:409}:unreserved.message==='hermesProfileNotShared'?{error:'conversationNotFound',status:404}:{code:unreserved.code};
 if(turn?.state==='note') return {conversation,addressed:true};
 if(turn?.state==='queued') return {conversation,queued:true};
 if(turn?.state==='answered') return {conversation,answered:true};
 if(turn?.state!=='reserved') return {error:'conversationHermesFailed',status:502};
 const pinned=turn.connection;
 // No run starts on a profile that cannot be used, or when the engine refuses the start: the sender's own
 // reservation is abandoned at once (release_conversation_run), so it holds no move for ten minutes. A retry with the same send key reserves again and passes every check anew.
 // A release names the attempt it follows (0: none was made by this request); the database refuses it when another
 // attempt of the same key was made meanwhile, or the start was marked unknown, since that start may hold a run.
 const release=attempt=>db.rpc('release_conversation_run',{conversation,c:company,message_key:sendKey,attempt});
 const connection=pinned&&onProfile(turn.profile,company,hermes);
 if(!connection) { await release(0); return {error:'conversationNotFound',status:404}; }
 const {tools}=await pinnedRun(service,conversation,sendKey);
 const history=await pinnedHistory(service,conversation,sendKey);
 const model=await pinnedModel(service,conversation,sendKey);
 const lead=await pinnedLeadInstructions(service,conversation,sendKey);
 // The same send key is the same run (the contract's idempotency key), so a retry after a failed save never runs twice.
 // The run's note is the one pinned at its first reservation, and its tools the ones pinned at its first start, so a
 // retry sends exactly the same request.
 // The attempt is recorded first: if this process stops before the answer is stored, the worker keeps the start as
 // unknown instead of abandoning it (abandon_conversation_reservations).
 // It answers which attempt of the key this is: any later one (after a stop, or the person's resend) is a retry, which
 // no answer but a run id settles.
 const {data:attempt,error:unbegun}=await service.rpc('begin_start',{conversation,message_key:sendKey});
 if(unbegun) return {code:unbegun.code};
 if(!attempt) return {error:'conversationSendAgain',status:409};
 const retry=attempt>1;
 const run=await engineFor(connection).start({...runInput(conversation,sendKey,message,{agentInstructions:agentInstructionsFor(connection,inCompany.instructions),lead,note:turn.note,tools,history,model,images}),retry});
 // The engine may have started it and its answer was lost: the reservation is kept (it holds the profile) and becomes
 // its sender's waiting turn (keep_unknown_start), so the worker asks again with the same key and body until the engine
 // says which, whether or not the person ever sends again; their retry with the same key finds it waiting.
 if(startOutcomeUnknown(run)||(!run&&retry)) {
  const {data:kept,error:unkept}=await service.rpc('keep_unknown_start',{conversation,message_key:sendKey});
  if(unkept) return {code:unkept.code};
  if(kept) return {conversation,queued:true};
  // Its reservation is gone: another attempt's record stored the message meanwhile, or nothing can follow the run.
  const {data:stored}=await db.from('conversation_messages').select('id').eq('conversation_id',conversation).eq('send_key',sendKey).maybeSingle();
  return stored?{conversation}:{error:'conversationSendAgain',status:409};
 }
 // A Run refused while it carried the Conversation's chosen model (#158) puts the Conversation back on its earlier model,
 // in the same call that releases this attempt, so a late refusal once a newer attempt began changes nothing (#330).
 if(!run) {
  if(!model) { await release(attempt); return {error:'conversationHermesFailed',status:502}; }
  const {data:refused}=await db.rpc('refuse_conversation_run_model',{conversation,c:company,message_key:sendKey,attempt});
  return {error:refused===true?'conversationModelRefused':'conversationHermesFailed',status:502};
 }
 const {error}=await db.rpc('send_conversation_message',{conversation,c:company,agent:inCompany.id,message,message_key:sendKey,run,started_on:pinned});
 // The worker abandoned the reservation meanwhile (or the agent moved): the run cannot be followed, so it is sent again.
 if(error?.message==='conversationSendAgain') return {error:'conversationSendAgain',status:409};
 return error?{code:error.code}:{conversation};
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
// none: the database answers null, so every Run asks for it, and the service role needs no hermes_agents.is_default.
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
/** @param {any} service @param {string} conversation @param {string} sendKey @returns {Promise<{tools:import('./engine.mjs').ToolSpec[]|undefined}>} */
async function pinnedRun(service,conversation,sendKey) {
 const {data,error}=await service.rpc('pin_run',{conversation,message_key:sendKey,specs:toolSpecTexts()});
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
/** @param {any} db @param {{hermes?:{address:string,key:string}|null,conversation?:string|null,engineFor?:typeof defaultEngine}} options */
export async function startQueuedTurns(db,{hermes=hermesAt(),conversation=null,engineFor=defaultEngine}) {
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
 const lane=async()=>{ while(next<waiting.length) if(await startQueuedTurn(db,waiting[next++].conversation,{hermes,engineFor})) started++; };
 await Promise.all(Array.from({length:startsAtOnce},lane));
 return started;
}

// One Conversation's waiting turn, if the database claims it and the Engine starts it: recorded and true, or nothing and
// false. Every failure is logged and holds up no other Conversation.
/** @param {any} db @param {string} id @param {{hermes:{address:string,key:string}|null,engineFor:typeof defaultEngine}} options */
async function startQueuedTurn(db,id,{hermes,engineFor}) {
 try {
  const {data:claimed,error:unclaimed}=await db.rpc('claim_conversation_turn',{conversation:id});
  if(unclaimed) throw unclaimed;
  const turn=claimed?.[0]; if(!turn) return false;
  // A turn already attempted (its start marked unknown, or begun by a stopped worker or another claimer) is a retry.
  let retry=turn.retry===true;
  const connection=onProfile(turn.profile,turn.company,hermes);
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
   const {data:begun,error:unbegun}=await db.rpc('begin_start',{conversation:id,message_key:turn.send_key}); if(unbegun) throw unbegun; if(!begun) return false; attempt=begun; retry=retry||attempt>1;
  }
  const run=connection&&await engineFor(connection).start({...runInput(id,turn.send_key,turn.message,{agentInstructions,lead,note:turn.note,tools,history,model,images}),retry});
  // An unknown outcome keeps the turn and its reservation, marked (keep_unknown_start) so the worker never abandons it
  // and every later answer is read as unknown too: the next pass claims the same turn on the same profile and asks
  // again with the same idempotency key, pinned note and pinned tools, until the engine names the run.
  if(startOutcomeUnknown(run)||(!run&&retry)) { const {error:unkept}=await db.rpc('keep_unknown_start',{conversation:id,message_key:turn.send_key}); if(unkept) throw unkept; return false; }
  // A definite refusal of this first attempt (or no usable profile before any attempt) fails the turn; the database
  // refuses it when another attempt was made meanwhile. A turn sent with a model is refused for it and failed in one
  // call (refuse_run_model with its attempt), so it never starts again on the model it goes back to.
  if(!run) {
   const {error:unfailed}=model
    ?await db.rpc('refuse_run_model',{conversation:id,message_key:turn.send_key,attempt})
    :await db.rpc('fail_conversation_turn',{conversation:id,message_key:turn.send_key,attempt});
   if(unfailed) throw unfailed; return false;
  }
  const {data:recorded,error:unrecorded}=await db.rpc('record_conversation_turn',{conversation:id,message_key:turn.send_key,run,started_on:turn.connection});
  if(unrecorded) throw unrecorded;
  return !!recorded;
 } catch(failure) { console.error('Queued conversation turn not started:',id,failure?.message||'unknown error'); return false; }
}

// Stop: the database names the open run and allows only the person who started it or a Manager or Owner of the
// Company (conversation_stop_target); the run is then stopped through the engine contract on the Agent's profile.
// The run ends as stopped when it is next closed.
/** @param {any} db @param {{company:string,conversation:string,hermes?:{address:string,key:string}|null,engineFor?:typeof defaultEngine}} stop
 * @returns {Promise<{stopped:boolean}|{code:string|undefined,message?:string}|{error:'conversationNotFound',status:number}>} */
export async function stopConversationRun(db,{company,conversation,hermes=hermesAt(),engineFor=defaultEngine}) {
 const {data,error}=await db.rpc('conversation_stop_target',{conversation,c:company});
 if(error) return {code:error.code,message:error.message};
 const target=data?.[0];
 const connection=onProfile(target?.profile,company,hermes);
 if(!connection) return {error:'conversationNotFound',status:404};
 return {stopped:await engineFor(connection).stop(target.run)};
}

// The agent keeps working in Hermes whatever happens to the browser or to gtmworks: the worker (and a person reading
// their conversation) closes every run gtmworks left open from Hermes's own record. Closing is idempotent, so a
// restart, a second worker or a reader at the same moment never stores a reply or its usage twice (#245: every run it
// closes records the tokens Hermes reported, unknown when it reported none). `db` is a service-role client;
// a reader passes their conversation and themselves as its owner.
// Each run is read through the engine contract.
/** @param {any} db @param {{hermes?:{address:string,key:string}|null,conversation?:string|null,owner?:string|null,engineFor?:typeof defaultEngine}} options */
export async function closeOpenRuns(db,{hermes=hermesAt(),conversation=null,owner=null,engineFor=defaultEngine}) {
 const engines=new Map(); let closed=0;
 for await(const open of openRuns(db,{just:conversation,owner})) {
  // One run that cannot be closed (a database refusal) is logged and skipped, so it never stalls the others.
  try { if(await closeRun(db,open,engines,hermes,engineFor)) closed++; }
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

async function closeRun(db,open,engines,hermes,engineFor) {
 const key=`${open.profile}:${open.person}`;
 // Held: with no Hermes to reach, runs wait until there is one.
 if(!engines.has(key)) engines.set(key,!open.profile?{}:hermes?{profile:{...hermes,profile:open.profile}}:{held:true});
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
 const {data:claims,error:untracked}=await db.rpc('track_run_question',{conversation:open.conversation,run:open.run,asking:question?.text?question:null,ended:result.state!=='running',read_started_at:started});
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
 const {data:decisions,error:unkept}=await db.rpc('track_run_permission',{conversation:open.conversation,run:open.run,asking:permission&&(permission.description||permission.command)?permission:null,ended:result.state!=='running',read_started_at:started,read_ended_at:readEnded,run_profile:connection.profile?.profile??null});
 if(unkept) throw unkept;
 for(const claim of decisions||[]) {
  const delivered=engine?await engine.permit(open.run,claim.permission,claim.choice):'gone';
  if(delivered==='unreachable') { engines.set(key,{held:true}); return false; }
  const {error:unsettled}=await db.rpc('settle_permission',{card:claim.card,verdict:delivered==='answered'?'decided':'closed'});
  if(unsettled) throw unsettled;
 }
 const outcome=outcomeOf(result);
 if(!outcome) return false;
 // A completed run's tool calls are carried out in order before the run is closed, also when the model wrote nothing
 // but the calls. A stop in between leaves the run open, and the next closer carries them out again, which makes nothing
 // twice (lead_create_agent). Only a close that read the run completed, every call carried out, says so
 // (read_completed); close_conversation_run (#227) then decides whether what the calls left is a whole reply. Token use
 // is Hermes's own (#347): the close keeps its usage arguments for the previous app version and sends none.
 if(result.state==='completed') for(const call of result.toolCalls) {
  const done=await runToolCall({db,engine,profile:connection.profile.profile,conversation:open.conversation,run:open.run},call);
  if(done.state==='engineUnreachable') { engines.set(key,{held:true}); return false; }
 }
 // Postgres cannot store a NUL character; dropping it keeps such a reply from failing forever.
 const reply=outcome==='completed'?result.reply.replaceAll('\u0000',''):null;
 const {data:saved,error}=await db.rpc('close_conversation_run',{conversation:open.conversation,run:open.run,run_outcome:outcome,reply,hermes_session:result.session,used_input:null,used_output:null,read_completed:result.state==='completed'});
 if(error) throw error;
 return !!saved;
}

// The Conversation's person answers the question its Agent's Run waits on (#138): a pick names the card and the
// choice's index, typed words have no card and mean the open question, if any. `db` is the person's own session, so the
// database checks it is their Conversation and they may write, and claims the answer once (answer_question); the claim
// is stored before the engine is called, and closing the Conversation's Runs then delivers it. If this request dies after
// the claim, the next closer (the worker, the page's next read) delivers it.
/** @param {any} db @param {any} service @param {{company:string,conversation:string,card:number|null,choice?:number|null,answer?:string|null,answerKey:string,hermes?:{address:string,key:string}|null,engineFor?:typeof defaultEngine}} claim
 * @returns {Promise<{state:'claimed'|'taken'|'closed'|'none'}|{code:string|undefined,message?:string}>} */
export async function answerQuestion(db,service,{company,conversation,card,choice=null,answer=null,answerKey,hermes=hermesAt(),engineFor=defaultEngine}) {
 const {data:state,error}=await db.rpc('answer_question',{c:company,conversation,card,choice,answer,answer_key:answerKey});
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
export async function decidePermission(db,service,{company,conversation,card,choice,hermes=hermesAt(),engineFor=defaultEngine,later}) {
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
/** @param {import('./engine.mjs').RunPermission} permission */
export const requestedOf=permission=>({id:permission.id,description:keptWords(permission.description),command:keptWords(permission.command),choices:permission.choices});
