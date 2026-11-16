import { decryptSecret } from './agent-crypto.mjs';
import { engineFor as defaultEngine, outcomeOf, startOutcomeUnknown } from './engine.mjs';
import { rulesInstructions, sendingConnection } from './conversation-runs.mjs';
import { knowledgeInstructions } from './company-knowledge.mjs';

/** @typedef {typeof defaultEngine} EngineFor */
/** @typedef {{key:string,label:string,due:string,begin:string,answer:string,close:string,knowledge:string}} RunSource */
// The Runs a mention starts: one per general channel message (#23) and one per Card note (#22). Both keep the same
// lifecycle in the database under their own functions; one driver moves them, and a Run's idempotency key is its
// source's key and its message id.
/** @type {{channel:RunSource,note:RunSource}} */
const sources={
 channel:{key:'channel',label:'Channel',due:'channel_runs_due',begin:'begin_channel_start',answer:'answer_channel_start',close:'close_channel_run',knowledge:'channel_run_knowledge'},
 note:{key:'note',label:'Note',due:'note_runs_due',begin:'begin_note_start',answer:'answer_note_start',close:'close_note_run',knowledge:'note_run_knowledge'},
};
/** @param {RunSource} source @param {number} message */
const runKey=(source,message)=>`${source.key}:${message}`;
const duePage=500;
/** @type {Record<string,{refused:'channelNotFound'|'channelNotAllowed'|'channelFailed',status:400|403|404}>} */
const refusals={P0002:{refused:'channelNotFound',status:404},'42501':{refused:'channelNotAllowed',status:403}};

/** @param {any} db @param {any} service @param {{channel:string,sendKey:string,message:string,encryptionKey:string|undefined,engineFor?:EngineFor}} post
 * @returns {Promise<{message:number}|{refused:'channelNotFound'|'channelNotAllowed'|'channelFailed',status:400|403|404}>} */
export async function postChannelMessage(db,service,{channel,sendKey,message,encryptionKey,engineFor=defaultEngine}) {
 const {data:id,error}=await db.rpc('post_channel_message',{ch:channel,message_key:sendKey,message});
 if(error) return refusals[error.code]||{refused:'channelFailed',status:400};
 try { await driveChannelRuns(service,{encryptionKey,engineFor,message:id}); }
 catch(failure) { console.error('Channel run not started:',id,failure?.message||'unknown error'); }
 return {message:id};
}

/** @param {any} service @param {{encryptionKey:string|undefined,engineFor?:EngineFor,channel?:string|null,message?:number|null}} options
 * @returns {Promise<{started:number,closed:number}>} */
export function driveChannelRuns(service,{encryptionKey,engineFor=defaultEngine,channel=null,message=null}) {
 return driveRuns(sources.channel,service,{encryptionKey,engineFor,message,scope:{just_channel:channel}});
}

/** @param {any} service @param {{encryptionKey:string|undefined,engineFor?:EngineFor,message?:number|null}} options
 * @returns {Promise<{started:number,closed:number}>} */
export function driveNoteRuns(service,{encryptionKey,engineFor=defaultEngine,message=null}) {
 return driveRuns(sources.note,service,{encryptionKey,engineFor,message,scope:{}});
}

/** @param {RunSource} source @param {any} service @param {{encryptionKey:string|undefined,engineFor:EngineFor,message:number|null,scope:Record<string,unknown>}} options */
async function driveRuns(source,service,{encryptionKey,engineFor,message,scope}) {
 const engines=new Map(); let started=0; let closed=0; let after=0;
 for(;;) {
  const {data:due,error}=await service.rpc(source.due,{...scope,just_message:message,after});
  if(error) throw error;
  for(const row of due||[]) {
   try {
    if(row.run) closed+=await closeOne(source,service,row,engines,encryptionKey,engineFor);
    else started+=await startOne(source,service,row.message,encryptionKey,engineFor);
   } catch(failure) { console.error(`${source.label} run not moved:`,row.message,failure?.message||'unknown error'); }
  }
  if(!due||due.length<duePage) return {started,closed};
  after=due.at(-1).message;
 }
}

/** @param {RunSource} source @param {any} service @param {number} message @param {string|undefined} encryptionKey @param {EngineFor} engineFor */
async function startOne(source,service,message,encryptionKey,engineFor) {
 const {data:rows,error}=await service.rpc(source.begin,{message});
 if(error) throw error;
 const begun=rows?.[0]; if(!begun) return 0;
 const connection=await sendingConnection(service,begun.company,begun.connection,encryptionKey);
 // The Company knowledge pinned as the run's row was made (#27), after the Agent's own instructions.
 const {data:knowledge,error:unread}=await service.rpc(source.knowledge,{message});
 if(unread) throw unread;
 const instructions=[begun.instructions,knowledgeInstructions(knowledge),rulesInstructions(begun.rules||[])].filter(Boolean).join('\n\n');
 const run=connection?await engineFor(connection).start({conversation:begun.session,input:begun.input,idempotencyKey:runKey(source,message),...(instructions?{instructions}:{}),retry:begun.attempt>1}):null;
 if(startOutcomeUnknown(run)) return 0;
 const {data:recorded,error:unrecorded}=await service.rpc(source.answer,{message,attempt:begun.attempt,run});
 if(unrecorded) throw unrecorded;
 return recorded&&run?1:0;
}

/** @param {RunSource} source @param {any} service @param {{message:number,run:string,connection:string|null,address:string|null,profile:string|null,state:string|null,key_encrypted:string|null}} row @param {Map<string,any>} engines @param {string|undefined} encryptionKey @param {EngineFor} engineFor */
async function closeOne(source,service,row,engines,encryptionKey,engineFor) {
 if(!row.connection) return close(source,service,row,'lost',null);
 if(!engines.has(row.connection)) engines.set(row.connection,engineOf(row,encryptionKey,engineFor));
 const engine=engines.get(row.connection);
 if(!engine) return 0;
 const result=await engine.read(row.run);
 if(result.state==='unreachable') engines.set(row.connection,null);
 const outcome=outcomeOf(result);
 if(!outcome) return 0;
 return close(source,service,row,outcome,result);
}

/** @param {RunSource} source @param {any} service @param {{message:number,run:string}} row @param {'completed'|'failed'|'stopped'|'lost'} outcome @param {import('./engine.mjs').RunState|null} result */
async function close(source,service,row,outcome,result) {
 // Postgres cannot store a NUL character; dropping it keeps such a reply from failing forever.
 const reply=outcome==='completed'&&result?.reply?result.reply.replaceAll('\u0000',''):null;
 const usage=result?.usage;
 const {data:saved,error}=await service.rpc(source.close,{message:row.message,run:row.run,run_outcome:outcome,reply,used_input:usage?usage.input:null,used_output:usage?usage.output:null});
 if(error) throw error;
 return saved?1:0;
}

/** @param {{address:string|null,profile:string|null,state:string|null,key_encrypted:string|null}} row @param {string|undefined} encryptionKey @param {EngineFor} engineFor */
function engineOf({address,profile,state,key_encrypted},encryptionKey,engineFor) {
 if(!['connected','unreachable'].includes(state||'')||!address||!profile||!key_encrypted) return null;
 try { return engineFor({address,profile,key:decryptSecret(key_encrypted,encryptionKey)}); } catch { return null; }
}
