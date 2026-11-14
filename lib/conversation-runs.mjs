import { decryptSecret } from './agent-crypto.mjs';
import { engineFor as defaultEngine, outcomeOf } from './engine.mjs';
import { companyProfile } from './agent-levels.mjs';

// A person's message to the agent of their conversation, sent through the engine contract (lib/engine.mjs). `db` is the
// person's own session, so the database checks they may write in the company (any Member but a Viewer, #287) and the
// conversation is theirs before the engine is called; `service` is a service-role client that only reads the agent's
// Connection, through that agent in that company (ADR 0008), and the key is only ever given to the engine's driver. An
// untested or refusing engine is never called (ADR 0008 fails closed); a new run also needs the run_submission
// capability. Returns the conversation, a database refusal code, or a refusal to show.
/** @param {any} db @param {any} service @param {{person:string,company:string,conversation:string,sendKey:string,agent?:string,message:string,encryptionKey:string|undefined,engineFor?:typeof defaultEngine}} send
 * @returns {Promise<{conversation:string}|{code:string|undefined}|{error:'conversationNotFound'|'conversationHermesFailed',status:number}>} */
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
 const {data:pinned,error:unreserved}=await db.rpc('reserve_conversation_run',{conversation,c:company,agent:inCompany.id,message_key:sendKey,message});
 if(unreserved) return unreserved.message==='agentLevelPending'?{error:'conversationAgentLevelPending',status:409}:unreserved.message==='hermesProfileNotShared'?{error:'conversationNotFound',status:404}:{code:unreserved.code};
 const connection=pinned&&await sendingConnection(service,company,pinned,encryptionKey);
 if(!connection) return {error:'conversationNotFound',status:404};
 // The same send key is the same run (the contract's idempotency key), so a retry after a failed save never runs twice.
 const run=await engineFor(connection).start({conversation,input:message,idempotencyKey:`${conversation}:${sendKey}`});
 if(!run) return {error:'conversationHermesFailed',status:502};
 const {error}=await db.rpc('send_conversation_message',{conversation,c:company,agent:inCompany.id,message,message_key:sendKey,run,started_on:pinned});
 // The worker abandoned the reservation meanwhile (or the agent moved): the run cannot be followed, so it is sent again.
 if(error?.message==='conversationSendAgain') return {error:'conversationSendAgain',status:409};
 return error?{code:error.code}:{conversation};
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
