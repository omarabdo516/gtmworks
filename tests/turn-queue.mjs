// #764: a send stores its message as a turn (queue_conversation_turn) and the one starter claims and starts it
// (queued_conversations, claim_conversation_turn). A test's stand-in database that answers the reservation a turn would
// pin (its connection, profile and note, as reserve_conversation_turn answered before #764) is given these calls here:
// the turn is pinned from that answer, the claim hands it to the starter, and every other call is the stand-in's own.
/** @param {(name:string,args:any)=>Promise<{data:any,error:any}>} rpc */
export function withTurnQueue(rpc) {
 /** @type {Map<string,{conversation:string,company:string,agent:string,key:string,message:string,pinned:any,started:boolean,failed:boolean}>} */
 const turns=new Map();
 const waiting=()=>[...turns.values()].find(turn=>!turn.started&&!turn.failed);
 return async(/** @type {string} */ name,/** @type {any} */ args)=>{
  if(name==='queue_conversation_turn') {
   if(args.open_only) return {data:{state:'opened'},error:null};
   const known=turns.get(args.message_key);
   if(known) return {data:{state:known.started?'sent':known.failed?'failed':'queued'},error:null};
   const {data,error}=await rpc('reserve_conversation_turn',args);
   if(error||data?.state!=='reserved') return {data,error};
   turns.set(args.message_key,{conversation:args.conversation,company:args.c,agent:args.agent,key:args.message_key,message:args.message,pinned:data,started:false,failed:false});
   return {data:{state:'queued'},error:null};
  }
  // A turn a send stored here is claimed first; with none waiting, the stand-in answers its own queue.
  const turn=waiting();
  if(name==='queued_conversations'&&turn) return {data:[{conversation:turn.conversation}],error:null};
  if(name==='claim_conversation_turn'&&turn) return {data:[{company:turn.company,agent:turn.agent,person:'p',send_key:turn.key,message:turn.message,connection:turn.pinned.connection,profile:turn.pinned.profile,note:turn.pinned.note??null,retry:false,has_files:false}],error:null};
  if(name==='record_conversation_turn') { const turn=turns.get(args.message_key); if(turn) turn.started=true; }
  if(name==='fail_conversation_turn'||name==='refuse_run_model') { const turn=turns.get(args.message_key); if(turn) turn.failed=true; }
  const answer=await rpc(name,args);
  return answer.error&&/^unexpected/.test(answer.error.message??'')&&['record_conversation_turn','fail_conversation_turn','refuse_run_model','release_queued_start','keep_unknown_start','pin_run_brief'].includes(name)?{data:true,error:null}:answer;
 };
}
