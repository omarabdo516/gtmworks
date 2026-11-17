import { decryptSecret } from './agent-crypto.mjs';
import { engineFor as defaultEngine, outcomeOf, startOutcomeUnknown } from './engine.mjs';
import { companyProfile, isAgentProfile } from './agent-levels.mjs';
import { cut, toolSpecTexts, runToolCall } from './agent-tools.mjs';
import { knowledgeInstructions } from './company-knowledge.mjs';
import { followRun, sealRunSteps } from './run-steps.mjs';

// A person's message in their conversation, sent through the engine contract (lib/engine.mjs). `db` is the person's
// own session, so the database checks they may write in the company (any Member but a Viewer, #287) and the
// conversation is theirs before the engine is called; `service` is a service-role client that only reads the agent's
// Connection, through that agent in that company (ADR 0008), and the key is only ever given to the engine's driver. An
// untested or refusing engine is never called (ADR 0008 fails closed); a new run also needs the run_submission
// capability. The author of the message is always the signed-in person of `db`: nothing in `send` names who wrote it.
// The database decides what the message is (reserve_conversation_turn): addressed to a person (@<Member name>), it is
// kept as a note and no run starts; while the Agent is busy it waits as the sender's own next turn (startQueuedTurns
// starts it after the open run ends); otherwise its run starts now, with the Agent's own instructions and the sender's
// own note as the run's instructions and, when the database pinned them for it, the tools it may use (lib/agent-tools.mjs).
// While the Agent waits on a question (#138), the message is its answer instead: it goes to the waiting Run and starts
// none, and the same send key finds the same answer.
// Returns the conversation (marked queued or addressed when no run started, answered when it answered the question), a
// database refusal code, or a refusal to show.
/** @param {any} db @param {any} service @param {{person?:string,company:string,conversation:string,sendKey:string,agent?:string,message:string,encryptionKey:string|undefined,engineFor?:typeof defaultEngine}} send
 * @returns {Promise<{conversation:string,queued?:true,addressed?:true,answered?:true}|{code:string|undefined}|{error:'conversationNotFound'|'conversationHermesFailed'|'conversationAgentLevelPending'|'conversationSendAgain',status:number}>} */
export async function sendMessage(db,service,{company,conversation,sendKey,agent:chosen,message,encryptionKey,engineFor=defaultEngine}) {
 // Checked before the engine is called: an id that is someone else's never reaches their engine session.
 const {data:stored,error:refused}=await db.rpc('conversation_agent',{conversation,c:company});
 if(refused) return {code:refused.code};
 // A repeated send (double click, retry) that is already stored is answered without calling the engine again.
 if(stored) { const {data:sent}=await db.from('conversation_messages').select('id').eq('conversation_id',conversation).eq('send_key',sendKey).maybeSingle(); if(sent) return {conversation}; }
 // Only a Conversation already there can wait on a question. One whose answer is already on its way (sent from another
 // tab) takes this message as its next turn, as any message while the Agent works.
 if(stored) {
  const typed=await answerQuestion(db,service,{company,conversation,card:null,answer:message,answerKey:sendKey,encryptionKey,engineFor});
  if('code' in typed) return {code:typed.code};
  if(typed.state==='claimed') return {conversation,answered:true};
 }
 let agent=stored||chosen;
 if(!agent) agent=(await db.from('hermes_agents').select('id').eq('company_id',company).eq('is_default',true).maybeSingle()).data?.id;
 const {data:inCompany}=agent?await db.from('hermes_agents').select('id,instructions').eq('id',agent).eq('company_id',company).maybeSingle():{data:null};
 if(!inCompany) return {error:'conversationNotFound',status:404};
 // The run is reserved before the engine is called (ADR 0014): the database pins the agent's Connection under the lock
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
 // No run starts on a Connection that cannot be used, or when the engine refuses the start: the sender's own
 // reservation is abandoned at once (release_conversation_run), so it holds neither a move nor its Connection's removal
 // for ten minutes. A retry with the same send key reserves again and passes every check anew.
 // A release names the attempt it follows (0: none was made by this request); the database refuses it when another
 // attempt of the same key was made meanwhile, or the start was marked unknown, since that start may hold a run.
 const release=attempt=>db.rpc('release_conversation_run',{conversation,c:company,message_key:sendKey,attempt});
 const connection=pinned&&await sendingConnection(service,company,pinned,encryptionKey);
 if(!connection) { await release(0); return {error:'conversationNotFound',status:404}; }
 const {tools,rules}=await pinnedRun(service,conversation,sendKey);
 const knowledge=await pinnedKnowledge(service,conversation,sendKey);
 const history=await pinnedHistory(service,conversation,sendKey);
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
 const run=await engineFor(connection).start({...runInput(conversation,sendKey,message,{agentInstructions:agentInstructionsFor(connection,inCompany.instructions),knowledge,rules,note:turn.note,tools,history}),retry});
 // The engine may have started it and its answer was lost: the reservation is kept (it holds the Connection) and becomes
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
 if(!run) { await release(attempt); return {error:'conversationHermesFailed',status:502}; }
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
// never change once the Agent is made, so a retry still sends the same request. The Company knowledge (#27) follows,
// then the lasting rules the team told the Agent (#18), then the sender's own note.
// An Agent on its own profile has its instructions as that profile's soul (ADR 0016), so its Runs carry none of them.
// This is read from the Connection the Run was pinned to, which a held reservation keeps, so every retry of a start
// sends the same body.
/** @param {{profile:string}} connection @param {string|null|undefined} instructions */
export const agentInstructionsFor=(connection,instructions)=>isAgentProfile(connection.profile)?null:instructions;
/** @param {string[]} rules */
export const rulesInstructions=rules=>rules.length?`The team told you the lasting rules below for your work in this company. Follow every one of them, in every reply, until the team removes it.\n\n${rules.map(rule=>`- ${rule}`).join('\n')}`:undefined;
/** @param {string} conversation @param {string} sendKey @param {string} message @param {{agentInstructions:string|null|undefined,knowledge:unknown,rules:string[],note:string|null|undefined,tools:import('./engine.mjs').ToolSpec[]|undefined,history:import('./engine.mjs').HistoryEntry[]|undefined}} parts */
const runInput=(conversation,sendKey,message,{agentInstructions,knowledge,rules,note,tools,history})=>{ const instructions=[agentInstructions,knowledgeInstructions(knowledge),rulesInstructions(rules),noteInstructions(note)].filter(Boolean).join('\n\n'); return {conversation,input:message,idempotencyKey:`${conversation}:${sendKey}`,...(instructions?{instructions}:{}),...(tools?{tools}:{}),...(history?{history}:{})}; };
// A run's tools and rules are pinned at its first start (pin_run): the tools its sender may then use with this Agent
// (create_agent, save_rule or suggest_rule), as the text sent, and the rules in force for its sender: the team's and
// their own suggestions (#25). Every retry sends those, whatever a later
// version offers, and a run the previous app version already tried to start keeps what that version sent (#14's tools,
// no rules).
/** @param {any} service @param {string} conversation @param {string} sendKey @returns {Promise<{tools:import('./engine.mjs').ToolSpec[]|undefined,rules:string[]}>} */
async function pinnedRun(service,conversation,sendKey) {
 const {data,error}=await service.rpc('pin_run',{conversation,message_key:sendKey,specs:toolSpecTexts()});
 if(error) throw error;
 return {tools:typeof data?.tools==='string'?JSON.parse(data.tools):undefined,rules:Array.isArray(data?.rules)?data.rules:[]};
}

// A run's Company knowledge is pinned at its first start too (pin_run_knowledge), as the parts' text then, so every retry
// sends it unchanged and the next run the latest text. A run the previous app version already tried to start is told
// none, as it was.
/** @param {any} service @param {string} conversation @param {string} sendKey */
async function pinnedKnowledge(service,conversation,sendKey) {
 const {data,error}=await service.rpc('pin_run_knowledge',{conversation,message_key:sendKey});
 if(error) throw error;
 return data;
}

// Every Run of a Conversation that began before its Agent moved to its own profile (#121) carries the Conversation's
// record as its history (pin_run_history), pinned so a retry sends the same; every other Run carries none.
/** @param {any} service @param {string} conversation @param {string} sendKey @returns {Promise<import('./engine.mjs').HistoryEntry[]|undefined>} */
async function pinnedHistory(service,conversation,sendKey) {
 const {data,error}=await service.rpc('pin_run_history',{conversation,message_key:sendKey});
 if(error) throw error;
 return Array.isArray(data)&&data.length?data:undefined;
}

// Turns that waited while the Agent was busy start one at a time, oldest first, once a Conversation's open run has
// ended: the worker runs this after closing runs, and a person reading their conversation runs it for that one. The
// database claims a turn only while nothing runs there and records it as its own sender's message (the queue kept who
// sent it), with the Agent's own instructions and that sender's note as the run's instructions. Only a turn the engine
// definitely did not start is marked failed, so the next one can go and its sender sees it was not sent; one whose
// start may have happened is asked again on a later pass. `db` is a service-role client.
/** @param {any} db @param {{encryptionKey:string|undefined,conversation?:string|null,engineFor?:typeof defaultEngine}} options */
export async function startQueuedTurns(db,{encryptionKey,conversation=null,engineFor=defaultEngine}) {
 const {data:waiting,error}=await db.rpc('queued_conversations',{just:conversation});
 if(error) throw error;
 let started=0;
 for(const {conversation:id} of waiting||[]) {
  try {
   const {data:claimed,error:unclaimed}=await db.rpc('claim_conversation_turn',{conversation:id});
   if(unclaimed) throw unclaimed;
   const turn=claimed?.[0]; if(!turn) continue;
   // A turn already attempted (its start marked unknown, or begun by a stopped worker or another claimer) is a retry.
   let retry=turn.retry===true;
   const connection=await sendingConnection(db,turn.company,turn.connection,encryptionKey);
   // A retry waits for its own Connection: it may hold the run, so it is never failed here.
   if(!connection&&retry) continue;
   let attempt=0; let tools; let rules=/** @type {string[]} */([]); let knowledge; let history; let agentInstructions=null;
   if(connection) {
    ({tools,rules}=await pinnedRun(db,id,turn.send_key));
    knowledge=await pinnedKnowledge(db,id,turn.send_key);
    history=await pinnedHistory(db,id,turn.send_key);
    const {data:agent,error:unread}=await db.from('hermes_agents').select('instructions').eq('id',turn.agent).eq('company_id',turn.company).maybeSingle(); if(unread) throw unread; agentInstructions=agentInstructionsFor(connection,agent?.instructions);
    const {data:begun,error:unbegun}=await db.rpc('begin_start',{conversation:id,message_key:turn.send_key}); if(unbegun) throw unbegun; if(!begun) continue; attempt=begun; retry=retry||attempt>1;
   }
   const run=connection&&await engineFor(connection).start({...runInput(id,turn.send_key,turn.message,{agentInstructions,knowledge,rules,note:turn.note,tools,history}),retry});
   // An unknown outcome keeps the turn and its reservation, marked (keep_unknown_start) so the worker never abandons it
   // and every later answer is read as unknown too: the next pass claims the same turn on the same Connection and asks
   // again with the same idempotency key, pinned note and pinned tools, until the engine names the run.
   if(startOutcomeUnknown(run)||(!run&&retry)) { const {error:unkept}=await db.rpc('keep_unknown_start',{conversation:id,message_key:turn.send_key}); if(unkept) throw unkept; continue; }
   // A definite refusal of this first attempt (or no usable Connection before any attempt) fails the turn; the database
   // refuses it when another attempt was made meanwhile.
   if(!run) { const {error:unfailed}=await db.rpc('fail_conversation_turn',{conversation:id,message_key:turn.send_key,attempt}); if(unfailed) throw unfailed; continue; }
   const {data:recorded,error:unrecorded}=await db.rpc('record_conversation_turn',{conversation:id,message_key:turn.send_key,run,started_on:turn.connection});
   if(unrecorded) throw unrecorded;
   if(recorded) started++;
  } catch(failure) { console.error('Queued conversation turn not started:',id,failure?.message||'unknown error'); }
 }
 return started;
}

// Stop: the database names the open run and allows only the person who started it or a Manager or Owner of the
// Company (conversation_stop_target); the run is then stopped through the engine contract with the Agent's
// Connection, whose key only the service role reads. The run ends as stopped when it is next closed.
/** @param {any} db @param {any} service @param {{company:string,conversation:string,encryptionKey:string|undefined,engineFor?:typeof defaultEngine}} stop
 * @returns {Promise<{stopped:boolean}|{code:string|undefined,message?:string}|{error:'conversationNotFound',status:number}>} */
export async function stopConversationRun(db,service,{company,conversation,encryptionKey,engineFor=defaultEngine}) {
 const {data,error}=await db.rpc('conversation_stop_target',{conversation,c:company});
 if(error) return {code:error.code,message:error.message};
 const target=data?.[0];
 if(!target?.connection) return {error:'conversationNotFound',status:404};
 const {data:linked}=await service.from('hermes_connections').select('address,profile,state,key_encrypted').eq('id',target.connection).maybeSingle();
 if(!linked||!['connected','unreachable'].includes(linked.state)) return {error:'conversationNotFound',status:404};
 let key; try { key=decryptSecret(linked.key_encrypted,encryptionKey); } catch { return {error:'conversationNotFound',status:404}; }
 return {stopped:await engineFor({address:linked.address,profile:linked.profile,key}).stop(target.run)};
}

// The Connection is the one the database pinned for this run, through the agent in the company it accepted the sender
// in (a Member cannot read Connections, #287); the service role reads it by that id. The agent's company is the
// authority, not the Connection's: an Owner of two companies may attach a pasted Connection made in one to an agent in
// the other (ADR 0008). A company's own profile in the bundled Engine is never one of them (ADR 0014), nor an Agent's
// own (ADR 0016), whose Connection the database keeps in that Agent's Company.
/** @param {any} service @param {string} company @param {string} pinned @param {string|undefined} encryptionKey */
export async function sendingConnection(service,company,pinned,encryptionKey) {
 const {data:connection}=await service.from('hermes_connections').select('company_id,address,profile,state,features,key_encrypted').eq('id',pinned).maybeSingle();
 if(!connection||connection.state!=='connected'||!connection.features?.includes('run_submission')) return null;
 if(/^co-[0-9a-f]{32}$/.test(connection.profile)&&connection.profile!==companyProfile(company)) return null;
 if(isAgentProfile(connection.profile)&&connection.company_id!==company) return null;
 try { return {address:connection.address,profile:connection.profile,key:decryptSecret(connection.key_encrypted,encryptionKey)}; } catch { return null; }
}

// The agent keeps working in Hermes whatever happens to the browser or to gtmworks: the worker (and a person reading
// their conversation) closes every run gtmworks left open from Hermes's own record. Closing is idempotent, so a
// restart, a second worker or a reader at the same moment never stores a reply or its usage twice (#245: every run it
// closes records the tokens Hermes reported, unknown when it reported none). `db` is a service-role client;
// a reader passes their conversation and themselves as its owner.
// Each run is read through the engine contract.
/** @param {any} db @param {{encryptionKey:string|undefined,conversation?:string|null,owner?:string|null,engineFor?:typeof defaultEngine}} options */
export async function closeOpenRuns(db,{encryptionKey,conversation=null,owner=null,engineFor=defaultEngine}) {
 const engines=new Map(); let closed=0;
 for await(const open of openRuns(db,{just:conversation,owner})) {
  // One run that cannot be closed (a database refusal) is logged and skipped, so it never stalls the others.
  try { if(await closeRun(db,open,engines,encryptionKey,engineFor)) closed++; }
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

// The worker follows every open run's events (#141; lib/run-steps.mjs), one follower per run in `following`, on the
// run's own Connection as the closer reads it, when that Connection offers the events (run_events_sse). Following is
// reading one stream for as long as the run works: a follower whose stream broke off is started again on a later pass
// and reads on from the last number kept, one that could not read the engine (refused, an error answer, no answer) or
// failed waits `rest` milliseconds first (`resting`), and one that read the run's end, or found the engine keeps none
// of its events, stays until the run is closed, when it is dropped. `db` is a service-role client. Returns the
// followers it started, which the worker does not wait for.
/** @param {any} db @param {{encryptionKey:string|undefined,following:Map<string,AbortController>,resting?:Map<string,number>,rest?:number,engineFor?:typeof defaultEngine}} options @returns {Promise<Promise<void>[]>} */
export async function followOpenRuns(db,{encryptionKey,following,resting=new Map(),rest=60000,engineFor=defaultEngine}) {
 const open=new Map();
 for await(const run of openRuns(db,{just:null,owner:null})) open.set(`${run.conversation}:${run.run}`,run);
 for(const [key,follower] of following) if(!open.has(key)) { follower.abort(); following.delete(key); }
 for(const [key,until] of resting) if(!open.has(key)||until<=Date.now()) resting.delete(key);
 const engines=new Map(); const started=[];
 for(const [key,run] of open) {
  if(following.has(key)||resting.has(key)) continue;
  const reach=`${run.connection}:${run.person}`;
  if(!engines.has(reach)) engines.set(reach,await connectionOf(db,run,encryptionKey).catch(()=>({held:true})));
  const connection=engines.get(reach);
  if(connection.held||!connection.profile||!connection.features?.includes('run_events_sse')) continue;
  const follower=new AbortController(); following.set(key,follower);
  started.push(followRun(db,engineFor(connection.profile),run,follower.signal)
   .catch(failure=>{ console.error('Run steps not followed:',run.run,failure?.message||'unknown error'); return 'unreachable'; })
   .then(end=>{
    if(following.get(key)!==follower||end==='ended'||end==='gone') return;
    following.delete(key);
    if(end==='unreachable') resting.set(key,Date.now()+rest);
   }));
 }
 return started;
}

async function closeRun(db,open,engines,encryptionKey,engineFor) {
 const key=`${open.connection}:${open.person}`;
 if(!engines.has(key)) engines.set(key,await connectionOf(db,open,encryptionKey).catch(()=>({held:true})));
 const connection=engines.get(key);
 // Held: a refused or untested Hermes is never called (ADR 0008), and its runs wait until the Connection is fixed.
 if(connection.held) return false;
 // A detached agent or a deleted Connection can never answer: its run failed.
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
 // before the run may close. A request with no words to show is not allowed, at once.
 const permission=result.permission?requestedOf(result.permission):null;
 if(engine&&permission&&!permission.description&&!permission.command) await engine.permit(open.run,permission.id,'deny');
 const {data:decisions,error:unkept}=await db.rpc('track_run_permission',{conversation:open.conversation,run:open.run,asking:permission&&(permission.description||permission.command)?permission:null,ended:result.state!=='running',read_started_at:started,read_ended_at:readEnded});
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
 // (read_completed); close_conversation_run (#227) then decides whether what the calls left is a whole reply.
 if(result.state==='completed') for(const call of result.toolCalls) {
  const done=await runToolCall({db,engine,profile:connection.profile.profile,conversation:open.conversation,run:open.run},call);
  if(done.state==='engineUnreachable') { engines.set(key,{held:true}); return false; }
 }
 // A completed run's tool calls the engine reported are kept with its reply (#141), whatever their read finds, when its
 // Connection offers its events at all.
 if(outcome==='completed'&&connection.features?.includes('run_events_sse')) await sealRunSteps(db,engine,open);
 // Postgres cannot store a NUL character; dropping it keeps such a reply from failing forever.
 const reply=outcome==='completed'?result.reply.replaceAll('\u0000',''):null;
 const {data:saved,error}=await db.rpc('close_conversation_run',{conversation:open.conversation,run:open.run,run_outcome:outcome,reply,hermes_session:result.session,used_input:result.usage?.input??null,used_output:result.usage?.output??null,read_completed:result.state==='completed'});
 if(error) throw error;
 return !!saved;
}

// The Conversation's person answers the question its Agent's Run waits on (#138): a pick names the card and the
// choice's index, typed words have no card and mean the open question, if any. `db` is the person's own session, so the
// database checks it is their Conversation and they may write, and claims the answer once (answer_question); the claim
// is stored before the engine is called, and closing the Conversation's Runs then delivers it. If this request dies after
// the claim, the next closer (the worker, the page's next read) delivers it.
/** @param {any} db @param {any} service @param {{company:string,conversation:string,card:number|null,choice?:number|null,answer?:string|null,answerKey:string,encryptionKey:string|undefined,engineFor?:typeof defaultEngine}} claim
 * @returns {Promise<{state:'claimed'|'taken'|'closed'|'none'}|{code:string|undefined,message?:string}>} */
export async function answerQuestion(db,service,{company,conversation,card,choice=null,answer=null,answerKey,encryptionKey,engineFor=defaultEngine}) {
 const {data:state,error}=await db.rpc('answer_question',{c:company,conversation,card,choice,answer,answer_key:answerKey});
 if(error) return {code:error.code,message:error.message};
 if(state==='claimed') {
  try { await closeOpenRuns(service,{encryptionKey,conversation,engineFor}); }
  catch(failure) { console.error('Answer not delivered yet:',conversation,failure?.message||'unknown error'); }
 }
 return {state};
}

// The Conversation's person answers the request its Agent's Run waits on (#163) with one of its card's choices. `db` is
// their own session, so the database checks it is their Conversation, their role may send that choice and the engine
// offered it, and keeps the first press only (decide_permission); a first press is then delivered by closing the
// Conversation's Runs, and if this request dies after the claim, the next closer delivers it. Returns what the card
// shows now, read again after the delivery, or a database refusal code. Nothing the request says is ever logged.
/** @param {any} db @param {any} service @param {{company:string,conversation:string,card:number,choice:import('./engine.mjs').PermissionChoice,encryptionKey:string|undefined,engineFor?:typeof defaultEngine}} press
 * @returns {Promise<{state:'decided'|'closed',choice:import('./engine.mjs').PermissionChoice|null,at:string|null,first:boolean}|{code:string|undefined}>} */
export async function decidePermission(db,service,{company,conversation,card,choice,encryptionKey,engineFor=defaultEngine}) {
 const {data:pressed,error}=await db.rpc('decide_permission',{c:company,conversation,card,choice});
 if(error) return {code:error.code};
 if(!pressed.first) return pressed;
 try { await closeOpenRuns(service,{encryptionKey,conversation,engineFor}); }
 catch(failure) { console.error('Permission not delivered yet:',conversation,failure?.message||'unknown error'); }
 // The Engine may have stopped waiting before the choice reached it: the card then closed, and says so.
 const {data:now}=await db.from('reply_cards').select('state').eq('id',card).maybeSingle();
 return now?.state==='closed'?{state:'closed',choice:null,at:null,first:true}:pressed;
}

// What a closer tells the database a read showed (track_run_question): the question as the card keeps it. Only the
// question's text is ever shortened, since it is never sent back; choices that cannot all be drawn (more than four, or
// one longer than 1000 characters) are left out, so the person answers in words.
/** @param {import('./engine.mjs').RunQuestion} question */
const askedOf=question=>{
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
const requestedOf=permission=>({id:permission.id,description:keptWords(permission.description),command:keptWords(permission.command),choices:permission.choices});

// The run's Connection (the agent's own, whoever attached it) comes with the open run; the service role reads only its
// key, by id (ADR 0008).
async function connectionOf(db,{connection,address,profile,state},encryptionKey) {
 if(!connection) return {};
 if(!['connected','unreachable'].includes(state)) return {held:true};
 const {data,error}=await db.from('hermes_connections').select('key_encrypted,features').eq('id',connection).maybeSingle();
 if(error) throw error;
 if(!data) return {};
 try { return {profile:{address,profile,key:decryptSecret(data.key_encrypted,encryptionKey)},features:data.features??[]}; } catch { return {held:true}; }
}
