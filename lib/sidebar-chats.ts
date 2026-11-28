import 'server-only';
import type { supabase } from './supabase';
import { getI18n } from './i18n-server';
import { personConversations } from './conversation-list';

type Db=Awaited<ReturnType<typeof supabase>>;
// One of the sidebar's recent chats: its address, its newest activity, its title and the Agent it is with.
export type SidebarChat={id:string,at:string,title:string,agent?:string};

// The sidebar's recent chats (#881): the twenty current Conversations of the reader with the newest activity, from their
// rows joined with their Agents' sessions in the Engine (lib/conversation-list.ts), each by its session's title or, with
// none yet, its first words. All conversations holds the rest, and the archived. Null when the read failed (#776): the
// sidebar keeps the list it shows. The Shell draws them (app/shell.tsx), and its poll reads them again (app/api/sidebar),
// since the Shell is drawn once by the Company's layout and a page move draws it no more (#789).
export async function recentChats(db:Db,company:string):Promise<SidebarChat[]|null> {
 const {t,language}=await getI18n();
 const all=await personConversations(db,company,t,language).catch(()=>null);
 return all&&all.filter(chat=>!chat.archived).slice(0,20).map(chat=>({id:chat.id,at:chat.at,title:chat.title,agent:chat.agent}));
}
