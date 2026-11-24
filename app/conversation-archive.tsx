'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ArchiveConfirm, type ArchiveStop } from '@/app/archive-confirm';
import { archiveConversations } from '@/app/conversation-archive-actions';
import type { ConversationStop } from '@/lib/all-conversations';
import { toast } from '@/app/toast';

// One Conversation a person archives or restores (#674): its id, the title it is shown by, and its Agent's face.
export type ArchivedChat={id:string,title:string,face:{connection_id:string,name:string}|null};
type Asking={chats:ArchivedChat[],stops:ConversationStop[]};

// Archiving and restoring the person's own Conversations from any place that lists them (All conversations, the
// sidebar, the chat's head; design-reference-card: cvArchive, cvRestore). Archiving first asks the database what it
// would stop and, only when something does, asks once naming each thing ("Archive and stop"); then "Archived" with Undo,
// which restores them. Restoring says "Restored". `changed` runs with the ids each time some changed, after the page's
// own server reads are asked again (the sidebar, the counts). `confirm` is the dialog to draw while it asks.
export function useConversationArchive(company:string,changed?:(ids:string[],archived:boolean)=>void) {
 const {t}=useI18n(); const router=useRouter();
 const [asking,setAsking]=useState<Asking|null>(null);
 const done=(ids:string[],archived:boolean)=>{ router.refresh(); changed?.(ids,archived); };
 const restore=async(chats:ArchivedChat[])=>{
  const result=await archiveConversations(company,'restore',chats.map(chat=>chat.id)).catch(()=>null);
  if(result?.state!=='done') { toast(t('conversationRestoreRefused'),{icon:'x'}); return; }
  done(result.chats,false);
  toast(result.chats.length>1?t('conversationsRestoredToast',result.chats.length):t('conversationRestoredToast'),{icon:'restore'});
 };
 const archiveNow=async(chats:ArchivedChat[])=>{
  const result=await archiveConversations(company,'archive',chats.map(chat=>chat.id)).catch(()=>null);
  if(result?.state!=='done') { toast(t('conversationArchiveRefused'),{icon:'x'}); return; }
  const archived=chats.filter(chat=>result.chats.includes(chat.id));
  done(result.chats,true);
  toast(result.chats.length>1?t('conversationsArchivedToast',result.chats.length):t('conversationArchivedToast'),{icon:'archive',action:{label:t('boardUndo'),run:()=>{ void restore(archived); }}});
 };
 const archive=async(chats:ArchivedChat[])=>{
  if(!chats.length) return;
  const result=await archiveConversations(company,'stops',chats.map(chat=>chat.id)).catch(()=>null);
  if(result?.state==='stops'&&result.stops.length) setAsking({chats,stops:result.stops}); else await archiveNow(chats);
 };
 let confirm=null;
 if(asking) {
  const titled=new Map(asking.chats.map(chat=>[chat.id,chat]));
  const faces=new Map(asking.stops.map(stop=>[stop.agent_id,titled.get(stop.conversation)?.face??null]));
  const stops=asking.stops.map((stop,index):ArchiveStop=>({card:index,title:titled.get(stop.conversation)?.title??'',kind:stop.kind,agent:stop.agent,agent_id:stop.agent_id}));
  const face=(agent:string|null)=>{ const found=faces.get(agent); return found?<CompanyAgentFace agent={found} size={24}/>:null; };
  confirm=<ArchiveConfirm stops={stops} cards={asking.chats.length} face={face}
   heading={asking.chats.length>1?t('conversationArchiveConfirmMany',asking.chats.length):t('conversationArchiveConfirmOne')}
   confirm={()=>{ const chosen=asking.chats; setAsking(null); void archiveNow(chosen); }} cancel={()=>setAsking(null)}/>;
 }
 return {archive,restore,confirm};
}
