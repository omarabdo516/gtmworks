'use server';
import { withActionLog } from '@/lib/diagnostics.mjs';
import { supabase } from '@/lib/supabase';
import { getI18n } from '@/lib/i18n-server';
import { actionAllowed } from '@/lib/route-permissions.mjs';
import { conversationPage, type ConversationCursor, type ConversationPage, type ConversationTab } from '@/lib/all-conversations';

// A page of All conversations (#673): the next one after `after`, or the first of a search. Any Member reads their own;
// conversation_list keeps it to them in the database. A failed read is null.
export const conversationListPage=withActionLog('conversationListPage',async function conversationListPage(company:string,tab:ConversationTab,q:string,after:ConversationCursor|null):Promise<ConversationPage|null> {
 const db=await supabase();
 if(!await actionAllowed(db,'conversationListPage',company)) return null;
 const {t,language}=await getI18n();
 const cursor=after&&typeof after.at==='string'&&typeof after.id==='string'?{at:after.at,id:after.id}:null;
 return conversationPage(db,company,{tab:tab==='archived'?'archived':'current',q:String(q||'').slice(0,200),after:cursor},t,language);
});

