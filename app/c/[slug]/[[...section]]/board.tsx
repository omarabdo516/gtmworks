'use client';
import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { BoardIcon } from '@/components/board-icon';
import { ShellIcon } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import { BoardPager } from '@/components/paperclip/KanbanBoard';
import { cardColumns, columnLabel, type CardColumn } from '@/lib/board-columns.mjs';
import { CardWindow } from '@/app/card-window';
import { useBoard, type BoardCard } from '@/app/board-read';
import { BoardCardTile } from '@/app/board-card';
import { ArchivedList, useArchive } from '@/app/board-archive';
import '@/app/board.css';
import type { MadeBoard } from './new-card';

// New card (#836), loaded only when it is opened, so the board's first load stays small.
const NewCard=lazy(()=>import('./new-card'));

// The board (spec #831, #834): the Company's Engine's own Kanban board in gtmworks's look (design-reference-card:
// renderBoard, kcardHTML), five columns and no Live (ADR 0033). The frame and the column heads are drawn at once, from
// nothing the Engine keeps; the Cards are read by the browser after, in a request of their own (ADR 0030).
//
// The last good read stays (app/board-read.ts): it is shown while the board reads again and kept when the Engine does not
// answer, which the board says in one line. The board follows the Engine live (#840).
//
// Waiting on you shows every waiting Card; the hand marks those that wait on the reader, and a Card given to them
// carries it in every column until it is done (#841, app/board-card.tsx).
//
// Archive (#842, app/board-archive.tsx): a Member who may write selects several Cards (select mode) or everything shown
// in Done and archives them, with Undo; the archive icon shows the archived Cards in place of the columns, with their
// search, and Restore.

export type { Board, BoardCard } from '@/app/board-read';
type Agent={id:string,name:string};

const emptyKey:Record<CardColumn,[string,string]>={waiting:['boardEmptyWaiting','boardEmptyWaitingHint'],ideas:['boardEmptyIdeas','boardEmptyIdeasHint'],planned:['boardEmptyPlanned','boardEmptyPlannedHint'],progress:['boardEmptyProgress','boardEmptyProgressHint'],done:['boardEmptyDone','']};

export default function Board({company,slug,writer,reviewer=false,creating=false}:{company:string,slug:string,writer:boolean,reviewer?:boolean,creating?:boolean}) {
 const {t}=useI18n();
 const read=useBoard(company);
 // New card is open (#836): at /work/new it opens with the page, and closing it leaves the board at its own address.
 const [making,setMaking]=useState(creating&&writer); const opener=useRef<HTMLButtonElement>(null); const [made,setMade]=useState<string|null>(null);
 const cards=read.board?.cards??null; const main=read.board?.main??null;
 const accept=(answer:{cards?:unknown,main?:Agent|null})=>{ if(Array.isArray(answer.cards)) read.accept({cards:answer.cards as BoardCard[],main:answer.main??null}); };
 // Archive (#842): select mode's chosen Cards, the archived list in place of the columns with its search, and how many
 // Cards are archived once the list has said. `version` reads the list again after a change.
 const [selected,setSelected]=useState<Set<string>|null>(null); const [focusTo,setFocusTo]=useState<'toggle'|'all'|'act'|null>(null);
 const selectToggle=useRef<HTMLButtonElement>(null); const selectAll=useRef<HTMLButtonElement>(null); const selectAct=useRef<HTMLButtonElement>(null);
 const [showArchived,setShowArchived]=useState(false); const [query,setQuery]=useState(''); const [searching,setSearching]=useState(false);
 const [archivedTotal,setArchivedTotal]=useState<number|null>(null); const [version,setVersion]=useState(0); const searchField=useRef<HTMLInputElement>(null);
 const archiving=useArchive({company,cards:cards??[],onBoard:accept,onChange:()=>setVersion(now=>now+1)});
 useEffect(()=>{ const to=focusTo==='toggle'?selectToggle:focusTo==='all'?selectAll:focusTo==='act'?selectAct:null; to?.current?.focus(); },[focusTo,selected]);
 useEffect(()=>{ if(searching) searchField.current?.focus(); },[searching]);
 const startSelecting=()=>{ archiving.clearLeft(); setSelected(new Set()); setFocusTo('all'); };
 const endSelecting=()=>{ setSelected(null); setFocusTo('toggle'); };
 const flip=(id:string)=>setSelected(now=>{ if(!now) return now; const next=new Set(now); if(next.has(id)) next.delete(id); else next.add(id); return next; });
 const archiveChosen=()=>{ if(!selected?.size) return; void archiving.archive([...selected],{done:()=>setSelected(null)}); };
 const toggleArchived=()=>{ setShowArchived(!showArchived); setQuery(''); setSearching(false); setSelected(null); archiving.clearLeft(); };
 const base=`/c/${slug}/work`;
 // A Card opens over the board at its own address (#835), which reloads, survives sign-in and is a link to share; opening
 // and closing it only change the address, so the board stays as it was read. A history entry it adds carries no state of
 // its own: Next.js's router takes one with its own state for its own navigation and would not follow the address.
 const opened=useSearchParams().get('card'); const open=opened&&/^[A-Za-z0-9_-]{1,64}$/.test(opened)?opened:null;
 const cardHref=(id:string)=>`${base}/board?card=${encodeURIComponent(id)}`;
 // Each Card opened from here is one step of the browser's history, so Back closes it; closing goes back over every step
 // the window took (a Card it waits for, opened from it), to the board as it was. A Card a link opened on load has no
 // step to go back over: closing it puts the board's own address in its place.
 const steps=useRef(0);
 useEffect(()=>{ const moved=()=>{ steps.current=new URLSearchParams(location.search).has('card')?Math.max(0,steps.current-1):0; };
  window.addEventListener('popstate',moved); return ()=>window.removeEventListener('popstate',moved); },[]);
 const showCard=(id:string)=>{ history.pushState(null,'',cardHref(id)); steps.current+=1; };
 const openCard=(event:MouseEvent<HTMLAnchorElement>,id:string)=>{ if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0) return; event.preventDefault(); showCard(id); };
 const closeCard=()=>{ const id=open;
  if(steps.current>0) { history.go(-steps.current); steps.current=0; } else history.replaceState(null,'',`${base}/board`);
  if(id) requestAnimationFrame(()=>document.querySelector<HTMLElement>(`#board-cols .kcard[data-card="${CSS.escape(id)}"] a`)?.focus()); };
 const columnName=(column:string)=>t(columnLabel(column,writer));
 const cardView=(card:BoardCard)=><BoardCardTile key={card.id} card={card} href={cardHref(card.id)} open={event=>openCard(event,card.id)} columnName={columnName} flash={made===card.id}
  selecting={selected?{chosen:selected.has(card.id),flip:()=>flip(card.id)}:null}/>;
 const views=<nav className="tabs segmented" aria-label={t('boardViews')}>{[['board',t('board')],['calendar',t('calendar')],['list',t('list')]].map(([path,name])=>
  <Link key={path} data-slot="button" data-active={path==='board'} aria-current={path==='board'?'page':undefined} className={`button ${path==='board'?'active':''}`} href={`${base}/${path}`}>{name}</Link>)}</nav>;
 return <div className="work-root"><div className="board-view">
  <header className="page-head"><div className="od-field"><h1 className="page-title">{t('marketingBoard')}</h1><p className="page-sub">{t('boardSubtitle')}</p></div><div className="work-toolbar" data-canonical-toolbar="work">{views}</div></header>
  <div className="board-tools">
   {!writer&&<span className="board-tools__summary" role="note"><BoardIcon name="eye"/>{t('boardReadOnly')}</span>}
   {showArchived&&(searching||query?<div className="bt-search is-open"><ShellIcon name="search"/><label className="sr-only" htmlFor="bf-q">{t('boardSearchArchived')}</label>
    <input ref={searchField} type="search" id="bf-q" autoComplete="off" dir="auto" placeholder={t('boardSearchArchived')} value={query} maxLength={200} onChange={event=>setQuery(event.target.value)}
     onBlur={()=>{ if(!query) setSearching(false); }} onKeyDown={event=>{ if(event.key==='Escape'&&!query) { event.preventDefault(); setSearching(false); } }}/></div>
    :<button type="button" className="ib" aria-label={t('boardSearchArchived')} title={t('boardSearchArchived')} onClick={()=>setSearching(true)}><ShellIcon name="search"/></button>)}
   <button type="button" className="ib" aria-pressed={showArchived} aria-label={archivedTotal==null?t('boardArchived'):t('boardArchivedCount',archivedTotal)} title={t('boardArchived')} onClick={toggleArchived}>
    <ShellIcon name="archive"/>{showArchived&&archivedTotal!=null&&<span className="num">{archivedTotal}</span>}</button>
   {writer&&!showArchived&&!selected&&<button ref={selectToggle} type="button" className="ib" aria-label={t('boardSelectCards')} title={t('boardSelectCards')} onClick={startSelecting}><ShellIcon name="multiSel"/></button>}
   <BoardPager/>
   {writer&&<button ref={opener} type="button" className="btn btn--primary btn--sm bt-new" aria-haspopup="dialog" onClick={()=>setMaking(true)}><ShellIcon name="plus"/><span className="bt-new__t">{t('newCard')}</span></button>}
  </div>
  {selected&&<div className="bsel" role="region" aria-label={t('boardSelecting')}>
   <span className="bsel__n" aria-live="polite">{t('boardSelectedCount','\u0000').split('\u0000')[0]}<b className="num">{selected.size}</b>{t('boardSelectedCount','\u0000').split('\u0000')[1]}</span>
   <button ref={selectAll} type="button" className="link-btn" onClick={()=>{ setSelected(new Set((cards??[]).map(card=>card.id))); setFocusTo('act'); }}>{t('boardSelectAllShown')}</button>
   <span className="od-fill"/>
   <button type="button" className="btn btn--secondary btn--sm" onClick={endSelecting}>{t('cancel')}</button>
   <button ref={selectAct} type="button" className="btn btn--primary btn--sm" disabled={!selected.size} onClick={archiveChosen}><ShellIcon name="archive"/><span>{t('boardArchiveSelected')}</span></button>
  </div>}
  {archiving.left}
  {!showArchived&&read.state==='reading'&&!cards&&<p role="status" className="board-status">{t('boardReading')}</p>}
  {!showArchived&&read.state==='failed'&&(cards?<p role="status" className="board-status">{t('boardRefreshFailed')}</p>:<p role="alert" className="work-error">{t('boardReadFailed')}</p>)}
  {showArchived&&<ArchivedList company={company} writer={writer} query={query} version={version} cardHref={cardHref} openCard={openCard} restore={ids=>void archiving.restore(ids)} total={setArchivedTotal}/>}
  {!showArchived&&cards&&!cards.length&&main&&<div className="board-bare" role="note"><span aria-hidden="true"><AgentFace agent={main.id} size={32}/></span><p>{t('boardEmpty',main.name)}</p>{writer&&<Link className="btn btn--secondary btn--sm" href={`/c/${slug}/chat`}><BoardIcon name="chat"/><span>{t('boardTalkTo',main.name)}</span></Link>}</div>}
  {!showArchived&&<div className="board board-cols" id="board-cols" aria-label={t('workBoard')} aria-busy={read.state==='reading'}>
   {cardColumns.map(column=>{
    const list=cards?.filter(card=>card.column===column)??[];
    const waiting=column==='waiting';
    return <section key={column} className={`col${waiting?' col--waiting':''}`} data-column={column} aria-labelledby={`col-${column}`}>
     <div className="col__head">{waiting&&<span className="dot dot--waiting" aria-hidden="true"/>}<h2 className="col__name" id={`col-${column}`}>{columnName(column)}</h2><span className="col__count num">{cards?list.length:''}</span>
      {column==='done'&&writer&&!selected&&list.length>0&&<button type="button" className="ib ib--sm col__act" aria-label={t('boardArchiveDone',columnName(column))} title={t('boardArchiveAll')} onClick={()=>void archiving.archive(list.map(card=>card.id))}><ShellIcon name="archive"/></button>}</div>
     <div className="col__body">{list.map(cardView)}{cards&&!list.length&&<div className="col-empty"><b>{t(emptyKey[column][0])}</b>{emptyKey[column][1]&&<span>{t(emptyKey[column][1])}</span>}</div>}</div>
    </section>;
   })}
  </div>}
  {open&&<CardWindow key={company} company={company} id={open} seen={cards?.find(card=>card.id===open)??null} writer={writer} reviewer={reviewer} cardHref={cardHref} fileHref={(card,file)=>`/c/${slug}/files/board/${encodeURIComponent(card)}/${encodeURIComponent(file)}`} showCard={showCard} onBoard={accept}
   archive={writer?(id,done)=>void archiving.archive([id],{done}):undefined} restore={writer?id=>archiving.restore([id]):undefined} onClose={closeCard}/>}
  {archiving.confirm}
 {making&&<Suspense fallback={null}><NewCard company={company} onMade={(answer:MadeBoard)=>{ if(answer.cards) read.accept({cards:answer.cards,main:answer.main??null}); setMade(answer.made); }}
  onClose={()=>{ setMaking(false); if(creating&&window.location.pathname.endsWith('/work/new')) window.history.replaceState(window.history.state,'',`${base}/board`); opener.current?.focus(); }}/></Suspense>}
 </div></div>;
}
