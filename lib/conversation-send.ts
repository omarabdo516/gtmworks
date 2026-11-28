import 'server-only';
import { randomUUID } from 'node:crypto';
import type { supabase } from './supabase';
import { agentEngine } from './engine/handle.mjs';
import { mentionedAgent } from './composer-mentions.mjs';
import { noteInstructions } from './conversation-runs.mjs';
import { logActionFailure } from './diagnostics.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;
// What a send on the Engine path answers: the Run started (the reply follows on the Conversation's live read), `old`
// for a Conversation the old record still holds (the caller sends it there), or a refusal with nothing started.
export type EngineSend={state:'started',conversation:string,run:string}|{state:'old'}|{state:'refused',code?:string,error?:string,status?:number};

// A person's message in a Conversation whose messages are the Engine's (#876, ADR 0033 item 1): checked on the server
// (open_engine_conversation: an active Member, not a Viewer, their own Conversation, an Agent they may talk to), a new
// Conversation's row written first on the session id gtmworks chooses, then one Run started on that session with the
// message, the sender's own note as its instructions, and the send key as its idempotency key. The row then holds the
// Run's id until its end is seen (app/api/conversation-live). Nothing of the message is stored in gtmworks: who wrote it
// is the row's person, the signed-in one of `db`, as the Engine's session keeps no author (ADR 0033). A new Conversation's first message that calls another Agent the sender
// sees goes to that Agent, as it always has (#153).
// `service` is a service-role client: only the server holds the Run it started on the row (hold_conversation_run).
export async function sendToEngine(db:Database,service:{rpc:(name:string,args:object)=>PromiseLike<{error:unknown}>},{company,person,conversation,agent:chosen,message,sendKey}:{company:string,person:string,conversation:string,agent?:string,message:string,sendKey:string}):Promise<EngineSend> {
 let agent=chosen??null;
 if(chosen) agent=mentionedAgent(message,(await db.from('hermes_agents').select('id,name,is_default').eq('company_id',company)).data||[])||chosen;
 if(!agent) agent=(await db.from('hermes_agents').select('id').eq('company_id',company).eq('is_default',true).maybeSingle()).data?.id??null;
 const {data:opened,error}=await db.rpc('open_engine_conversation',{c:company,conversation,agent,session:`gtmworks-${randomUUID()}`,message});
 if(error) return {state:'refused',code:error.code};
 const checked=opened as {state:'old'}|{state:'engine',agent:string,session:string,note:string|null};
 if(checked.state==='old') return {state:'old'};
 const target=await agentEngine(db,{company,agent:checked.agent});
 if(target.state==='missing') return {state:'refused',error:'conversationNotFound',status:404};
 if(target.state!=='found') return {state:'refused',error:'conversationHermesFailed',status:502};
 const instructions=noteInstructions(checked.note);
 const run=await target.engine.sessions.send({session:checked.session,input:message,...(instructions?{instructions}:{}),idempotencyKey:`${conversation}:${sendKey}`});
 if(typeof run!=='string') return {state:'refused',error:'conversationHermesFailed',status:502};
 // The Run is on the Engine now; a row that could not take its id still gets the reply in the session, read on the next
 // open, so the send is not refused for it.
 const {error:unheld}=await service.rpc('hold_conversation_run',{conversation,person,run});
 if(unheld) logActionFailure('conversation',new Error('Open Run not held on its Conversation'));
 return {state:'started',conversation,run};
}
