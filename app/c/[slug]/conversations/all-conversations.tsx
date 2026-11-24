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
import { useConversationArchive, type ArchivedChat } from '@/app/conversation-archive';
import type { ConversationCounts, ConversationPage, ConversationTab, ListedChat } from '@/lib/all-conversations';

const subscribe=()=>()=>{};
// A search asks the database once typing pauses.
const searchPause=250;

// design-reference-card: renderConvos. The toolbar's Current and Archived lists with their counts, the search behind its
// icon, and the rows, newest message first: the Agent's face (a # for a channel), the title, the newest message and its
// time. A page holds fifty rows; "Show more" adds the next fifty after them. The search asks the database, so it reads
// every title, not only the rows shown. A Conversation of the reader's own is archived from its row, or several at once
// by selecting them, with Undo, and restored from the Archived list (#674); a channel is archived from its details.
export default function AllConversations({slug,company,tab,counts,first}:{slug:string,company:string,tab:ConversationTab,counts:ConversationCounts|null,first:ConversationPage|null}) {
 const {t,language}=useI18n();
 const router=useRouter();
 const [page,setPage]=useState<ConversationPage|null>(first);
 const [query,setQuery]=useState('');
 // The query the rows shown answer ('' for the server's first page): "Show more" extends only a page of the query typed.
 const [shownFor,setShownFor]=useState('');
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
   if(ask===asked.current) { setPage(found); setShownFor(value); }
  },value.trim()?searchPause:0);
 };
 // The server's page read again (an archive or a restore from the sidebar or a chat's head refreshes it): the list
 // follows it, and a search shown is asked again, so a row that changed list elsewhere leaves this one.
 const [served,setServed]=useState(first);
 const [reread,setReread]=useState<{value:string}|null>(null);
 if(served!==first) { setServed(first); if(query.trim()) setReread({value:query}); else { setPage(first); setShownFor(query); } }
 useEffect(()=>{ if(!reread) return; const ask=++asked.current;
  void conversationListPage(company,tab,reread.value,null).catch(()=>null).then(found=>{ if(ask===asked.current) { setPage(found); setShownFor(reread.value); } });
 },[reread,company,tab]);
 const [selected,setSelected]=useState<Set<string>|null>(null);
 // Archived or restored rows leave this list at once; Undo, or a change from elsewhere, reads it again.
 const {archive,restore,confirm}=useConversationArchive(company,(ids,nowArchived)=>{
  setSelected(null);
  if(nowArchived!==archived) setPage(shown=>shown&&{...shown,items:shown.items.filter(item=>item.kind!=='conversation'||!ids.includes(item.id))});
  else search(query);
 });
 // The next page extends the page it was asked after, as it is now (a row archived meanwhile stays out of it); a page
 // replaced meanwhile (a new search, the server's page read again) is left as it is.
 const more=async()=>{
  const after=page?.next;
  if(!after||loading||shownFor!==query) return;
  const ask=asked.current; setLoading(true);
  const next=await conversationListPage(company,tab,query,after).catch(()=>null);
  setLoading(false);
  if(ask!==asked.current) return;
  if(!next) { toast(t('allConversationsFailed'),{icon:'x'}); return; }
  setPage(shown=>shown&&shown.next===after?{items:[...shown.items,...next.items],next:next.next}:shown);
 };
 const open=(to:ConversationTab)=>{ if(to!==tab) router.push(`/c/${slug}/conversations${to==='archived'?'?tab=archived':''}`); };
 const count=(value:number)=>new Intl.NumberFormat(localeFor(language)).format(value);
 const now=new Date();
 const time=(value:string)=>new Date(value).toLocaleString(localeFor(language),recentDay(value,now)==='earlier'?{day:'numeric',month:'short'}:{hour:'numeric',minute:'2-digit'});
 // A count that could not be read is left out, never shown as a zero.
 const segment=(key:ConversationTab,icon:'chat'|'archive',label:string,n:number|null)=>{ const on=key===tab;
  return <button type="button" aria-pressed={on} aria-label={n==null?label:`${label} ${count(n)}`} title={on?undefined:label} onClick={()=>open(key)}><ShellIcon name={icon}/>{on&&<span>{label}</span>}{n!=null&&<span className="num chip__n" aria-hidden="true">{count(n)}</span>}</button>; };
 const own=(chat:ListedChat)=>chat.kind==='conversation';
 const chatOf=(chat:ListedChat):ArchivedChat=>({id:chat.id,title:chat.title,face:chat.face});
 const act=(chats:ListedChat[])=>void (archived?restore:archive)(chats.map(chatOf));
 const toggle=(id:string)=>setSelected(chosen=>{ const next=new Set(chosen); if(next.has(id)) next.delete(id); else next.add(id); return next; });
 const row=(chat:ListedChat)=><li key={`${chat.kind}:${chat.id}`} className="cv-row">
  {selected&&(own(chat)
   ?<button type="button" className="sel-box" role="checkbox" aria-checked={selected.has(chat.id)} aria-label={t('allConversationsSelectOne',chat.title)} onClick={()=>toggle(chat.id)}><span>{selected.has(chat.id)&&<ShellIcon name="check"/>}</span></button>
   :<span className="sel-box" aria-hidden="true"/>)}
  <Link className="cv-open" href={`/c/${slug}/${chat.kind==='channel'?'channels':'conversations'}/${chat.id}`}>
   {chat.face?<span className="cv-face" aria-hidden="true" title={chat.face.name}><CompanyAgentFace agent={chat.face} size={28}/></span>:<span className="hp-hash" aria-hidden="true"><ShellIcon name="hash"/></span>}
   <span className="od-field"><span className="cv-t od-truncate">{chat.kind==='channel'?'#':''}<bdi>{chat.title}</bdi></span>{chat.line&&<span className="cv-d od-truncate"><bdi>{chat.line}</bdi></span>}</span>
   {browser&&<time className="cv-time num" dateTime={chat.at}>{time(chat.at)}</time>}
  </Link>
  {!selected&&own(chat)&&<button type="button" className="ib cv-act" aria-label={t(archived?'allConversationsRestoreOne':'allConversationsArchiveOne',chat.title)} title={t(archived?'allConversationsRestoreTip':'allConversationsArchiveTip')} onClick={()=>act([chat])}><ShellIcon name={archived?'restore':'archive'}/></button>}
 </li>;
 const items=page?.items||[];
 const wanted=query.trim();
 const choosable=items.filter(own);
 const chosen=choosable.filter(chat=>selected?.has(chat.id));
 return <div className="cvp">
  <h1 className="sr-only">{t('allConversations')}</h1>
  <div className="board-tools bt2 cv-tools">
   <div className="segmented cv-seg" role="group" aria-label={t('allConversationsLists')}>{segment('current','chat',t('allConversationsCurrent'),counts?.current??null)}{segment('archived','archive',t('allConversationsArchived'),counts?.archived??null)}</div>
   {searching||query?<div className="bt-search is-open"><ShellIcon name="search"/><label className="sr-only" htmlFor="cv-q">{t('allConversationsSearch')}</label>
    <input ref={field} type="search" id="cv-q" autoComplete="off" dir="auto" placeholder={t('allConversationsSearch')} value={query} maxLength={200} onChange={event=>search(event.target.value)} onBlur={()=>{ if(!query) setSearching(false); }}/></div>
    :<button type="button" className="ib" aria-label={t('allConversationsSearch')} title={t('allConversationsSearch')} onClick={()=>setSearching(true)}><ShellIcon name="search"/></button>}
   <span className="od-fill"/>
   {!selected&&choosable.length>0&&<button type="button" className="ib" aria-label={t('allConversationsSelect')} title={t('allConversationsSelect')} onClick={()=>setSelected(new Set())}><ShellIcon name="multiSel"/></button>}
  </div>
  {selected&&<div className="bsel cv-sel" role="region" aria-label={t('allConversationsSelecting')}>
   <span className="bsel__n" aria-live="polite"><b className="num">{count(chosen.length)}</b> {t('allConversationsSelected')}</span>
   <button type="button" className="link-btn" onClick={()=>setSelected(new Set(choosable.map(chat=>chat.id)))}>{t('allConversationsSelectAll')}</button><span className="od-fill"/>
   <button type="button" className="btn btn--secondary btn--sm" onClick={()=>setSelected(null)}>{t('cancel')}</button>
   <button type="button" className="btn btn--primary btn--sm" disabled={!chosen.length} onClick={()=>act(chosen)}><ShellIcon name={archived?'restore':'archive'}/><span>{t(archived?'allConversationsRestoreSelected':'allConversationsArchiveSelected')}</span></button>
  </div>}
  <div className="cv-body">
   {!page?<p className="col-empty arch-empty" role="alert"><b>{t('allConversationsFailed')}</b></p>
    :items.length?<ul className="panel-card cv-list" aria-label={t(archived?'allConversationsArchived':'allConversationsCurrent')}>{items.map(row)}</ul>
    :<div className="col-empty arch-empty"><b>{wanted?t('allConversationsNoMatch',wanted):t(archived?'allConversationsArchivedEmpty':'allConversationsEmpty')}</b></div>}
   {page?.next&&<button type="button" className="btn btn--secondary btn--sm cv-more" aria-busy={loading||undefined} disabled={loading||shownFor!==query} onClick={more}>{t('allConversationsMore')}</button>}
  </div>
  {confirm}
 </div>;
}
