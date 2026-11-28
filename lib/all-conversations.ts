import 'server-only';
import type { supabase } from './supabase';
import { personConversations, type PersonConversation } from './conversation-list';
import { searchFold } from './arabic-search.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;
type Translate=(key:string,...values:unknown[])=>string;

// All conversations (#673): the reader's own Conversations and the channels they are in, newest activity first. `tab`
// is which list: `current`, or `archived` (#674).
export type ConversationTab='current'|'archived';
export type ListedChat={kind:'conversation'|'channel',id:string,title:string,line:string,at:string,face:{id:string,name:string}|null};
export type ConversationCursor={at:string,id:string};
export type ConversationPage={items:ListedChat[],next:ConversationCursor|null};
export type ConversationCounts={current:number,archived:number};
const conversationPageSize=50;

type ChannelRow={id:string,kind:string,name:string|null,last_at:string,last_body:string|null};
const oneLine=(text:string|null|undefined)=>(text||'').replace(/\s+/g,' ').trim();

// The channels the reader is in, current or archived, with their newest message (channel_list); null when unread.
// Channels keep their own record (ADR 0033 item 3).
async function channelsOf(db:Database,company:string,archived:boolean,general:string):Promise<ListedChat[]|null> {
 const {data,error}=await db.rpc('channel_list',{c:company,archived});
 if(error) return null;
 return ((data||[]) as ChannelRow[]).map(row=>({kind:'channel',id:row.id,title:row.kind==='team'&&row.name?row.name:general,line:oneLine(row.last_body),at:new Date(row.last_at).toISOString(),face:null}));
}
const listedOf=(chat:PersonConversation):ListedChat=>({kind:'conversation',id:chat.id,title:chat.title,line:oneLine(chat.line),at:chat.at,face:{id:chat.agent,name:chat.agentName}});
const newestFirst=(a:ListedChat,b:ListedChat)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id);

// The whole of one list: the person's Conversations from their rows and their sessions in the Engine
// (lib/conversation-list.ts) and their channels, narrowed by a search of titles and previews in the reader's own
// folding (lib/arabic-search.mjs). Null when either could not be read.
async function listOf(db:Database,company:string,tab:ConversationTab,q:string,t:Translate,language:string):Promise<ListedChat[]|null> {
 const archived=tab==='archived';
 const [conversations,channels]=await Promise.all([personConversations(db,company,t,language).catch(()=>null),channelsOf(db,company,archived,t('shellGeneralChannel'))]);
 if(!conversations||!channels) return null;
 const wanted=searchFold(q);
 const found=(chat:ListedChat)=>!wanted||searchFold(chat.title).includes(wanted)||chat.kind==='conversation'&&searchFold(chat.line).includes(wanted);
 return [...conversations.filter(chat=>chat.archived===archived).map(listedOf),...channels].filter(found).sort(newestFirst);
}

// One page of fifty, the next after `after`. A failed read is null.
export async function conversationPage(db:Database,company:string,{tab='current',q='',after=null}:{tab?:ConversationTab,q?:string,after?:ConversationCursor|null},t:Translate,language:string):Promise<ConversationPage|null> {
 const list=await listOf(db,company,tab,q,t,language);
 if(!list) return null;
 const from=after?list.findIndex(chat=>newestFirst(chat,{kind:'channel',id:after.id,at:after.at,title:'',line:'',face:null})>0):0;
 const rest=from<0?[]:list.slice(from);
 const items=rest.slice(0,conversationPageSize); const last=items.at(-1);
 return {items,next:rest.length>conversationPageSize&&last?{at:last.at,id:last.id}:null};
}

// The two lists' counts, or null when they could not be read: the toolbar then shows none rather than a zero.
export async function conversationCounts(db:Database,company:string,t:Translate,language:string):Promise<ConversationCounts|null> {
 const general=t('shellGeneralChannel');
 const [conversations,current,archived]=await Promise.all([personConversations(db,company,t,language).catch(()=>null),channelsOf(db,company,false,general),channelsOf(db,company,true,general)]);
 if(!conversations||!current||!archived) return null;
 const shelved=conversations.filter(chat=>chat.archived).length;
 return {current:conversations.length-shelved+current.length,archived:shelved+archived.length};
}
