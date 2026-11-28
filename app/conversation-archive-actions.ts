'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { archiveIntents, type ArchiveAnswer, type ArchiveIntent, type ArchiveStopKind } from '@/lib/archive-stops';

// What archiving would stop in these Conversations (#674), or archiving or restoring them: each the signed-in person's
// own. `stops` answers what the one confirmation names (each line `about` its Conversation, which the asking page
// titles); the others answer the Conversations they changed, or refused when none changed. Archiving is the session's
// own archived mark (#881): it is written on the Engine first, then the person's act is logged
// (log_conversations_archived). The page that asked reads itself again
// (useConversationArchive), so nothing here imports the server's cache.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const archiveConversations=withActionLog('archiveConversations',async function archiveConversations(company:string,intent:ArchiveIntent,chats:string[]):Promise<ArchiveAnswer<string>> {
 const db=await supabase();
 if(!archiveIntents.includes(intent)||!await actionAllowed(db,'archiveConversations',company)) return {state:'refused'};
 const ids=(Array.isArray(chats)?chats:[]).map(String).filter(id=>uuid.test(id)).slice(0,500);
 if(intent==='stops') {
  const {data,error}=await db.rpc('conversation_archive_stops',{c:company,chats:ids});
  if(error) { logActionFailure('archiveConversations',error); return {state:'refused'}; }
  return {state:'stops',stops:((data||[]) as {conversation:string,kind:ArchiveStopKind,agent:string|null,agent_id:string|null}[])
   .map(({conversation,...stop})=>({...stop,about:conversation,title:''}))};
 }
 const archived=intent!=='restore';
 // Loaded here, not at the top: the chat's client modules import this file, and its Engine code is the server's alone.
 const {markConversations}=await import('@/lib/conversation-session-marks');
 const written=await markConversations(db,company,ids,archived);
 if(!written) return {state:'refused'};
 const done=[...written.marked];
 if(written.marked.length) {
  const {error}=await db.rpc('log_conversations_archived',{c:company,chats:written.marked,archived});
  // The session's mark is the archive: one that is written stands even when its log is not.
  if(error) logActionFailure('archiveConversations',error);
 }
 // A Conversation whose session the Engine does not hold yet (no Run started on it) keeps its row's own mark, which the
 // worker carries to its session once it is there (lib/conversation-archive.mjs).
 if(written.unstarted.length) {
  const {data,error}=archived?await db.rpc('archive_conversations',{c:company,chats:written.unstarted}):await db.rpc('restore_conversations',{c:company,chats:written.unstarted});
  if(error) logActionFailure('archiveConversations',error); else done.push(...((data||[]) as string[]).map(String));
 }
 if(!done.length) return {state:'refused'};
 return {state:'done',done};
});

// A Conversation's title is its session's title (#881): renaming writes it on the Engine. `invalid` is a title the
// Engine does not take (empty, too long, or another of the Agent's sessions holds it).
export const renameConversation=withActionLog('renameConversation',async function renameConversation(company:string,chat:string,title:string):Promise<{state:'done',title:string}|{state:'invalid'|'refused'}> {
 const db=await supabase();
 const name=typeof title==='string'?title.replace(/\s+/g,' ').trim():'';
 if(!uuid.test(String(chat))||!await actionAllowed(db,'renameConversation',company)) return {state:'refused'};
 if(!name||Array.from(name).length>100) return {state:'invalid'};
 const {titleConversation}=await import('@/lib/conversation-session-marks');
 const answer=await titleConversation(db,company,chat,name);
 if(answer==='marked') return {state:'done',title:name};
 return answer==='invalid'?{state:'invalid'}:{state:'refused'};
});
