'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { recentDay } from '@/lib/sidebar.mjs';
import { ShellIcon } from '@/components/shell-icon';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { conversationListPage } from '@/app/all-conversations-actions';
import { toast } from '@/app/toast';
import type { ConversationCounts, ConversationPage, ConversationTab, ListedChat } from '@/lib/all-conversations';

const subscribe=()=>()=>{};
// A search asks the database once typing pauses.
const searchPause=250;

// design-reference-card: renderConvos. The toolbar's Current and Archived lists with their counts, the search behind its
// icon, and the rows, newest message first: the Agent's face (a # for a channel), the title, the newest message and its
// time. A page holds fifty rows; "Show more" adds the next fifty after them. The search asks the database, so it reads
// every title, not only the rows shown.
export default function AllConversations({slug,company,tab,counts,first}:{slug:string,company:string,tab:ConversationTab,counts:ConversationCounts,first:ConversationPage|null}) {
 const {t,language}=useI18n();
 const router=useRouter();
 const [page,setPage]=useState<ConversationPage|null>(first);
 const [query,setQuery]=useState('');
 const [searching,setSearching]=useState(false);
 const [loading,setLoading]=useState(false);
 const asked=useRef(0);
 const field=useRef<HTMLInputElement>(null);
 const browser=useSyncExternalStore(subscribe,()=>true,()=>false);
 const archived=tab==='archived';
 useEffect(()=>{ if(searching) field.current?.focus(); },[searching]);
 // Each search answers only while it is the newest one asked.
 const search=(value:string)=>{
  setQuery(value);
  const ask=++asked.current;
  window.setTimeout(async()=>{
   if(ask!==asked.current) return;
   const found=await conversationListPage(company,tab,value,null).catch(()=>null);
   if(ask===asked.current) setPage(found);
  },value.trim()?searchPause:0);
 };
 const more=async()=>{
  if(!page?.next||loading) return;
  const ask=asked.current; setLoading(true);
  const next=await conversationListPage(company,tab,query,page.next).catch(()=>null);
  setLoading(false);
  if(ask!==asked.current) return;
  if(!next) { toast(t('allConversationsFailed'),{icon:'x'}); return; }
  setPage({items:[...page.items,...next.items],next:next.next});
 };
 const open=(to:ConversationTab)=>{ if(to!==tab) router.push(`/c/${slug}/conversations${to==='archived'?'?tab=archived':''}`); };
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 const now=new Date();
 const time=(value:string)=>new Date(value).toLocaleString(localeFor(language),recentDay(value,now)==='earlier'?{day:'numeric',month:'short'}:{hour:'numeric',minute:'2-digit'});
 const segment=(key:ConversationTab,icon:'chat'|'archive',label:string,n:number)=>{ const on=key===tab;
  return <button type="button" aria-pressed={on} aria-label={`${label} ${count(n)}`} title={on?undefined:label} onClick={()=>open(key)}><ShellIcon name={icon}/>{on&&<span>{label}</span>}<span className="num chip__n" aria-hidden="true">{count(n)}</span></button>; };
 const row=(chat:ListedChat)=><li key={`${chat.kind}:${chat.id}`} className="cv-row">
  <Link className="cv-open" href={`/c/${slug}/${chat.kind==='channel'?'channels':'conversations'}/${chat.id}`}>
   {chat.face?<span className="cv-face" aria-hidden="true" title={chat.face.name}><CompanyAgentFace agent={chat.face} size={28}/></span>:<span className="hp-hash" aria-hidden="true"><ShellIcon name="hash"/></span>}
   <span className="od-field"><span className="cv-t od-truncate">{chat.kind==='channel'?'#':''}<bdi>{chat.title}</bdi></span>{chat.line&&<span className="cv-d od-truncate"><bdi>{chat.line}</bdi></span>}</span>
   {browser&&<time className="cv-time num" dateTime={chat.at}>{time(chat.at)}</time>}
  </Link>
 </li>;
 const items=page?.items||[];
 const wanted=query.trim();
 return <div className="cvp">
  <h1 className="sr-only">{t('allConversations')}</h1>
  <div className="board-tools bt2 cv-tools">
   <div className="segmented cv-seg" role="group" aria-label={t('allConversationsLists')}>{segment('current','chat',t('allConversationsCurrent'),counts.current)}{segment('archived','archive',t('allConversationsArchived'),counts.archived)}</div>
   {searching||query?<div className="bt-search is-open"><ShellIcon name="search"/><label className="sr-only" htmlFor="cv-q">{t('allConversationsSearch')}</label>
    <input ref={field} type="search" id="cv-q" autoComplete="off" dir="auto" placeholder={t('allConversationsSearch')} value={query} maxLength={200} onChange={event=>search(event.target.value)} onBlur={()=>{ if(!query) setSearching(false); }}/></div>
    :<button type="button" className="ib" aria-label={t('allConversationsSearch')} title={t('allConversationsSearch')} onClick={()=>setSearching(true)}><ShellIcon name="search"/></button>}
   <span className="od-fill"/>
  </div>
  <div className="cv-body">
   {!page?<p className="col-empty arch-empty" role="alert"><b>{t('allConversationsFailed')}</b></p>
    :items.length?<ul className="panel-card cv-list" aria-label={t(archived?'allConversationsArchived':'allConversationsCurrent')}>{items.map(row)}</ul>
    :<div className="col-empty arch-empty"><b>{wanted?t('allConversationsNoMatch',wanted):t(archived?'allConversationsArchivedEmpty':'allConversationsEmpty')}</b></div>}
   {page?.next&&<button type="button" className="btn btn--secondary btn--sm cv-more" aria-busy={loading||undefined} disabled={loading} onClick={more}>{t('allConversationsMore')}</button>}
  </div>
 </div>;
}
