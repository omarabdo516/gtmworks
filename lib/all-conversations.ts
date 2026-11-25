import type { supabase } from './supabase';
import { conversationTitle } from './conversation-title.mjs';

type Database=Awaited<ReturnType<typeof supabase>>;
type Translate=(key:string,...values:unknown[])=>string;

// All conversations (#673): the reader's own Conversations and the channels they are in, newest message first. `tab`
// is which list: `current`, or `archived` (#674).
export type ConversationTab='current'|'archived';
export type ListedChat={kind:'conversation'|'channel',id:string,title:string,line:string,at:string,face:{id:string,name:string}|null};
export type ConversationCursor={at:string,id:string};
export type ConversationPage={items:ListedChat[],next:ConversationCursor|null};
export type ConversationCounts={current:number,archived:number};
const conversationPageSize=50;

type Row={kind:'conversation'|'channel',id:string,agent_id:string|null,agent_name:string|null,title:string|null,good_morning_day:string|null,channel_kind:string|null,last_at:string,last_body:string|null};

// One page, read by conversation_list as the signed-in person: the database decides what is theirs and does the title
// search (search_fold, as lib/arabic-search.mjs reads it), so a search reads every title, not only the rows shown. A
// morning's Conversation (#183) and the general channel are named in the reader's language, here and in the search.
// A failed read is null.
export async function conversationPage(db:Database,company:string,{tab='current',q='',after=null}:{tab?:ConversationTab,q?:string,after?:ConversationCursor|null},t:Translate,language:string):Promise<ConversationPage|null> {
 const general=t('shellGeneralChannel');
 const {data,error}=await db.rpc('conversation_list',{c:company,q:q.trim()||null,archived:tab==='archived',after_at:after?.at??null,after_id:after?.id??null,
  lim:conversationPageSize+1,morning:t('goodMorningTitle',''),general});
 if(error) return null;
 const rows=(data||[]) as Row[];
 const shown=rows.slice(0,conversationPageSize);
 const items=shown.map((row):ListedChat=>({kind:row.kind,id:row.id,at:row.last_at,line:(row.last_body||'').replace(/\s+/g,' ').trim(),
  title:row.kind==='channel'?(row.channel_kind==='team'&&row.title?row.title:general):conversationTitle({morningDay:row.good_morning_day,body:row.title,agent:row.agent_name||''},t,language),
  face:row.kind==='conversation'?{id:row.agent_id||'',name:row.agent_name||''}:null}));
 const last=shown.at(-1);
 return {items,next:rows.length>conversationPageSize&&last?{at:last.last_at,id:last.id}:null};
}

// The two lists' counts, or null when they could not be read: the toolbar then shows none rather than a zero.
export async function conversationCounts(db:Database,company:string):Promise<ConversationCounts|null> {
 const {data,error}=await db.rpc('conversation_counts',{c:company});
 if(error||!data) return null;
 const counts=data as Partial<ConversationCounts>;
 return {current:counts.current??0,archived:counts.archived??0};
}
