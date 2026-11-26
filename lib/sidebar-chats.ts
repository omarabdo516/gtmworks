import type { supabase } from './supabase';
import { conversationTitle } from './conversation-title.mjs';

type Db=Awaited<ReturnType<typeof supabase>>;
type ChatRow={id:string,agent_id:string|null,agent_name:string,last_message_at:string,good_morning_day:string|null,conversation_messages:{body:string,conversation_attachments:{name:string}[]}[],conversation_queued_turns:{message:string}[],waiting_files:{name:string}[]};
// One of the sidebar's recent chats: its address, its newest message's time, its title and the Agent it is with.
export type SidebarChat={id:string,at:string,title:string,agent?:string};

// The sidebar's recent chats, read as the reader, or null when the read failed (#776): the sidebar keeps the list it shows.
// Each listed chat with its own first message (a limit per chat), so a long chat never crowds another out of the titles.
// The twenty current ones with the newest messages (#673); All conversations holds the rest, and the archived (#674).
// A chat whose first message still waits for its Run (#764) is named by that waiting turn and the files sent with it.
// The Shell draws them (app/shell.tsx), and its poll reads them again (app/api/sidebar), since the Shell is drawn once
// by the Company's layout and a page move draws it no more (#789).
export function recentChats(db:Db,company:string) {
 return db.from('conversations').select('id,agent_id,agent_name,last_message_at,good_morning_day,conversation_messages(body,conversation_attachments(name)),conversation_queued_turns(message),waiting_files:conversation_attachments(name)').eq('company_id',company).is('archived_at',null).eq('conversation_messages.author','person')
  .is('waiting_files.message_id',null)
  .order('last_message_at',{ascending:false}).order('id',{ascending:false}).order('id',{referencedTable:'conversation_messages'}).limit(1,{referencedTable:'conversation_messages'})
  .order('queued_at',{referencedTable:'conversation_queued_turns'}).limit(1,{referencedTable:'conversation_queued_turns'}).order('position',{referencedTable:'waiting_files'}).limit(1,{referencedTable:'waiting_files'}).limit(20)
  .then(({data,error})=>error?null:(data||[]) as ChatRow[]);
}

// A chat is named as everywhere else (lib/conversation-title.mjs).
export const chatsOf=(rows:ChatRow[],t:(key:string,...values:unknown[])=>string,language:string):SidebarChat[]=>rows.map(c=>{
 const first=c.conversation_messages[0]; const waiting=first?undefined:c.conversation_queued_turns?.[0];
 return {id:c.id,at:c.last_message_at,agent:c.agent_id??undefined,
  title:conversationTitle({morningDay:c.good_morning_day,body:first?first.body:waiting?.message,file:first?first.conversation_attachments?.[0]?.name:waiting&&c.waiting_files?.[0]?.name,agent:c.agent_name},t,language)};
});
