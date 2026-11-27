'use client';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { BoardIcon } from '@/components/board-icon';
import { ShellIcon, type ShellIconName } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import { BoardPager, KanbanBoard, KanbanCard, KanbanColumn } from '@/components/paperclip/KanbanBoard';
import { cardColumns, columnLabel, moveTarget, statusOfColumn, type CardColumn, type CardSymbol } from '@/lib/board-columns.mjs';
import { CardWindow } from '@/app/card-window';
import { followBoard } from '@/app/board-live';
import { ArchivedList, useArchive } from '@/app/board-archive';
import { BoardFilters, everything, shown, type BoardFilter } from '@/app/board-filters';
import { moveCard } from '@/app/card-move';
import { toast } from '@/app/toast';
import '@/app/board.css';
import type { MadeBoard } from './new-card';

// New card (#836), loaded only when it is opened, so the board's first load stays small.
const NewCard=lazy(()=>import('./new-card'));

// The board (spec #831, #834): the Company's Engine's own Kanban board in gtmworks's look (design-reference-card:
// renderBoard, kcardHTML), five columns and no Live (ADR 0033). The frame and the column heads are drawn at once, from
// nothing the Engine keeps; the Cards are read by the browser after, in a request of their own (ADR 0030).
//
// The last good read stays: it is shown while the board reads again and kept when the Engine does not answer, which the
// board says in one line. It lives in this browser's memory only, never in storage, and never in a table.
//
// The board follows the Engine live (#840): a change the Engine reports, through gtmworks's own web server
// (app/board-live.ts), reads the board again at once. While the stream is down the board reads again on a slow timer.
//
// Archive (#842, app/board-archive.tsx): a Member who may write selects several Cards (select mode) or everything shown
// in Done and archives them, with Undo; the archive icon shows the archived Cards in place of the columns, with their
// search, and Restore.
//
// A Member who may write moves a Card (#837; design-reference-card: boardMove, dragEnd, the Shift and arrow keys): carried
// with the mouse or a finger, or Shift with Left or Right, into Ideas, Planned or Done, each the status the Engine is asked
// for (lib/board-columns.mjs statusOfColumn), told with Undo. In progress and Waiting on you are the work's own: a Card
// carried over them shows the column refused and says why, and one dropped there stays where it was. The board filters
// by Assignee and by Project (app/board-filters.tsx); a Card made while a Project is chosen is made in it, and select
// mode and "Archive everything in Done" take the Cards the filters show.

export type BoardCard={id:string,title:string,column:CardColumn,symbol:CardSymbol|null,agent:{id:string,name:string}|null,person?:{id:string,name:string}|null,comments:number,project?:string|null,publishOn?:string|null};
type Agent={id:string,name:string};
export type Board={cards:BoardCard[],main:Agent|null};
type Read={board:Board|null,state:'reading'|'read'|'failed'};

const kept=new Map<string,Board>();
// A read that failed is asked again after a pause, longer each time; a good one is read again when the board's live
// stream reports a change, when the window comes back to the board, and on a slow timer while the stream is down. A
// change reported while a read is on its way reads again once that read has answered.
const againAfter=[3000,10000,30000];
const slowRead=30000;

// `accept` takes the board a write answered with (#836): it is a read like any other. The list and the calendar read
// the same board through it (#845), and share its last good read.
export function useBoard(company:string):Read&{accept:(board:Board)=>void} {
 const [read,setRead]=useState<Read>(()=>({board:kept.get(company)??null,state:'reading'}));
 const accept=useCallback((board:Board)=>{ kept.set(company,board); setRead({board,state:'read'}); },[company]);
 useEffect(()=>{
  let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined; let tries=0; let asking=false; let stale=false; let live=false;
  const controller=new AbortController();
  const next=(after:number)=>{ clearTimeout(timer); timer=setTimeout(ask,after); };
  function ask() {
   if(stopped) return;
   if(asking) { stale=true; return; }
   asking=true; stale=false;
   void fetch(`/api/board?company=${encodeURIComponent(company)}`,{cache:'no-store',signal:controller.signal})
    // The answer is read whole either way, so a refused read leaves no response open behind it.
    .then(async response=>{ const body=await response.json().catch(()=>null) as {cards?:unknown,main?:Agent|null}|null; return response.ok?body:null; },()=>null)
    .then(body=>{
     asking=false;
     if(stopped) return;
     if(body&&Array.isArray(body.cards)) {
      const board={cards:body.cards as BoardCard[],main:body.main??null}; kept.set(company,board); tries=0; setRead({board,state:'read'});
      if(stale) ask(); else if(live) clearTimeout(timer); else next(slowRead);
      return;
     }
     setRead({board:kept.get(company)??null,state:'failed'});
     next(againAfter[Math.min(tries++,againAfter.length-1)]);
    });
  }
  const back=()=>{ if(document.visibilityState==='visible') ask(); };
  ask();
  const unfollow=followBoard(company,{changed:()=>ask(),live:on=>{ live=on; if(!on&&!asking&&!tries) next(slowRead); }});
  window.addEventListener('focus',ask); document.addEventListener('visibilitychange',back);
  return ()=>{ stopped=true; clearTimeout(timer); controller.abort(); unfollow(); window.removeEventListener('focus',ask); document.removeEventListener('visibilitychange',back); };
 },[company]);
 return {...read,accept};
}

// One shape, one colour and one name for each state (design-reference-card: SYMS); the name is the tooltip and what
// assistive technology reads.
const symbols:{[kind in CardSymbol['kind']]:{icon?:ShellIconName,tone:'ok'|'wait'|'bad'|'mute'}}={
 working:{tone:'ok'},question:{icon:'ask',tone:'wait'},review:{icon:'needsReview',tone:'wait'},failed:{icon:'alert',tone:'bad'},stopped:{icon:'stop',tone:'mute'},waits:{icon:'hourglass',tone:'mute'},
 // A review's outcome, which only the Card's own read knows (#839): no board Card carries one.
 sentBack:{icon:'sendBack',tone:'mute'},passed:{icon:'passed',tone:'ok'},
};
const symbolKey={working:'symWorking',question:'symQuestion',review:'symReview',failed:'symFailed',stopped:'symStopped',waits:'symWaits',sentBack:'symSentBack',passed:'symPassed'} as const;
const emptyKey:Record<CardColumn,[string,string]>={waiting:['boardEmptyWaiting','boardEmptyWaitingHint'],ideas:['boardEmptyIdeas','boardEmptyIdeasHint'],planned:['boardEmptyPlanned','boardEmptyPlannedHint'],progress:['boardEmptyProgress','boardEmptyProgressHint'],done:['boardEmptyDone','']};

export default function Board({company,slug,writer,reviewer=false,me='',creating=false}:{company:string,slug:string,writer:boolean,reviewer?:boolean,me?:string,creating?:boolean}) {
 const {t,language}=useI18n();
 const read=useBoard(company);
 const [filter,setFilter]=useState<BoardFilter>(everything);
 // New card is open (#836): at /work/new it opens with the page, and closing it leaves the board at its own address.
 const [making,setMaking]=useState(creating&&writer); const opener=useRef<HTMLButtonElement>(null); const [made,setMade]=useState<string|null>(null);
 const cards=read.board?.cards??null; const main=read.board?.main??null;
 const filtered=filter.who!=='all'||filter.project!=='all';
 const drawn=(cards??[]).filter(card=>shown(card,filter,me));
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
 const symbolName=(symbol:CardSymbol)=>symbol.kind==='waits'&&symbol.count>1?t('symWaitsN',symbol.count):t(symbolKey[symbol.kind]);
 // A move the board makes (#837): one the Engine is not asked for (In progress, Waiting on you) says why at once; any
 // other is the Engine's to take, and the keyboard stays on the Card where it is drawn after.
 const moving=useRef(false);
 const move=async(id:string,to:string):Promise<boolean>=>{
  const card=cards?.find(found=>found.id===id); if(!card||!writer||selected||moving.current||card.column===to) return false;
  if(!statusOfColumn(to,false)) { toast(t(to==='progress'?'cardMoveProgress':'cardMoveWaiting'),{icon:to==='progress'?'play':'clock'}); return false; }
  moving.current=true;
  try { return await moveCard({company,card:id,from:card.column,to,t,columnName,onBoard:accept}); }
  finally { moving.current=false; requestAnimationFrame(()=>document.querySelector<HTMLElement>(`#board-cols .kcard[data-card="${CSS.escape(id)}"] a`)?.focus({preventScroll:true})); }
 };
 const keys=(card:BoardCard)=>(event:KeyboardEvent<HTMLAnchorElement>)=>{
  if(!event.shiftKey||!writer||(event.key!=='ArrowLeft'&&event.key!=='ArrowRight'&&event.key!=='ArrowUp'&&event.key!=='ArrowDown')) return;
  event.preventDefault();
  const to=moveTarget(card.column,event.key,language==='ar'); if(to) void move(card.id,to);
 };
 const cardView=(card:BoardCard,isOverlay=false)=>{
  const chosen=!!selected?.has(card.id);
  const who=card.agent?.name||card.person?.name||t('boardCardNoOne');
  const comments=card.comments===1?t('boardCardComment'):t('boardCardComments',card.comments);
  const label=[card.title,columnName(card.column),card.symbol?symbolName(card.symbol):'',t('boardCardAssignee',who),card.comments?comments:''].filter(Boolean).join(' · ');
  const symbol=card.symbol&&symbols[card.symbol.kind];
  return <KanbanCard key={card.id} id={card.id} column={card.column} isOverlay={isOverlay} disabled={!writer||!!selected} blocked={to=>!statusOfColumn(to,false)} role={isOverlay?undefined:'article'}
   className={`${made===card.id?'is-flash':''}${selected?' is-sel':''}`} data-card={isOverlay?undefined:card.id} aria-label={isOverlay?undefined:label}>
   <span className="kt-head">{selected?<button type="button" className="authored-title kcard__title kcard__pick" dir="auto" aria-pressed={chosen} onClick={()=>flip(card.id)}><strong>{card.title}</strong></button>
    :<a className="kcard__title authored-title" dir="auto" href={cardHref(card.id)} draggable={false} tabIndex={isOverlay?-1:undefined} onClick={event=>openCard(event,card.id)}
      aria-describedby={writer?'board-drag-hint':undefined} aria-keyshortcuts={writer?'Shift+ArrowLeft Shift+ArrowRight':undefined} onKeyDown={isOverlay?undefined:keys(card)}><strong>{card.title}</strong></a>}
    {card.symbol&&symbol&&<span className="kt-syms"><span className={`sym sym--${symbol.tone}`} data-sym={card.symbol.kind} role="img" aria-label={symbolName(card.symbol)} title={symbolName(card.symbol)}>
     {symbol.icon?<ShellIcon name={symbol.icon}/>:<span className="sym__dot"/>}{card.symbol.kind==='waits'&&card.symbol.count>1&&<span className="sym__n num" aria-hidden="true">{card.symbol.count}</span>}</span></span>}</span>
   <span className="kcard__foot">
    <span className="kt-face" title={who}>{card.agent?<AgentFace agent={card.agent.id} size={20}/>:card.person?<span className="me__av lg-av" style={{'--av':'20px'} as CSSProperties} aria-hidden="true">{Array.from(card.person.name.trim())[0]||'?'}</span>:<span className="cw-noone" style={{'--av':'20px'} as CSSProperties} aria-hidden="true"/>}</span>
    {card.comments>0&&<span className="kt-metas"><span className="kt-m" title={comments}><ShellIcon name="chat"/><span className="num">{card.comments}</span></span></span>}
   </span>
   {selected&&<span className="kt-check" aria-hidden="true">{chosen&&<ShellIcon name="check"/>}</span>}
  </KanbanCard>;
 };
 const views=<nav className="tabs segmented" aria-label={t('boardViews')}>{[['board',t('board')],['calendar',t('calendar')],['list',t('list')]].map(([path,name])=>
  <Link key={path} data-slot="button" data-active={path==='board'} aria-current={path==='board'?'page':undefined} className={`button ${path==='board'?'active':''}`} href={`${base}/${path}`}>{name}</Link>)}</nav>;
 return <div className="work-root"><div className="board-view">
  <header className="page-head"><div className="od-field"><h1 className="page-title">{t('marketingBoard')}</h1><p className="page-sub">{t('boardSubtitle')}</p></div><div className="work-toolbar" data-canonical-toolbar="work">{views}</div></header>
  <div className="board-tools">
   {!showArchived&&<BoardFilters cards={cards??[]} filter={filter} onFilter={setFilter}/>}
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
   <button ref={selectAll} type="button" className="link-btn" onClick={()=>{ setSelected(new Set(drawn.map(card=>card.id))); setFocusTo('act'); }}>{t('boardSelectAllShown')}</button>
   <span className="od-fill"/>
   <button type="button" className="btn btn--secondary btn--sm" onClick={endSelecting}>{t('cancel')}</button>
   <button ref={selectAct} type="button" className="btn btn--primary btn--sm" disabled={!selected.size} onClick={archiveChosen}><ShellIcon name="archive"/><span>{t('boardArchiveSelected')}</span></button>
  </div>}
  {archiving.left}
  {!showArchived&&read.state==='reading'&&!cards&&<p role="status" className="board-status">{t('boardReading')}</p>}
  {!showArchived&&read.state==='failed'&&(cards?<p role="status" className="board-status">{t('boardRefreshFailed')}</p>:<p role="alert" className="work-error">{t('boardReadFailed')}</p>)}
  {showArchived&&<ArchivedList company={company} writer={writer} query={query} version={version} cardHref={cardHref} openCard={openCard} restore={ids=>void archiving.restore(ids)} total={setArchivedTotal}/>}
  {!showArchived&&cards&&!cards.length&&main&&<div className="board-bare" role="note"><span aria-hidden="true"><AgentFace agent={main.id} size={32}/></span><p>{t('boardEmpty',main.name)}</p>{writer&&<Link className="btn btn--secondary btn--sm" href={`/c/${slug}/chat`}><BoardIcon name="chat"/><span>{t('boardTalkTo',main.name)}</span></Link>}</div>}
  {!showArchived&&writer&&<p className="sr-only" id="board-drag-hint">{t('cardDragHint')}</p>}
  {!showArchived&&<KanbanBoard label={t('workBoard')} busy={read.state==='reading'} cards={drawn.map(card=>({id:card.id,title:card.title,column:card.column}))} columnName={columnName}
   renderOverlay={id=>{ const card=drawn.find(found=>found.id===id); return card?cardView(card,true):null; }} onMove={(id,to)=>move(id,to)}>
   {cardColumns.map(column=>{
    const list=drawn.filter(card=>card.column===column);
    const waiting=column==='waiting';
    // A column that is the work's own says so where a Card carried over it would land (#837).
    const own=writer&&!statusOfColumn(column,false);
    return <KanbanColumn key={column} column={column} name={columnName(column)} count={cards?list.length:''} waiting={waiting}
     head={column==='done'&&writer&&!selected&&list.length>0&&<button type="button" className="ib ib--sm col__act" aria-label={t('boardArchiveDone',columnName(column))} title={t('boardArchiveAll')} onClick={()=>void archiving.archive(list.map(card=>card.id))}><ShellIcon name="archive"/></button>}>
     {own&&<p className="col__note" role="note">{t(column==='progress'?'cardMoveProgress':'cardMoveWaiting')}</p>}
     {list.map(card=>cardView(card))}{cards&&!list.length&&<div className="col-empty"><b>{t(filtered?'boardNoMatch':emptyKey[column][0])}</b>{!filtered&&emptyKey[column][1]&&<span>{t(emptyKey[column][1])}</span>}</div>}
    </KanbanColumn>;
   })}
  </KanbanBoard>}
  {open&&<CardWindow key={company} company={company} id={open} seen={cards?.find(card=>card.id===open)??null} writer={writer} reviewer={reviewer} board={cards??[]} cardHref={cardHref} fileHref={(card,file)=>`/c/${slug}/files/board/${encodeURIComponent(card)}/${encodeURIComponent(file)}`} showCard={showCard} onBoard={accept}
   archive={writer?(id,done)=>void archiving.archive([id],{done}):undefined} restore={writer?id=>archiving.restore([id]):undefined} onClose={closeCard}/>}
  {archiving.confirm}
 {making&&<Suspense fallback={null}><NewCard company={company} project={filter.project==='all'||filter.project==='none'?'':filter.project} projects={[...new Set((cards??[]).flatMap(card=>card.project?[card.project]:[]))].sort()} onMade={(answer:MadeBoard)=>{ if(answer.cards) read.accept({cards:answer.cards,main:answer.main??null}); setMade(answer.made); }}
  onClose={()=>{ setMaking(false); if(creating&&window.location.pathname.endsWith('/work/new')) window.history.replaceState(window.history.state,'',`${base}/board`); opener.current?.focus(); }}/></Suspense>}
 </div></div>;
}
