import { decryptSecret } from './agent-crypto.mjs';
import { engineFor as defaultEngine, outcomeOf, startOutcomeUnknown } from './engine.mjs';
import { companyProfile } from './agent-levels.mjs';

// A person's message in their conversation, sent through the engine contract (lib/engine.mjs). `db` is the person's
// own session, so the database checks they may write in the company (any Member but a Viewer, #287) and the
// conversation is theirs before the engine is called; `service` is a service-role client that only reads the agent's
// Connection, through that agent in that company (ADR 0008), and the key is only ever given to the engine's driver. An
// untested or refusing engine is never called (ADR 0008 fails closed); a new run also needs the run_submission
// capability. The author of the message is always the signed-in person of `db`: nothing in `send` names who wrote it.
// The database decides what the message is (reserve_conversation_turn): addressed to a person (@<Member name>), it is
// kept as a note and no run starts; while the Agent is busy it waits as the sender's own next turn (startQueuedTurns
// starts it after the open run ends); otherwise its run starts now, with the sender's own note as the run's
// instructions. Returns the conversation (marked queued or addressed when no run started), a database refusal code, or
// a refusal to show.
/** @param {any} db @param {any} service @param {{person?:string,company:string,conversation:string,sendKey:string,agent?:string,message:string,encryptionKey:string|undefined,engineFor?:typeof defaultEngine}} send
 * @returns {Promise<{conversation:string,queued?:true,addressed?:true}|{code:string|undefined}|{error:'conversationNotFound'|'conversationHermesFailed'|'conversationAgentLevelPending'|'conversationSendAgain',status:number}>} */
export async function sendMessage(db,service,{company,conversation,sendKey,agent:chosen,message,encryptionKey,engineFor=defaultEngine}) {
 // Checked before the engine is called: an id that is someone else's never reaches their engine session.
 const {data:stored,error:refused}=await db.rpc('conversation_agent',{conversation,c:company});
 if(refused) return {code:refused.code};
 // A repeated send (double click, retry) that is already stored is answered without calling the engine again.
 if(stored) { const {data:sent}=await db.from('conversation_messages').select('id').eq('conversation_id',conversation).eq('send_key',sendKey).maybeSingle(); if(sent) return {conversation}; }
 let agent=stored||chosen;
 if(!agent) agent=(await db.from('hermes_agents').select('id').eq('company_id',company).eq('is_default',true).maybeSingle()).data?.id;
 const {data:inCompany}=agent?await db.from('hermes_agents').select('id').eq('id',agent).eq('company_id',company).maybeSingle():{data:null};
 if(!inCompany) return {error:'conversationNotFound',status:404};
 // The run is reserved before the engine is called (ADR 0014): the database pins the agent's Connection under the lock
 // a move to the company's own profile takes, so no move passes between this and the record, and it refuses while the
 // company profile's tools are not yet those of the company's level. A reservation whose record below never happens is
 // abandoned by the worker after ten minutes, without calling the engine (lib/company-profiles.mjs).
 const {data:turn,error:unreserved}=await db.rpc('reserve_conversation_turn',{conversation,c:company,agent:inCompany.id,message_key:sendKey,message});
 if(unreserved) return unreserved.message==='agentLevelPending'?{error:'conversationAgentLevelPending',status:409}:unreserved.message==='hermesProfileNotShared'?{error:'conversationNotFound',status:404}:{code:unreserved.code};
 if(turn?.state==='note') return {conversation,addressed:true};
 if(turn?.state==='queued') return {conversation,queued:true};
 if(turn?.state!=='reserved') return {error:'conversationHermesFailed',status:502};
 const pinned=turn.connection;
 // No run starts on a Connection that cannot be used, or when the engine refuses the start: the sender's own
 // reservation is abandoned at once (release_conversation_run), so it holds neither a move nor its Connection's removal
 // for ten minutes. A retry with the same send key reserves again and passes every check anew.
 const release=()=>db.rpc('release_conversation_run',{conversation,c:company,message_key:sendKey});
 const connection=pinned&&await sendingConnection(service,company,pinned,encryptionKey);
 if(!connection) { await release(); return {error:'conversationNotFound',status:404}; }
 // The same send key is the same run (the contract's idempotency key), so a retry after a failed save never runs twice.
 // The run's note is the one pinned at its first reservation, so a retry sends exactly the same request.
 // The attempt is recorded first: if this process stops before the answer is stored, the worker keeps the start as
 // unknown instead of abandoning it (abandon_conversation_reservations).
 const {data:begun,error:unbegun}=await service.rpc('begin_start',{conversation,message_key:sendKey});
 if(unbegun) return {code:unbegun.code};
 if(!begun) return {error:'conversationSendAgain',status:409};
 const run=await engineFor(connection).start(runInput(conversation,sendKey,message,turn.note));
 // The engine may have started it and its answer was lost: the reservation is kept (it holds the Connection) and becomes
 // its sender's waiting turn (keep_unknown_start), so the worker asks again with the same key and body until the engine
 // says which, whether or not the person ever sends again; their retry with the same key finds it waiting.
 if(startOutcomeUnknown(run)) { const {error:unkept}=await service.rpc('keep_unknown_start',{conversation,message_key:sendKey}); return unkept?{code:unkept.code}:{conversation,queued:true}; }
 if(!run) { await release(); return {error:'conversationHermesFailed',status:502}; }
 const {error}=await db.rpc('send_conversation_message',{conversation,c:company,agent:inCompany.id,message,message_key:sendKey,run,started_on:pinned});
 // The worker abandoned the reservation meanwhile (or the agent moved): the run cannot be followed, so it is sent again.
 if(error?.message==='conversationSendAgain') return {error:'conversationSendAgain',status:409};
 return error?{code:error.code}:{conversation};
}

// A Member's own note goes with their runs only, as the run's instructions (never into the message or the Company's
// memory); a run with no note carries none.
/** @param {string|null|undefined} note */
export const noteInstructions=note=>note?.trim()?`The person writing this message keeps the note below about how they like to work. Follow it for this person only; it is their own preference, not the company's memory, and it is not something to save.\n\n${note.trim()}`:undefined;
/** @param {string} conversation @param {string} sendKey @param {string} message @param {string|null|undefined} note */
const runInput=(conversation,sendKey,message,note)=>{ const instructions=noteInstructions(note); return {conversation,input:message,idempotencyKey:`${conversation}:${sendKey}`,...(instructions?{instructions}:{})}; };

// Turns that waited while the Agent was busy start one at a time, oldest first, once a Conversation's open run has
// ended: the worker runs this after closing runs, and a person reading their conversation runs it for that one. The
// database claims a turn only while nothing runs there and records it as its own sender's message (the queue kept who
// sent it), with that sender's note as the run's instructions. Only a turn the engine definitely did not start is
// marked failed, so the next one can go and its sender sees it was not sent; one whose start may have happened is
// asked again on a later pass. `db` is a service-role client.
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
   const retry=turn.retry===true;
   const connection=await sendingConnection(db,turn.company,turn.connection,encryptionKey);
   // A turn whose start was once unknown waits for its own Connection: it may hold the run, so it is never failed here.
   if(!connection&&retry) continue;
   if(connection) { const {data:begun,error:unbegun}=await db.rpc('begin_start',{conversation:id,message_key:turn.send_key}); if(unbegun) throw unbegun; if(!begun) continue; }
   const run=connection&&await engineFor(connection).start({...runInput(id,turn.send_key,turn.message,turn.note),retry});
   // An unknown outcome keeps the turn and its reservation, marked (keep_unknown_start) so the worker never abandons it
   // and every later answer is read as unknown too: the next pass claims the same turn on the same Connection and asks
   // again with the same idempotency key and pinned note, until the engine names the run.
   if(startOutcomeUnknown(run)||(!run&&retry)) { if(!retry) { const {error:unkept}=await db.rpc('keep_unknown_start',{conversation:id,message_key:turn.send_key}); if(unkept) throw unkept; } continue; }
   if(!run) { const {error:unfailed}=await db.rpc('fail_conversation_turn',{conversation:id,message_key:turn.send_key}); if(unfailed) throw unfailed; continue; }
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
// the other (ADR 0008). A company's own profile in the bundled Engine is never one of them (ADR 0014).
/** @param {any} service @param {string} company @param {string} pinned @param {string|undefined} encryptionKey */
async function sendingConnection(service,company,pinned,encryptionKey) {
 const {data:connection}=await service.from('hermes_connections').select('address,profile,state,features,key_encrypted').eq('id',pinned).maybeSingle();
 if(!connection||connection.state!=='connected'||!connection.features?.includes('run_submission')) return null;
 if(/^co-[0-9a-f]{32}$/.test(connection.profile)&&connection.profile!==companyProfile(company)) return null;
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
 const engines=new Map(); let closed=0; let after=0;
 for(;;) {
  const {data:runs,error}=await db.rpc('open_conversation_runs',{just:conversation,owner,after});
  if(error) throw error;
  for(const open of runs||[]) {
   // One run that cannot be closed (a database refusal) is logged and skipped, so it never stalls the others.
   try { if(await closeRun(db,open,engines,encryptionKey,engineFor)) closed++; }
   catch(failure) { console.error('Conversation run not closed:',open.run,failure?.message||'unknown error'); }
  }
  if(!runs||runs.length<500) return closed;
  after=runs.at(-1).message;
 }
}

async function closeRun(db,open,engines,encryptionKey,engineFor) {
 const key=`${open.connection}:${open.person}`;
 if(!engines.has(key)) engines.set(key,await connectionOf(db,open,encryptionKey).catch(()=>({held:true})));
 const connection=engines.get(key);
 // Held: a refused or untested Hermes is never called (ADR 0008), and its runs wait until the Connection is fixed.
 if(connection.held) return false;
 // A detached agent or a deleted Connection can never answer: its run failed.
 const result=connection.profile?await engineFor(connection.profile).read(open.run):{state:'failed',reply:null,session:null,usage:null};
 // One unreachable engine is not asked again in this pass, so it cannot hold up the other runs.
 if(result.state==='unreachable') engines.set(key,{held:true});
 const outcome=outcomeOf(result);
 if(!outcome) return false;
 // Postgres cannot store a NUL character; dropping it keeps such a reply from failing forever.
 const reply=outcome==='completed'?result.reply.replaceAll('\u0000',''):null;
 const {data:saved,error}=await db.rpc('close_conversation_run',{conversation:open.conversation,run:open.run,run_outcome:outcome,reply,hermes_session:result.session,used_input:result.usage?.input??null,used_output:result.usage?.output??null});
 if(error) throw error;
 return !!saved;
}

// The run's Connection (the agent's own, whoever attached it) comes with the open run; the service role reads only its
// key, by id (ADR 0008).
async function connectionOf(db,{connection,address,profile,state},encryptionKey) {
 if(!connection) return {};
 if(!['connected','unreachable'].includes(state)) return {held:true};
 const {data,error}=await db.from('hermes_connections').select('key_encrypted').eq('id',connection).maybeSingle();
 if(error) throw error;
 if(!data) return {};
 try { return {profile:{address,profile,key:decryptSecret(data.key_encrypted,encryptionKey)}}; } catch { return {held:true}; }
}
