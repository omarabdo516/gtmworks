import { decryptSecret } from './agent-crypto.mjs';
import { engineFor as defaultEngine, outcomeOf, startOutcomeUnknown } from './engine.mjs';
import { rulesInstructions, sendingConnection } from './conversation-runs.mjs';

/** @typedef {typeof defaultEngine} EngineFor */
/** @param {number} message */
const runKey=message=>`channel:${message}`;
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
export async function driveChannelRuns(service,{encryptionKey,engineFor=defaultEngine,channel=null,message=null}) {
 const {data:due,error}=await service.rpc('channel_runs_due',{just_channel:channel,just_message:message});
 if(error) throw error;
 const engines=new Map(); let started=0; let closed=0;
 for(const row of due||[]) {
  try {
   if(row.run) closed+=await closeOne(service,row,engines,encryptionKey,engineFor);
   else started+=await startOne(service,row.message,encryptionKey,engineFor);
  } catch(failure) { console.error('Channel run not moved:',row.message,failure?.message||'unknown error'); }
 }
 return {started,closed};
}

/** @param {any} service @param {number} message @param {string|undefined} encryptionKey @param {EngineFor} engineFor */
async function startOne(service,message,encryptionKey,engineFor) {
 const {data:rows,error}=await service.rpc('begin_channel_start',{message});
 if(error) throw error;
 const begun=rows?.[0]; if(!begun) return 0;
 const connection=await sendingConnection(service,begun.company,begun.connection,encryptionKey);
 const instructions=[begun.instructions,rulesInstructions(begun.rules||[])].filter(Boolean).join('\n\n');
 const run=connection?await engineFor(connection).start({conversation:begun.session,input:begun.input,idempotencyKey:runKey(message),...(instructions?{instructions}:{}),retry:begun.attempt>1}):null;
 if(startOutcomeUnknown(run)) return 0;
 const {data:recorded,error:unrecorded}=await service.rpc('answer_channel_start',{message,attempt:begun.attempt,run});
 if(unrecorded) throw unrecorded;
 return recorded&&run?1:0;
}

/** @param {any} service @param {{message:number,run:string,connection:string|null,address:string|null,profile:string|null,state:string|null}} row @param {Map<string,any>} engines @param {string|undefined} encryptionKey @param {EngineFor} engineFor */
async function closeOne(service,row,engines,encryptionKey,engineFor) {
 if(!row.connection) return close(service,row,'lost',null);
 if(!engines.has(row.connection)) engines.set(row.connection,await engineOf(service,row,encryptionKey,engineFor));
 const engine=engines.get(row.connection);
 if(!engine) return 0;
 const result=await engine.read(row.run);
 if(result.state==='unreachable') engines.set(row.connection,null);
 const outcome=outcomeOf(result);
 if(!outcome) return 0;
 return close(service,row,outcome,result);
}

/** @param {any} service @param {{message:number,run:string}} row @param {'completed'|'failed'|'stopped'|'lost'} outcome @param {import('./engine.mjs').RunState|null} result */
async function close(service,row,outcome,result) {
 // Postgres cannot store a NUL character; dropping it keeps such a reply from failing forever.
 const reply=outcome==='completed'&&result?.reply?result.reply.replaceAll('\u0000',''):null;
 const usage=result?.usage;
 const {data:saved,error}=await service.rpc('close_channel_run',{message:row.message,run:row.run,run_outcome:outcome,reply,used_input:usage?usage.input:null,used_output:usage?usage.output:null});
 if(error) throw error;
 return saved?1:0;
}

/** @param {any} service @param {{connection:string|null,address:string|null,profile:string|null,state:string|null}} row @param {string|undefined} encryptionKey @param {EngineFor} engineFor */
async function engineOf(service,{connection,address,profile,state},encryptionKey,engineFor) {
 if(!['connected','unreachable'].includes(state||'')||!address||!profile) return null;
 const {data,error}=await service.from('hermes_connections').select('key_encrypted').eq('id',connection).maybeSingle();
 if(error) throw error;
 if(!data) return null;
 try { return engineFor({address,profile,key:decryptSecret(data.key_encrypted,encryptionKey)}); } catch { return null; }
}
