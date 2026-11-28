import 'server-only';
import type { supabase } from './supabase';
import { agentEngine } from './engine/handle.mjs';
import { mentionedAgent } from './composer-mentions.mjs';
import { imageInput, noteInstructions } from './conversation-runs.mjs';
import { conversationMessagesPage } from './conversation-messages';
import { logActionFailure } from './diagnostics.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;
// How long a send the Engine answers "retry" for is asked again before it is left in the box as not sent (#877).
const busyFor=8000;
// What a send on the Engine path answers: the Run started (the reply follows on the Conversation's live read), `old`
// for a Conversation the old record still holds (the caller sends it there), `nothing` for a rerun the Conversation has
// moved past (the page reads the session again), or a refusal with nothing started.
export type EngineSend={state:'started',conversation:string,run:string,queued:boolean}|{state:'old'}|{state:'nothing'}|{state:'refused',code?:string,error?:string,status?:number};

// A person's message in a Conversation whose messages are the Engine's (#876, ADR 0033 item 1): checked on the server
// (open_engine_conversation: an active Member, not a Viewer, their own Conversation, an Agent they may talk to), a new
// Conversation's row written first on a session id the database chooses, then one Run started on that session with the
// message and its images, the sender's own note as its instructions, and the send key as its idempotency key. The row then holds the
// Run's id until its end is seen (app/api/conversation-live). Nothing of the message is stored in gtmworks: who wrote it
// is the row's person, the signed-in one of `db`, as the Engine's session keeps no author (ADR 0033). A new Conversation's first message that calls another Agent the sender
// sees goes to that Agent, as it always has (#153).
// `service` is a service-role client: only the server holds the Run it started on the row (hold_conversation_run).
// `rerun`: Try again on the Conversation's unanswered last message (#980). The words the page sends must be that message
// (checked here, on the Engine's own session, past any page of tool calls); the Run is started as any send with the same
// send key, and the page hides the Run's own copy of the words by the id the Engine stamps on its row.
export async function sendToEngine(db:Database,service:{rpc:(name:string,args:object)=>PromiseLike<{error:unknown}>},{company,person,conversation,agent:chosen,message,sendKey,images=[],rerun=false,messageId}:{company:string,person:string,conversation:string,agent?:string,message:string,sendKey:string,images?:File[],rerun?:boolean,messageId?:number}):Promise<EngineSend> {
 // The last message the Conversation draws must be the person's, with these words: another message, a reply or a fresh
 // read that moved on means this press no longer answers the unanswered message. The newest page may be tool calls and
 // results alone (a Turn that failed after more than a page of them), so read older pages until one message is drawn.
 if(rerun) {
  const {data:found}=await db.from('conversations').select('id,agent_id,hermes_session_id').eq('id',conversation).eq('company_id',company).eq('person_id',person).maybeSingle<{id:string,agent_id:string|null,hermes_session_id:string|null}>();
  if(!found?.agent_id||!found.hermes_session_id) return {state:'refused',error:'conversationNotFound',status:404};
  const target={id:conversation,agent_id:found.agent_id,agent_name:'',hermes_session_id:found.hermes_session_id};
  let said=null;
  for(let offset=0;;) {
   const page=await conversationMessagesPage(db,company,target,{offset,limit:50});
   if(page.state!=='found') return {state:'refused',error:page.state==='notSeen'?'conversationNotFound':'conversationUnread',status:page.state==='notSeen'?404:503};
   said=page.messages.at(-1)??null;
   if(said||!page.hasMore) break;
   offset=page.nextOffset;
  }
  if(said?.author!=='person'||said.id!==messageId||said.body!==message) return {state:'nothing'};
 }
 let agent=chosen??null;
 if(chosen) agent=mentionedAgent(message,(await db.from('hermes_agents').select('id,name,is_default').eq('company_id',company)).data||[])||chosen;
 if(!agent) agent=(await db.from('hermes_agents').select('id').eq('company_id',company).eq('is_default',true).maybeSingle()).data?.id??null;
 const {data:opened,error}=await db.rpc('open_engine_conversation',{c:company,conversation,agent,message});
 if(error) return {state:'refused',code:error.code};
 const checked=opened as {state:'old'}|{state:'engine',agent:string,session:string,note:string|null};
 if(checked.state==='old') return {state:'old'};
 const target=await agentEngine(db,{company,agent:checked.agent});
 if(target.state==='missing') return {state:'refused',error:'conversationNotFound',status:404};
 if(target.state!=='found') return {state:'refused',error:'conversationHermesFailed',status:502};
 const instructions=noteInstructions(checked.note);
 // The same send key is the same Run: a start whose answer was lost is asked again with it, which replays that Run, a
 // few times; one still unknown is refused, and the person's Try again (the same key) replays it rather than start another.
 // The Engine answering "retry" (#877: it runs as many Runs at once as it takes) is asked again when it says, for a short
 // time (busyFor), then refused as busy; a session whose queue is full is refused at once. Neither made a Run.
 // A person's images go in the Run's input (#880), each the image part the Engine reads, as base64 of its own bytes;
 // the route checked their kind, count and size before anything was sent. The Engine keeps them in the session, and
 // the Conversation reads them back from there: gtmworks keeps no copy.
 const input=images.length?imageInput(message,await Promise.all(images.map(async file=>({content_type:file.type,base64:Buffer.from(await file.arrayBuffer()).toString('base64')})))):message;
 const start={session:checked.session,input,...(instructions?{instructions}:{}),idempotencyKey:`${conversation}:${sendKey}`};
 const began=Date.now(); let lost=false; let unsure=0;
 let run=await target.engine.sessions.send(start);
 for(;;) {
  if(run===null||typeof run!=='object'||run.state==='keyConflict'||run.state==='queueFull') break;
  let wait:number;
  if(run.state==='busy') { wait=run.retryAfter*1000; if(Date.now()-began+wait>busyFor) break; }
  else { if(unsure>=3) break; lost||=run.state==='unknown'; wait=500*++unsure; }
  await new Promise(resolve=>setTimeout(resolve,wait));
  run=await target.engine.sessions.send({...start,retry:lost});
 }
 if(typeof run!=='string') {
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
