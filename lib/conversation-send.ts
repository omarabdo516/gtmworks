import 'server-only';
import type { supabase } from './supabase';
import { conversationMessagesPage } from './conversation-messages';
import { startConversationRun, type ConversationStart } from './conversation-start.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;
// What a send answers: the Run started (the reply follows on the Conversation's live read), `nothing` for a rerun the
// Conversation has moved past (the page reads the session again), or a refusal with nothing started.
export type EngineSend=ConversationStart|{state:'nothing'};

// A person's message in their Conversation: one Run on its Engine session, started by lib/conversation-start.mjs, which
// says how. The images the route checked go as their own bytes in the Run's input.
// `rerun`: Try again on the Conversation's unanswered last message (#980). The words the page sends must be that message
// (checked here, on the Engine's own session, past any page of tool calls); the Run is started as any send with the same
// send key, and the page hides the Run's own copy of the words by the id the Engine stamps on its row.
export async function sendToEngine(db:Database,service:{rpc:(name:string,args:object)=>PromiseLike<{error:unknown}>},{company,person,conversation,agent,message,sendKey,images=[],rerun=false,messageId}:{company:string,person:string,conversation:string,agent?:string,message:string,sendKey:string,images?:File[],rerun?:boolean,messageId?:number}):Promise<EngineSend> {
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
 const encoded=await Promise.all(images.map(async file=>({content_type:file.type,base64:Buffer.from(await file.arrayBuffer()).toString('base64')})));
 return startConversationRun(db,service,{company,person,conversation,agent,message,sendKey,images:encoded});
}
