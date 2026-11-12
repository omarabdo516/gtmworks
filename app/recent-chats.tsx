'use client';
import { useSyncExternalStore } from 'react';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { localeFor } from '@/lib/i18n.mjs';
import { groupRecents } from '@/lib/sidebar.mjs';

type Chat={id:string,title:string,created_at:string};
const subscribe=()=>()=>{};
const labels={today:'today',yesterday:'yesterday',earlier:'earlier'} as const;

// The person's own Conversations in this company, grouped by their local day (so the groups render after mount,
// in the browser's time zone, never the server's).
export default function RecentChats({slug,chats,current,lead}:{slug:string,chats:Chat[],current?:string,lead:string}) {
 const {t,language}=useI18n();
 const browser=useSyncExternalStore(subscribe,()=>true,()=>false);
 if(!chats.length) return <p className="sb-empty">{t('noChatsYet',lead)}</p>;
 if(!browser) return null;
 const now=new Date();
 const time=(value:string,day:string)=>new Date(value).toLocaleString(localeFor(language),day==='earlier'?{day:'numeric',month:'short'}:{hour:'2-digit',minute:'2-digit'});
 return <>{groupRecents(chats,now).map(group=><div key={group.day} className="thread-group">
  <h2 className="sb-label" id={`lbl-day-${group.day}`}>{t(labels[group.day])}</h2>
  <ul aria-labelledby={`lbl-day-${group.day}`}>{group.items.map(chat=><li key={chat.id}>
   <Link className="sb-item thread-item" href={`/c/${slug}/conversations/${chat.id}`} aria-current={chat.id===current?'true':undefined} title={chat.title}>
    <span className="od-truncate" dir="auto">{chat.title}</span><time className="thread-item__time" dateTime={chat.created_at}>{time(chat.created_at,group.day)}</time>
   </Link>
  </li>)}</ul>
 </div>)}</>;
}
