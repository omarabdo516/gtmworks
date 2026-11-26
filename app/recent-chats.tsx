'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { useShellPlace } from './shell-place';
import { useSidebarChats, useSidebarRefresh } from './sidebar-live';
import { localeFor } from '@/lib/i18n.mjs';
import { groupRecents, matchChats } from '@/lib/sidebar.mjs';
import { useSidebarQuery } from './sidebar-search';
import { MoreMenu } from './more-menu';
import { useConversationArchive } from './conversation-archive';

type Chat={id:string,title:string,at:string};
const subscribe=()=>()=>{};
const labels={today:'today',yesterday:'yesterday',earlier:'earlier'} as const;

// The person's own Conversations in this company, by their newest message (#673), grouped by its local day (so the groups render after mount,
// in the browser's time zone, never the server's), narrowed by the sidebar's search. Each row's menu archives it (#674;
// design-reference-card: .thread-row, .thread-more); an archived one leaves the list, which holds current ones only.
// A page whose read of them failed passes null (#776): the list shown last for this Company in this tab stays. The Shell is
// drawn again by a refresh, so the list is kept here, outside its components, and in the browser only: the server
// never draws a list from shared state, which could be another reader's. Keyed by the reader and the Company: another
// account signed in from another tab never gets this reader's list.
const shownLast=new Map<string,Chat[]>();
const inBrowser=typeof window!=='undefined';
export default function RecentChats({slug,company,person,chats:drawnChats,current:drawn,lead}:{slug:string,company:string,person:string,chats:Chat[]|null,current?:string,lead:string}) {
 const place=useShellPlace(); const current=drawn??place.conversation;
 // The Shell's list until the sidebar's poll has read them again (#789: a page move does not draw the Shell again).
 const polled=useSidebarChats(); const read=polled!==undefined?polled:drawnChats;
 // A Conversation opened that the list does not hold (one just started, an older one) asks the poll at once, so a new
 // chat joins the list as the page opens on it.
 const refresh=useSidebarRefresh(); const missing=!!current&&!!read&&!read.some(chat=>chat.id===current);
 const asked=useRef<string|null>(null);
 useEffect(()=>{ if(!missing||!current||asked.current===current) return; asked.current=current; refresh?.(); },[missing,current,refresh]);
 const {t,language}=useI18n();
 const shownKey=`${person}:${company}`;
 if(read&&inBrowser) shownLast.set(shownKey,read);
 const chats=read??(inBrowser?shownLast.get(shownKey):undefined)??null;
 const {archive,confirm}=useConversationArchive(company);
 const query=useSidebarQuery();
 const browser=useSyncExternalStore(subscribe,()=>true,()=>false);
 if(!chats) return <p className="sb-empty">{t('sidebarNotRead')}</p>;
 const shown=matchChats(chats,query);
 if(!chats.length) return <p className="sb-empty">{t('noChatsYet',lead)}</p>;
 if(!shown.length) return <p className="sb-empty">{t('shellNoChatsMatch',query.trim())}</p>;
 if(!browser) return confirm;
 const now=new Date();
 // As the reference writes it: "9:00 ص" today and yesterday, the day and month before that.
 const time=(value:string,day:string)=>new Date(value).toLocaleString(localeFor(language),day==='earlier'?{day:'numeric',month:'short'}:{hour:'numeric',minute:'2-digit'});
 return <>{groupRecents(shown,now).map(group=><div key={group.day} className="thread-group">
  <h2 className="sb-label" id={`lbl-day-${group.day}`}>{t(labels[group.day])}</h2>
  <ul aria-labelledby={`lbl-day-${group.day}`}>{group.items.map(chat=><li key={chat.id} className="thread-row">
   <Link className="sb-item thread-item" href={`/c/${slug}/conversations/${chat.id}`} aria-current={chat.id===current?'true':undefined} title={chat.title}>
    <span className="od-truncate" dir="auto">{chat.title}</span><time className="thread-item__time" dateTime={chat.at}>{time(chat.at,group.day)}</time>
   </Link>
   <MoreMenu label={t('conversationMoreOf',chat.title)} look="thread-more" className="more-menu thread-menu"
    items={[{key:'archive',icon:'archive',label:t('conversationArchive'),run:()=>void archive([{id:chat.id,title:chat.title}])}]}/>
  </li>)}</ul>
 </div>)}{confirm}</>;
}
