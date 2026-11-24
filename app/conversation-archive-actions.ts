'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { archiveIntents, type ArchiveAnswer, type ArchiveIntent, type ArchiveStopKind } from '@/lib/archive-stops';

// What archiving would stop in these Conversations (#674), or archiving or restoring them: each the signed-in person's
// own, which archive_conversations and restore_conversations decide in the database. `stops` answers what the one
// confirmation names (each line `about` its Conversation, which the asking page titles); the others answer the
// Conversations they changed, or refused when none changed. The page that asked reads itself again
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
 const {data,error}=intent==='restore'?await db.rpc('restore_conversations',{c:company,chats:ids}):await db.rpc('archive_conversations',{c:company,chats:ids});
 if(error) { logActionFailure('archiveConversations',error); return {state:'refused'}; }
 const done=((data||[]) as string[]).map(String);
 return done.length?{state:'done',done}:{state:'refused'};
});
