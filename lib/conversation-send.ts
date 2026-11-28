import 'server-only';
import type { supabase } from './supabase';
import { agentEngine } from './engine/handle.mjs';
import { mentionedAgent } from './composer-mentions.mjs';
import { imageInput, noteInstructions } from './conversation-runs.mjs';
import { logActionFailure } from './diagnostics.mjs';
import { answeringOpening, openingFor } from './lead-opening.mjs';
import type { ModelChoice } from './engine.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;
// How long a send the Engine answers "retry" for is asked again before it is left in the box as not sent (#877).
const busyFor=8000;
// What a send on the Engine path answers: the Run started (the reply follows on the Conversation's live read), `old`
// for a Conversation the old record still holds (the caller sends it there), or a refusal with nothing started.
export type EngineSend={state:'started',conversation:string,run:string,queued:boolean}|{state:'old'}|{state:'refused',code?:string,error?:string,status?:number};

// A person's message in a Conversation whose messages are the Engine's (#876, ADR 0033 item 1): checked on the server
// (open_engine_conversation: an active Member, not a Viewer, their own Conversation, an Agent they may talk to), a new
// Conversation's row written first on a session id the database chooses, then one Run started on that session with the
// message and its images, the sender's own note as its instructions, and the send key as its idempotency key. The row then holds the
// Run's id until its end is seen (app/api/conversation-live). Nothing of the message is stored in gtmworks: who wrote it
// is the row's person, the signed-in one of `db`, as the Engine's session keeps no author (ADR 0033). A new Conversation's first message that calls another Agent the sender
// sees goes to that Agent, as it always has (#153).
// `service` is a service-role client: only the server holds the Run it started on the row (hold_conversation_run).
// The model the Conversation's Owner chose for it (#158) goes with every Run, as the Engine takes it for that Run alone
// (#882). The Conversation the main Agent opened (lib/lead-opening.mjs) tells its first Run the opening, in the sender's
// language: the first is the one whose session the Engine does not hold yet, so a send asked again keeps it.
export async function sendToEngine(db:Database,service:{rpc:(name:string,args:object)=>PromiseLike<{error:unknown}>},{company,person,conversation,agent:chosen,message,sendKey,images=[]}:{company:string,person:string,conversation:string,agent?:string,message:string,sendKey:string,images?:File[]}):Promise<EngineSend> {
 let agent=chosen??null;
 if(chosen) agent=mentionedAgent(message,(await db.from('hermes_agents').select('id,name,is_default').eq('company_id',company)).data||[])||chosen;
 if(!agent) agent=(await db.from('hermes_agents').select('id').eq('company_id',company).eq('is_default',true).maybeSingle()).data?.id??null;
 const {data:opened,error}=await db.rpc('open_engine_conversation',{c:company,conversation,agent,message});
 if(error) return {state:'refused',code:error.code};
 const checked=opened as {state:'old'}|{state:'engine',agent:string,session:string,note:string|null,model?:ModelChoice|null,opening?:{owner:string|null,language:string|null,lead:string,company:string|null}};
 if(checked.state==='old') return {state:'old'};
 const target=await agentEngine(db,{company,agent:checked.agent});
 if(target.state==='missing') return {state:'refused',error:'conversationNotFound',status:404};
 if(target.state!=='found') return {state:'refused',error:'conversationHermesFailed',status:502};
 const model=typeof checked.model?.provider==='string'&&typeof checked.model?.model==='string'?{provider:checked.model.provider,model:checked.model.model}:null;
 const opening=checked.opening?answeringOpening(openingFor(checked.opening)):null;
 const startOf=(told:boolean)=>{
  const instructions=[noteInstructions(checked.note),told?opening?.instructions:undefined].filter(Boolean).join('\n\n');
  return {session:checked.session,input,...(instructions?{instructions}:{}),...(model?{model}:{}),...(told&&opening?{history:opening.history}:{}),idempotencyKey:`${conversation}:${sendKey}`};
 };
 // The first Run is the one whose session the Engine does not hold yet. A send asked again after its first answer was
 // lost finds the session held: the Engine then says the key was used with the opening, and it is asked with it.
 let told=!!opening&&await target.engine.sessions.held(checked.session)==='missing';
 // The same send key is the same Run: a start whose answer was lost is asked again with it, which replays that Run, a
 // few times; one still unknown is refused, and the person's Try again (the same key) replays it rather than start another.
 // The Engine answering "retry" (#877: it runs as many Runs at once as it takes) is asked again when it says, for a short
 // time (busyFor), then refused as busy; a session whose queue is full is refused at once. Neither made a Run.
 // A person's images go in the Run's input (#880), each the image part the Engine reads, as base64 of its own bytes;
 // the route checked their kind, count and size before anything was sent. The Engine keeps them in the session, and
 // the Conversation reads them back from there: gtmworks keeps no copy.
 const input=images.length?imageInput(message,await Promise.all(images.map(async file=>({content_type:file.type,base64:Buffer.from(await file.arrayBuffer()).toString('base64')})))):message;
 let start=startOf(told);
 const began=Date.now(); let lost=false; let unsure=0;
 let run=await target.engine.sessions.send(start);
 if(run&&typeof run==='object'&&run.state==='keyConflict'&&opening&&!told) { told=true; start=startOf(true); run=await target.engine.sessions.send(start); }
 for(;;) {
  if(run===null||typeof run!=='object'||run.state==='keyConflict'||run.state==='queueFull') break;
  let wait:number;
  if(run.state==='busy') { wait=run.retryAfter*1000; if(Date.now()-began+wait>busyFor) break; }
  else { if(unsure>=3) break; lost||=run.state==='unknown'; wait=500*++unsure; }
  await new Promise(resolve=>setTimeout(resolve,wait));
  run=await target.engine.sessions.send({...start,retry:lost});
 }
 if(typeof run!=='string') {
  // A start the Engine refused outright while it named the Conversation's model is refused for that model: the
  // Conversation goes back to the model it had, and the person is told so, with their words still in the box.
  if(!lost&&run===null&&model&&(await db.rpc('refuse_conversation_model',{c:company,conversation,refused:model})).data===true)
   return {state:'refused',error:'conversationModelRefused',status:502};
  // Once an answer was lost the Run may exist, so only Try again with the same key can say.
  if(!lost&&run?.state==='busy') return {state:'refused',error:'conversationEngineBusy',status:503};
  if(!lost&&run?.state==='queueFull') return {state:'refused',error:'conversationQueueFull',status:409};
  return {state:'refused',error:'conversationHermesFailed',status:502};
 }
 // A Run started while the row holds another may wait its turn in the Engine's queue: the Engine says whether it does,
 // and the page draws the message as waiting until its Run is followed.
 const {data:held}=await db.from('conversations').select('open_runs').eq('id',conversation).maybeSingle<{open_runs:string[]|null}>();
 const queued=(held?.open_runs??[]).some(other=>other!==run)&&await target.engine.sessions.queued(run).catch(()=>false);
 // The Run is on the Engine now; a row that could not take its id still gets the reply in the session, read on the next
 // open, so the send is not refused for it.
 const {error:unheld}=await service.rpc('hold_conversation_run',{conversation,person,run});
 if(unheld) logActionFailure('conversation',new Error('Open Run not held on its Conversation'));
 return {state:'started',conversation,run,queued};
}
